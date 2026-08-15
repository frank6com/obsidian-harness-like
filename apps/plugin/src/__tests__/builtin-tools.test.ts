/**
 * 内置工具测试（Stage 3 版）：挂载真实 toolsCompatPlugin（官方 ToolRuntime 流水线）。
 * 覆盖：注册/查询、直接执行（read/search/write 沙箱）、
 * 经流水线执行（approve allow/deny、未知工具）、open_in_browser、insert_to_editor。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import { SandboxPolicy, toolsCompatPlugin } from '@harness-like/harness-base'
import { EditorService } from '@harness-like/obsidian-adapter'
import { builtinToolsPlugin } from '../tools/builtin'

async function setup(
  approve?: (r: { name: string; arguments: unknown }) => Promise<'allow' | 'deny'>,
) {
  const vaultRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-tools-'))
  const dataDir = path.join(vaultRoot, '.obsidian', 'dsh')
  const pluginsDir = path.join(vaultRoot, '.obsidian', 'dsh-plugins')
  const tempDir = path.join(dataDir, 'tmp')

  const ctx = new Context()
  const sandbox = new SandboxPolicy({ vaultRoot, dataDir, pluginsDir, tempDir })
  const writes: Array<[string, string]> = []
  const opened: string[] = []

  ctx.reflect.provide('vault', {
    read: async (p: string) => `内容(${p})`,
    write: async (p: string, c: string): Promise<void> => {
      writes.push([p, c])
    },
    listMarkdown: () => ['Inbox/A.md', 'Inbox/B.md', '读书笔记.md'],
  })
  ctx.reflect.provide('sandbox', sandbox)
  ctx.reflect.provide('editor', new EditorService())

  await ctx.plugin(toolsCompatPlugin({ approve }))
  await ctx.plugin(builtinToolsPlugin({ openTarget: async (t): Promise<void> => { opened.push(t) } }))

  return { ctx, sandbox, writes, opened, vaultRoot }
}

const signal = () => new AbortController().signal

describe('read_note / search_notes / list_notes（直接执行）', () => {
  it('read_note 读取笔记', async () => {
    const { ctx } = await setup()
    const out = await ctx.toolsCompat.get('read_note')!.execute({ path: 'a.md' })
    expect(out).toEqual({ content: '内容(a.md)' })
  })

  it('search_notes 按文件名过滤并限流', async () => {
    const { ctx } = await setup()
    const out = await ctx.toolsCompat.get('search_notes')!.execute({ query: 'inbox', limit: 1 })
    expect(out).toEqual({ hits: ['Inbox/A.md'] })
    const all = await ctx.toolsCompat.get('search_notes')!.execute({ query: '' })
    expect((all as { hits: string[] }).hits).toHaveLength(3)
  })

  it('list_notes 列出全部并支持文件夹过滤与限量', async () => {
    const { ctx } = await setup()
    const all = await ctx.toolsCompat.get('list_notes')!.execute({})
    expect(all).toEqual({
      count: 3,
      notes: ['Inbox/A.md', 'Inbox/B.md', '读书笔记.md'],
    })
    const inbox = await ctx.toolsCompat.get('list_notes')!.execute({ folder: 'Inbox' })
    expect(inbox).toEqual({ count: 2, notes: ['Inbox/A.md', 'Inbox/B.md'] })
  })
})

describe('write_note（沙箱）', () => {
  it('沙箱拒绝 .obsidian 配置区写入（纵深防御）', async () => {
    const { ctx, writes } = await setup()
    await expect(
      ctx.toolsCompat.get('write_note')!.execute({ path: '.obsidian/app.json', content: '{}' }),
    ).rejects.toThrow(/沙箱拒绝/)
    expect(writes).toHaveLength(0)
  })
})

describe('经官方流水线执行（toolsCompat.execute）', () => {
  it('approve allow：执行成功并返回规范值', async () => {
    const { ctx, writes } = await setup(async () => 'allow')
    const result = await ctx.toolsCompat.execute({
      callId: 'call_1' as never,
      name: 'write_note',
      arguments: { path: 'Inbox/x.md', content: 'hi' },
      signal: signal(),
    })
    expect(result.isError).toBe(false)
    expect(writes).toEqual([['Inbox/x.md', 'hi']])
  })

  it('approve deny：物化为错误结果（工具体未执行）', async () => {
    const { ctx, writes } = await setup(async () => 'deny')
    const result = await ctx.toolsCompat.execute({
      callId: 'call_2' as never,
      name: 'write_note',
      arguments: { path: 'Inbox/x.md', content: 'hi' },
      signal: signal(),
    })
    expect(result.isError).toBe(true)
    expect((result as { error: { message: string } }).error.message).toContain('拒绝')
    expect(writes).toHaveLength(0)
  })

  it('approve 钩子收到工具名与参数', async () => {
    const seen: Array<{ name: string; arguments: unknown }> = []
    const { ctx } = await setup(async (r) => {
      seen.push({ name: r.name, arguments: r.arguments })
      return 'allow'
    })
    await ctx.toolsCompat.execute({
      callId: 'call_3' as never,
      name: 'read_note',
      arguments: { path: 'a.md' },
      signal: signal(),
    })
    expect(seen).toEqual([{ name: 'read_note', arguments: { path: 'a.md' } }])
  })

  it('未知工具：错误结果而非抛出', async () => {
    const { ctx } = await setup()
    const result = await ctx.toolsCompat.execute({
      callId: 'call_4' as never,
      name: 'no_such_tool',
      arguments: {},
      signal: signal(),
    })
    expect(result.isError).toBe(true)
  })
})

describe('open_in_browser', () => {
  it('vault 内文件转为绝对路径打开', async () => {
    const { ctx, opened, vaultRoot } = await setup()
    const out = await ctx.toolsCompat.get('open_in_browser')!.execute({ path: 'Inbox/x.html' })
    expect(out).toEqual({ ok: true, opened: path.join(vaultRoot, 'Inbox', 'x.html') })
    expect(opened).toEqual([path.join(vaultRoot, 'Inbox', 'x.html')])
  })

  it('拒绝 vault 外路径', async () => {
    const { ctx, opened } = await setup()
    await expect(
      ctx.toolsCompat.get('open_in_browser')!.execute({ path: '../../etc/passwd' }),
    ).rejects.toThrow(/沙箱拒绝|超出 vault/)
    expect(opened).toHaveLength(0)
  })
})

describe('insert_to_editor', () => {
  it('有编辑器时插入到光标处', async () => {
    const { ctx } = await setup()
    let target: string | null = null
    ctx.editor.setProvider(() => ({
      filePath: 'a.md',
      insertText: (t: string) => {
        target = t
      },
      replaceSelection: (t: string) => {
        target = t
      },
      getSelection: () => null,
    }))
    const out = await ctx.toolsCompat.get('insert_to_editor')!.execute({ content: 'hello' })
    expect(out).toEqual({ ok: true, inserted: 5 })
    expect(target).toBe('hello')
  })
})
