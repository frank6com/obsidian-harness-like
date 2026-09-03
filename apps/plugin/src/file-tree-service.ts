/**
 * 文件管理器增强能力服务（ctx.fileTree）。
 *
 * 设计目标：通用、可扩展，而非"待办红点"专用。子插件注册"装饰器"（decorator），
 * 给定 vault 相对路径返回【纯数据】装饰（class / 徽标 / 提示）；宿主独占 DOM 渲染，
 * 子插件物理上无法触碰文件树 DOM——守住"一律走 ctx.* 服务"的沙箱铁律。
 *
 * 通用性：装饰只是第一期能力。同一注册模型后续可平滑长出：
 *   - 右键菜单贡献（registerFileMenuItem / registerFolderMenuItem，file-menu 事件）
 *   - 图标替换（Decoration.icon 覆盖文件夹/文件图标）
 *   - 排序/置顶（registerSorter 把带标记的文件夹钉到顶部）
 *   - 计数元信息（gutter 文本，如"12"篇 / "3 待办"）
 *   - 点击动作（Decoration.onClick，需宿主回调子插件命令，谨慎开放）
 * 当前 v1 落地：class 装饰（如下划线）+ 右侧徽标（红点/文字/颜色/悬浮提示）
 *   + 祖先传播（propagate：笔记有标记 → 所有父文件夹连带标记）。
 */

import { type App } from 'obsidian'
import type { Context, Plugin as CordisPlugin } from '@deepseek-ai/cordis'
import type { VaultService } from '@harness-like/obsidian-adapter'

/** 一个装饰器对某路径返回的纯数据装饰（绝不含 DOM） */
export interface FileDecoration {
  /** 附加到 nav 项的 class（宿主自动加 dsh-ft- 前缀防冲突；如 'underline' → .dsh-ft-underline） */
  classes?: string[]
  /** 右侧徽标 */
  badge?: {
    /** 徽标文字（如 '3' 或 '●'）；上限 4 字符；省略则渲染纯色点 */
    text?: string
    /** 背景色（如 '#e5484d'） */
    color?: string
    /** 悬浮提示 */
    title?: string
  }
  /** 整个 nav 项悬浮提示（与 badge.title 拼接展示） */
  tooltip?: string
  /** 是否把此装饰向上传播到所有祖先文件夹（待办场景：笔记有未完成项→父文件夹全标） */
  propagateToAncestors?: boolean
}

/** 子插件注册的装饰器 */
export interface FileDecorator {
  /** 装饰器 id（class 命名空间用，建议含插件 id 防冲突） */
  id: string
  /** 仅对 folder / file / 两者 生效；默认 'all' */
  scope?: 'folder' | 'file' | 'all'
  /**
   * 本装饰器是否需要祖先传播。为 true 时宿主在 vault 变更/注册变动时
   * 遍历全部 markdown 笔记预计算"应连带标记的文件夹集合"（开销一次性，缓存复用）。
   * 不需要传播（只装饰命中路径本身）的装饰器务必留 false/省略，避免无谓的全库扫描。
   */
  propagates?: boolean
  /** 给定 vault 相对路径，返回装饰或 null（可 async） */
  decorate(path: string): FileDecoration | null | Promise<FileDecoration | null>
}

/** 子插件经 loader 拿到的门面（与 blocks/protocol 同构：宿主侧是三元实现，这里二元） */
export interface FileTreeFacade {
  /** 注册装饰器；返回 disposer，随插件卸载自动移除 */
  register(decorator: FileDecorator): () => void
  /** 枚举全部已注册装饰器（管理器详情展示）：[{id}] */
  list(): Array<{ id: string }>
  /**
   * 装饰器内部缓存变化后由子插件调用：宿主重算祖先传播并重绘。
   * 必需——vault 事件时刻子插件缓存往往尚未更新（异步扫描），宿主自身监听
   * vault 事件重算一次拿到的仍是旧数据；只有缓存真正落定后的主动通知才可靠。
   */
  refresh(): void
}

/** CSS 类名 slug 化（防注入 / 非法字符） */
function slug(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/** 路径的全部祖先文件夹（含自身若是文件夹）。'A/B/C/n.md' → ['A','A/B','A/B/C'] */
export function ancestorsOf(path: string): string[] {
  const norm = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!norm) return []
  const parts = norm.split('/')
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i]!
    out.push(cur)
  }
  return out
}

