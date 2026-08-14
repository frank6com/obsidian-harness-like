/**
 * 会话导出：把会话事件序列渲染为 Markdown 笔记。
 * 纯函数，可单测。
 */

import type { SessionEvent } from '@dsh-obsidian/harness-base'

export interface SessionExportOptions {
  title: string
  notePath: string | null
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|')
}

export function sessionToMarkdown(opts: SessionExportOptions, events: SessionEvent[]): string {
  const lines: string[] = []
  lines.push(`# ${opts.title || '会话导出'}`)
  lines.push('')
  lines.push(
    `> 导出时间: ${new Date().toLocaleString()} ｜ 绑定笔记: ${opts.notePath ?? '无'}`,
  )
  lines.push('')

  for (const e of events) {
    if (e.type === 'user/message') {
      lines.push('**我**', '', e.content, '')
    } else if (e.type === 'assistant/message') {
      lines.push('**dsh**', '', e.content, '')
    } else if (e.type === 'system/message') {
      lines.push(`> ⚠ ${e.content}`, '')
    } else if (e.type === 'tool/call') {
      lines.push(`- 工具调用 \`${e.tool}\`: \`\`\`json\n${JSON.stringify(e.input, null, 2)}\n\`\`\``)
    } else if (e.type === 'tool/result') {
      if (e.ok) {
        lines.push(`  → ✓ 完成${e.output !== undefined ? `: \`${escapePipe(summarize(e.output))}\`` : ''}`)
      } else {
        lines.push(`  → ✗ 失败: ${e.error ?? '未知错误'}`)
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

function summarize(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 120 ? text.slice(0, 120) + '…' : text
}

/** 从标题生成安全的文件名（去非法字符，空则用会话 id 兜底） */
export function safeFileName(title: string, fallback: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 40)
  return (cleaned || fallback) + '.md'
}
