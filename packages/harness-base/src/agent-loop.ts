/**
 * 最小 agent 循环（dsh turn/step 流程的薄实现；P1 替换为 @deepseek-ai/dsh-agent + agent-loop）。
 *
 * 流程：历史会话事件 → 消息列表 → llm.chat（可含工具调用）→ 顺序执行工具 →
 * 结果回填 → 继续下一轮，直到无工具调用或达到 maxTurns。
 * 持久事件经 onEvent 落盘；流式增量经 onStream 直达 UI（不落盘）。
 */

import type { LLMMessage, OpenAIToolCall, SessionEvent, ToolCall, ToolDef, ToolExecution } from './types'
import type { LlmCaller } from './llm'

export type AgentPhase =
  | { kind: 'thinking' }
  | { kind: 'tool'; name: string }
  | { kind: 'done' }

export interface AgentRunContext {
  sessionId: string
  llm: LlmCaller
  /** 工具表（schemas 进入提示词）；执行经宿主 executeTool 钩子走官方流水线 */
  tools: { list(): ToolDef[] }
  /** 工具执行钩子：由宿主注入沙箱 + 审批 + UI 弹窗 */
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecution>
  /** 持久化事件（写入会话日志） */
  onEvent(event: SessionEvent): void
  /** 流式增量（UI 直接订阅） */
  onStream?(delta: string): void
  /** 推理过程增量（reasoning_content），实时回调 UI */
  onThinking?(delta: string): void
  /** token 用量（流式 include_usage），实时回调 UI */
  onUsage?(usage: { prompt: number; completion: number }): void
  /** 阶段状态（不落盘，UI 直接订阅） */
  onPhase?(phase: AgentPhase): void
  /** 历史事件（重建上下文） */
  history: SessionEvent[]
  /** 附加系统提示（如当前笔记上下文） */
  system?: string
  /** 会话级模型选择 "providerId/model"（缺省用默认提供方） */
  model?: string
  signal?: AbortSignal
  maxTurns?: number
}

function safeParseArguments(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/**
 * 内部 ToolCall → OpenAI 兼容 wire 形状（tool_calls 数组元素）。
 * 必须带 type:'function' 与 function 包装，否则 DeepSeek 等端点报
 * "missing field 'type'" 400。
 */
export function toWireToolCalls(calls: ToolCall[]): OpenAIToolCall[] {
  return calls.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: { name: tc.name, arguments: tc.arguments },
  }))
}

export function buildMessages(history: SessionEvent[], system?: string): LLMMessage[] {
  const out: LLMMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  // 防御历史脏数据：追踪未配对的 tool 调用
  const pending = new Set<string>()
  for (const e of history) {
    if (e.type === 'user/message') {
      out.push({ role: 'user', content: e.content })
    } else if (e.type === 'assistant/message') {
      out.push({ role: 'assistant', content: e.content })
    } else if (e.type === 'system/message') {
      // 持久化的系统提示（如上一轮失败/中止），进入模型上下文
      out.push({ role: 'system', content: e.content })
    } else if (e.type === 'tool/call') {
      pending.add(e.id)
      out.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: e.id,
            type: 'function',
            function: {
              name: e.tool,
              arguments: typeof e.input === 'string' ? e.input : JSON.stringify(e.input),
            },
          },
        ],
      })
    } else if (e.type === 'tool/result') {
      if (!pending.has(e.id)) continue // 孤儿 result：无前置 tool_calls，丢弃
      pending.delete(e.id)
      out.push({
        role: 'tool',
        tool_call_id: e.id,
        content: e.ok
          ? typeof e.output === 'string'
            ? e.output
            : JSON.stringify(e.output)
          : `ERROR: ${e.error ?? 'unknown'}`,
      })
    }
  }
  if (pending.size) {
    // 孤儿 tool_calls（中断/丢失 result）：移除，避免 API 报 insufficient tool messages
    return out.filter((m) => !m.tool_calls?.some((tc) => pending.has(tc.id)))
  }
  return out
}

