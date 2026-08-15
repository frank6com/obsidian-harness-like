/**
 * 插件重新加载回归测试。
 *
 * 背景：Obsidian 的 removeCommand 对缺失命令会抛错，而 cordis 的 dispose
 * 链是串行链——第一个抛错的 disposer 会阻断后续清理，导致工具门面的
 * defs 残留，重载时报"工具已注册：count_notes"。
 * 修复：CommandsService 卸载容错 + 门面清理 try/finally。
 * 本测试用真实 CommandsService + 抛错的 removeCommand 模拟该场景。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import { toolsCompatPlugin } from '@harness-like/harness-base'
import { CommandsService } from '@harness-like/obsidian-adapter'
import { runtimePlugin, loadUserPlugin } from '@harness-like/plugin-runtime'

async function setup(removeCommandThrows: boolean) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-reload-'))
  const pluginsDir = path.join(root, '.obsidian', 'dsh-plugins')
  const exampleDir = path.join(process.cwd(), 'apps/plugin/examples/my-first-plugin')

  const ctx = new Context()
  await ctx.plugin(toolsCompatPlugin())
  await ctx.plugin(
    runtimePlugin({ pluginsDir, require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined) }),
  )

  ctx.reflect.provide('vault', { listMarkdown: () => ['a.md'] })
  ctx.reflect.provide('workspace', { getActiveFile: () => null })
  ctx.reflect.provide('notice', { notice: () => {} })

  // 真实 CommandsService + 模拟 Obsidian 的 removeCommand 抛错行为
  const api = {
    commands: {
      addCommand: (cmd: { id: string }) => cmd,
      removeCommand: () => {
        if (removeCommandThrows) throw new Error('command does not exist')
      },
    },
  }
  ctx.reflect.provide('commands', new CommandsService(api as never))

  return { ctx, exampleDir }
}

const requireShim = (id: string): unknown =>
  id === '@deepseek-ai/cordis' ? cordis : undefined

describe('插件重新加载（dispose 链容错）', () => {
  it('removeCommand 抛错时重载仍成功（工具不残留）', async () => {
    const { ctx, exampleDir } = await setup(true)
    const first = await loadUserPlugin(ctx, exampleDir, { require: requireShim })
    expect(ctx.get('toolsCompat')?.get('count_notes')).toBeDefined()

    await first.fiber.dispose()
    expect(ctx.get('toolsCompat')?.get('count_notes')).toBeUndefined()

    // 重新加载不抛"工具已注册"
    const second = await loadUserPlugin(ctx, exampleDir, { require: requireShim })
    expect(ctx.get('toolsCompat')?.get('count_notes')).toBeDefined()
    await second.fiber.dispose()
  })

  it('正常路径（removeCommand 不抛错）重载也成功', async () => {
    const { ctx, exampleDir } = await setup(false)
    const first = await loadUserPlugin(ctx, exampleDir, { require: requireShim })
    await first.fiber.dispose()
    const second = await loadUserPlugin(ctx, exampleDir, { require: requireShim })
    expect(ctx.get('toolsCompat')?.get('count_notes')).toBeDefined()
    await second.fiber.dispose()
  })
})
