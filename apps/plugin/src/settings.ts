import type { GrantRecord } from '@dsh-obsidian/harness-base'

export interface DshSettings {
  baseURL: string
  apiKey: string
  model: string
  /** 写操作审批默认模式（ask = 每次询问；deny = 默认拒绝） */
  approvalDefault: 'ask' | 'deny'
  /** 插件 grant（单勾/双勾），key = 插件 id */
  grants: Record<string, GrantRecord>
}

export const DEFAULT_SETTINGS: DshSettings = {
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  approvalDefault: 'ask',
  grants: {},
}
