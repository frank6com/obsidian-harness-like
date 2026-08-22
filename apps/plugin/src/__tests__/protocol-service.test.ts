/**
 * obsidian:// 协议扩展点服务测试：
 * 统一入口单次注册 / query 路由 / 路由参数剥离 / 未命中提示 / 异常隔离 / 卸载失效。
 */

import { describe, expect, it, vi } from 'vitest'
import { ProtocolService } from '../protocol-service'

function makeService() {
  const entries: Array<(params: Record<string, string>) => unknown> = []
  const notify = vi.fn()
  const service = new ProtocolService({
    registerEntry: (handler) => entries.push(handler),
    notify,
  })
  return { service, entries, notify }
}

describe('ProtocolService', () => {
  it('构造时只向底层注册一个统一入口', () => {
    const { service, entries } = makeService()
    service.register('p1', 'a', () => {})
    service.register('p2', 'b', () => {})
    expect(entries).toHaveLength(1)
  })

  it('按 plugin/cmd 路由并剥离路由参数（含 Obsidian 预置的 action）', () => {
    const { service, entries, notify } = makeService()
    const handler = vi.fn()
    service.register('note-counter', 'add', handler)

    // 真实形态：Obsidian 解析后 data.action 恒为入口名（KC 函数预置覆盖）
    entries[0]!({ action: 'harness-like', plugin: 'note-counter', cmd: 'add', text: 'hello' })
    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('无值 query 参数按 "true" 字符串透传给 handler', () => {
    const { service, entries } = makeService()
    const handler = vi.fn()
    service.register('p1', 'go', handler)

    entries[0]!({ action: 'harness-like', plugin: 'p1', cmd: 'go', flag: 'true' })
    expect(handler).toHaveBeenCalledWith({ flag: 'true' })
  })

  it('缺少 plugin/cmd 参数时提示 missing', () => {
    const { service, entries, notify } = makeService()
    service.register('p1', 'a', () => {})

    entries[0]!({ action: 'harness-like' })
    expect(notify).toHaveBeenCalledWith('missing', {})
    entries[0]!({ action: 'harness-like', plugin: '' })
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('插件未运行或动作不存在时提示 notFound', () => {
    const { service, entries, notify } = makeService()
    service.register('p1', 'a', () => {})

    entries[0]!({ plugin: 'ghost', cmd: 'a' })
    expect(notify).toHaveBeenCalledWith('notFound', { plugin: 'ghost', cmd: 'a' })
    entries[0]!({ plugin: 'p1', cmd: 'unknown' })
    expect(notify).toHaveBeenLastCalledWith('notFound', { plugin: 'p1', cmd: 'unknown' })
  })

  it('handler 抛错不阻断后续分发（异常隔离）', () => {
    const { service, entries } = makeService()
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    service.register('p1', 'bad', bad)
    service.register('p2', 'good', good)

    expect(() => entries[0]!({ plugin: 'p1', cmd: 'bad' })).not.toThrow()
    expect(() => entries[0]!({ plugin: 'p2', cmd: 'good' })).not.toThrow()
    expect(good).toHaveBeenCalled()
  })

  it('disposer 后深链失效；重复注册后者覆盖且旧 disposer 不误删新 handler', () => {
    const { service, entries } = makeService()
    const first = vi.fn()
    const second = vi.fn()

    // disposer 生效
    service.register('p1', 'run', first)()
    entries[0]!({ plugin: 'p1', cmd: 'run' })
    expect(first).not.toHaveBeenCalled()

    // 同 (插件, 动作) 重复注册：后者覆盖前者（防 reload 残留）
    const oldDispose = service.register('p1', 'keep', first)
    service.register('p1', 'keep', second)
    // 旧 fiber 的 stale disposer 不应移除新 handler
    oldDispose()
    entries[0]!({ plugin: 'p1', cmd: 'keep' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('卸载后同 URL 到达走 notFound 提示（彻底失效、零残留）', () => {
    const { service, entries, notify } = makeService()
    service.register('p1', 'open', vi.fn())()

    entries[0]!({ plugin: 'p1', cmd: 'open' })
    expect(notify).toHaveBeenCalledWith('notFound', { plugin: 'p1', cmd: 'open' })
  })
})
