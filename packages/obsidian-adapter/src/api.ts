/**
 * Obsidian API 的结构化描述（不 import obsidian 包）。
 * apps/plugin 提供真实适配（toApiLike），测试可提供 mock。
 */

export interface EditorLike {
  readonly filePath: string | null
  insertText(text: string): void
  replaceSelection(text: string): void
  /** 当前选中文本（Obsidian Editor.getSelection 语义） */
  getSelection(): string | null
}

export interface VaultLike {
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  create(path: string, content: string): Promise<void>
  createFolder(path: string): Promise<void>
  delete(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  getMarkdownPaths(): string[]
  on(
    event: 'modify' | 'create' | 'delete' | 'rename',
    cb: (path: string, oldPath?: string) => void,
  ): { unref(): void }
}

export interface WorkspaceLike {
  getActiveFile(): string | null
  onFileOpen(cb: (path: string) => void): { unref(): void }
}

export interface CommandLike {
  id: string
  name: string
  checkCallback?(checking: boolean): boolean | void
  callback?(): void
}

export interface CommandsLike {
  addCommand(cmd: CommandLike): CommandLike
  removeCommand(id: string): void
}

export interface ViewRegistryLike {
  registerView(type: string, creator: unknown): void
  unregisterView(type: string): void
}

export interface NoticeLike {
  notice(message: string, timeout?: number): void
}

export interface ObsidianApiLike {
  vault: VaultLike
  workspace: WorkspaceLike
  commands: CommandsLike
  viewRegistry: ViewRegistryLike
  notice: NoticeLike
  /** 打开外部目标：http(s) 走系统浏览器，本地路径走默认应用（由桥接层实现） */
  openTarget(target: string): Promise<void>
}
