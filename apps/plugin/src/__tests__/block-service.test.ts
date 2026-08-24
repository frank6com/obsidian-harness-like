// @vitest-environment jsdom

/**
 * BlockService 行为测试：注册/分发/懒注册去重/冲突/别名改名/占位符/disposer/list。
 * 服务保持纯逻辑（notify/renderPlaceholder 由测试 spy 注入）。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  BlockService,
  defaultBlockLang,
  isValidBlockAlias,
  normalizeBlockLang,
  type BlockDeps,
} from '../block-service'

function el(): HTMLElement {
  const e = document.createElement('div')
  ;(e as unknown as { createDiv: (o?: { cls?: string; text?: string }) => HTMLElement }).createDiv = (o) => {
    const d = document.createElement('div')
    if (o?.cls) d.className = o.cls
    if (o?.text) d.textContent = o.text
    e.appendChild(d)
    return d
  }
  return e
}

function makeDeps(aliases: Record<string, string> = {}) {
  const nativeLangs: string[] = []
  const deps: BlockDeps & { notifySpy: ReturnType<typeof vi.fn>; placeholderSpy: ReturnType<typeof vi.fn> } = {
    registerNative: (lang) => nativeLangs.push(lang),
    getAlias: (pid, type) => aliases[`${pid}:${type}`],
    setAlias: (pid, type, alias) => {
      if (alias) aliases[`${pid}:${type}`] = alias
      else delete aliases[`${pid}:${type}`]
    },
    notify: vi.fn(),
    renderPlaceholder: vi.fn(),
    notifySpy: undefined as never,
    placeholderSpy: undefined as never,
  }
  deps.notifySpy = deps.notify as ReturnType<typeof vi.fn>
  deps.placeholderSpy = deps.renderPlaceholder as ReturnType<typeof vi.fn>
  return { deps, nativeLangs }
}

describe('块语言串工具', () => {
  it('默认形态与归一', () => {
    expect(defaultBlockLang('demo', 'chart')).toBe('hl:demo:chart')
    expect(normalizeBlockLang(' HL:Demo:Chart ')).toBe('hl:demo:chart')
  })
  it('别名校验：hl: 前缀 + 非空 + 无空白', () => {
    expect(isValidBlockAlias('hl:nc')).toBe(true)
    expect(isValidBlockAlias('HL:x1')).toBe(true)
    expect(isValidBlockAlias('hl:')).toBe(false)
    expect(isValidBlockAlias('chart')).toBe(false)
    expect(isValidBlockAlias('hl:a b')).toBe(false)
  })
})

describe('BlockService.register / dispatch', () => {
  it('注册 → dispatch 命中 handler；同语言原生只懒注册一次；大小写归一', () => {
    const { deps, nativeLangs } = makeDeps()
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'Chart', (source) => seen.push(source))

    const el1 = el()
    svc.dispatch('HL:DEMO:CHART', 'v1', el1, {})
    expect(seen).toEqual(['v1'])
    // 再注册另一类型（不同语言）后，原语言仍只注册一次
    svc.register('demo', 'table', () => {})
    expect(nativeLangs).toEqual(['hl:demo:chart', 'hl:demo:table'])
  })

  it('disposer 后渲染未运行占位符（引用比较防误删）', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const h = (): void => {}
    const dispose = svc.register('demo', 'chart', h)
    dispose()
    const e = el()
    svc.dispatch('hl:demo:chart', '', e, {})
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'notRunning', { lang: 'hl:demo:chart' })
  })

  it('重复注册同 (pluginId, type) 覆盖旧 handler，旧 disposer 不误删新路由', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const calls: string[] = []
    const d1 = svc.register('demo', 'chart', () => calls.push('old'))
    svc.register('demo', 'chart', () => calls.push('new'))
    d1() // 旧 disposer：handler 引用不等，不删除
    svc.dispatch('hl:demo:chart', '', el(), {})
    expect(calls).toEqual(['new'])
  })

  it('语言串被其他插件占用 → 新路由标记 conflict 不分发 + notify，插件不崩', () => {
    // p2 的别名撞上 p1 的默认语言串
    const { deps: deps2 } = makeDeps({ 'p2:t': 'hl:p1:t' })
    const svc2 = new BlockService(deps2)
    const p1calls: string[] = []
    svc2.register('p1', 't', () => p1calls.push('p1'))
    const p2calls: string[] = []
    svc2.register('p2', 't', () => p2calls.push('p2')) // → hl:p1:t 冲突
    expect(deps2.notifySpy).toHaveBeenCalled()
    expect(svc2.list().find((e) => e.pluginId === 'p2')?.status).toBe('conflict')

    // 分发不抛错：先到者继续服务，冲突方不参与
    let threw = false
    try {
      svc2.dispatch('hl:p1:t', '', el(), {})
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(p1calls).toEqual(['p1'])
    expect(p2calls).toEqual([])
  })
})

describe('BlockService.rename', () => {
  it('改名迁移路由并持久化别名；旧名留 renamed 占位；新名立即生效', () => {
    const aliases: Record<string, string> = {}
    const { deps, nativeLangs } = makeDeps(aliases)
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', (s) => seen.push(s))

    expect(svc.rename('demo', 'chart', 'hl:nc')).toBe(true)
    expect(aliases['demo:chart']).toBe('hl:nc')

    // 旧名 → renamed 占位（带新名提示）
    const oldEl = el()
    svc.dispatch('hl:demo:chart', '', oldEl, {})
    expect(deps.placeholderSpy).toHaveBeenCalledWith(oldEl, 'renamed', { lang: 'hl:nc' })

    // 新名 → 立即生效且懒注册
    svc.dispatch('hl:nc', 'data', el(), {})
    expect(seen).toEqual(['data'])
    expect(nativeLangs).toContain('hl:nc')

    // list 反映新状态：新名 active + 旧名 renamed 提示
    const entries = svc.list().filter((e) => e.pluginId === 'demo')
    expect(entries.find((e) => e.status === 'active')).toMatchObject({ type: 'chart', lang: 'hl:nc' })
    expect(entries.find((e) => e.status === 'renamed')).toMatchObject({ lang: 'hl:nc' })
  })

  it('非法别名拒绝；占用他人语言串拒绝', () => {
    const aliases: Record<string, string> = {}
    const { deps } = makeDeps(aliases)
    const svc = new BlockService(deps)
    svc.register('a', 'x', () => {})
    svc.register('b', 'y', () => {})

    expect(svc.rename('a', 'x', 'chart')).toBe(false) // 缺前缀
    expect(svc.rename('a', 'x', 'hl:b:y')).toBe(false) // b 已占默认名
    expect(aliases['a:x']).toBeUndefined()
  })

  it('reload 场景：改名后重新 register 走别名语言', () => {
    const aliases: Record<string, string> = { 'demo:chart': 'hl:nc' }
    const { deps } = makeDeps(aliases)
    const svc = new BlockService(deps)
    svc.register('demo', 'chart', () => {})
    expect(svc.list()[0]?.lang).toBe('hl:nc')
  })

  it('改名后 disposer 仍能清理迁移后的路由（停止 → notRunning 占位，renamed 标记保留）', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const dispose = svc.register('demo', 'chart', () => {})
    svc.rename('demo', 'chart', 'hl:nc')
    dispose()
    const e = el()
    svc.dispatch('hl:nc', '', e, {})
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'notRunning', { lang: 'hl:nc' })
    // 旧名 renamed 历史提示不受 stop 影响
    svc.dispatch('hl:demo:chart', '', el(), {})
    expect(deps.placeholderSpy).toHaveBeenCalledWith(el(), 'renamed', expect.anything())
    expect(svc.list().some((x) => x.status === 'renamed')).toBe(true)
  })
})
