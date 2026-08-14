import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import { loadUserPlugin, readPluginManifest } from '../index'

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
