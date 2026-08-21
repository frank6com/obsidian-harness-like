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
import { listVisibleAgents, parseModelId, type AgentPreset } from '../settings'
import { safeFileName, sessionToMarkdown } from '../export'
import { agentDisplayDesc, agentDisplayName, getLanguage, resolveLanguage, setLanguage, t, type LanguagePreference } from '../i18n'
import zhDict from '../i18n/zh'
import enDict from '../i18n/en'
import { ConfirmModal, SessionRenameModal } from '../modals'
import { buildFilesOverlay } from '../plugin-files'

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

/** token 估算：混合中英文按字符数近似（无真实 usage 时的兜底） */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 1.7)
}

/** "已停止"状态标记（zh/en 默认文案；防语言切换后匹配失效） */
const STOP_MARKERS = new Set<string>()
for (const dict of [zhDict, enDict]) {
  const v = dict['common.stopped']
  if (v) STOP_MARKERS.add(v)
}

/**
 * 构建模型上下文历史：
 * - 剔除轮次标记（turn/start、turn/end）
 * - 被更新的用户消息覆盖的"已停止"标记不再进入上下文——否则模型会认为
 *   任务已取消，用户说"继续"时只回一句就停止（0.28.37 回归修复）
 *   （重载场景：标记后没有新用户消息时保留，避免"上一问悬空被顺带回答"）
 */
export function filterModelHistory(events: SessionEvent[], markers: Set<string>): SessionEvent[] {
  let lastUserIdx = -1
  events.forEach((e, i) => {
    if (e.type === 'user/message') lastUserIdx = i
  })
  return events.filter((e, i) => {
    if (e.type === 'turn/start' || e.type === 'turn/end') return false
    if (e.type === 'system/message' && markers.has(e.content) && i < lastUserIdx) return false
    return true
  })
}

export class ChatView extends ItemView {
  private currentSessionId: string | null = null
  private sessions = new Map<string, SessionMeta>()
  private sessionModels = new Map<string, string>()
  /** 新会话尚未建 id 时，承接用户已点选但未落盘的模型 */
  private pendingModel: string | null = null
  private modelBtn!: HTMLButtonElement
  private agentBtn!: HTMLButtonElement
  private root!: HTMLElement
  private listEl!: HTMLElement
  private filesBannerEl!: HTMLElement
  private messagesEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private phaseEl!: HTMLElement
  private confineCheck!: HTMLInputElement
  private streamingEl: HTMLElement | null = null
  private streamingText = ''
  private toolCards = new Map<string, HTMLElement>()
  /** 正在执行的会话 id 集合（本面板或他面板广播；支持多会话并发执行） */
  private runningSessions = new Set<string>()
  /** 每个运行中会话的中止控制器（停止按钮只中止当前查看会话的运行） */
  private runControllers = new Map<string, AbortController>()
  private lastFailed: { sessionId: string; text: string } | null = null
  private listCollapsed = false
  /** 会话列表头部（固定"新会话"按钮，独立于可刷新的行容器） */
  private listHeadEl!: HTMLElement
  private sessionRowsEl!: HTMLElement
  /** 思考文本 DOM 更新节流句柄（长推理文本防卡顿） */
  private thinkingTimer: number | null = null
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
  /** 当前轮次统计（时间/字符数/token 用量/用户文本；用于结束工具栏与重做） */
  private turnStats: {
    start: number
    chars: number
    usage: { prompt: number; completion: number } | null
    userText: string
    sessionId: string
  } | null = null
  /** refreshSessions 串行链（并发调用会竞态导致列表行重复） */
  private refreshChain: Promise<void> = Promise.resolve()
  /** 最近处理的事件指纹（监听器叠加兜底：同一事件只处理一次） */
  private lastEventKey = ''
  /** 对话内思考折叠卡片（推理过程/阶段状态，可展开查看） */
  private thinkingEl: HTMLElement | null = null
  private thinkingText = ''

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
    // 自愈遮罩层需要相对定位的父容器
    this.root.setCssStyles({ position: 'relative' })
    this.root.classList.toggle('is-collapsed', this.listCollapsed)

