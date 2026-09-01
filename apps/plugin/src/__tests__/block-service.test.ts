// @vitest-environment jsdom

/**
 * BlockService 行为测试（v2：原生只注册一次 hl，路由下沉到内存表）：
 * 启动注册去重 / 参数与 meta 注入 / 别名解析（真实 id 优先）/ 默认 type /
 * 四类占位符 / disposer 与覆盖 / list / handler 异常隔离。
 * 服务保持纯逻辑（registerNative / resolveTarget / renderPlaceholder 由测试注入）。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  BlockService,
  DEFAULT_BLOCK_TYPE,
  defaultTypeOf,
  type BlockDeps,
  type BlockMeta,
  type BlockRenderContext,
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

/** 构造渲染上下文：section 文本 = ```<info>\n<source>\n```（readFenceInfo 靠 source 定位） */
function renderCtx(info: string, source: string, lineStart = 0): BlockRenderContext {
  return { getSectionInfo: () => ({ text: `\`\`\`${info}\n${source}\n\`\`\``, lineStart }) }
}

function makeDeps(targets: Record<string, string | undefined> = {}) {
  const nativeLangs: string[] = []
  const deps: BlockDeps & { placeholderSpy: ReturnType<typeof vi.fn> } = {
    // 默认：token 即插件 id；传 targets 可模拟别名（含"别名失效"= undefined）
    resolveTarget: (token) => (token in targets ? targets[token] : token),
    registerNative: (lang) => nativeLangs.push(lang),
    renderPlaceholder: vi.fn(),
    placeholderSpy: undefined as never,
  }
  deps.placeholderSpy = deps.renderPlaceholder as ReturnType<typeof vi.fn>
  return { deps, nativeLangs }
}

describe('原生注册：只注册一次 hl', () => {
  it('registerNativeOnce 幂等，与子插件注册数量无关', () => {
    const { deps, nativeLangs } = makeDeps()
    const svc = new BlockService(deps)
    svc.registerNativeOnce()
    svc.register('demo', 'chart', () => {})
    svc.register('demo', 'table', () => {})
    svc.registerNativeOnce()
    expect(nativeLangs).toEqual(['hl'])
  })
})

describe('dispatch：命中与 meta 注入', () => {
  it('参数、行号、type 均注入 meta', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const metas: BlockMeta[] = []
    svc.register('demo', 'chart', (_s, _el, _ctx, meta) => {
      metas.push(meta)
    })
    svc.dispatch('SRC', el(), renderCtx('hl demo:chart p1:aaa --flag bare', 'SRC', 12))
    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({
      info: 'hl demo:chart p1:aaa --flag bare',
      pluginId: 'demo',
      type: 'chart',
      typeExplicit: true,
      params: { p1: 'aaa' },
      flags: ['flag'],
      positional: ['bare'],
      line: 12,
    })
  })

  it('大小写归一（注册用 Chart，笔记写 CHART）', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'Chart', () => seen.push('hit'))
    svc.dispatch('SRC', el(), renderCtx('hl DEMO:CHART', 'SRC'))
    expect(seen).toEqual(['hit'])
  })
})

describe('dispatch：别名解析（真实 id 优先由宿主保证）', () => {
  it('别名映射到真实插件 id', () => {
    const { deps } = makeDeps({ d: 'demo' })
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', (_s, _e, _c, meta) => seen.push(meta.pluginId))
    svc.dispatch('SRC', el(), renderCtx('hl d:chart', 'SRC'))
    expect(seen).toEqual(['demo'])
  })

  it('别名省略 type 时同样走默认 type 解析', () => {
    const { deps } = makeDeps({ d: 'demo' })
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', (_s, _e, _c, meta) => seen.push(meta.type))
    svc.dispatch('SRC', el(), renderCtx('hl d', 'SRC'))
    expect(seen).toEqual(['chart'])
  })

  it('宿主拒绝解析（别名/未运行）→ notRunning 占位', () => {
    const { deps } = makeDeps({ d: undefined })
    const svc = new BlockService(deps)
    svc.register('demo', 'chart', () => {})
    const e = el()
    svc.dispatch('SRC', e, renderCtx('hl d:chart', 'SRC'))
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'notRunning', {
      info: 'hl d:chart',
      pluginId: 'd',
    })
  })
})

