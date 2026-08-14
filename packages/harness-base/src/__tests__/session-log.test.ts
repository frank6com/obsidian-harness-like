import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SessionLog } from '../session-log'
import type { SessionEvent } from '../types'

async function tmpDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-test-'))
}

describe('SessionLog', () => {
  it('append → read 往返', async () => {
    const log = new SessionLog(await tmpDir())
    const ev: SessionEvent = { type: 'user/message', ts: 1, sessionId: 's1', content: 'hi' }
    await log.append('s1', ev)
    const events = await log.read('s1')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'user/message', content: 'hi' })
  })

  it('不存在的会话返回空数组', async () => {
    const log = new SessionLog(await tmpDir())
    expect(await log.read('nope')).toEqual([])
  })

  it('损坏行被跳过，其余保留', async () => {
    const dir = await tmpDir()
    const log = new SessionLog(dir)
    await log.append('s1', { type: 'turn/start', ts: 1, sessionId: 's1' })
    await fs.promises.appendFile(path.join(dir, 's1.jsonl'), '{corrupt}\n', 'utf8')
    await log.append('s1', { type: 'turn/end', ts: 2, sessionId: 's1' })
    const events = await log.read('s1')
    expect(events.map((e) => e.type)).toEqual(['turn/start', 'turn/end'])
  })

  it('list 按更新时间倒序返回摘要', async () => {
    const dir = await tmpDir()
    const log = new SessionLog(dir)
    await log.append('old', { type: 'user/message', ts: 1, sessionId: 'old', content: 'a' })
    await new Promise((r) => setTimeout(r, 20))
    await log.append('new', { type: 'user/message', ts: 2, sessionId: 'new', content: 'b' })
    const list = await log.list()
    expect(list.map((s) => s.id)).toEqual(['new', 'old'])
    expect(list[0]?.count).toBe(1)
  })

  it('remove 删除会话', async () => {
    const log = new SessionLog(await tmpDir())
    await log.append('s1', { type: 'turn/start', ts: 1, sessionId: 's1' })
    await log.remove('s1')
    expect(await log.read('s1')).toEqual([])
  })

  it('并发 append 保持调用顺序（tool/call 先于 tool/result）', async () => {
    const log = new SessionLog(await tmpDir())
    await Promise.all([
      log.append('s1', { type: 'tool/call', ts: 1, sessionId: 's1', id: 'c1', tool: 'x', input: {} }),
      log.append('s1', {
        type: 'tool/result',
        ts: 2,
        sessionId: 's1',
        id: 'c1',
        tool: 'x',
        ok: true,
        output: { hits: [] },
      }),
    ])
    const events = await log.read('s1')
    expect(events.map((e) => e.type)).toEqual(['tool/call', 'tool/result'])
  })

  it('read 等待未完成追加（不发后不理丢事件）', async () => {
    const log = new SessionLog(await tmpDir())
    const pending = log.append('s1', { type: 'user/message', ts: 1, sessionId: 's1', content: 'hi' })
    // 不 await pending，直接 read：串行链保证能看到
    const events = await log.read('s1')
    expect(events.map((e) => e.type)).toEqual(['user/message'])
    await pending
  })
})
