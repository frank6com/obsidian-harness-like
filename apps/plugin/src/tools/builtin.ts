/**
 * 内置 vault 工具（P0）：read_note / write_note / search_notes。
 * 写操作经过沙箱白名单 + 审批钩子（宿主注入弹窗逻辑）。
 */

import type { Plugin } from '@deepseek-ai/cordis'
import type { WriteDecision } from '@dsh-obsidian/harness-base'

export interface BuiltinToolsOptions {
  /** 写操作审批钩子：返回 allow / deny（内部处理弹窗与会话级开关） */
  askWriteApproval(targetPath: string): Promise<WriteDecision>
}

export function builtinToolsPlugin(opts: BuiltinToolsOptions): Plugin.Object {
  return {
    name: 'builtin-vault-tools',
    inject: ['vault', 'sandbox', 'tools'],
    apply(ctx) {
      // 全部注册包进单个 effect：fiber 卸载时逆序撤销（Cordis 可逆副作用纪律）
      ctx.effect(() => [
        ctx.tools.register({
          name: 'read_note',
          description: '读取 vault 中一篇笔记的完整内容',
          input: {
            type: 'object',
            properties: { path: { type: 'string', description: '笔记路径，如 "Inbox/想法.md"' } },
            required: ['path'],
          },
          async execute(input) {
            const path = String(input.path ?? '')
            return { content: await ctx.vault.read(path) }
          },
        }),

        ctx.tools.register({
          name: 'write_note',
          description: '写入或覆盖 vault 中的一篇笔记（需审批）',
          input: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '笔记路径' },
              content: { type: 'string', description: '完整笔记内容' },
            },
            required: ['path', 'content'],
          },
          async execute(input) {
            const path = String(input.path ?? '')
            const content = String(input.content ?? '')
            ctx.sandbox.assertWrite(path)
            const decision = await opts.askWriteApproval(path)
            if (decision === 'deny') throw new Error('写操作被拒绝')
            await ctx.vault.write(path, content)
            return { ok: true, path }
          },
        }),

        ctx.tools.register({
          name: 'search_notes',
          description: '按文件名/标题搜索笔记（v1：文件名匹配，无全文索引）',
          input: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索词' },
              limit: { type: 'number', description: '返回条数，默认 10，最多 50' },
            },
            required: ['query'],
          },
          execute(input) {
            const q = String(input.query ?? '').toLowerCase()
            const limit = Math.max(1, Math.min(50, Number(input.limit ?? 10)))
            const hits = ctx.vault
              .listMarkdown()
              .filter((p) => p.toLowerCase().includes(q))
              .slice(0, limit)
            return { hits }
          },
        }),
      ])
    },
  }
}
