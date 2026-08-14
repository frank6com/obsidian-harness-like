import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMessages, runAgentLoop, type AgentPhase } from '../agent-loop'
import { LLMClient } from '../llm'
import { ToolRegistry } from '../tools'
import type { SessionEvent, ToolExecution } from '../types'

const encoder = new TextEncoder()

function sse(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

function sseToolCall(name: string, args: string): ReadableStream<Uint8Array> {
  const payload = `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"${name}","arguments":"${args}"}}]}}]}\n\n`
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildMessages', () => {
  it('历史事件重建为消息列表（含工具往返）', () => {
    const history: SessionEvent[] = [
      { type: 'user/message', ts: 1, sessionId: 's', content: '读笔记' },
      { type: 'tool/call', ts: 2, sessionId: 's', id: 'c1', tool: 'read_note', input: { path: 'a' } },
      { type: 'tool/result', ts: 3, sessionId: 's', id: 'c1', tool: 'read_note', ok: true, output: { content: 'x' } },
      { type: 'assistant/message', ts: 4, sessionId: 's', content: '完成了' },
    ]
    const msgs = buildMessages(history, 'SYSTEM')
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'SYSTEM' })
    expect(msgs[1]).toMatchObject({ role: 'user', content: '读笔记' })
    expect(msgs[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_note', arguments: '{"path":"a"}' },
        },
      ],
    })
    expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: '{"content":"x"}' })
    expect(msgs[4]).toMatchObject({ role: 'assistant', content: '完成了' })
  })
})

describe('runAgentLoop', () => {
  it('单轮对话：无工具调用即结束', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: sse('你好') }))
    const llm = new LLMClient(() => ({
      baseURL: 'https://x',
      apiKey: 'k',
      model: 'm',
    }))
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    const executed: string[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async (name) => {
        executed.push(name)
        return { ok: true, output: null } satisfies ToolExecution
      },
      onEvent: (e) => events.push(e),
      history: [],
    })
    expect(events.map((e) => e.type)).toEqual(['turn/start', 'assistant/message', 'turn/end'])
    expect(executed).toEqual([])
  })

  it('工具循环：先调工具再给最终答复', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, body: sseToolCall('count_notes', '{}') })
      .mockResolvedValueOnce({ ok: true, body: sse('共 3 篇') })
    vi.stubGlobal('fetch', fetchMock)
    const llm = new LLMClient(() => ({
      baseURL: 'https://x',
      apiKey: 'k',
      model: 'm',
    }))
    const tools = new ToolRegistry()
    tools.register({
      name: 'count_notes',
      description: 'count',
      input: { type: 'object', properties: {} },
      execute: () => ({ count: 3 }),
    })
    const events: SessionEvent[] = []
    const executed: string[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async (name, input) => {
        executed.push(name)
        return { ok: true, output: { count: 3 } }
      },
      onEvent: (e) => events.push(e),
      history: [{ type: 'user/message', ts: 1, sessionId: 's1', content: '几篇?' }],
    })
    expect(executed).toEqual(['count_notes'])
    // 回归：发给 API 的请求体必须含 OpenAI 兼容的 tool_calls 形状
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { messages: Array<{ tool_calls?: unknown[] }> }
    const withCalls = body.messages.find((m) => m.tool_calls)
    expect(withCalls?.tool_calls?.[0]).toMatchObject({
      id: 't1',
      type: 'function',
      function: { name: 'count_notes', arguments: '{}' },
    })
    const types = events.map((e) => e.type)
    expect(types).toContain('tool/call')
    expect(types).toContain('tool/result')
    expect(types.filter((t) => t === 'assistant/message')).toHaveLength(1)
    const last = events[events.length - 2]
    expect(last?.type === 'assistant/message' && last.content).toBe('共 3 篇')
  })

  it('工具执行异常被捕获为失败结果', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, body: sseToolCall('boom', '{}') })),
    )
    const llm = new LLMClient(() => ({
      baseURL: 'https://x',
      apiKey: 'k',
      model: 'm',
    }))
    const tools = new ToolRegistry()
    tools.register({
      name: 'boom',
      description: 'b',
      input: { type: 'object', properties: {} },
      execute: () => {
        throw new Error('爆炸')
      },
    })
    const events: SessionEvent[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async (name, input) => {
        const tool = tools.get(name)
        if (!tool) return { ok: false, error: `未知工具: ${name}` }
        try {
          return { ok: true, output: await tool.execute(input) }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
      onEvent: (e) => events.push(e),
      history: [],
    })
    const result = events.find((e) => e.type === 'tool/result')
    expect(result?.type === 'tool/result' && result.ok).toBe(false)
  })

  it('阶段事件：thinking → done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: sse('你好') }))
    const llm = new LLMClient(() => ({ baseURL: 'https://x', apiKey: 'k', model: 'm' }))
    const tools = new ToolRegistry()
    const phases: AgentPhase[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: () => {},
      history: [],
      onPhase: (p) => phases.push(p),
    })
    expect(phases.map((p) => p.kind)).toEqual(['thinking', 'done'])
  })

  it('阶段事件：工具阶段携带工具名', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, body: sseToolCall('count_notes', '{}') })
        .mockResolvedValueOnce({ ok: true, body: sse('完成') }),
    )
    const llm = new LLMClient(() => ({ baseURL: 'https://x', apiKey: 'k', model: 'm' }))
    const tools = new ToolRegistry()
    const phases: AgentPhase[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: () => {},
      history: [],
      onPhase: (p) => phases.push(p),
    })
    expect(phases).toContainEqual({ kind: 'tool', name: 'count_notes' })
    expect(phases[phases.length - 1]).toEqual({ kind: 'done' })
  })

  it('abort：已中止的信号立即抛 AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    const llm = new LLMClient(() => ({ baseURL: 'https://x', apiKey: 'k', model: 'm' }))
    const tools = new ToolRegistry()
    await expect(
      runAgentLoop({
        sessionId: 's1',
        llm,
        tools,
        executeTool: async () => ({ ok: true, output: null }),
        onEvent: () => {},
        history: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('abort：工具执行期间中止，循环抛 AbortError 且补发 turn/end', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, body: sseToolCall('count_notes', '{}') })),
    )
    const controller = new AbortController()
    const llm = new LLMClient(() => ({ baseURL: 'https://x', apiKey: 'k', model: 'm' }))
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await expect(
      runAgentLoop({
        sessionId: 's1',
        llm,
        tools,
        executeTool: async () => {
          controller.abort()
          return { ok: true, output: null }
        },
        onEvent: (e) => events.push(e),
        history: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    // finally 保证 turn/end 落盘，日志闭合
    expect(events.some((e) => e.type === 'turn/end')).toBe(true)
  })
})
