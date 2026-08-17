/**
 * obsidian-adapter：Obsidian API → Cordis 服务。
 *
 * 服务清单（设计文档 §5.2）：vault / editor / workspace / commands / views / settings / notice。
 * 全部以 ctx.reflect.provide 注册，随插件 fiber 卸载自动撤销。
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { EditorLike, ObsidianApiLike } from './api'

export * from './api'

export interface SettingsIO {
  load(): unknown
  save(data: unknown): void
}

export class VaultService {
  constructor(
    private api: ObsidianApiLike,
    private ctx: Context,
  ) {
    for (const ev of ['modify', 'create', 'delete', 'rename'] as const) {
      const ref = api.vault.on(ev, (path, oldPath) => {
        ctx.emit(`vault/${ev}` as 'vault/modify', path, oldPath)
      })
      ctx.effect(() => () => ref.unref())
    }
  }

  read(path: string): Promise<string> {
    return this.api.vault.read(path)
  }

  write(path: string, content: string): Promise<void> {
    return this.api.vault.write(path, content)
  }

  create(path: string, content: string): Promise<void> {
    return this.api.vault.create(path, content)
  }

  createFolder(path: string): Promise<void> {
    return this.api.vault.createFolder(path)
  }

  delete(path: string): Promise<void> {
    return this.api.vault.delete(path)
  }

  rename(oldPath: string, newPath: string): Promise<void> {
    return this.api.vault.rename(oldPath, newPath)
  }

  /** 全部 markdown 笔记路径（vault 相对路径列表） */
  listMarkdown(): string[] {
    return this.api.vault.getMarkdownPaths()
  }

  /** 全部 markdown 笔记路径（直观别名，插件作者常用名） */
  getMarkdownPaths(): string[] {
    return this.listMarkdown()
  }
}

export class EditorService {
  private provider: () => EditorLike | null = () => null

  /** 由 apps/plugin 桥接层注入真实编辑器访问器 */
  setProvider(provider: () => EditorLike | null): void {
    this.provider = provider
  }

  get activeEditor(): EditorLike | null {
    return this.provider()
  }

  getActiveFile(): string | null {
    return this.provider()?.filePath ?? null
  }

  insertText(text: string): void {
    this.provider()?.insertText(text)
  }

  replaceSelection(text: string): void {
    this.provider()?.replaceSelection(text)
  }

  getSelection(): string | null {
    return this.provider()?.getSelection() ?? null
  }
}

export class WorkspaceService {
  constructor(
    private api: ObsidianApiLike,
    private ctx: Context,
  ) {
    const ref = api.workspace.onFileOpen((path) => ctx.emit('workspace/file-open', path))
    ctx.effect(() => () => ref.unref())
  }

  getActiveFile(): string | null {
    return this.api.workspace.getActiveFile()
  }
}

export class CommandsService {
  constructor(private api: ObsidianApiLike) {}

  addCommand(cmd: import('./api').CommandLike): () => void {
    // 注意：Obsidian 的 app.commands.addCommand 返回 undefined（bundle 确认），
    // 不能依赖返回值；卸载用传入的 cmd.id（loader 已加插件前缀）
    this.api.commands.addCommand(cmd)
    const id = cmd.id
    // 卸载必须不抛错：Obsidian 的 removeCommand 对缺失命令会抛错，
    // 而 cordis 的 dispose 链遇错即断，会阻断后续 disposer（如工具注销）
    return () => {
      try {
        this.api.commands.removeCommand(id)
      } catch (err) {
        console.warn('[harness-like] 命令卸载失败（忽略）:', err)
      }
    }
  }

  /** 执行任意已注册命令（含 Obsidian 核心插件命令，如 templates:insert-template） */
  execute(id: string): void {
    this.api.commands.executeCommandById(id)
  }
}

export class ViewsService {
  constructor(private api: ObsidianApiLike) {}

