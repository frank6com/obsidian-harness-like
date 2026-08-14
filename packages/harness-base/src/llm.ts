/**
 * LLM 客户端：OpenAI 兼容端点（默认 DeepSeek），流式 SSE 解析。
 * P1 替换为 @deepseek-ai/dsh-llm 适配器 seam。
 */

import type { ChatResult, LLMConfig, LLMMessage, ToolCall } from './types'

export interface LLMTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatOptions {
  messages: LLMMessage[]
  tools: LLMTool[]
  signal?: AbortSignal
  onDelta?: (delta: string) => void
}

interface DeltaToolCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

export class LLMClient {
  constructor(private getConfig: () => LLMConfig) {}

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const cfg = this.getConfig()
    if (!cfg.apiKey) throw new Error('未配置 API key（设置页 → 模型）')
    const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions'

    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: opts.messages,
      stream: true,
    }
    if (opts.tools.length) body.tools = opts.tools
    if (cfg.temperature !== undefined) body.temperature = cfg.temperature
    if (cfg.maxTokens && cfg.maxTokens > 0) body.max_tokens = cfg.maxTokens

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM 请求失败 ${res.status}: ${text.slice(0, 200)}`)
    }

    let content = ''
    const calls = new Map<number, { id: string; name: string; args: string }>()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string; tool_calls?: DeltaToolCall[] } }>
          }
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) {
            content += delta.content
            opts.onDelta?.(delta.content)
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0
              const cur = calls.get(i) ?? { id: '', name: '', args: '' }
              if (tc.id) cur.id = tc.id
              if (tc.function?.name) cur.name += tc.function.name
              if (tc.function?.arguments) cur.args += tc.function.arguments
              calls.set(i, cur)
            }
          }
        } catch {
          // keep-alive 或半行数据：忽略
        }
      }
    }

    const toolCalls: ToolCall[] = [...calls.values()]
      .filter((c) => c.name)
      .map((c) => ({
        id: c.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: c.name,
        arguments: c.args,
      }))

    return { content, toolCalls }
  }
}
