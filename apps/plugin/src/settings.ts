import type { GrantRecord, LogLevel } from '@dsh-obsidian/harness-base'

/** 智能体模式（对齐 dsh 的预设模式） */
export type AgentMode = 'chat' | 'edit' | 'create'

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

export interface DshSettings {
  /** 模型提供方（通道）列表 */
  providers: ProviderConfig[]
  /** 默认模型（"providerId/model" 粒度），新会话兜底 */
  defaultModelId: string
  /** 智能体模式：chat=仅对话/只读；edit=可读写笔记；create=完整能力（含插件创建） */
  agentMode: AgentMode
  /** 写操作审批默认模式（ask = 每次询问；deny = 默认拒绝） */
  approvalDefault: 'ask' | 'deny'
  /** 目录级审批白名单：这些目录下的写操作免审批（vault 相对路径，如 Inbox） */
  writeAllowDirs: string[]
  /** 工具级策略覆盖，每行 "工具名=ask|allow|deny" */
  toolPolicy: string[]
  /** 会话保留天数：启动时清理超过 N 天未更新的会话（0 = 不清理） */
  sessionRetentionDays: number
  /** 日志级别 */
  logLevel: LogLevel
  /** 流式输出（关闭时等完整消息再显示） */
  streamingEnabled: boolean
  /** Markdown 渲染（关闭时消息显示纯文本） */
  renderMarkdown: boolean
  /** 插件 grant（单勾/双勾），key = 插件 id */
  grants: Record<string, GrantRecord>
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

export function defaultSettings(): DshSettings {
  return {
    providers: [{ ...DEFAULT_PROVIDER, models: [...DEFAULT_PROVIDER.models] }],
    defaultModelId: 'deepseek/deepseek-chat',
    agentMode: 'edit',
    approvalDefault: 'ask',
    writeAllowDirs: [],
    toolPolicy: [],
    sessionRetentionDays: 0,
    logLevel: 'info',
    streamingEnabled: true,
    renderMarkdown: true,
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
export function migrateSettings(raw: Record<string, unknown> | undefined): DshSettings {
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

  base.agentMode = (['chat', 'edit', 'create'] as const).includes(r.agentMode as never)
    ? (r.agentMode as AgentMode)
    : 'edit'
  base.approvalDefault = r.approvalDefault === 'deny' ? 'deny' : 'ask'
  base.writeAllowDirs = Array.isArray(r.writeAllowDirs) ? (r.writeAllowDirs as string[]) : []
  base.toolPolicy = Array.isArray(r.toolPolicy) ? (r.toolPolicy as string[]) : []
  base.sessionRetentionDays =
    typeof r.sessionRetentionDays === 'number' ? (r.sessionRetentionDays as number) : 0
  base.logLevel = (['debug', 'info', 'warn', 'error'] as const).includes(r.logLevel as never)
    ? (r.logLevel as LogLevel)
    : 'info'
  base.streamingEnabled = r.streamingEnabled !== false
  base.renderMarkdown = r.renderMarkdown !== false
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
