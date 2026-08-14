/**
 * harness-base：装配插件。
 * 提供 ctx.sandbox / ctx.approval / ctx.sessions / ctx.tools / ctx.llm 服务，
 * 以及 session/event 事件域。P1 将各服务替换为 dsh 官方包。
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { ApprovalService, type ApprovalStore } from './approval'
import { SandboxPolicy, type SandboxScope } from './sandbox'
import { SessionLog } from './session-log'
import { DeepSeekAdapter, createLlmCaller, type LlmCaller } from './llm'
import { toolsCompatPlugin, type ToolApprovalRequest, type ToolCompatFacade } from './dsh-tools'
import { shouldLog, type LogLevel } from './log'
import type { LLMConfig, SessionEvent } from './types'

export * from './types'
export * from './sandbox'
export * from './approval'
export * from './session-log'
export * from './log'
export * from './tools'
export * from './llm'
export * from './dsh-tools'
export * from './agent-loop'

export interface HarnessConfig {
  sandbox: SandboxScope
  sessionDir: string
  approvalStore: ApprovalStore
  /** 按 provider 返回端点/凭据/默认模型 */
  getLLMConfig(provider: string): LLMConfig
  /** 全部 provider id（注册模型路由） */
  providerIds: string[]
  /** 默认提供方 id（会话未指定模型时） */
  defaultProvider(): string
  /** 默认模型（defaultProvider 下） */
  defaultModel(): string
  /** 工具执行审批钩子（tools/pre-execute 瀑布）；默认放行 */
  approveTool?(request: ToolApprovalRequest): Promise<'allow' | 'deny'>
  /** 日志级别（默认 info） */
  logLevel?: LogLevel
}

export function harnessServicesPlugin(cfg: HarnessConfig): Plugin.Object {
  return {
    name: 'harness-base',
    apply(ctx: Context) {
      const sandbox = new SandboxPolicy(cfg.sandbox)
      const approval = new ApprovalService(cfg.approvalStore)
      const sessions = new SessionLog(cfg.sessionDir)

      // llm seam（Stage 2）：官方 LlmRuntime + DeepSeek 适配器（多 provider 路由）
      const llmRuntime = new LlmRuntime(ctx)
      llmRuntime.registerAdapter(
        cfg.providerIds,
        new DeepSeekAdapter((provider) => cfg.getLLMConfig(provider)),
      )
      const llmCaller = createLlmCaller(llmRuntime, {
        getConfig: (provider) => cfg.getLLMConfig(provider),
        defaultProvider: () => cfg.defaultProvider(),
        defaultModel: () => cfg.defaultModel(),
      })

      // llm/stream 瀑布监听：可观测性（Stage 3+ 可挂重试/路由）
      const minLevel = cfg.logLevel ?? 'info'
      ctx.on(
        'llm/stream',
        async function* (options, next) {
          if (shouldLog('info', minLevel)) {
            console.info(`[dsh] llm/stream ${options.provider}/${options.model}`)
          }
          const t0 = Date.now()
          try {
            yield* next()
          } finally {
            if (shouldLog('info', minLevel)) {
              console.info(`[dsh] llm/stream 完成 ${Date.now() - t0}ms`)
            }
          }
        },
      )

      // tools seam（Stage 3）：官方 ToolRuntime + 审批瀑布
      ctx.plugin(toolsCompatPlugin({ approve: cfg.approveTool }))

      ctx.reflect.provide('sandbox', sandbox)
      ctx.reflect.provide('approval', approval)
      ctx.reflect.provide('sessionLog', sessions)
      ctx.reflect.provide('llmCaller', llmCaller)
      // toolsCompat 由 toolsCompatPlugin 提供（同一门面对象，类型归属我方）
    },
  }
}

/** 广播工具：把事件写入日志并同步发到事件总线（UI 订阅渲染） */
export function sessionEventSink(ctx: Context): (e: SessionEvent) => void {
  return (e) => {
    void ctx.sessionLog.append(e.sessionId, e)
    ctx.emit('dsh/session/event', e)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandbox: SandboxPolicy
    approval: ApprovalService
    /** 自研会话日志（官方 dsh-session 的 ctx.sessions 留给 Stage 4 迁移） */
    sessionLog: SessionLog
    /** 官方 LlmRuntime（dsh-llm 自带类型增强），agent loop 经 llmCaller 消费 */
    llmCaller: LlmCaller
    /** 工具兼容门面（Stage 3：官方 ToolRuntime 流水线 + 本地定义映射；官方 ctx.tools 留给 3b） */
    toolsCompat: ToolCompatFacade
  }
  interface Events {
    /** 自研会话事件（官方 session/event 词汇留给 Stage 4） */
    'dsh/session/event': (e: SessionEvent) => void
    /** 宿主打开审批弹窗（UI 阶段状态联动） */
    'dsh/waiting-approval': (targetPath: string) => void
    /** 设置保存后广播（对话面板据此刷新模型/智能体选择） */
    'dsh/settings-updated': (key: string) => void
  }
}
