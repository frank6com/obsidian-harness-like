// @vitest-environment jsdom

/**
 * ChatView 渲染集成测试（jsdom）：验证多轮流式事件流下消息气泡数量与内容。
 * 目的：定位"同一消息出现两份/拼接"的渲染层问题——单事件应恰好渲染一个气泡。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Obsidian DOM 扩展 polyfill（jsdom 没有 createDiv/createEl 等）
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

// obsidian 由 vitest alias 指向 mocks/obsidian.ts（见 vitest.config.ts）


import { ChatView } from '../views/ChatView'

interface MockCtx {
  settings: { get: (k: string, d: unknown) => unknown; set: (k: string, v: unknown) => void }
  on: ReturnType<typeof vi.fn>
  sessionLog: { append: () => Promise<void>; list: () => Promise<never[]> }
  toolsCompat: { list: () => never[] }
  llmCaller: unknown
  emit: ReturnType<typeof vi.fn>
  sandbox: { scope: { configDir: string } }
}

function makeCtx(): MockCtx {
  return {
    settings: { get: (k: string) => (k === 'renderMarkdown' ? true : undefined), set: () => {} },
    on: vi.fn(() => () => {}),
    sessionLog: { append: async () => {}, list: async () => [] },
    toolsCompat: { list: () => [] },
    llmCaller: {},
    emit: vi.fn(),
    sandbox: { scope: { configDir: '.obsidian' } },
  }
}

interface ViewInternals {
  messagesEl: HTMLElement
  turnEl: HTMLElement | null
  streamingEl: HTMLElement | null
  streamingText: string
  turnText: string[]
  turnCopied: boolean
  lastAssistantRaw: string | null
  lastEventKey: string
  toolCards: Map<string, HTMLElement>
  currentSessionId: string | null
  ctx: unknown
}

async function makeView(): Promise<{ view: ViewInternals }> {
  polyfillObsidianDom()
  const ctx = makeCtx()
  const view = new ChatView({} as never, ctx as never) as unknown as ViewInternals
  // 手动初始化渲染区（绕过 onOpen 的完整装配）
  view.messagesEl = document.createElement('div')
  view.messagesEl.className = 'dsh-chat-messages'
  view.turnEl = null
  view.streamingEl = null
  view.streamingText = ''
  view.turnText = []
  view.turnCopied = false
  view.lastAssistantRaw = null
  view.lastEventKey = ''
  view.toolCards = new Map()
  view.currentSessionId = 's1'
  view.ctx = ctx as never
  return { view }
}

/** 模拟流式增量 */
function delta(view: ViewInternals, text: string): void {
  ;(view as unknown as { appendStream(d: string): void }).appendStream(text)
}

/** 模拟事件投递 */
function fire(view: ViewInternals, e: Record<string, unknown>): void {
  ;(view as unknown as { onSessionEvent(ev: unknown): void }).onSessionEvent(e)
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('ChatView 渲染（单事件 → 单气泡）', () => {
  it('流式 + assistant/message：恰好一个气泡，内容为最终内容', async () => {
    const { view } = await makeView()
    delta(view, '我来帮你创建')
    delta(view, '这个插件。')
    fire(view, { sessionId: 's1', type: 'assistant/message', ts: 1, content: '我来帮你创建这个插件。' })
    const bubbles = view.messagesEl.querySelectorAll('.dsh-msg-assistant')
    expect(bubbles.length).toBe(1)
    expect(bubbles[0]!.textContent).toBe('我来帮你创建这个插件。')
  })

  it('同一事件重复投递（监听器叠加模拟）：仍只有一个气泡', async () => {
    const { view } = await makeView()
    delta(view, '先看指南')
    fire(view, { sessionId: 's1', type: 'assistant/message', ts: 1, content: '先看指南' })
    fire(view, { sessionId: 's1', type: 'assistant/message', ts: 1, content: '先看指南' })
    const bubbles = view.messagesEl.querySelectorAll('.dsh-msg-assistant')
    expect(bubbles.length).toBe(1)
  })

  it('多轮（两条消息）：两个气泡，各自内容独立无拼接', async () => {
    const { view } = await makeView()
    delta(view, '第一轮内容')
    fire(view, { sessionId: 's1', type: 'assistant/message', ts: 1, content: '第一轮内容' })
    delta(view, '第二轮内容')
    fire(view, { sessionId: 's1', type: 'assistant/message', ts: 2, content: '第二轮内容' })
    const bubbles = view.messagesEl.querySelectorAll('.dsh-msg-assistant')
    expect(bubbles.length).toBe(2)
    expect(bubbles[0]!.textContent).toBe('第一轮内容')
    expect(bubbles[1]!.textContent).toBe('第二轮内容')
  })

  it('无流式（streamingEl 为 null）：事件直接生成一个气泡', async () => {
    const { view } = await makeView()
    fire(view, { sessionId: 's1', type: 'assistant/message', ts: 1, content: '直接回答' })
    const bubbles = view.messagesEl.querySelectorAll('.dsh-msg-assistant')
    expect(bubbles.length).toBe(1)
    expect(bubbles[0]!.textContent).toBe('直接回答')
  })
})