    // 头部：折叠按钮 + 标题（左），插件管理器（右对齐）；新会话按钮移至会话列表顶部
    const header = this.root.createDiv({ cls: 'dsh-chat-header' })
    const collapseBtn = header.createEl('button', { cls: 'dsh-btn dsh-btn-icon', text: '☰' })
    collapseBtn.onclick = () => this.toggleSessionList()
    header.createSpan({ cls: 'dsh-chat-title', text: 'Harness Like' })
    const actions = header.createDiv({ cls: 'dsh-chat-actions' })
    const pluginBtn = actions.createEl('button', { cls: 'dsh-btn', text: t('chat.header.pluginManager') })
    pluginBtn.onclick = () => this.openPluginManager()

    // 插件文件自愈状态条（styles.css 缺失时显示，位于头部下方）
    this.filesBannerEl = this.root.createDiv({ cls: 'dsh-files-banner' })
    this.filesBannerEl.setCssStyles({ display: 'none' })
    this.refreshFilesBanner()
    this.disposers.push(this.ctx.on('dsh/plugin-files', () => this.refreshFilesBanner()))

    // 主体：会话列表（顶部固定新会话按钮）+ 消息
    const body = this.root.createDiv({ cls: 'dsh-chat-body' })
    this.listEl = body.createDiv({ cls: 'dsh-chat-list' })
    this.listHeadEl = this.listEl.createDiv({ cls: 'dsh-list-head' })
    const newBtn = this.listHeadEl.createEl('button', { cls: 'dsh-btn-new-session', text: t('chat.header.newSession') })
    newBtn.onclick = () => this.newSession()
    this.sessionRowsEl = this.listEl.createDiv({ cls: 'dsh-session-rows' })
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

    // 执行状态广播：任意面板的会话开始/结束执行都同步标记（列表显示"执行中"）
    this.disposers.push(
      this.ctx.on('dsh/run/start', (id) => {
        this.runningSessions.add(id)
        if (id === this.currentSessionId) this.setSendingState()
        void this.refreshSessions()
      }),
    )
    this.disposers.push(
      this.ctx.on('dsh/run/end', (id) => {
        this.runningSessions.delete(id)
        if (id === this.currentSessionId) this.setSendingState()
        void this.refreshSessions()
      }),
    )

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
          if (this.runningSessions.size) this.pendingRebuild = true
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
    for (const c of this.runControllers.values()) c.abort()
    if (this.thinkingTimer !== null) {
      window.clearTimeout(this.thinkingTimer)
      this.thinkingTimer = null
    }
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
    const isCurrent = e.sessionId === this.currentSessionId
    // 任何会话有进展都前置列表（含其他面板正在执行的会话）；渲染仍只针对当前会话
    if (e.type === 'turn/end') {
      this.closeTurn()
      void this.refreshSessions()
      if (!isCurrent) return
    } else if (!isCurrent) {
      return
    }
    // 事件级去重：若同一事件（同 ts/内容）被再次投递（如监听器叠加），跳过
    // 指纹 = 会话 + 类型 + ts + 内容/调用 id 前缀，避免不同事件误判
    const frag = 'content' in e && typeof e.content === 'string'
      ? e.content.slice(0, 40)
      : 'id' in e
        ? String(e.id)
        : ''
    const key = `${e.sessionId}:${e.type}:${e.ts}:${frag}`
    if (key === this.lastEventKey) return
    this.lastEventKey = key
    if (e.type === 'turn/start') {
      // 新一轮次容器（send() 已先建好含用户消息的容器，这里幂等）
      this.openTurnContainer()
      if (this.turnStats) this.turnStats.start = e.ts
      this.streamingEl = null
      this.streamingText = ''
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
      if (this.turnStats) this.turnStats.chars += e.content.length
      this.turnText.push(`${t('chat.msg.assistant')}：\n${e.content}`)
      this.closeThinking()
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
    // 新轮次开始：重做只保留在最后一次轮次，上一轮的移除（历史轮次不再可重做）
    for (const b of this.messagesEl.querySelectorAll('.dsh-turn-redo')) b.remove()
    this.turnEl = this.messagesEl.createDiv({ cls: 'dsh-turn' })
    this.turnText = []
    this.turnCopied = false
    this.turnStats = { start: Date.now(), chars: 0, usage: null, userText: '', sessionId: '' }
  }

