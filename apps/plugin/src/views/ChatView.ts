/**
 * ChatView：会话列表 + 消息流 + 工具卡片（实时状态）+ 阶段状态条 +
 * 输入框（自适应增高）+ 发送/停止三态按钮 + 会话级"允许写"开关。
 *
 * P0.5 改进（docs/ux-checklist.md §1）：过程状态可见、工具卡片实时状态、
 * 流式光标、错误重试、列表可收起、发送中禁用与中止。
 */

import * as path from 'path'
import { ItemView, MarkdownRenderer, Menu, WorkspaceLeaf } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import {
  runAgentLoop,
  type AgentPhase,
  type SessionEvent,
  type ToolExecution,
} from '@harness-like/harness-base'
import { attachCodeCopyButtons } from '../markdown'
import { agentAllows } from '../mode'
import { listVisibleAgents, type AgentPreset } from '../settings'
import { safeFileName, sessionToMarkdown } from '../export'
import { agentDisplayDesc, agentDisplayName, getLanguage, resolveLanguage, setLanguage, t, type LanguagePreference } from '../i18n'
import { ConfirmModal } from '../modals'

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
  private sessions = new Map<string, SessionMeta>()
  private sessionModels = new Map<string, string>()
  private modelBtn!: HTMLButtonElement
  private agentBtn!: HTMLButtonElement
  private root!: HTMLElement
  private listEl!: HTMLElement
  private messagesEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private phaseEl!: HTMLElement
  private confineCheck!: HTMLInputElement
  private streamingEl: HTMLElement | null = null
  private streamingText = ''
  private toolCards = new Map<string, HTMLElement>()
  private running = false
  private abortController: AbortController | null = null
  private lastFailed: { sessionId: string; text: string } | null = null
  private listCollapsed = false
  private disposers: Array<() => void> = []
  /** 语言切换时若正在生成，等本轮结束后重建 */
  private pendingRebuild = false
  /** 当前轮次容器（一次问答 = 一轮，底部挂"复制本段对话"按钮） */
  private turnEl: HTMLElement | null = null
  /** 当前轮次累积文本（轮末复制用） */
  private turnText: string[] = []
  /** 当前轮次是否已挂复制按钮 */
  private turnCopied = false
  /** 最近一次渲染的 assistant 原始内容（防重比较用，textContent 不可靠） */
  private lastAssistantRaw: string | null = null

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
    return 'Harness Like'
  }

  override getIcon(): string {
    return 'bot'
  }

  override async onOpen(): Promise<void> {
    this.buildUi()
    await this.refreshSessions()
    this.setPhase({ kind: 'idle' })
    if (this.currentSessionId) {
      void this.renderSession()
    } else {
      this.renderWelcome()
    }
  }

  /** 构建界面（语言切换时重建，保留 currentSessionId 与输入草稿） */
  private buildUi(): void {
    // 重建前先卸载旧监听器，避免叠加
    for (const d of this.disposers) {
      try {
        d()
      } catch {
        // 忽略卸载期异常
      }
    }
    this.disposers = []
    const draft = this.inputEl?.value ?? ''
    this.contentEl.empty()
    this.root = this.contentEl.createDiv({ cls: 'dsh-chat' })
    this.root.classList.toggle('is-collapsed', this.listCollapsed)

    // 头部：折叠按钮 + 标题（左），新会话 + 插件管理器（右对齐）
    const header = this.root.createDiv({ cls: 'dsh-chat-header' })
    const collapseBtn = header.createEl('button', { cls: 'dsh-btn dsh-btn-icon', text: '☰' })
    collapseBtn.onclick = () => this.toggleSessionList()
    header.createSpan({ cls: 'dsh-chat-title', text: 'Harness Like' })
    const actions = header.createDiv({ cls: 'dsh-chat-actions' })
    const newBtn = actions.createEl('button', { cls: 'dsh-btn', text: t('chat.header.newSession') })
    newBtn.onclick = () => this.newSession()
    const pluginBtn = actions.createEl('button', { cls: 'dsh-btn', text: t('chat.header.pluginManager') })
    pluginBtn.onclick = () => this.openPluginManager()

    // 主体：会话列表 + 消息
    const body = this.root.createDiv({ cls: 'dsh-chat-body' })
    this.listEl = body.createDiv({ cls: 'dsh-chat-list' })
    this.messagesEl = body.createDiv({ cls: 'dsh-chat-messages' })

    // 阶段状态条（思考/工具/等待审批/已停止）
    this.phaseEl = this.root.createDiv({ cls: 'dsh-phase', text: '' })

    // 工具栏：智能体（上拉选择）+ 模型选择（成熟 AI 工具的输入区布局）
    const toolbar = this.root.createDiv({ cls: 'dsh-chat-toolbar' })
    this.agentBtn = toolbar.createEl('button', { cls: 'dsh-btn dsh-agent-btn' })
    this.refreshAgentBtn()
    this.agentBtn.onclick = (e) => this.openAgentMenu(e)

    this.modelBtn = toolbar.createEl('button', { cls: 'dsh-btn dsh-agent-btn dsh-model-btn' })
    this.refreshModelBtn()
    this.modelBtn.onclick = (e) => this.openModelMenu(e)
    const confine = toolbar.createDiv({ cls: 'dsh-toggle' })
    confine.createSpan({ text: t('chat.toolbar.confine') })
    this.confineCheck = confine.createEl('input', { type: 'checkbox' })
    this.confineCheck.checked = this.ctx.settings.get('confineToCurrentNote', false)
    this.confineCheck.addEventListener('change', () => {
      this.ctx.settings.set('confineToCurrentNote', this.confineCheck.checked)
    })

    // 底部：输入 + 发送/停止
    const footer = this.root.createDiv({ cls: 'dsh-chat-footer' })
    this.inputEl = footer.createEl('textarea', {
      cls: 'dsh-chat-input',
      attr: { placeholder: t('chat.input.placeholder') },
    })
    this.inputEl.value = draft
    
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void this.onSendClick()
      }
    })
    this.sendBtn = footer.createEl('button', { cls: 'dsh-btn dsh-btn-primary', text: t('chat.send') })
    this.sendBtn.onclick = () => void this.onSendClick()

    this.disposers.push(this.ctx.on('dsh/session/event', (e) => this.onSessionEvent(e)))

    this.disposers.push(this.ctx.on('dsh/waiting-approval', () => this.setPhase({ kind: 'waiting' })))
    this.disposers.push(
      this.ctx.on('dsh/settings-updated', () => {
        this.refreshModelBtn()
        this.refreshAgentBtn()
        // 欢迎界面（如配置提示）随设置变化刷新
        if (this.messagesEl.querySelector('.dsh-welcome')) this.renderWelcome()
        // 界面语言切换：立即重建（生成中则等本轮结束）；auto 模式跟随 Obsidian 语言
        const pref = this.ctx.settings.get('uiLanguage', 'auto') as LanguagePreference
        const resolved = resolveLanguage(pref)
        if (resolved !== getLanguage()) {
          setLanguage(resolved)
          if (this.running) this.pendingRebuild = true
          else void this.rebuild()
        }
      }),
    )
  }

  /** 语言切换重建：保留当前会话与输入草稿，重放会话内容 */
  private async rebuild(): Promise<void> {
    const sessionId = this.currentSessionId
    this.buildUi()
    this.turnEl = null
    this.turnText = []
    this.turnCopied = false
    this.toolCards.clear()
    this.streamingEl = null
    this.streamingText = ''
    await this.refreshSessions()
    if (sessionId) {
      this.currentSessionId = sessionId
      void this.renderSession()
    } else {
      this.renderWelcome()
    }
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
    if (e.type === 'turn/start') {
      // 新一轮次容器（send() 已先建好含用户消息的容器，这里幂等）
      this.openTurnContainer()
      this.streamingEl = null
      this.streamingText = ''
    } else if (e.type === 'turn/end') {
      this.closeTurn()
      void this.refreshSessions()
    } else if (e.type === 'assistant/message') {
      // 防重：多个 Chat 面板实例会同时收到同一事件（广播），
      // 同一实例内相同原始内容只渲染一次（用原始内容比较，textContent 受渲染影响不可靠）
      if (!this.streamingEl && this.lastAssistantRaw === e.content) {
        return
      }
      if (this.streamingEl) {
        this.streamingEl.classList.remove('dsh-msg-streaming')
        this.renderMarkdown(this.streamingEl, e.content)
        this.streamingEl = null
      } else {
        this.appendMessage('assistant', e.content)
      }
      // 关键：多轮 agent 循环内 finally 不执行，必须在此重置流式累积，
      // 否则下一轮流式气泡会拼接上一轮残留文本
      this.streamingText = ''
      this.lastAssistantRaw = e.content
      this.turnText.push(`${t('chat.msg.assistant')}：\n${e.content}`)
    } else if (e.type === 'system/message') {
      this.appendMessage('system', e.content)
    } else if (e.type === 'tool/call') {
      this.renderToolCall(e.id, e.tool, e.input)
    } else if (e.type === 'tool/result') {
      this.renderToolResult(e.id, e.tool, e.ok, e.error, e.output)
    }
  }

  /** 打开当前轮次容器（幂等；无内容时按需创建） */
  private openTurnContainer(): void {
    if (this.turnEl) return
    this.turnEl = this.messagesEl.createDiv({ cls: 'dsh-turn' })
    this.turnText = []
    this.turnCopied = false
  }

  /** 新一轮次：容器 + 用户消息 + 累积文本 */
  private startTurn(userText: string): void {
    this.closeTurn()
    this.openTurnContainer()
    this.turnText.push(`${t('chat.msg.user')}：\n${userText}`)
    this.appendMessage('user', userText)
  }

  /** 收尾当前轮次：底部挂"复制本段对话"按钮（幂等） */
  private closeTurn(): void {
    if (!this.turnEl || this.turnCopied) {
      this.turnEl = null
      return
    }
    this.turnCopied = true
    const actions = this.turnEl.createDiv({ cls: 'dsh-turn-actions' })
    const btn = actions.createEl('button', { cls: 'dsh-turn-copy', text: t('chat.copyTurn') })
    btn.onclick = () => {
      void navigator.clipboard.writeText(this.turnText.join('\n\n')).then(() => {
        btn.setText(t('common.copied'))
        window.setTimeout(() => btn.setText(t('chat.copyTurn')), 1200)
      })
    }
    this.turnEl = null
  }

  private renderToolCall(id: string, tool: string, input: unknown): void {
    if (this.toolCards.has(id)) return // 防重：重复事件不重复建卡
    const card = (this.turnEl ?? this.messagesEl).createDiv({ cls: 'dsh-tool-card is-running' })
    card.createDiv({ cls: 'dsh-tool-card-title', text: t('chat.tool.call', { tool }) })
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
        title.textContent = ok
          ? t('chat.tool.ok', { tool })
          : t('chat.tool.fail', { tool, msg: error ?? 'unknown' })
      }
      const detail = card.querySelector('pre')
      if (detail && output !== undefined) detail.textContent = summarize(output)
      this.toolCards.delete(id)
    } else {
      // 回放或跨会话兜底
      this.appendToolCard(
        ok ? t('chat.tool.ok', { tool }) : t('chat.tool.fail', { tool, msg: error ?? '' }),
        output,
      )
    }
    this.scrollToBottom()
  }

  private appendToolCard(title: string, detail: unknown): void {
    const card = (this.turnEl ?? this.messagesEl).createDiv({ cls: 'dsh-tool-card' })
    card.createDiv({ cls: 'dsh-tool-card-title', text: title })
    if (detail !== undefined) {
      card.createEl('pre', { cls: 'dsh-tool-card-detail', text: summarize(detail) })
    }
    this.scrollToBottom()
  }

  /** 消息气泡（挂到当前轮次容器内；无容器时直接挂消息区） */
  private appendMessage(role: 'user' | 'assistant' | 'system', content: string): HTMLElement {
    const el = (this.turnEl ?? this.messagesEl).createDiv({ cls: `dsh-msg dsh-msg-${role}` })
    if (role === 'assistant' && this.ctx.settings.get('renderMarkdown', true)) {
      this.renderMarkdown(el, content)
    } else {
      el.textContent = content
    }
    this.scrollToBottom()
    return el
  }

  /** 渲染 Markdown（marked + DOMPurify；代码块保留独立复制按钮，样式由 styles.css 控制） */
  private renderMarkdown(el: HTMLElement, markdown: string): void {
    // 官方渲染器（@since 0.10.6）：主题原生一致，避免 innerHTML（审核要求）；
    // component = 本视图，视图卸载时渲染的子组件自动清理
    void MarkdownRenderer.render(this.app, markdown, el, '', this)
    attachCodeCopyButtons(el)
  }

  private appendStream(delta: string): void {
    if (!this.streamingEl) {
      // 流式气泡用纯文本（避免 textContent 覆盖已渲染子元素）；结束后再渲染 Markdown
      this.streamingEl = (this.turnEl ?? this.messagesEl).createDiv({
        cls: 'dsh-msg dsh-msg-assistant dsh-msg-streaming',
      })
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
    let sessionId = this.currentSessionId
    if (!sessionId) {
      sessionId = `session-${Date.now()}`
      this.currentSessionId = sessionId
      this.sessions.set(sessionId, { notePath: null })
      // 新会话从第一条消息开始：清掉欢迎界面
      this.messagesEl.empty()
      // 会话元信息（标题 + 绑定笔记）落盘，重启后仍可恢复
      void this.ctx.sessionLog.append(sessionId, {
        type: 'session/meta',
        ts: Date.now(),
        sessionId,
        title: text.length > 24 ? text.slice(0, 24) + '…' : text,
        notePath: null,
        modelId: this.sessionModelValue(),
      } satisfies SessionEvent)
      void this.refreshSessions()
    }
    this.startTurn(text)
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
        await this.ctx.sessionLog.append(sessionId, {
          type: 'user/message',
          ts: Date.now(),
          sessionId,
          content: text,
        } satisfies SessionEvent)
      }
      const history = (await this.ctx.sessionLog.read(sessionId)).filter(
        (e) => e.type !== 'turn/start' && e.type !== 'turn/end',
      )
      let noteCtx = ''
      const confine = this.ctx.settings.get('confineToCurrentNote', false) as boolean
      const note = confine ? this.ctx.workspace.getActiveFile() : null
      if (note) {
        try {
          noteCtx = await this.ctx.vault.read(note)
        } catch {
          noteCtx = '(无法读取当前笔记)'
        }
      }
      const system = [
        '你是运行在 Obsidian 中的 DeepSeek Harness agent。',
        '可以调用工具读写笔记；写操作会请求审批，请等待结果。',
        `你还可以创建和维护 Harness Like 用户插件（${this.pluginsDirRel()}）：用 create_plugin 建骨架、write_plugin_file 写纯 JS main.js（覆盖已有文件需用户确认；读取文件用 read_note）、reload_plugin 加载生效；开发指南见 plugin_guide。`,
        '插件代码必须通过 ctx.* 服务访问宿主能力（ribbon/statusbar/views/commands/vault/notice 等），禁止直接操作 Obsidian DOM；inject 必须声明 apply 里用到的每一个服务；调用 ctx.* 方法前先查 plugin_guide 的「服务方法速查」获取准确签名，严禁臆测方法名（如 vault 列表用 getMarkdownPaths 而非 getFiles/getMarkdownFiles）。',
        '创建带面板（ItemView）的插件并加载成功后，用 open_view 打开面板让用户看到界面。',
        note ? `仅当前笔记模式：当前笔记 ${note}\n\n笔记内容：\n${noteCtx.slice(0, 8000)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')

      const sink = (e: SessionEvent): void => {
        void this.ctx.sessionLog.append(e.sessionId, e)
        this.ctx.emit('dsh/session/event', e)
      }

      const streaming = this.ctx.settings.get('streamingEnabled', true)

      const agent = this.activeAgent()

      await runAgentLoop({
        sessionId,
        llm: this.ctx.llmCaller,
        tools: {
          list: () => this.ctx.toolsCompat.list().filter((t) => agentAllows(agent, t.name)),
        },
        executeTool: (name, input) => this.executeTool(name, input),
        onEvent: sink,
        onStream: streaming ? (delta) => this.appendStream(delta) : undefined,
        onPhase: (phase) => this.setPhase(phase),
        history,
        system,
        model: this.sessionModelValue(),
        signal,
      })
    } catch (err) {
      const failed = err instanceof Error && err.name === 'AbortError'
      const content = failed ? t('common.stopped') : t('chat.run.failed', { msg: err instanceof Error ? err.message : String(err) })
      // 持久化系统消息（重载后仍在；并进入模型上下文，避免"上一问悬空被顺带回答"）
      const ev: SessionEvent = { type: 'system/message', ts: Date.now(), sessionId, content }
      void this.ctx.sessionLog.append(sessionId, ev)
      this.ctx.emit('dsh/session/event', ev)
      if (!failed) {
        this.lastFailed = { sessionId, text }
        const row = (this.turnEl ?? this.messagesEl).createDiv({ cls: 'dsh-retry-row' })
        const btn = row.createEl('button', { cls: 'dsh-btn', text: t('common.retry') })
        btn.onclick = () => void this.run(sessionId, text, true)
      }
      // 异常/中止也收尾当前轮次（挂复制按钮）
      this.closeTurn()
    } finally {
      this.running = false
      this.abortController = null
      this.setSendingState()
      this.streamingEl = null
      this.streamingText = ''
      this.setPhase({ kind: 'idle' })
      if (this.pendingRebuild) {
        this.pendingRebuild = false
        void this.rebuild()
      }
    }
  }

  private async executeTool(name: string, input: Record<string, unknown>): Promise<ToolExecution> {
    const agent = this.activeAgent()
    if (!agentAllows(agent, name)) {
      return { ok: false, error: t('chat.agent.toolDenied', { name: agentDisplayName(agent ?? { id: '', name: '' }), tool: name }) }
    }
    try {
      const result = await this.ctx.toolsCompat.execute({
        callId: `call_${Math.random().toString(36).slice(2, 10)}` as never,
        name,
        arguments: input,
        signal: this.abortController?.signal ?? new AbortController().signal,
      })
      if (result.isError) return { ok: false, error: result.error.message }
      return { ok: true, output: result.value }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 用户插件目录（vault 相对，跟随 configDir） */
  private pluginsDirRel(): string {
    return path.posix.join(this.ctx.sandbox.scope.configDir, 'harness-like-plugins')
  }

  private setPhase(phase: UiPhase): void {
    const text =
      phase.kind === 'thinking'
        ? t('chat.phase.thinking')
        : phase.kind === 'tool'
          ? t('chat.phase.tool', { name: phase.name })
          : phase.kind === 'waiting'
            ? t('chat.phase.waiting')
            : phase.kind === 'stopped'
              ? t('chat.phase.stopped')
              : phase.kind === 'done' || phase.kind === 'idle'
                ? ''
                : ''
    this.phaseEl.setText(text)
  }

  private setSendingState(): void {
    this.sendBtn.setText(this.running ? t('chat.stop') : t('chat.send'))
    this.sendBtn.classList.toggle('dsh-btn-stop', this.running)
    this.inputEl.disabled = this.running
  }

  // ---------- 会话列表 / 绑定 / 输入 ----------

  /** 模型选择器选项：所有提供方 × 模型列表 */
  private buildModelItems(): Array<{ value: string; label: string }> {
    const providers = this.ctx.settings.get('providers', [] as Array<{
      id: string
      name?: string
      model?: string
      models?: string[]
    }>)
    const items: Array<{ value: string; label: string }> = []
    for (const p of providers) {
      const models = p.models?.length ? p.models : p.model ? [p.model] : []
      for (const m of models) {
        items.push({ value: `${p.id}/${m}`, label: `${p.name || p.id}: ${m}` })
      }
    }
    return items
  }

  /** 当前会话使用的模型（"providerId/model"） */
  private sessionModelValue(): string {
    if (this.currentSessionId && this.sessionModels.has(this.currentSessionId)) {
      return this.sessionModels.get(this.currentSessionId)!
    }
    return this.defaultModelId()
  }

  private refreshModelBtn(): void {
    const value = this.sessionModelValue()
    const items = this.buildModelItems()
    const label = items.find((i) => i.value === value)?.label ?? value
    this.modelBtn.setText(`${label || t('chat.model.default')} ▾`)
  }

  /** 上拉选择模型（与智能体菜单样式一致；管理入口在菜单内） */
  private openModelMenu(ev: MouseEvent): void {
    const items = this.buildModelItems()
    const current = this.sessionModelValue()
    const menu = new Menu()
    for (const item of items) {
      menu.addItem((mi) =>
        mi
          .setTitle(item.label)
          .setChecked(item.value === current)
          .onClick(() => {
            if (this.currentSessionId) this.sessionModels.set(this.currentSessionId, item.value)
            this.refreshModelBtn()
          }),
      )
    }
    menu.addSeparator()
    menu.addItem((mi) =>
      mi.setTitle(t('chat.model.manage')).onClick(() => {
        ;(this.ctx.get('dshSettingsUi') as { openTo(t: string): void } | undefined)?.openTo('model')
      }),
    )
    this.showMenuUpward(menu, ev)
  }

  /** 上拉展开（菜单在按钮上方） */
  private showMenuUpward(menu: Menu, ev: MouseEvent): void {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    menu.showAtPosition({ x: rect.left, y: rect.top })
    window.setTimeout(() => {
      // menu.dom 在 1.13 类型面外，运行时存在
      const dom = (menu as unknown as { dom: HTMLElement }).dom
      const h = dom.offsetHeight
      dom.style.top = `${Math.max(8, rect.top - h)}px`
    }, 0)
  }

  /** 默认模型选择（defaultProviderId + 其默认模型） */
  private defaultModelId(): string {
    const providers = this.ctx.settings.get('providers', [] as Array<{
      id: string
      model?: string
      models?: string[]
    }>)
    const defaultId = this.ctx.settings.get('defaultProviderId', '') as string
    const p = providers.find((x) => x.id === defaultId) ?? providers[0]
    if (!p) return ''
    return `${p.id}/${p.models?.length ? p.models[0] : p.model ?? ''}`
  }

  /** 打开插件管理器面板 */
  private openPluginManager(): void {
    const type = 'dsh-plugin-manager'
    const leaves = this.app.workspace.getLeavesOfType(type)
    let leaf: WorkspaceLeaf | undefined | null = leaves[0]
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)
      if (!leaf) return
      void leaf.setViewState({ type, active: true })
    }
    this.app.workspace.setActiveLeaf(leaf)
  }

  /** 当前激活的智能体预设（跳过已禁用的） */
  private activeAgent(): AgentPreset | undefined {
    const agents = listVisibleAgents(this.ctx.settings.get('agents', [] as AgentPreset[]))
    const activeId = this.ctx.settings.get('activeAgentId', 'edit') as string
    return agents.find((a) => a.id === activeId) ?? agents[0]
  }

  private refreshAgentBtn(): void {
    const agent = this.activeAgent()
    this.agentBtn.setText(`${agent ? agentDisplayName(agent) : t('chat.agent.default')} ▾`)
    this.agentBtn.setAttr('title', agent ? agentDisplayDesc(agent) ?? '' : '')
  }

  /** 上拉选择智能体（Obsidian Menu） */
  private openAgentMenu(ev: MouseEvent): void {
    const agents = listVisibleAgents(this.ctx.settings.get('agents', [] as AgentPreset[]))
    const activeId = this.ctx.settings.get('activeAgentId', 'edit') as string
    const menu = new Menu()
    for (const a of agents) {
      const name = agentDisplayName(a)
      const desc = agentDisplayDesc(a)
      menu.addItem((item) =>
        item
          .setTitle(desc ? `${name} — ${desc}` : name)
          .setChecked(a.id === activeId)
          .onClick(() => {
            this.ctx.settings.set('activeAgentId', a.id)
            this.refreshAgentBtn()
            this.ctx.notice.notice(t('chat.agent.switched', { name, desc: desc ? `：${desc}` : '' }))
          }),
      )
    }
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle(t('chat.agent.manage')).onClick(() => {
        ;(this.ctx.get('dshSettingsUi') as { openTo(t: string): void } | undefined)?.openTo('agent')
      }),
    )
    menu.showAtMouseEvent(ev)
  }

  /** 开始新会话：回到空状态，绑定清零 */
  private newSession(): void {
    this.currentSessionId = null
    this.refreshModelBtn()
    void this.renderSession()
    void this.refreshSessions()
    this.inputEl.focus()
  }

  private toggleSessionList(): void {
    this.listCollapsed = !this.listCollapsed
    this.root.classList.toggle('is-collapsed', this.listCollapsed)
  }

  private async refreshSessions(): Promise<void> {
    this.listEl.empty()
    const list = await this.ctx.sessionLog.list()
    if (!list.length) {
      this.listEl.createDiv({ cls: 'dsh-session-empty', text: t('chat.list.empty') })
      return
    }
    for (const s of list) {
      const row = this.listEl.createDiv({
        cls: 'dsh-session-row' + (s.id === this.currentSessionId ? ' is-active' : ''),
      })
      const btn = row.createEl('button', { cls: 'dsh-session-btn' })
      btn.createDiv({ cls: 'dsh-session-title', text: s.title ?? s.id })
      btn.createDiv({
        cls: 'dsh-session-sub',
        text: `${s.notePath ?? t('chat.list.global')} · ${t('chat.list.count', { count: s.count })}`,
      })
      btn.onclick = () => {
        this.currentSessionId = s.id
        void this.renderSession()
        void this.refreshSessions()
      }
      // 悬浮操作：导出 / 删除
      const actions = row.createDiv({ cls: 'dsh-session-actions' })
      const exp = actions.createEl('button', { cls: 'dsh-session-action', text: '⤓', attr: { title: t('chat.list.exportTitle') } })
      exp.onclick = (ev) => {
        ev.stopPropagation()
        void this.exportSession(s.id, s.title)
      }
      const del = actions.createEl('button', { cls: 'dsh-session-action dsh-session-action-danger', text: '✕', attr: { title: t('chat.list.deleteTitle') } })
      del.onclick = (ev) => {
        ev.stopPropagation()
        void this.deleteSession(s.id)
      }
    }
  }

  private async exportSession(id: string, title?: string): Promise<void> {
    try {
      const [events, meta] = await Promise.all([this.ctx.sessionLog.read(id), this.ctx.sessionLog.readMeta(id)])
      const md = sessionToMarkdown({ title: title ?? id, notePath: meta?.notePath ?? null }, events)
      const fileName = safeFileName(title ?? id, id)
      // 导出目录：设置中可配置（默认 'sessions' = vault 根下的 sessions 文件夹；空串 = 根目录）
      const exportDir = (this.ctx.settings.get('exportDir', 'sessions') as string).trim().replace(/^\/+|\/+$/g, '')
      if (exportDir) {
        // 目录可能不存在：逐层创建（已存在则忽略）
        await this.ctx.vault.createFolder(exportDir)
      }
      const target = exportDir ? `${exportDir}/${fileName}` : fileName
      await this.ctx.vault.write(target, md)
      this.ctx.notice.notice(t('chat.export.done', { path: target }))
    } catch (err) {
      this.ctx.notice.notice(t('chat.export.failed', { msg: err instanceof Error ? err.message : String(err) }))
    }
  }

  private async deleteSession(id: string): Promise<void> {
    const ok = await new ConfirmModal(
      this.app,
      t('chat.list.deleteConfirm', { id }),
      t('common.delete'),
    ).ask()
    if (!ok) return
    await this.ctx.sessionLog.remove(id)
    this.sessions.delete(id)
    if (this.currentSessionId === id) {
      this.currentSessionId = null
      await this.renderSession()
    }
    await this.refreshSessions()
  }

  private async renderSession(): Promise<void> {
    this.messagesEl.empty()
    this.streamingEl = null
    this.streamingText = ''
    this.toolCards.clear()
    this.turnEl = null
    this.turnText = []
    this.turnCopied = false
    this.lastAssistantRaw = null
    const id = this.currentSessionId
    if (!id) {
      this.renderWelcome()
      return
    }
    const events = await this.ctx.sessionLog.read(id)
    if (!events.length) {
      this.renderWelcome()
      return
    }
    // 恢复模型选择：会话元信息
    const meta = await this.ctx.sessionLog.readMeta(id)
    if (meta?.modelId) {
      this.sessionModels.set(id, meta.modelId)
    }
    this.refreshModelBtn()
    for (const e of events) {
      if (e.type === 'turn/start') {
        // 新轮次容器（用户消息/助手消息会按需补齐）
        this.openTurnContainer()
      } else if (e.type === 'turn/end') {
        this.closeTurn()
      } else if (e.type === 'user/message') {
        this.openTurnContainer()
        this.turnText.push(`${t('chat.msg.user')}：\n${e.content}`)
        this.appendMessage('user', e.content)
      } else if (e.type === 'assistant/message') {
        this.openTurnContainer()
        this.turnText.push(`${t('chat.msg.assistant')}：\n${e.content}`)
        this.lastAssistantRaw = e.content
        this.appendMessage('assistant', e.content)
      } else if (e.type === 'system/message') {
        this.openTurnContainer()
        this.appendMessage('system', e.content)
      } else if (e.type === 'tool/call') {
        this.renderToolCall(e.id, e.tool, e.input)
      } else if (e.type === 'tool/result') {
        this.renderToolResult(e.id, e.tool, e.ok, e.error, e.output)
      }
    }
    // 末尾未收尾的轮次（中断/旧日志无 turn 标记）：补上复制按钮
    this.closeTurn()
  }

  /** 空状态引导：示例问题 + 未配置 key 提示 */
  private renderWelcome(): void {
    this.messagesEl.empty()
    const wrap = this.messagesEl.createDiv({ cls: 'dsh-welcome' })
    wrap.createEl('h3', { text: 'Harness Like' })
    wrap.createEl('p', {
      text: t('chat.welcome.desc'),
    })
    const examples = [
      t('chat.welcome.example.1'),
      t('chat.welcome.example.2'),
      t('chat.welcome.example.3'),
      t('chat.welcome.example.4'),
    ]
    for (const text of examples) {
      const chip = wrap.createEl('button', { cls: 'dsh-welcome-chip', text })
      chip.onclick = () => {
        this.inputEl.value = text
        this.inputEl.focus()
      }
    }
    // API Key 检查：任一提供方配置了 key 即视为已配置（旧顶层 apiKey 字段已废弃）
    const providers = this.ctx.settings.get('providers', [] as Array<{ apiKey?: string }>)
    const hasKey = providers.some((p) => p.apiKey && p.apiKey.trim().length > 0)
    if (!hasKey) {
      const hint = wrap.createDiv({ cls: 'dsh-welcome-hint' })
      hint.createSpan({ text: t('chat.welcome.noKey') })
      const btn = hint.createEl('button', { cls: 'dsh-btn', text: t('common.openSettings') })
      btn.onclick = () => {
        // 跳转到本插件设置页的"模型" tab（API Key 配置处）
        ;(this.ctx.get('dshSettingsUi') as { openTo(t: string): void } | undefined)?.openTo('model')
      }
    }
  }


  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }
}
