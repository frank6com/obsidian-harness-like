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

import { ChatView, estimateTokens, filterModelHistory } from '../views/ChatView'

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
  // 装配最小会话列表容器：turn/end 等事件会异步触发 refreshSessions，
  // 无此容器时 doRefreshSessions 的 empty() 抛 undefined 异常（unhandled rejection）
  ;(view as { sessionRowsEl?: HTMLElement }).sessionRowsEl = document.createElement('div')
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

describe('会话列表前置 / 执行状态 / 思考快捷操作（0.30.0）', () => {
  /** 构造可捕获 on 处理器 + list 探针的 ctx */
  function ctxWithHandlers(listImpl?: () => Promise<unknown[]>) {
    const handlers: Record<string, (arg: unknown) => void> = {}
    return {
      ctx: {
        settings: {
          get: (k: string, d: unknown) => (k === 'providers' ? PROVIDERS : d),
          set: () => {},
        },
        on: (ev: string, cb: (arg: unknown) => void) => {
          handlers[ev] = cb
          return () => {}
        },
        sessionLog: {
          append: async () => {},
          list: listImpl ?? (async () => []),
          read: async () => [],
          readMeta: async () => null,
          remove: async () => {},
        },
        toolsCompat: { list: () => [] },
        llmCaller: {},
        emit: vi.fn(),
        sandbox: { scope: { configDir: '.obsidian' } },
        notice: { notice: () => {} },
        vault: { read: async () => '' },
        workspace: { getActiveFile: () => null },
        get: () => undefined,
      },
      handlers,
    }
  }

  it('其他会话的 turn/end 也触发列表刷新（有新进展的会话前置）', async () => {
    const listSpy = vi.fn(async () => [])
    const { ctx } = ctxWithHandlers(listSpy as never)
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    ;(v as { sessionRowsEl: HTMLElement }).sessionRowsEl = document.createElement('div')
    v.currentSessionId = 'current'
    await (v as { refreshSessions(): Promise<void> }).refreshSessions()
    listSpy.mockClear()
    // 非当前会话的 turn/end：不渲染，但必须刷新列表
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 'other',
      type: 'turn/end',
      ts: 1,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(listSpy).toHaveBeenCalled()
  })

  it('会话行显示"执行中"标记（含其他面板正在运行的会话）', async () => {
    const { ctx } = ctxWithHandlers(async () => [
      { id: 's1', updatedAt: 1, count: 1, title: 't1', notePath: null, modelId: undefined },
      { id: 's2', updatedAt: 2, count: 2, title: 't2', notePath: null, modelId: undefined },
    ] as never)
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    ;(v as { sessionRowsEl: HTMLElement }).sessionRowsEl = document.createElement('div')
    ;(v as { runningSessions: Set<string> }).runningSessions.add('s2')
    await (v as { refreshSessions(): Promise<void> }).refreshSessions()
    const rows = (v as { sessionRowsEl: HTMLElement }).sessionRowsEl.querySelectorAll('.dsh-session-row')
    expect(rows.length).toBe(2)
    expect(rows[1]!.querySelector('.dsh-session-running')).toBeTruthy()
    expect(rows[0]!.querySelector('.dsh-session-running')).toBeNull()
  })

  it('dsh/run/start 广播：列表自动刷新并显示执行中标记', async () => {
    const { ctx, handlers } = ctxWithHandlers(async () => [
      { id: 's1', updatedAt: 1, count: 1, title: 't', notePath: null, modelId: undefined },
    ] as never)
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    ;(v as { buildUi(): void }).buildUi()
    handlers['dsh/run/start']?.('s1')
    await new Promise((r) => setTimeout(r, 0))
    expect((v as { contentEl: HTMLElement }).contentEl.querySelector('.dsh-session-running')).toBeTruthy()
  })

  it('scrollToBottom：用户离开底部时不强制下拉；贴近底部时跟随；force 强制', () => {
    const v = makeView() as unknown as Record<string, unknown>
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    el.scrollTop = 500 // 用户正在向上阅读
    v.messagesEl = el
    ;(v as { scrollToBottom(f?: boolean): void }).scrollToBottom()
    expect(el.scrollTop).toBe(500) // 不被拽回底部
    ;(v as { scrollToBottom(f?: boolean): void }).scrollToBottom(true)
    expect(el.scrollTop).toBe(1000) // jsdom 不 clamp；真实浏览器为 scrollHeight-clientHeight
    el.scrollTop = 880 // 贴近底部（差 20 < 120）
    ;(v as { scrollToBottom(f?: boolean): void }).scrollToBottom()
    expect(el.scrollTop).toBe(1000)
  })

  it('思考卡提供"回到顶部 / 收起"快捷操作', () => {
    const v = makeView() as unknown as Record<string, unknown>
    ;(v as { messagesEl: HTMLElement }).messagesEl = document.createElement('div')
    ;(v as { openThinking(): void }).openThinking()
    const details = (v as { messagesEl: HTMLElement }).messagesEl.querySelector('.dsh-thinking') as HTMLElement
    const actions = details.querySelector('.dsh-thinking-actions')!
    expect(actions.querySelectorAll('button').length).toBe(2)
    details.setAttribute('open', '')
    const collapseBtn = actions.querySelectorAll('button')[1] as HTMLButtonElement
    collapseBtn.click()
    expect(details.hasAttribute('open')).toBe(false)
  })
})

