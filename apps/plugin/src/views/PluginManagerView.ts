/**
 * PluginManagerView：用户插件列表（发现/授权/加载/停止/卸载）。
 * 授权（单勾/双勾 grant）在加载执行前完成。
 */

import { ItemView, WorkspaceLeaf } from 'obsidian'
import * as path from 'path'
import type { Context } from '@deepseek-ai/cordis'
import { ConfirmModal, DeletedPluginsModal, GrantModal, PluginHistoryModal } from '../modals'
import { grantDisplay } from '../settings'
import { getLanguage, resolveLanguage, setLanguage, t, type LanguagePreference } from '../i18n'

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
    return t('pm.viewTitle')
  }

  override getIcon(): string {
    return 'puzzle'
  }

  override async onOpen(): Promise<void> {
    this.disposers.push(
      this.ctx.on('dsh/settings-updated', () => {
        // 界面语言切换：整体重渲染（auto 模式跟随 Obsidian 语言）
        const pref = this.ctx.settings.get('uiLanguage', 'auto') as LanguagePreference
        const resolved = resolveLanguage(pref)
        if (resolved !== getLanguage()) {
          setLanguage(resolved)
          void this.refresh()
        }
      }),
    )
    await this.refresh()
  }

  override onClose(): Promise<void> {
    for (const d of this.disposers) {
      try {
        d()
      } catch {
        // 忽略卸载期异常
      }
    }
    this.disposers = []
    return Promise.resolve()
  }

  private disposers: Array<() => void> = []

  private async refresh(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.createEl('h4', { text: t('pm.heading') })
    const bar = this.contentEl.createDiv({ cls: 'dsh-pm-bar' })
    const reload = bar.createEl('button', { cls: 'dsh-btn', text: t('pm.refresh') })
    reload.onclick = () => void this.refresh()
    const openDir = bar.createEl('button', { cls: 'dsh-btn', text: t('pm.openDir') })
    openDir.onclick = () => this.options.openFolder(this.ctx.sandbox.scope.pluginsDir)
    const deleted = bar.createEl('button', { cls: 'dsh-btn', text: t('pm.deleted') })
    deleted.onclick = () => new DeletedPluginsModal(this.app, this.ctx, () => void this.refresh()).open()

    const ids = await this.ctx.pluginRuntime.discover()
    if (!ids.length) {
      const empty = this.contentEl.createDiv({ cls: 'dsh-pm-empty' })
      empty.createEl('p', { text: t('pm.empty.title') })
      const steps = empty.createEl('ol')
      steps.createEl('li', { text: t('pm.empty.step1') })
      steps.createEl('li', { text: t('pm.empty.step2') })
      steps.createEl('li', { text: t('pm.empty.step3') })
      empty.createEl('p', { cls: 'dsh-pm-hint', text: t('pm.empty.hint') })
      return
    }

    for (const id of ids) {
      const rec = this.ctx.pluginRuntime.get(id) ?? this.ctx.pluginRuntime.inspect(id)
      const grant = this.ctx.approval.getGrant(id)
      const row = this.contentEl.createDiv({ cls: 'dsh-pm-row' })
      const info = row.createDiv({ cls: 'dsh-pm-info' })
      info.createDiv({
        cls: 'dsh-pm-name',
        text: `${id}${rec.manifest ? ` v${rec.manifest.version}` : ''}`,
      })
      if (rec.manifest?.description) {
        info.createDiv({ cls: 'dsh-pm-desc', text: rec.manifest.description })
      }
      // 能力徽章（静态检测）
      const caps = rec.capabilities ?? []
      if (caps.length) {
        const capRow = info.createDiv({ cls: 'dsh-pm-caps' })
        const LABELS: Record<string, string> = {
          panel: t('pm.cap.panel'),
          ribbon: t('pm.cap.ribbon'),
          commands: t('pm.cap.commands'),
          tools: t('pm.cap.tools'),
          statusbar: t('pm.cap.statusbar'),
          settings: t('pm.cap.settings'),
        }
        for (const c of caps) {
          capRow.createSpan({ cls: 'dsh-pm-cap', text: LABELS[c] ?? c })
        }
      }
      const statusLabel: Record<string, string> = {
        running: t('pm.status.running'),
        stopped: t('pm.status.stopped'),
        error: t('pm.status.error'),
      }
      info.createDiv({
        cls: `dsh-pm-status dsh-pm-status-${rec.status}`,
        text: rec.error
          ? t('pm.status.errText', { msg: rec.error })
          : [
              statusLabel[rec.status] ?? rec.status,
              `· ${grantDisplay(grant, true, rec.manifest?.version).badge}`,
            ].join(' '),
      })
      const actions = row.createDiv({ cls: 'dsh-pm-actions' })
      if (rec.status === 'running') {
        if (rec.viewType) {
          const open = actions.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: t('pm.openPanel') })
          open.onclick = () => this.ctx.views.open(rec.viewType!)
        }
        const reload = actions.createEl('button', { cls: 'dsh-btn', text: t('pm.reload') })
        reload.onclick = () => void this.reload(id)
        const stop = actions.createEl('button', { cls: 'dsh-btn', text: t('pm.stop') })
        stop.onclick = () => {
          void this.ctx.pluginRuntime.stop(id)
          void this.refresh()
        }
      } else {
        const run = actions.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: t('pm.grantAndLoad') })
        run.onclick = () => void this.ensureAndLoad(id)
      }
      const history = actions.createEl('button', { cls: 'dsh-btn', text: t('pm.history') })
      history.onclick = () => new PluginHistoryModal(this.app, this.ctx, id, () => void this.refresh()).open()
      const remove = actions.createEl('button', { cls: 'dsh-btn', text: t('pm.delete') })
      remove.onclick = () => void this.removePlugin(id)
    }
  }

  /** 重新加载（文件型插件的"更新"：停止 → 重新加载当前目录产物） */
  private async reload(id: string): Promise<void> {
    await this.ctx.pluginRuntime.stop(id)
    const result = await this.ctx.pluginRuntime.load(id)
    this.ctx.notice.notice(
      result.status === 'running'
        ? t('pm.reload.done', { id })
        : t('pm.reload.failed', { msg: result.error ?? 'unknown' }),
    )
    await this.refresh()
  }

  /** 删除插件目录（破坏性操作，需确认；删除前自动备份，可恢复误删） */
  private async removePlugin(id: string): Promise<void> {
    const ok = await new ConfirmModal(
      this.app,
      t('pm.delete.confirm', { id }),
      t('common.delete'),
    ).ask()
    if (!ok) return
    await this.ctx.pluginBackups.snapshot(path.join(this.ctx.sandbox.scope.pluginsDir, id), id, 'delete')
    await this.ctx.pluginRuntime.removeDir(id)
    this.ctx.approval.revoke(id)
    this.ctx.notice.notice(t('pm.delete.done', { id }))
    await this.refresh()
  }

  private async ensureAndLoad(id: string): Promise<void> {
    const rec = this.ctx.pluginRuntime.inspect(id)
    const manifest = rec.manifest
    if (!manifest) {
      this.ctx.notice.notice(t('pm.manifest.failed', { msg: rec.error ?? id }))
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
        ? t('pm.load.done', { id })
        : t('pm.load.failed', { msg: result.error ?? 'unknown' }),
    )
    await this.refresh()
  }
}
