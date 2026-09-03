/**
 * 加载安全性测试：确认 fileTreeServicePlugin.apply 在宿主 onload 路径下构造不抛错。
 * 用 mock 的 App / ctx 模拟 Obsidian 运行环境（代码对缺失全局有兜底）。
 */

import { describe, expect, it, vi } from 'vitest'
import { fileTreeServicePlugin } from '../file-tree-service'

/** 最小 ctx 结构（规避 cordis 泛型签名对 mock 的过度约束） */
function makeCtx() {
  return {
    on: () => () => {},
    emit: () => {},
    reflect: { provide: vi.fn() },
    effect(fn: () => unknown) {
      const d = fn()
      return {
        dispose: () => {
          if (typeof d === 'function') (d as () => void)()
          else if (Array.isArray(d)) (d as Array<() => void>).forEach((x) => x && x())
        },
      }
    },
    get: () => undefined,
  }
}

type CtxLike = ReturnType<typeof makeCtx>
type ApplyLike = { apply(ctx: CtxLike): void }

function makeApp() {
  return {
    workspace: {
      on: () => ({ ref: true }),
      offref: () => {},
      getLeavesOfType: () => [],
    },
  }
}

function asApply(plugin: ReturnType<typeof fileTreeServicePlugin>): ApplyLike {
  return plugin as unknown as ApplyLike
}

type AppLike = Parameters<typeof fileTreeServicePlugin>[0]

describe('fileTreeServicePlugin.apply 加载安全', () => {
  it('构造 + provide + effect 不抛错', () => {
    const ctx = makeCtx()
    const app = makeApp() as unknown as AppLike
    expect(() => asApply(fileTreeServicePlugin(app)).apply(ctx)).not.toThrow()
  })

  it('effect 返回的 disposer 可安全调用（宿主 unload 清理路径）', () => {
    const ctx = makeCtx()
    const app = makeApp() as unknown as AppLike
    const spy = vi.spyOn(ctx, 'effect')
    asApply(fileTreeServicePlugin(app)).apply(ctx)
    expect(spy).toHaveBeenCalledTimes(1)
    // disposer 幂等可重复调用且不抛错
    const disposer = ctx.effect(() => null).dispose
    expect(() => disposer()).not.toThrow()
    expect(() => disposer()).not.toThrow()
  })
})
