/**
 * plugin-runtime：用户 Cordis 插件（.obsidian/dsh-plugins/<id>/）的发现、加载与管理。
 *
 * 执行机制（设计文档 §5.5.1 定稿）：只执行本地预编译产物（main.js）。
 * 产物以 CJS 打包、@deepseek-ai/cordis 标记为 external，加载时经 require shim
 * 解析到宿主内同一个 Cordis 模块实例（保证 Context.is / Service 一致性）。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { Context, Plugin } from '@deepseek-ai/cordis'

export interface UserPluginManifest {
  id: string
  version: string
  entry: string
  name?: string
  description?: string
}

export function readPluginManifest(dir: string): UserPluginManifest {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
    description?: string
    dsh?: { id?: string; version?: string; entry?: string }
  }
  const dsh = pkg.dsh ?? {}
  const id = dsh.id ?? pkg.name
  if (!id) throw new Error(`插件缺少 dsh.id（${path.join(dir, 'package.json')}）`)
  const version = dsh.version ?? pkg.version ?? '0.0.0'
  return {
    id,
    version,
    entry: dsh.entry ?? 'main.js',
    name: pkg.name,
    description: pkg.description,
  }
}

export interface LoaderDeps {
  /** 解析外部模块：'@deepseek-ai/cordis' → 宿主内同一个模块实例 */
  require(id: string): unknown
}

export interface LoadedPlugin {
  id: string
  dir: string
  manifest: UserPluginManifest
  fiber: { dispose(): Promise<void> }
}

/** 读取并执行入口产物，挂载为 Cordis 插件 */
export async function loadUserPlugin(
  ctx: Context,
  dir: string,
  deps: LoaderDeps,
): Promise<LoadedPlugin> {
  const manifest = readPluginManifest(dir)
  const entryPath = path.join(dir, manifest.entry)
  const code = await fs.promises.readFile(entryPath, 'utf8')

  const module = { exports: {} as Record<string, unknown> }
  const localRequire = (id: string): unknown => deps.require(id)
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', code)
  fn(module, module.exports, localRequire, dir, entryPath)

  const exported = (module.exports as { default?: unknown }).default ?? module.exports
  if (typeof exported !== 'function' && typeof (exported as { apply?: unknown } | null)?.apply !== 'function') {
    throw new Error(`插件 ${manifest.id} 的入口没有导出 Cordis 插件（需 default 导出或 { apply } 对象）`)
  }

  const fiber = ctx.plugin(exported as { apply(ctx: never): unknown }) as unknown as {
    dispose(): Promise<void>
  } & PromiseLike<unknown>
  await fiber
  return { id: manifest.id, dir, manifest, fiber }
}

export type PluginStatus = 'running' | 'stopped' | 'error'

export interface PluginRecord {
  id: string
  dir: string
  manifest?: UserPluginManifest
  status: PluginStatus
  error?: string
  loaded?: LoadedPlugin
}

export interface RuntimeOptions {
  pluginsDir: string
  require(id: string): unknown
}

export class PluginRuntime {
  private records = new Map<string, PluginRecord>()

  constructor(
    private ctx: Context,
    private opts: RuntimeOptions,
  ) {}

  /** 发现插件目录（跳过隐藏目录） */
  async discover(): Promise<string[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(this.opts.pluginsDir)
    } catch {
      return []
    }
    return names.filter((n) => !n.startsWith('.'))
  }

  /** 只读检查：解析 manifest，不执行任何代码（用于授权前展示） */
  inspect(id: string): PluginRecord {
    const dir = path.join(this.opts.pluginsDir, id)
    const rec: PluginRecord = { id, dir, status: 'stopped' }
    try {
      rec.manifest = readPluginManifest(dir)
    } catch (err) {
      rec.status = 'error'
      rec.error = err instanceof Error ? err.message : String(err)
    }
    return rec
  }

  /** 加载（含 manifest 解析与入口执行）；失败返回 error 记录而非抛出 */
  async load(id: string): Promise<PluginRecord> {
    const dir = path.join(this.opts.pluginsDir, id)
    const base: PluginRecord = { id, dir, status: 'error' }
    try {
      base.manifest = readPluginManifest(dir)
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err)
      this.records.set(id, base)
      return base
    }
    try {
      const loaded = await loadUserPlugin(this.ctx, dir, { require: this.opts.require })
      const rec: PluginRecord = { id, dir, manifest: loaded.manifest, status: 'running', loaded }
      this.records.set(id, rec)
      return rec
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err)
      this.records.set(id, base)
      return base
    }
  }

  async stop(id: string): Promise<void> {
    const rec = this.records.get(id)
    if (!rec?.loaded) return
    try {
      await rec.loaded.fiber.dispose()
    } finally {
      rec.status = 'stopped'
      rec.loaded = undefined
    }
  }

  async unload(id: string): Promise<void> {
    await this.stop(id)
    this.records.delete(id)
  }

  /** 卸载并删除插件目录（破坏性操作，调用方需先确认） */
  async removeDir(id: string): Promise<void> {
    await this.unload(id)
    await fs.promises.rm(path.join(this.opts.pluginsDir, id), { recursive: true, force: true })
  }

  list(): PluginRecord[] {
    return [...this.records.values()]
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(id)
  }
}

/** 装配插件：提供 ctx.pluginRuntime 服务 */
export function runtimePlugin(opts: RuntimeOptions): Plugin.Object {
  return {
    name: 'plugin-runtime',
    apply(ctx: Context) {
      ctx.reflect.provide('pluginRuntime', new PluginRuntime(ctx, opts))
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginRuntime: PluginRuntime
  }
}