  /** 新一轮次：容器 + 用户消息 + 累积文本 */
  private startTurn(userText: string): void {
    this.closeTurn()
    this.openTurnContainer()
    if (this.turnStats) {
      this.turnStats.userText = userText
      this.turnStats.sessionId = this.currentSessionId ?? ''
    }
    this.turnText.push(`${t('chat.msg.user')}：\n${userText}`)
    this.appendMessage('user', userText)
    // 新轮次强制滚到底（用户自己的消息必须可见）
    this.scrollToBottom(true)
  }

  /** 收尾当前轮次：底部挂"复制本段对话"按钮（幂等） */
  private closeTurn(): void {
    if (!this.turnEl || this.turnCopied) {
      this.turnEl = null
      return
    }
    this.turnCopied = true
    const actions = this.turnEl.createDiv({ cls: 'dsh-turn-actions' })
    // 左：元信息（完成时间 / 耗时 / token 计数 / 效率）；右：复制（图标）+ 重做
    const stats = this.turnStats
    const meta = actions.createDiv({ cls: 'dsh-turn-meta' })
    meta.createSpan({ text: t('chat.turn.time', { time: new Date(Date.now()).toLocaleTimeString() }) })
    if (stats) {
      const elapsed = (Date.now() - stats.start) / 1000
      meta.createSpan({ text: t('chat.turn.elapsed', { s: elapsed.toFixed(1) }) })
      const tokens = stats.usage ? stats.usage.completion : estimateTokens(stats.chars)
      if (tokens > 0) {
        meta.createSpan({ text: t('chat.turn.tokens', { approx: stats.usage ? '' : '≈', n: tokens }) })
        const rate = elapsed > 0 ? Math.round(tokens / elapsed) : 0
        if (rate > 0) meta.createSpan({ text: t('chat.turn.rate', { n: rate }) })
      }
    }
    const btns = actions.createDiv({ cls: 'dsh-turn-btns' })
    const copy = btns.createEl('button', { cls: 'dsh-turn-copy', text: '⧉', attr: { title: t('chat.copyTurn') } })
    copy.onclick = () => {
      void navigator.clipboard.writeText(this.turnText.join('\n\n')).then(() => {
        copy.setText('✓')
        window.setTimeout(() => copy.setText('⧉'), 1200)
      })
    }
    // 重做：仅用于最后一次实时轮次（startTurn/redo 已写入 userText/sessionId）。
    // renderSession 重建的历史轮次不写入 → 不显示重做（重建后重做不可用，不如不显示）。
    // 按钮来自当前渲染会话，currentSessionId 必等于 sid，无需 openSession 重建
    //（重建会把视图拽回对话顶部）。开一个新轮次容器承接新思考/回复并强制滚底。
    if (stats?.userText && stats?.sessionId) {
      const redo = btns.createEl('button', { cls: 'dsh-turn-copy dsh-turn-redo', text: '↻', attr: { title: t('chat.redo') } })
      redo.onclick = () => {
        const sid = stats?.sessionId
        const text = stats?.userText
        if (!sid || !text || this.runningSessions.has(sid)) return
        if (this.currentSessionId !== sid) this.openSession(sid)
        this.closeTurn()
        this.openTurnContainer()
        if (this.turnStats) {
          this.turnStats.userText = text
          this.turnStats.sessionId = sid
        }
        this.scrollToBottom(true)
        void this.run(sid, text, true)
      }
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
    // 先清空流式残留文本，避免异步渲染期间显示旧内容
    el.textContent = ''
    void MarkdownRenderer.render(this.app, markdown, el, '', this).catch(() => {
      el.textContent = markdown // 兜底：渲染失败时显示原始文本
    })
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
    if (this.isCurrentRunning()) {
      // 停止只中止当前查看会话的运行（其他会话并发执行不受影响）
      this.runControllers.get(this.currentSessionId!)?.abort()
      return
    }
    void this.send()
  }

  /** 当前查看的会话是否正在执行 */
  private isCurrentRunning(): boolean {
    return this.currentSessionId ? this.runningSessions.has(this.currentSessionId) : false
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
      // 采用当前应生效的模型（pendingModel → 默认；已含失效回退）
      const modelId = this.sessionModelValue()
      this.sessionModels.set(sessionId, modelId)
      this.pendingModel = null
      // 会话元信息（标题 + 绑定笔记 + 模型）落盘，重启后仍可恢复
      void this.ctx.sessionLog.append(sessionId, {
        type: 'session/meta',
        ts: Date.now(),
        sessionId,
        title: text.length > 24 ? text.slice(0, 24) + '…' : text,
        notePath: null,
        modelId,
      } satisfies SessionEvent)
      void this.refreshSessions()
    } else {
      // 已有会话：应用发送前点选的模型（有效才落盘，失效仅丢弃）
      this.applyPendingModel(sessionId)
    }
    // 新一轮运行前重置去重/流式状态：停止后发送新消息时，旧状态会导致
    // 首条回复被去重丢弃（lastAssistantRaw 比对）或流式残留串到新对话
    this.lastAssistantRaw = null
    this.lastEventKey = ''
    this.streamingEl = null
    this.streamingText = ''
    this.startTurn(text)
    this.lastFailed = null
    await this.run(sessionId, text)
  }

