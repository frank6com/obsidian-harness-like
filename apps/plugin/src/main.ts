/**
 * dsh-obsidian 主入口。
 *
 * onload：启动 Cordis 运行时（obsidian-adapter + harness-base + plugin-runtime），
 * 注册内置工具、视图、命令、设置页，加载已授权用户插件。
 * onunload：逆序 dispose 全部 fiber（Cordis 保证副作用可逆撤销）。
 */

import * as path from 'path'
import { Plugin, type Editor, type WorkspaceLeaf } from 'obsidian'
import * as cordis from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { harnessServicesPlugin, type WriteDecision } from '@dsh-obsidian/harness-base'
import { obsidianAdapterPlugin } from '@dsh-obsidian/obsidian-adapter'
import { runtimePlugin } from '@dsh-obsidian/plugin-runtime'
import { toApiLike } from './obsidian-bridge'
import { DEFAULT_SETTINGS, type DshSettings } from './settings'
import { DshSettingsTab } from './settings-tab'
import { WriteApprovalModal } from './modals'
import { builtinToolsPlugin } from './tools/builtin'
import { ChatView, CHAT_VIEW_TYPE } from './views/ChatView'
import { PluginManagerView, PLUGIN_MANAGER_VIEW_TYPE } from './views/PluginManagerView'

/** esbuild bundle 内可见的宿主 require（解析 node 内置模块 / obsidian） */
declare function require(id: string): unknown

const cordisShim = (id: string): unknown => {
  if (id === '@deepseek-ai/cordis') return cordis
  return require(id)
}

export default class DshObsidianPlugin extends Plugin {
  override settings: DshSettings = { ...DEFAULT_SETTINGS }
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

    const apiLike = toApiLike(this.app)

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
          getLLMConfig: () => ({
            baseURL: this.settings.baseURL,
            apiKey: this.settings.apiKey,
            model: this.settings.model,
            temperature: this.settings.temperature,
            maxTokens: this.settings.maxTokens,
          }),
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

    // 写操作审批钩子（内置工具调用）
    const askWriteApproval = async (
      targetPath: string,
      meta?: { preview?: string },
    ): Promise<WriteDecision> => {
      const decision = ctx.approval.decideWrite(this.settings.approvalDefault)
      if (decision === 'allow') return 'allow'
      ctx.emit('dsh/waiting-approval', targetPath)
      const r = await new WriteApprovalModal(this.app, targetPath, meta).ask()
      if (r.choice === 'allow-session') ctx.approval.setSessionAllow(true)
      return r.choice === 'deny' ? 'deny' : 'allow'
    }
    this.fibers.push(
      ctx.plugin(builtinToolsPlugin({ askWriteApproval, openTarget: (t) => apiLike.openTarget(t) })),
    )

    // 视图与命令
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, ctx))
    this.registerView(PLUGIN_MANAGER_VIEW_TYPE, (leaf) => new PluginManagerView(leaf, ctx))
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
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) }
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
