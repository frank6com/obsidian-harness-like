/**
 * harness-like 主入口。
 *
 * onload：启动 Cordis 运行时（obsidian-adapter + harness-base + plugin-runtime），
 * 注册内置工具、视图、命令、设置页，加载已授权用户插件。
 * onunload：逆序 dispose 全部 fiber（Cordis 保证副作用可逆撤销）。
 */

import * as fs from 'fs'
import * as path from 'path'
import { Plugin, type Editor, type WorkspaceLeaf } from 'obsidian'
import * as obsidianModule from 'obsidian'
import * as cordis from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { harnessServicesPlugin, selectSessionsToPrune, shouldLog } from '@harness-like/harness-base'
import { isPathInDirs } from './policy'
import { obsidianAdapterPlugin } from '@harness-like/obsidian-adapter'
import { runtimePlugin } from '@harness-like/plugin-runtime'
import { toApiLike } from './obsidian-bridge'
import {
  defaultSettings,
  migrateSettings,
  parseHeaderLines,
  parseModelId,
  parseToolPolicy,
  type HarnessLikeSettings,
  type ProviderConfig,
} from './settings'
import { HarnessLikeSettingsTab, type TabId } from './settings-tab'
import { PluginBackups } from './plugin-backups'
import { getLanguage, registerLocale, resolveLanguage, setLanguage, t } from './i18n'
import { WriteApprovalModal, GrantModal, ConfirmModal, CommandApprovalModal } from './modals'
import { builtinToolsPlugin } from './tools/builtin'
import { pluginDevToolsPlugin } from './tools/plugin-dev'
import { ChatView, CHAT_VIEW_TYPE } from './views/ChatView'
import { PluginManagerView, PLUGIN_MANAGER_VIEW_TYPE } from './views/PluginManagerView'

/** esbuild bundle 内可见的宿主 require（解析 node 内置模块 / obsidian） */
declare function require(id: string): unknown

const cordisShim = (id: string): unknown => {
  if (id === '@deepseek-ai/cordis') return cordis
  // obsidian 由宿主显式注入（不依赖 bundle require 能否解析）——用户插件可安全 require('obsidian')
  if (id === 'obsidian') return obsidianModule
  return require(id)
}

export default class HarnessLikePlugin extends Plugin {
  override settings: HarnessLikeSettings = defaultSettings()
  private ctx: Context | null = null
  private settingsTab?: HarnessLikeSettingsTab
  private fibers: Array<{ dispose(): Promise<void> }> = []
  /** auto 语言跟随轮询（Obsidian 切语言无事件，3s 对比 localStorage['language']） */
  private langWatch: number | null = null