describe('dispatch：默认 type 解析', () => {
  it('唯一 type 时可省略', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', (_s, _e, _c, meta) => seen.push(meta.type))
    svc.dispatch('SRC', el(), renderCtx('hl demo', 'SRC'))
    expect(seen).toEqual(['chart'])
  })

  it('注册了 default 时优先 default', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', () => seen.push('chart'))
    svc.register('demo', DEFAULT_BLOCK_TYPE, () => seen.push('default'))
    svc.dispatch('SRC', el(), renderCtx('hl demo', 'SRC'))
    expect(seen).toEqual(['default'])
  })

  it('多 type 且未指定 → needType 占位并列出可选', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    svc.register('demo', 'chart', () => {})
    svc.register('demo', 'table', () => {})
    const e = el()
    svc.dispatch('SRC', e, renderCtx('hl demo', 'SRC'))
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'needType', {
      info: 'hl demo',
      pluginId: 'demo',
      types: expect.arrayContaining(['chart', 'table']),
    })
  })
})

describe('dispatch：占位符与异常隔离', () => {
  it('旧语法 hl:<id>:<type> → legacy 占位并给出可迁移写法信息', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    svc.register('demo', 'chart', () => {})
    const e = el()
    svc.dispatch('SRC', e, renderCtx('hl:demo:chart', 'SRC'))
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'legacy', {
      info: 'hl:demo:chart',
      legacy: { pluginId: 'demo', type: 'chart' },
    })
  })

  it('插件已解析但未注册该 type → notRunning', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    svc.register('demo', 'chart', () => {})
    const e = el()
    svc.dispatch('SRC', e, renderCtx('hl demo:table', 'SRC'))
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'notRunning', {
      info: 'hl demo:table',
      pluginId: 'demo',
    })
  })

  it('拿不到 fence 行（无 sectionInfo）→ badInfo(nolocate) 并携带原文', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    svc.register('demo', 'chart', () => {})
    const e = el()
    svc.dispatch('SRC', e, {})
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'badInfo', { source: 'SRC', reason: 'nolocate' })
  })

  it('缺 target（只有 hl）→ badInfo(syntax) 并携带原文', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const e = el()
    svc.dispatch('SRC', e, renderCtx('hl', 'SRC'))
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'badInfo', {
      info: 'hl',
      source: 'SRC',
      reason: 'syntax',
    })
  })

  it('handler 抛异常不外溢（单块失败不阻断渲染管线）', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    svc.register('demo', 'chart', () => {
      throw new Error('boom')
    })
    expect(() => svc.dispatch('SRC', el(), renderCtx('hl demo:chart', 'SRC'))).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('dispatch：同 section 多块唯一定位', () => {
  /** 两个相邻的同内容块（中间无空行 → 同一 section，内容相同无法用 source 区分） */
  const multiCtx = (lineStart = 0): BlockRenderContext => ({
    getSectionInfo: () => ({
      text: '```hl demo:counter\nX\n```\n```hl demo:task-list\nX\n```',
      lineStart,
    }),
  })

  it('宿主提供 CM 行号时按行号精确定位（Live Preview 场景）', () => {
    const { deps } = makeDeps()
    const lines = new Map<HTMLElement, number>()
    deps.resolveBlockLine = (e) => lines.get(e) ?? null
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'counter', (_s, _e, _c, m) => seen.push(m.type))
    svc.register('demo', 'task-list', (_s, _e, _c, m) => seen.push(m.type))

    const e1 = el()
    const e2 = el()
    // section 内两个 fence 的绝对行号：7（counter）与 10（task-list）
    lines.set(e1, 7)
    lines.set(e2, 10)
    svc.dispatch('X', e1, multiCtx(7))
    svc.dispatch('X', e2, multiCtx(7))
    expect(seen).toEqual(['counter', 'task-list'])
  })

  it('行号未命中且无直读时不再回退到任意候选（避免误标插件未运行），降级原文', () => {
    const { deps } = makeDeps()
    deps.resolveBlockLine = () => 99
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'counter', (_s, _e, _c, m) => seen.push(m.type))
    svc.register('demo', 'task-list', () => seen.push('task-list'))
    const e = el()
    svc.dispatch('X', e, multiCtx())
    expect(seen).toEqual([])
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'badInfo', { source: 'X', reason: 'nolocate' })
  })

  it('空内容块直接渲染"空内容"提示框，不调用 handler', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', () => seen.push('hit'))
    const e = el()
    svc.dispatch('', e, renderCtx('hl demo:chart', 'SRC'))
    expect(seen).toEqual([])
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'empty', { source: '' })
  })

  it('首帧定位失败（widget 未挂载）→ 降级占位后 rAF 重试成功渲染', async () => {
    const { deps } = makeDeps()
    let directCalls = 0
    // 第一次（handler 同步阶段）直读返回 null（模拟 .cm-editor 未挂载），
    // 下一帧重试时返回有效 info
    deps.resolveFenceInfoAt = () => (++directCalls === 1 ? null : 'hl demo:chart')
    const svc = new BlockService(deps)
    const seen: string[] = []
    svc.register('demo', 'chart', () => seen.push('hit'))
    const e = el()
    document.body.appendChild(e)
    svc.dispatch('X', e, {})
    expect(seen).toEqual([]) // 首帧未能定位，未调 handler
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'badInfo', { source: 'X', reason: 'nolocate' })
    await new Promise((r) => setTimeout(r, 40)) // 等待 rAF（jsdom ≈16ms）
    expect(seen).toEqual(['hit']) // 重试成功，handler 已渲染
    e.remove()
  })
})

