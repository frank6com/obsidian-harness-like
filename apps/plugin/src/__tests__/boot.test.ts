/**
 * 启动装配回归测试：模拟主插件 onload 的 Cordis 装配（含 stub Obsidian API）。
 * 防止"单服务可用但整体装配抛错"的回归（如 Stage 2 llm 接入时插件加载失败）。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import { harnessServicesPlugin } from '@harness-like/harness-base'
import { obsidianAdapterPlugin, type ObsidianApiLike } from '@harness-like/obsidian-adapter'
import { runtimePlugin } from '@harness-like/plugin-runtime'
import { builtinToolsPlugin } from '../tools/builtin'

function stubApi(): ObsidianApiLike {
  return {
    vault: {
      read: async (p: string) => `内容(${p})`,
      write: async () => {},
      create: async () => {},
      createFolder: async () => {},
      delete: async () => {},
      rename: async () => {},
      getMarkdownPaths: () => ['Inbox/a.md'],
      on: () => ({ unref: () => {} }),
    },
    workspace: {
      getActiveFile: () => null,
      onFileOpen: () => ({ unref: () => {} }),
      getLeavesOfType: () => [],
    },
    commands: {
      addCommand: (cmd) => cmd,
      removeCommand: () => {}, executeCommandById: () => {},
    },
    viewRegistry: {
      registerView: () => {},
      unregisterView: () => {},
      openView: () => {},
    },
    ribbon: {
      addRibbonIcon: () => ({ remove: () => {} }),
    },
    statusbar: {
      addStatusBarItem: () => ({ el: {} as HTMLElement, remove: () => {} }),
    },
    settingsUi: {
      addSettingTab: () => {},
    },
    notice: { notice: () => {} },
    protocol: { registerObsidianProtocolHandler: () => {} },
    codeBlockProcessor: { registerProcessor: () => {} },
    openTarget: async () => {},
  }
}

async function bootHarness() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-boot-'))
  const dataDir = path.join(root, '.obsidian', 'dsh')
  const ctx = new Context()
  const fibers = [
    ctx.plugin(obsidianAdapterPlugin(stubApi())),
    ctx.plugin(
      harnessServicesPlugin({
        sandbox: {
          vaultRoot: root,
          dataDir,
          configDir: '.obsidian',
          pluginsDir: path.join(root, '.obsidian', 'harness-like-plugins'),
          tempDir: path.join(dataDir, 'tmp'),
        },
        sessionDir: path.join(dataDir, 'sessions'),
        approvalStore: { load: () => ({}), save: () => {} },
        getLLMConfig: () => ({
          baseURL: 'https://api.deepseek.com',
          apiKey: 'k',
          model: 'deepseek-chat',
        }),
        providerIds: ['deepseek'],
        defaultProvider: () => 'deepseek',
        defaultModel: () => 'deepseek-chat',
      }),
    ),
    ctx.plugin(runtimePlugin({ pluginsDir: path.join(root, '.obsidian', 'harness-like-plugins'), require: () => undefined })),
    ctx.plugin(
      builtinToolsPlugin({
        openTarget: async () => {},
        confirmCommand: async () => true,
      }),
    ),
  ]
  await Promise.all(fibers)
  return ctx
}

describe('harness 装配启动', () => {
  it('完整组合（adapter+harness+runtime+内置工具）可装配且服务齐全', async () => {
    const ctx = await bootHarness()
    expect(ctx.get('sandbox')).toBeDefined()
    expect(ctx.get('approval')).toBeDefined()
    expect(ctx.get('sessionLog')).toBeDefined()
    expect(ctx.get('toolsCompat')).toBeDefined()
    expect(ctx.get('llmCaller')).toBeDefined()
    expect(ctx.get('llm')).toBeDefined()
    expect(ctx.get('vault')).toBeDefined()
    expect(ctx.get('pluginRuntime')).toBeDefined()
    // 内置工具已注册
    expect(ctx.get('toolsCompat')?.get('read_note')).toBeDefined()
    expect(ctx.get('toolsCompat')?.get('list_notes')).toBeDefined()
  })

  it('llmCaller 无 key 时给出明确诊断而非崩溃', async () => {
    const ctx = await bootHarness()
    const caller = ctx.get('llmCaller') as { call(o: unknown): Promise<unknown> }
    await expect(caller.call({ messages: [], tools: [] })).rejects.toThrow()
  })
})
