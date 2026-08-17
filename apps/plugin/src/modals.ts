/**
 * 原生审批弹窗：插件运行授权（单勾/双勾）与写操作审批。
 */

import { App, Modal, Setting, TextComponent } from 'obsidian'
import * as path from 'path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentMode, AgentPreset } from './settings'
import type { GrantMode } from '@harness-like/harness-base'
import { t } from './i18n'

export type GrantChoice = { mode: GrantMode } | { cancel: true }

export class GrantModal extends Modal {
  private resolveFn: (v: GrantChoice) => void = () => {}
  private settled = false

  constructor(
    app: App,
    private info: { id: string; version: string; description?: string },
  ) {
    super(app)
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(t('modal.grant.title', { id: this.info.id, version: this.info.version }))

    // 索取权限的内容提示：明确说明插件将获得什么
    new Setting(contentEl).setName(t('modal.grant.permissions'))
    const scope = contentEl.createDiv({ cls: 'dsh-modal-scope' })
    scope.createEl('ul', {}, (ul) => {
      for (const item of [
        t('modal.grant.scope.1'),
        t('modal.grant.scope.2'),
        t('modal.grant.scope.3'),
        t('modal.grant.scope.4'),
      ]) {
        ul.createEl('li', { text: item })
      }
    })
    new Setting(contentEl)
      .setName(t('modal.grant.boundary'))
      .setDesc(
        t('modal.grant.boundaryDesc') + '；' +
          (this.info.description ? `\n${this.info.description}` : ''),
      )
      .setClass('dsh-modal-warning')
    new Setting(contentEl).setName(t('modal.grant.trustScope'))
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t('modal.grant.trustVersion'))
        .setCta()
        .onClick(() => this.finish({ mode: 'version' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t('modal.grant.trustAll'))
        .onClick(() => this.finish({ mode: 'all' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t('common.cancel'))
        .setWarning()
        .onClick(() => this.finish({ cancel: true })),
    )
  }

  override onClose(): void {
    this.finish({ cancel: true })
  }

  /** 打开并等待用户选择 */
  ask(): Promise<GrantChoice> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(v: GrantChoice): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn(v)
    this.close()
  }
}

export type WriteChoice = { choice: 'allow-once' | 'allow-session' | 'deny' }

/** 通用确认弹窗（删除会话/删除插件等破坏性操作） */
export class ConfirmModal extends Modal {
  private resolveFn: (v: boolean) => void = () => {}
  private settled = false

  constructor(
    app: App,
    private message: string,
    private okText = t('common.confirm'),
  ) {
    super(app)
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(t('modal.confirm.title'))
    contentEl.createEl('p', { text: this.message })
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(t('common.cancel')).onClick(() => this.finish(false)),
    )
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(this.okText).setWarning().onClick(() => this.finish(true)),
    )
  }

  override onClose(): void {
    this.finish(false)
  }

  ask(): Promise<boolean> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(v: boolean): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn(v)
    this.close()
  }
}

export class WriteApprovalModal extends Modal {
  private resolveFn: (v: WriteChoice) => void = () => {}
  private settled = false

