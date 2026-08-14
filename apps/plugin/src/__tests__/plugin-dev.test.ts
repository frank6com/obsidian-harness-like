/**
 * 插件创造模式工具测试：create_plugin / write_plugin_file / plugin_status /
 * reload_plugin / plugin_guide，全链路（建骨架 → 写纯 JS → 授权 → 加载 → 工具生效）。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import {
  ApprovalService,
  SandboxPolicy,
  toolsCompatPlugin,
} from '@dsh-obsidian/harness-base'
import { runtimePlugin } from '@dsh-obsidian/plugin-runtime'
import { pluginDevToolsPlugin } from '../tools/plugin-dev'

/** 基于真实文件系统的 vault stub（createFolder 需要真实目录） */
function fsVault(root: string) {
  const resolve = (p: string) => path.join(root, p)
  return {
    read: async (p: string) => fs.promises.readFile(resolve(p), 'utf8'),
    write: async (p: string, c: string) => {
      await fs.promises.mkdir(path.dirname(resolve(p)), { recursive: true })
      await fs.promises.writeFile(resolve(p), c, 'utf8')
    },
    create: async (p: string, c: string) => {
      await fs.promises.mkdir(path.dirname(resolve(p)), { recursive: true })
      await fs.promises.writeFile(resolve(p), c, 'utf8')
    },
    createFolder: async (p: string) => {
      await fs.promises.mkdir(resolve(p), { recursive: true })
    },
    delete: async () => {},
    rename: async () => {},
    getMarkdownPaths: () => [],
    on: () => ({ unref: () => {} }),
  }
}

async function setup(
  ensureGranted?: (id: string, version: string, description?: string) => Promise<boolean>,
) {
  const vaultRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-dev-'))
  const dataDir = path.join(vaultRoot, '.obsidian', 'dsh')
  const pluginsDir = path.join(vaultRoot, '.obsidian', 'dsh-plugins')
  const tempDir = path.join(dataDir, 'tmp')

  const ctx = new Context()
  ctx.reflect.provide('vault', fsVault(vaultRoot))
  ctx.reflect.provide('sandbox', new SandboxPolicy({ vaultRoot, dataDir, pluginsDir, tempDir }))
  ctx.reflect.provide('approval', new ApprovalService({ load: () => ({}), save: () => {} }))
  ctx.reflect.provide('notice', { notice: () => {} })

  await ctx.plugin(toolsCompatPlugin())
  await ctx.plugin(
    runtimePlugin({ pluginsDir, require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined) }),
  )
  await ctx.plugin(pluginDevToolsPlugin({ ensureGranted: ensureGranted ?? (async () => true) }))

  return { ctx, vaultRoot, pluginsDir }
}

const GEN_PLUGIN_JS = `const { Context } = require('@deepseek-ai/cordis')
module.exports = {
  name: 'gen-plugin',
  inject: ['toolsCompat', 'notice'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.toolsCompat.register({
        name: 'gen_hello',
        description: 'gen',
        input: { type: 'object', properties: {} },
        execute() { return { hello: 'world' } },
      }),
    ])
  },
}
`

