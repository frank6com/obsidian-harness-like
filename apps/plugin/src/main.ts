/**
 * harness-like 主入口。
 *
 * onload：启动 Cordis 运行时（obsidian-adapter + harness-base + plugin-runtime），
 * 注册内置工具、视图、命令、设置页，加载已授权用户插件。
 * onunload：逆序 dispose 全部 fiber（Cordis 保证副作用可逆撤销）。
 */

import * as fs from 'fs'
import * as path from 'path'
import { Plugin, Notice, MarkdownView, type Editor, type WorkspaceLeaf } from 'obsidian'
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
import { PluginFilesSelfHeal, fetchTextWithTimeout } from './plugin-files'
import { userSettingsTabPlugin } from './user-settings-tab'
import { protocolServicePlugin } from './protocol-service'
import {
  blockServicePlugin,
  type BlockAliasesService,
  type BlockPlaceholderKind,
  type BlockRenderContext,
  type PlaceholderDetail,
} from './block-service'
import { validatePluginAlias, type AliasReject } from './block-info'

/** 块定位用到的 CodeMirror EditorView 最小面（posAtDOM/文档行访问） */
interface CMLike {
  dom?: HTMLElement
  posAtDOM(node: Node, offset?: number): number
  state: {
    doc: {
      lines: number
      line(n: number): { text: string; number: number }
      lineAt(pos: number): { number: number }
    }
  }
}
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
  /**
   * 已发现的子插件 id（小写）。块 target 解析时用于判断"这是真实插件 id 还是别名"，
   * 每次 loadUserPlugins 刷新——同步查表，避免块渲染时命中磁盘。
   */
  private knownPluginIds = new Set<string>()

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

    // 插件文件自愈：styles.css 缺失（Obsidian 视其为 optional 资产，安装网络不佳会静默跳过）
    // 时自动下载并写回；设置页与对话面板展示状态条
    const pluginDir = path.posix.join(configDir, 'plugins', this.manifest.id)
    const vaultAdapter = this.app.vault.adapter as {
      exists(p: string): Promise<boolean>
      write(p: string, c: string): Promise<void>
    }
    const pluginFiles = new PluginFilesSelfHeal(
      {
        pluginDir,
        repo: 'frank6com/obsidian-harness-like',
        version: this.manifest.version,
        exists: (p) => vaultAdapter.exists(p),
        write: (p, c) => vaultAdapter.write(p, c),
        fetchText: (url) => fetchTextWithTimeout(url),
      },
      ctx,
    )
    ctx.reflect.provide('pluginFiles', pluginFiles)
    void pluginFiles.ensure()

    // 外部目标打开（自愈状态条失败提示的 release 链接 / 插件目录跳转用）
    ctx.reflect.provide('openExternal', (target: string) => void apiLike.openTarget(target))

    // 用户插件设置页注册（ctx.settingsTab）：宿主创建真实 PluginSettingTab
    this.fibers.push(ctx.plugin(userSettingsTabPlugin(this.app, this)))

    // obsidian:// 协议扩展点（ctx.protocol）：宿主只向 Obsidian 注册一次统一入口
    // obsidian://<manifest.id>?plugin=<子插件id>&cmd=<动作名>&...（无公开注销 API，
    // 单入口把该限制收敛为一个 listener；子插件注册/卸载只是内存路由表增删。
    // 路由参数用 cmd：Obsidian 解析 URI 时 data.action 恒为入口名，query 的 action 不可用）
    const hostAction = this.manifest.id
    this.fibers.push(
      ctx.plugin(
        protocolServicePlugin({
          registerEntry: (handler) => apiLike.protocol.registerObsidianProtocolHandler(hostAction, handler),
          notify: (kind, detail) => {
            const msg =
              kind === 'missing'
                ? t('protocol.missingParams')
                : t('protocol.notFound', { plugin: detail.plugin ?? '', cmd: detail.cmd ?? '' })
            new Notice(msg)
          },
        }),
      ),
    )

    // 块定义扩展点（ctx.blocks）：```hl <子插件id 或 别名>[:<type>] [参数...]
    // 宿主【启动即注册一次】裸 hl 处理器（实测：Obsidian 的查找键 = 首个空白 token 再砍掉
    // 首个冒号之后的全部，故 hl: 命名空间只需这一个注册点，注册它即等于独占该命名空间）；
    // 子插件的注册/卸载/改名纯内存操作，零原生副作用（实测结论见 block-service.ts 文件头）。
    this.fibers.push(
      ctx.plugin(
        blockServicePlugin({
          registerNative: (lang, dispatch) => {
            try {
              apiLike.codeBlockProcessor.registerProcessor(lang, (source, el, ctx) =>
                dispatch(source, el, ctx as BlockRenderContext),
              )
            } catch (err) {
              // 被其它插件抢注：我们的块会被对方接管，只能提示用户
              console.error('[harness-like] 块处理器注册失败（hl 命名空间可能被占用）:', err)
              new Notice(t('blocks.registerFailed'))
            }
          },
          // 真实插件 id 优先于别名——子插件无法用别名劫持他人（含未运行插件的）命名空间
          resolveTarget: (token) => {
            const t = token.trim().toLowerCase()
            if (!t) return undefined
            if (this.knownPluginIds.has(t)) return t
            for (const [pid, alias] of Object.entries(this.settings.pluginAliases)) {
              if (pid && alias.trim().toLowerCase() === t) return pid.trim().toLowerCase()
            }
            return undefined
          },
          // Live Preview 下解析 el 对应块的绝对行号（相邻同内容块唯一定位用）：
          // CM 的 posAtDOM + lineAt 可把块容器 DOM 映射回文档行
          resolveBlockLine: (el) => {
            const wrapper = el.closest('.cm-preview-code-block')
            const cmRoot = el.closest('.cm-editor') as HTMLElement | null
            if (!wrapper || !cmRoot) return null
            const cm = this.findCm(cmRoot)
            if (!cm) return null
            try {
              return cm.state.doc.lineAt(cm.posAtDOM(wrapper, 0)).number - 1 // 0-based
            } catch {
              return null
            }
          },
          // getSectionInfo 偶发为空时的兜底：直接从 el 位置向下探测 fence 开始行，
          // 拿回整条 info（CM 文档是同步且可靠的）
          resolveFenceInfoAt: (el) => {
            const wrapper = el.closest('.cm-preview-code-block')
            const cmRoot = el.closest('.cm-editor') as HTMLElement | null
            if (!wrapper || !cmRoot) return null
            const cm = this.findCm(cmRoot)
            if (!cm) return null
            try {
              const pos = cm.posAtDOM(wrapper, 0)
              const start = cm.state.doc.lineAt(pos).number
              const end = Math.min(start + 4, cm.state.doc.lines)
              for (let n = start; n <= end; n++) {
                const m = /^\s*(?:```+|~~~+)(.*)$/.exec(cm.state.doc.line(n).text)
                const info = m?.[1]?.trim()
                if (info) return info
              }
              return null
            } catch {
              return null
            }
          },
          renderPlaceholder: (el, kind, detail) => {
            el.createDiv({
              cls: 'dsh-block-placeholder',
              text: this.blockPlaceholderText(kind, detail),
            })
            // 定位失败时降级显示块原文（不吞内容，用户仍能看到/复制块里写了什么）
            if (kind === 'badInfo' && detail.source) this.renderRawSource(el, detail.source)
          },
        }),
      ),
    )

    // 插件 id 别名（缩短笔记里 ```hl <target> 的书写）：校验集中在宿主，
    // 保证"真实 id 优先于别名"——子插件无法用别名劫持他人命名空间
    ctx.reflect.provide(
      'blockAliases',
      {
        get: (pluginId: string) => this.settings.pluginAliases[pluginId.trim().toLowerCase()],
        set: (pluginId: string, alias: string) => this.setPluginAlias(pluginId, alias),
      } satisfies BlockAliasesService,
    )

    // 编辑器桥：把 Obsidian 的 activeEditor 暴露为 ctx.editor
    ctx.editor.setProvider(() => {
      type EditorHost = { file?: { path: string } | null; editor?: Editor | null }
      const ws = this.app.workspace
      let active: EditorHost | null | undefined = (
        ws as unknown as { activeEditor?: EditorHost | null }
      ).activeEditor
      if (!active?.editor) {
        // workspace.activeEditor 在阅读模式 / 活动 leaf 为侧边栏（如插件管理器面板）时为
        // null，getActiveViewOfType 同样只看活动 leaf——侧边栏聚焦时也拿不到。
        // 逐级回退：最近活动 leaf（getMostRecentLeaf 只统计主工作区，不含侧边栏，
        // 恰好是"用户最后编辑的笔记"）→ 其余已打开的 markdown leaf。
        const view = ws.getActiveViewOfType(MarkdownView)
        if (view) {
          active = view as unknown as EditorHost
        } else {
          const recent = (
            ws as unknown as { getMostRecentLeaf?: () => WorkspaceLeaf | null }
          ).getMostRecentLeaf?.()
          const candidates = recent ? [recent, ...ws.getLeavesOfType('markdown')] : ws.getLeavesOfType('markdown')
          for (const leaf of candidates) {
            const v = leaf.view as unknown as EditorHost | null
            if (v?.editor) {
              active = v
              break
            }
          }
        }
      }
      const ed = active?.editor
      if (!ed) return null
      return {
        filePath: active?.file?.path ?? null,
        insertText: (t: string) => ed.replaceSelection(t),
        replaceSelection: (t: string) => ed.replaceSelection(t),
        getSelection: () => ed.getSelection() || null,
        // 插入整块内容（块模板）：光标停在非空行中间时先补换行，避免 fence 粘在行尾
        insertBlock: (t: string) => {
          const cur = ed.getCursor()
          const line = ed.getLine(cur.line) ?? ''
          const prefix = cur.ch > 0 && line.trim() !== '' ? '\n' : ''
          ed.replaceSelection(prefix + t)
        },
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

  /**
   * 设置/清除插件 id 别名（空串 = 清除）。校验规则见 validatePluginAlias：
   * 不得等于任何已发现插件的真实 id（防劫持），不得与其它插件的别名重复；
   * 指向已删除插件的残留别名可被抢占。
   */
  private setPluginAlias(
    pluginId: string,
    alias: string,
  ): { ok: true; alias: string } | { ok: false; reason: AliasReject } {
    const pid = pluginId.trim().toLowerCase()
    const raw = alias.trim()
    if (!raw) {
      delete this.settings.pluginAliases[pid]
      void this.saveSettings()
      return { ok: true, alias: '' }
    }
    // 占用者需仍存在（指向已删除插件的残留别名允许被抢占）
    const taken = Object.entries(this.settings.pluginAliases)
      .filter(([id]) => id !== pid && this.knownPluginIds.has(id))
      .map(([, a]) => a)
    const check = validatePluginAlias(raw, { knownIds: [...this.knownPluginIds], taken })
    if (!check.ok) return check
    this.settings.pluginAliases[pid] = check.alias
    void this.saveSettings()
    return check
  }

  /** 按编辑器 DOM 找到拥有它的 leaf 的 CM 实例（块定位/直读共用） */
  private findCm(cmRoot: HTMLElement): CMLike | null {
    let found: CMLike | null = null
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return
      const cand = (leaf.view as unknown as { editor?: { cm?: CMLike } }).editor?.cm
      if (cand?.dom === cmRoot) found = cand
    })
    return found
  }

  /** 块占位符文案（i18n 与 DOM 由宿主渲染，服务层保持纯逻辑） */
  private blockPlaceholderText(kind: BlockPlaceholderKind, d: PlaceholderDetail): string {
    if (kind === 'legacy') {
      const id = d.legacy?.pluginId ?? ''
      const sample = d.legacy?.type ? `\`\`\`hl ${id}:${d.legacy.type}` : `\`\`\`hl ${id}`
      return t('blocks.placeholderLegacy', { sample })
    }
    if (kind === 'needType') {
      return t('blocks.placeholderNeedType', {
        pluginId: d.pluginId ?? '',
        types: (d.types ?? []).join(' / '),
      })
    }
    if (kind === 'badInfo') {
      return d.reason === 'nolocate' ? t('blocks.placeholderNolocate') : t('blocks.placeholderBadInfo')
    }
    if (kind === 'empty') return t('blocks.placeholderEmpty')
    return t('blocks.placeholderNotRunning', { pluginId: d.pluginId ?? '' })
  }

  /** badInfo 降级：把块原文按代码样式显示出来，不吞内容 */
  private renderRawSource(el: HTMLElement, source: string): void {
    const pre = el.createEl('pre', { cls: 'dsh-block-raw' })
    pre.createEl('code', { text: source })
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
    // 刷新已知插件 id（块 target 解析：真实 id 优先于别名，含未授权/未运行的插件）
    this.knownPluginIds = new Set(ids.map((id) => id.trim().toLowerCase()))
    for (const id of ids) {
      const rec = this.ctx.pluginRuntime.inspect(id)
      const manifest = rec.manifest
      if (!manifest) continue
      if (!this.ctx.approval.isGranted(id, manifest.version)) continue
      // 用户显式停用的插件不自动加载（开关状态持久化）
      if (this.settings.pluginEnabled[id] === false) continue
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
