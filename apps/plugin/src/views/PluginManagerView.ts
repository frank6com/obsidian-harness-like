/**
 * PluginManagerView：用户插件列表（发现/授权/加载/停止/卸载）。
 * 授权（单勾/双勾 grant）在加载执行前完成。
 */

import { ItemView, Menu, WorkspaceLeaf } from 'obsidian'
import * as path from 'path'
import type { Context } from '@deepseek-ai/cordis'
import type { PluginRecord, PluginStatus } from '@harness-like/plugin-runtime'
import { ConfirmModal, DeletedPluginsModal, GrantModal, PluginDetailModal, listPluginCommands } from '../modals'
import { autoRecoverLastGood } from '../plugin-backups'
import { grantDisplay } from '../settings'
import { getLanguage, resolveLanguage, setLanguage, t, type LanguagePreference } from '../i18n'

export const PLUGIN_MANAGER_VIEW_TYPE = 'dsh-plugin-manager'

/** 列表状态过滤：全部 / 运行中 / 已停止 / 错误（tab 分组） */
type StatusFilter = 'all' | PluginStatus

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

  /** 当前状态过滤 tab（重渲染间保留） */
  private filter: StatusFilter = 'all'

  private async refresh(): Promise<void> {
    this.contentEl.empty()
    this.contentEl.createEl('h4', { text: t('pm.heading') })
    // 工具栏：左侧状态过滤 tab，右侧 刷新 / 打开插件目录 / 已删除插件
    const toolbar = this.contentEl.createDiv({ cls: 'dsh-pm-toolbar' })
    const tabsEl = toolbar.createDiv({ cls: 'dsh-pm-tabs' })
    const tools = toolbar.createDiv({ cls: 'dsh-pm-tools' })
    const reload = tools.createEl('button', { cls: 'dsh-btn', text: t('pm.refresh') })
    reload.onclick = () => void this.refresh()
    const openDir = tools.createEl('button', { cls: 'dsh-btn', text: t('pm.openDir') })
    openDir.onclick = () => this.options.openFolder(this.ctx.sandbox.scope.pluginsDir)
    const deleted = tools.createEl('button', { cls: 'dsh-btn', text: t('pm.deleted') })
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

    // 状态分组：运行中 → 已停止 → 错误，组内按 id 字母序（目录顺序不稳定）
    const STATUS_ORDER: Record<string, number> = { running: 0, stopped: 1, error: 2 }
    const recs = ids
      .map((id) => this.ctx.pluginRuntime.get(id) ?? this.ctx.pluginRuntime.inspect(id))
      .sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99) || a.id.localeCompare(b.id),
      )

    // 状态 tab 分组过滤（带计数；重渲染间保留选中项）
    const TABS: Array<{ key: StatusFilter; label: string }> = [
      { key: 'all', label: t('pm.tab.all') },
      { key: 'running', label: t('pm.status.running') },
      { key: 'stopped', label: t('pm.status.stopped') },
      { key: 'error', label: t('pm.status.error') },
    ]
    for (const tab of TABS) {
      const count = tab.key === 'all' ? recs.length : recs.filter((r) => r.status === tab.key).length
      const tabBtn = tabsEl.createEl('button', {
        cls: `dsh-pm-tab${this.filter === tab.key ? ' is-active' : ''}`,
      })
      tabBtn.createSpan({ text: tab.label })
      tabBtn.createSpan({ cls: 'dsh-pm-tab-count', text: String(count) })
      tabBtn.onclick = () => {
        if (this.filter === tab.key) return
        this.filter = tab.key
        void this.refresh()
      }
    }

    const shown: PluginRecord[] =
      this.filter === 'all' ? recs : recs.filter((r) => r.status === this.filter)
    if (!shown.length) {
      this.contentEl.createDiv({ cls: 'dsh-pm-tab-empty', text: t('pm.tab.empty') })
      return
    }

    for (const rec of shown) {
      const id = rec.id
      const grant = this.ctx.approval.getGrant(id)
      const row = this.contentEl.createDiv({ cls: 'dsh-pm-row' })
      const info = row.createDiv({ cls: 'dsh-pm-info' })
      // 插件名 + 复制按钮：复制 id 便于在对话中引用（agent 工具参数即 plugin_id）
      const nameEl = info.createDiv({ cls: 'dsh-pm-name' })
      nameEl.createSpan({ text: `${id}${rec.manifest ? ` v${rec.manifest.version}` : ''}` })
      // 别名徽章：提示该插件在笔记里可用短写法 ```hl <别名>
      const alias = this.ctx.blockAliases?.get(id)
      if (alias) nameEl.createSpan({ cls: 'dsh-pm-alias', text: `·${alias}` })
      const copyId = nameEl.createEl('button', {
        cls: 'dsh-pm-copy-id',
        text: '⧉',
        attr: { title: t('pm.copyId') },
      })
      copyId.onclick = () => {
        void navigator.clipboard.writeText(id).then(() => {
          copyId.setText('✓')
          window.setTimeout(() => copyId.setText('⧉'), 1200)
        })
      }
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
          protocol: t('pm.cap.protocol'),
          block: t('pm.cap.block'),
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
      // 左侧高频操作组：打开面板 + 命令展开菜单（运行中才可用）
      if (rec.status === 'running') {
        const openGroup = row.createDiv({ cls: 'dsh-pm-open' })
        if (rec.viewType) {
          const open = openGroup.createEl('button', {
            cls: 'dsh-pm-action dsh-pm-action-open',
            text: '▤',
            attr: { title: t('pm.openPanel') },
          })
          open.onclick = () => this.ctx.views.open(rec.viewType!)
        }
        if (rec.capabilities?.includes('commands')) {
          const menuBtn = openGroup.createEl('button', {
            cls: 'dsh-pm-action dsh-pm-action-open',
            text: '▾',
            attr: { title: t('pm.detail.commandsTitle') },
          })
          menuBtn.onclick = (ev) => this.openCommandsMenu(ev, id)
        }
      }
      // 右侧固定辅助组：详情 → 运行控制 → 重载 → 删除
      const actions = row.createDiv({ cls: 'dsh-pm-actions' })
      const detail = actions.createEl('button', { cls: 'dsh-pm-action', text: 'ⓘ', attr: { title: t('pm.detail') } })
      detail.onclick = () => new PluginDetailModal(this.app, this.ctx, id, () => void this.refresh()).open()
      if (rec.status === 'running') {
        const stop = actions.createEl('button', { cls: 'dsh-pm-action is-stop', text: '■', attr: { title: t('pm.stop') } })
        stop.onclick = () => {
          void this.ctx.pluginRuntime.stop(id)
          // 停用状态持久化：重启后不再自动加载
          const enabled = { ...(this.ctx.settings.get('pluginEnabled', {}) as Record<string, boolean>) }
          enabled[id] = false
          this.ctx.settings.set('pluginEnabled', enabled)
          void this.refresh()
        }
        const reload = actions.createEl('button', { cls: 'dsh-pm-action', text: '↻', attr: { title: t('pm.reload') } })
        reload.onclick = () => void this.reload(id)
      } else {
        // 已授权但被停用 → 「启用」；未授权 → 「授权并加载」
        const run = actions.createEl('button', {
          cls: 'dsh-pm-action is-primary',
          text: '▶',
          attr: { title: grant ? t('pm.enable') : t('pm.grantAndLoad') },
        })
        run.onclick = () => void this.ensureAndLoad(id)
      }
      const remove = actions.createEl('button', { cls: 'dsh-pm-action is-danger', text: '✕', attr: { title: t('pm.delete') } })
      remove.onclick = () => void this.removePlugin(id)
    }
  }

  /** 重新加载（文件型插件的"更新"：停止 → 重新加载当前目录产物） */
  private async reload(id: string): Promise<void> {
    await this.ctx.pluginRuntime.stop(id)
    const result = await this.ctx.pluginRuntime.load(id)
    if (result.status === 'error') {
      // 加载失败自动回退到最近可用版本（备份阶梯）
      const rec = await autoRecoverLastGood(
        this.ctx.pluginBackups,
        this.ctx.pluginRuntime,
        this.ctx.sandbox.scope.pluginsDir,
        id,
      )
      if (rec.restored) {
        this.ctx.notice.notice(t('pm.reload.autoRecovered', { id }))
        await this.refresh()
        return
      }
    }
    this.ctx.notice.notice(
      result.status === 'running'
        ? t('pm.reload.done', { id })
        : t('pm.reload.failed', { msg: result.error ?? 'unknown' }),
    )
    await this.refresh()
  }

  /** 命令展开菜单：列出该插件注册的命令，点击即触发执行 */
  private openCommandsMenu(ev: MouseEvent, id: string): void {
    const menu = new Menu()
    const cmds = listPluginCommands(this.app, id)
    if (!cmds.length) {
      menu.addItem((mi) => mi.setTitle(t('pm.detail.noCommands')).setDisabled(true))
    } else {
      for (const c of cmds) {
        menu.addItem((mi) => mi.setTitle(c.name).onClick(() => this.ctx.commands.execute(c.id)))
      }
    }
    menu.showAtMouseEvent(ev)
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
    const enabled = { ...(this.ctx.settings.get('pluginEnabled', {}) as Record<string, boolean>) }
    delete enabled[id]
    this.ctx.settings.set('pluginEnabled', enabled)
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
    if (result.status === 'running') {
      // 启用状态持久化：重启后继续自动加载
      const enabled = { ...(this.ctx.settings.get('pluginEnabled', {}) as Record<string, boolean>) }
      enabled[id] = true
      this.ctx.settings.set('pluginEnabled', enabled)
    }
    this.ctx.notice.notice(
      result.status === 'running'
        ? t('pm.load.done', { id })
        : t('pm.load.failed', { msg: result.error ?? 'unknown' }),
    )
    await this.refresh()
  }
}