  private async run(sessionId: string, text: string, skipAppend = false): Promise<void> {
    // 会话级执行状态：支持多会话并发（各会话独立中止控制器），并广播给所有面板
    this.runningSessions.add(sessionId)
    this.runControllers.set(sessionId, new AbortController())
    const signal = this.runControllers.get(sessionId)!.signal
    this.ctx.emit('dsh/run/start', sessionId)
    this.setSendingState()
    try {
      if (!skipAppend) {
        await this.ctx.sessionLog.append(sessionId, {
          type: 'user/message',
          ts: Date.now(),
          sessionId,
          content: text,
        } satisfies SessionEvent)
      }
      const events = await this.ctx.sessionLog.read(sessionId)
      // 停止标记：匹配 zh/en 默认 + 当前语言（含自定义字典覆盖），防匹配失效
      const markers = new Set(STOP_MARKERS)
      markers.add(t('common.stopped'))
      const history = filterModelHistory(events, markers)
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
        '交互入口默认优先命令/面板/状态栏；左侧边栏 ribbon 图标仅在用户明确要求时使用（侧栏空间宝贵，不要默认添加）。',
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
          list: () =>
            this.ctx.toolsCompat
              .list()
              .filter(
                (t) =>
                  agentAllows(agent, t.name) &&
                  // run_command 默认不启用：未开启时不暴露给模型（避免模型误调用）
                  (t.name !== 'run_command' || Boolean(this.ctx.settings.get('enableCommandTool', false))),
              ),
        },
        executeTool: (name, input) => this.executeTool(name, input, sessionId),
        onEvent: sink,
        onStream: streaming ? (delta) => this.appendStream(delta) : undefined,
        onThinking: (delta) => this.appendThinking(delta),
        onUsage: (u) => {
          if (this.turnStats) {
            this.turnStats.usage = this.turnStats.usage
              ? {
                  prompt: this.turnStats.usage.prompt + u.prompt,
                  completion: this.turnStats.usage.completion + u.completion,
                }
              : u
          }
        },
        onPhase: (phase) => this.setPhase(phase),
        history,
        system,
        model: this.sessionModelValue(),
        signal,
      })
    } catch (err) {
      const failed = err instanceof Error && err.name === 'AbortError'
      const content = failed ? t('common.stopped') : t('chat.run.failed', { msg: err instanceof Error ? err.message : String(err) })
      // 错误/中止消息渲染在当前轮次内（agent-loop 的 finally 已发 turn/end 并关闭轮次容器）
      this.openTurnContainer()
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
      this.runningSessions.delete(sessionId)
      this.runControllers.delete(sessionId)
      this.ctx.emit('dsh/run/end', sessionId)
      this.setSendingState()
      this.streamingEl = null
      this.streamingText = ''
      // 收尾思考框：停止/失败后必须关闭并清引用，否则下一轮 openThinking
      // 会命中残留引用，把新推理并进旧卡片（"沿用之前的思考框"）
      this.closeThinking()
      this.setPhase({ kind: 'idle' })
      if (this.pendingRebuild) {
        this.pendingRebuild = false
        void this.rebuild()
      }
    }
  }

  private async executeTool(name: string, input: Record<string, unknown>, sessionId: string): Promise<ToolExecution> {
    const agent = this.activeAgent()
    if (!agentAllows(agent, name)) {
      return { ok: false, error: t('chat.agent.toolDenied', { name: agentDisplayName(agent ?? { id: '', name: '' }), tool: name }) }
    }
    try {
      const result = await this.ctx.toolsCompat.execute({
        callId: `call_${Math.random().toString(36).slice(2, 10)}` as never,
        name,
        arguments: input,
        signal: this.runControllers.get(sessionId)?.signal ?? new AbortController().signal,
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

  /** 对话内思考折叠卡：推理过程增量（reasoning_content）实时追加（DOM 更新节流） */
  private appendThinking(delta: string): void {
    if (!this.thinkingEl) this.openThinking()
    this.thinkingText += delta
    // 节流：逐 delta 全量重设 textContent + scrollToBottom 会持续触发整页布局，
    // 长推理文本下明显卡顿；每 ~100ms 批量刷新一次
    if (this.thinkingTimer === null) {
      this.thinkingTimer = window.setTimeout(() => {
        this.thinkingTimer = null
        const body = this.thinkingEl?.querySelector('.dsh-thinking-body')
        if (body) body.textContent = this.thinkingText
        this.scrollToBottom()
      }, 100)
    }
  }

  private openThinking(): void {
    if (this.thinkingEl) return
    const parent = this.turnEl ?? this.messagesEl
    const details = parent.createEl('details', { cls: 'dsh-thinking is-active' })
    details.createEl('summary', { text: '🧠 思考中…' })
    // 快捷操作（展开时可见）：回到思考顶部 / 收起思考（长推理内容时无需手动向上滚）
    const actions = details.createDiv({ cls: 'dsh-thinking-actions' })
    const toTop = actions.createEl('button', {
      cls: 'dsh-thinking-action',
      text: '⤒',
      attr: { title: t('chat.thinking.top') },
    })
    toTop.onclick = () => {
      const el = this.thinkingEl
      if (!el) return
      const mrect = this.messagesEl.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      this.messagesEl.scrollTop += rect.top - mrect.top
    }
    const collapse = actions.createEl('button', {
      cls: 'dsh-thinking-action',
      text: '−',
      attr: { title: t('chat.thinking.collapse') },
    })
    collapse.onclick = () => this.thinkingEl?.removeAttribute('open')
    details.createDiv({ cls: 'dsh-thinking-body' })
    this.thinkingEl = details
    this.thinkingText = ''
    this.scrollToBottom()
  }

  /** 收尾思考卡：自动折叠，保留可展开查看（先冲刷节流文本，保证展开可见完整推理） */
  private closeThinking(): void {
    if (!this.thinkingEl) return
    if (this.thinkingTimer !== null) {
      window.clearTimeout(this.thinkingTimer)
      this.thinkingTimer = null
    }
    const summary = this.thinkingEl.querySelector('summary')
    if (summary) summary.textContent = '🧠 已思考'
    const body = this.thinkingEl.querySelector('.dsh-thinking-body')
    if (body) body.textContent = this.thinkingText
    this.thinkingEl.removeAttribute('open')
    this.thinkingEl.classList.remove('is-active')
    this.thinkingEl = null
  }

  private setPhase(phase: UiPhase): void {
    // 思考/工具阶段：对话内折叠卡（思考中 → 工具调用），避免"卡死"感
    if (phase.kind === 'thinking') this.openThinking()
    else if (phase.kind === 'tool') this.closeThinking()
    // 思考阶段不再显示底部状态条文字：轮内思考折叠卡已覆盖，避免重复
    const text =
      phase.kind === 'tool'
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
    const running = this.isCurrentRunning()
    this.sendBtn.setText(running ? t('chat.stop') : t('chat.send'))
    this.sendBtn.classList.toggle('dsh-btn-stop', running)
    this.inputEl.disabled = running
  }

  /** 插件文件自愈遮罩层：styles.css 缺失时全屏蒙层（共享构建器，内联样式不依赖 styles.css） */
  private refreshFilesBanner(): void {
    const files = this.ctx.get('pluginFiles') as
      | {
          statusOf(): { stylesMissing: boolean; phase: string }
          ensure(): Promise<void>
          releaseUrl: string
          pluginDir: string
        }
      | undefined
    const status = files?.statusOf()
    if (!files || !status || status.phase === 'ok') {
      this.filesBannerEl.empty()
      this.filesBannerEl.setCssStyles({ display: 'none' })
      return
    }
    this.filesBannerEl.empty()
    this.filesBannerEl.setCssStyles({ display: 'block' })
    buildFilesOverlay(
      this.filesBannerEl,
      { phase: status.phase, pluginDir: files.pluginDir, releaseUrl: files.releaseUrl },
      {
        reload: () => {
          try {
            const plugins = (this.app as unknown as { plugins?: { disablePlugin(id: string): void; enablePlugin(id: string): void } }).plugins
            plugins?.disablePlugin('harness-like')
            plugins?.enablePlugin('harness-like')
          } catch (err) {
            this.ctx.notice.notice(String(err))
          }
        },
        openExternal: (target) => {
          // 插件目录是 vault 相对路径 → 拼绝对路径；release URL 直接打开
          const resolved =
            target === files.pluginDir
              ? `${(this.ctx.sandbox.scope as { vaultRoot?: string }).vaultRoot ?? ''}/${target}`
              : target
          this.ctx.openExternal(resolved)
        },
        retry: () => void files.ensure(),
      },
    )
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
    let value: string | undefined
    if (this.pendingModel) value = this.pendingModel
    else if (this.currentSessionId && this.sessionModels.has(this.currentSessionId)) {
      value = this.sessionModels.get(this.currentSessionId)
    }
    // 设置变更可能导致已存的模型 id 失效（模型被删除/改名），此时回退默认
    if (value && this.isValidModel(value)) return value
    return this.defaultModelId()
  }

  /** 校验 "providerId/model" 是否仍存在于当前提供方配置中 */
  private isValidModel(id: string): boolean {
    const mid = parseModelId(id)
    if (!mid) return false
    const providers = this.ctx.settings.get('providers', [] as Array<{
      id: string
      model?: string
      models?: string[]
    }>)
    const p = providers.find((x) => x.id === mid.provider)
    if (!p) return false
    const models = p.models?.length ? p.models : p.model ? [p.model] : []
    return models.includes(mid.model)
  }

  /** 切换到已有会话：丢弃为"新会话"准备的模型选择，避免串台覆盖旧会话模型 */
  private openSession(id: string): void {
    this.pendingModel = null
    this.currentSessionId = id
    void this.renderSession()
    void this.refreshSessions()
  }

  /** 发送前应用 pendingModel：有效则落盘到该会话，无效（模型已被删除）则仅丢弃 */
  private applyPendingModel(sessionId: string): void {
    if (!this.pendingModel) return
    const modelId = this.sessionModelValue()
    if (this.pendingModel === modelId) {
      this.sessionModels.set(sessionId, modelId)
      void this.ctx.sessionLog.patchMeta(sessionId, { modelId })
    }
    this.pendingModel = null
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
            const id = this.currentSessionId
            if (id) {
              this.sessionModels.set(id, item.value)
              // 会话内切换模型 → 持久化到该会话元信息（追加更新，取最新）
              void this.ctx.sessionLog.patchMeta(id, { modelId: item.value })
            } else {
              // 新会话尚未建 id：先记在 pendingModel，send() 建会话时采用
              this.pendingModel = item.value
            }
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

  /** 默认模型：defaultModelId（"providerId/model"）优先，回退第一个提供方的第一个模型 */
  private defaultModelId(): string {
    const providers = this.ctx.settings.get('providers', [] as Array<{
      id: string
      model?: string
      models?: string[]
    }>)
    const defaultId = this.ctx.settings.get('defaultModelId', '') as string
    const mid = parseModelId(defaultId)
    if (mid) {
      const p = providers.find((x) => x.id === mid.provider)
      if (p) {
        const models = p.models?.length ? p.models : p.model ? [p.model] : []
        if (models.includes(mid.model)) return `${p.id}/${mid.model}`
        if (models.length) return `${p.id}/${models[0]}`
      }
    }
    const first = providers[0]
    if (!first) return ''
    return `${first.id}/${first.models?.length ? first.models[0] : first.model ?? ''}`
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

  private refreshSessions(): Promise<void> {
    this.refreshChain = this.refreshChain.then(() => this.doRefreshSessions())
    return this.refreshChain
  }

  private async doRefreshSessions(): Promise<void> {
    this.sessionRowsEl.empty()
    const list = await this.ctx.sessionLog.list()
    if (!list.length) {
      this.sessionRowsEl.createDiv({ cls: 'dsh-session-empty', text: t('chat.list.empty') })
      return
    }
    for (const s of list) {
      const row = this.sessionRowsEl.createDiv({
        cls: 'dsh-session-row' + (s.id === this.currentSessionId ? ' is-active' : ''),
      })
      const btn = row.createEl('button', { cls: 'dsh-session-btn' })
      btn.createDiv({ cls: 'dsh-session-title', text: s.title ?? s.id })
      btn.createDiv({
        cls: 'dsh-session-sub',
        text: `${s.notePath ?? t('chat.list.global')} · ${t('chat.list.count', { count: s.count })}`,
      })
      // 执行中标记（本面板或其他面板正在运行该会话）
      if (this.runningSessions.has(s.id)) {
        row.createSpan({ cls: 'dsh-session-running', text: `⟳ ${t('chat.list.running')}` })
      }
      btn.onclick = () => this.openSession(s.id)
      // 悬浮操作：重命名 / 导出 / 删除
      const actions = row.createDiv({ cls: 'dsh-session-actions' })
      const ren = actions.createEl('button', { cls: 'dsh-session-action', text: '✎', attr: { title: t('chat.list.rename') } })
      ren.onclick = (ev) => {
        ev.stopPropagation()
        void this.renameSession(s.id, s.title ?? s.id)
      }
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

  /** 重命名会话：追加一条只含 title 的 session/meta（readMeta 取最新） */
  private async renameSession(id: string, currentTitle: string): Promise<void> {
    const title = await new SessionRenameModal(this.app, currentTitle).ask()
    if (!title || title === currentTitle) return
    await this.ctx.sessionLog.patchMeta(id, { title })
    this.ctx.notice.notice(t('chat.rename.done', { title }))
    await this.refreshSessions()
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
    this.lastEventKey = ''
    this.thinkingEl = null
    this.thinkingText = ''
    if (this.thinkingTimer !== null) {
      window.clearTimeout(this.thinkingTimer)
      this.thinkingTimer = null
    }
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
    // 重建后强制滚到底部：切换会话 / 打开历史会话默认展示最新一次内容，
    // 避免 DOM 清空重建后 scrollTop 停在顶部（重来按钮也依赖此行为）
    this.scrollToBottom(true)
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


  /**
   * 滚动到底部。默认仅在用户已贴近底部时跟随（避免用户向上阅读时被反复拽回）；
   * force=true 用于新轮次/会话切换等必须展示最新内容的场景。
   */
  private scrollToBottom(force = false): void {
    if (!force) {
      const el = this.messagesEl
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 120) return
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }
}
