/**
 * 命令前缀强制（API 层，plugin-runtime 的 ctx.commands 包装）：
 * 配置主插件后，命令统一以主插件为起始——
 * - id：`<主插件id>:<插件id>:<命令>`（如 harness-like:note-counter:open-view）
 * - 显示名：`<主插件名>: <命令名>（<插件id>）`（如 Harness Like: 打开面板（note-counter））
 * 无前缀自动补、已带任意旧格式前缀剥离去重；未配置主插件时回退 `<插件id>:` 前缀。
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

async function makePlugin(root: string, js: string): Promise<string> {
  const dir = path.join(root, '.obsidian', 'harness-like-plugins', 'prefix-test')
  await fs.promises.mkdir(dir, { recursive: true })
  await fs.promises.writeFile(path.join(dir, 'main.js'), js)
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

/** 插件按旧约定写 id/名称（带或不带子插件前缀） */
const JS_LEGACY = `
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

/** 插件按新约定（主插件起始）写 id/名称，混入旧格式命令 */
const JS_MIXED = `
module.exports = {
  name: 'prefix-test',
  inject: ['commands'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.commands.addCommand({ id: 'harness-like:prefix-test:plain', name: 'Harness Like: Plain Cmd（prefix-test）', callback() {} }),
      ctx.commands.addCommand({ id: 'harness-like:prefix-test:already', name: 'Harness Like: Already（prefix-test）', callback() {} }),
      ctx.commands.addCommand({ id: 'prefix-test:legacy', name: 'prefix-test: Legacy', callback() {} }),
    ])
  },
}
`

describe('命令前缀强制（ctx.commands API 层）', () => {
  it('未配置主插件：回退 <插件id>: 前缀（无前缀补、已带前缀去重、名称带来源）', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-prefix-'))
    const pluginDir = await makePlugin(root, JS_LEGACY)
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

  it('配置主插件：id 统一 <主插件id>:<插件id>:，显示名统一 <主插件名>: <名>（<插件id>）', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-prefix-'))
    const pluginDir = await makePlugin(root, JS_MIXED)
    const records = { commands: [] as Array<{ id: string; name?: string }> }
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi(records)))
    await loadUserPlugin(ctx, pluginDir, {
      require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
      hostId: 'harness-like',
      hostName: 'Harness Like',
    })
    expect(records.commands).toEqual([
      { id: 'harness-like:prefix-test:plain', name: 'Harness Like: Plain Cmd（prefix-test）' },
      { id: 'harness-like:prefix-test:already', name: 'Harness Like: Already（prefix-test）' },
      { id: 'harness-like:prefix-test:legacy', name: 'Harness Like: Legacy（prefix-test）' },
    ])
  })
})