/** 合并多个装饰为可渲染结构（class 去重、徽标聚合、提示收集） */
export function mergeDecorations(decos: FileDecoration[]): {
  classes: string[]
  badges: NonNullable<FileDecoration['badge']>[]
  tooltip: string
} {
  const clsSet = new Set<string>()
  const tips: string[] = []
  const raw: NonNullable<FileDecoration['badge']>[] = []
  for (const d of decos) {
    for (const c of d.classes ?? []) {
      const s = slug(c)
      if (s) clsSet.add(s)
    }
    if (d.badge && (d.badge.text || d.badge.color || d.badge.title)) raw.push(d.badge)
    if (d.tooltip) tips.push(d.tooltip)
  }
  // 纯数字徽标聚合求和：祖先传播场景下同一文件夹会同时命中多篇笔记的计数徽标，
  // 全部绝对定位在同一位置会互相遮盖——汇总为一个总数徽标（文件夹显示子树总待办数）
  const isNumeric = (b: NonNullable<FileDecoration['badge']>) => /^\d+$/.test((b.text ?? '').trim())
  const numeric = raw.filter(isNumeric)
  const rest = raw.filter((b) => !isNumeric(b))
  const badges: NonNullable<FileDecoration['badge']>[] = [...rest]
  if (numeric.length) {
    const total = numeric.reduce((acc, b) => acc + parseInt(b.text!.trim(), 10), 0)
    if (total > 0) {
      badges.unshift({
        text: total > 99 ? '99+' : String(total),
        color: numeric[0]!.color,
        title: [...new Set(numeric.map((b) => b.title).filter(Boolean))].join('；'),
      })
    }
  }
  return { classes: [...clsSet], badges, tooltip: tips.join('；') }
}

const BASE_CLASS = 'dsh-ft-deco'
const BADGE_CLASS = 'dsh-ft-badge'

interface DecoEntry {
  id: string
  scope: 'folder' | 'file' | 'all'
  propagates: boolean
  decorate: FileDecorator['decorate']
}

export class FileTreeService {
  private entries: DecoEntry[] = []
  private observer: MutationObserver | null = null
  private rafPending = false
  /** 祖先传播缓存：文件夹路径 → 应连带应用的装饰 */
  private ancestorDeco = new Map<string, FileDecoration[]>()
  private offRefs: Array<() => void> = []

  constructor(
    private app: App,
    private ctx: Context,
  ) {
    this.bindEvents()
    this.observeExplorer()
    this.scheduleRender()
  }

  /** 注册装饰器；返回 disposer */
  register(d: FileDecorator): () => void {
    const entry: DecoEntry = {
      id: d.id,
      scope: d.scope ?? 'all',
      propagates: Boolean(d.propagates),
      decorate: d.decorate,
    }
    this.entries.push(entry)
    void this.recompute()
    this.scheduleRender()
    return () => {
      this.entries = this.entries.filter((x) => x !== entry)
      void this.recompute()
      this.scheduleRender()
    }
  }

  list(): Array<{ id: string }> {
    return this.entries.map((e) => ({ id: e.id }))
  }

  // ── 事件绑定 ───────────────────────────────────────────────

  private bindEvents(): void {
    const ws = this.app.workspace
    const layoutRef = ws.on('layout-change', () => {
      this.recomputeAndRender()
    })
    this.offRefs.push(() => ws.offref(layoutRef))
    const openRef = ws.on('file-open', () => this.scheduleRender())
    this.offRefs.push(() => ws.offref(openRef))
    for (const ev of ['vault/modify', 'vault/create', 'vault/delete', 'vault/rename'] as const) {
      this.offRefs.push(
        this.ctx.on(ev, () => {
          this.recomputeAndRender()
        }),
      )
    }
  }

  private recomputeAndRender(): void {
    void this.recompute().then(() => this.scheduleRender())
  }

  /** 子插件缓存更新后的主动通知：重算祖先传播并重绘（FileTreeFacade.refresh 的实现） */
  refresh(): void {
    this.recomputeAndRender()
  }

  // ── 祖先传播预计算（仅 propagates 的装饰器参与，缓存复用） ──

  private async recompute(): Promise<void> {
    const map = new Map<string, FileDecoration[]>()
    const producers = this.entries.filter((e) => e.propagates)
    if (producers.length) {
      const vault = this.ctx.get('vault') as VaultService | undefined
      const paths = vault ? vault.getMarkdownPaths() : []
      for (const e of producers) {
        for (const p of paths) {
          let dec: FileDecoration | null = null
          try {
            // 同步结果直接取值（纯数据装饰器约定为大 Map 查询，全库逐个 await 开销可观）
            const r = e.decorate(p)
            dec = r instanceof Promise ? await r : r
          } catch (err) {
            console.warn(`[harness-like] 文件树装饰器 ${e.id} 异常:`, err)
            continue
          }
          if (dec?.propagateToAncestors) {
            for (const anc of ancestorsOf(p)) {
              const arr = map.get(anc) ?? []
              arr.push(dec)
              map.set(anc, arr)
            }
          }
        }
      }
    }
    this.ancestorDeco = map
  }

  // ── 渲染 ───────────────────────────────────────────────────

