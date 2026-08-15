/**
 * obsidian 模块测试替身（vitest alias 指向此文件，替代真实 Obsidian API）。
 * 仅提供 ChatView 等视图渲染测试所需的最小表面。
 */

export class ItemView {
  app: unknown = {}
  contentEl = document.createElement('div')
  constructor(leaf: unknown) {
    void leaf
  }
  getState() {
    return {}
  }
}

/** 简化渲染：去掉 markdown 符号，模拟官方渲染器行为 */
export const MarkdownRenderer = {
  render: async (_app: unknown, markdown: string, el: HTMLElement) => {
    el.textContent = markdown.replace(/[*`#>]/g, '')
  },
}

export class Menu {
  addItem() {
    return this
  }
  addSeparator() {
    return this
  }
  showAtPosition() {}
  showAtMouseEvent() {}
}

export class Modal {
  contentEl = document.createElement('div')
  titleEl = document.createElement('div')
  open() {}
  close() {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName() { return this }
  setDesc() { return this }
  setHeading() { return this }
  setClass() { return this }
  addButton() { return this }
  addText() { return this }
  addTextArea() { return this }
  addToggle() { return this }
  addDropdown() { return this }
  addSlider() { return this }
}

export class WorkspaceLeaf {}
export class App {}
