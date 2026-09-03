/**
 * 文件树装饰纯逻辑测试（不含 DOM 渲染；渲染依赖 Obsidian 实时文件树）。
 */

import { describe, expect, it } from 'vitest'
import { ancestorsOf, mergeDecorations } from '../file-tree-service'

describe('ancestorsOf', () => {
  it('笔记路径返回全部祖先文件夹', () => {
    expect(ancestorsOf('A/B/C/note.md')).toEqual(['A', 'A/B', 'A/B/C'])
  })
  it('根目录笔记无祖先', () => {
    expect(ancestorsOf('note.md')).toEqual([])
  })
  it('反斜杠与首尾斜杠归一', () => {
    expect(ancestorsOf('/A/B/n.md/')).toEqual(['A', 'A/B'])
  })
  it('文件夹路径（无文件段）返回除自身的祖先', () => {
    expect(ancestorsOf('A/B/C')).toEqual(['A', 'A/B'])
  })
})

describe('mergeDecorations', () => {
  it('class 去重、徽标与提示收集', () => {
    const merged = mergeDecorations([
      { classes: ['underline'], badge: { text: '3', color: '#e5484d', title: '待办' }, tooltip: '甲' },
      { classes: ['underline', 'dim'], badge: { text: '●' }, tooltip: '乙' },
    ])
    expect(merged.classes.sort()).toEqual(['dim', 'underline'])
    expect(merged.badges).toHaveLength(2)
    expect(merged.tooltip).toBe('甲；乙')
  })
  it('空 badge（无 text/color/title）被丢弃', () => {
    const merged = mergeDecorations([{ badge: {} }])
    expect(merged.badges).toHaveLength(0)
  })
  it('空装饰返回空结构', () => {
    const merged = mergeDecorations([])
    expect(merged.classes).toEqual([])
    expect(merged.badges).toEqual([])
    expect(merged.tooltip).toBe('')
  })
})
