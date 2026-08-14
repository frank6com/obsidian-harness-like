/**
 * 审批与授权（纯逻辑，可单测）。
 *
 * 两类关注点：
 * 1. 动态插件 grant（对齐 dsh 单勾/双勾语义）：version = 仅当前版本；all = 信任后续版本。
 * 2. 写操作审批：默认每次 ask；ChatView 提供"本会话允许写"开关（会话级放宽，不持久化）。
 */

export type GrantMode = 'version' | 'all'

export interface GrantRecord {
  mode: GrantMode
  version: string
  grantedAt: number
}

export type WriteDecision = 'allow' | 'ask' | 'deny'

export interface ApprovalStore {
  load(): Record<string, GrantRecord>
  save(grants: Record<string, GrantRecord>): void
}

export class ApprovalService {
  private grants: Record<string, GrantRecord>
  private sessionAllow = false

  constructor(private store: ApprovalStore) {
    this.grants = store.load()
  }

  getGrant(pluginId: string): GrantRecord | undefined {
    return this.grants[pluginId]
  }

  /** 全部授权（grant 管理界面用） */
  listGrants(): Array<{ pluginId: string; grant: GrantRecord }> {
    return Object.entries(this.grants).map(([pluginId, grant]) => ({ pluginId, grant }))
  }

  grant(pluginId: string, mode: GrantMode, version: string): void {
    this.grants[pluginId] = { mode, version, grantedAt: Date.now() }
    this.store.save(this.grants)
  }

  revoke(pluginId: string): void {
    delete this.grants[pluginId]
    this.store.save(this.grants)
  }

  isGranted(pluginId: string, version: string): boolean {
    const g = this.grants[pluginId]
    if (!g) return false
    return g.mode === 'all' || g.version === version
  }

  setSessionAllow(v: boolean): void {
    this.sessionAllow = v
  }

  isSessionAllowed(): boolean {
    return this.sessionAllow
  }

  /** 写操作决策：会话级开关优先，否则按默认模式 */
  decideWrite(defaultMode: 'ask' | 'deny'): WriteDecision {
    if (this.sessionAllow) return 'allow'
    return defaultMode
  }
}