  private explorerContainers(): HTMLElement[] {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer')
    const out: HTMLElement[] = []
    for (const leaf of leaves) {
      const view = leaf.view as { contentEl?: HTMLElement; containerEl?: HTMLElement } | null
      // 新版 Obsidian（1.13+）的 FileExplorer 视图没有 contentEl，nav 项挂在 containerEl 下——回退取 containerEl
      const content = view?.contentEl ?? view?.containerEl
      if (content) out.push(content)
    }
    return out
  }

  private observeExplorer(): void {
    if (typeof MutationObserver === 'undefined') return
    if (!this.observer) {
      this.observer = new MutationObserver(() => this.scheduleRender())
    }
    this.observer.disconnect()
    for (const c of this.explorerContainers()) {
      this.observer.observe(c, { childList: true, subtree: true })
    }
  }

  private scheduleRender(): void {
    if (this.rafPending) return
    this.rafPending = true
    // 用 setTimeout 而非 requestAnimationFrame：
    // 1) 后台窗口的 rAF 回调会被挂起，装饰渲染随之停摆；
    // 2) 把 rAF 赋给局部变量后裸调用（ detached this）在 Chromium 抛 Illegal invocation。
    // 装饰渲染非逐帧敏感，16ms 定时足够。
    setTimeout(() => {
      this.rafPending = false
      void this.render()
    }, 16)
  }

  private async render(): Promise<void> {
    const containers = this.explorerContainers()
    if (!containers.length) return
    // 渲染期间断开观察，避免自身 DOM 改动触发无限循环
    this.observer?.disconnect()
    try {
      for (const c of containers) {
        const items = c.querySelectorAll('.nav-folder-title, .nav-file-title')
        items.forEach((el) => this.clearItem(el as HTMLElement))
        for (const el of Array.from(items)) {
          const node = el as HTMLElement
          const path = node.getAttribute('data-path')
          if (!path) continue
          const isFolder = node.classList.contains('nav-folder-title')
          const decos = await this.getDecorationsForPath(path, isFolder)
          if (decos.length) this.applyItem(node, decos)
        }
      }
    } catch (err) {
      // 渲染异常不允许静默：否则装饰永远不出现且无从排查
      console.warn('[harness-like] 文件树装饰渲染失败:', err)
    } finally {
      this.observeExplorer()
    }
  }

  private async getDecorationsForPath(path: string, isFolder: boolean): Promise<FileDecoration[]> {
    const out: FileDecoration[] = []
    for (const e of this.entries) {
      if (e.scope === 'folder' && !isFolder) continue
      if (e.scope === 'file' && isFolder) continue
      try {
        const dec = await Promise.resolve(e.decorate(path))
        if (dec) out.push(dec)
      } catch (err) {
        console.warn(`[harness-like] 文件树装饰器 ${e.id} 异常:`, err)
      }
    }
    if (isFolder) {
      const anc = this.ancestorDeco.get(path)
      if (anc) out.push(...anc)
    }
    return out
  }

  private clearItem(el: HTMLElement): void {
    el.classList.remove(BASE_CLASS)
    for (const c of Array.from(el.classList)) {
      if (c.startsWith('dsh-ft-')) el.classList.remove(c)
    }
    el.title = ''
    el.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove())
  }

  private applyItem(el: HTMLElement, decos: FileDecoration[]): void {
    const merged = mergeDecorations(decos)
    el.classList.add(BASE_CLASS)
    for (const c of merged.classes) el.classList.add(`dsh-ft-${c}`)
    for (const b of merged.badges) {
      const span = document.createElement('span')
      span.className = BADGE_CLASS
      if (b.text) span.textContent = b.text.slice(0, 4)
      if (b.color) span.style.background = b.color
      if (b.title) span.title = b.title
      el.appendChild(span)
    }
    if (merged.tooltip) el.title = merged.tooltip
  }

  /** 宿主 unload 时清理（经 ctx.effect 调用） */
  dispose(): void {
    for (const off of this.offRefs) {
      try {
        off()
      } catch {
        /* 忽略 */
      }
    }
    this.observer?.disconnect()
    this.observer = null
    // 清掉文件树上可能残留的装饰
    for (const c of this.explorerContainers()) {
      c.querySelectorAll('.nav-folder-title, .nav-file-title').forEach((el) =>
        this.clearItem(el as HTMLElement),
      )
    }
  }
}

/**
 * 装配插件：提供 ctx.fileTree 服务（宿主 main.ts 调用一次）。
 * 返回二元门面（子插件注册时自带对象，无需插件 id 前缀——class 命名空间由 decorator.id 区分）。
 */
export function fileTreeServicePlugin(app: App): CordisPlugin.Object {
  return {
    name: 'user-file-tree',
    apply(ctx: Context) {
      const svc = new FileTreeService(app, ctx)
      ctx.reflect.provide('fileTree', svc as unknown as FileTreeFacade)
      ctx.effect(() => () => svc.dispose())
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 文件管理器增强（装饰器：class / 徽标 / 祖先传播），纯数据驱动，宿主独占渲染 */
    fileTree: FileTreeFacade
  }
}
