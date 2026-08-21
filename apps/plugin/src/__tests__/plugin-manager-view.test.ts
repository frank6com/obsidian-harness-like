// @vitest-environment jsdom

/**
 * PluginManagerView 渲染测试（jsdom）：插件名后复制 ID 按钮（0.39.0）。
 * 复制的是插件 id 本身——agent 工具参数即 plugin_id，便于用户在对话中引用。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

function polyfillObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  if (proto.createDiv) return
  const make = (tag: string) =>
    function (this: HTMLElement, opts?: { cls?: string; text?: string }) {
      const el = document.createElement(tag)
      if (opts?.cls) el.className = opts.cls
      if (opts?.text) el.textContent = opts.text
      this.appendChild(el)
      return el
    }
  proto.createDiv = make('div')
  proto.createSpan = make('span')
  proto.createEl = function (this: HTMLElement, tag: string, opts?: { cls?: string; text?: string }) {
    const el = document.createElement(tag)
    if (opts?.cls) el.className = opts.cls
    if (opts?.text) el.textContent = opts.text
    this.appendChild(el)
    return el
  }
  proto.empty = function (this: HTMLElement) {
    this.innerHTML = ''
  }
  proto.setText = function (this: HTMLElement, t: string) {
    this.textContent = t
  }
}

import { PluginManagerView } from '../views/PluginManagerView'

function makeView(rec: Record<string, unknown>): PluginManagerView {
  polyfillObsidianDom()
  const ctx = {
    on: vi.fn(() => () => {}),
    pluginRuntime: {
      discover: async () => ['demo-plugin'],
      get: () => rec,
      inspect: () => rec,
    },
    approval: { getGrant: () => null },
    sandbox: { scope: { pluginsDir: '/tmp/plugins', configDir: '.obsidian' } },
    notice: { notice: () => {} },
    settings: { get: (_k: string, d: unknown) => d, set: () => {} },
    views: { open: () => {} },
    commands: { execute: () => {} },
  }
  return new PluginManagerView({} as never, ctx as never, { openFolder: () => {} })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('插件管理器：复制插件 ID 按钮（0.39.0）', () => {
  it('插件名后装配复制按钮，点击写入剪贴板并反馈 ✓', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = makeView({
      manifest: { version: '1.2.3', description: '示例' },
      status: 'stopped',
      capabilities: [],
      viewType: null,
      error: null,
    })
    await view.onOpen()
    const btn = view.contentEl.querySelector('.dsh-pm-copy-id') as HTMLButtonElement
    expect(btn).toBeTruthy()
    // 名称行含 id 与版本号文本
    const nameEl = view.contentEl.querySelector('.dsh-pm-name')!
    expect(nameEl.textContent).toContain('demo-plugin')
    expect(nameEl.textContent).toContain('v1.2.3')
    // 点击复制 id（非带版本号的显示文本）
    btn.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).toHaveBeenCalledWith('demo-plugin')
    expect(btn.textContent).toBe('✓')
  })
})
