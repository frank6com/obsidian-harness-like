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
} from '@harness-like/harness-base'
import { runtimePlugin } from '@harness-like/plugin-runtime'
import { PluginBackups } from '../plugin-backups'
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
  confirmOverwrite?: (pluginId: string, file: string) => Promise<boolean>,
) {
  const vaultRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-dev-'))
  const dataDir = path.join(vaultRoot, '.obsidian', 'dsh')
  const pluginsDir = path.join(vaultRoot, '.obsidian', 'harness-like-plugins')
  const tempDir = path.join(dataDir, 'tmp')

  const ctx = new Context()
  ctx.reflect.provide('vault', fsVault(vaultRoot))
  ctx.reflect.provide('sandbox', new SandboxPolicy({ vaultRoot, configDir: '.obsidian', dataDir, pluginsDir, tempDir }))
  ctx.reflect.provide('approval', new ApprovalService({ load: () => ({}), save: () => {} }))
  ctx.reflect.provide('notice', { notice: () => {} })
  ctx.reflect.provide('pluginBackups', new PluginBackups(path.join(dataDir, 'plugin-backups')))
  const openedViews: string[] = []
  ctx.reflect.provide('views', {
    registerView: () => () => {},
    open: (type: string) => {
      openedViews.push(type)
    },
  } as never)

  await ctx.plugin(toolsCompatPlugin())
  await ctx.plugin(
    runtimePlugin({ pluginsDir, require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined) }),
  )
  await ctx.plugin(
    pluginDevToolsPlugin({
      ensureGranted: ensureGranted ?? (async () => true),
      confirmOverwrite: confirmOverwrite ?? (async () => true),
      confirmRestore: async () => true,
    }),
  )

  return { ctx, vaultRoot, pluginsDir, openedViews }
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

  it('write_plugin_file 覆盖已存在文件需确认：拒绝则不修改', async () => {
    const asks: string[] = []
    const { ctx, pluginsDir } = await setup(undefined, async (pid, file) => {
      asks.push(`${pid}/${file}`)
      return false
    })
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: 'original',
    })
    const out = await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: 'overwritten',
    })
    expect(out).toMatchObject({ ok: false, reason: '用户拒绝覆盖，文件未修改' })
    expect(asks).toEqual(['gen-plugin/main.js'])
    const content = await fs.promises.readFile(
      path.join(pluginsDir, 'gen-plugin', 'main.js'),
      'utf8',
    )
    expect(content).toBe('original')
  })

  it('write_plugin_file 覆盖确认通过后写入新内容', async () => {
    const { ctx, pluginsDir } = await setup(undefined, async () => true)
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: 'v1',
    })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: 'v2',
    })
    const content = await fs.promises.readFile(
      path.join(pluginsDir, 'gen-plugin', 'main.js'),
      'utf8',
    )
    expect(content).toBe('v2')
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

  it('open_view 打开面板视图', async () => {
    const { ctx, openedViews } = await setup()
    const out = await ctx.toolsCompat.get('open_view')!.execute({ type: 'note-count-view' })
    expect(out).toEqual({ ok: true, type: 'note-count-view' })
    expect(openedViews).toEqual(['note-count-view'])
  })

  it('plugin_status 列出未加载插件', async () => {
    const { ctx } = await setup()
    await createGenPlugin(ctx)
    const out = await ctx.toolsCompat.get('plugin_status')!.execute({})
    expect(out).toEqual({
      count: 1,
      // 写 main.js 后宿主自动递增版本号 → 0.0.2
      plugins: [{ id: 'gen-plugin', version: '0.0.2', status: 'stopped', error: undefined }],
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

  it('write_plugin_file 每次写入自动递增插件版本号（version + dsh.version）', async () => {
    const { ctx, pluginsDir } = await setup(undefined, async () => true)
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'ver-test' })
    const readPkg = async () =>
      JSON.parse(await fs.promises.readFile(path.join(pluginsDir, 'ver-test', 'package.json'), 'utf8'))
    expect((await readPkg()).version).toBe('0.0.1')
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'ver-test',
      file: 'main.js',
      content: 'module.exports = {}',
    })
    const pkg2 = await readPkg()
    expect(pkg2.version).toBe('0.0.2')
    expect(pkg2.dsh.version).toBe('0.0.2')
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'ver-test',
      file: 'main.js',
      content: 'module.exports = { v: 2 }',
    })
    expect((await readPkg()).version).toBe('0.0.3')
  })

  it('toolsCompat.unregister 按名注销后同名可重新注册（回滚用）', async () => {
    const { ctx } = await setup()
    ctx.toolsCompat.register({
      name: 'tmp_tool',
      description: 'x',
      input: { type: 'object' },
      execute: async () => ({ ok: 1 }),
    })
    expect(ctx.toolsCompat.get('tmp_tool')).toBeTruthy()
    expect(ctx.toolsCompat.unregister('tmp_tool')).toBe(true)
    expect(ctx.toolsCompat.get('tmp_tool')).toBeUndefined()
    expect(ctx.toolsCompat.unregister('tmp_tool')).toBe(false)
  })

  it('加载失败自动回滚新增工具注册：修复后重载不再报"工具已注册"', async () => {
    const { ctx } = await setup(undefined, async () => true)
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'leak-test' })
    const broken = `module.exports = { name: 'leak-test', inject: ['toolsCompat'], apply(ctx) {
      ctx.toolsCompat.register({ name: 'leaky_tool', description: 'x', input: { type: 'object' }, execute: async () => ({ ok: 1 }) })
      throw new Error('boom')
    } }`
    await ctx.toolsCompat.get('write_plugin_file')!.execute({ plugin_id: 'leak-test', file: 'main.js', content: broken })
    const r1 = await ctx.toolsCompat.get('reload_plugin')!.execute({ plugin_id: 'leak-test' })
    expect(r1).toMatchObject({ ok: false })
    // 修复后同名工具可重新注册（不再泄漏）
    const fixed = `module.exports = { name: 'leak-test', inject: ['toolsCompat'], apply(ctx) {
      ctx.toolsCompat.register({ name: 'leaky_tool', description: 'x', input: { type: 'object' }, execute: async () => ({ ok: 2 }) })
    } }`
    await ctx.toolsCompat.get('write_plugin_file')!.execute({ plugin_id: 'leak-test', file: 'main.js', content: fixed })
    const r2 = await ctx.toolsCompat.get('reload_plugin')!.execute({ plugin_id: 'leak-test' })
    expect(r2).toMatchObject({ ok: true, status: 'running' })
  })

  it('加载成功的记录附带能力检测（详情页徽章不再消失）', async () => {
    const { ctx } = await setup(undefined, async () => true)
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'gen-plugin' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'gen-plugin',
      file: 'main.js',
      content: GEN_PLUGIN_JS,
    })
    await ctx.toolsCompat.get('reload_plugin')!.execute({ plugin_id: 'gen-plugin' })
    const rec = ctx.pluginRuntime.get('gen-plugin')
    expect(rec).toBeTruthy()
    expect(rec!.capabilities).toContain('tools')
  })

