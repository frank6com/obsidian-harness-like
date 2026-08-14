/**
 * harness-base：装配插件。
 * 提供 ctx.sandbox / ctx.approval / ctx.sessions / ctx.tools / ctx.llm 服务，
 * 以及 session/event 事件域。P1 将各服务替换为 dsh 官方包。
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import { ApprovalService, type ApprovalStore } from './approval'
import { SandboxPolicy, type SandboxScope } from './sandbox'
import { SessionLog } from './session-log'
import { ToolRegistry } from './tools'
import { LLMClient } from './llm'
import type { LLMConfig, SessionEvent } from './types'

export * from './types'
export * from './sandbox'
export * from './approval'
export * from './session-log'
export * from './tools'
export * from './llm'
export * from './agent-loop'

export interface HarnessConfig {
  sandbox: SandboxScope
  sessionDir: string
  approvalStore: ApprovalStore
  getLLMConfig(): LLMConfig
}

export function harnessServicesPlugin(cfg: HarnessConfig): Plugin.Object {
  return {
    name: 'harness-base',
    apply(ctx: Context) {
      const sandbox = new SandboxPolicy(cfg.sandbox)
      const approval = new ApprovalService(cfg.approvalStore)
      const sessions = new SessionLog(cfg.sessionDir)
      const tools = new ToolRegistry()
      const llm = new LLMClient(cfg.getLLMConfig)

      ctx.reflect.provide('sandbox', sandbox)
      ctx.reflect.provide('approval', approval)
      ctx.reflect.provide('sessions', sessions)
      ctx.reflect.provide('tools', tools)
      ctx.reflect.provide('llm', llm)
    },
  }
}

/** 广播工具：把事件写入日志并同步发到事件总线（UI 订阅渲染） */
export function sessionEventSink(ctx: Context): (e: SessionEvent) => void {
  return (e) => {
    void ctx.sessions.append(e.sessionId, e)
    ctx.emit('session/event', e)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandbox: SandboxPolicy
    approval: ApprovalService
    sessions: SessionLog
    tools: ToolRegistry
    llm: LLMClient
  }
  interface Events {
    'session/event': (e: SessionEvent) => void
  }
}
