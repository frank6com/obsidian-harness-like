/**
 * 用户插件块定义能力服务（ctx.blocks）。
 *
 * 笔记形态（v2）：```hl <插件id 或 别名>[:<type>] [参数...] —— 解析见 block-info.ts
 *
 * ── 原生桥接（2026-09-01 dev-vault 实测结论，推翻此前假设）──
 * Obsidian 的处理器查找键是：
 *     info.split(/\s+/)[0].split(':')[0]
 * 即"首个空白 token，再砍掉第一个冒号之后的全部"。三条推论：
 *   1. 空格后的参数被原生剥掉，handler 的入参里【没有任何参数信息】——
 *      只能靠 ctx.getSectionInfo(el) 反查原始 fence 行拿回（见 block-info.ts）；
 *   2. registerMarkdownCodeBlockProcessor('hl:x:y') 是死条目：注册按完整字符串存，
 *      查找只用 'hl'，永远匹配不上；
 *   3. 裸 'hl' 是该命名空间的"总开关"——谁注册谁接管全部 hl: 块。我们自己注册它
 *      即等于独占命名空间（第三方再注册会失败），是防御而非负担。
 * 因此本服务【只在宿主启动时注册一次 'hl'】，路由全部下沉到内存表。相较旧实现：
 *   - 原生注册点从 N 降到 1，"单语言无注销 API"的限制随之消失；
 *   - 改名不再需要"旧名留 renamed 占位"（原生条目只有一个，改名纯内存操作）；
 *   - 语言串撞车不存在了（路由键是 pluginId:type，天然隔离）。
 */

import type { Context, Plugin as CordisPlugin } from '@deepseek-ai/cordis'
import {
  parseBlockInfo,
  readFenceCandidates,
  sectionOrdinal,
  type AliasReject,
  type FenceHit,
} from './block-info'

/** 省略 type 时的默认块类型名：子插件注册该 type 即可让笔记省略 :type */
export const DEFAULT_BLOCK_TYPE = 'default'

/** 原生注册的语言（命名空间总开关，全局唯一） */
export const BLOCK_LANG = 'hl'

/** 渲染上下文（原生 MarkdownPostProcessorContext 的结构子集，按需透传） */
export interface BlockRenderContext {
  sourcePath?: string
  /** 反查 fence 行必需；部分渲染场景（hover 预览等）可能为 null */
  getSectionInfo?(el: HTMLElement): { text?: string; lineStart?: number; lineEnd?: number } | null
  [key: string]: unknown
}

/** 解析结果（与 block-info 的 ParsedBlockInfo 对齐，补上解别名后的 pluginId 与行号） */
export interface BlockMeta {
  /** 整条 info 原串（已 trim，不含 ``` 前缀） */
  info: string
  /** 解别名后的真实插件 id */
  pluginId: string
  /** 实际生效的 type（省略时为默认 type） */
  type: string
  /** 笔记是否显式写了 type */
  typeExplicit: boolean
  /** 键值参数（k:v / k=v / --k=v），key 保留原样 */
  params: Record<string, string>
  /** 开关（--flag，小写归一） */
  flags: string[]
  /** 其余位置参数（去引号） */
  positional: string[]
  /** fence 行的绝对行号（0-based）；经 CM 直读 info 时拿不到，为 null */
  line: number | null
}

export type BlockHandler = (
  source: string,
  el: HTMLElement,
  ctx: BlockRenderContext,
  meta: BlockMeta,
) => unknown

/**
 * 占位符类别：
 * - notRunning：插件未运行 / 未注册该块 / 笔记里的 id 或别名无法解析
 * - needType：插件注册了多个 type 且笔记未指定，无法确定路由
 * - legacy：旧语法 ```hl:<id>:<type>（已不支持，提示新写法）
 * - badInfo：拿不到 fence 行或首参缺失（语法不完整）
 * - empty：块内容为空（不给子插件空渲染的机会，保证有可见提示框）
 */
export type BlockPlaceholderKind = 'notRunning' | 'needType' | 'legacy' | 'badInfo' | 'empty'

