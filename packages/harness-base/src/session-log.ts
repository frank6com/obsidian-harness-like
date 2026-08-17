/**
 * 会话日志：追加式 JSONL，每条记录一个会话事件。
 * 损坏行跳过并忽略（归档重建由数据安全 SOP 处理）。
 *
 * 并发安全：所有 append 经实例内 promise 链串行化（保证落盘顺序 =
 * 调用顺序）；read/list/remove 先等待链上未完成写入再执行，
 * 避免"读到半截/顺序错乱"导致重建消息列表时出现孤儿 tool 消息。
 */

import * as fs from 'fs'
import * as path from 'path'
import type { SessionEvent } from './types'

function sanitize(id: string): string {
  return id.replace(/[^\w-]/g, '-')
}

export interface SessionSummary {
  id: string
  updatedAt: number
  count: number
  title?: string
  notePath?: string | null
  modelId?: string
}

export interface SessionMeta {
  title: string
  notePath: string | null
  modelId?: string
}

/** 会话保留策略：选出超过 retentionDays 未更新的会话 id（retentionDays <= 0 表示不清理） */
export function selectSessionsToPrune(
  list: SessionSummary[],
  now: number,
  retentionDays: number,
): string[] {
  if (retentionDays <= 0) return []
  const cutoff = now - retentionDays * 86_400_000
  return list.filter((s) => s.updatedAt < cutoff).map((s) => s.id)
}

export class SessionLog {
  private chain: Promise<void> = Promise.resolve()

  constructor(private dir: string) {}

  private file(sessionId: string): string {
    return path.join(this.dir, `${sanitize(sessionId)}.jsonl`)
  }

  /** 追加一条事件；写入串行化，返回本次写入的 promise */
  append(sessionId: string, event: SessionEvent): Promise<void> {
    const op = this.chain.then(async () => {
      await fs.promises.mkdir(this.dir, { recursive: true })
      const line = JSON.stringify({ ...event, sessionId })
      await fs.promises.appendFile(this.file(sessionId), line + '\n', 'utf8')
    })
    // 链上吞掉错误，避免一次失败阻塞后续写入；调用方仍能收到本次拒绝
    this.chain = op.then(
      () => {},
      () => {},
    )
    return op
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    await this.chain
    let text: string
    try {
      text = await fs.promises.readFile(this.file(sessionId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const events: SessionEvent[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as SessionEvent)
      } catch {
        // 损坏行：跳过
      }
    }
    return events
  }

  /**
   * 读取会话元信息（取最后一条 session/meta 事件，逐字段后写覆盖先写）。
   * 支持「追加更新」——切换模型时无需原地改写首行，只需再 append 一条
   * 只含变更字段（如 modelId）的 session/meta，readMeta 自然取最新值。
   * 无 session/meta 则 undefined。
   */
  async readMeta(sessionId: string): Promise<SessionMeta | undefined> {
    await this.chain
    let text: string
    try {
      text = await fs.promises.readFile(this.file(sessionId), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
    let meta: SessionMeta | undefined
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const ev = JSON.parse(trimmed) as SessionEvent
        if (ev.type === 'session/meta') {
          meta = {
            // 后写事件优先覆盖（patchMeta 追加的字段会覆盖首条）
            title: ev.title ?? meta?.title,
            notePath: ev.notePath ?? meta?.notePath ?? null,
            modelId: ev.modelId ?? meta?.modelId,
          }
        }
      } catch {
        // 损坏行：跳过
      }
    }
    return meta
  }

  /**
   * 更新会话元信息中指定字段：追加一条只含变更字段的 session/meta，
   * 供 readMeta（取最新）读回。用于会话内切换模型等「原地更新」场景，
   * 避免依赖可被多个写入者竞争的 JSONL 首行改写。
   */
  async patchMeta(sessionId: string, patch: Partial<SessionMeta>): Promise<void> {
    await this.append(sessionId, {
      type: 'session/meta',
      ts: Date.now(),
      sessionId,
      ...patch,
    } as SessionEvent)
  }

  async list(): Promise<SessionSummary[]> {
    await this.chain
    let names: string[]
    try {
      names = await fs.promises.readdir(this.dir)
    } catch {
      return []
    }
    const out: SessionSummary[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -'.jsonl'.length)
      try {
        const [stat, events, meta] = await Promise.all([
          fs.promises.stat(path.join(this.dir, name)),
          this.read(id),
          this.readMeta(id),
        ])
        out.push({
          id,
          updatedAt: stat.mtimeMs,
          count: events.length,
          title: meta?.title,
          notePath: meta?.notePath,
          modelId: meta?.modelId,
        })
      } catch {
        // 跳过无法读取的文件
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    return out
  }

  async remove(sessionId: string): Promise<void> {
    await this.chain
    await fs.promises.rm(this.file(sessionId), { force: true })
  }
}
