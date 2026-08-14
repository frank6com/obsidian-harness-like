/**
 * ChatView：会话列表 + 消息流 + 工具卡片 + 输入框 + 会话级"允许写"开关。
 * 从 session/event 渲染；流式增量直接追加到气泡。
 */

import { ItemView, WorkspaceLeaf } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import { runAgentLoop, type SessionEvent, type ToolExecution } from '@dsh-obsidian/harness-base'

export const CHAT_VIEW_TYPE = 'dsh-chat'

interface SessionMeta {
  notePath: string | null
}

export class ChatView extends ItemView {
  private currentSessionId: string | null = null
  private boundNote: string | null = null
  private sessions = new Map<string, SessionMeta>()
  private listEl!: HTMLElement
  private messagesEl!: HTMLElement
  private boundEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private allowWriteEl!: HTMLInputElement
  private streamingEl: HTMLElement | null = null
  private streamingText = ''
  private disposers: Array<() => void> = []

  constructor(
    leaf: WorkspaceLeaf,
    private ctx: Context,
  ) {
    super(leaf)
  }

  override getViewType(): string {
    return CHAT_VIEW_TYPE
  }

  override getDisplayText(): string {
    return 'dsh Chat'
  }

  override getIcon(): string {
    return 'bot'
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty()
    const root = this.contentEl.createDiv({ cls: 'dsh-chat' })

    // 头部：标题 + 绑定笔记 + 会话级允许写
    const header = root.createDiv({ cls: 'dsh-chat-header' })
    header.createSpan({ cls: 'dsh-chat-title', text: 'dsh Chat' })
    this.boundEl = header.createSpan({ cls: 'dsh-bound' })
    const bindBtn = header.createEl('button', { cls: 'dsh-btn', text: '绑定当前笔记' })
    const toggle = header.createDiv({ cls: 'dsh-toggle' })
    toggle.createSpan({ text: '本会话允许写' })
    this.allowWriteEl = toggle.createEl('input', { type: 'checkbox' })
    this.allowWriteEl.addEventListener('change', () => {
      this.ctx.approval.setSessionAllow(this.allowWriteEl.checked)
    })

    bindBtn.onclick = () => {
      this.boundNote = this.ctx.workspace.getActiveFile()
      this.renderBinding()
      this.ctx.notice.notice(this.boundNote ? `已绑定: ${this.boundNote}` : '当前没有活动笔记')
    }

    // 主体：会话列表 + 消息
    const body = root.createDiv({ cls: 'dsh-chat-body' })
    this.listEl = body.createDiv({ cls: 'dsh-chat-list' })
    this.messagesEl = body.createDiv({ cls: 'dsh-chat-messages' })

    // 底部：输入
    const footer = root.createDiv({ cls: 'dsh-chat-footer' })
    this.inputEl = footer.createEl('textarea', {
      cls: 'dsh-chat-input',
      attr: { placeholder: '输入消息…（Enter 发送，Shift+Enter 换行）' },
    })
    const sendBtn = footer.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: '发送' })
    sendBtn.onclick = () => void this.send()
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void this.send()
      }
    })

    this.disposers.push(this.ctx.on('session/event', (e) => this.onSessionEvent(e)))
    await this.refreshSessions()
    this.renderBinding()
  }

  override onClose(): Promise<void> {
    for (const d of this.disposers) {
      try {
        d()
      } catch {
        // 忽略卸载期异常
      }
    }
    this.disposers = []
    return Promise.resolve()
  }

  private onSessionEvent(e: SessionEvent): void {
    if (e.sessionId !== this.currentSessionId) return
    if (e.type === 'assistant/message') {
      if (this.streamingEl) {
        this.streamingEl.textContent = e.content
        this.streamingEl = null
      } else {
        this.appendMessage('assistant', e.content)
      }
    } else if (e.type === 'tool/call') {
      this.appendToolCard(`调用工具 ${e.tool}`, e.input)
    } else if (e.type === 'tool/result') {
      this.appendToolCard(
        e.ok ? `✓ ${e.tool} 完成` : `✗ ${e.tool} 失败: ${e.error ?? '未知错误'}`,
        e.output,
      )
    } else if (e.type === 'turn/end') {
      void this.refreshSessions()
    }
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim()
    if (!text) return
    this.inputEl.value = ''
    let sessionId = this.currentSessionId
    if (!sessionId) {
      sessionId = `session-${Date.now()}`
      this.currentSessionId = sessionId
      this.sessions.set(sessionId, { notePath: this.boundNote })
      void this.refreshSessions()
    }
    this.appendMessage('user', text)
    await this.run(sessionId, text)
  }

  private async run(sessionId: string, text: string): Promise<void> {
    try {
      await this.ctx.sessions.append(sessionId, {
        type: 'user/message',
        ts: Date.now(),
        sessionId,
        content: text,
      } satisfies SessionEvent)
      const history = (await this.ctx.sessions.read(sessionId)).filter(
        (e) => e.type !== 'turn/start' && e.type !== 'turn/end',
      )
      let noteCtx = ''
      const bound = this.sessions.get(sessionId)?.notePath ?? null
      if (bound) {
        try {
          noteCtx = await this.ctx.vault.read(bound)
        } catch {
          noteCtx = '(无法读取绑定笔记)'
        }
      }
      const system = [
        '你是运行在 Obsidian 中的 DeepSeek Harness agent。',
        '可以调用工具读写笔记；写操作会请求审批，请等待结果。',
        bound ? `当前绑定笔记: ${bound}\n\n笔记内容：\n${noteCtx.slice(0, 8000)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')

      const sink = (e: SessionEvent): void => {
        void this.ctx.sessions.append(e.sessionId, e)
        this.ctx.emit('session/event', e)
      }

      await runAgentLoop({
        sessionId,
        llm: this.ctx.llm,
        tools: this.ctx.tools,
        executeTool: (name, input) => this.executeTool(name, input),
        onEvent: sink,
        onStream: (delta) => this.appendStream(delta),
        history,
        system,
      })
    } catch (err) {
      this.appendMessage('system', `错误: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.streamingEl = null
      this.streamingText = ''
    }
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecution> {
    const tool = this.ctx.tools.get(name)
    if (!tool) return { ok: false, error: `未知工具: ${name}` }
    try {
      const output = await tool.execute(input)
      return { ok: true, output }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private appendStream(delta: string): void {
    if (!this.streamingEl) {
      this.streamingEl = this.appendMessage('assistant', '')
    }
    this.streamingText += delta
    this.streamingEl.textContent = this.streamingText
  }

  private appendMessage(role: 'user' | 'assistant' | 'system', content: string): HTMLElement {
    const el = this.messagesEl.createDiv({ cls: `dsh-msg dsh-msg-${role}` })
    el.textContent = content
    this.scrollToBottom()
    return el
  }

  private appendToolCard(title: string, detail: unknown): void {
    const card = this.messagesEl.createDiv({ cls: 'dsh-tool-card' })
    card.createDiv({ cls: 'dsh-tool-card-title', text: title })
    if (detail !== undefined) {
      card.createEl('pre', {
        cls: 'dsh-tool-card-detail',
        text: typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
      })
    }
    this.scrollToBottom()
  }

  private async refreshSessions(): Promise<void> {
    this.listEl.empty()
    const list = await this.ctx.sessions.list()
    if (!list.length) {
      this.listEl.createDiv({ cls: 'dsh-session-empty', text: '还没有会话' })
      return
    }
    for (const s of list) {
      const btn = this.listEl.createEl('button', {
        cls: 'dsh-session-btn' + (s.id === this.currentSessionId ? ' is-active' : ''),
      })
      const meta = this.sessions.get(s.id)?.notePath
      btn.createDiv({ text: s.id })
      btn.createDiv({ cls: 'dsh-session-sub', text: `${meta ?? '全局'} · ${s.count} 条` })
      btn.onclick = () => {
        this.currentSessionId = s.id
        void this.renderSession()
        void this.refreshSessions()
      }
    }
  }

  private async renderSession(): Promise<void> {
    this.messagesEl.empty()
    this.streamingEl = null
    this.streamingText = ''
    const id = this.currentSessionId
    if (!id) return
    const events = await this.ctx.sessions.read(id)
    for (const e of events) {
      if (e.type === 'user/message') this.appendMessage('user', e.content)
      else if (e.type === 'assistant/message') this.appendMessage('assistant', e.content)
      else if (e.type === 'tool/call') this.appendToolCard(`调用工具 ${e.tool}`, e.input)
      else if (e.type === 'tool/result') {
        this.appendToolCard(e.ok ? `✓ ${e.tool} 完成` : `✗ ${e.tool} 失败: ${e.error ?? ''}`, e.output)
      }
    }
  }

  private renderBinding(): void {
    this.boundEl.setText(this.boundNote ? `绑定: ${this.boundNote}` : '未绑定笔记')
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }
}
