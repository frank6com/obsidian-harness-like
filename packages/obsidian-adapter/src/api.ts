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
  /**
   * 可选增强：插入整块内容（如围栏代码块模板）时保证独占若干行——
   * 光标不在行首且当前行非空时自动补换行，避免内容粘在行尾。
   * 未提供时由 EditorService 回退到 insertText。
   */
  insertBlock?(text: string): void
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
  /** 打开的同类型 leaf（卸载视图前先关闭，避免 Obsidian 拒绝注销使用中的视图） */
  getLeavesOfType(type: string): Array<{ detach(): void }>
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
  /** 执行任意已注册命令（含 Obsidian 核心插件命令，如 templates:insert-template） */
  executeCommandById(id: string): void
}

export interface ViewRegistryLike {
  registerView(type: string, creator: unknown): void
  unregisterView(type: string): void
  /** 打开（或聚焦）一个已注册类型的视图面板 */
  openView(type: string): void
}

/** 侧边栏 ribbon 图标（插件可注册） */
export interface RibbonLike {
  addRibbonIcon(icon: string, title: string, callback: () => void): { remove(): void }
}

/** 底部状态栏（插件可注册条目） */
export interface StatusbarLike {
  addStatusBarItem(): { el: HTMLElement; remove(): void }
}

/** 设置页注册（插件可注册自己的设置 Tab） */
export interface SettingsUiLike {
  addSettingTab(tab: unknown): void
}

/** obsidian:// 协议处理器注册（Plugin.registerObsidianProtocolHandler 的结构描述，无对应注销 API） */
export interface ProtocolLike {
  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void
}

/**
 * 围栏代码块处理器注册（Plugin.registerMarkdownCodeBlockProcessor 的结构描述，无单个语言注销 API）。
 *
 * 关键约束（2026-09-01 dev-vault 实测）：Obsidian 的查找键是
 *     info.split(/\s+/)[0].split(':')[0]
 * 即"首个空白 token 再砍掉第一个冒号之后的全部"。因此：
 *   1. 只有裸 'hl' 这一个注册点会生效，'hl:x:y' 之类的注册永不触发；
 *   2. 空格后的参数被原生剥掉，handler 入参里没有——需靠 ctx.getSectionInfo 反查；
 *   3. 注册裸 'hl' 即独占整个 hl 命名空间（第三方重复注册会失败）。
 * 宿主据此只注册一次详见 apps/plugin/src/block-service.ts。
 */
export interface CodeBlockProcessorLike {
  registerProcessor(
    language: string,
    handler: (source: string, el: HTMLElement, ctx: unknown) => void,
  ): void
}

export interface NoticeLike {
  notice(message: string, timeout?: number): void
}

export interface ObsidianApiLike {
  vault: VaultLike
  workspace: WorkspaceLike
  commands: CommandsLike
  viewRegistry: ViewRegistryLike
  ribbon: RibbonLike
  statusbar: StatusbarLike
  settingsUi: SettingsUiLike
  notice: NoticeLike
  /** obsidian:// 协议处理器注册（宿主 Plugin 实例转发） */
  protocol: ProtocolLike
  /** 围栏代码块处理器注册（宿主 Plugin 实例转发） */
  codeBlockProcessor: CodeBlockProcessorLike
  /** 打开外部目标：http(s) 走系统浏览器，本地路径走默认应用（由桥接层实现） */
  openTarget(target: string): Promise<void>
}
