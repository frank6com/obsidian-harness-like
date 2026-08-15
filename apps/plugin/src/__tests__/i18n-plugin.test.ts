/**
 * 翻译扩展点集成测试：真实用户插件通过 inject: ['dshI18n'] + registerLocale
 * 覆盖主插件文案；插件停止（fiber dispose）后文案自动还原。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import { loadUserPlugin } from '@harness-like/plugin-runtime'
import { registerLocale, setLanguage, t } from '../i18n'

const PLUGIN_JS = `
module.exports = {
  name: 'translation-demo',
  inject: ['dshI18n'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.dshI18n.registerLocale('zh', {
        'chat.send': '发送！（翻译插件）',
        'chat.header.newSession': '＋ 新对话（翻译插件）',
      }),
    ])
  },
}
`

async function makePlugin(root: string): Promise<string> {
  const dir = path.join(root, '.obsidian', 'harness-like-plugins', 'translation-demo')
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, 'main.js'), PLUGIN_JS)
  await fs.promises.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'translation-demo',
      version: '0.0.1',
      dsh: { id: 'translation-demo', version: '0.0.1' },
    }),
  )
  return dir
}

describe('翻译扩展点（用户插件覆盖主插件文案）', () => {
  it('加载翻译插件后 t() 被覆盖；dispose 后还原', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-i18n-plugin-'))
    const dir = await makePlugin(root)
    const ctx = new Context()
    // 模拟主插件暴露 dshI18n 服务
    ctx.reflect.provide('dshI18n', { registerLocale })

    setLanguage('zh')
    expect(t('chat.send')).toBe('发送')

    const loaded = await loadUserPlugin(ctx, dir, {
      require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
    })
    expect(t('chat.send')).toBe('发送！（翻译插件）')
    expect(t('chat.header.newSession')).toBe('＋ 新对话（翻译插件）')
    expect(t('chat.phase.thinking')).toBe('思考中…') // 未覆盖 key 保持原文

    await loaded.fiber.dispose()
    expect(t('chat.send')).toBe('发送')
    expect(t('chat.header.newSession')).toBe('＋ 新会话')
    setLanguage('zh')
  })
})
