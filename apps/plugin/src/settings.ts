import type { GrantRecord, LogLevel } from '@harness-like/harness-base'
import { detectLanguage, type Language } from './i18n'

/** 智能体模式（对齐 dsh 的预设模式） */
export type AgentMode = 'chat' | 'edit' | 'create'

/** 智能体预设：内置（chat/edit/create）或用户自定义 */
export interface AgentPreset {
  id: string
  name: string
  /** 基础模式（决定默认工具范围） */
  mode: AgentMode
  description?: string
  /** 自定义智能体：勾选的能力（工具名白名单）；空 = 按 mode 默认 */
  capabilities?: string[]
  /** 是否在对话面板可选（默认 true） */
  enabled?: boolean
}

export const BUILTIN_AGENTS: AgentPreset[] = [
  { id: 'chat', name: '对话模式', mode: 'chat', description: '仅对话与读取信息' },
  { id: 'edit', name: '修编模式', mode: 'edit', description: '可读写笔记（默认）' },
  { id: 'create', name: '创造模式', mode: 'create', description: '完整能力（可创建插件）' },
]

/** 对话面板可选的智能体（过滤已禁用） */
export function listVisibleAgents(agents: AgentPreset[]): AgentPreset[] {
  return agents.filter((a) => a.enabled !== false)
}

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  chat: '对话',
  edit: '修编',
  create: '创造',
}

export const AGENT_MODE_DESCRIPTIONS: Record<AgentMode, string> = {
  chat: '仅对话与读取信息（只读工具）',
  edit: '可创建和编辑笔记等（默认）',
  create: '完整能力，可创建/修改插件',
}

/** 一个模型提供方（通道） */
export interface ProviderConfig {
  id: string
  name: string
  baseURL: string
  apiKey: string
  /** 已添加的模型列表（端点获取或手动添加） */
  models: string[]
  /** 采样温度（0-2），0 = 端点默认 */
  temperature: number
  /** 最大输出 token 数，0 = 不限制 */
  maxTokens: number
  /** 自定义请求头，每行 "Header: value" */
  extraHeaders: string[]
}

export interface HarnessLikeSettings {
  /** 模型提供方（通道）列表 */
  providers: ProviderConfig[]
  /** 默认模型（"providerId/model" 粒度），新会话兜底 */
  defaultModelId: string
  /** 智能体预设列表（内置 + 自定义） */
  agents: AgentPreset[]
  /** 当前激活的智能体 id */
  activeAgentId: string
  /** 写操作审批默认模式（ask = 每次询问；deny = 默认拒绝） */
  approvalDefault: 'ask' | 'deny'
  /** 目录级审批白名单：这些目录下的写操作免审批（vault 相对路径，如 Inbox） */
  writeAllowDirs: string[]
  /** 工具级策略覆盖，每行 "工具名=ask|allow|deny" */
  toolPolicy: string[]
  /** 会话保留天数：启动时清理超过 N 天未更新的会话（0 = 不清理） */
  sessionRetentionDays: number
  /** 会话导出 Markdown 的 vault 相对目录（默认 'sessions' = 根目录下的 sessions 文件夹；空串 = 根目录） */
  exportDir: string
  /** 日志级别 */
  logLevel: LogLevel
  /** 仅当前笔记：注入当前活动笔记上下文，写操作限于该笔记 */
  confineToCurrentNote: boolean
  /** 流式输出（关闭时等完整消息再显示） */
  streamingEnabled: boolean
  /** Markdown 渲染（关闭时消息显示纯文本） */
  renderMarkdown: boolean
  /** 界面语言（zh / en） */
  uiLanguage: Language
  /** 插件 grant（单勾/双勾），key = 插件 id */
  grants: Record<string, GrantRecord>
}

/** 授权记录的展示状态（管理器与设置页共用）：
 * - stale = 插件目录已不存在（残留授权）
 * - mismatch = 单勾授权但插件版本已更新，需重新授权 */
