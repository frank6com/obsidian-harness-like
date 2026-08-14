import type { GrantRecord, LogLevel } from '@dsh-obsidian/harness-base'

/** 一个模型提供方（OpenAI 兼容端点） */
export interface ProviderConfig {
  id: string
  name: string
  baseURL: string
  apiKey: string
  /** 默认模型 */
  model: string
  /** 可选模型列表（对话面板选择器用；空则仅 model） */
  models?: string[]
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
  /** 默认提供方 id（新会话的模型兜底；对话面板可切换） */
  defaultProviderId: string
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
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 0,
  extraHeaders: [],
}

export function defaultSettings(): DshSettings {
  return {
    providers: [{ ...DEFAULT_PROVIDER }],
    defaultProviderId: 'deepseek',
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

/** 旧版单提供方配置 → 多提供方结构（兼容迁移） */
export function migrateSettings(raw: Record<string, unknown> | undefined): DshSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>

  const providers = Array.isArray(r.providers)
    ? (r.providers as ProviderConfig[]).filter((p) => p && typeof p.id === 'string')
    : []
  if (providers.length) {
    base.providers = providers.map((p) => ({
      ...DEFAULT_PROVIDER,
      ...p,
      extraHeaders: Array.isArray(p.extraHeaders) ? p.extraHeaders : [],
    }))
    base.defaultProviderId =
      typeof r.defaultProviderId === 'string' && providers.some((p) => p.id === r.defaultProviderId)
        ? (r.defaultProviderId as string)
        : typeof r.activeProviderId === 'string' && providers.some((p) => p.id === r.activeProviderId)
          ? (r.activeProviderId as string)
          : providers[0]!.id
  } else {
    // 旧版字段迁移
    base.providers = [
      {
        ...DEFAULT_PROVIDER,
        baseURL: typeof r.baseURL === 'string' && r.baseURL ? (r.baseURL as string) : DEFAULT_PROVIDER.baseURL,
        apiKey: typeof r.apiKey === 'string' ? (r.apiKey as string) : '',
        model: typeof r.model === 'string' && r.model ? (r.model as string) : DEFAULT_PROVIDER.model,
        temperature: typeof r.temperature === 'number' ? (r.temperature as number) : DEFAULT_PROVIDER.temperature,
        maxTokens: typeof r.maxTokens === 'number' ? (r.maxTokens as number) : DEFAULT_PROVIDER.maxTokens,
      },
    ]
    base.defaultProviderId = 'deepseek'
  }

  base.approvalDefault = r.approvalDefault === 'deny' ? 'deny' : 'ask'
  base.writeAllowDirs = Array.isArray(r.writeAllowDirs)
    ? (r.writeAllowDirs as string[])
    : []
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
