/**
 * 设置面纯函数测试：日志级别、会话保留、目录白名单、设置迁移、策略解析。
 */

import { describe, expect, it } from 'vitest'
import { shouldLog, selectSessionsToPrune, type SessionSummary } from '@harness-like/harness-base'
import {
  grantDisplay,
  listVisibleAgents,
  migrateSettings,
  parseHeaderLines,
  parseModelId,
  parseToolPolicy,
} from '../settings'
import { modeAllows } from '../mode'
import { isConfineAllowed, isPathInDirs, normalizeVaultPath } from '../policy'

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

describe('migrateSettings（旧版单提供方 → 多提供方）', () => {
  it('无数据时返回默认', () => {
    const s = migrateSettings(undefined)
    expect(s.providers).toHaveLength(1)
    expect(s.providers[0]!.id).toBe('deepseek')
    expect(s.streamingEnabled).toBe(true)
    expect(s.renderMarkdown).toBe(true)
    expect(s.exportDir).toBe('sessions')
  })

  it('导出目录迁移：缺失用默认 sessions，非法留空归一为空串', () => {
    expect(migrateSettings({} as Record<string, unknown>).exportDir).toBe('sessions')
    expect(migrateSettings({ exportDir: ' Exports/ ' } as Record<string, unknown>).exportDir).toBe(
      'Exports/',
    )
    expect(migrateSettings({ exportDir: '' } as Record<string, unknown>).exportDir).toBe('')
  })

  it('旧字段迁移为 providers[0]', () => {
    const s = migrateSettings({
      baseURL: 'https://x.example.com',
      apiKey: 'k',
      model: 'm1',
      temperature: 0.5,
      maxTokens: 200,
      approvalDefault: 'deny',
    } as Record<string, unknown>)
    expect(s.providers).toHaveLength(1)
    expect(s.providers[0]).toMatchObject({
      baseURL: 'https://x.example.com',
      apiKey: 'k',
      models: ['m1'],
      temperature: 0.5,
      maxTokens: 200,
    })
    expect(s.approvalDefault).toBe('deny')
  })

  it('已有多提供方结构时保留', () => {
    const s = migrateSettings({
      providers: [
        { id: 'a', name: 'A', baseURL: 'https://a', apiKey: '', models: ['x'], temperature: 0, maxTokens: 0, extraHeaders: ['X-K: v'] },
        { id: 'b', name: 'B', baseURL: 'https://b', apiKey: '', models: ['y'], temperature: 0, maxTokens: 0, extraHeaders: [] },
      ],
      activeProviderId: 'b',
      streamingEnabled: false,
    } as unknown as Record<string, unknown>)
    expect(s.providers).toHaveLength(2)
    expect(s.defaultModelId).toBe('b/y')
    expect(s.streamingEnabled).toBe(false)
  })
})

describe('parseToolPolicy / parseHeaderLines', () => {
  it('工具策略解析与非法行忽略', () => {
    const m = parseToolPolicy(['write_note=deny', 'search_notes=allow', 'bad', '=ask', 'x=unknown'])
    expect(m.get('write_note')).toBe('deny')
    expect(m.get('search_notes')).toBe('allow')
    expect(m.get('bad')).toBeUndefined()
  })

  it('请求头解析', () => {
    expect(parseHeaderLines(['X-Gateway: abc', 'badline', 'X-Empty: '])).toEqual({
      'X-Gateway': 'abc',
    })
  })
})

