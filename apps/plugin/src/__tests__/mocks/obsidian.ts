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

/** 简化渲染：去掉 markdown 符号，模拟官方渲染器行为。
 * 注意：真实 Obsidian 的 render 是【追加】语义（el - the element to append to），
 * 这里必须模拟追加，否则测不出"流式残留 + 渲染结果叠加"的真实问题。 */
export const MarkdownRenderer = {
  render: async (_app: unknown, markdown: string, el: HTMLElement) => {
    el.insertAdjacentHTML('beforeend', `<p>${markdown.replace(/[*`#>]/g, '')}</p>`)
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

/** PluginSettingTab 最小替身（真实 1.13 类型面已移除 display，运行时仍调用） */
export class PluginSettingTab {
  app = {} as never
  containerEl = document.createElement('div')
  display(): void {}
}
