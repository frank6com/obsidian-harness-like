/**
 * 会话导出格式化测试。
 */

import { describe, expect, it } from 'vitest'
import { safeFileName, sessionToMarkdown } from '../export'
import type { SessionEvent } from '@dsh-obsidian/harness-base'

const events: SessionEvent[] = [
  { type: 'user/message', ts: 1, sessionId: 's1', content: '统计笔记' },
  { type: 'assistant/message', ts: 2, sessionId: 's1', content: '**结果**：共 3 篇' },
  { type: 'tool/call', ts: 3, sessionId: 's1', id: 'c1', tool: 'list_notes', input: {} },
  { type: 'tool/result', ts: 4, sessionId: 's1', id: 'c1', tool: 'list_notes', ok: true, output: { count: 3 } },
  { type: 'system/message', ts: 5, sessionId: 's1', content: '错误: 上一轮失败' },
]

describe('sessionToMarkdown', () => {
  it('包含标题、元信息与各角色内容', () => {
    const md = sessionToMarkdown({ title: '统计笔记', notePath: 'Inbox/a.md' }, events)
    expect(md).toContain('# 统计笔记')
    expect(md).toContain('绑定笔记: Inbox/a.md')
    expect(md).toContain('**我**')
    expect(md).toContain('统计笔记')
    expect(md).toContain('**dsh**')
    expect(md).toContain('**结果**：共 3 篇')
    expect(md).toContain('> ⚠ 错误: 上一轮失败')
  })

  it('工具调用与结果成对呈现', () => {
    const md = sessionToMarkdown({ title: 't', notePath: null }, events)
    expect(md).toContain('工具调用 `list_notes`')
    expect(md).toContain('✓ 完成')
  })

  it('失败结果标注 ✗ 与原因', () => {
    const failed: SessionEvent[] = [
      { type: 'tool/call', ts: 1, sessionId: 's', id: 'c9', tool: 'x', input: {} },
      { type: 'tool/result', ts: 2, sessionId: 's', id: 'c9', tool: 'x', ok: false, error: '被拒绝' },
    ]
    const md = sessionToMarkdown({ title: 't', notePath: null }, failed)
    expect(md).toContain('✗ 失败: 被拒绝')
  })

  it('多余空行被压缩', () => {
    const md = sessionToMarkdown({ title: 't', notePath: null }, [])
    expect(md).not.toContain('\n\n\n')
  })
})

describe('safeFileName', () => {
  it('去除非法字符并限制长度', () => {
    expect(safeFileName('a/b:c*d', 'fallback')).toBe('a-b-c-d.md')
    expect(safeFileName('', 'sess-1')).toBe('sess-1.md')
    expect(safeFileName('x'.repeat(100), 'f').length).toBeLessThan(50)
  })
})
