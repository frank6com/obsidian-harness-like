/**
 * 用户插件块定义能力服务（ctx.blocks）。
 *
 * 笔记形态：```hl:<pluginId>:<type>（默认）或 ```hl:<alias>（别名覆盖，强制 hl: 前缀）
 * ——`hl:` 命名空间归宿主独占（Harness Like），结构上不可能与原生语言
 * （mermaid 等）或其他社区插件冲突；生态内唯一性由本服务校验。
 *
 * 原生桥接：宿主按语言串【懒注册】一次 registerMarkdownCodeBlockProcessor(lang, dispatcher)
 * （原生对单个语言无公开注销 API、重复注册直接抛错——与 protocolHandler 同构，
 * 单一注册点 + 内存路由表把该限制收敛；宿主整体卸载时 Obsidian 自动清理全部条目，
 * 零残留）。子插件的注册/卸载只是路由表增删：disposer 删表项后，后续渲染走占位符。
 *
 * 语言串归一：路由键统一小写（fence 语言惯例不区分大小写；原生匹配行为未逆向证实，
 * 小写注册在两种实现下行为一致——待 dev-vault 实测后在注释更新结论）。
 */

import type { Context, Plugin as CordisPlugin } from '@deepseek-ai/cordis'

/** 强制语言串前缀（Harness Like 命名空间） */
export const BLOCK_LANG_PREFIX = 'hl:'

/** 默认语言串：hl:<pluginId>:<type> */
export function defaultBlockLang(pluginId: string, type: string): string {
  return `${BLOCK_LANG_PREFIX}${pluginId}:${type}`
}

/** 归一路由键：小写（见文件头注释） */
export function normalizeBlockLang(lang: string): string {
  return lang.trim().toLowerCase()
}

/** 别名合法性：非空 + hl: 前缀（大小写不敏感）+ 无空白 */
export function isValidBlockAlias(alias: string): boolean {
  const s = alias.trim()
  return s.length > BLOCK_LANG_PREFIX.length && /^hl:/i.test(s) && !/\s/.test(s)
}

/** 渲染上下文（原生 MarkdownPostProcessorContext 的结构子集，按需透传） */
export interface BlockRenderContext {
  sourcePath?: string
  [key: string]: unknown
}

export type BlockHandler = (source: string, el: HTMLElement, ctx: BlockRenderContext) => unknown

/** 路由状态：active=正常分发；conflict=语言串撞车（该块不可用）；renamed=旧名残留入口 */
export type BlockStatus = 'active' | 'conflict' | 'renamed'

interface BlockRoute {
  pluginId: string
  type: string
  handler?: BlockHandler
  lang: string
  status: BlockStatus
}

/** 占位符类别（文案由装配层经 i18n 渲染，服务保持纯逻辑）：notRunning=插件未运行；renamed=已改名 */
export type BlockPlaceholderKind = 'notRunning' | 'renamed'

/** 冲突通知类别：conflict=语言串已被占用；invalid=别名非法 */
export type BlockNotifyKind = 'conflict' | 'invalid'

export interface BlockDeps {
  /** 向 Obsidian 懒注册某语言的统一分发器（宿主 registerMarkdownCodeBlockProcessor 转发；同一语言仅调一次） */
  registerNative(language: string, dispatch: (source: string, el: HTMLElement, ctx: BlockRenderContext) => void): void
  /** 读别名表（key = `${pluginId}:${type}`） */
  getAlias(pluginId: string, type: string): string | undefined
  /** 写别名表并持久化（rename 时调用；空串 = 清除别名回到默认形态） */
  setAlias(pluginId: string, type: string, alias: string): void
  /** 注册冲突/非法提示（生产 = Notice；测试可传 spy） */
  notify(kind: BlockNotifyKind, detail: { lang?: string; owner?: string }): void
  /** 在块容器渲染占位符（生产 = i18n 文案 div；测试可传 spy 断言调用） */
  renderPlaceholder(el: HTMLElement, kind: BlockPlaceholderKind, detail: { lang: string; alias?: string }): void
}

export interface BlockFacade {
  /** 注册块类型（loader 已包裹自动携带插件 id）；返回 disposer，随插件卸载自动移除 */
  register(type: string, handler: BlockHandler): () => void
}

export interface BlockListEntry {
  pluginId: string
  type: string
  lang: string
  status: BlockStatus
}

/**
 * 宿主侧路由服务（三元签名含 pluginId；子插件经 loader ctx.extend 拿到的是
 * 二元 BlockFacade 视图，Context 类型声明亦为二元——防止冒充他人命名空间）。
 */
export class BlockService {
  /** 路由表：<语言串(小写)> -> route（active 分发 / renamed 旧名占位） */
  private routes = new Map<string, BlockRoute>()
  /** 冲突登记：key = `<pluginId>:<type>`——语言串已被他人占用、未参与分发的注册 */
  private conflicts = new Map<string, BlockRoute>()
  /** 已懒注册原生处理器的语言集合（原生重复注册会抛错，必须去重） */
  private nativeRegistered = new Set<string>()

  constructor(private deps: BlockDeps) {}

