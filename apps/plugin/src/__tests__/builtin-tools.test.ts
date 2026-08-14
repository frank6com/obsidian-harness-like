/**
 * 内置工具测试：read_note / write_note（沙箱+审批）/ search_notes /
 * open_in_browser（沙箱+绝对路径）/ insert_to_editor（编辑器桥）。
 */

import { describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import { SandboxPolicy, ToolRegistry } from '@dsh-obsidian/harness-base'
import { EditorService } from '@dsh-obsidian/obsidian-adapter'
import { builtinToolsPlugin, type BuiltinToolsOptions } from '../tools/builtin'

async function setup() {
  const vaultRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-tools-'))
  const dataDir = path.join(vaultRoot, '.obsidian', 'dsh')
  const pluginsDir = path.join(vaultRoot, '.obsidian', 'dsh-plugins')
  const tempDir = path.join(dataDir, 'tmp')

  const ctx = new Context()
  const tools = new ToolRegistry()
  const sandbox = new SandboxPolicy({ vaultRoot, dataDir, pluginsDir, tempDir })
  const writes: Array<[string, string]> = []
  const inserted: string[] = []
  const opened: string[] = []

  ctx.reflect.provide('vault', {
    read: async (p: string) => `内容(${p})`,
    write: async (p: string, c: string) => {
      writes.push([p, c])
    },
    listMarkdown: () => ['Inbox/A.md', 'Inbox/B.md', '读书笔记.md'],
  })
  ctx.reflect.provide('sandbox', sandbox)
  ctx.reflect.provide('tools', tools)
  ctx.reflect.provide('editor', new EditorService())

  const options: BuiltinToolsOptions = {
    askWriteApproval: vi.fn(async () => 'allow' as const),
    openTarget: vi.fn(async (t: string) => {
      opened.push(t)
    }),
  }

  const fiber = ctx.plugin(builtinToolsPlugin(options))
  await fiber

  return { ctx, tools, sandbox, writes, inserted, opened, options, fiber, vaultRoot }
}

describe('read_note / search_notes', () => {
  it('read_note 读取笔记', async () => {
    const { ctx } = await setup()
    const out = await ctx.tools.get('read_note')!.execute({ path: 'a.md' })
    expect(out).toEqual({ content: '内容(a.md)' })
  })

  it('search_notes 按文件名过滤并限流', async () => {
    const { ctx } = await setup()
    const out = await ctx.tools.get('search_notes')!.execute({ query: 'inbox', limit: 1 })
    expect(out).toEqual({ hits: ['Inbox/A.md'] })
    const all = await ctx.tools.get('search_notes')!.execute({ query: '' })
    expect((all as { hits: string[] }).hits).toHaveLength(3)
  })
})

describe('write_note（沙箱 + 审批）', () => {
  it('审批 allow 时写入', async () => {
    const { ctx, writes, options } = await setup()
    const out = await ctx.tools.get('write_note')!.execute({ path: 'Inbox/x.md', content: 'hi' })
    expect(out).toEqual({ ok: true, path: 'Inbox/x.md' })
    expect(writes).toEqual([['Inbox/x.md', 'hi']])
    expect(options.askWriteApproval).toHaveBeenCalledWith('Inbox/x.md', { preview: 'hi' })
  })

  it('审批 deny 时抛错且不写入', async () => {
    const { ctx, writes, options } = await setup()
    vi.mocked(options.askWriteApproval).mockResolvedValueOnce('deny')
    await expect(
      ctx.tools.get('write_note')!.execute({ path: 'Inbox/x.md', content: 'hi' }),
    ).rejects.toThrow('写操作被拒绝')
    expect(writes).toHaveLength(0)
  })

  it('沙箱拒绝 .obsidian 配置区写入', async () => {
    const { ctx, writes } = await setup()
    await expect(
      ctx.tools.get('write_note')!.execute({ path: '.obsidian/app.json', content: '{}' }),
    ).rejects.toThrow(/沙箱拒绝/)
    expect(writes).toHaveLength(0)
  })
})

describe('open_in_browser（沙箱 + 绝对路径）', () => {
  it('vault 内文件转为绝对路径打开', async () => {
    const { ctx, opened, vaultRoot, options } = await setup()
    const out = await ctx.tools.get('open_in_browser')!.execute({ path: 'Inbox/x.html' })
    expect(out).toEqual({ ok: true, opened: path.join(vaultRoot, 'Inbox', 'x.html') })
    expect(opened).toEqual([path.join(vaultRoot, 'Inbox', 'x.html')])
    expect(options.openTarget).toHaveBeenCalledTimes(1)
  })

  it('拒绝 vault 外路径', async () => {
    const { ctx, opened } = await setup()
    await expect(
      ctx.tools.get('open_in_browser')!.execute({ path: '../../etc/passwd' }),
    ).rejects.toThrow(/沙箱拒绝|超出 vault/)
    expect(opened).toHaveLength(0)
  })
})

describe('insert_to_editor', () => {
  it('无活动编辑器时报错', async () => {
    const { ctx } = await setup()
    // execute 为同步函数，同步抛错；agent 循环内由 executeTool 的 try/catch 兜底
    expect(() =>
      ctx.tools.get('insert_to_editor')!.execute({ content: 'x' }),
    ).toThrow('当前没有打开的编辑器')
  })

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
    const out = await ctx.tools.get('insert_to_editor')!.execute({ content: 'hello' })
    expect(out).toEqual({ ok: true, inserted: 5 })
    expect(target).toBe('hello')
  })
})
