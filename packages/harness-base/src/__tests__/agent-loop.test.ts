import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMessages, runAgentLoop, type AgentPhase } from '../agent-loop'
import { ToolRegistry } from '../tools'
import type { ChatResult, SessionEvent, ToolExecution } from '../types'

/** stub 调用器：按序列返回结果 */
function stubCaller(sequence: ChatResult[]) {
  const call = vi.fn()
  for (const r of sequence) call.mockResolvedValueOnce(r)
  if (!sequence.length) call.mockResolvedValue({ content: '', toolCalls: [] })
  return { call }
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

  it('system/message 进入模型上下文（role=system）', () => {
    const history: SessionEvent[] = [
      { type: 'user/message', ts: 1, sessionId: 's', content: 'Q1' },
      { type: 'system/message', ts: 2, sessionId: 's', content: '错误: LLM 请求失败 400' },
      { type: 'user/message', ts: 3, sessionId: 's', content: 'Q2' },
    ]
    const msgs = buildMessages(history)
    expect(msgs[1]).toMatchObject({ role: 'system', content: '错误: LLM 请求失败 400' })
  })

  it('孤儿 tool/result（无前置 tool/call）被丢弃', () => {
    const history: SessionEvent[] = [
      { type: 'tool/result', ts: 1, sessionId: 's', id: 'orphan', tool: 'x', ok: true, output: 1 },
      { type: 'user/message', ts: 2, sessionId: 's', content: 'hi' },
    ]
    const msgs = buildMessages(history)
    expect(msgs.filter((m) => m.role === 'tool')).toHaveLength(0)
  })

  it('孤儿 tool/call（无 result）被整体移除', () => {
    const history: SessionEvent[] = [
      { type: 'tool/call', ts: 1, sessionId: 's', id: 'c9', tool: 'x', input: {} },
      { type: 'user/message', ts: 2, sessionId: 's', content: 'hi' },
    ]
    const msgs = buildMessages(history)
    expect(msgs.filter((m) => m.tool_calls)).toHaveLength(0)
  })
})

