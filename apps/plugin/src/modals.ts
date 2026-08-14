/**
 * 原生审批弹窗：插件运行授权（单勾/双勾）与写操作审批。
 */

import { App, Modal, Setting } from 'obsidian'
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