describe('plugin_guide / create_plugin / write_plugin_file', () => {
  it('plugin_guide 返回指南', async () => {
    const { ctx } = await setup()
    const out = await ctx.toolsCompat.get('plugin_guide')!.execute({})
    expect((out as { guide: string }).guide).toContain('package.json')
    expect((out as { guide: string }).guide).toContain('toolsCompat')
  })

  it('create_plugin 建骨架（目录 + package.json）', async () => {
    const { ctx, pluginsDir } = await setup()
    const out = await ctx.toolsCompat.get('create_plugin')!.execute({
      id: 'gen-plugin',
      description: '测试插件',
    })
    expect(out).toMatchObject({ ok: true, plugin_id: 'gen-plugin' })
    const pkg = JSON.parse(
      await fs.promises.readFile(path.join(pluginsDir, 'gen-plugin', 'package.json'), 'utf8'),
    )
    expect(pkg.dsh).toEqual({ id: 'gen-plugin', version: '0.0.1', entry: 'main.js' })
    // 重复创建报已存在
    await expect(
      ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' }),
    ).rejects.toThrow(/插件已存在/)
  })

  it('create_plugin 拒绝非法 id', async () => {
    const { ctx } = await setup()
    await expect(
      ctx.toolsCompat.get('create_plugin')!.execute({ id: '../evil' }),
    ).rejects.toThrow(/插件 id 非法/)
  })

  it('write_plugin_file 写入插件文件', async () => {
    const { ctx, pluginsDir } = await setup()
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' })
    const out = await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: GEN_PLUGIN_JS,
    })
    expect(out).toMatchObject({ ok: true })
    const written = await fs.promises.readFile(path.join(pluginsDir, 'gen-plugin', 'main.js'), 'utf8')
    expect(written).toContain('gen_hello')
  })

  it('write_plugin_file 拒绝路径穿越', async () => {
    const { ctx, vaultRoot } = await setup()
    await expect(
      ctx.toolsCompat.get('write_plugin_file')!.execute({
        plugin_id: 'gen-plugin',
        file: '../evil.js',
        content: 'x',
      }),
    ).rejects.toThrow(/文件路径非法/)
    expect(fs.existsSync(path.join(vaultRoot, '.obsidian', 'evil.js'))).toBe(false)
  })
})

describe('plugin_status / reload_plugin', () => {
  async function createGenPlugin(ctx: Context) {
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: GEN_PLUGIN_JS,
    })
  }

  it('plugin_status 列出未加载插件', async () => {
    const { ctx } = await setup()
    await createGenPlugin(ctx)
    const out = await ctx.toolsCompat.get('plugin_status')!.execute({})
    expect(out).toEqual({
      count: 1,
      plugins: [{ id: 'gen-plugin', version: '0.0.1', status: 'stopped', error: undefined }],
    })
  })

  it('reload_plugin：授权后加载，工具生效', async () => {
    const granted: string[] = []
    const { ctx } = await setup(async (id) => {
      granted.push(id)
      return true
    })
    await createGenPlugin(ctx)
    const out = await ctx.toolsCompat.get('reload_plugin')!.execute({ plugin_id: 'gen-plugin' })
    expect(out).toMatchObject({ ok: true, status: 'running' })
    expect(granted).toEqual(['gen-plugin'])
    // 工具出现在注册表并可执行
    const hello = await ctx.toolsCompat.get('gen_hello')!.execute({})
    expect(hello).toEqual({ hello: 'world' })
    const status = await ctx.toolsCompat.get('plugin_status')!.execute({})
    expect(status).toMatchObject({ count: 1, plugins: [{ id: 'gen-plugin', status: 'running' }] })
  })

  it('reload_plugin：未授权则拒绝加载', async () => {
    const { ctx } = await setup(async () => false)
    await createGenPlugin(ctx)
    const out = await ctx.toolsCompat.get('reload_plugin')!.execute({ plugin_id: 'gen-plugin' })
    expect(out).toMatchObject({ ok: false, reason: '用户未授权，插件未加载' })
    expect(ctx.toolsCompat.get('gen_hello')).toBeUndefined()
  })

  it('reload_plugin：加载错误回传（可迭代诊断）', async () => {
    const { ctx } = await setup()
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: 'module.exports = 42\n',
    })
    const out = await ctx.toolsCompat.get('reload_plugin')!.execute({ plugin_id: 'gen-plugin' })
    expect(out).toMatchObject({ ok: false, status: 'error' })
    expect((out as { error?: string }).error).toBeTruthy()
  })

  it('pipeline 路径：含 undefined 字段的返回值通过 lossless JSON 校验（ChatView 实际路径）', async () => {
    const { ctx } = await setup()
    await createGenPlugin(ctx)
    // 经官方流水线执行（含 output 校验）——此前 plugin_status/reload_plugin 在此路径
    // 因返回对象含 error: undefined 被拒（用户环境复现）
    const status = await ctx.toolsCompat.execute({
      callId: 'call_9' as never,
      name: 'plugin_status',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(status.isError).toBe(false)
    const reload = await ctx.toolsCompat.execute({
      callId: 'call_10' as never,
      name: 'reload_plugin',
      arguments: { plugin_id: 'gen-plugin' },
      signal: new AbortController().signal,
    })
    expect(reload.isError).toBe(false)
  })
})
