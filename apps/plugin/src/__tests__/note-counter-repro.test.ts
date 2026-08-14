/**
 * 复现：重写后的 note-counter 插件加载后注册是否生效。
 * 真实 harness 装配（adapter stub 记录注册调用）+ loadUserPlugin 加载真实文件。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import { harnessServicesPlugin } from '@dsh-obsidian/harness-base'
import { obsidianAdapterPlugin, type ObsidianApiLike } from '@dsh-obsidian/obsidian-adapter'
import { runtimePlugin, loadUserPlugin } from '@dsh-obsidian/plugin-runtime'

function stubApi(records: {
  views: string[]
  ribbons: string[]
  commands: string[]
}): ObsidianApiLike {
  return {
    vault: {
      read: async () => '',
      write: async () => {},
      create: async () => {},
      createFolder: async () => {},
      delete: async () => {},
      rename: async () => {},
      getMarkdownPaths: () => ['a.md', 'Inbox/b.md'],
      on: () => ({ unref: () => {} }),
    },
    workspace: { getActiveFile: () => null, onFileOpen: () => ({ unref: () => {} }) },
    commands: {
      addCommand: (cmd) => {
        records.commands.push(cmd.id)
        return cmd
      },
      removeCommand: () => {},
    },
    viewRegistry: {
      registerView: (type) => {
        records.views.push(type)
      },
      unregisterView: () => {},
      openView: () => {},
    },
    ribbon: {
      addRibbonIcon: (_icon, title) => {
        records.ribbons.push(title)
        return { remove: () => {} }
      },
    },
    statusbar: { addStatusBarItem: () => ({ el: {} as HTMLElement, remove: () => {} }) },
    settingsUi: { addSettingTab: () => {} },
    notice: { notice: () => {} },
    openTarget: async () => {},
  }
}

describe('note-counter 重写复现', () => {
  it('真实装配下加载重写文件，注册全部生效', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-nc-'))
    const dataDir = path.join(root, '.obsidian', 'dsh')
    const pluginsDir = path.join(root, '.obsidian', 'dsh-plugins')
    // 把重写文件复制进临时插件目录
    const pluginDir = path.join(pluginsDir, 'note-counter')
    await fs.promises.mkdir(pluginDir, { recursive: true })
    await fs.promises.copyFile(
      path.join(process.cwd(), 'dev-vault/.obsidian/dsh-plugins/note-counter/main.js'),
      path.join(pluginDir, 'main.js'),
    )
    await fs.promises.copyFile(
      path.join(process.cwd(), 'dev-vault/.obsidian/dsh-plugins/note-counter/package.json'),
      path.join(pluginDir, 'package.json'),
    )

    const records = { views: [] as string[], ribbons: [] as string[], commands: [] as string[] }
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi(records)))
    await ctx.plugin(
      harnessServicesPlugin({
        sandbox: {
          vaultRoot: root,
          dataDir,
          pluginsDir,
          tempDir: path.join(dataDir, 'tmp'),
        },
        sessionDir: path.join(dataDir, 'sessions'),
        approvalStore: { load: () => ({}), save: () => {} },
        getLLMConfig: () => ({
          baseURL: 'https://api.deepseek.com',
          apiKey: 'k',
          model: 'deepseek-chat',
        }),
      }),
    )
    await ctx.plugin(
      runtimePlugin({
        pluginsDir,
        require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
      }),
    )

    const loaded = await loadUserPlugin(ctx, pluginDir, {
      require: (id) => {
        if (id === '@deepseek-ai/cordis') return cordis
        if (id === 'obsidian') return { ItemView: class {} }
        return undefined
      },
    })
    expect(loaded.manifest).toBeDefined()
    // 注册应全部生效
    expect(records.views).toContain('note-counter-view')
    expect(records.ribbons.length).toBeGreaterThan(0)
    expect(records.commands).toContain('note-counter:open-view')
  })
})