describe('register / disposer / list', () => {
  it('disposer 后 notRunning；按 handler 引用比较防误删', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const calls: string[] = []
    const d1 = svc.register('demo', 'chart', () => calls.push('old'))
    svc.register('demo', 'chart', () => calls.push('new')) // 覆盖
    d1() // 旧 disposer：引用不等，不删新路由
    svc.dispatch('SRC', el(), renderCtx('hl demo:chart', 'SRC'))
    expect(calls).toEqual(['new'])

    const d2 = svc.register('demo', 'chart', () => calls.push('third'))
    d2()
    const e = el()
    svc.dispatch('SRC', e, renderCtx('hl demo:chart', 'SRC'))
    expect(deps.placeholderSpy).toHaveBeenCalledWith(e, 'notRunning', expect.anything())
  })

  it('非法 pluginId / type 拒绝注册', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    svc.register('', 'chart', () => {})
    svc.register('demo', '', () => {})
    svc.register('demo', 'a b', () => {})
    expect(svc.list()).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('list 枚举全部注册项（小写归一）', () => {
    const { deps } = makeDeps()
    const svc = new BlockService(deps)
    svc.register('Demo', 'Chart', () => {})
    svc.register('demo', 'table', () => {})
    expect(svc.list()).toEqual(
      expect.arrayContaining([
        { pluginId: 'demo', type: 'chart' },
        { pluginId: 'demo', type: 'table' },
      ]),
    )
  })
})

describe('defaultTypeOf：与路由层同源的默认 type 判定', () => {
  const entries = (types: string[]) => types.map((t) => ({ pluginId: 'demo', type: t }))

  it('default 优先，其次唯一 type，多 type 返回 null', () => {
    expect(defaultTypeOf(entries(['chart']), 'demo')).toBe('chart')
    expect(defaultTypeOf(entries(['chart', DEFAULT_BLOCK_TYPE]), 'demo')).toBe(DEFAULT_BLOCK_TYPE)
    expect(defaultTypeOf(entries(['chart', 'table']), 'demo')).toBeNull()
  })

  it('插件不存在 / 大小写不敏感', () => {
    expect(defaultTypeOf([], 'demo')).toBeNull()
    expect(defaultTypeOf(entries(['chart']), 'DEMO')).toBe('chart')
  })
})