  registerView(type: string, creator: unknown): () => void {
    this.api.viewRegistry.registerView(type, creator)
    return () => {
      try {
        // 先关闭该类型所有打开的 leaf：Obsidian 拒绝注销使用中的视图类型，
        // 若在此抛错会中断 Cordis 串行 dispose 链，导致 ribbon/命令等后续 disposer 不执行
        for (const leaf of this.api.workspace.getLeavesOfType(type)) leaf.detach()
        this.api.viewRegistry.unregisterView(type)
      } catch (err) {
        console.warn('[dsh] 视图卸载失败（忽略）:', err)
      }
    }
  }

  /** 打开（或聚焦）已注册类型的视图面板 */
  open(type: string): void {
    this.api.viewRegistry.openView(type)
  }
}

export class SettingsService {
  private data: Record<string, unknown>

  constructor(
    io: SettingsIO,
    private api: ObsidianApiLike,
  ) {
    const loaded = io.load()
    this.data = loaded && typeof loaded === 'object' ? (loaded as Record<string, unknown>) : {}
    this.io = io
  }

  private io: SettingsIO

  get<K>(key: string, fallback: K): K {
    return (this.data[key] as K | undefined) ?? fallback
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
    this.io.save(this.data)
  }

  /** 注册插件自己的设置页（SettingsTab）；随宿主插件卸载自动移除 */
  registerSettingTab(tab: unknown): void {
    this.api.settingsUi.addSettingTab(tab)
  }
}

/** 侧边栏 ribbon 图标服务（插件可注册，随 fiber 卸载自动移除） */
export class RibbonService {
  constructor(private api: ObsidianApiLike) {}

  addRibbonIcon(icon: string, title: string, callback: () => void): () => void {
    const handle = this.api.ribbon.addRibbonIcon(icon, title, callback)
    return () => {
      try {
        handle.remove()
      } catch (err) {
        console.warn('[dsh] 图标卸载失败（忽略）:', err)
      }
    }
  }
}

/** 底部状态栏服务（插件可注册条目） */
export class StatusbarService {
  constructor(private api: ObsidianApiLike) {}

  addStatusBarItem(): { el: HTMLElement; remove(): void } {
    return this.api.statusbar.addStatusBarItem()
  }
}

export class NoticeService {
  constructor(private api: ObsidianApiLike) {}

  notice(message: string, timeout?: number): void {
    this.api.notice.notice(message, timeout)
  }
}

/** 装配插件：提供全部 Obsidian 适配服务 */
export function obsidianAdapterPlugin(
  api: ObsidianApiLike,
  settingsIO?: SettingsIO,
): Plugin.Object {
  return {
    name: 'obsidian-adapter',
    apply(ctx: Context) {
      const vault = new VaultService(api, ctx)
      const editor = new EditorService()
      const workspace = new WorkspaceService(api, ctx)
      const commands = new CommandsService(api)
      const views = new ViewsService(api)
      const settings = new SettingsService(
        settingsIO ?? { load: () => ({}), save: () => {} },
        api,
      )
      const notice = new NoticeService(api)
      const ribbon = new RibbonService(api)
      const statusbar = new StatusbarService(api)

      ctx.reflect.provide('vault', vault)
      ctx.reflect.provide('editor', editor)
      ctx.reflect.provide('workspace', workspace)
      ctx.reflect.provide('commands', commands)
      ctx.reflect.provide('views', views)
      ctx.reflect.provide('settings', settings)
      ctx.reflect.provide('ribbon', ribbon)
      ctx.reflect.provide('statusbar', statusbar)
      ctx.reflect.provide('notice', notice)
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    vault: VaultService
    editor: EditorService
    workspace: WorkspaceService
    commands: CommandsService
    views: ViewsService
    settings: SettingsService
    ribbon: RibbonService
    statusbar: StatusbarService
    notice: NoticeService
  }
  interface Events {
    'vault/modify': (path: string, oldPath?: string) => void
    'vault/create': (path: string) => void
    'vault/delete': (path: string) => void
    'vault/rename': (path: string, oldPath?: string) => void
    'workspace/file-open': (path: string) => void
  }
}