export interface PlaceholderDetail {
  /** 整条 info 原串（badInfo 时可能为空） */
  info?: string
  /** 笔记里写的 target 首段，或解别名后的插件 id */
  pluginId?: string
  /** needType 时给出可选 type 列表 */
  types?: string[]
  /** legacy 时给出旧写法的 id/type，用于拼新写法示例 */
  legacy?: { pluginId: string; type: string }
  /** 原始块内容（badInfo 时降级显示，不吞内容） */
  source?: string
  /** badInfo 细分：nolocate=定位失败（语法本身可能没问题）；syntax=确实缺插件 id 等 */
  reason?: 'nolocate' | 'syntax'
}

export interface BlockListEntry {
  pluginId: string
  type: string
}

export interface BlockDeps {
  /** 向 Obsidian 注册裸 hl 处理器（宿主启动调一次；重复注册会失败，由宿主捕获并提示） */
  registerNative(
    language: string,
    dispatch: (source: string, el: HTMLElement, ctx: BlockRenderContext) => void,
  ): void
  /**
   * 把笔记里的 target 首段（可能是插件 id 或别名）解析为真实插件 id；未识别返回 undefined。
   * 由宿主实现以保证"真实 id 优先于别名"——子插件无法用别名劫持他人命名空间。
   */
  resolveTarget(token: string): string | undefined
  /**
   * 可选：Live Preview 下解析 el 对应块的绝对行号（CM posAtDOM + lineAt）。
   * 同一 section 存在多个内容相同的块（典型：相邻插入的空模板）时，内容匹配失效，
   * 需要它做精确定位；拿不到返回 null（走阅读模式序号或兜底）。
   */
  resolveBlockLine?(el: HTMLElement): number | null
  /**
   * 可选：直接经 CM 从 el 的 DOM 位置读出所在 fence 行的 info。
   * LP 下相邻 widget 的 getSectionInfo 偶发返回空（候选收集失败），此时
   * CM 文档仍是可靠的同步信息源，用它兜底而不是直接渲染 badInfo。
   */
  resolveFenceInfoAt?(el: HTMLElement): string | null
  /** 在块容器渲染占位符（生产 = i18n 文案 div；测试可传 spy 断言调用） */
  renderPlaceholder(el: HTMLElement, kind: BlockPlaceholderKind, detail: PlaceholderDetail): void
}

export interface BlockFacade {
  /** 注册块类型（loader 已包裹自动携带插件 id）；返回 disposer，随插件卸载自动移除 */
  register(type: string, handler: BlockHandler): () => void
}

/**
 * 插件 id 别名服务（缩短笔记里 ```hl <target> 的书写）。
 * 由宿主实现以保证校验集中：不得等于任何插件真实 id（防劫持）、不得与他人别名重复。
 */
export interface BlockAliasesService {
  get(pluginId: string): string | undefined
  /** 空串 = 清除别名 */
  set(pluginId: string, alias: string): { ok: true; alias: string } | { ok: false; reason: AliasReject }
}

/** 路由键：<插件id>:<type>（均小写归一） */
function routeKey(pluginId: string, type: string): string {
  return `${pluginId.trim().toLowerCase()}:${type.trim().toLowerCase()}`
}

/**
 * 该插件在笔记中可省略 type 时返回默认 type，否则 null。
 * 判定顺序：显式 default → 唯一 type → null（必须显式指定）。
 * UI 模板生成与路由解析共用此函数，避免"模板写法"与"实际解析"漂移。
 */
export function defaultTypeOf(entries: BlockListEntry[], pluginId: string): string | null {
  const pid = pluginId.trim().toLowerCase()
  const types = entries.filter((e) => e.pluginId === pid).map((e) => e.type)
  if (!types.length) return null
  if (types.includes(DEFAULT_BLOCK_TYPE)) return DEFAULT_BLOCK_TYPE
  if (types.length === 1) return types[0]!
  return null
}

interface BlockRoute {
  pluginId: string
  type: string
  handler: BlockHandler
}

/** 宿主侧路由服务（三元签名含 pluginId；子插件经 loader ctx.extend 拿到二元 BlockFacade 视图） */
export class BlockService {
  /** 路由表：<pluginId>:<type> -> route */
  private routes = new Map<string, BlockRoute>()
  /** 原生注册去重（原生重复注册会抛错；正常只调一次） */
  private nativeRegistered = false

  constructor(private deps: BlockDeps) {}

