/**
 * 原生审批弹窗：插件运行授权（单勾/双勾）与写操作审批。
 */

import { App, Modal, Setting } from 'obsidian'
import type { AgentMode, AgentPreset } from './settings'
import type { GrantMode } from '@dsh-obsidian/harness-base'

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
    titleEl.setText(`授权运行插件 ${this.info.id} v${this.info.version}`)

    // 索取权限的内容提示：明确说明插件将获得什么
    new Setting(contentEl).setName('该插件将获得以下本地权限')
    const scope = contentEl.createDiv({ cls: 'dsh-modal-scope' })
    scope.createEl('ul', {}, (ul) => {
      for (const item of [
        '读写 vault 内笔记（写入需经过审批）',
        '注册命令、工具与自定义面板',
        '读取当前打开的笔记与编辑器选区',
        '调用 Obsidian 通知',
      ]) {
        ul.createEl('li', { text: item })
      }
    })
    new Setting(contentEl)
      .setName('安全边界')
      .setDesc(
        '只执行本机 .obsidian/dsh-plugins/ 下的本地文件，不会下载或执行远程代码；' +
          (this.info.description ? `\n${this.info.description}` : ''),
      )
      .setClass('dsh-modal-warning')
    new Setting(contentEl).setName('选择信任范围（对齐 dsh 的单勾/双勾语义）')
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('信任此版本（单勾）')
        .setCta()
        .onClick(() => this.finish({ mode: 'version' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('信任所有版本（双勾）')
        .onClick(() => this.finish({ mode: 'all' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('取消')
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
    private okText = '确认',
  ) {
    super(app)
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText('确认操作')
    contentEl.createEl('p', { text: this.message })
    new Setting(contentEl).addButton((b) =>
      b.setButtonText('取消').onClick(() => this.finish(false)),
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
    titleEl.setText('写操作需要审批')
    new Setting(contentEl).setName('目标文件').setDesc(`\`${this.target}\``)
    if (this.meta?.preview) {
      new Setting(contentEl).setName('内容预览（前 200 字符）')
      contentEl.createEl('pre', {
        cls: 'dsh-modal-preview',
        text: this.meta.preview,
      })
    }
    new Setting(contentEl)
      .setName('影响范围')
      .setDesc('仅写入 vault 内的笔记/文件，不会修改 Obsidian 自身配置；"本会话允许写"不持久化。')
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('允许一次')
        .setCta()
        .onClick(() => this.finish({ choice: 'allow-once' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('本会话允许写')
        .onClick(() => this.finish({ choice: 'allow-session' })),
    )
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('拒绝')
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
    titleEl.setText(`选择要添加的模型（${this.models.length} 个候选）`)

    const search = contentEl.createEl('input', {
      cls: 'dsh-modal-search',
      attr: { placeholder: '搜索模型…（输入新模型名可直接添加为候选）' },
    })
    search.addEventListener('input', () => {
      this.keyword = search.value.trim().toLowerCase()
      this.renderList()
    })

    this.listEl = contentEl.createDiv({ cls: 'dsh-modal-list' })
    this.renderList()

    new Setting(contentEl)
      .addButton((b) => b.setButtonText('全选').onClick(() => {
        this.models.forEach((m) => this.picked.add(m))
        this.renderList()
      }))
      .addButton((b) => b.setButtonText('确认添加').setCta().onClick(() => this.finish()))
      .addButton((b) => b.setButtonText('取消').onClick(() => this.close()))
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
      row.createEl('span', { text: `＋ 添加自定义：${kw}` })
    }

    for (const m of visible) {
      const row = this.listEl.createDiv({ cls: 'dsh-check-row' })
      if (this.existing.includes(m)) {
        // 已添加：显示关联标记，不可重复勾选
        const cb = row.createEl('input', { type: 'checkbox' })
        cb.checked = true
        cb.disabled = true
        row.createEl('span', { text: m })
        row.createEl('span', { cls: 'dsh-check-added', text: '✓ 已添加' })
        continue
      }
      const cb = row.createEl('input', { type: 'checkbox' })
      cb.checked = this.picked.has(m)
      cb.onchange = () => {
        if (cb.checked) this.picked.add(m)
        else this.picked.delete(m)
      }
      row.createEl('span', { text: m })
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
    titleEl.setText(this.agent.id.startsWith('agent-') ? '添加自定义智能体' : '编辑智能体')

    new Setting(contentEl)
      .setName('名称')
      .addText((t) =>
        t.setValue(this.name).onChange((v) => {
          this.name = v
        }),
      )
    new Setting(contentEl)
      .setName('描述')
      .addText((t) =>
        t.setValue(this.description).onChange((v) => {
          this.description = v
        }),
      )
    new Setting(contentEl)
      .setName('基础模式')
      .setDesc('未勾选能力时按此模式过滤工具')
      .addDropdown((d) =>
        d
          .addOption('chat', '对话模式')
          .addOption('edit', '修编模式')
          .addOption('create', '创造模式')
          .setValue(this.mode)
          .onChange((v) => {
            this.mode = v as AgentMode
          }),
      )

    new Setting(contentEl).setName('可调用的能力').setDesc('勾选 = 白名单（仅这些工具可用）；不勾选任何项 = 按基础模式默认')
    const search = contentEl.createEl('input', {
      cls: 'dsh-modal-search',
      attr: { placeholder: '搜索能力…' },
    })
    search.addEventListener('input', () => {
      this.keyword = search.value.trim().toLowerCase()
      this.renderCaps()
    })
    this.capsEl = contentEl.createDiv({ cls: 'dsh-modal-list dsh-modal-list-tall' })
    this.renderCaps()

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText('保存').setCta().onClick(() => {
          this.onSave({
            ...this.agent,
            name: this.name.trim() || '未命名',
            description: this.description.trim() || undefined,
            mode: this.mode,
            capabilities: this.caps.size ? [...this.caps] : undefined,
          })
          this.finish()
        }),
      )
      .addButton((b) => b.setButtonText('取消').onClick(() => this.close()))
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
      row.createEl('span', { text: t })
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
