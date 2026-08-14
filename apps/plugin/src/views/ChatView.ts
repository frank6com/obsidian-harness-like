/**
 * ChatView：会话列表 + 消息流 + 工具卡片（实时状态）+ 阶段状态条 +
 * 输入框（自适应增高）+ 发送/停止三态按钮 + 会话级"允许写"开关。
 *
 * P0.5 改进（docs/ux-checklist.md §1）：过程状态可见、工具卡片实时状态、
 * 流式光标、错误重试、列表可收起、发送中禁用与中止。
 */

import { ItemView, WorkspaceLeaf } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import {
  runAgentLoop,
  type AgentPhase,
  type SessionEvent,
  type ToolExecution,
} from '@dsh-obsidian/harness-base'

export const CHAT_VIEW_TYPE = 'dsh-chat'

interface SessionMeta {
  notePath: string | null
}

/** 宿主侧额外阶段：idle / waiting（等待审批）/ stopped */
type UiPhase = AgentPhase | { kind: 'idle' } | { kind: 'waiting' } | { kind: 'stopped' }

function summarize(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > 300 ? text.slice(0, 300) + ' …' : text
}

export class ChatView extends ItemView {
  private currentSessionId: string | null = null
  private boundNote: string | null = null
  private sessions = new Map<string, SessionMeta>()
  private root!: HTMLElement
  private listEl!: HTMLElement
  private messagesEl!: HTMLElement
  private boundEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private phaseEl!: HTMLElement
  private allowWriteEl!: HTMLInputElement
  private streamingEl: HTMLElement | null = null
  private streamingText = ''
  private toolCards = new Map<string, HTMLElement>()
  private running = false
  private abortController: AbortController | null = null
  private lastFailed: { sessionId: string; text: string } | null = null
  private listCollapsed = false
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
    this.root = this.contentEl.createDiv({ cls: 'dsh-chat' })

    // 头部：折叠按钮 + 标题 + 绑定笔记 + 会话级允许写
    const header = this.root.createDiv({ cls: 'dsh-chat-header' })
    const collapseBtn = header.createEl('button', { cls: 'dsh-btn dsh-btn-icon', text: '☰' })
    collapseBtn.onclick = () => this.toggleSessionList()
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
    const body = this.root.createDiv({ cls: 'dsh-chat-body' })
    this.listEl = body.createDiv({ cls: 'dsh-chat-list' })
    this.messagesEl = body.createDiv({ cls: 'dsh-chat-messages' })

    // 阶段状态条（思考/工具/等待审批/已停止）
    this.phaseEl = this.root.createDiv({ cls: 'dsh-phase', text: '' })