/** 截断续跑引导：思考耗尽输出配额时注入，让模型跳过冗长推理直接产出（一次性消息，不落盘） */
const TRUNCATION_CONTINUATION_PROMPT =
  '你上一轮响应因输出长度限制被截断且未产生任何内容。请跳过冗长推理，直接执行下一步：调用所需工具，或给出最终回答。'

export async function runAgentLoop(ac: AgentRunContext): Promise<void> {
  const maxTurns = ac.maxTurns ?? 8
  const messages = buildMessages(ac.history, ac.system)
  const signal = ac.signal
  // 连续截断续跑次数：超限后落盘提示终止，防止无限烧 token
  let continuations = 0
  const throwIfAborted = (): void => {
    if (signal?.aborted) {
      const err = new Error('已停止')
      err.name = 'AbortError'
      throw err
    }
  }

  ac.onEvent({ type: 'turn/start', ts: Date.now(), sessionId: ac.sessionId })
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      throwIfAborted()
      ac.onPhase?.({ kind: 'thinking' })

      const res = await ac.llm.call({
        messages,
        tools: ac.tools.list(),
        signal,
        onDelta: ac.onStream,
        onThinking: ac.onThinking,
        model: ac.model,
        onUsage: ac.onUsage,
      })

      if (res.content) {
        const ev: SessionEvent = {
          type: 'assistant/message',
          ts: Date.now(),
          sessionId: ac.sessionId,
          content: res.content,
        }
        ac.onEvent(ev)
        messages.push({ role: 'assistant', content: res.content, reasoning: res.reasoning })
      }

      if (!res.toolCalls.length) {
        // 空响应（无论 length 截断还是端点异常返回 stop+空）均自动续跑：注入一次性引导，
        // 让模型跳过冗长推理直接产出。实测部分第三方端点长思考后返回 stop + 空内容而非
        // 规范的 length，故不能只认 length。连续上限 2 次，仍失败则落盘提示终止。
        if (!res.content && continuations < 2) {
          continuations++
          messages.push({ role: 'user', content: TRUNCATION_CONTINUATION_PROMPT })
          continue
        }
        // 续跑仍失败：落盘提示让用户看到原因，不再静默结束
        if (!res.content) {
          const truncated = res.finishReason === 'length'
          const hint = truncated
            ? '本轮回复被输出上限截断（已自动重试仍为空）：推理模型的思考与回答共享 max_tokens 配额。请在 设置 → 模型 中调大该通道的「最大输出 token 数」（建议 ≥ 8192）后重试。'
            : '模型连续多次未返回任何内容（已自动重试）：可能是端点异常或上下文过长。可重试、精简需求，或在 设置 → 模型 中调大「最大输出 token 数」后再试。'
          ac.onEvent({
            type: 'system/message',
            ts: Date.now(),
            sessionId: ac.sessionId,
            content: hint,
          })
        }
        break
      }

      messages.push({
        role: 'assistant',
        content: res.content ?? '',
        reasoning: res.reasoning,
        tool_calls: toWireToolCalls(res.toolCalls),
      })

      for (const tc of res.toolCalls) {
        throwIfAborted()
        ac.onPhase?.({ kind: 'tool', name: tc.name })
        const input = safeParseArguments(tc.arguments)
        ac.onEvent({
          type: 'tool/call',
          ts: Date.now(),
          sessionId: ac.sessionId,
          id: tc.id,
          tool: tc.name,
          input,
        })
        let result: ToolExecution
        try {
          result = await ac.executeTool(tc.name, input)
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
        ac.onEvent({
          type: 'tool/result',
          ts: Date.now(),
          sessionId: ac.sessionId,
          id: tc.id,
          tool: tc.name,
          ok: result.ok,
          output: result.output,
          error: result.error,
        })
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.ok
            ? typeof result.output === 'string'
              ? result.output
              : JSON.stringify(result.output)
            : `ERROR: ${result.error ?? 'unknown'}`,
        })
      }
    }
    ac.onPhase?.({ kind: 'done' })
  } finally {
    ac.onEvent({ type: 'turn/end', ts: Date.now(), sessionId: ac.sessionId })
  }
}
