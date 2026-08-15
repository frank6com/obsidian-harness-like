/**
 * llm seam（Stage 2）：集成官方 @deepseek-ai/dsh-llm。
 *
 * - DeepSeekAdapter：OpenAI 兼容端点适配器（dsh 适配器只需实现 stream()，
 *   产出官方 StreamChunk 词汇；providerInfo/resolveModel 用默认实现）。
 * - createLlmCaller：把自研 LLMMessage/ToolDef 词汇转换为官方 Message/ToolSchema，
 *   消费 StreamChunk 后产出 ChatResult——agent loop 的消费面不变。
 *
 * 附带能力（官方服务带来）：llm/stream 瀑布事件（重试/路由/日志）、
 * LlmError 错误分类、attributionHeaders 产品归属请求头。
 */

import {
  LlmAdapter,
  LlmError,
  LlmRuntime,
  assertUsableApiKey,
  attributionHeaders,
  createMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type {
  CallId,
  ContentBlock,
  FinishReason,
  GenerateOptions,
  Message,
  StreamChunk,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { ChatResult, LLMConfig, LLMMessage, ToolCall, ToolDef } from './types'

export interface LlmCallerOptions {
  messages: LLMMessage[]
  tools: ToolDef[]
  signal?: AbortSignal
  onDelta?: (delta: string) => void
  /** 会话级模型选择，格式 "providerId/model"；缺省用默认提供方 */
  model?: string
}

export interface LlmCaller {
  call(options: LlmCallerOptions): Promise<ChatResult>
}

export interface LlmRuntimeConfig {
  /** 模型路由与参数：按 provider 返回端点/凭据/默认模型 */
  getConfig(provider: string): LLMConfig
  /** 默认提供方 id（会话未指定模型时的兜底） */
  defaultProvider(): string
  /** 默认模型（defaultProvider 下） */
  defaultModel(): string
}

/** ---------- 消息/工具词汇转换 ---------- */

function toWireMessages(
  messages: Message[],
  system: string | undefined,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: textOf(m.content) })
    } else if (m.role === 'user' && m.source.kind === 'tool') {
      // 官方无 tool 角色：工具结果以 user + tool source 表达，落线还原为 tool
      const resultBlock = m.content.find((b) => b.type === 'tool-result')
      const text = resultBlock ? textOf(resultBlock.content) : ''
      out.push({ role: 'tool', tool_call_id: m.source.callId, content: text })
    } else if (m.role === 'assistant') {
      const wire: Record<string, unknown> = { role: 'assistant', content: textOf(m.content) }
      const toolCalls = m.content
        .filter((b) => b.type === 'tool-call')
        .map((b) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: b.arguments },
        }))
      if (toolCalls.length) wire.tool_calls = toolCalls
      out.push(wire)
    } else {
      out.push({ role: 'user', content: textOf(m.content) })
    }
  }
  return out
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function toToolSchema(tool: ToolDef): ToolSchema {
  return { name: tool.name, description: tool.description, parameters: tool.input }
}

/** ---------- DeepSeek 适配器（多 provider 路由） ---------- */

export class DeepSeekAdapter extends LlmAdapter {
  constructor(private getConfigByProvider: (provider: string) => LLMConfig) {
    super()
  }

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: 'DeepSeek (OpenAI 兼容)' }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const cfg = this.getConfigByProvider(options.provider)
    const apiKey = assertUsableApiKey(cfg.apiKey, 'harness-like', 'settings.apiKey')
    const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions'

    const body: Record<string, unknown> = {
      model: options.model,
      messages: toWireMessages(options.messages, options.system),
      stream: true,
    }
    if (options.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    }
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.maxTokens) body.max_tokens = options.maxTokens

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...attributionHeaders(),
        ...(cfg.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new LlmError(`LLM 请求失败 ${res.status}: ${text.slice(0, 200)}`, 'UPSTREAM', {
        status: res.status,
      })
    }

    // SSE 解析 → StreamChunk（官方块词汇）
    let textAcc = ''
    let textStarted = false
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()
    const toolIndex = new Map<number, number>() // OpenAI delta index → 块 index
    let nextBlockIndex = 1

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
            choices?: Array<{ delta?: { content?: string; tool_calls?: ToolCallDelta[] } }>
          }
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) {
            if (!textStarted) {
              yield { type: 'block-start', index: 0, blockType: 'text' }
              textStarted = true
            }
            textAcc += delta.content
            yield { type: 'text-delta', index: 0, text: delta.content }
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const oi = tc.index ?? 0
              let bi = toolIndex.get(oi)
              if (bi === undefined) {
                bi = nextBlockIndex++
                toolIndex.set(oi, bi)
                toolAcc.set(oi, { id: '', name: '', args: '' })
                yield { type: 'block-start', index: bi, blockType: 'tool-call' }
              }
              const cur = toolAcc.get(oi)!
              if (tc.id) cur.id = tc.id
              if (tc.function?.name) cur.name += tc.function.name
              if (tc.function?.arguments) {
                cur.args += tc.function.arguments
                yield {
                  type: 'tool-call-delta',
                  index: bi,
                  id: (cur.id || `call_${oi}`) as CallId,
                  name: cur.name || undefined,
                  argumentsDelta: tc.function.arguments,
                }
              }
            }
          }
        } catch {
          // keep-alive 或半行数据：忽略
        }
      }
    }

    if (textStarted) yield { type: 'block-end', index: 0, block: { type: 'text', text: textAcc } }
    for (const [oi, cur] of toolAcc) {
      const bi = toolIndex.get(oi)!
      yield {
        type: 'block-end',
        index: bi,
        block: {
          type: 'tool-call',
          id: (cur.id || `call_${oi}`) as CallId,
          name: cur.name,
          arguments: cur.args,
        },
      }
    }
    yield {
      type: 'finish',
      reason: (toolAcc.size ? { kind: 'tool-calls' } : { kind: 'stop' }) as FinishReason,
    }
  }
}