  /**
   * 向 Obsidian 注册裸 hl 分发器。宿主启动时调用一次即可——
   * 之后子插件的注册/卸载只是内存表增删，不再触碰原生 API。
   */
  registerNativeOnce(): void {
    if (this.nativeRegistered) return
    this.nativeRegistered = true
    this.deps.registerNative(BLOCK_LANG, (source, el, ctx) => this.dispatch(source, el, ctx))
  }

  /**
   * 子插件注册块类型。
   * - 同 (pluginId, type) 重复注册 → 覆盖旧路由（reload 场景防残留）
   * - type 为空或含空白 → 拒绝注册（笔记里 type 来自 token，不可能含空白）
   */
  register(pluginId: string, type: string, handler: BlockHandler): () => void {
    const pid = pluginId.trim().toLowerCase()
    const t = type.trim().toLowerCase()
    if (!pid || !t || /\s/.test(t)) {
      console.warn(`[harness-like] 非法的块注册：pluginId=${pluginId} type=${type}`)
      return () => {}
    }
    const key = routeKey(pid, t)
    this.routes.set(key, { pluginId: pid, type: t, handler })
    return () => {
      const cur = this.routes.get(key)
      if (cur?.handler === handler) this.routes.delete(key)
    }
  }

  /** 枚举全部已注册块（管理器详情展示） */
  list(): BlockListEntry[] {
    return [...this.routes.values()].map(({ pluginId, type }) => ({ pluginId, type }))
  }

  /**
   * 定位本块对应的 fence（多级策略）：
   * 0. CM 直读（最可靠）：el 的 DOM 位置 → posAtDOM → lineAt 即 fence 行原文，
   *    不依赖 getSectionInfo 的 section 映射与行号对齐（dev-vault 实测精确）
   * 1. section 内候选唯一 → 直接用（绝大多数场景 / 阅读模式）
   * 2. 内容与 source 一致的候选唯一 → 用（同 section 多块但内容可区分）
   * 3. CM 行号命中候选（直读不可用时的行号通道）
   * 4. 阅读模式：section 渲染容器内的同类块序号 → 按序号命中
   * 5. 兜底第一个候选并 warn（相邻同内容块从渲染上下文无法区分时的最后手段）
   */
  private locateFence(source: string, el: HTMLElement, ctx: BlockRenderContext): FenceHit | null {
    const candidates = readFenceCandidates(ctx, el, source)
    const directInfo = this.deps.resolveFenceInfoAt?.(el) ?? null
    if (directInfo) {
      // 直读结果与候选交叉：唯一对应时沿用候选（保留行号），否则直接用直读 info
      const byInfo = candidates.filter((c) => c.info === directInfo)
      if (byInfo.length === 1) return byInfo[0]!
      return { info: directInfo, line: null, exact: false }
    }
    if (candidates.length === 0) {
      // getSectionInfo 为空且 CM 直读也不可用：无法定位，渲染占位（理论上仅剩
      // hover 预览等无文档上下文的场景）。静默：结果由降级占位可见，不刷控制台。
      return null
    }
    if (candidates.length === 1) return candidates[0]!
    const exact = candidates.filter((c) => c.exact)
    if (exact.length === 1) return exact[0]!
    const line = this.deps.resolveBlockLine?.(el)
    if (line != null) {
      const byLine = candidates.find((c) => c.line === line)
      if (byLine) return byLine
    }
    const k = sectionOrdinal(el, candidates.length)
    if (k != null && k < candidates.length) return candidates[k]!
    // 不再回退到任意候选：回退到 'hl'（缺 target）或 'plugin_id'（未注册）这类
    // 候选会把语法正确的块误标成"语法错误/插件未运行"。宁可返回 null 走降级原文 +
    // rAF 重试（重试时 CM 已挂载、直读精确命中），也不渲染错误目标。
    // 静默处理：结果由重试兜底（成功则正常渲染，失败则占位原文可见），无需向用户输出。
    return null
  }

  /** 统一分发器：反查 fence 行 → 解析 → 解别名 → 定 type → 查路由 → 执行 / 占位 */
  dispatch(source: string, el: HTMLElement, ctx: BlockRenderContext): void {
    this.renderBlock(source, el, ctx, 0)
  }

