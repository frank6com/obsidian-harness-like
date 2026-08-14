/**
 * Markdown 渲染管线（Chat 消息专用）：
 * marked（GFM，含表格/代码块/列表）+ DOMPurify（净化，防模型输出注入 HTML/JS）。
 *
 * 不依赖 Obsidian 的 MarkdownRenderer（其样式强依赖笔记叶节点作用域，
 * 在自定义面板中渲染残缺），由本模块 + styles.css 的 .dsh-msg-assistant
 * 样式层完全控制观感，文本可选中。
 */

import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.use({ async: false, gfm: true, breaks: true })

/** 渲染并净化；返回安全 HTML 字符串 */
export function renderMarkdown(markdown: string): string {
  const html = String(marked.parse(markdown ?? ''))
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

/** 给容器内所有代码块加"复制"按钮（渲染后调用） */
export function attachCodeCopyButtons(container: HTMLElement): void {
  for (const pre of container.querySelectorAll('pre')) {
    if (pre.querySelector('.dsh-code-copy')) continue
    const btn = document.createElement('span')
    btn.className = 'dsh-code-copy'
    btn.textContent = '复制'
    btn.onclick = (ev) => {
      ev.stopPropagation()
      const code = pre.querySelector('code')
      const text = code?.textContent ?? pre.textContent ?? ''
      void navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '已复制'
        setTimeout(() => {
          btn.textContent = '复制'
        }, 1200)
      })
    }
    pre.appendChild(btn)
  }
}