describe('会话重命名（0.31.0）', () => {
  it('会话行悬浮操作包含重命名按钮（✎ / 导出 / 删除）', async () => {
    const ctx = {
      settings: { get: (k: string, d: unknown) => (k === 'providers' ? PROVIDERS : d), set: () => {} },
      on: vi.fn(() => () => {}),
      sessionLog: {
        append: async () => {},
        list: async () => [
          { id: 's1', updatedAt: 1, count: 1, title: 't1', notePath: null, modelId: undefined },
        ],
        read: async () => [],
        readMeta: async () => null,
        remove: async () => {},
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
    ;(v as { sessionRowsEl: HTMLElement }).sessionRowsEl = document.createElement('div')
    await (v as { refreshSessions(): Promise<void> }).refreshSessions()
    const actions = (v as { sessionRowsEl: HTMLElement }).sessionRowsEl.querySelector('.dsh-session-actions')!
    expect(actions.querySelectorAll('button').length).toBe(3)
  })
})

describe('插件文件自愈状态条（0.34.0）', () => {
  it('styles.css 缺失（failed 态）：对话面板显示状态条与重试按钮', () => {
    const ensure = vi.fn(async () => {})
    const ctx = {
      settings: { get: (k: string, d: unknown) => d, set: () => {} },
      on: vi.fn(() => () => {}),
      sessionLog: { append: async () => {}, list: async () => [], read: async () => [], readMeta: async () => null, remove: async () => {} },
      toolsCompat: { list: () => [] },
      llmCaller: {},
      emit: vi.fn(),
      sandbox: { scope: { configDir: '.obsidian' } },
      notice: { notice: () => {} },
      vault: { read: async () => '' },
      workspace: { getActiveFile: () => null },
      get: () => ({
        statusOf: () => ({ stylesMissing: true, phase: 'failed' }),
        ensure,
      }),
      openExternal: vi.fn(),
    }
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    ;(v as { buildUi(): void }).buildUi()
    const banner = (v as { contentEl: HTMLElement }).contentEl.querySelector('.dsh-files-banner') as HTMLElement
    expect(banner).toBeTruthy()
    // 遮罩层：filesBannerEl 内挂全屏蒙层（内联样式，不依赖 styles.css）
    const overlay = banner.querySelector(':scope > div') as HTMLElement
    expect(overlay.style.position).toBe('absolute')
    expect(overlay.style.display).toBe('flex')
    // 失败态：release 链接 / 打开目录 / 重试 三个按钮，点最后的重试
    const buttons = banner.querySelectorAll('button')
    expect(buttons.length).toBe(3)
    buttons[buttons.length - 1]!.click()
    expect(ensure).toHaveBeenCalled()
  })

  it('styles.css 完整（ok 态）：状态条隐藏', () => {
    const ctx = {
      settings: { get: (k: string, d: unknown) => d, set: () => {} },
      on: vi.fn(() => () => {}),
      sessionLog: { append: async () => {}, list: async () => [], read: async () => [], readMeta: async () => null, remove: async () => {} },
      toolsCompat: { list: () => [] },
      llmCaller: {},
      emit: vi.fn(),
      sandbox: { scope: { configDir: '.obsidian' } },
      notice: { notice: () => {} },
      vault: { read: async () => '' },
      workspace: { getActiveFile: () => null },
      get: () => ({ statusOf: () => ({ stylesMissing: false, phase: 'ok' }), ensure: async () => {} }),
    }
    polyfillObsidianDom()
    const v = new ChatView({} as never, ctx as never) as unknown as Record<string, unknown>
    ;(v as { buildUi(): void }).buildUi()
    const banner = (v as { contentEl: HTMLElement }).contentEl.querySelector('.dsh-files-banner') as HTMLElement
    expect(banner.style.display).toBe('none')
  })
})

describe('轮次结束工具栏（0.35.0）', () => {
  it('turn 结束后显示元信息（时间/耗时/tokens/效率）+ 复制按钮', () => {
    const v = makeView() as unknown as Record<string, unknown>
    ;(v as { messagesEl: HTMLElement }).messagesEl = document.createElement('div')
    v.currentSessionId = 's1'
    ;(v as { startTurn(text: string): void }).startTurn('你好')
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'turn/start',
      ts: Date.now(),
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'assistant/message',
      ts: Date.now(),
      content: '这是一段很长的回答内容用于统计 token 数量。'.repeat(5),
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'turn/end',
      ts: Date.now(),
    })
    const el = (v as { messagesEl: HTMLElement }).messagesEl
    const meta = el.querySelector('.dsh-turn-meta')
    expect(meta).toBeTruthy()
    expect(meta!.querySelectorAll('span').length).toBeGreaterThanOrEqual(3)
    expect(meta!.textContent).toContain('tokens')
    expect(el.querySelector('.dsh-turn-copy')).toBeTruthy()
  })

  it('estimateTokens：字符数换算近似 token 数', () => {
    expect(estimateTokens(170)).toBe(100)
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(1)).toBe(1)
  })
})

