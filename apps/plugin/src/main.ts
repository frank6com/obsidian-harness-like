/**
 * dsh-obsidian 主入口。
 *
 * onload：启动 Cordis 运行时（obsidian-adapter + harness-base + plugin-runtime），
 * 注册内置工具、视图、命令、设置页，加载已授权用户插件。
 * onunload：逆序 dispose 全部 fiber（Cordis 保证副作用可逆撤销）。
 */

import * as path from 'path'
import { Plugin, type Editor, type WorkspaceLeaf } from 'obsidian'
import * as obsidianModule from 'obsidian'
import * as cordis from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { harnessServicesPlugin, selectSessionsToPrune, shouldLog } from '@dsh-obsidian/harness-base'
import { isPathInDirs } from './policy'
import { obsidianAdapterPlugin } from '@dsh-obsidian/obsidian-adapter'
import { runtimePlugin } from '@dsh-obsidian/plugin-runtime'
import { toApiLike } from './obsidian-bridge'
import {
  defaultSettings,
  migrateSettings,
  parseHeaderLines,
  parseToolPolicy,
  type DshSettings,
  type ProviderConfig,
} from './settings'
import { DshSettingsTab } from './settings-tab'
import { WriteApprovalModal, GrantModal, ConfirmModal } from './modals'
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

export default class DshObsidianPlugin extends Plugin {
  override settings: DshSettings = defaultSettings()
  private ctx: Context | null = null
  private fibers: Array<{ dispose(): Promise<void> }> = []

  override async onload(): Promise<void> {
    await this.loadSettings()

    const vaultRoot = (
      this.app.vault.adapter as { getBasePath?: () => string }
    ).getBasePath?.()
    if (!vaultRoot) {
      console.warn('[dsh-obsidian] 无法获取 vault 根路径，沙箱将拒绝所有写操作')
    }
    const root = vaultRoot ?? ''
    const dataDir = path.join(root, '.obsidian', 'dsh')
    const pluginsDir = path.join(root, '.obsidian', 'dsh-plugins')
    const tempDir = path.join(dataDir, 'tmp')

    const ctx = new cordis.Context()
    this.ctx = ctx

    const apiLike = toApiLike(this.app, this)

    this.fibers.push(
      ctx.plugin(
        obsidianAdapterPlugin(apiLike, {
          load: () => this.settings,
          save: (d) => {
            this.settings = d as unknown as DshSettings
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
          `agent 请求执行工具 ${request.name}`,
          '允许',
        ).ask()
        return ok ? 'allow' : 'deny'
      }
      if (request.name !== 'write_note') return 'allow'
      const args = request.arguments as { path?: string; content?: string }
      const targetPath = String(args.path ?? '')
      const decision = ctx.sandbox.decide(targetPath, 'write')
      if (!decision.allowed) return 'deny'
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
          sandbox: { vaultRoot: root, dataDir, pluginsDir, tempDir },
          sessionDir: path.join(dataDir, 'sessions'),
          approvalStore: {
            load: () => this.settings.grants ?? {},
            save: (g) => {
              this.settings.grants = g
              void this.saveSettings()
            },
          },
          getLLMConfig: () => {
            const p = this.activeProvider()
            return {
              baseURL: p.baseURL,
              apiKey: p.apiKey,
              model: p.model,
              temperature: p.temperature,
              maxTokens: p.maxTokens,
              extraHeaders: parseHeaderLines(p.extraHeaders),
            }
          },
          approveTool,
          logLevel: this.settings.logLevel,
        }),
      ),
    )
    this.fibers.push(ctx.plugin(runtimePlugin({ pluginsDir, require: cordisShim })))
    await Promise.all(this.fibers)

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
      ctx.plugin(builtinToolsPlugin({ openTarget: (t) => apiLike.openTarget(t) })),
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
        `agent 请求覆盖插件 ${pluginId} 的文件 ${file}\n覆盖后原内容将丢失。`,
        '允许覆盖',
      ).ask()
    }
    this.fibers.push(ctx.plugin(pluginDevToolsPlugin({ ensureGranted, confirmOverwrite })))

    // 视图与命令
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, ctx))
    this.registerView(PLUGIN_MANAGER_VIEW_TYPE, (leaf) =>
      new PluginManagerView(leaf, ctx, { openFolder: (p) => void apiLike.openTarget(p) }),
    )
    this.addCommand({
      id: 'open-chat',
      name: '打开 dsh Chat 面板',
      callback: () => void this.activateView(CHAT_VIEW_TYPE),
    })
    this.addCommand({
      id: 'open-plugin-manager',
      name: '打开 dsh 插件管理器',
      callback: () => void this.activateView(PLUGIN_MANAGER_VIEW_TYPE),
    })
    this.addCommand({
      id: 'reload-user-plugins',
      name: '重载已授权的用户插件',
      callback: () => void this.loadUserPlugins(),
    })
    this.addSettingTab(new DshSettingsTab(this.app, this, ctx))
    this.addRibbonIcon('bot', '打开 dsh Chat', () => void this.activateView(CHAT_VIEW_TYPE))

    // 启动时加载已授权用户插件
    await this.loadUserPlugins()
    // 会话保留策略：清理过期会话
    await this.pruneSessions()
    console.info('[dsh-obsidian] onload 完成')
  }

  override async onunload(): Promise<void> {
    for (const fiber of [...this.fibers].reverse()) {
      try {
        await fiber.dispose()
      } catch (err) {
        console.warn('[dsh-obsidian] 卸载 fiber 异常', err)
      }
    }
    this.fibers = []
    this.ctx = null
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData()
    this.settings = migrateSettings(data as Record<string, unknown> | undefined)
  }

  /** 当前激活的模型提供方 */
  private activeProvider(): ProviderConfig {
    const active = this.settings.providers.find((p) => p.id === this.settings.activeProviderId)
    return active ?? this.settings.providers[0] ?? defaultSettings().providers[0]!
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
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
        console.warn(`[dsh-obsidian] 插件加载失败 ${id}: ${result.error}`)
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
        console.info(`[dsh-obsidian] 已清理 ${stale.length} 个过期会话（保留 ${this.settings.sessionRetentionDays} 天）`)
      }
    } catch (err) {
      console.warn('[dsh-obsidian] 会话清理失败', err)
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
    workspace.revealLeaf(leaf)
  }
}
