/**
 * 用户插件版本备份：AI 每次覆盖写入前自动快照整个插件目录，
 * 支持从插件管理器 / 对话中回退到任意历史版本；删除插件前也留备份（可恢复误删）。
 * 存储：<dataDir>/plugin-backups/<pluginId>/<时间戳>-<原因>/（保留不限数量）
 */

import { promises as fs } from 'node:fs'
import * as path from 'path'
import type { Context } from '@deepseek-ai/cordis'

export type BackupReason = 'overwrite' | 'rollback' | 'delete'

export interface PluginBackupMeta {
  /** 备份目录名（<时间戳>-<原因>） */
  id: string
  time: number
  reason: BackupReason
  fileCount: number
  bytes: number
}

export class PluginBackups {
  constructor(private root: string) {}

  private pluginDir(pluginId: string): string {
    return path.join(this.root, pluginId)
  }

  static parseId(name: string): { time: number; reason: BackupReason } | null {
    const m = /^(\d+)-(overwrite|rollback|delete)$/.exec(name)
    if (!m) return null
    return { time: Number(m[1]), reason: m[2] as BackupReason }
  }

  /**
   * 快照整个插件目录（当前插件均为 package.json + main.js 等单层文件）。
   * 插件目录不存在时返回 null（无可备份）。
   */
  async snapshot(pluginDir: string, pluginId: string, reason: BackupReason): Promise<PluginBackupMeta | null> {
    let entries: string[]
    try {
      entries = await fs.readdir(pluginDir)
    } catch {
      return null
    }
    const time = Date.now()
    const dest = path.join(this.pluginDir(pluginId), `${time}-${reason}`)
    await fs.mkdir(dest, { recursive: true })
    let fileCount = 0
    let bytes = 0
    for (const name of entries) {
      const src = path.join(pluginDir, name)
      let stat
      try {
        stat = await fs.stat(src)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      await fs.copyFile(src, path.join(dest, name))
      fileCount += 1
      bytes += stat.size
    }
    if (!fileCount) {
      // 空插件目录：备份无意义，清理掉
      await fs.rm(dest, { recursive: true, force: true })
      return null
    }
    return { id: path.basename(dest), time, reason, fileCount, bytes }
  }

  /** 列出某插件的全部备份（新的在前） */
  async list(pluginId: string): Promise<PluginBackupMeta[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.pluginDir(pluginId))
    } catch {
      return []
    }
    const out: PluginBackupMeta[] = []
    for (const name of names) {
      const parsed = PluginBackups.parseId(name)
      if (!parsed) continue
      const dir = path.join(this.pluginDir(pluginId), name)
      let files: string[]
      try {
        files = await fs.readdir(dir)
      } catch {
        continue
      }
      let bytes = 0
      for (const f of files) {
        try {
          bytes += (await fs.stat(path.join(dir, f))).size
        } catch {
          // 忽略单个文件读取失败
        }
      }
      out.push({ id: name, time: parsed.time, reason: parsed.reason, fileCount: files.length, bytes })
    }
    out.sort((a, b) => b.time - a.time)
    return out
  }

  /** 取最新一份备份 */
  async latest(pluginId: string): Promise<PluginBackupMeta | null> {
    const all = await this.list(pluginId)
    return all[0] ?? null
  }

  /**
   * 恢复备份：插件目录整体替换为快照内容（目录不存在则重建，支持误删恢复）。
   * 恢复前调用方应先 snapshot(…, 'rollback')，使回退本身可撤销。
   */
  async restore(pluginDir: string, pluginId: string, backupId: string): Promise<void> {
    if (!PluginBackups.parseId(backupId)) throw new Error(`非法备份 id: ${backupId}`)
    const src = path.join(this.pluginDir(pluginId), backupId)
    await fs.access(src) // 备份不存在则抛错
    await fs.rm(pluginDir, { recursive: true, force: true })
    await fs.mkdir(pluginDir, { recursive: true })
    for (const name of await fs.readdir(src)) {
      await fs.copyFile(path.join(src, name), path.join(pluginDir, name))
    }
  }

  /** 有备份但插件目录已不存在的插件 id（误删恢复入口） */
  async deletedPlugins(liveIds: string[]): Promise<string[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.root)
    } catch {
      return []
    }
    const deleted: string[] = []
    for (const name of names) {
      if (liveIds.includes(name)) continue
      if ((await this.list(name)).length) deleted.push(name)
    }
    return deleted
  }
}

export interface AutoRecoverResult {
  restored: boolean
  backupId?: string
}

/**
 * 加载失败后的自动回退阶梯：从最新备份依次恢复并尝试加载，
 * 直到成功（最多尝试 maxAttempts 份）。备份全是"写坏的状态"时也能逐级回退到
 * 最近一个可用版本（0.35.1：让备份真正有意义）。
 */
export async function autoRecoverLastGood(
  backups: PluginBackups,
  runtime: { load(id: string): Promise<{ status: string; error?: string }> },
  pluginsDir: string,
  pluginId: string,
  maxAttempts = 5,
): Promise<AutoRecoverResult> {
  const list = await backups.list(pluginId)
  const dir = path.join(pluginsDir, pluginId)
  for (const b of list.slice(0, maxAttempts)) {
    try {
      await backups.restore(dir, pluginId, b.id)
      const r = await runtime.load(pluginId)
      if (r.status === 'running') return { restored: true, backupId: b.id }
    } catch {
      // 该备份损坏/加载失败：继续尝试更早的
    }
  }
  return { restored: false }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 用户插件版本备份（覆盖写入前 / 删除前自动快照，可回退） */
    pluginBackups: PluginBackups
  }
}
