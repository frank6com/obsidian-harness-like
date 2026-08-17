/**
 * 内置 vault 工具（P0）：read_note / write_note / search_notes。
 * 写操作经过沙箱白名单 + 审批钩子（宿主注入弹窗逻辑）。
 */

import * as path from 'path'
import { exec } from 'node:child_process'
import type { Plugin } from '@deepseek-ai/cordis'

export interface BuiltinToolsOptions {
  /** 打开外部目标（系统浏览器 / 默认应用） */
  openTarget(target: string): Promise<void>
  /** 命令执行审批（宿主弹窗）；返回是否允许执行 */
  confirmCommand(command: string, cwd: string, fullAccess: boolean): Promise<boolean>
}

export function builtinToolsPlugin(opts: BuiltinToolsOptions): Plugin.Object {
  return {
    name: 'builtin-vault-tools',
    inject: ['vault', 'sandbox', 'toolsCompat', 'editor', 'settings'],
    apply(ctx) {
      // 全部注册包进单个 effect：fiber 卸载时逆序撤销（Cordis 可逆副作用纪律）
      ctx.effect(() => [
        ctx.toolsCompat.register({
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

        ctx.toolsCompat.register({
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
            // 纵深防御：审批在 tools/pre-execute 瀑布（harness 配置 approveTool），此处再守沙箱
            ctx.sandbox.assertWrite(path)
            await ctx.vault.write(path, content)
            return { ok: true, path }
          },
        }),

        ctx.toolsCompat.register({
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

        ctx.toolsCompat.register({
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

        ctx.toolsCompat.register({
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

        ctx.toolsCompat.register({
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

        ctx.toolsCompat.register({
          name: 'run_command',
          description:
            '执行 shell 命令（需用户在设置中开启「允许执行命令」，且每次调用都会请求用户审批；' +
            '默认工作目录 = vault 根目录，未开启「完全放行」时无法指定其他目录；带超时与输出上限）',
          input: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '要执行的 shell 命令' },
              cwd: { type: 'string', description: '可选：工作目录（仅开启「完全放行」后允许）' },
              timeout_ms: { type: 'number', description: '可选：超时毫秒数（默认 30000，范围 1000–120000）' },
            },
            required: ['command'],
          },
          async execute(input) {
            const enabled = ctx.settings.get('enableCommandTool', false) as boolean
            if (!enabled) {
              return { ok: false, error: 'run_command 未启用：请在设置 → 审批 中开启「允许执行命令」' }
            }
            const fullAccess = ctx.settings.get('commandFullAccess', false) as boolean
            const command = String(input.command ?? '').trim()
            if (!command) throw new Error('命令为空')
            const vaultRoot = ctx.sandbox.scope.vaultRoot
            let cwd = vaultRoot
            if (input.cwd) {
              if (!fullAccess) {
                return { ok: false, error: '指定工作目录需要先在设置中开启「完全放行」' }
              }
              cwd = String(input.cwd)
            }
            const timeout = Math.min(Math.max(Number(input.timeout_ms) || 30000, 1000), 120000)
            const allow = await opts.confirmCommand(command, cwd, fullAccess)
            if (!allow) return { ok: false, reason: '用户拒绝执行命令' }
            const r = await execCommand(command, cwd, timeout)
            return {
              ok: true,
              command,
              cwd,
              exit_code: r.code,
              timed_out: r.timedOut,
              stdout: truncate(r.stdout, 6000),
              stderr: truncate(r.stderr, 4000),
            }
          },
        }),
      ])
    },
  }
}

/** 执行命令并收集输出（超时由 exec 的 timeout 强制杀掉） */
function execCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code)
            : err
              ? null
              : 0
        resolve({ stdout, stderr, code, timedOut: Boolean((err as { killed?: boolean } | null)?.killed) })
      },
    )
  })
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + `\n…（已截断 ${text.length - max} 字符）` : text
}
