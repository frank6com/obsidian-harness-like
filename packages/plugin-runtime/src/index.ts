/**
 * plugin-runtime：用户 Cordis 插件（.obsidian/harness-like-plugins/<id>/）的发现、加载与管理。
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
  /** 主插件 id：命令 id 统一以 `<主插件id>:<插件id>:` 起始（如 harness-like:note-counter:open-view） */
  hostId?: string
  /** 主插件显示名：命令显示名统一为 `<主插件名>: <命令名>（<插件id>）` */
  hostName?: string
}

export interface LoadedPlugin {
  id: string
  dir: string
  manifest: UserPluginManifest
  fiber: { dispose(): Promise<void> }
}

export interface PluginCapabilities {
  /** 能力标签：panel/ribbon/commands/tools/statusbar/settings */
  capabilities: string[]
  /** 第一个注册的面板视图类型（可快速打开） */
  viewType?: string
}

/** 静态检测插件产物的能力（扫描 main.js 文本中的注册调用） */
export function detectCapabilities(code: string): PluginCapabilities {
  const capabilities: string[] = []
  if (/registerView\s*\(/.test(code)) capabilities.push('panel')
  if (/addRibbonIcon\s*\(/.test(code)) capabilities.push('ribbon')
  if (/addCommand\s*\(/.test(code)) capabilities.push('commands')
  if (/toolsCompat\.register|ctx\.tools\.register/.test(code)) capabilities.push('tools')
  if (/addStatusBarItem\s*\(/.test(code)) capabilities.push('statusbar')
  if (/registerSettingTab/.test(code)) capabilities.push('settings')
  if (/protocol\.register\s*\(/.test(code)) capabilities.push('protocol')
  const m = code.match(/registerView\s*\(\s*['"]([^'"]+)['"]/)
  return { capabilities, viewType: m?.[1] }
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

  // 命令前缀强制（API 层）：不依赖插件作者自觉。
  // - 命令 id 统一为 `<主插件id>:<插件id>:<命令>`（如 harness-like:note-counter:open-view），
  //   用户按主插件名即可在命令面板找到全部功能；
  // - 命令显示名统一为 `<主插件名>: <命令名>（<插件id>）`（对齐 Obsidian 原生
  //   plugin.addCommand 的「插件名: 命令名」惯例，并附加来源子插件 id）。
  // 已带任意旧格式前缀（主插件/子插件）先剥离，避免重复。
  // 未提供 hostId（独立使用 plugin-runtime）时回退为 `<插件id>:` 前缀。
  const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hostId = deps.hostId
  const hostName = deps.hostName ?? deps.hostId
  const stripLeading = (s: string, prefix: string): string =>
    s.replace(new RegExp(`^${escapeRegExp(prefix)}:\\s*`), '')
  const bareCommandId = (id: string): string => {
    let out = id
    if (hostId) out = stripLeading(out, `${hostId}:${manifest.id}`)
    out = stripLeading(out, manifest.id)
    if (hostId) out = stripLeading(out, hostId)
    return out
  }
  const bareCommandName = (name: string): string => {
    let out = name
    if (hostId) out = stripLeading(out, `${hostId}:${manifest.id}`)
    out = stripLeading(out, manifest.id)
    if (hostName) out = stripLeading(out, hostName)
    return out.replace(new RegExp(`\\s*（${escapeRegExp(manifest.id)}）\\s*$`), '')
  }
  const baseCommands = ctx.get('commands') as
    | { addCommand(cmd: { id: string; name?: string }): unknown }
    | undefined
  // 协议动作强制携带来源插件 id（API 层，不依赖插件作者自觉）：
  // 子插件 ctx.protocol.register(cmd, handler) 经此包裹为
  // register(插件id, cmd, handler)，实际入口
  // obsidian://harness-like?plugin=<插件id>&cmd=<动作名>——防止冒充他人命名空间。
  const baseProtocol = ctx.get('protocol') as
    | { register(pluginId: string, action: string, handler: (params: Record<string, string>) => unknown): () => void }
    | undefined
  const pluginCtx =
    baseCommands || baseProtocol
      ? ctx.extend({
          ...(baseCommands
            ? {
                commands: {
                  addCommand: (cmd: { id: string; name?: string }) =>
                    baseCommands.addCommand({
                      ...cmd,
                      id: hostId
                        ? `${hostId}:${manifest.id}:${bareCommandId(cmd.id)}`
                        : `${manifest.id}:${bareCommandId(cmd.id)}`,
                      name: cmd.name
                        ? hostId
                          ? `${hostName}: ${bareCommandName(cmd.name)}（${manifest.id}）`
                          : `${manifest.id}: ${bareCommandName(cmd.name)}`
                        : cmd.name,
                    }),
                },
              }
            : {}),
          ...(baseProtocol
            ? {
                protocol: {
                  register: (action: string, handler: (params: Record<string, string>) => unknown) =>
                    baseProtocol.register(manifest.id, action, handler),
                },
              }
            : {}),
        })
      : ctx

  const fiber = pluginCtx.plugin(exported as { apply(ctx: never): unknown }) as unknown as {
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
  /** 静态检测的能力标签 */
  capabilities?: string[]
  /** 面板视图类型（可快速打开） */
  viewType?: string
}

export interface RuntimeOptions {
  pluginsDir: string
  require(id: string): unknown
  /** 主插件 id：命令 id 统一以 `<主插件id>:<插件id>:` 起始 */
  hostId?: string
  /** 主插件显示名：命令显示名统一为 `<主插件名>: <命令名>（<插件id>）` */
  hostName?: string
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

  /** 只读检查：解析 manifest + 能力检测，不执行任何代码（用于授权前展示） */
  inspect(id: string): PluginRecord {
    const dir = path.join(this.opts.pluginsDir, id)
    const rec: PluginRecord = { id, dir, status: 'stopped' }
    try {
      rec.manifest = readPluginManifest(dir)
      const entry = path.join(dir, rec.manifest.entry)
      const code = fs.readFileSync(entry, 'utf8')
      const detected = detectCapabilities(code)
      rec.capabilities = detected.capabilities
      rec.viewType = detected.viewType
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
    // 快照现有工具注册：插件 apply 中途抛错会泄漏新增的工具注册（下次加载报"工具已注册"）
    const tools = this.ctx.get('toolsCompat') as { list(): Array<{ name: string }>; unregister(name: string): boolean } | undefined
    const before = tools ? new Set(tools.list().map((t) => t.name)) : null
    try {
      const loaded = await loadUserPlugin(this.ctx, dir, {
        require: this.opts.require,
        hostId: this.opts.hostId,
        hostName: this.opts.hostName,
      })
      // 与 inspect() 一致：运行态记录也附带能力检测（否则 get() 优先时能力徽章消失）
      let capabilities: string[] = []
      let viewType: string | undefined
      try {
        const code = await fs.promises.readFile(path.join(dir, loaded.manifest.entry), 'utf8')
        const detected = detectCapabilities(code)
        capabilities = detected.capabilities
        viewType = detected.viewType
      } catch {
        // 能力检测失败不阻断加载
      }
      const rec: PluginRecord = {
        id,
        dir,
        manifest: loaded.manifest,
        status: 'running',
        loaded,
        capabilities,
        viewType,
      }
      this.records.set(id, rec)
      return rec
    } catch (err) {
      // 回滚本次加载新增的工具注册（apply 抛错时 Cordis 只能清理 effect 登记的副作用）
      if (tools && before) {
        for (const t of tools.list()) {
          if (!before.has(t.name)) {
            try {
              tools.unregister(t.name)
            } catch {
              // 忽略回滚异常
            }
          }
        }
      }
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