  constructor(
    app: App,
    private target: string,
    private meta?: { preview?: string },
  ) {
    super(app)
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(t('modal.write.title'))
    new Setting(contentEl).setName(t('modal.write.target')).setDesc(`\`${this.target}\``)
    if (this.meta?.preview) {
      new Setting(contentEl).setName(t('modal.write.preview'))
      contentEl.createEl('pre', {
        cls: 'dsh-modal-preview',
        text: this.meta.preview,
      })
    }
    new Setting(contentEl)
      .setName(t('modal.write.scope'))
      .setDesc(t('modal.write.scopeDesc'))
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t('modal.write.allowOnce'))
        .setCta()
        .onClick(() => this.finish({ choice: 'allow-once' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t('modal.write.allowSession'))
        .onClick(() => this.finish({ choice: 'allow-session' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(t('modal.write.deny'))
        .setWarning()
        .onClick(() => this.finish({ choice: 'deny' })),
    )
  }

  override onClose(): void {
    this.finish({ choice: 'deny' })
  }

  ask(): Promise<WriteChoice> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(v: WriteChoice): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn(v)
    this.close()
  }
}


/** 模型勾选弹窗：从端点获取的候选模型中勾选确认后加入列表 */
export class ModelPickModal extends Modal {
  private picked = new Set<string>()

  constructor(
    app: App,
    private models: string[],
    private existing: string[],
  ) {
    super(app)
  }

  private keyword = ''

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(t('modal.modelPick.title', { count: this.models.length }))

    const search = contentEl.createEl('input', {
      cls: 'dsh-modal-search',
      attr: { placeholder: t('modal.modelPick.search') },
    })
    search.addEventListener('input', () => {
      this.keyword = search.value.trim().toLowerCase()
      this.renderList()
    })

    this.listEl = contentEl.createDiv({ cls: 'dsh-modal-list' })
    this.renderList()

    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t('modal.modelPick.selectAll')).onClick(() => {
        this.models.forEach((m) => this.picked.add(m))
        this.renderList()
      }))
      .addButton((b) => b.setButtonText(t('modal.modelPick.confirm')).setCta().onClick(() => this.finish()))
      .addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
  }

  private listEl!: HTMLElement

  private renderList(): void {
    this.listEl.empty()
    const visible = this.keyword
      ? this.models.filter((m) => m.toLowerCase().includes(this.keyword))
      : this.models

    // 搜索输入可手动添加为新候选（不在候选列表、不在已添加列表）
    const kw = this.keyword
    if (kw && !this.models.some((m) => m.toLowerCase() === kw) && !this.existing.includes(kw)) {
      const row = this.listEl.createDiv({ cls: 'dsh-check-row dsh-check-custom' })
      const cb = row.createEl('input', { type: 'checkbox' })
      cb.checked = this.picked.has(kw)
      cb.onchange = () => {
        if (cb.checked) this.picked.add(kw)
        else this.picked.delete(kw)
      }
      row.createSpan({ text: t('modal.modelPick.custom', { name: kw }) })
    }

    for (const m of visible) {
      const row = this.listEl.createDiv({ cls: 'dsh-check-row' })
      if (this.existing.includes(m)) {
        // 已添加：显示关联标记，不可重复勾选
        const cb = row.createEl('input', { type: 'checkbox' })
        cb.checked = true
        cb.disabled = true
        row.createSpan({ text: m })
        row.createSpan({ cls: 'dsh-check-added', text: t('modal.modelPick.addedMark') })
        continue
      }
      const cb = row.createEl('input', { type: 'checkbox' })
      cb.checked = this.picked.has(m)
      cb.onchange = () => {
        if (cb.checked) this.picked.add(m)
        else this.picked.delete(m)
      }
      row.createSpan({ text: m })
    }
  }

  override onClose(): void {
    this.resolve({ cancel: true })
  }

  private resolveFn: (v: { models: string[] } | { cancel: true }) => void = () => {}
  private settled = false

  ask(): Promise<{ models: string[] } | { cancel: true }> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn({ models: [...this.picked] })
    this.close()
  }

  private resolve(v: { models: string[] } | { cancel: true }): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn(v)
  }
}


/** 智能体编辑弹窗（创建/编辑通用）：名称/描述/基础模式/能力勾选（checkbox） */
export class AgentEditModal extends Modal {
  private name: string
  private description: string
  private mode: AgentMode
  private caps: Set<string>
  private keyword = ''

