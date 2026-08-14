/**
 * 会话日志：追加式 JSONL，每条记录一个会话事件。
 * 损坏行跳过并忽略（归档重建由数据安全 SOP 处理）。
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
}

export class SessionLog {
  constructor(private dir: string) {}

  private file(sessionId: string): string {
    return path.join(this.dir, `${sanitize(sessionId)}.jsonl`)
  }

  async append(sessionId: string, event: SessionEvent): Promise<void> {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const line = JSON.stringify({ ...event, sessionId })
    await fs.promises.appendFile(this.file(sessionId), line + '\n', 'utf8')
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
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

  async list(): Promise<SessionSummary[]> {
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
        const [stat, events] = await Promise.all([
          fs.promises.stat(path.join(this.dir, name)),
          this.read(id),
        ])
        out.push({ id, updatedAt: stat.mtimeMs, count: events.length })
      } catch {
        // 跳过无法读取的文件
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    return out
  }

  async remove(sessionId: string): Promise<void> {
    await fs.promises.rm(this.file(sessionId), { force: true })
  }
}
