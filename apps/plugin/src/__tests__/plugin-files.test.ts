// 插件文件自愈：styles.css 缺失检测 + 多源自动下载（网络层 mock）

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PluginFilesSelfHeal, candidateUrls, looksLikeStylesheet } from '../plugin-files'

const VALID_STYLES = '.dsh-chat { color: red; } '.repeat(50)

function makeHeal(opts: {
  exists?: (p: string) => Promise<boolean>
  fetchText?: (url: string) => Promise<string | null>
  write?: (p: string, c: string) => Promise<void>
}) {
  const ctx = new Context()
  const calls: string[] = []
  const heal = new PluginFilesSelfHeal(
    {
      pluginDir: '.obsidian/plugins/harness-like',
      repo: 'frank6com/obsidian-harness-like',
      version: '0.34.0',
      exists: opts.exists ?? (async () => false),
      write: async (p, c) => {
        calls.push(`write:${p}:${c.length}`)
      },
      fetchText:
        opts.fetchText ??
        (async (url) => {
          calls.push(`fetch:${url}`)
          return null
        }),
    },
    ctx,
  )
  return { heal, calls }
}

describe('PluginFilesSelfHeal', () => {
  it('styles.css 存在：直接 ok，不发起任何下载', async () => {
    const { heal, calls } = makeHeal({ exists: async () => true })
    await heal.ensure()
    expect(heal.statusOf()).toEqual({ stylesMissing: false, phase: 'ok' })
    expect(calls.length).toBe(0)
  })

  it('缺失：从 jsdelivr（首选源）下载并写回插件目录，状态 restored', async () => {
    const fetched: string[] = []
    const { heal, calls } = makeHeal({
      fetchText: async (url) => {
        fetched.push(url)
        return VALID_STYLES
      },
    })
    await heal.ensure()
    expect(fetched[0]).toBe('https://cdn.jsdelivr.net/gh/frank6com/obsidian-harness-like@0.34.0/styles.css')
    expect(calls[0]).toContain('write:.obsidian/plugins/harness-like/styles.css')
    expect(heal.statusOf()).toEqual({ stylesMissing: false, phase: 'restored' })
  })

  it('内容无效（无 .dsh- 标记）→ 换下一个源，全部无效则 failed', async () => {
    const fetched: string[] = []
    const { heal } = makeHeal({
      fetchText: async (url) => {
        fetched.push(url)
        return 'x'.repeat(600)
      },
    })
    await heal.ensure()
    expect(fetched.length).toBe(candidateUrls('frank6com/obsidian-harness-like', '0.34.0').length)
    expect(heal.statusOf().phase).toBe('failed')
    expect(heal.statusOf().error).toBeTruthy()
  })

  it('全部源不可达 → failed', async () => {
    const { heal } = makeHeal({ fetchText: async () => null })
    await heal.ensure()
    expect(heal.statusOf()).toMatchObject({ stylesMissing: true, phase: 'failed' })
  })

  it('ensure 幂等：并发调用只执行一次检查下载', async () => {
    let fetches = 0
    const { heal } = makeHeal({
      fetchText: async () => {
        fetches++
        return VALID_STYLES
      },
    })
    await Promise.all([heal.ensure(), heal.ensure(), heal.ensure()])
    expect(fetches).toBe(1)
  })

  it('failed 后可重试：ensure 再次触发并恢复', async () => {
    let fetches = 0
    const { heal } = makeHeal({
      fetchText: async () => {
        fetches++
        return fetches > 3 ? VALID_STYLES : null
      },
    })
    await heal.ensure() // 3 个源全部失败
    expect(heal.statusOf().phase).toBe('failed')
    await heal.ensure() // 第 4 次请求返回有效内容
    expect(heal.statusOf().phase).toBe('restored')
  })
})

describe('candidateUrls / looksLikeStylesheet', () => {
  it('候选源按国内可达性排序：jsdelivr → raw → release', () => {
    const urls = candidateUrls('a/b', '1.2.3')
    expect(urls[0]).toContain('cdn.jsdelivr.net')
    expect(urls[1]).toContain('raw.githubusercontent.com')
    expect(urls[2]).toContain('releases/download/1.2.3/styles.css')
  })

  it('样式内容校验：足够长且含 .dsh- 标记', () => {
    expect(looksLikeStylesheet('.dsh-chat {} '.repeat(100))).toBe(true)
    expect(looksLikeStylesheet('<!DOCTYPE html>'.repeat(50))).toBe(false)
    expect(looksLikeStylesheet('short')).toBe(false)
  })
})
