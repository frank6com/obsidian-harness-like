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

  it('session/meta 提供标题与绑定笔记，list 携带元信息', async () => {
    const dir = await tmpDir()
    const log = new SessionLog(dir)
    await log.append('s1', {
      type: 'session/meta',
      ts: 1,
      sessionId: 's1',
      title: '统计笔记',
      notePath: 'Inbox/示例.md',
    })
    await log.append('s1', { type: 'user/message', ts: 2, sessionId: 's1', content: '统计' })
    const meta = await log.readMeta('s1')
    expect(meta).toEqual({ title: '统计笔记', notePath: 'Inbox/示例.md' })
    const list = await log.list()
    expect(list[0]).toMatchObject({ id: 's1', title: '统计笔记', notePath: 'Inbox/示例.md' })
    // 无 meta 的会话回退
    await log.append('s2', { type: 'user/message', ts: 3, sessionId: 's2', content: 'x' })
    expect(await log.readMeta('s2')).toBeUndefined()
  })

  it('patchMeta 追加更新：readMeta 取最新，逐字段覆盖', async () => {
    const dir = await tmpDir()
    const log = new SessionLog(dir)
    await log.append('s1', {
      type: 'session/meta',
      ts: 1,
      sessionId: 's1',
      title: '统计笔记',
      notePath: 'Inbox/示例.md',
      modelId: 'deepseek/deepseek-chat',
    })
    // 仅携带变更字段（modelId）的追加更新
    await log.patchMeta('s1', { modelId: 'openai/gpt-4o' })
    const meta = await log.readMeta('s1')
    // 标题/笔记保留首条，modelId 取最新
    expect(meta).toEqual({
      title: '统计笔记',
      notePath: 'Inbox/示例.md',
      modelId: 'openai/gpt-4o',
    })
    const list = await log.list()
    expect(list[0]).toMatchObject({ id: 's1', modelId: 'openai/gpt-4o' })
  })
})

  it('重命名：patchMeta({title}) 覆盖标题，其余字段保留', async () => {
    const dir = await tmpDir()
    const log = new SessionLog(dir)
    await log.append('s1', {
      type: 'session/meta',
      ts: 1,
      sessionId: 's1',
      title: '旧标题',
      notePath: 'Inbox/a.md',
      modelId: 'deepseek/deepseek-chat',
    })
    await log.patchMeta('s1', { title: '新标题' })
    const meta = await log.readMeta('s1')
    expect(meta).toEqual({ title: '新标题', notePath: 'Inbox/a.md', modelId: 'deepseek/deepseek-chat' })
    const list = await log.list()
    expect(list[0]!.title).toBe('新标题')
  })
