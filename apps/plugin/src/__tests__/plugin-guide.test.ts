/**
 * PLUGIN_GUIDE 章节化拆分测试：章节完整性、拼装顺序、关键内容锚点。
 * 防止拆分/后续增章时丢失关键指引（工作流顺序、模板、服务签名、铁律）。
 */

import { describe, expect, it } from 'vitest'
import {
  CHAPTERS,
  GUIDE_TITLE,
  PLUGIN_GUIDE,
  buildGuide,
  CH_BLOCKS,
  CH_SERVICES,
  CH_WORKFLOW,
} from '../tools/plugin-guide'

describe('PLUGIN_GUIDE 章节化（0.44.0）', () => {
  it('buildGuide = 标题 + 全部章节按登记顺序拼接', () => {
    const g = buildGuide()
    expect(g.startsWith(GUIDE_TITLE)).toBe(true)
    let pos = g.indexOf(GUIDE_TITLE)
    for (const ch of CHAPTERS) {
      const idx = g.indexOf(ch, pos)
      expect(idx).toBeGreaterThan(-1) // 章节存在且在上一章节之后（顺序稳定）
      pos = idx
    }
  })

  it('PLUGIN_GUIDE 与 buildGuide() 一致（旧引用兼容）', () => {
    expect(PLUGIN_GUIDE).toBe(buildGuide())
  })

  it('关键内容锚点：工作流五步 / 模板 A B / 服务速查含 protocol+blocks / 铁律五条', () => {
    expect(CH_WORKFLOW).toContain('create_plugin')
    expect(CH_WORKFLOW).toContain('check_plugin')
    expect(CH_WORKFLOW).toContain('reload_plugin')
    expect(PLUGIN_GUIDE).toContain("require('obsidian')")
    expect(PLUGIN_GUIDE).toContain("module.exports")
    // 服务速查：inject 清单与扩展点签名（速查行用全角冒号，示例行为 ctx.protocol.register）
    expect(CH_SERVICES).toContain('/ blocks')
    expect(CH_SERVICES).toContain('ctx.protocol.register')
    expect(CH_SERVICES).toContain('ctx.blocks：register')
    expect(CH_SERVICES).toContain('hl:<你的插件id>:<type>')
    // 铁律五条
    for (const rule of ['1.', '2.', '3.', '4.', '5.']) {
      expect(PLUGIN_GUIDE).toMatch(new RegExp(`铁律[\\s\\S]*${rule} `))
    }
    // 块章节：语言串形态与占位行为
    expect(CH_BLOCKS).toContain('hl:<你的插件id>:<type>')
    expect(CH_BLOCKS).toContain('未运行')
  })

  it('章节标题唯一（重复会导致锚点检索歧义与文档站同步混乱）', () => {
    const titles = CHAPTERS.map((c) => c.slice(0, c.indexOf('\n') === -1 ? undefined : c.indexOf('\n')))
    expect(new Set(titles).size).toBe(titles.length)
  })
})
