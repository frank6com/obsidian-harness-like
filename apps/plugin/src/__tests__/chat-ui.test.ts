// @vitest-environment jsdom

/**
 * ChatView UI 回归测试（jsdom）：0.28.32 四项修复——
 * 1) 默认模型设置（defaultModelId）在模型选择中生效（此前误读旧 defaultProviderId）；
 * 2) 思考块增量节流 + 收尾冲刷（长推理文本不卡顿、展开可见完整内容）；
 * 3) 底部状态条在 thinking 阶段不再显示"思考中"（由轮内思考卡覆盖）；
 * 4) 新会话按钮位于会话列表顶部（.dsh-list-head），不在头部操作区。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Obsidian DOM 扩展 polyfill（jsdom 没有 createDiv/createEl 等），与 chat-view-render.test.ts 一致
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
  proto.setAttr = function (this: HTMLElement, k: string, v: string) {
    this.setAttribute(k, v)
  }
}

import { ChatView } from '../views/ChatView'

const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o'] },
]

interface ChatViewInternals {
  contentEl: HTMLElement
  messagesEl: HTMLElement
  phaseEl: HTMLElement
  buildUi(): void
  defaultModelId(): string
  appendThinking(delta: string): void
  closeThinking(): void
  setPhase(phase: unknown): void
}

function makeView(opts?: { defaultModelId?: string; providers?: unknown[] }): ChatViewInternals {
  polyfillObsidianDom()
  const settings = new Map<string, unknown>([
    ['providers', opts?.providers ?? PROVIDERS],
    ['defaultModelId', opts?.defaultModelId ?? ''],
  ])
  const ctx = {
    settings: {
      get: (k: string, d: unknown) => (settings.has(k) ? settings.get(k) : d),
      set: () => {},
    },
    on: vi.fn(() => () => {}),
    sessionLog: { append: async () => {}, list: async () => [], read: async () => [], readMeta: async () => null, remove: async () => {} },
    toolsCompat: { list: () => [] },
    llmCaller: {},
    emit: vi.fn(),
    sandbox: { scope: { configDir: '.obsidian' } },
    notice: { notice: () => {} },
    vault: { read: async () => '' },
    workspace: { getActiveFile: () => null },
    get: () => undefined,
  }
  const view = new ChatView({} as never, ctx as never) as unknown as ChatViewInternals
  return view
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('默认模型设置生效（0.28.32 回归）', () => {
  it('defaultModelId 精确命中提供方与模型', () => {
    const view = makeView({ defaultModelId: 'deepseek/deepseek-reasoner' })
    expect(view.defaultModelId()).toBe('deepseek/deepseek-reasoner')
  })

  it('defaultModelId 的模型不在提供方列表时，回退该提供方第一个模型', () => {
    const view = makeView({ defaultModelId: 'openai/gpt-5' })
    expect(view.defaultModelId()).toBe('openai/gpt-4o')
  })

  it('defaultModelId 为空/非法时，回退第一个提供方的第一个模型', () => {
    const view = makeView({ defaultModelId: '' })
    expect(view.defaultModelId()).toBe('deepseek/deepseek-chat')
  })

  it('模型按钮标签显示配置的默认模型（此前误读旧 defaultProviderId 导致不生效）', () => {
    const view = makeView({ defaultModelId: 'deepseek/deepseek-reasoner' })
    view.buildUi()
    const btn = view.contentEl.querySelector('.dsh-model-btn') as HTMLButtonElement
    expect(btn.textContent).toContain('deepseek-reasoner')
    expect(btn.textContent).not.toContain('deepseek-chat')
  })
})

describe('思考块节流与收尾冲刷（0.28.32）', () => {
  it('推理增量节流：100ms 窗口内多次 delta 只批量刷新一次', () => {
    vi.useFakeTimers()
    const view = makeView()
    view.messagesEl = document.createElement('div')
    view.appendThinking('第一步')
    view.appendThinking('第二步')
    const body = view.messagesEl.querySelector('.dsh-thinking-body')
    expect(body).toBeTruthy()
    expect(body!.textContent).toBe('') // 节流窗口未到，不逐 delta 布局
    vi.advanceTimersByTime(100)
    expect(body!.textContent).toBe('第一步第二步')
  })

  it('收尾冲刷：未到节流窗口也写入完整文本并折叠（展开可见全部推理）', () => {
    vi.useFakeTimers()
    const view = makeView()
    view.messagesEl = document.createElement('div')
    view.appendThinking('推理内容')
    const details = view.messagesEl.querySelector('.dsh-thinking') as HTMLElement
    details.setAttribute('open', '')
    view.closeThinking()
    const body = view.messagesEl.querySelector('.dsh-thinking-body')
    expect(body!.textContent).toBe('推理内容')
    expect(details.hasAttribute('open')).toBe(false)
  })
})

describe('底部状态条（0.28.32）', () => {
  it('thinking 阶段底部不再显示"思考中"，但轮内思考卡仍创建', () => {
    const view = makeView()
    view.messagesEl = document.createElement('div')
    view.phaseEl = document.createElement('div')
    view.setPhase({ kind: 'thinking' })
    expect(view.phaseEl.textContent).toBe('')
    expect(view.messagesEl.querySelector('.dsh-thinking')).toBeTruthy()
  })

  it('tool 等阶段仍显示底部状态', () => {
    const view = makeView()
    view.messagesEl = document.createElement('div')
    view.phaseEl = document.createElement('div')
    view.setPhase({ kind: 'tool', name: 'read_note' })
    expect(view.phaseEl.textContent).not.toBe('')
  })
})

describe('新会话按钮位置（0.28.32）', () => {
  it('位于会话列表顶部 .dsh-list-head，头部操作区不再包含它', () => {
    const view = makeView()
    view.buildUi()
    const headBtn = view.contentEl.querySelector('.dsh-list-head .dsh-btn-new-session')
    expect(headBtn).toBeTruthy()
    const headerActions = view.contentEl.querySelector('.dsh-chat-actions')!
    expect(headerActions.querySelector('.dsh-btn-new-session')).toBeNull()
    // 头部操作区只剩插件管理器一个按钮
    expect(headerActions.querySelectorAll('button').length).toBe(1)
  })
})
