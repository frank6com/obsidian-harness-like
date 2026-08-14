/**
 * tools seam（Stage 3）：集成官方 @deepseek-ai/dsh-tools。
 *
 * - ToolRuntime 完整流水线（pre-execute → guard → execute → post-execute → result）
 * - 审批迁移到 tools/pre-execute 瀑布（dsh 语义：deny 物化为错误结果）
 * - 兼容层：工具定义暂用自研 ToolDef 形状（defineTool 迁移留给插件作者渐进跟进），
 *   get/list 走本地映射，execute 走官方流水线
 * - 最小 systemPrompt 垫片：ToolRuntime 构造即调用 ctx.systemPrompt.tools()
 *   （不装 dsh-system-prompt 包，避免 rc.1 依赖线风险；接 agent-loop 后可去垫片）
 */

import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { ToolDef } from './types'

export interface ToolApprovalRequest {
  name: string
  arguments: unknown
  signal: AbortSignal
}

export interface ToolsCompatOptions {
  /** pre-execute 审批钩子（瀑布监听器内调用）；默认放行 */
  approve?(request: ToolApprovalRequest): Promise<'allow' | 'deny'>
}

/** agent loop 消费面：列工具 + 经官方流水线执行 */
export interface ToolRunner {
  list(): ToolDef[]
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>
}

/** ctx.tools 兼容门面：注册/查询走本地映射，执行走官方流水线 */
export interface ToolCompatFacade extends ToolRunner {
  register(def: ToolDef): () => void
  get(name: string): ToolDef | undefined
}

/** 兼容层输出声明：内置/示例工具均返回对象；render 投影为文本块 */
const TOOL_OUTPUT_SCHEMA = { type: 'object' }

function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
}

export function toolsCompatPlugin(options: ToolsCompatOptions = {}): Plugin.Object {
  return {
    name: 'tools-compat',
    apply(ctx: Context) {
      // ToolRuntime 构造即调用 ctx.systemPrompt.tools()——最小垫片
      if (!ctx.get('systemPrompt')) {
        ctx.reflect.provide('systemPrompt', {
          tools: () => ({ dispose: () => {} }),
          section: () => ({ dispose: () => {} }),
        })
      }
      const runtime = new ToolRuntime(ctx)

      // 审批：tools/pre-execute 瀑布
      ctx.on('tools/pre-execute', async (exec, next) => {
        if (options.approve) {
          const decision = await options.approve({
            name: exec.name,
            arguments: exec.arguments,
            signal: exec.signal,
          })
          if (decision === 'deny') return { kind: 'deny', reason: '用户拒绝执行' }
        }
        return next()
      })

      const defs = new Map<string, ToolDef>()
      const facade: ToolCompatFacade = {
        register(def: ToolDef): () => void {
          if (defs.has(def.name)) throw new Error(`工具已注册: ${def.name}`)
          const definition: ToolDefinition = {
            name: def.name,
            description: def.description,
            parameters: def.input as ToolSchema['parameters'],
            output: {
              schema: TOOL_OUTPUT_SCHEMA as never,
              render: renderValue,
            },
            execute: async (args) => def.execute(args as Record<string, unknown>),
          }
          const disposer = runtime.register(definition)
          defs.set(def.name, def)
          return () => {
            try {
              disposer()
            } catch (err) {
              console.warn(`[dsh] 工具注销失败（忽略）: ${def.name}`, err)
            } finally {
              // 无论官方注销是否抛错，本地映射必须清理，否则重载报"工具已注册"
              defs.delete(def.name)
            }
          }
        },
        get(name: string): ToolDef | undefined {
          return defs.get(name)
        },
        list(): ToolDef[] {
          return [...defs.values()]
        },
        execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
          return runtime.execute(input)
        },
      }

      // 门面以 toolsCompat 为键（官方 ctx.tools 类型留给 Stage 3b 的 ToolRuntime）
      ctx.reflect.provide('toolsCompat', facade)
    },
  }
}
