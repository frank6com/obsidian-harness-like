// @vitest-environment jsdom

/**
 * 块 info 解析层测试：参数归位（k:v / k=v / 引号 / --flag / 裸词）、
 * target 与 type 归一、旧语法识别、fence 反查（含行号与未命中）、别名校验、
 * section 序号定位（数量匹配自适应，需 DOM）。
 */

import { describe, expect, it } from 'vitest'
import {
  ALIAS_MAX_LEN,
  BLOCK_LANG,
  parseBlockInfo,
  readFenceCandidates,
  sectionOrdinal,
  validatePluginAlias,
} from '../block-info'

const el = {} as HTMLElement

describe('parseBlockInfo：基础归位', () => {
  it('target + 键值参数', () => {
    const r = parseBlockInfo('hl demo:chart p1:aaa p2:bbb')
    expect(r.kind).toBe('ok')
    expect(r.pluginToken).toBe('demo')
    expect(r.type).toBe('chart')
    expect(r.typeExplicit).toBe(true)
    expect(r.params).toEqual({ p1: 'aaa', p2: 'bbb' })
    expect(r.flags).toEqual([])
    expect(r.positional).toEqual([])
  })

  it('省略 type 时 typeExplicit 为 false', () => {
    const r = parseBlockInfo('hl demo p1:a')
    expect(r.kind).toBe('ok')
    expect(r.pluginToken).toBe('demo')
    expect(r.type).toBe('')
    expect(r.typeExplicit).toBe(false)
    expect(r.params).toEqual({ p1: 'a' })
  })

  it('大小写归一（lang/pluginId/type/flag），params key 保留原样', () => {
    const r = parseBlockInfo('HL Demo:Chart P1:a --NoCache')
    expect(r.lang).toBe(BLOCK_LANG)
    expect(r.pluginToken).toBe('demo')
    expect(r.type).toBe('chart')
    expect(r.params).toEqual({ P1: 'a' })
    expect(r.flags).toEqual(['nocache'])
  })

  it('多余空白与 CRLF 不影响解析', () => {
    expect(parseBlockInfo('  hl   demo:chart   p1:a  ').params).toEqual({ p1: 'a' })
    expect(parseBlockInfo('hl demo:chart p1:a\r').params).toEqual({ p1: 'a' })
  })

  it('重复 key 后者覆盖', () => {
    expect(parseBlockInfo('hl d p1:a p1:b').params).toEqual({ p1: 'b' })
  })
})

describe('parseBlockInfo：引号与分隔符', () => {
  it('双/单引号包裹含空格的值', () => {
    expect(parseBlockInfo('hl d title:"hello world"').params).toEqual({ title: 'hello world' })
    expect(parseBlockInfo("hl d title:'hello world'").params).toEqual({ title: 'hello world' })
  })

  it('引号内转义', () => {
    expect(parseBlockInfo('hl d k:"a\\"b"').params).toEqual({ k: 'a"b' })
  })

  it('未闭合引号退化为普通字符，不吞掉后续参数', () => {
    const r = parseBlockInfo('hl d title:"a b p2:c')
    expect(r.params.p2).toBe('c')
    expect(r.positional).toContain('b')
    expect(r.params.title).toBe('"a')
  })

  it('引号内的冒号不切分 key', () => {
    expect(parseBlockInfo('hl d "a:b":c').params).toEqual({ 'a:b': 'c' })
  })

  it('k=v 与 k:v 等价', () => {
    expect(parseBlockInfo('hl d p1=aaa p2:bbb').params).toEqual({ p1: 'aaa', p2: 'bbb' })
  })

  it('--k=v 记入 params 而非 flags', () => {
    const r = parseBlockInfo('hl d --limit=10 --flag')
    expect(r.params).toEqual({ limit: '10' })
    expect(r.flags).toEqual(['flag'])
  })

  it('裸词与以分隔符开头的 token 归 positional', () => {
    const r = parseBlockInfo('hl d chart bare "two words" :novalue')
    expect(r.positional).toEqual(['chart', 'bare', 'two words', ':novalue'])
    expect(r.params).toEqual({})
  })

  it('孤立的 -- 被忽略', () => {
    const r = parseBlockInfo('hl d -- p1:a')
    expect(r.flags).toEqual([])
    expect(r.params).toEqual({ p1: 'a' })
  })
})

describe('parseBlockInfo：异常与旧语法', () => {
  it('旧语法 hl:<id>:<type> 识别并给出可迁移信息', () => {
    const r = parseBlockInfo('hl:demo:chart')
    expect(r.kind).toBe('legacy')
    expect(r.legacy).toEqual({ pluginId: 'demo', type: 'chart' })
  })

  it('旧语法 hl: 空段也算 legacy', () => {
    const r = parseBlockInfo('hl:')
    expect(r.kind).toBe('legacy')
    expect(r.legacy).toEqual({ pluginId: '', type: '' })
  })

  it('缺 target（只有 hl）', () => {
    expect(parseBlockInfo('hl').kind).toBe('missingTarget')
  })

  it('非本命名空间 / 空串', () => {
    expect(parseBlockInfo('js x').kind).toBe('notHl')
    expect(parseBlockInfo('').kind).toBe('notHl')
  })
})

