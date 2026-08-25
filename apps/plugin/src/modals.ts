/**
 * 原生审批弹窗：插件运行授权（单勾/双勾）与写操作审批。
 */

import { App, Modal, Setting, TextComponent } from 'obsidian'
import * as path from 'path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset } from './settings'
import type { GrantMode } from '@harness-like/harness-base'
import { isValidBlockAlias, normalizeBlockLang, BLOCK_LANG_PREFIX, BlockService } from './block-service'
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


/** 智能体编辑弹窗（创建/编辑通用）：名称/描述/能力勾选（checkbox）/自定义 persona（仅自定义智能体）。
 * 基础模式不再在弹窗内选择——由「以此为模板创建」继承模板模式，从零新建固定为修编（能力白名单才是工具控制面）。 */
export class AgentEditModal extends Modal {
  private name: string
  private description: string
  private caps: Set<string>
  private keyword = ''
  /** 自定义 persona 草稿（英文撰写；空 = 不遮蔽内置 md） */
  private systemPrompt = ''

  constructor(
    app: App,
    private agent: AgentPreset,
    private tools: string[],
    private onSave: (draft: AgentPreset) => void,
  ) {
    super(app)
    this.name = agent.name
    this.description = agent.description ?? ''
    this.caps = new Set(agent.capabilities ?? [])
    this.systemPrompt = agent.systemPrompt ?? ''
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

    // 自定义 persona（仅自定义智能体；内置 persona 由 src/agents/*.md 承载，fork 时复制进来）。
    // 标题行 + 全宽多行输入（不放 Setting 右侧——长文本编辑需要整行宽度）
    if (this.agent.id.startsWith('agent-')) {
      new Setting(contentEl)
        .setName(t('modal.agentEdit.persona'))
        .setDesc(t('modal.agentEdit.personaDesc'))
        .setHeading()
      const ta = contentEl.createEl('textarea', { cls: 'dsh-persona-input' })
      ta.value = this.systemPrompt
      ta.placeholder = t('modal.agentEdit.personaPlaceholder')
      ta.addEventListener('input', () => {
        this.systemPrompt = ta.value
      })
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText(t('common.save')).setCta().onClick(() => {
          const sp = this.systemPrompt.trim()
          this.onSave({
            ...this.agent,
            name: this.name.trim() || t('agent.unnamed'),
            description: this.description.trim() || undefined,
            capabilities: this.caps.size ? [...this.caps] : undefined,
            ...(sp ? { systemPrompt: sp } : {}),
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

/** 恢复一份备份（回退前自动备份当前状态，可撤销）；历史弹窗与插件详情共用 */
export async function restoreBackup(
  app: App,
  ctx: Context,
  pluginId: string,
  backupId: string,
  time: number,
  onChanged?: () => void,
): Promise<void> {
  const timeText = new Date(time).toLocaleString()
  const ok = await new ConfirmModal(
    app,
    t('pm.history.restoreConfirm', { time: timeText }),
    t('pm.history.restore'),
  ).ask()
  if (!ok) return
  const dir = path.join(ctx.sandbox.scope.pluginsDir, pluginId)
  await ctx.pluginBackups.snapshot(dir, pluginId, 'rollback')
  await ctx.pluginBackups.restore(dir, pluginId, backupId)
  const rec = ctx.pluginRuntime.inspect(pluginId)
  const manifest = rec.manifest
  if (manifest && ctx.approval.isGranted(pluginId, manifest.version)) {
    await ctx.pluginRuntime.stop(pluginId)
    const r = await ctx.pluginRuntime.load(pluginId)
    ctx.notice.notice(
      r.status === 'running'
        ? t('pm.history.restored', { time: timeText })
        : t('pm.reload.failed', { msg: r.error ?? 'unknown' }),
    )
  } else {
    ctx.notice.notice(
      manifest ? t('pm.history.restoreNoGrant') : t('pm.history.restored', { time: timeText }),
    )
  }
  onChanged?.()
}

/** 删除一份备份（带确认） */
export async function removeBackup(
  app: App,
  ctx: Context,
  pluginId: string,
  backupId: string,
  onChanged?: () => void,
): Promise<void> {
  const ok = await new ConfirmModal(app, t('pm.history.deleteConfirm'), t('common.delete')).ask()
  if (!ok) return
  await ctx.pluginBackups.remove(pluginId, backupId)
  onChanged?.()
}

/** 渲染备份列表（时间 + 版本徽章 + 恢复/删除）；历史弹窗与插件详情共用 */
export async function renderBackupList(
  container: HTMLElement,
  app: App,
  ctx: Context,
  pluginId: string,
  onChanged?: () => void,
): Promise<void> {
  const backups = await ctx.pluginBackups.list(pluginId)
  if (!backups.length) {
    container.createDiv({ cls: 'dsh-modal-empty', text: t('pm.history.empty') })
    return
  }
  const list = container.createDiv({ cls: 'dsh-modal-list dsh-modal-list-tall' })
  for (const b of backups) {
    const row = list.createDiv({ cls: 'dsh-pm-backup-row' })
    const info = row.createDiv({ cls: 'dsh-pm-backup-info' })
    const timeLine = info.createDiv({ cls: 'dsh-pm-backup-time' })
    timeLine.createSpan({ text: new Date(b.time).toLocaleString() })
    if (b.version) {
      timeLine.createSpan({ cls: 'dsh-pm-backup-version', text: t('pm.history.version', { v: b.version }) })
    }
    info.createDiv({
      cls: 'dsh-pm-backup-sub',
      text: `${t('pm.history.reason.' + b.reason)} · ${b.fileCount} ${t('pm.history.files')} · ${(b.bytes / 1024).toFixed(1)} KB`,
    })
    const btn = row.createEl('button', { cls: 'dsh-btn', text: t('pm.history.restore') })
    btn.onclick = () => void restoreBackup(app, ctx, pluginId, b.id, b.time, onChanged)
    const del = row.createEl('button', { cls: 'dsh-btn', text: '✕', attr: { title: t('pm.history.delete') } })
    del.onclick = () => void removeBackup(app, ctx, pluginId, b.id, onChanged)
  }
}

/** 该插件注册的命令（主插件前缀分组：harness-like:<pluginId>:） */
export function listPluginCommands(
  app: App,
  pluginId: string,
): Array<{ id: string; name: string }> {
  try {
    const all =
      (app as unknown as { commands?: { listCommands?(): Array<{ id: string; name: string }> } }).commands
        ?.listCommands?.() ?? []
    const prefix = `harness-like:${pluginId}:`
    return all.filter((c) => c.id.startsWith(prefix))
  } catch {
    return []
  }
}

/** 插件版本历史弹窗：列出备份，可恢复/删除（薄壳，渲染逻辑在 renderBackupList） */
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
    await renderBackupList(contentEl, this.app, this.ctx, this.pluginId, () => {
      this.onChanged?.()
      void this.render()
    })
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
    const live = await this.ctx.pluginRuntime.discover()
    const deleted = await this.ctx.pluginBackups.deletedPlugins(live)
    contentEl.createEl('h3', { text: t('pm.deleted') })
    if (!deleted.length) {
      contentEl.createDiv({ cls: 'dsh-modal-empty', text: t('pm.deleted.empty') })
      return
    }
    // 顶部工具行：清空全部（破坏性操作，需确认）
    const head = contentEl.createDiv({ cls: 'dsh-deleted-head' })
    head.createDiv({ cls: 'dsh-modal-empty dsh-deleted-hint', text: t('pm.deleted.hint') })
    const clearAll = head.createEl('button', { cls: 'dsh-btn dsh-btn-danger', text: t('pm.deleted.clearAll') })
    clearAll.onclick = () => void this.clearAll(deleted)
    const list = contentEl.createDiv({ cls: 'dsh-modal-list' })
    for (const id of deleted) {
      const row = list.createDiv({ cls: 'dsh-pm-backup-row' })
      const info = row.createDiv({ cls: 'dsh-pm-backup-info' })
      const backups = await this.ctx.pluginBackups.list(id)
      info.createDiv({ cls: 'dsh-pm-backup-time', text: id })
      info.createDiv({ cls: 'dsh-pm-backup-sub', text: t('pm.deleted.backupCount', { count: backups.length }) })
      const btn = row.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: t('pm.deleted.restore') })
      btn.onclick = () => void this.restoreLatest(id)
      const purge = row.createEl('button', { cls: 'dsh-btn dsh-btn-danger', text: t('pm.deleted.purge') })
      purge.onclick = () => void this.purge(id, backups.length)
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

  /** 永久删除单个已删除插件的全部备份（不可恢复，需确认） */
  private async purge(id: string, count: number): Promise<void> {
    const ok = await new ConfirmModal(
      this.app,
      t('pm.deleted.purgeConfirm', { id, count }),
      t('common.delete'),
    ).ask()
    if (!ok) return
    await this.ctx.pluginBackups.removeAll(id)
    this.ctx.notice.notice(t('pm.deleted.purged', { id }))
    void this.render()
  }

  /** 清空全部已删除插件的备份（不可恢复，需确认） */
  private async clearAll(ids: string[]): Promise<void> {
    const ok = await new ConfirmModal(
      this.app,
      t('pm.deleted.clearConfirm', { count: ids.length }),
      t('pm.deleted.clearAll'),
    ).ask()
    if (!ok) return
    for (const id of ids) await this.ctx.pluginBackups.removeAll(id)
    this.ctx.notice.notice(t('pm.deleted.cleared', { count: ids.length }))
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

/** 插件详情弹窗：基本信息 + 能力清单（可调用项带按钮）+ 历史版本 */
export class PluginDetailModal extends Modal {
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
    contentEl.createEl('h3', { text: t('pm.detail.title', { id: this.pluginId }) })
    const rec = this.ctx.pluginRuntime.get(this.pluginId) ?? this.ctx.pluginRuntime.inspect(this.pluginId)
    const manifest = rec.manifest
    if (manifest) {
      new Setting(contentEl)
        .setName(`${manifest.name ?? this.pluginId} · v${manifest.version}`)
        .setDesc(manifest.description ?? '')
      const statusLabel =
        rec.status === 'running'
          ? t('pm.status.running')
          : rec.status === 'stopped'
            ? t('pm.status.stopped')
            : rec.status === 'error'
              ? t('pm.status.error')
              : rec.status
      new Setting(contentEl).setName(t('pm.detail.status')).setDesc(statusLabel)
    }
    // 扩展能力
    contentEl.createEl('h4', { cls: 'dsh-pm-section', text: t('pm.detail.capsTitle') })
    const caps = rec.capabilities ?? []
    const LABELS: Record<string, string> = {
      panel: t('pm.cap.panel'),
      ribbon: t('pm.cap.ribbon'),
      commands: t('pm.cap.commands'),
      tools: t('pm.cap.tools'),
      statusbar: t('pm.cap.statusbar'),
      settings: t('pm.cap.settings'),
      block: t('pm.cap.block'),
    }
    const capRow = contentEl.createDiv({ cls: 'dsh-pm-caps' })
    if (caps.length) {
      for (const c of caps) capRow.createSpan({ cls: 'dsh-pm-cap', text: LABELS[c] ?? c })
    } else {
      capRow.createSpan({ cls: 'dsh-pm-cap', text: t('pm.detail.noCaps') })
    }
    // 块语言名（ctx.blocks 注册项：展示 + 改名，别名收归宿主统一校验唯一性；
    // renamed 为旧名历史提示，笔记占位符已说明，不在改名列表重复出现）
    const blockSvc = this.ctx.blocks as unknown as BlockService
    const blocks =
      typeof blockSvc.list === 'function'
        ? blockSvc.list().filter((b) => b.pluginId === this.pluginId && b.status !== 'renamed')
        : []
    if (blocks.length) {
      contentEl.createEl('h4', { cls: 'dsh-pm-section', text: t('pm.detail.blocksTitle') })
      contentEl.createDiv({ cls: 'setting-item-description', text: t('pm.detail.blockHint') })
      const list = contentEl.createDiv({ cls: 'dsh-block-list' })
      for (const b of blocks) {
        const row = list.createDiv({ cls: 'dsh-block-row' })
        const info = row.createDiv({ cls: 'dsh-pm-backup-info' })
        const nameEl = info.createDiv({ cls: 'dsh-pm-backup-time' })
        nameEl.createSpan({ text: b.type })
        if (b.status === 'conflict') {
          nameEl.createSpan({ cls: 'dsh-pm-cap', text: t('pm.detail.blockConflict') })
        }
        info.createDiv({ cls: 'dsh-pm-backup-sub', text: `\`\`\`${b.lang}` })
        const input = new TextComponent(row)
        input.inputEl.addClass('dsh-block-input')
        input.setValue(b.lang)
        const save = row.createEl('button', { cls: 'dsh-btn', text: t('pm.detail.blockRename') })
        save.onclick = () => {
          const v = input.getValue().trim()
          if (!isValidBlockAlias(v)) {
            this.ctx.notice.notice(t('blocks.invalid', { lang: v }))
            return
          }
          if (blockSvc.rename(this.pluginId, b.type, v)) {
            this.ctx.notice.notice(t('pm.detail.blockSaved', { type: b.type, lang: normalizeBlockLang(v) }))
            void this.render()
          }
        }
      }
    }
    // 操作（可调用能力，仅运行中）
    contentEl.createEl('h4', { cls: 'dsh-pm-section', text: t('pm.detail.actions') })
    if (rec.status === 'running') {
      const invoke = contentEl.createDiv({ cls: 'dsh-pm-detail-invoke' })
      if (rec.viewType) {
        const btn = invoke.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: t('pm.detail.openPanel') })
        btn.onclick = () => this.ctx.views.open(rec.viewType!)
      }
      if (caps.includes('commands')) {
        for (const c of listPluginCommands(this.app, this.pluginId)) {
          const b = invoke.createEl('button', { cls: 'dsh-btn', text: c.name })
          b.onclick = () => this.ctx.commands.execute(c.id)
        }
      }
    } else {
      contentEl.createDiv({ cls: 'dsh-modal-warning', text: t('pm.detail.notRunning') })
    }
    // 历史版本（恢复/删除）
    contentEl.createEl('h4', { cls: 'dsh-pm-section', text: t('pm.detail.history') })
    await renderBackupList(contentEl, this.app, this.ctx, this.pluginId, () => {
      this.onChanged?.()
      void this.render()
    })
  }

}
