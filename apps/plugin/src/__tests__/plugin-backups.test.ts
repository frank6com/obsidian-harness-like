// 插件版本备份：快照 / 列表 / 恢复 / 误删恢复 往返测试（纯 node fs，无需 jsdom）

import { describe, expect, it, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { PluginBackups, autoRecoverLastGood } from '../plugin-backups'

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dsh-backups-'))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('PluginBackups', () => {
  let root: string
  let plugins: string
  let backups: PluginBackups

  beforeEach(async () => {
    root = await tmpRoot()
    plugins = path.join(root, 'plugins')
    backups = new PluginBackups(path.join(root, 'plugin-backups'))
    await fs.mkdir(plugins, { recursive: true })
  })

  it('快照 → 列表 → 恢复：往返内容一致（改坏后可还原）', async () => {
    const dir = path.join(plugins, 'demo')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"demo"}')
    await fs.writeFile(path.join(dir, 'main.js'), 'module.exports = {}; // v1')
    const meta = await backups.snapshot(dir, 'demo', 'overwrite')
    expect(meta).not.toBeNull()
    expect(meta!.reason).toBe('overwrite')
    expect(meta!.fileCount).toBe(2)

    // 模拟"AI 改坏了"
    await fs.writeFile(path.join(dir, 'main.js'), 'module.exports = {}; // v2 broken')

    const list = await backups.list('demo')
    expect(list.length).toBe(1)
    await backups.restore(dir, 'demo', list[0]!.id)
    expect(await fs.readFile(path.join(dir, 'main.js'), 'utf8')).toBe('module.exports = {}; // v1')
    expect(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).toBe('{"name":"demo"}')
  })

  it('多份备份按时间倒序；不同原因（overwrite/rollback）均列出', async () => {
    const dir = path.join(plugins, 'demo')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'main.js'), 'v1')
    await backups.snapshot(dir, 'demo', 'overwrite')
    await sleep(5)
    await fs.writeFile(path.join(dir, 'main.js'), 'v2')
    await backups.snapshot(dir, 'demo', 'overwrite')
    await sleep(5)
    await fs.writeFile(path.join(dir, 'main.js'), 'v3')
    await backups.snapshot(dir, 'demo', 'rollback')

    const list = await backups.list('demo')
    expect(list.length).toBe(3)
    expect(list[0]!.reason).toBe('rollback')
    expect(list[0]!.time).toBeGreaterThanOrEqual(list[1]!.time)
    // 恢复第二份（v2 时代）
    await backups.restore(dir, 'demo', list[1]!.id)
    expect(await fs.readFile(path.join(dir, 'main.js'), 'utf8')).toBe('v2')
  })

  it('误删恢复：目录删除后 restore 重建目录与文件；deletedPlugins 识别', async () => {
    const dir = path.join(plugins, 'demo')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'main.js'), 'v1')
    const meta = await backups.snapshot(dir, 'demo', 'delete')
    expect(meta).not.toBeNull()
    await fs.rm(dir, { recursive: true, force: true })

    // 有备份但目录已不存在 → 出现在"已删除"列表
    const deleted = await backups.deletedPlugins(['other-plugin'])
    expect(deleted).toContain('demo')
    // 不存在的插件不会误报
    expect(deleted).not.toContain('other-plugin')

    await backups.restore(dir, 'demo', meta!.id)
    expect(await fs.readFile(path.join(dir, 'main.js'), 'utf8')).toBe('v1')
  })

  it('插件目录不存在时快照返回 null（不产生空备份）', async () => {
    expect(await backups.snapshot(path.join(plugins, 'ghost'), 'ghost', 'overwrite')).toBeNull()
    expect(await backups.list('ghost')).toEqual([])
  })

  it('非法备份 id / 不存在的备份恢复时抛错', async () => {
    const dir = path.join(plugins, 'demo')
    await fs.mkdir(dir, { recursive: true })
    await expect(backups.restore(dir, 'demo', '../evil')).rejects.toThrow()
    await expect(backups.restore(dir, 'demo', '12345-overwrite')).rejects.toThrow()
  })
})

describe('autoRecoverLastGood（0.35.1）', () => {
  it('最新备份加载失败时逐级回退到最近可用版本', async () => {
    const root = await tmpRoot()
    const plugins = path.join(root, 'plugins')
    await fs.mkdir(plugins, { recursive: true })
    const backups = new PluginBackups(path.join(root, 'plugin-backups'))
    const dir = path.join(plugins, 'demo')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'main.js'), 'v1-good')
    const b1 = await backups.snapshot(dir, 'demo', 'overwrite')
    await sleep(5)
    await fs.writeFile(path.join(dir, 'main.js'), 'v2-broken')
    await backups.snapshot(dir, 'demo', 'overwrite')

    // 最新备份（v2-broken）加载失败，v1-good 成功
    let loads = 0
    const runtime = {
      load: async () => {
        loads++
        return { status: loads === 1 ? ('error' as const) : ('running' as const) }
      },
    }
    const r = await autoRecoverLastGood(backups, runtime, plugins, 'demo')
    expect(r.restored).toBe(true)
    expect(r.backupId).toBe(b1!.id)
    // 磁盘上恢复为 v1-good 的内容
    expect(await fs.readFile(path.join(dir, 'main.js'), 'utf8')).toBe('v1-good')
  })

  it('全部备份不可用时返回 restored=false', async () => {
    const root = await tmpRoot()
    const plugins = path.join(root, 'plugins')
    await fs.mkdir(plugins, { recursive: true })
    const backups = new PluginBackups(path.join(root, 'plugin-backups'))
    const dir = path.join(plugins, 'demo')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'main.js'), 'x')
    await backups.snapshot(dir, 'demo', 'overwrite')
    const runtime = { load: async () => ({ status: 'error' as const }) }
    const r = await autoRecoverLastGood(backups, runtime, plugins, 'demo')
    expect(r.restored).toBe(false)
  })
})
