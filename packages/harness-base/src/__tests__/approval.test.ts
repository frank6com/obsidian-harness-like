import { describe, expect, it, vi } from 'vitest'
import { ApprovalService } from '../approval'

function makeStore() {
  const data: Record<string, never> = {}
  return {
    load: vi.fn(() => ({ ...data })),
    save: vi.fn((g: Record<string, never>) => {
      Object.keys(data).forEach((k) => delete data[k])
      Object.assign(data, g)
    }),
    data,
  }
}

describe('ApprovalService grants（单勾/双勾）', () => {
  it('未授权时拒绝', () => {
    const svc = new ApprovalService(makeStore())
    expect(svc.isGranted('p1', '0.1.0')).toBe(false)
  })

  it('单勾（version）仅信任当前版本', () => {
    const svc = new ApprovalService(makeStore())
    svc.grant('p1', 'version', '0.1.0')
    expect(svc.isGranted('p1', '0.1.0')).toBe(true)
    expect(svc.isGranted('p1', '0.2.0')).toBe(false)
  })

  it('双勾（all）信任后续版本', () => {
    const svc = new ApprovalService(makeStore())
    svc.grant('p1', 'all', '0.1.0')
    expect(svc.isGranted('p1', '9.9.9')).toBe(true)
  })

  it('撤销后不再信任', () => {
    const svc = new ApprovalService(makeStore())
    svc.grant('p1', 'all', '0.1.0')
    svc.revoke('p1')
    expect(svc.isGranted('p1', '0.1.0')).toBe(false)
  })

  it('grant 持久化到 store', () => {
    const store = makeStore()
    const svc = new ApprovalService(store)
    svc.grant('p1', 'version', '0.1.0')
    expect(store.save).toHaveBeenCalled()
    const svc2 = new ApprovalService(store)
    expect(svc2.isGranted('p1', '0.1.0')).toBe(true)
  })
})

describe('ApprovalService 写操作决策', () => {
  it('默认按 ask/deny 模式', () => {
    const svc = new ApprovalService(makeStore())
    expect(svc.decideWrite('ask')).toBe('ask')
    expect(svc.decideWrite('deny')).toBe('deny')
  })

  it('会话级开关一次性放宽', () => {
    const svc = new ApprovalService(makeStore())
    svc.setSessionAllow(true)
    expect(svc.decideWrite('ask')).toBe('allow')
    expect(svc.isSessionAllowed()).toBe(true)
  })

  it('会话级开关不持久化', () => {
    const store = makeStore()
    const svc = new ApprovalService(store)
    svc.setSessionAllow(true)
    const svc2 = new ApprovalService(store)
    expect(svc2.isSessionAllowed()).toBe(false)
  })
})