describe('parseModelId / 模式策略', () => {
  it('parseModelId 解析与非法输入', () => {
    expect(parseModelId('deepseek/deepseek-chat')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    expect(parseModelId('no-slash')).toBeNull()
    expect(parseModelId('/model')).toBeNull()
    expect(parseModelId('provider/')).toBeNull()
  })

  it('migrate：defaultModelId 优先，旧 activeProviderId 迁移为模型级默认', () => {
    const s = migrateSettings({
      providers: [
        { id: 'a', name: 'A', baseURL: 'https://a', apiKey: '', models: ['a1', 'a2'], temperature: 0, maxTokens: 0, extraHeaders: [] },
        { id: 'b', name: 'B', baseURL: 'https://b', apiKey: '', models: ['b1'], temperature: 0, maxTokens: 0, extraHeaders: [] },
      ],
      defaultModelId: 'a/a2',
    } as unknown as Record<string, unknown>)
    expect(s.defaultModelId).toBe('a/a2')
  })

  it('modeAllows：chat 只读 / edit 无插件开发 / create 全量', () => {
    expect(modeAllows('chat', 'read_note')).toBe(true)
    expect(modeAllows('chat', 'write_note')).toBe(false)
    expect(modeAllows('chat', 'create_plugin')).toBe(false)
    expect(modeAllows('edit', 'write_note')).toBe(true)
    expect(modeAllows('edit', 'create_plugin')).toBe(false)
    expect(modeAllows('create', 'create_plugin')).toBe(true)
    expect(modeAllows('create', 'anything')).toBe(true)
  })
})

describe('listVisibleAgents（启用过滤）', () => {
  it('过滤 disabled 智能体', () => {
    const agents = [
      { id: 'a', name: 'A', mode: 'chat' as const, enabled: true },
      { id: 'b', name: 'B', mode: 'edit' as const, enabled: false },
      { id: 'c', name: 'C', mode: 'create' as const },
    ]
    const visible = listVisibleAgents(agents)
    expect(visible.map((a) => a.id)).toEqual(['a', 'c'])
  })
})

describe('isConfineAllowed（仅当前笔记）', () => {
  it('目标等于当前笔记放行，其他拒绝，无活动笔记放行', () => {
    expect(isConfineAllowed('Inbox/a.md', 'Inbox/a.md')).toBe(true)
    expect(isConfineAllowed('Inbox/a.md', 'Inbox/b.md')).toBe(false)
    expect(isConfineAllowed(null, 'Inbox/b.md')).toBe(true)
  })
})

describe('grantDisplay（授权记录展示状态）', () => {
  const grant = { mode: 'version' as const, version: '0.2.0', grantedAt: 1 }

  it('无授权 = 未授权', () => {
    expect(grantDisplay(undefined, true)).toEqual({ badge: '未授权', needsRegrant: false })
  })

  it('双勾信任所有版本，不因版本变化需重新授权', () => {
    const g = { ...grant, mode: 'all' as const }
    expect(grantDisplay(g, true, '9.9.9')).toEqual({
      badge: '已授权(双勾 v0.2.0)',
      needsRegrant: false,
    })
  })

  it('单勾且版本一致 = 正常；版本更新 = 需重新授权', () => {
    expect(grantDisplay(grant, true, '0.2.0')).toEqual({
      badge: '已授权(单勾 v0.2.0)',
      needsRegrant: false,
    })
    expect(grantDisplay(grant, true, '0.3.0')).toEqual({
      badge: '已授权(单勾 v0.2.0) · 版本已更新，需重新授权',
      needsRegrant: true,
    })
  })

  it('插件目录不存在 = 残留授权', () => {
    expect(grantDisplay(grant, false).badge).toContain('插件目录不存在（残留授权）')
  })
})

describe('pluginEnabled 开关状态持久化（0.34.6）', () => {
  it('缺省为空对象（全部视为启用，兼容旧数据）', () => {
    const migrated = migrateSettings({} as never)
    expect(migrated.pluginEnabled).toEqual({})
  })

  it('迁移保留用户停用记录', () => {
    const migrated = migrateSettings({ pluginEnabled: { 'a-plugin': false } } as never)
    expect(migrated.pluginEnabled).toEqual({ 'a-plugin': false })
  })

  it('非法值（非对象）回退为空对象', () => {
    const migrated = migrateSettings({ pluginEnabled: 'bad' } as never)
    expect(migrated.pluginEnabled).toEqual({})
  })
})