  constructor(
    app: App,
    private agent: AgentPreset,
    private tools: string[],
    private onSave: (draft: AgentPreset) => void,
  ) {
    super(app)
    this.name = agent.name
    this.description = agent.description ?? ''
    this.mode = agent.mode
    this.caps = new Set(agent.capabilities ?? [])
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(this.agent.id.startsWith('agent-') ? t('modal.agentEdit.add') : t('modal.agentEdit.edit'))

    new Setting(contentEl)
      .setName(t('modal.agentEdit.name'))
      .addText((t) =>
        t.setValue(this.name).onChange((v) => {
          this.name = v
        }),
      )
    new Setting(contentEl)
      .setName(t('modal.agentEdit.desc'))
      .addText((t) =>
        t.setValue(this.description).onChange((v) => {
          this.description = v
        }),
      )
    new Setting(contentEl)
      .setName(t('modal.agentEdit.mode'))
      .setDesc(t('modal.agentEdit.modeDesc'))
      .addDropdown((d) =>
        d
          .addOption('chat', t('agent.mode.chat'))
          .addOption('edit', t('agent.mode.edit'))
          .addOption('create', t('agent.mode.create'))
          .setValue(this.mode)
          .onChange((v) => {
            this.mode = v as AgentMode
          }),
      )

    new Setting(contentEl).setName(t('modal.agentEdit.caps')).setDesc(t('modal.agentEdit.capsDesc'))
    const search = contentEl.createEl('input', {
      cls: 'dsh-modal-search',
      attr: { placeholder: t('modal.agentEdit.search') },
    })
    search.addEventListener('input', () => {
      this.keyword = search.value.trim().toLowerCase()
      this.renderCaps()
    })
    this.capsEl = contentEl.createDiv({ cls: 'dsh-modal-list dsh-modal-list-tall' })
    this.renderCaps()

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(t('common.save')).setCta().onClick(() => {
          this.onSave({
            ...this.agent,
            name: this.name.trim() || t('agent.unnamed'),
            description: this.description.trim() || undefined,
            mode: this.mode,
            capabilities: this.caps.size ? [...this.caps] : undefined,
          })
          this.finish()
        }),
      )
      .addButton((b) => b.setButtonText(t('common.cancel')).onClick(() => this.close()))
  }

  private capsEl!: HTMLElement

  private renderCaps(): void {
    this.capsEl.empty()
    const visible = this.keyword
      ? this.tools.filter((t) => t.toLowerCase().includes(this.keyword))
      : this.tools
    for (const t of visible) {
      const row = this.capsEl.createDiv({ cls: 'dsh-check-row' })
      const cb = row.createEl('input', { type: 'checkbox' })
      cb.checked = this.caps.has(t)
      cb.onchange = () => {
        if (cb.checked) this.caps.add(t)
        else this.caps.delete(t)
      }
      row.createSpan({ text: t })
    }
  }

  override onClose(): void {
    this.finish()
  }

  private resolveFn: () => void = () => {}
  private settled = false

  ask(): Promise<void> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn()
    this.close()
  }
}

/** 插件版本历史弹窗：列出备份，可恢复（恢复前自动备份当前状态，可撤销） */
export class PluginHistoryModal extends Modal {
  constructor(
    app: App,
    private ctx: Context,
    private pluginId: string,
    private onChanged?: () => void,
  ) {
    super(app)
  }

  override onOpen(): void {
    void this.render()
  }

  override onClose(): void {
    this.contentEl.empty()
  }

  private async render(): Promise<void> {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h3', { text: t('pm.history.title', { id: this.pluginId }) })
    const backups = await this.ctx.pluginBackups.list(this.pluginId)
    if (!backups.length) {
      contentEl.createDiv({ cls: 'dsh-modal-empty', text: t('pm.history.empty') })
      return
    }
    const list = contentEl.createDiv({ cls: 'dsh-modal-list dsh-modal-list-tall' })
    for (const b of backups) {
      const row = list.createDiv({ cls: 'dsh-pm-backup-row' })
      const info = row.createDiv({ cls: 'dsh-pm-backup-info' })
      info.createDiv({ cls: 'dsh-pm-backup-time', text: new Date(b.time).toLocaleString() })
      info.createDiv({
        cls: 'dsh-pm-backup-sub',
        text: `${t('pm.history.reason.' + b.reason)} · ${b.fileCount} ${t('pm.history.files')} · ${(b.bytes / 1024).toFixed(1)} KB`,
      })
      const btn = row.createEl('button', { cls: 'dsh-btn', text: t('pm.history.restore') })
      btn.onclick = () => void this.restore(b.id, b.time)
    }
  }

  private async restore(backupId: string, time: number): Promise<void> {
    const timeText = new Date(time).toLocaleString()
    const ok = await new ConfirmModal(
      this.app,
      t('pm.history.restoreConfirm', { time: timeText }),
      t('pm.history.restore'),
    ).ask()
    if (!ok) return
    const dir = path.join(this.ctx.sandbox.scope.pluginsDir, this.pluginId)
    // 回退前先备份当前状态（回退可撤销）
    await this.ctx.pluginBackups.snapshot(dir, this.pluginId, 'rollback')
    await this.ctx.pluginBackups.restore(dir, this.pluginId, backupId)
    // 重新加载生效（授权仍在则直接加载；目录被删的插件仅还原文件）
    const rec = this.ctx.pluginRuntime.inspect(this.pluginId)
    const manifest = rec.manifest
    if (manifest && this.ctx.approval.isGranted(this.pluginId, manifest.version)) {
      await this.ctx.pluginRuntime.stop(this.pluginId)
      const r = await this.ctx.pluginRuntime.load(this.pluginId)
      this.ctx.notice.notice(
        r.status === 'running'
          ? t('pm.history.restored', { time: timeText })
          : t('pm.reload.failed', { msg: r.error ?? 'unknown' }),
      )
    } else {
      this.ctx.notice.notice(
        manifest ? t('pm.history.restoreNoGrant') : t('pm.history.restored', { time: timeText }),
      )
    }
    this.onChanged?.()
    void this.render()
  }
}

