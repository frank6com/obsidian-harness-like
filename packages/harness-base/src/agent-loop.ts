/**
 * 最小 agent 循环（dsh turn/step 流程的薄实现；P1 替换为 @deepseek-ai/dsh-agent + agent-loop）。
 *
 * 流程：历史会话事件 → 消息列表 → llm.chat（可含工具调用）→ 顺序执行工具 →
 * 结果回填 → 继续下一轮，直到无工具调用或达到 maxTurns。
 * 持久事件经 onEvent 落盘；流式增量经 onStream 直达 UI（不落盘）。
 */

import type { LLMMessage, SessionEvent, ToolExecution } from './types'
import { LLMClient, type LLMTool } from './llm'
import { ToolRegistry } from './tools'

export interface AgentRunContext {
  sessionId: string
  llm: LLMClient
  tools: ToolRegistry
  /** 工具执行钩子：由宿主注入沙箱 + 审批 + UI 弹窗 */
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecution>
  /** 持久化事件（写入会话日志） */
  onEvent(event: SessionEvent): void
  /** 流式增量（UI 直接订阅） */
  onStream?(delta: string): void
  /** 历史事件（重建上下文） */
  history: SessionEvent[]
  /** 附加系统提示（如当前笔记上下文） */
  system?: string
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

export function buildMessages(history: SessionEvent[], system?: string): LLMMessage[] {
  const out: LLMMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const e of history) {
    if (e.type === 'user/message') {
      out.push({ role: 'user', content: e.content })
    } else if (e.type === 'assistant/message') {
      out.push({ role: 'assistant', content: e.content })
    } else if (e.type === 'tool/call') {
      out.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: e.id,
            name: e.tool,
            arguments: typeof e.input === 'string' ? e.input : JSON.stringify(e.input),
          },
        ],
      })
    } else if (e.type === 'tool/result') {
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
  return out
}

export function toLLMTools(tools: ToolDefLike[]): LLMTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input },
  }))
}

interface ToolDefLike {
  name: string
  description: string
  input: Record<string, unknown>
}

export async function runAgentLoop(ac: AgentRunContext): Promise<void> {
  const maxTurns = ac.maxTurns ?? 8
  const messages = buildMessages(ac.history, ac.system)

  ac.onEvent({ type: 'turn/start', ts: Date.now(), sessionId: ac.sessionId })

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await ac.llm.chat({
      messages,
      tools: toLLMTools(ac.tools.list()),
      signal: ac.signal,
      onDelta: ac.onStream,
    })

    if (res.content) {
      const ev: SessionEvent = {
        type: 'assistant/message',
        ts: Date.now(),
        sessionId: ac.sessionId,
        content: res.content,
      }
      ac.onEvent(ev)
      messages.push({ role: 'assistant', content: res.content })
    }

    if (!res.toolCalls.length) break

    messages.push({
      role: 'assistant',
      content: res.content ?? '',
      tool_calls: res.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
    })

    for (const tc of res.toolCalls) {
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

  ac.onEvent({ type: 'turn/end', ts: Date.now(), sessionId: ac.sessionId })
}