    // 底部：输入 + 发送/停止
    const footer = this.root.createDiv({ cls: 'dsh-chat-footer' })
    this.inputEl = footer.createEl('textarea', {
      cls: 'dsh-chat-input',
      attr: { placeholder: '输入消息…（Enter 发送，Shift+Enter 换行）' },
    })
    this.inputEl.addEventListener('input', () => this.autoGrowInput())
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void this.onSendClick()
      }
    })
    this.sendBtn = footer.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: '发送' })
    this.sendBtn.onclick = () => void this.onSendClick()

    this.disposers.push(this.ctx.on('session/event', (e) => this.onSessionEvent(e)))
    this.disposers.push(this.ctx.on('dsh/waiting-approval', () => this.setPhase({ kind: 'waiting' })))
    await this.refreshSessions()
    this.renderBinding()
    this.setPhase({ kind: 'idle' })
  }

  override onClose(): Promise<void> {
    this.abortController?.abort()
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

  // ---------- 事件与渲染 ----------

  private onSessionEvent(e: SessionEvent): void {
    if (e.sessionId !== this.currentSessionId) return
    if (e.type === 'assistant/message') {
      if (this.streamingEl) {
        this.streamingEl.classList.remove('dsh-msg-streaming')
        this.streamingEl.textContent = e.content
        this.streamingEl = null
      } else {
        this.appendMessage('assistant', e.content)
      }
    } else if (e.type === 'tool/call') {
      this.renderToolCall(e.id, e.tool, e.input)
    } else if (e.type === 'tool/result') {
      this.renderToolResult(e.id, e.tool, e.ok, e.error, e.output)
    } else if (e.type === 'turn/end') {
      void this.refreshSessions()
    }
  }

  private renderToolCall(id: string, tool: string, input: unknown): void {
    const card = this.messagesEl.createDiv({ cls: 'dsh-tool-card is-running' })
    card.createDiv({ cls: 'dsh-tool-card-title', text: `调用工具 ${tool}` })
    const detail = card.createEl('pre', { cls: 'dsh-tool-card-detail', text: summarize(input) })
    card.onclick = () => detail.classList.toggle('is-expanded')
    this.toolCards.set(id, card)
    this.scrollToBottom()
  }

  private renderToolResult(
    id: string,
    tool: string,
    ok: boolean,
    error: string | undefined,
    output: unknown,
  ): void {
    const card = this.toolCards.get(id)
    if (card) {
      card.classList.remove('is-running')
      card.classList.add(ok ? 'is-success' : 'is-error')
      const title = card.querySelector('.dsh-tool-card-title')
      if (title) {
        title.textContent = ok ? `✓ ${tool} 完成` : `✗ ${tool} 失败: ${error ?? '未知错误'}`
      }
      const detail = card.querySelector('pre')
      if (detail && output !== undefined) detail.textContent = summarize(output)
      this.toolCards.delete(id)
    } else {
      // 回放或跨会话兜底
      this.appendToolCard(ok ? `✓ ${tool} 完成` : `✗ ${tool} 失败: ${error ?? ''}`, output)
    }
    this.scrollToBottom()
  }

  private appendToolCard(title: string, detail: unknown): void {
    const card = this.messagesEl.createDiv({ cls: 'dsh-tool-card' })
    card.createDiv({ cls: 'dsh-tool-card-title', text: title })
    if (detail !== undefined) {
      card.createEl('pre', { cls: 'dsh-tool-card-detail', text: summarize(detail) })
    }
    this.scrollToBottom()
  }

  private appendMessage(role: 'user' | 'assistant' | 'system', content: string): HTMLElement {
    const el = this.messagesEl.createDiv({ cls: `dsh-msg dsh-msg-${role}` })
    el.textContent = content
    this.scrollToBottom()
    return el
  }

  private appendStream(delta: string): void {
    if (!this.streamingEl) {
      this.streamingEl = this.appendMessage('assistant', '')
      this.streamingEl.classList.add('dsh-msg-streaming')
    }
    this.streamingText += delta
    this.streamingEl.textContent = this.streamingText
    this.scrollToBottom()
  }

  // ---------- 发送 / 中止 / 重试 ----------

  private onSendClick(): void {
    if (this.running) {
      this.abortController?.abort()
      return
    }
    void this.send()
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim()
    if (!text) return
    this.inputEl.value = ''
    this.inputEl.style.height = 'auto'
    let sessionId = this.currentSessionId
    if (!sessionId) {
      sessionId = `session-${Date.now()}`
      this.currentSessionId = sessionId
      this.sessions.set(sessionId, { notePath: this.boundNote })
      void this.refreshSessions()
    }
    this.appendMessage('user', text)
    this.lastFailed = null
    await this.run(sessionId, text)
  }

  private async run(sessionId: string, text: string, skipAppend = false): Promise<void> {
    this.running = true
    this.setSendingState()
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    try {
      if (!skipAppend) {
        await this.ctx.sessions.append(sessionId, {
          type: 'user/message',
          ts: Date.now(),
          sessionId,
          content: text,
        } satisfies SessionEvent)
      }
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
        onPhase: (phase) => this.setPhase(phase),
        history,
        system,
        signal,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.appendMessage('system', '已停止')
        this.setPhase({ kind: 'stopped' })
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        this.appendMessage('system', `错误: ${msg}`)
        this.lastFailed = { sessionId, text }
        const row = this.messagesEl.createDiv({ cls: 'dsh-retry-row' })
        const btn = row.createEl('button', { cls: 'dsh-btn', text: '重试' })
        btn.onclick = () => void this.run(sessionId, text, true)
      }
    } finally {
      this.running = false
      this.abortController = null
      this.setSendingState()
      this.streamingEl = null
      this.streamingText = ''
      this.setPhase({ kind: 'idle' })
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

  private setPhase(phase: UiPhase): void {
    const text =
      phase.kind === 'thinking'
        ? '思考中…'
        : phase.kind === 'tool'
          ? `调用工具 ${phase.name}…`
          : phase.kind === 'waiting'
            ? '等待你的审批…'
            : phase.kind === 'stopped'
              ? '已停止'
              : phase.kind === 'done' || phase.kind === 'idle'
                ? ''
                : ''
    this.phaseEl.setText(text)
  }

  private setSendingState(): void {
    this.sendBtn.setText(this.running ? '停止' : '发送')
    this.sendBtn.classList.toggle('dsh-btn-stop', this.running)
    this.inputEl.disabled = this.running
  }

  // ---------- 会话列表 / 绑定 / 输入 ----------

  private toggleSessionList(): void {
    this.listCollapsed = !this.listCollapsed
    this.root.classList.toggle('is-collapsed', this.listCollapsed)
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
    this.toolCards.clear()
    const id = this.currentSessionId
    if (!id) return
    const events = await this.ctx.sessions.read(id)
    for (const e of events) {
      if (e.type === 'user/message') this.appendMessage('user', e.content)
      else if (e.type === 'assistant/message') this.appendMessage('assistant', e.content)
      else if (e.type === 'tool/call') this.renderToolCall(e.id, e.tool, e.input)
      else if (e.type === 'tool/result') {
        this.renderToolResult(e.id, e.tool, e.ok, e.error, e.output)
      }
    }
  }

  private renderBinding(): void {
    this.boundEl.setText(this.boundNote ? `绑定: ${this.boundNote}` : '未绑定笔记')
  }

  private autoGrowInput(): void {
    this.inputEl.style.height = 'auto'
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 140) + 'px'
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }
}
