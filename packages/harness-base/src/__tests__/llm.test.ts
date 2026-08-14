import { afterEach, describe, expect, it, vi } from 'vitest'
import { LLMClient } from '../llm'

const encoder = new TextEncoder()

function sseBody(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LLMClient', () => {
  it('流式内容增量与 onDelta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody(
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n',
      ),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new LLMClient(() => ({
      baseURL: 'https://api.example.com',
      apiKey: 'k',
      model: 'm',
    }))
    const deltas: string[] = []
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      onDelta: (d) => deltas.push(d),
    })
    expect(result.content).toBe('你好')
    expect(deltas).toEqual(['你', '好'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer k' })
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'm', stream: true })
  })

  it('累积分片工具调用参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_note","arguments":"{\\"pa"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.md\\"}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ),
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new LLMClient(() => ({
      baseURL: 'https://api.example.com',
      apiKey: 'k',
      model: 'm',
    }))
    const result = await client.chat({ messages: [], tools: [] })
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({ id: 'c1', name: 'read_note' })
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({ path: 'a.md' })
  })

  it('非 2xx 抛出带状态与摘要的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' }),
    )
    const client = new LLMClient(() => ({
      baseURL: 'https://api.example.com',
      apiKey: 'k',
      model: 'm',
    }))
    await expect(client.chat({ messages: [], tools: [] })).rejects.toThrow(/401/)
  })

  it('未配置 key 直接报错', async () => {
    const client = new LLMClient(() => ({
      baseURL: 'https://api.example.com',
      apiKey: '',
      model: 'm',
    }))
    await expect(client.chat({ messages: [], tools: [] })).rejects.toThrow(/API key/)
  })
})