describe('readFenceCandidates：section 内候选收集', () => {
  const ctx = (text: string, lineStart = 0) => ({ getSectionInfo: () => ({ text, lineStart }) })

  it('收集 section 内全部 hl 候选并标注与 source 是否一致', () => {
    const text = ['# 标题', '', '```hl a:one', 'AAA', '```', '', '```hl b:two p1:x', 'BBB', '```'].join('\n')
    expect(readFenceCandidates(ctx(text, 8), el, 'BBB')).toEqual([
      { info: 'hl a:one', line: 8 + 2, exact: false },
      { info: 'hl b:two p1:x', line: 8 + 6, exact: true },
    ])
  })

  it('非 hl 的原生语言（html 等）不参与候选', () => {
    const text = ['```html', '<b>x</b>', '```', '', '```hl demo', 'y', '```'].join('\n')
    expect(readFenceCandidates(ctx(text), el, 'y')).toEqual([{ info: 'hl demo', line: 4, exact: true }])
  })

  it('source 尾部换行差异不影响 exact 判定', () => {
    const text = ['```hl demo:chart', '123', '```'].join('\n')
    expect(readFenceCandidates(ctx(text), el, '123\n\n')).toEqual([
      { info: 'hl demo:chart', line: 0, exact: true },
    ])
  })

  it('~~~ 围栏同样识别', () => {
    const text = ['~~~hl demo', 'x', '~~~'].join('\n')
    expect(readFenceCandidates(ctx(text, 3), el, 'x')).toEqual([{ info: 'hl demo', line: 3, exact: true }])
  })

  it('无 sectionInfo / 返回 null / 无 hl 块一律返回空数组', () => {
    expect(readFenceCandidates(null, el, 'x')).toEqual([])
    expect(readFenceCandidates({ getSectionInfo: () => null }, el, 'x')).toEqual([])
    expect(readFenceCandidates(ctx(['```js', 'x', '```'].join('\n')), el, 'x')).toEqual([])
  })
})

describe('sectionOrdinal：阅读模式 section 内序号（数量匹配自适应）', () => {
  function block(): HTMLElement {
    const w = document.createElement('div')
    w.className = 'block-language-hl'
    return w
  }

  it('容器内同类块数量与候选一致时返回文档序号', () => {
    const container = document.createElement('div')
    const ws = [block(), block(), block()]
    container.append(...ws)
    expect(sectionOrdinal(ws[1]!, 3)).toBe(1)
  })

  it('各级容器块数从少于候选直接跳到多于候选（范围不匹配）→ null', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('div')
    outer.appendChild(inner)
    const target = block()
    inner.appendChild(target)
    outer.appendChild(block()) // outer 内共 2 块；expected=3 → inner(1)/outer(2) 都不等于 3
    expect(sectionOrdinal(target, 3)).toBeNull()
  })

  it('expected=2 且容器恰有 2 块 → 返回序号', () => {
    const outer = document.createElement('div')
    const a = block()
    const b = block()
    outer.append(a, b)
    expect(sectionOrdinal(b, 2)).toBe(1)
  })

  it('el 不在块容器结构内（无 wrapper）→ null', () => {
    expect(sectionOrdinal(document.createElement('div'), 2)).toBeNull()
  })
})

describe('validatePluginAlias：别名校验', () => {
  it('合法别名归一为小写', () => {
    expect(validatePluginAlias('d')).toEqual({ ok: true, alias: 'd' })
    expect(validatePluginAlias('  Demo_X-1  ')).toEqual({ ok: true, alias: 'demo_x-1' })
  })

  it('空串 / 超长 / 非法字符', () => {
    expect(validatePluginAlias('')).toEqual({ ok: false, reason: 'invalid' })
    expect(validatePluginAlias('a'.repeat(ALIAS_MAX_LEN + 1))).toEqual({ ok: false, reason: 'invalid' })
    expect(validatePluginAlias('a b')).toEqual({ ok: false, reason: 'invalid' })
    expect(validatePluginAlias('-x')).toEqual({ ok: false, reason: 'invalid' })
    expect(validatePluginAlias('x.y')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('长度边界内合法', () => {
    expect(validatePluginAlias('a'.repeat(ALIAS_MAX_LEN)).ok).toBe(true)
  })

  it('保留字 hl 禁止（避免 ```hl hl 歧义）', () => {
    expect(validatePluginAlias('hl')).toEqual({ ok: false, reason: 'reserved' })
    expect(validatePluginAlias('HL')).toEqual({ ok: false, reason: 'reserved' })
  })

  it('不得等于任何插件真实 id（防劫持，大小写不敏感）', () => {
    expect(validatePluginAlias('demo', { knownIds: ['demo', 'other'] })).toEqual({
      ok: false,
      reason: 'takenById',
    })
    expect(validatePluginAlias(' Demo ', { knownIds: ['demo'] })).toEqual({
      ok: false,
      reason: 'takenById',
    })
  })

  it('不得与其他插件已占用别名重复', () => {
    expect(validatePluginAlias('d', { knownIds: ['demo'], taken: ['d'] })).toEqual({
      ok: false,
      reason: 'takenByAlias',
    })
  })

  it('无冲突信息时按合法处理', () => {
    expect(validatePluginAlias('d', { knownIds: ['demo'], taken: ['e'] })).toEqual({ ok: true, alias: 'd' })
  })
})
