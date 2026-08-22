/**
 * 用户插件 obsidian:// 协议扩展点服务（ctx.protocol）。
 *
 * URL 形态：obsidian://harness-like?plugin=<子插件id>&cmd=<动作名>&<其余参数>
 * 宿主只向 Obsidian 注册一次统一入口（Plugin.registerObsidianProtocolHandler 无公开
 * 注销 API，单入口把该限制收敛为一个 listener）；子插件的注册/卸载只是内存路由表
 * 的增删，彻底失效、零残留。子插件经 loader 包裹自动携带自己的插件 id，防止冒充
 * 他人命名空间。
 *
 * ⚠ 路由参数用 cmd 而非 action：Obsidian 解析 obsidian:// URI 时最后执行
 * `data.action = <URL action 段>`（app 内部 KC 函数），query 里的 action 会被
 * 入口名 'harness-like' 无条件覆盖，不可用作路由。另：无值的 query 参数编码为
 * 字符串 "true"；URI 的 #hash 部分会进入 params.hash。
 */

import type { Context, Plugin as CordisPlugin } from '@deepseek-ai/cordis'

/** 协议动作收到的业务参数（query 透传，已剥离 plugin/cmd/action 路由参数） */
export interface ProtocolParams {
  [key: string]: string
}

export type ProtocolHandler = (params: ProtocolParams) => unknown

/** 未命中路由的通知类别（文案由装配层经 i18n 渲染，服务保持纯逻辑） */
export type ProtocolNotifyKind = 'missing' | 'notFound'

export interface ProtocolDeps {
  /** 向 Obsidian 注册统一入口处理器（宿主 registerObsidianProtocolHandler 转发；仅构造时调用一次） */
  registerEntry(handler: (params: Record<string, string>) => unknown): void
  /** 路由未命中提示（生产 = Notice；测试可传 spy） */
  notify(kind: ProtocolNotifyKind, detail: { plugin?: string; cmd?: string }): void
}

export interface ProtocolFacade {
  /** 注册动作（loader 已包裹自动携带插件 id）；返回 disposer，随插件卸载自动移除 */
  register(cmd: string, handler: ProtocolHandler): () => void
}

/**
 * 宿主侧路由服务（三元签名含 pluginId；子插件经 loader ctx.extend 拿到的是
 * 二元 ProtocolFacade 视图，Context 类型声明亦为二元——防止手写他人插件 id）。
 */
export class ProtocolService {
  /** 路由表：<插件id> -> <动作名> -> handler */
  private routes = new Map<string, Map<string, ProtocolHandler>>()

  constructor(private deps: ProtocolDeps) {
    deps.registerEntry((params) => this.dispatch(params))
  }

  /**
   * 子插件注册动作。同一 (插件id, 动作) 重复注册时后者覆盖前者
   * （防 reload 时残留旧 handler）；disposer 以引用比较防误删
   * （旧 disposer 不会移除新 handler）。
   */
  register(pluginId: string, cmd: string, handler: ProtocolHandler): () => void {
    let cmds = this.routes.get(pluginId)
    if (!cmds) {
      cmds = new Map()
      this.routes.set(pluginId, cmds)
    }
    cmds.set(cmd, handler)
    return () => {
      if (cmds.get(cmd) === handler) cmds.delete(cmd)
    }
  }

  /** 统一入口分发：解析路由参数 → 定位 handler → 剥离路由参数后调用 */
  dispatch(raw: Record<string, string>): void {
    const pluginId = typeof raw.plugin === 'string' ? raw.plugin : ''
    const cmd = typeof raw.cmd === 'string' ? raw.cmd : ''
    if (!pluginId || !cmd) {
      this.deps.notify('missing', {})
      return
    }
    const handler = this.routes.get(pluginId)?.get(cmd)
    if (!handler) {
      this.deps.notify('notFound', { plugin: pluginId, cmd })
      return
    }
    const params: ProtocolParams = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k !== 'plugin' && k !== 'cmd' && k !== 'action') params[k] = v
    }
    try {
      handler(params)
    } catch (err) {
      // 单个 handler 异常不阻断后续协议处理（对齐项目"卸载必须不抛错"的防御风格）
      console.warn(`[harness-like] 协议动作执行失败 ${pluginId}/${cmd}:`, err)
    }
  }
}

/** 装配插件：提供 ctx.protocol 服务（宿主 main.ts 调用一次） */
export function protocolServicePlugin(deps: ProtocolDeps): CordisPlugin.Object {
  return {
    name: 'user-protocol-handlers',
    apply(ctx: Context) {
      ctx.reflect.provide('protocol', new ProtocolService(deps))
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** obsidian:// 协议动作注册（obsidian://harness-like?plugin=<id>&cmd=<name>） */
    protocol: ProtocolFacade
  }
}