  /**
   * 渲染一个块。定位失败时先降级显示原文，然后安排 rAF 重试——
   * 原因：handler 被调用时 Obsidian 尚未把代码块 widget 挂载进 .cm-editor DOM，
   * 此时 closest('.cm-editor') 取不到 CM，直读/行号两条通道全部失效（dev-vault
   * 实测 hasWrapper=true / hasCmRoot=false，且 handler 阶段 el 尚未 connected——
   * 不能用 isConnected 拦重试）。挂载完成后重试即可命中，多帧尝试最多 3 次。
   */
  private renderBlock(source: string, el: HTMLElement, ctx: BlockRenderContext, attempt: number): void {
    try {
      // 空内容块：不交给子插件空渲染（Obsidian 对空 widget 无可见默认样式），
      // 直接渲染"空内容"提示框——不依赖定位/重试，保证任何情况下都有可见反馈
      if (!String(source ?? '').trim()) {
        this.deps.renderPlaceholder(el, 'empty', { source })
        return
      }
      const hit = this.locateFence(source, el, ctx)
      if (!hit) {
        // 定位失败 ≠ 语法错误：附上原文降级显示，不吞块内容
        this.deps.renderPlaceholder(el, 'badInfo', { source, reason: 'nolocate' })
        if (attempt < 3 && typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => {
            // 回调时机 widget 已挂载：el.isConnected 应为 true；真被清理才放弃
            if (!el.isConnected) return
            this.renderBlock(source, el, ctx, attempt + 1)
          })
        }
        return
      }
      const parsed = parseBlockInfo(hit.info)
      if (parsed.kind === 'legacy') {
        this.deps.renderPlaceholder(el, 'legacy', { info: hit.info, legacy: parsed.legacy })
        return
      }
      if (parsed.kind !== 'ok') {
        this.deps.renderPlaceholder(el, 'badInfo', { info: hit.info, source, reason: 'syntax' })
        return
      }
      const target = parsed.pluginToken
      const pluginId = this.deps.resolveTarget(target)
      if (!pluginId) {
        this.deps.renderPlaceholder(el, 'notRunning', { info: hit.info, pluginId: target })
        return
      }
      const entries = this.list()
      let type = parsed.type
      if (!parsed.typeExplicit) {
        const dt = defaultTypeOf(entries, pluginId)
        if (!dt) {
          this.deps.renderPlaceholder(el, 'needType', {
            info: hit.info,
            pluginId,
            types: entries.filter((e) => e.pluginId === pluginId).map((e) => e.type),
          })
          return
        }
        type = dt
      }
      const route = this.routes.get(routeKey(pluginId, type))
      if (!route) {
        this.deps.renderPlaceholder(el, 'notRunning', { info: hit.info, pluginId })
        return
      }
      // 重试成功时清掉第一次的降级占位，再交给 handler 渲染
      if (attempt > 0) {
        try {
          el.empty()
        } catch {
          /* 极端情况下容器已被清理，交给 handler 自行处理 */
        }
      }
      route.handler(source, el, ctx, {
        info: hit.info,
        pluginId,
        type,
        typeExplicit: parsed.typeExplicit,
        params: parsed.params,
        flags: parsed.flags,
        positional: parsed.positional,
        line: hit.line,
      })
    } catch (err) {
      // 单个 handler 异常不阻断渲染管线（对齐项目"卸载/渲染必须不抛错"的防御风格）
      console.warn('[harness-like] 块渲染失败:', err)
    }
  }
}

/**
 * 装配插件：提供 ctx.blocks 服务（宿主 main.ts 调用一次）。
 * Context 类型声明为二元 Facade（防手写他人插件 id）；宿主自用走 BlockService 实例。
 */
export function blockServicePlugin(deps: BlockDeps): CordisPlugin.Object {
  return {
    name: 'user-block-handlers',
    apply(ctx: Context) {
      const svc = new BlockService(deps)
      ctx.reflect.provide('blocks', svc)
      // 启动即注册（原生侧无单个注销 API，宿主 unload 时由 Obsidian 统一清理）
      svc.registerNativeOnce()
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 块定义能力（笔记中 ```hl <插件id>[:<type>] [参数...]） */
    blocks: BlockFacade
    /** 插件 id 别名（块语法 target 缩短用），由宿主提供并统一校验 */
    blockAliases: BlockAliasesService
  }
}