  override async onload(): Promise<void> {
    await this.loadSettings()
    // 界面语言：按设置解析（auto = 跟随 Obsidian 应用语言；命令名/面板标题注册时定稿）
    setLanguage(resolveLanguage(this.settings.uiLanguage))

    const vaultRoot = (
      this.app.vault.adapter as { getBasePath?: () => string }
    ).getBasePath?.()
    if (!vaultRoot) {
      console.warn('[harness-like] 无法获取 vault 根路径，沙箱将拒绝所有写操作')
    }
    const root = vaultRoot ?? ''
    const configDir = this.app.vault.configDir
    const dataDir = path.join(root, configDir, 'harness-like')
    const pluginsDir = path.join(root, configDir, 'harness-like-plugins')
    const tempDir = path.join(dataDir, 'tmp')
    // 旧版数据目录迁移（≤0.28.20：.obsidian/dsh 与 .obsidian/dsh-plugins）：
    // 新目录不存在时整体搬移，保留已有会话/授权/用户插件
    await this.migrateLegacyDirs(root, configDir)

    const ctx = new cordis.Context()
    this.ctx = ctx

    const apiLike = toApiLike(this.app, this)

    this.fibers.push(
      ctx.plugin(
        obsidianAdapterPlugin(apiLike, {
          load: () => this.settings,
          save: (d) => {
            this.settings = d as HarnessLikeSettings
            void this.saveSettings()
          },
        }),
      ),
    )
    // 工具审批（tools/pre-execute 瀑布）：工具级策略 + 白名单 + 沙箱 + 弹窗
    const approveTool = async (request: {
      name: string
      arguments: unknown
      signal: AbortSignal
    }): Promise<'allow' | 'deny'> => {
      // 工具级策略覆盖（toolPolicy 配置）
      const policy = parseToolPolicy(this.settings.toolPolicy).get(request.name)
      if (policy === 'deny') return 'deny'
      if (policy === 'allow') return 'allow'
      if (policy === 'ask') {
        const ok = await new ConfirmModal(
          this.app,
          t('approval.toolAsk', { name: request.name }),
          t('approval.allow'),
        ).ask()
        return ok ? 'allow' : 'deny'
      }
      if (request.name !== 'write_note') return 'allow'
      const args = request.arguments as { path?: string; content?: string }
      const targetPath = String(args.path ?? '')
      const decision = ctx.sandbox.decide(targetPath, 'write')
      if (!decision.allowed) return 'deny'
      // 仅当前笔记模式：写操作只能写当前活动笔记
      if (this.settings.confineToCurrentNote) {
        const active = ctx.workspace.getActiveFile()
        if (active && targetPath !== active) return 'deny'
      }
      // 目录级白名单：命中则免审批
      if (isPathInDirs(targetPath, this.settings.writeAllowDirs)) return 'allow'
      const mode = ctx.approval.decideWrite(this.settings.approvalDefault)
      if (mode === 'allow') return 'allow'
      ctx.emit('dsh/waiting-approval', targetPath)
      const r = await new WriteApprovalModal(this.app, targetPath, {
        preview: String(args.content ?? '').slice(0, 200),
      }).ask()
      if (r.choice === 'allow-session') ctx.approval.setSessionAllow(true)
      return r.choice === 'deny' ? 'deny' : 'allow'
    }

    this.fibers.push(
      ctx.plugin(
        harnessServicesPlugin({
          sandbox: { vaultRoot: root, configDir, dataDir, pluginsDir, tempDir },
          sessionDir: path.join(dataDir, 'sessions'),
          approvalStore: {
            load: () => this.settings.grants ?? {},
            save: (g) => {
              this.settings.grants = g
              void this.saveSettings()
            },
          },
          getLLMConfig: (provider: string) => {
            const p = this.providerById(provider)
            return {
              baseURL: p.baseURL,
              apiKey: p.apiKey,
              model: p.models[0] ?? '',
              temperature: p.temperature,
              maxTokens: p.maxTokens,
              extraHeaders: parseHeaderLines(p.extraHeaders),
            }
          },
          providerIds: this.settings.providers.map((p) => p.id),
          defaultProvider: () => this.defaultModel().provider,
          defaultModel: () => this.defaultModel().model,
          approveTool,
          logLevel: this.settings.logLevel,
        }),
      ),
    )
    this.fibers.push(ctx.plugin(runtimePlugin({ pluginsDir, require: cordisShim, hostId: this.manifest.id, hostName: this.manifest.name })))
    await Promise.all(this.fibers.map((f) => Promise.resolve(f)))

    // 翻译扩展点：用户插件通过 inject: ['dshI18n'] + registerLocale(lang, dict)
    // 覆盖主插件界面文案（返回 disposer，插件停止时自动移除）
    ctx.reflect.provide('dshI18n', {
      registerLocale,
    })

    // 用户插件版本备份（覆盖写入前 / 删除前自动快照，可回退、可恢复误删）
    ctx.reflect.provide('pluginBackups', new PluginBackups(path.join(dataDir, 'plugin-backups')))

    // 编辑器桥：把 Obsidian 的 activeEditor 暴露为 ctx.editor
    ctx.editor.setProvider(() => {
      const active = (this.app.workspace as unknown as {
        activeEditor?: { file?: { path: string } | null; editor?: Editor | null } | null
      }).activeEditor
      const ed = active?.editor
      if (!ed) return null
      return {
        filePath: active?.file?.path ?? null,
        insertText: (t: string) => ed.replaceSelection(t),
        replaceSelection: (t: string) => ed.replaceSelection(t),
        getSelection: () => ed.getSelection() || null,
      }
    })

    this.fibers.push(
      ctx.plugin(
        builtinToolsPlugin({
          openTarget: (t) => apiLike.openTarget(t),
          confirmCommand: (command, cwd, fullAccess) =>
            new CommandApprovalModal(this.app, command, cwd, fullAccess).ask(),
        }),
      ),
    )

    // 插件创造模式：agent 创建/修改/重载用户插件（未授权先弹授权窗；覆盖文件需确认）
    const ensureGranted = async (
      pluginId: string,
      version: string,
      description?: string,
    ): Promise<boolean> => {
      if (ctx.approval.isGranted(pluginId, version)) return true
      const choice = await new GrantModal(this.app, { id: pluginId, version, description }).ask()
      if ('cancel' in choice) return false
      ctx.approval.grant(pluginId, choice.mode, version)
      return true
    }
    const confirmOverwrite = async (pluginId: string, file: string): Promise<boolean> => {
      return new ConfirmModal(
        this.app,
        t('approval.overwriteConfirm', { id: pluginId, file }),
        t('approval.allowOverwrite'),
      ).ask()
    }
    const confirmRestore = async (pluginId: string, backupTime: string): Promise<boolean> => {
      return new ConfirmModal(
        this.app,
        t('approval.rollbackAsk', { id: pluginId, time: backupTime }),
        t('pm.history.restore'),
      ).ask()
    }
    this.fibers.push(ctx.plugin(pluginDevToolsPlugin({ ensureGranted, confirmOverwrite, confirmRestore })))

    // 视图与命令
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, ctx))
    this.registerView(PLUGIN_MANAGER_VIEW_TYPE, (leaf) =>
      new PluginManagerView(leaf, ctx, { openFolder: (p) => void apiLike.openTarget(p) }),
    )
    this.addCommand({
      id: 'open-chat',
      name: t('cmd.openChat'),
      callback: () => void this.activateView(CHAT_VIEW_TYPE),
    })
    this.addCommand({
      id: 'open-plugin-manager',
      name: t('cmd.openPluginManager'),
      callback: () => void this.activateView(PLUGIN_MANAGER_VIEW_TYPE),
    })
    this.addCommand({
      id: 'reload-user-plugins',
      name: t('cmd.reloadUserPlugins'),
      callback: () => void this.loadUserPlugins(),
    })
    this.settingsTab = new HarnessLikeSettingsTab(this.app, this, ctx)
    this.addSettingTab(this.settingsTab)
    // 设置 UI 桥：对话面板可跳转到指定设置 tab
    ctx.reflect.provide('dshSettingsUi', {
      openTo: (tab: string) => this.settingsTab?.openTo(tab as TabId),
    })
    this.addRibbonIcon('bot', t('cmd.ribbonTitle'), () => void this.activateView(CHAT_VIEW_TYPE))

    // auto 语言跟随：Obsidian 应用语言变化无事件通知，低频率轮询对比
    this.langWatch = window.setInterval(() => {
      if (!this.ctx) return
      const resolved = resolveLanguage(this.settings.uiLanguage)
      if (resolved !== getLanguage()) {
        setLanguage(resolved)
        this.ctx.emit('dsh/settings-updated', 'all')
      }
    }, 3000)

    // 启动时加载已授权用户插件
    await this.loadUserPlugins()
    // 会话保留策略：清理过期会话
    await this.pruneSessions()
    console.info('[harness-like] onload 完成')
  }

  override async onunload(): Promise<void> {
    if (this.langWatch) {
      window.clearInterval(this.langWatch)
      this.langWatch = null
    }
    for (const fiber of [...this.fibers].reverse()) {
      try {
        await fiber.dispose()
      } catch (err) {
        console.warn('[harness-like] 卸载 fiber 异常', err)
      }
    }
    this.fibers = []
    this.ctx = null
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData()
    this.settings = migrateSettings(data as Record<string, unknown> | undefined)
  }

  /**
   * 旧版数据目录迁移：.obsidian/dsh → .obsidian/harness-like、
   * .obsidian/dsh-plugins → .obsidian/harness-like-plugins。
   * 仅在新目录不存在时执行（避免覆盖）；失败仅告警不阻断启动。
   */
  private async migrateLegacyDirs(root: string, configDir: string): Promise<void> {
    const pairs: Array<[string, string]> = [
      [path.join(root, configDir, 'dsh'), path.join(root, configDir, 'harness-like')],
      [path.join(root, configDir, 'dsh-plugins'), path.join(root, configDir, 'harness-like-plugins')],
    ]
    for (const [oldDir, newDir] of pairs) {
      try {
        if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
          await fs.promises.rename(oldDir, newDir)
          console.info(`[harness-like] 数据目录迁移: ${oldDir} → ${newDir}`)
        }
      } catch (err) {
        console.warn(`[harness-like] 数据目录迁移失败（忽略）: ${oldDir}`, err)
      }
    }
  }

  /** 按 id 取提供方（未知 id 回退默认） */
  private providerById(id: string): ProviderConfig {
    return (
      this.settings.providers.find((p) => p.id === id) ??
      this.settings.providers[0] ??
      defaultSettings().providers[0]!
    )
  }

  /** 默认模型（defaultModelId 解析，回退第一个提供方的第一个模型） */
  private defaultModel(): { provider: string; model: string } {
    const mid = parseModelId(this.settings.defaultModelId)
    if (mid && this.settings.providers.some((p) => p.id === mid.provider)) return mid
    const first = this.settings.providers[0] ?? defaultSettings().providers[0]!
    return { provider: first.id, model: first.models[0] ?? '' }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    // 广播设置变更：对话面板刷新模型/智能体选择
    this.ctx?.emit('dsh/settings-updated', 'all')
  }

  private async loadUserPlugins(): Promise<void> {
    if (!this.ctx) return
    const ids = await this.ctx.pluginRuntime.discover()
    for (const id of ids) {
      const rec = this.ctx.pluginRuntime.inspect(id)
      const manifest = rec.manifest
      if (!manifest) continue
      if (!this.ctx.approval.isGranted(id, manifest.version)) continue
      const result = await this.ctx.pluginRuntime.load(id)
      if (result.status === 'error') {
        console.warn(`[harness-like] 插件加载失败 ${id}: ${result.error}`)
      }
    }
  }

  /** 会话保留策略：删除超过保留天数的会话日志 */
  private async pruneSessions(): Promise<void> {
    if (this.settings.sessionRetentionDays <= 0 || !this.ctx) return
    try {
      const list = await this.ctx.sessionLog.list()
      const stale = selectSessionsToPrune(list, Date.now(), this.settings.sessionRetentionDays)
      for (const id of stale) await this.ctx.sessionLog.remove(id)
      if (stale.length > 0 && shouldLog('info', this.settings.logLevel)) {
        console.info(`[harness-like] 已清理 ${stale.length} 个过期会话（保留 ${this.settings.sessionRetentionDays} 天）`)
      }
    } catch (err) {
      console.warn('[harness-like] 会话清理失败', err)
    }
  }

  private activateView(type: string): void {
    const { workspace } = this.app
    const leaves = workspace.getLeavesOfType(type)
    let leaf: WorkspaceLeaf | undefined = leaves[0]
    if (!leaf) {
      const right = workspace.getRightLeaf(false)
      if (!right) return
      leaf = right
      void leaf.setViewState({ type, active: true })
    }
    workspace.setActiveLeaf(leaf)
  }
}
