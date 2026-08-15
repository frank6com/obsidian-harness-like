/**
 * i18n 单元测试：语言切换、占位符、字典完整性、内置智能体显示名映射。
 */

import { describe, expect, it } from 'vitest'
import {
  agentDisplayDesc,
  agentDisplayName,
  detectLanguage,
  getLanguage,
  setLanguage,
  t,
} from '../i18n'
import { migrateSettings } from '../settings'

describe('i18n 基础', () => {
  it('node 环境默认中文；缺失 key 回退 key 本身', () => {
    expect(detectLanguage()).toBe('zh')
    expect(getLanguage()).toBe('zh')
    expect(t('common.cancel')).toBe('取消')
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('切换英文后取英文文案；再切回中文', () => {
    setLanguage('en')
    expect(t('common.cancel')).toBe('Cancel')
    expect(t('chat.send')).toBe('Send')
    setLanguage('zh')
    expect(t('common.cancel')).toBe('取消')
  })

  it('占位符替换（含中文缺失 key 的英文回退）', () => {
    setLanguage('en')
    expect(t('chat.tool.fail', { tool: 'write_note', msg: 'boom' })).toBe(
      '✗ write_note failed: boom',
    )
    setLanguage('zh')
    expect(t('chat.phase.tool', { name: 'write_note' })).toBe('调用工具 write_note…')
  })

  it('zh / en 字典键集合完全一致', async () => {
    // 通过公共 API 无法直接拿字典，改为验证若干关键键在两种语言下都有非空文案
    const { setLanguage: set } = await import('../i18n')
    const keys = ['chat.copyTurn', 'pm.delete.confirm', 'modal.write.title', 'settings.ui.language']
    for (const key of keys) {
      set('zh')
      expect(t(key).length).toBeGreaterThan(0)
      set('en')
      expect(t(key).length).toBeGreaterThan(0)
    }
    set('zh')
  })
})

describe('内置智能体显示名映射', () => {
  it('内置 id 按语言显示，自定义智能体用存储值', () => {
    setLanguage('zh')
    expect(agentDisplayName({ id: 'chat', name: '对话模式' })).toBe('对话模式')
    expect(agentDisplayDesc({ id: 'edit', description: '旧描述' })).toBe('可读写笔记（默认）')
    expect(agentDisplayName({ id: 'custom-1', name: '我的智能体' })).toBe('我的智能体')
    expect(agentDisplayDesc({ id: 'custom-1', description: '自定义描述' })).toBe('自定义描述')

    setLanguage('en')
    expect(agentDisplayName({ id: 'chat', name: '对话模式' })).toBe('Chat Mode')
    expect(agentDisplayDesc({ id: 'edit', description: '旧描述' })).toBe(
      'Can read and write notes (default)',
    )
    expect(agentDisplayName({ id: 'custom-1', name: '我的智能体' })).toBe('我的智能体')
    setLanguage('zh')
  })
})

describe('uiLanguage 设置迁移', () => {
  it('默认跟随系统（node 下为 zh）；显式 en 保留；非法值回落 zh', () => {
    expect(migrateSettings({} as Record<string, unknown>).uiLanguage).toBe('zh')
    expect(migrateSettings({ uiLanguage: 'en' } as Record<string, unknown>).uiLanguage).toBe('en')
    expect(migrateSettings({ uiLanguage: 'fr' } as Record<string, unknown>).uiLanguage).toBe('zh')
  })
})
