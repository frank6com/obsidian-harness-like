import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import { PluginRuntime, loadUserPlugin, readPluginManifest } from '../index'

async function tmpDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-loader-'))
}

function write(dir: string, rel: string, content: string): Promise<void> {
  const full = path.join(dir, rel)
  return fs.promises
    .mkdir(path.dirname(full), { recursive: true })
    .then(() => fs.promises.writeFile(full, content, 'utf8'))
}

describe('readPluginManifest', () => {
  it('读取 dsh 字段并回退到 package.json 字段', async () => {
    const dir = await tmpDir()
    await write(dir, 'package.json', JSON.stringify({ name: 'p1', dsh: { id: 'p1', version: '0.2.0' } }))
    const m = readPluginManifest(dir)
    expect(m).toMatchObject({ id: 'p1', version: '0.2.0', entry: 'main.js' })
  })

  it('缺少 id 时抛错', async () => {
    const dir = await tmpDir()
    await write(dir, 'package.json', JSON.stringify({}))
    expect(() => readPluginManifest(dir)).toThrow(/dsh.id/)
  })
})

describe('loadUserPlugin', () => {
  it('加载 CJS 产物，提供服务，dispose 后撤销', async () => {
    const dir = await tmpDir()
    await write(
      dir,
      'package.json',
      JSON.stringify({ dsh: { id: 'p1', version: '0.1.0', entry: 'main.js' } }),
    )
    // 模拟 esbuild 产物：external @deepseek-ai/cordis，运行时经 shim 注入
    await write(
      dir,
      'main.js',
      [
        `const { Context } = require('@deepseek-ai/cordis')`,
        `module.exports = {`,
        `  inject: [],`,
        `  apply(ctx) {`,
        `    ctx.reflect.provide('testSvc', { greeting: 'hello' })`,
        `  },`,
        `}`,
      ].join('\n'),
    )

    const ctx = new Context()
    // 直接引用宿主模块实例（等同 cordisShim）
    const cordis = await import('@deepseek-ai/cordis')
    const loaded = await loadUserPlugin(ctx, dir, { require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined) })

    expect(loaded.id).toBe('p1')
    const svc = ctx.get('testSvc') as { greeting?: string } | undefined
    expect(svc?.greeting).toBe('hello')

    await loaded.fiber.dispose()
    expect(ctx.get('testSvc')).toBeUndefined()
  })

  it('入口导出非法时抛错', async () => {
    const dir = await tmpDir()
    await write(dir, 'package.json', JSON.stringify({ dsh: { id: 'p2', entry: 'main.js' } }))
    await write(dir, 'main.js', `module.exports = 42`)
    const ctx = new Context()
    await expect(loadUserPlugin(ctx, dir, { require: () => undefined })).rejects.toThrow(/没有导出/)
  })
})

describe('PluginRuntime.load：视图类型运行时捕获优先', () => {
  it('静态扫描漏检（拼接表达式注册）时，运行态记录仍带 viewType 与 panel 能力', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-rt-'))
    const ctx = new Context()
    ctx.reflect.provide('views', {
      registerView: () => () => {},
      openView: () => {},
    })
    const rt = new PluginRuntime(ctx, { pluginsDir: root, require: () => undefined })

    const dir = path.join(root, 'expr-plugin')
    await write(dir, 'package.json', JSON.stringify({ dsh: { id: 'expr-plugin', version: '0.1.0' } }))
    // 拼接表达式注册：静态检测只得 panel 徽章，无 viewType → 管理器按钮曾消失
    await write(
      dir,
      'main.js',
      [
        `module.exports = {`,
        `  inject: ['views'],`,
        `  apply(ctx) {`,
        `    ctx.effect(() => ctx.views.registerView(['note', 'counter'].join('-'), () => ({})))`,
        `  },`,
        `}`,
      ].join('\n'),
    )
    const rec = await rt.load('expr-plugin')
    expect(rec.status).toBe('running')
    expect(rec.viewType).toBe('note-counter')
    expect(rec.capabilities).toContain('panel')

    // 停止后记录保留（徽章仍在），仅状态变化
    await rt.stop('expr-plugin')
    expect(rt.get('expr-plugin')?.viewType).toBe('note-counter')
  })

  it('字面量注册时静态与运行时一致，无冲突', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-rt-'))
    const ctx = new Context()
    ctx.reflect.provide('views', {
      registerView: () => () => {},
      openView: () => {},
    })
    const rt = new PluginRuntime(ctx, { pluginsDir: root, require: () => undefined })

    const dir = path.join(root, 'literal-plugin')
    await write(dir, 'package.json', JSON.stringify({ dsh: { id: 'literal-plugin', version: '0.1.0' } }))
    await write(
      dir,
      'main.js',
      [
        `module.exports = {`,
        `  inject: ['views'],`,
        `  apply(ctx) {`,
        `    ctx.effect(() => ctx.views.registerView('literal-view', () => ({})))`,
        `  },`,
        `}`,
      ].join('\n'),
    )
    const rec = await rt.load('literal-plugin')
    expect(rec.status).toBe('running')
    expect(rec.viewType).toBe('literal-view')
    expect(rec.capabilities).toContain('panel')
  })
})
