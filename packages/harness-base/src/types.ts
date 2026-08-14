/**
 * dsh-obsidian harness-base: 共享类型。
 *
 * 会话事件命名对齐 dsh 的持久事件域（session/event）：
 * turn/*、user/message、assistant/message、tool/call、tool/result。
 * 流式增量（assistant/delta）不落盘，由 UI 直接订阅。
 */

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

/** OpenAI 兼容 wire 形状（发送给 API 的 tool_calls 元素） */
export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type SessionEvent =
  | { type: 'turn/start'; ts: number; sessionId: string }
  | { type: 'turn/end'; ts: number; sessionId: string }
  | {
      type: 'session/meta'
      ts: number
      sessionId: string
      title: string
      notePath: string | null
    }
  | { type: 'user/message'; ts: number; sessionId: string; content: string }
  | { type: 'assistant/message'; ts: number; sessionId: string; content: string }
  | {
      type: 'system/message'
      ts: number
      sessionId: string
      content: string
    }
  | { type: 'tool/call'; ts: number; sessionId: string; id: string; tool: string; input: unknown }
  | {
      type: 'tool/result'
      ts: number
      sessionId: string
      id: string
      tool: string
      ok: boolean
      output?: unknown
      error?: string
    }

export interface ToolDef {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: Record<string, unknown>): Promise<unknown> | unknown
}

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
  /** 采样温度（0-2），不设置则用端点默认 */
  temperature?: number
  /** 最大输出 token 数，0 或不设置则不限制 */
  maxTokens?: number
  /** 自定义请求头（如网关鉴权），合并进每次模型请求 */
  extraHeaders?: Record<string, string>
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  name?: string
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
}

/** 执行结果：供 agent 循环回填 tool/result 事件 */
export interface ToolExecution {
  ok: boolean
  output?: unknown
  error?: string
}
