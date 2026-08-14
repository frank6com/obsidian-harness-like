/**
 * llm seam（Stage 2）集成测试：真实 LlmRuntime + DeepSeekAdapter + createLlmCaller，
 * fetch 打桩。覆盖：流式内容、工具调用分片、请求体消息映射（tool 角色还原）、
 * 401、空 key、中止（abort → aborted finish → AbortError）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter, createLlmCaller, type LlmCaller } from '../llm'
import type { LLMConfig, LLMMessage, ToolDef } from '../types'

const encoder = new TextEncoder()

function sseBody(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

const baseConfig: LLMConfig = {
  baseURL: 'https://api.example.com',
  apiKey: 'k',
  model: 'deepseek-chat',
}

async function setup(cfg: LLMConfig = baseConfig) {
  const ctx = new Context()
  let runtime!: LlmRuntime
  const fiber = ctx.plugin({
    apply(c) {
      runtime = new LlmRuntime(c)
      runtime.registerAdapter(['deepseek'], new DeepSeekAdapter(() => cfg))
    },
  })
  await fiber
  const caller: LlmCaller = createLlmCaller(runtime, {
    getConfig: () => cfg,
    defaultProvider: () => 'deepseek',
    defaultModel: () => cfg.model,
  })
  return { ctx, runtime, caller, fiber }
}

const sampleMessages: LLMMessage[] = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'hi' },
  {
    role: 'assistant',
    content: 'x',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
  },
  { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
]

const sampleTools: ToolDef[] = [
  {
    name: 'count_notes',
    description: 'count',
    input: { type: 'object', properties: { limit: { type: 'number' } } },
    execute: () => ({ count: 1 }),
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('llm caller（官方栈）', () => {
  it('流式内容 + onDelta + 请求体映射', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody(
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n',
      ),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { caller } = await setup({ ...baseConfig, temperature: 0.3, maxTokens: 100 })

    const deltas: string[] = []
    const result = await caller.call({
      messages: sampleMessages,
      tools: sampleTools,
      onDelta: (d) => deltas.push(d),
    })

    expect(result.content).toBe('你好')
    expect(deltas).toEqual(['你', '好'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'deepseek-chat', stream: true, temperature: 0.3, max_tokens: 100 })
    // 消息映射：system 槽 + tool 角色还原 + tool_calls wire 形状
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'x',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    ])
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'count_notes', parameters: { type: 'object' } },
    })
  })

  it('工具调用分片累加为 ToolCall 列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: sseBody(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_","arguments":"{\\"pa"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"note","arguments":"th\\":\\"a.md\\"}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ),
      }),
    )
    const { caller } = await setup()
    const result = await caller.call({ messages: [], tools: [] })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({ id: 'c1', name: 'read_note' })
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ path: 'a.md' })
  })

  it('非 2xx：LlmError → error finish → 抛出含状态摘要的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }),
    )
    const { caller } = await setup()
    await expect(caller.call({ messages: [], tools: [] })).rejects.toThrow(/401/)
  })

  it('未配置 key：assertUsableApiKey 拒绝', async () => {
    const { caller } = await setup({ ...baseConfig, apiKey: '  ' })
    await expect(caller.call({ messages: [], tools: [] })).rejects.toThrow()
  })

  it('中止：aborted finish → AbortError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            // 同步检查：信号可能已在 fetch 被调用前中止
            if (init.signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )
    const { caller } = await setup()
    const controller = new AbortController()
    const pending = caller.call({ messages: [], tools: [], signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