export function grantDisplay(
  grant: GrantRecord | undefined,
  dirExists: boolean,
  currentVersion?: string,
): { badge: string; needsRegrant: boolean } {
  if (!grant) return { badge: '未授权', needsRegrant: false }
  const modeLabel = grant.mode === 'all' ? '双勾' : '单勾'
  const base = `已授权(${modeLabel} v${grant.version})`
  if (!dirExists) return { badge: `${base} · 插件目录不存在（残留授权）`, needsRegrant: false }
  if (grant.mode === 'version' && currentVersion && grant.version !== currentVersion) {
    return { badge: `${base} · 版本已更新，需重新授权`, needsRegrant: true }
  }
  return { badge: base, needsRegrant: false }
}

export const DEFAULT_PROVIDER: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  models: ['deepseek-chat'],
  temperature: 0.7,
  maxTokens: 0,
  extraHeaders: [],
}

export function defaultSettings(): HarnessLikeSettings {
  return {
    providers: [{ ...DEFAULT_PROVIDER, models: [...DEFAULT_PROVIDER.models] }],
    defaultModelId: 'deepseek/deepseek-chat',
    agents: BUILTIN_AGENTS.map((a) => ({ ...a })),
    activeAgentId: 'edit',
    approvalDefault: 'ask',
    writeAllowDirs: [],
    toolPolicy: [],
    sessionRetentionDays: 0,
    exportDir: 'sessions',
    logLevel: 'info',
    confineToCurrentNote: false,
    streamingEnabled: true,
    renderMarkdown: true,
    uiLanguage: detectLanguage(),
    grants: {},
  }
}

/** 解析 "providerId/model"；非法返回 null */
export function parseModelId(modelId: string): { provider: string; model: string } | null {
  const idx = modelId.indexOf('/')
  if (idx <= 0 || idx === modelId.length - 1) return null
  return { provider: modelId.slice(0, idx), model: modelId.slice(idx + 1) }
}

function asProvider(p: Partial<ProviderConfig> & { model?: string }): ProviderConfig {
  const legacyModel = p.model
  const models = Array.isArray(p.models)
    ? p.models.filter((m): m is string => typeof m === 'string' && !!m)
    : typeof legacyModel === 'string' && legacyModel
      ? [legacyModel]
      : []
  return {
    id: typeof p.id === 'string' ? p.id : `provider-${Math.random().toString(36).slice(2, 8)}`,
    name: typeof p.name === 'string' && p.name ? p.name : '提供方',
    baseURL: typeof p.baseURL === 'string' ? p.baseURL : '',
    apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    models: models.length ? [...new Set(models)] : [],
    temperature: typeof p.temperature === 'number' ? p.temperature : DEFAULT_PROVIDER.temperature,
    maxTokens: typeof p.maxTokens === 'number' ? p.maxTokens : DEFAULT_PROVIDER.maxTokens,
    extraHeaders: Array.isArray(p.extraHeaders) ? (p.extraHeaders as string[]) : [],
  }
}

