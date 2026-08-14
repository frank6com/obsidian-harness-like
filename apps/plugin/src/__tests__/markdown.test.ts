// @vitest-environment jsdom
/**
 * Markdown 渲染管线测试：GFM 元素产出、HTML 净化（防注入）。
 */

import { describe, expect, it } from 'vitest'
import { attachCodeCopyButtons, renderMarkdown } from '../markdown'

describe('renderMarkdown', () => {
  it('渲染加粗/斜体/行内代码', () => {
    const html = renderMarkdown('**粗** *斜* `code`')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('渲染 GFM 表格（含表头）', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('渲染代码块', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code')
    expect(html).toContain('language-ts')
    expect(html).toContain('const x = 1')
  })

  it('单换行转 <br>（breaks: true，聊天风格）', () => {
    const html = renderMarkdown('第一行\n第二行')
    expect(html).toContain('<br>')
  })

  it('剥离 script 与事件属性（防注入）', () => {
    const html = renderMarkdown(
      '**ok**\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>',
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).toContain('<strong>ok</strong>')
  })
})

describe('attachCodeCopyButtons', () => {
  it('为每个代码块添加复制按钮（幂等）', () => {
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown('```js\na\n```\n\n```py\nb\n```')
    attachCodeCopyButtons(container)
    expect(container.querySelectorAll('.dsh-code-copy')).toHaveLength(2)
    attachCodeCopyButtons(container)
    expect(container.querySelectorAll('.dsh-code-copy')).toHaveLength(2)
  })
})