interface ToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

/** ---------- 调用器（agent loop 消费面） ---------- */

export function createLlmCaller(llm: LlmRuntime, cfg: LlmRuntimeConfig): LlmCaller {
  return {
    async call(options) {
      // 会话级模型选择 "providerId/model"；缺省用默认提供方
      let provider = cfg.defaultProvider()
      let model = cfg.defaultModel()
      if (options.model) {
        const idx = options.model.indexOf('/')
        if (idx > 0) {
          provider = options.model.slice(0, idx)
          model = options.model.slice(idx + 1)
        } else {
          model = options.model
        }
      }
      const c = cfg.getConfig(provider)
      // 系统提示：官方走 GenerateOptions.system 槽
      const system =
        options.messages[0]?.role === 'system' ? options.messages[0].content : undefined
      const messages = system ? options.messages.slice(1) : options.messages

      const official: Message[] = messages.map((m) => {
        if (m.role === 'system') {
          return createMessage({
            role: 'system',
            content: [{ type: 'text', text: m.content ?? '' }],
            source: { kind: 'user' },
          })
        }
        if (m.role === 'tool') {
          return createMessage({
            role: 'user',
            content: [
              {
                type: 'tool-result',
                toolCallId: (m.tool_call_id ?? '') as CallId,
                content: [{ type: 'text', text: m.content ?? '' }],
              },
            ],
            source: { kind: 'tool', callId: (m.tool_call_id ?? '') as CallId },
          })
        }
        if (m.role === 'assistant') {
          const blocks: ContentBlock[] = []
          if (m.content) blocks.push({ type: 'text', text: m.content })
          if (m.tool_calls) {
            for (const tc of m.tool_calls) {
              blocks.push({
                type: 'tool-call',
                id: tc.id as CallId,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })
            }
          }
          return createMessage({
            role: 'assistant',
            content: blocks,
            source: { kind: 'model', provider, model },
          })
        }
        return createUserMessage({
          content: [{ type: 'text', text: m.content ?? '' }],
          source: { kind: 'user' },
        })
      })

      let content = ''
      const toolCalls = new Map<number, ToolCall>()
      let finish: FinishReason | undefined

      const chunks = llm.stream({
        provider,
        model,
        system,
        messages: official,
        tools: options.tools.map(toToolSchema),
        temperature: c.temperature,
        maxTokens: c.maxTokens,
        signal: options.signal,
      })

      for await (const chunk of chunks) {
        if (chunk.type === 'text-delta') {
          content += chunk.text
          options.onDelta?.(chunk.text)
        } else if (chunk.type === 'tool-call-delta') {
          const cur = toolCalls.get(chunk.index) ?? { id: '', name: '', arguments: '' }
          if (chunk.id && !cur.id) cur.id = chunk.id
          if (chunk.name) cur.name += chunk.name
          cur.arguments += chunk.argumentsDelta
          toolCalls.set(chunk.index, cur)
        } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
          const cur = toolCalls.get(chunk.index) ?? { id: '', name: '', arguments: '' }
          cur.id = chunk.block.id
          cur.name = chunk.block.name
          cur.arguments = chunk.block.arguments
          toolCalls.set(chunk.index, cur)
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        }
      }

      if (finish?.kind === 'error') throw new Error(finish.failure.message)
      if (finish?.kind === 'aborted') {
        const err = new Error('已停止')
        err.name = 'AbortError'
        throw err
      }
      return {
        content,
        toolCalls: [...toolCalls.values()].filter((t) => t.name),
      }
    },
  }
}
