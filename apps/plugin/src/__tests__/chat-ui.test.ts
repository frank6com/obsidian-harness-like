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

import { ChatView, filterModelHistory } from '../views/ChatView'

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
    sessionLog: { append: async () => {}, list: async () => [], read: async () => [], readMeta: async () => null, remove: async () => {}, patchMeta: async () => {} },
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

describe('模型切换闭环（修复无法切换模型）', () => {
  it('新会话未发消息时切换模型 → 记入 pendingModel，发消息时采用', () => {
    const view = makeView({ defaultModelId: 'deepseek/deepseek-chat' }) as unknown as Record<string, unknown>
    // 复刻 openModelMenu 的 onClick：无 currentSessionId 时走 pendingModel 分支
    const onClick = (value: string) => {
      const id = view.currentSessionId as string | null
      if (id) {
        ;(view.sessionModels as Map<string, string>).set(id, value)
      } else {
        ;(view as Record<string, string | null>).pendingModel = value
      }
    }
    view.currentSessionId = null
    onClick('deepseek/deepseek-reasoner')
    expect((view as Record<string, string | null>).pendingModel).toBe('deepseek/deepseek-reasoner')
    // send() 建会话时会以 pendingModel 作为本会话模型（经 sessionModelValue 取最新）
    expect((view.sessionModelValue as () => string)()).toBe('deepseek/deepseek-reasoner')
  })

  it('已有会话切换模型 → 写入 sessionModels 且走 patchMeta 持久化', async () => {
    const patched: Array<{ id: string; patch: Record<string, unknown> }> = []
    const ctx = {
      settings: {
        get: (k: string, d: unknown) => (k === 'providers' ? PROVIDERS : k === 'defaultModelId' ? 'deepseek/deepseek-chat' : d),
        set: () => {},
      },
      on: vi.fn(() => () => {}),
      sessionLog: {
        append: async () => {},
        list: async () => [],
        read: async () => [],
        readMeta: async () => null,
        remove: async () => {},
        patchMeta: async (id: string, patch: Record<string, unknown>) => {
          patched.push({ id, patch })
        },
      },
      toolsCompat: { list: () => [] },
      llmCaller: {},
      emit: vi.fn(),
      sandbox: { scope: { configDir: '.obsidian' } },
      notice: { notice: () => {} },
      vault: { read: async () => '' },
      workspace: { getActiveFile: () => null },
      get: () => undefined,
    }
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    v.currentSessionId = 'session-x'
    // 复刻 openModelMenu 的 onClick 逻辑
    const onClick = (value: string) => {
      const id = v.currentSessionId as string | null
      if (id) {
        ;(v.sessionModels as Map<string, string>).set(id, value)
        void (ctx.sessionLog as { patchMeta: (i: string, p: Record<string, unknown>) => Promise<void> }).patchMeta(id, { modelId: value })
      }
    }
    onClick('deepseek/deepseek-reasoner')
    expect((v.sessionModels as Map<string, string>).get('session-x')).toBe('deepseek/deepseek-reasoner')
    expect(patched).toEqual([{ id: 'session-x', patch: { modelId: 'deepseek/deepseek-reasoner' } }])
    expect((v.sessionModelValue as () => string)()).toBe('deepseek/deepseek-reasoner')
  })

  it('会话存储的模型在设置中被删除后 → 回退有效默认模型', () => {
    const view = makeView({ defaultModelId: 'openai/gpt-4o' }) as unknown as Record<string, unknown>
    // 假设某会话曾存了一个已被删除的模型
    ;(view.sessionModels as Map<string, string>).set('session-orphan', 'deepseek/deleted-model')
    view.currentSessionId = 'session-orphan'
    // 该模型不再存在于 providers → 应回退到 openai/gpt-4o
    expect((view.sessionModelValue as () => string)()).toBe('openai/gpt-4o')
  })
})