describe('并发刷新与工具栏重做（0.35.1）', () => {
  it('并发 refreshSessions 不重复渲染行（串行化）', async () => {
    let calls = 0
    const ctx = {
      settings: { get: (k: string, d: unknown) => d, set: () => {} },
      on: vi.fn(() => () => {}),
      sessionLog: {
        append: async () => {},
        list: async () => {
          calls++
          await new Promise((r) => setTimeout(r, 10))
          return [{ id: 's1', updatedAt: 1, count: 1, title: 't', notePath: null, modelId: undefined }]
        },
        read: async () => [],
        readMeta: async () => null,
        remove: async () => {},
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
    ;(v as { sessionRowsEl: HTMLElement }).sessionRowsEl = document.createElement('div')
    await Promise.all([
      (v as { refreshSessions(): Promise<void> }).refreshSessions(),
      (v as { refreshSessions(): Promise<void> }).refreshSessions(),
    ])
    const rows = (v as { sessionRowsEl: HTMLElement }).sessionRowsEl.querySelectorAll('.dsh-session-row')
    expect(rows.length).toBe(1)
    expect(calls).toBe(2)
  })

  it('结束工具栏：复制图标 + 重做按钮', () => {
    const v = makeView() as unknown as Record<string, unknown>
    ;(v as { messagesEl: HTMLElement }).messagesEl = document.createElement('div')
    v.currentSessionId = 's1'
    ;(v as { startTurn(text: string): void }).startTurn('重新生成测试')
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/start', ts: Date.now() })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'assistant/message',
      ts: Date.now(),
      content: '回答内容',
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/end', ts: Date.now() })
    const el = (v as { messagesEl: HTMLElement }).messagesEl
    const btns = el.querySelector('.dsh-turn-btns')
    expect(btns).toBeTruthy()
    expect(btns!.querySelectorAll('button').length).toBe(2) // 复制 + 重做
  })

  it('重做：当前会话不重建，开新轮次容器并重新生成（二次可重做）', () => {
    const v = makeView() as unknown as Record<string, unknown>
    ;(v as { messagesEl: HTMLElement }).messagesEl = document.createElement('div')
    ;(v as { currentSessionId: string | null }).currentSessionId = 's1'
    ;(v as { startTurn(text: string): void }).startTurn('重新生成测试')
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/start', ts: Date.now() })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'assistant/message',
      ts: Date.now(),
      content: '回答内容',
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/end', ts: Date.now() })
    const el = (v as { messagesEl: HTMLElement }).messagesEl
    const btns = el.querySelector('.dsh-turn-btns')!
    const redoBtn = btns.querySelectorAll('button')[1] as HTMLButtonElement
    const runSpy = vi
      .spyOn(v as unknown as { run(s: string, t: string, a?: boolean): Promise<void> }, 'run')
      .mockResolvedValue(undefined)
    const openSessionSpy = vi
      .spyOn(v as unknown as { openSession(id: string): void }, 'openSession')
      .mockImplementation(() => {})
    redoBtn.click()
    expect(openSessionSpy).not.toHaveBeenCalled() // 当前会话不重建
    expect(runSpy).toHaveBeenCalledWith('s1', '重新生成测试', true)
    expect(el.querySelectorAll('.dsh-turn').length).toBe(2) // 新轮次容器已开启
    // 新轮次结束后再次出现重做按钮，可二次重做（turnStats 已写回）
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/start', ts: Date.now() })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'assistant/message',
      ts: Date.now(),
      content: '新回答',
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/end', ts: Date.now() })
    const turns = el.querySelectorAll('.dsh-turn')
    const lastTurn = turns[turns.length - 1]!
    const btns2 = lastTurn.querySelector('.dsh-turn-btns')!
    const redoBtn2 = btns2.querySelectorAll('button')[1] as HTMLButtonElement
    redoBtn2.click()
    expect(runSpy).toHaveBeenCalledTimes(2)
    expect(runSpy).toHaveBeenLastCalledWith('s1', '重新生成测试', true)
  })
})

describe('会话渲染滚动（0.35.7）', () => {
  it('renderSession：重建会话后强制滚到底部（打开历史会话显示最新内容）', async () => {
    const ctx = {
      settings: {
        get: (k: string, d: unknown) => {
          if (k === 'providers') return PROVIDERS
          if (k === 'renderMarkdown') return false
          return d
        },
        set: () => {},
      },
      on: vi.fn(() => () => {}),
      sessionLog: {
        append: async () => {},
        list: async () => [],
        read: async () => [
          { type: 'user/message', ts: 1, sessionId: 's1', content: '你好' },
          { type: 'turn/start', ts: 2, sessionId: 's1' },
          { type: 'assistant/message', ts: 3, sessionId: 's1', content: '这是历史回复' },
          { type: 'turn/end', ts: 4, sessionId: 's1' },
        ] as never,
        readMeta: async () => null,
        remove: async () => {},
        patchMeta: async () => {},
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
    ;(v as { buildUi(): void }).buildUi()
    const el = (v as { messagesEl: HTMLElement }).messagesEl
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    el.scrollTop = 0
    ;(v as { currentSessionId: string | null }).currentSessionId = 's1'
    await (v as { renderSession(): Promise<void> }).renderSession()
    expect(el.scrollTop).toBe(2000) // 重建后强制滚底
  })

  it('renderSession：重建的历史会话不显示重做按钮（重建后重做不可用）', async () => {
    const ctx = {
      settings: {
        get: (k: string, d: unknown) => {
          if (k === 'providers') return PROVIDERS
          if (k === 'renderMarkdown') return false
          return d
        },
        set: () => {},
      },
      on: vi.fn(() => () => {}),
      sessionLog: {
        append: async () => {},
        list: async () => [],
        read: async () => [
          { type: 'user/message', ts: 1, sessionId: 's1', content: '你好' },
          { type: 'turn/start', ts: 2, sessionId: 's1' },
          { type: 'assistant/message', ts: 3, sessionId: 's1', content: '历史回复' },
          { type: 'turn/end', ts: 4, sessionId: 's1' },
        ] as never,
        readMeta: async () => null,
        remove: async () => {},
        patchMeta: async () => {},
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
    ;(v as { buildUi(): void }).buildUi()
    ;(v as { currentSessionId: string | null }).currentSessionId = 's1'
    await (v as { renderSession(): Promise<void> }).renderSession()
    const el = (v as { messagesEl: HTMLElement }).messagesEl
    expect(el.querySelectorAll('.dsh-turn-redo').length).toBe(0) // 无重做
    const btns = el.querySelector('.dsh-turn-btns')!
    expect(btns.querySelectorAll('button').length).toBe(1) // 仅复制
  })
})

describe('重做按钮只保留最后一次（0.35.7）', () => {
  it('新轮次开始后，上一轮的重做按钮被移除，仅最后一轮保留', () => {
    const v = makeView() as unknown as Record<string, unknown>
    ;(v as { messagesEl: HTMLElement }).messagesEl = document.createElement('div')
    ;(v as { currentSessionId: string | null }).currentSessionId = 's1'
    // 第一轮
    ;(v as { startTurn(text: string): void }).startTurn('第一轮问题')
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/start', ts: 1 })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'assistant/message',
      ts: 2,
      content: '第一轮回答',
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/end', ts: 3 })
    expect((v as { messagesEl: HTMLElement }).messagesEl.querySelectorAll('.dsh-turn-redo').length).toBe(1)
    // 第二轮
    ;(v as { startTurn(text: string): void }).startTurn('第二轮问题')
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/start', ts: 4 })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({
      sessionId: 's1',
      type: 'assistant/message',
      ts: 5,
      content: '第二轮回答',
    })
    ;(v as { onSessionEvent(e: unknown): void }).onSessionEvent({ sessionId: 's1', type: 'turn/end', ts: 6 })
    const el = (v as { messagesEl: HTMLElement }).messagesEl
    expect(el.querySelectorAll('.dsh-turn-redo').length).toBe(1) // 全局只剩最后一轮
    const turns = el.querySelectorAll('.dsh-turn')
    expect(turns[0]!.querySelector('.dsh-turn-redo')).toBeNull() // 第一轮的重做已移除
    expect(turns[1]!.querySelector('.dsh-turn-redo')).toBeTruthy() // 最后一轮保留
  })
})