  /**
   * 子插件注册块类型。语义：
   * - 同 (pluginId, type) 重复注册 → 覆盖旧路由（reload 场景防残留）；
   * - 语言串被其他 (pluginId, type) 占用 → 本服务【拒绝安装】并记入冲突清单 + notify
   *   （不抛错、不崩插件、不影响先到者——比原生"重复注册崩整个插件"温和；
   *   用户可在详情弹窗为冲突块改名后重载生效）；
   * - 改名后旧语言串保留 renamed 标记（原生无法注销旧处理器，dispatcher 对其渲染改名占位）。
   *
   * disposer 以「pair + handler 引用」动态定位当前路由（改名会迁移语言键，
   * 捕获旧键会失联）；renamed 标记不受 disposer 影响（跨 stop/reload 的历史提示）。
   */
  register(pluginId: string, type: string, handler: BlockHandler): () => void {
    const t = type.trim()
    if (!t || /\s/.test(t)) {
      this.deps.notify('invalid', {})
      return () => {}
    }
    const alias = this.deps.getAlias(pluginId, t)
    const lang = normalizeBlockLang(alias ?? defaultBlockLang(pluginId, t))
    const pairKey = `${pluginId}:${t}`
    this.conflicts.delete(pairKey) // reload：清除本对上次遗留的冲突登记
    this.installRoute(pluginId, t, handler, lang)
    return () => {
      // 按 handler 引用清理（改名迁移后仍能找到）；冲突登记一并撤销
      for (const [key, r] of [...this.routes.entries()]) {
        if (r.pluginId === pluginId && r.type === t && r.handler === handler) this.routes.delete(key)
      }
      const c = this.conflicts.get(pairKey)
      if (c?.lang === lang) this.conflicts.delete(pairKey)
    }
  }

  /** 用户改名：校验 → 写别名持久化 → 迁移路由（旧名留 renamed 入口，新名懒注册生效） */
  rename(pluginId: string, type: string, alias: string): boolean {
    if (!isValidBlockAlias(alias)) {
      this.deps.notify('invalid', { lang: alias })
      return false
    }
    const lang = normalizeBlockLang(alias)
    const owner = this.routes.get(lang)
    if (owner && !(owner.pluginId === pluginId && owner.type === type)) {
      this.deps.notify('conflict', { lang: alias, owner: owner.pluginId })
      return false
    }
    // 旧语言串迁移：active/renamed 一律转为 renamed 占位（原生旧条目无法注销），
    // 活跃路由的 handler 随迁到新语言键立即生效
    let migrated: BlockHandler | undefined
    for (const [key, r] of [...this.routes.entries()]) {
      if (r.pluginId !== pluginId || r.type !== type) continue
      if (key === lang) break
      this.routes.delete(key)
      if (r.handler) migrated = r.handler
      if (r.status === 'active') {
        this.routes.set(key, { ...r, handler: undefined, status: 'renamed', lang })
      }
    }
    this.deps.setAlias(pluginId, type, alias.trim())
    // 改名即脱离原冲突登记（重载后按新别名安装；若仍撞车会重新登记）
    this.conflicts.delete(`${pluginId}:${type}`)
    if (!migrated) return true
    this.installRoute(pluginId, type, migrated, lang)
    return true
  }

  /** 枚举全部块（管理器详情展示）：生效路由 + 冲突登记（含 renamed 旧名提示） */
  list(): BlockListEntry[] {
    return [...this.routes.values(), ...this.conflicts.values()].map(({ pluginId, type, lang, status }) => ({
      pluginId,
      type,
      lang,
      status,
    }))
  }

  /** 统一分发器（每个语言串一个闭包，由懒注册交给原生）：查表 → 执行 / 占位 */
  dispatch(lang: string, source: string, el: HTMLElement, ctx: BlockRenderContext): void {
    const key = normalizeBlockLang(lang)
    const route = this.routes.get(key)
    try {
      if (route?.status === 'active' && route.handler) {
        route.handler(source, el, ctx)
        return
      }
      if (route?.status === 'renamed') {
        this.deps.renderPlaceholder(el, 'renamed', { lang: route.lang })
        return
      }
      this.deps.renderPlaceholder(el, 'notRunning', { lang: key })
    } catch (err) {
      // 单个 handler 异常不阻断渲染管线（对齐项目"卸载必须不抛错"的防御风格）
      console.warn(`[harness-like] 块渲染失败 ${key}:`, err)
    }
  }

  /** 安装/覆盖路由 + 懒注册原生（内部共用） */
  private installRoute(pluginId: string, type: string, handler: BlockHandler, lang: string): void {
    const owner = this.routes.get(lang)
    if (owner && !(owner.pluginId === pluginId && owner.type === type)) {
      // 语言串撞车：登记冲突（可见、可改名后重载生效），不参与分发、不顶掉先到者
      this.conflicts.set(`${pluginId}:${type}`, { pluginId, type, lang, status: 'conflict' })
      this.deps.notify('conflict', { lang, owner: owner.pluginId })
      return
    }
    this.routes.set(lang, { pluginId, type, handler, lang, status: 'active' })
    if (!this.nativeRegistered.has(lang)) {
      this.nativeRegistered.add(lang)
      this.deps.registerNative(lang, (source, el, ctx) => this.dispatch(lang, source, el, ctx))
    }
  }
}

/**
 * 装配插件：提供 ctx.blocks 服务（宿主 main.ts 调用一次）。
 * 注意 Context 类型声明为二元 Facade（防手写他人插件 id）；宿主自用走 BlockService 实例。
 */
export function blockServicePlugin(deps: BlockDeps): CordisPlugin.Object {
  return {
    name: 'user-block-handlers',
    apply(ctx: Context) {
      ctx.reflect.provide('blocks', new BlockService(deps))
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 块定义能力（笔记中 ```hl:<pluginId>:<type> 或 ```hl:<alias>） */
    blocks: BlockFacade
  }
}