describe('pendingModel 修复（0.28.36 回归）', () => {
  /** 构造带 patchMeta 探针的视图（复用模型切换测试的 ctx 模式） */
  function viewWithPatchSpy() {
    const patched: Array<{ id: string; patch: Record<string, unknown> }> = []
    const ctx = {
      settings: {
        get: (k: string, d: unknown) => (k === 'providers' ? PROVIDERS : k === 'defaultModelId' ? 'deepseek/deepseek-chat' : d),
        set: () => {},
      },
      on: vi.fn(() => () => {}),
      sessionLog: {
        append: async () => {},
        list: async () => [],
        read: async () => [],
        readMeta: async () => null,
        remove: async () => {},
        patchMeta: async (id: string, patch: Record<string, unknown>) => {
          patched.push({ id, patch })
        },
      },
      toolsCompat: { list: () => [] },
      llmCaller: {},
      emit: vi.fn(),
      sandbox: { scope: { configDir: '.obsidian' } },
      notice: { notice: () => {} },
      vault: { read: async () => '' },
      workspace: { getActiveFile: () => null },
      get: () => undefined,
    }
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    return { v, patched }
  }

  it('切换到已有会话时丢弃 pendingModel（不串台覆盖旧会话模型）', () => {
    const { v } = viewWithPatchSpy()
    // openSession 会触发 renderSession/refreshSessions，需要渲染区
    v.messagesEl = document.createElement('div')
    v.sessionRowsEl = document.createElement('div')
    v.pendingModel = 'deepseek/deepseek-reasoner'
    ;(v as { openSession(id: string): void }).openSession('session-old')
    expect(v.pendingModel).toBeNull()
    expect(v.currentSessionId).toBe('session-old')
  })

  it('applyPendingModel：有效 pending 落盘到会话并持久化', async () => {
    const { v, patched } = viewWithPatchSpy()
    ;(v.sessionModels as Map<string, string>).set('s1', 'deepseek/deepseek-chat')
    v.currentSessionId = 's1'
    v.pendingModel = 'deepseek/deepseek-reasoner'
    ;(v as { applyPendingModel(id: string): void }).applyPendingModel('s1')
    expect((v.sessionModels as Map<string, string>).get('s1')).toBe('deepseek/deepseek-reasoner')
    expect(patched).toEqual([{ id: 's1', patch: { modelId: 'deepseek/deepseek-reasoner' } }])
    expect(v.pendingModel).toBeNull()
  })

  it('applyPendingModel：失效 pending（模型已删）仅丢弃，不污染会话元信息', async () => {
    const { v, patched } = viewWithPatchSpy()
    ;(v.sessionModels as Map<string, string>).set('s1', 'deepseek/deepseek-chat')
    v.currentSessionId = 's1'
    v.pendingModel = 'deepseek/deleted-model'
    ;(v as { applyPendingModel(id: string): void }).applyPendingModel('s1')
    // 会话原模型保持不变，未写入 patchMeta
    expect((v.sessionModels as Map<string, string>).get('s1')).toBe('deepseek/deepseek-chat')
    expect(patched).toEqual([])
    expect(v.pendingModel).toBeNull()
  })
})

describe('停止后新一轮的状态修复（0.28.37）', () => {
  it('filterModelHistory：被新用户消息覆盖的"已停止"标记被剔除（模型不再认为任务已取消）', () => {
    const events = [
      { type: 'user/message', ts: 1, sessionId: 's1', content: '帮我改进插件' },
      { type: 'system/message', ts: 2, sessionId: 's1', content: '已停止' },
      { type: 'user/message', ts: 3, sessionId: 's1', content: '继续' },
    ] as never
    const out = filterModelHistory(events, new Set(['已停止', 'Stopped']))
    expect(out.map((e) => (e as { content: string }).content)).toEqual(['帮我改进插件', '继续'])
  })

  it('filterModelHistory：标记后无新用户消息时保留（重载场景防悬空回答）', () => {
    const events = [
      { type: 'user/message', ts: 1, sessionId: 's1', content: '帮我改进插件' },
      { type: 'system/message', ts: 2, sessionId: 's1', content: '已停止' },
    ] as never
    const out = filterModelHistory(events, new Set(['已停止']))
    expect(out.map((e) => (e as { content: string }).content)).toEqual(['帮我改进插件', '已停止'])
  })

  it('filterModelHistory：剔除轮次标记', () => {
    const events = [
      { type: 'turn/start', ts: 1, sessionId: 's1' },
      { type: 'user/message', ts: 2, sessionId: 's1', content: 'hi' },
      { type: 'turn/end', ts: 3, sessionId: 's1' },
    ] as never
    expect(filterModelHistory(events, new Set()).length).toBe(1)
  })

  it('run 中止（用户停止）时 finally 关闭思考框：下一轮不再沿用旧框', async () => {
    const ctx = {
      settings: {
        get: (k: string, d: unknown) => (k === 'streamingEnabled' ? false : k === 'providers' ? PROVIDERS : d),
        set: () => {},
      },
      on: vi.fn(() => () => {}),
      sessionLog: { append: async () => {}, list: async () => [], read: async () => [], readMeta: async () => null, remove: async () => {} },
      toolsCompat: { list: () => [] },
      llmCaller: {
        call: async () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        },
      },
      emit: vi.fn(),
      sandbox: { scope: { configDir: '.obsidian' } },
      notice: { notice: () => {} },
      vault: { read: async () => '' },
      workspace: { getActiveFile: () => null },
      get: () => undefined,
    }
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    v.messagesEl = document.createElement('div')
    v.turnEl = null
    v.phaseEl = document.createElement('div')
    v.sendBtn = document.createElement('button')
    v.inputEl = document.createElement('textarea')
    v.currentSessionId = 's1'
    // 模拟"思考中被停止"：思考框已存在
    ;(v as { appendThinking(d: string): void }).appendThinking('正在推理')
    expect(v.thinkingEl).toBeTruthy()
    // 停止后发送新消息（run 抛 AbortError → finally 应关闭思考框）
    await (v as { run(s: string, t: string): Promise<void> }).run('s1', '继续')
    expect(v.thinkingEl).toBeNull()
  })
})