describe('check_plugin 校验', () => {
  it('正常代码通过（ok=true，无 errors）', async () => {
    const { ctx } = await setup()
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'chk-ok', description: 'x' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'chk-ok',
      file: 'main.js',
      content:
        'module.exports = { name: "chk-ok", inject: ["notice"], apply(ctx) { ctx.notice.notice("hi") } }',
    })
    const out = (await ctx.toolsCompat.get('check_plugin')!.execute({ plugin_id: 'chk-ok' })) as {
      ok: boolean
      errors: string[]
    }
    expect(out.ok).toBe(true)
    expect(out.errors).toEqual([])
  })

  it('臆测方法名（vault.getFiles）被拦截并指路正确方法', async () => {
    const { ctx } = await setup()
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'chk-bad', description: 'x' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'chk-bad',
      file: 'main.js',
      content:
        'module.exports = { name: "x", inject: ["vault"], apply(ctx) { const f = ctx.vault.getFiles() } }',
    })
    const out = (await ctx.toolsCompat.get('check_plugin')!.execute({ plugin_id: 'chk-bad' })) as {
      ok: boolean
      errors: string[]
    }
    expect(out.ok).toBe(false)
    expect(out.errors.some((e) => e.includes('getFiles'))).toBe(true)
    expect(out.errors.some((e) => e.includes('getMarkdownPaths'))).toBe(true)
  })

  it('JS 语法错误被捕获', async () => {
    const { ctx } = await setup()
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'chk-syntax', description: 'x' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'chk-syntax',
      file: 'main.js',
      content: 'module.exports = { name: "x", apply(ctx) {',
    })
    const out = (await ctx.toolsCompat.get('check_plugin')!.execute({ plugin_id: 'chk-syntax' })) as {
      ok: boolean
      errors: string[]
    }
    expect(out.ok).toBe(false)
    expect(out.errors.some((e) => e.includes('JS 语法错误'))).toBe(true)
  })

  it('this.app 与全局 DOM 查询被拦截', async () => {
    const { ctx } = await setup()
    await ctx.toolsCompat.get('create_plugin')!.execute({ id: 'chk-app', description: 'x' })
    await ctx.toolsCompat.get('write_plugin_file')!.execute({
      plugin_id: 'chk-app',
      file: 'main.js',
      content:
        'module.exports = { name: "x", apply() { const w = this.app.workspace; document.querySelector(".workspace-ribbon") } }',
    })
    const out = (await ctx.toolsCompat.get('check_plugin')!.execute({ plugin_id: 'chk-app' })) as {
      ok: boolean
      errors: string[]
    }
    expect(out.ok).toBe(false)
    expect(out.errors.some((e) => e.includes('this.app'))).toBe(true)
    expect(out.errors.some((e) => e.includes('document.querySelector'))).toBe(true)
  })

  it('package.json 缺失时报错（未创建骨架直接校验）', async () => {
    const { ctx } = await setup()
    const out = (await ctx.toolsCompat.get('check_plugin')!.execute({ plugin_id: 'ghost' })) as {
      ok: boolean
      errors: string[]
    }
    expect(out.ok).toBe(false)
    expect(out.errors.some((e) => e.includes('package.json'))).toBe(true)
  })
})