/** 旧版配置 → 新版（多提供方 + 模型列表 + 模型级默认） */
export function migrateSettings(raw: Record<string, unknown> | undefined): HarnessLikeSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>

  const providers = Array.isArray(r.providers)
    ? (r.providers as Partial<ProviderConfig>[]).filter((p) => p && typeof p.id === 'string')
    : []
  if (providers.length) {
    base.providers = providers.map(asProvider)
  } else {
    // 旧版单提供方字段迁移
    base.providers = [
      asProvider({
        id: 'deepseek',
        name: 'DeepSeek',
        baseURL:
          typeof r.baseURL === 'string' && r.baseURL
            ? (r.baseURL as string)
            : DEFAULT_PROVIDER.baseURL,
        apiKey: typeof r.apiKey === 'string' ? (r.apiKey as string) : '',
        model: typeof r.model === 'string' && r.model ? (r.model as string) : 'deepseek-chat',
        models: Array.isArray(r.models) ? (r.models as string[]) : undefined,
        temperature: typeof r.temperature === 'number' ? (r.temperature as number) : undefined,
        maxTokens: typeof r.maxTokens === 'number' ? (r.maxTokens as number) : undefined,
      }),
    ]
  }

  // 默认模型：defaultModelId 优先，其次旧 defaultProviderId/activeProviderId + 模型
  const first = base.providers[0]!
  if (typeof r.defaultModelId === 'string' && parseModelId(r.defaultModelId)) {
    base.defaultModelId = r.defaultModelId
  } else {
    const legacyProvider =
      (typeof r.defaultProviderId === 'string' && r.defaultProviderId) ||
      (typeof r.activeProviderId === 'string' && r.activeProviderId)
    const lp =
      typeof legacyProvider === 'string'
        ? base.providers.find((p) => p.id === legacyProvider)
        : undefined
    const target = lp ?? first
    base.defaultModelId = target.models[0]
      ? `${target.id}/${target.models[0]}`
      : `${first.id}/${first.models[0] ?? 'deepseek-chat'}`
  }
  if (!base.providers.some((p) => p.id === parseModelId(base.defaultModelId)?.provider)) {
    base.defaultModelId = `${first.id}/${first.models[0] ?? 'deepseek-chat'}`
  }

  // 智能体：agents 数组优先，其次旧 agentMode 迁移
  const agents = Array.isArray(r.agents)
    ? (r.agents as AgentPreset[]).filter((a) => a && typeof a.id === 'string')
    : []
  // 内置智能体的名称/描述/模式强制对齐 BUILTIN_AGENTS（旧数据可能存了旧名）
  base.agents = (agents.length ? agents : BUILTIN_AGENTS.map((a) => ({ ...a }))).map((a) => {
    const builtin = BUILTIN_AGENTS.find((b) => b.id === a.id)
    return builtin ? { ...a, ...builtin, enabled: a.enabled !== false } : { ...a, enabled: a.enabled !== false }
  })
  const legacyMode = (['chat', 'edit', 'create'] as const).includes(r.agentMode as never)
    ? (r.agentMode as AgentMode)
    : 'edit'
  base.activeAgentId =
    typeof r.activeAgentId === 'string' && base.agents.some((a) => a.id === r.activeAgentId)
      ? (r.activeAgentId as string)
      : typeof r.activeAgentId === 'string'
        ? (r.activeAgentId as string)
        : legacyMode
  base.approvalDefault = r.approvalDefault === 'deny' ? 'deny' : 'ask'
  base.writeAllowDirs = Array.isArray(r.writeAllowDirs) ? (r.writeAllowDirs as string[]) : []
  base.toolPolicy = Array.isArray(r.toolPolicy) ? (r.toolPolicy as string[]) : []
  base.sessionRetentionDays =
    typeof r.sessionRetentionDays === 'number' ? (r.sessionRetentionDays as number) : 0
  base.exportDir = typeof r.exportDir === 'string' ? (r.exportDir as string).trim() : 'sessions'
  base.logLevel = (['debug', 'info', 'warn', 'error'] as const).includes(r.logLevel as never)
    ? (r.logLevel as LogLevel)
    : 'info'
  base.confineToCurrentNote = r.confineToCurrentNote === true
  base.streamingEnabled = r.streamingEnabled !== false
  base.renderMarkdown = r.renderMarkdown !== false
  base.uiLanguage = r.uiLanguage === 'en' ? 'en' : 'zh'
  base.grants = (r.grants as Record<string, GrantRecord>) ?? {}
  return base
}

/** 解析工具策略行 "name=ask|allow|deny" */
export function parseToolPolicy(lines: string[]): Map<string, 'ask' | 'allow' | 'deny'> {
  const map = new Map<string, 'ask' | 'allow' | 'deny'>()
  for (const line of lines) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const mode = line.slice(idx + 1).trim()
    if (!name || (mode !== 'ask' && mode !== 'allow' && mode !== 'deny')) continue
    map.set(name, mode)
  }
  return map
}

/** 解析自定义请求头行 "Header: value" → Record */
export function parseHeaderLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!name || !value) continue
    headers[name] = value
  }
  return headers
}
