/**
 * 冒烟测试：加载真实构建的示例插件产物（apps/plugin/examples/my-first-plugin/main.js），
 * 验证 require shim（@deepseek-ai/cordis → 宿主实例）、工具注册、命令注册与 dispose 撤销。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import { ToolRegistry } from '@harness-like/harness-base'
import { loadUserPlugin } from '@harness-like/plugin-runtime'

const exampleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples/my-first-plugin',
)
const entry = path.join(exampleDir, 'main.js')

const shim = (id: string): unknown => {
  if (id === '@deepseek-ai/cordis') return cordis
  return undefined
}

describe('示例插件真实产物冒烟', () => {
  it('跳过：未构建示例产物', () => {
    expect(fs.existsSync(entry)).toBe(true)
  })

  it('加载产物 → 注册工具与命令 → dispose 撤销', async () => {
    const ctx = new Context()
    const tools = new ToolRegistry()
    const added: string[] = []
    const notices: string[] = []

    ctx.reflect.provide('toolsCompat', tools)
    ctx.reflect.provide('vault', { listMarkdown: () => ['a.md', 'b.md'] })
    ctx.reflect.provide('workspace', { getActiveFile: () => 'a.md' })
    ctx.reflect.provide('commands', {
      addCommand: (cmd: { id: string }) => {
        added.push(cmd.id)
        return () => {} // 模仿 CommandsService：返回 disposer
      },
      removeCommand: () => {},
    })
    ctx.reflect.provide('notice', { notice: (m: string) => notices.push(m) })

    const loaded = await loadUserPlugin(ctx, exampleDir, { require: shim })
    expect(loaded.id).toBe('my-first-plugin')

    const tool = tools.get('count_notes')
    expect(tool).toBeDefined()
    expect(await tool!.execute({})).toEqual({ count: 2 })
    expect(added).toContain('my-first-plugin:dsh-example:hello')

    await loaded.fiber.dispose()
    expect(tools.get('count_notes')).toBeUndefined()
  })
})