/** 已删除插件恢复弹窗：列出有备份但目录已不存在的插件，可恢复最新备份 */
export class DeletedPluginsModal extends Modal {
  constructor(app: App, private ctx: Context, private onChanged?: () => void) {
    super(app)
  }

  override onOpen(): void {
    void this.render()
  }

  override onClose(): void {
    this.contentEl.empty()
  }

  private async render(): Promise<void> {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h3', { text: t('pm.deleted') })
    const live = await this.ctx.pluginRuntime.discover()
    const deleted = await this.ctx.pluginBackups.deletedPlugins(live)
    if (!deleted.length) {
      contentEl.createDiv({ cls: 'dsh-modal-empty', text: t('pm.deleted.empty') })
      return
    }
    const list = contentEl.createDiv({ cls: 'dsh-modal-list' })
    for (const id of deleted) {
      const row = list.createDiv({ cls: 'dsh-pm-backup-row' })
      const info = row.createDiv({ cls: 'dsh-pm-backup-info' })
      const backups = await this.ctx.pluginBackups.list(id)
      info.createDiv({ cls: 'dsh-pm-backup-time', text: id })
      info.createDiv({ cls: 'dsh-pm-backup-sub', text: t('pm.deleted.backupCount', { count: backups.length }) })
      const btn = row.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: t('pm.deleted.restore') })
      btn.onclick = () => void this.restoreLatest(id)
    }
  }

  private async restoreLatest(id: string): Promise<void> {
    const latest = await this.ctx.pluginBackups.latest(id)
    if (!latest) return
    const dir = path.join(this.ctx.sandbox.scope.pluginsDir, id)
    await this.ctx.pluginBackups.restore(dir, id, latest.id)
    this.ctx.notice.notice(t('pm.deleted.restored', { id }))
    this.onChanged?.()
    void this.render()
  }
}

/** 会话重命名弹窗：预填当前标题，确认返回新标题（取消 / 空标题返回 null） */
export class SessionRenameModal extends Modal {
  private resolveFn: (v: string | null) => void = () => {}
  private settled = false
  private input!: TextComponent

  constructor(app: App, private currentTitle: string) {
    super(app)
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(t('chat.rename.title'))
    new Setting(contentEl).addText((text) => {
      this.input = text
      text.setValue(this.currentTitle)
      text.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          this.finish(this.input.getValue())
        }
      })
    })
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(t('common.cancel')).onClick(() => this.finish(null)),
    )
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(t('common.save')).setCta().onClick(() => this.finish(this.input.getValue())),
    )
  }

  override onClose(): void {
    this.finish(null)
  }

  ask(): Promise<string | null> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(v: string | null): void {
    if (this.settled) return
    this.settled = true
    const trimmed = typeof v === 'string' ? v.trim() : ''
    this.resolveFn(trimmed ? trimmed : null)
    this.close()
  }
}

/** 命令执行审批弹窗：展示命令与工作目录，用户逐次确认（命令行能力的安全底线） */
export class CommandApprovalModal extends Modal {
  private resolveFn: (v: boolean) => void = () => {}
  private settled = false

  constructor(app: App, private command: string, private cwd: string, private fullAccess: boolean) {
    super(app)
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(t('modal.command.title'))
    contentEl.createEl('p', { text: t('modal.command.ask') })
    contentEl.createEl('pre', { cls: 'dsh-command-preview', text: this.command })
    contentEl.createDiv({ cls: 'dsh-modal-scope', text: `${t('modal.command.cwd')} ${this.cwd}` })
    if (this.fullAccess) {
      contentEl.createDiv({ cls: 'dsh-modal-warning', text: t('modal.command.fullAccessNote') })
    }
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(t('modal.command.deny')).onClick(() => this.finish(false)),
    )
    new Setting(contentEl).addButton((b) =>
      b.setButtonText(t('modal.command.allow')).setWarning().onClick(() => this.finish(true)),
    )
  }

  override onClose(): void {
    this.finish(false)
  }

  ask(): Promise<boolean> {
    this.open()
    return new Promise((resolve) => {
      this.resolveFn = resolve
    })
  }

  private finish(v: boolean): void {
    if (this.settled) return
    this.settled = true
    this.resolveFn(v)
    this.close()
  }
}