describe('runAgentLoop', () => {
  it('单轮对话：无工具调用即结束', async () => {
    const llm = stubCaller([{ content: '你好', toolCalls: [] }])
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    const phases: AgentPhase[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async (name) => {
        throw new Error(`不应调用工具: ${name}`)
      },
      onEvent: (e) => events.push(e),
      onPhase: (p) => phases.push(p),
      history: [],
    })
    expect(events.map((e) => e.type)).toEqual(['turn/start', 'assistant/message', 'turn/end'])
    expect(phases.map((p) => p.kind)).toEqual(['thinking', 'done'])
    expect(llm.call).toHaveBeenCalledTimes(1)
  })

  it('工具循环：先调工具再给最终答复，tools 传入 caller', async () => {
    const llm = stubCaller([
      { content: '', toolCalls: [{ id: 't1', name: 'count_notes', arguments: '{}' }] },
      { content: '共 3 篇', toolCalls: [] },
    ])
    const tools = new ToolRegistry()
    tools.register({
      name: 'count_notes',
      description: 'count',
      input: { type: 'object', properties: {} },
      execute: () => ({ count: 3 }),
    })
    const events: SessionEvent[] = []
    const executed: string[] = []
    const phases: AgentPhase[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async (name) => {
        executed.push(name)
        return { ok: true, output: { count: 3 } }
      },
      onEvent: (e) => events.push(e),
      onPhase: (p) => phases.push(p),
      history: [{ type: 'user/message', ts: 1, sessionId: 's1', content: '几篇?' }],
    })
    expect(executed).toEqual(['count_notes'])
    // caller 收到完整工具表与消息
    const firstCall = llm.call.mock.calls[0]![0] as { tools: unknown[] }
    expect(firstCall.tools).toHaveLength(1)
    expect(phases).toContainEqual({ kind: 'tool', name: 'count_notes' })
    const types = events.map((e) => e.type)
    expect(types).toContain('tool/call')
    expect(types).toContain('tool/result')
    expect(types.filter((t) => t === 'assistant/message')).toHaveLength(1)
    const last = events[events.length - 2]
    expect(last?.type === 'assistant/message' && last.content).toBe('共 3 篇')
  })

  it('工具执行异常被捕获为失败结果', async () => {
    const llm = stubCaller([
      { content: '', toolCalls: [{ id: 't1', name: 'boom', arguments: '{}' }] },
      { content: 'ok', toolCalls: [] },
    ])
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

  it('abort：已中止的信号立即抛 AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    const llm = stubCaller([])
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

  it('abort：调用器抛 AbortError 时循环抛错且补发 turn/end', async () => {
    const call = vi.fn(async () => {
      const err = new Error('已停止')
      err.name = 'AbortError'
      throw err
    })
    const llm = { call }
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await expect(
      runAgentLoop({
        sessionId: 's1',
        llm,
        tools,
        executeTool: async () => ({ ok: true, output: null }),
        onEvent: (e) => events.push(e),
        history: [],
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(events.some((e) => e.type === 'turn/end')).toBe(true)
  })

  it('length 截断空响应：注入引导消息自动续跑并产出（无需人工"继续"）', async () => {
    const llm = stubCaller([
      { content: '', toolCalls: [], finishReason: 'length' },
      { content: '这是续跑后的回答', toolCalls: [] },
    ])
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: (e) => events.push(e),
      history: [],
    })
    // 续跑产出正常落盘；无截断提示
    expect(events.some((e) => e.type === 'assistant/message')).toBe(true)
    expect(events.some((e) => e.type === 'system/message')).toBe(false)
    // 第二次调用的消息里带一次性引导（messages 为共享引用，断言存在性而非尾部）
    const second = llm.call.mock.calls[1]![0] as { messages: Array<{ role: string; content: string }> }
    expect(second.messages.some((m) => m.role === 'user' && m.content.includes('被截断'))).toBe(true)
    expect(llm.call).toHaveBeenCalledTimes(2)
  })

  it('length 截断且已有内容：正常结束不续跑', async () => {
    const llm = stubCaller([{ content: '被截断的半句话', toolCalls: [], finishReason: 'length' }])
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: (e) => events.push(e),
      history: [],
    })
    expect(events.some((e) => e.type === 'assistant/message')).toBe(true)
    expect(events.some((e) => e.type === 'system/message')).toBe(false)
    expect(llm.call).toHaveBeenCalledTimes(1)
  })

  it('端点异常空响应（stop 无 finish_reason 场景）：同样自动续跑', async () => {
    const llm = stubCaller([
      { content: '', toolCalls: [] }, // 无 finish_reason（部分第三方端点行为）
      { content: '续跑产出', toolCalls: [] },
    ])
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: (e) => events.push(e),
      history: [],
    })
    expect(events.some((e) => e.type === 'assistant/message')).toBe(true)
    expect(events.some((e) => e.type === 'system/message')).toBe(false)
    expect(llm.call).toHaveBeenCalledTimes(2)
  })

  it('连续截断超过上限：落盘提示终止（共 3 次调用 = 初始 + 2 次续跑）', async () => {
    const llm = stubCaller([
      { content: '', toolCalls: [], finishReason: 'length' },
      { content: '', toolCalls: [], finishReason: 'length' },
      { content: '', toolCalls: [], finishReason: 'length' },
    ])
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: (e) => events.push(e),
      history: [],
    })
    expect(llm.call).toHaveBeenCalledTimes(3)
    const sys = events.find((e) => e.type === 'system/message')
    expect(sys?.type === 'system/message' && sys.content).toContain('输出上限截断')
    expect(sys?.type === 'system/message' && sys.content).toContain('max_tokens')
  })

  it('连续无 finish_reason 空响应超过上限：落盘提示终止', async () => {
    const llm = stubCaller([
      { content: '', toolCalls: [] },
      { content: '', toolCalls: [] },
      { content: '', toolCalls: [] },
    ])
    const tools = new ToolRegistry()
    const events: SessionEvent[] = []
    await runAgentLoop({
      sessionId: 's1',
      llm,
      tools,
      executeTool: async () => ({ ok: true, output: null }),
      onEvent: (e) => events.push(e),
      history: [],
    })
    expect(llm.call).toHaveBeenCalledTimes(3)
    const sys = events.find((e) => e.type === 'system/message')
    expect(sys?.type === 'system/message' && sys.content).toContain('连续多次未返回任何内容')
  })
})
