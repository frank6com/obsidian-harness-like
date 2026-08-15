/**
 * 命令前缀强制（API 层，plugin-runtime 的 ctx.commands 包装）：
 * 用户插件注册的命令统一带 `<插件id>:` 前缀——无前缀自动补、已带前缀剥离去重；
 * 命令显示名同样带来源前缀，命令面板可直接区分来源。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import { obsidianAdapterPlugin, type ObsidianApiLike } from '@harness-like/obsidian-adapter'
import { loadUserPlugin } from '@harness-like/plugin-runtime'

function stubApi(records: { commands: Array<{ id: string; name?: string }> }): ObsidianApiLike {
  return {
    vault: {
      read: async () => '',
      write: async () => {},
      create: async () => {},
      createFolder: async () => {},
      delete: async () => {},
      rename: async () => {},
      getMarkdownPaths: () => [],
      on: () => ({ unref: () => {} }),
    },
    workspace: { getActiveFile: () => null, onFileOpen: () => ({ unref: () => {} }) },
    commands: {
      addCommand: (cmd) => {
        records.commands.push({ id: cmd.id, name: cmd.name })
        return cmd
      },
      removeCommand: () => {},
    },
    viewRegistry: {
      registerView: () => {},
      unregisterView: () => {},
      openView: () => {},
    },
    ribbon: { addRibbonIcon: () => ({ remove: () => {} }) },
    statusbar: { addStatusBarItem: () => ({ el: {} as HTMLElement, remove: () => {} }) },
    settingsUi: { addSettingTab: () => {} },
    notice: { notice: () => {} },
    openTarget: async () => {},
  }
}

const PLUGIN_JS = `
module.exports = {
  name: 'prefix-test',
  inject: ['commands'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.commands.addCommand({ id: 'plain', name: 'Plain Cmd', callback() {} }),
      ctx.commands.addCommand({ id: 'prefix-test:already', name: 'prefix-test: Already', callback() {} }),
    ])
  },
}
`

async function makePluginDir(root: string): Promise<string> {
  const dir = path.join(root, '.obsidian', 'dsh-plugins', 'prefix-test')
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, 'main.js'), PLUGIN_JS)
  await fs.promises.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'prefix-test',
      version: '0.0.1',
      dsh: { id: 'prefix-test', version: '0.0.1' },
    }),
  )
  return dir
}

describe('命令前缀强制（ctx.commands API 层）', () => {
  it('无前缀自动补、已带前缀不重复、显示名带来源', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-prefix-'))
    const pluginDir = await makePluginDir(root)
    const records = { commands: [] as Array<{ id: string; name?: string }> }
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi(records)))
    await loadUserPlugin(ctx, pluginDir, {
      require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
    })
    expect(records.commands).toEqual([
      { id: 'prefix-test:plain', name: 'prefix-test: Plain Cmd' },
      { id: 'prefix-test:already', name: 'prefix-test: Already' },
    ])
  })
})
