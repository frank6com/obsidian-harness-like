/**
 * 设置面第二批纯函数测试：日志级别、会话保留、目录白名单。
 */

import { describe, expect, it } from 'vitest'
import { shouldLog, selectSessionsToPrune, type SessionSummary } from '@dsh-obsidian/harness-base'
import { isPathInDirs, normalizeVaultPath } from '../policy'

describe('shouldLog', () => {
  it('级别过滤：info 配置下 warn/error 输出，debug 不输出', () => {
    expect(shouldLog('debug', 'info')).toBe(false)
    expect(shouldLog('info', 'info')).toBe(true)
    expect(shouldLog('warn', 'info')).toBe(true)
    expect(shouldLog('error', 'info')).toBe(true)
  })

  it('debug 配置下全部输出', () => {
    expect(shouldLog('debug', 'debug')).toBe(true)
    expect(shouldLog('error', 'debug')).toBe(true)
  })
})

describe('selectSessionsToPrune', () => {
  const day = 86_400_000
  const now = 1_000_000_000_000
  const sessions: SessionSummary[] = [
    { id: 'old', updatedAt: now - 10 * day, count: 5 },
    { id: 'recent', updatedAt: now - 2 * day, count: 5 },
    { id: 'today', updatedAt: now, count: 5 },
  ]

  it('retentionDays=0 不清理', () => {
    expect(selectSessionsToPrune(sessions, now, 0)).toEqual([])
  })

  it('清理超过保留天数的会话', () => {
    expect(selectSessionsToPrune(sessions, now, 7)).toEqual(['old'])
    expect(selectSessionsToPrune(sessions, now, 1)).toEqual(['old', 'recent'])
  })
})

describe('isPathInDirs（目录白名单）', () => {
  it('目录边界匹配', () => {
    expect(isPathInDirs('Inbox/a.md', ['Inbox'])).toBe(true)
    expect(isPathInDirs('Inbox/子目录/x.md', ['Inbox'])).toBe(true)
    expect(isPathInDirs('InboxNote.md', ['Inbox'])).toBe(false)
    expect(isPathInDirs('Projects/Inbox/a.md', ['Inbox'])).toBe(false)
    expect(isPathInDirs('a.md', ['Inbox'])).toBe(false)
  })

  it('路径规范化（反斜杠/首尾斜杠）', () => {
    expect(isPathInDirs('Inbox\\a.md', ['Inbox'])).toBe(true)
    expect(isPathInDirs('/Inbox/a.md', ['Inbox/'])).toBe(true)
    expect(normalizeVaultPath('\\Inbox\\a.md\\')).toBe('Inbox/a.md')
  })

  it('空白名单不匹配任何路径', () => {
    expect(isPathInDirs('Inbox/a.md', [])).toBe(false)
  })
})
