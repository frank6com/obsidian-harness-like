/**
 * PluginManagerView：用户插件列表（发现/授权/加载/停止/卸载）。
 * 授权（单勾/双勾 grant）在加载执行前完成。
 */

import { ItemView, WorkspaceLeaf } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import { GrantModal } from '../modals'

export const PLUGIN_MANAGER_VIEW_TYPE = 'dsh-plugin-manager'

export interface PluginManagerOptions {
  /** 在系统文件管理器中打开目录（如插件目录） */
  openFolder(path: string): void
}

export class PluginManagerView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private ctx: Context,
    private options: PluginManagerOptions,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return PLUGIN_MANAGER_VIEW_TYPE
  }

  override getDisplayText(): string {
    return 'dsh 插件管理器'
  }

  override getIcon(): string {
    return 'puzzle'
  }

  override async onOpen(): Promise<void> {
    await this.refresh()
  }

  override onClose(): Promise<void> {
    return Promise.resolve()
  }

  private async refresh(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.createEl('h4', { text: '用户插件（.obsidian/dsh-plugins/）' })
    const bar = this.contentEl.createDiv({ cls: 'dsh-pm-bar' })
    const reload = bar.createEl('button', { cls: 'dsh-btn', text: '刷新' })
    reload.onclick = () => void this.refresh()
    const openDir = bar.createEl('button', { cls: 'dsh-btn', text: '打开插件目录' })
    openDir.onclick = () => this.options.openFolder(this.ctx.sandbox.scope.pluginsDir)

    const ids = await this.ctx.pluginRuntime.discover()
    if (!ids.length) {
      const empty = this.contentEl.createDiv({ cls: 'dsh-pm-empty' })
      empty.createEl('p', { text: '还没有用户插件。三步开始：' })
      const steps = empty.createEl('ol')
      steps.createEl('li', {
        text: '把插件目录复制到 .obsidian/dsh-plugins/<id>/（目录需含 package.json 与编译产物 main.js）',
      })
      steps.createEl('li', { text: '点上方"刷新"或"打开插件目录"确认文件就位' })
      steps.createEl('li', { text: '点"授权并加载"，选择信任范围（单勾=仅此版本 / 双勾=信任后续）' })
      empty.createEl('p', {
        cls: 'dsh-pm-hint',
        text: '内置示例：apps/plugin/examples/my-first-plugin/（仓库内，含预编译产物，可直接复制）',
      })
      return
    }

    for (const id of ids) {
      const rec = this.ctx.pluginRuntime.get(id) ?? this.ctx.pluginRuntime.inspect(id)
      const row = this.contentEl.createDiv({ cls: 'dsh-pm-row' })
      const info = row.createDiv({ cls: 'dsh-pm-info' })
      info.createDiv({
        cls: 'dsh-pm-name',
        text: `${id}${rec.manifest ? ` v${rec.manifest.version}` : ''}`,
      })
      info.createDiv({
        cls: `dsh-pm-status dsh-pm-status-${rec.status}`,
        text: rec.error ? `错误: ${rec.error}` : rec.status,
      })
      const actions = row.createDiv({ cls: 'dsh-pm-actions' })
      if (rec.status !== 'running') {
        const run = actions.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: '授权并加载' })
        run.onclick = () => void this.ensureAndLoad(id)
      } else {
        const stop = actions.createEl('button', { cls: 'dsh-btn', text: '停止' })
        stop.onclick = () => {
          void this.ctx.pluginRuntime.stop(id)
          void this.refresh()
        }
        const unload = actions.createEl('button', { cls: 'dsh-btn', text: '卸载' })
        unload.onclick = () => {
          void this.ctx.pluginRuntime.unload(id)
          void this.refresh()
        }
      }
    }
  }

  private async ensureAndLoad(id: string): Promise<void> {
    const rec = this.ctx.pluginRuntime.inspect(id)
    const manifest = rec.manifest
    if (!manifest) {
      this.ctx.notice.notice(`无法读取插件清单: ${rec.error ?? id}`)
      return
    }
    if (!this.ctx.approval.isGranted(id, manifest.version)) {
      const choice = await new GrantModal(this.app, {
        id,
        version: manifest.version,
        description: manifest.description,
      }).ask()
      if ('cancel' in choice) return
      this.ctx.approval.grant(id, choice.mode, manifest.version)
    }
    const result = await this.ctx.pluginRuntime.load(id)
    this.ctx.notice.notice(
      result.status === 'running'
        ? `插件已加载: ${id}`
        : `插件加载失败: ${result.error ?? '未知错误'}`,
    )
    await this.refresh()
  }
}
