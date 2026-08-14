/**
 * 内置 vault 工具（P0）：read_note / write_note / search_notes。
 * 写操作经过沙箱白名单 + 审批钩子（宿主注入弹窗逻辑）。
 */

import * as path from 'path'
import type { Plugin } from '@deepseek-ai/cordis'
import type { WriteDecision } from '@dsh-obsidian/harness-base'

export interface BuiltinToolsOptions {
  /** 写操作审批钩子：返回 allow / deny（内部处理弹窗与会话级开关）；meta 携带内容预览 */
  askWriteApproval(targetPath: string, meta?: { preview?: string }): Promise<WriteDecision>
  /** 打开外部目标（系统浏览器 / 默认应用） */
  openTarget(target: string): Promise<void>
}

export function builtinToolsPlugin(opts: BuiltinToolsOptions): Plugin.Object {
  return {
    name: 'builtin-vault-tools',
    inject: ['vault', 'sandbox', 'tools', 'editor'],
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
            const decision = await opts.askWriteApproval(path, { preview: content.slice(0, 200) })
            if (decision === 'deny') throw new Error('写操作被拒绝')
            await ctx.vault.write(path, content)
            return { ok: true, path }
          },
        }),

        ctx.tools.register({
          name: 'list_notes',
          description: '列出 vault 中全部 markdown 笔记路径（可按文件夹过滤、限量）',
          input: {
            type: 'object',
            properties: {
              folder: { type: 'string', description: '可选：只列出该文件夹下的笔记，如 "Inbox"' },
              limit: { type: 'number', description: '返回条数上限，默认 100，最多 500' },
            },
          },
          execute(input) {
            const base = String(input.folder ?? '').replace(/\/+$/, '')
            const limit = Math.max(1, Math.min(500, Number(input.limit ?? 100)))
            const all = ctx.vault.listMarkdown()
            const filtered = base ? all.filter((p) => p.startsWith(base + '/')) : all
            return { count: filtered.length, notes: filtered.slice(0, limit) }
          },
        }),

        ctx.tools.register({
          name: 'open_in_browser',
          description: '在系统默认浏览器中打开 vault 内的文件（如 HTML 笔记）',
          input: {
            type: 'object',
            properties: { path: { type: 'string', description: '笔记/文件路径' } },
            required: ['path'],
          },
          async execute(input) {
            const rel = String(input.path ?? '')
            const decision = ctx.sandbox.decide(rel, 'read')
            if (!decision.allowed) throw new Error(decision.reason ?? '沙箱拒绝访问该路径')
            const abs = path.isAbsolute(rel) ? path.normalize(rel) : path.join(ctx.sandbox.scope.vaultRoot, rel)
            await opts.openTarget(abs)
            return { ok: true, opened: abs }
          },
        }),

        ctx.tools.register({
          name: 'insert_to_editor',
          description: '把文本插入当前编辑器光标处（用户可见、可撤销，无需审批）',
          input: {
            type: 'object',
            properties: { content: { type: 'string', description: '要插入的文本' } },
            required: ['content'],
          },
          execute(input) {
            const editor = ctx.editor.activeEditor
            if (!editor) throw new Error('当前没有打开的编辑器')
            const content = String(input.content ?? '')
            if (!content) throw new Error('内容为空')
            editor.replaceSelection(content)
            return { ok: true, inserted: content.length }
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
