/**
 * UI 服务测试（第三批）：ribbon / statusbar / 设置页注册。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { obsidianAdapterPlugin } from '@harness-like/obsidian-adapter'

function stubApi(overrides: Record<string, unknown> = {}) {
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
    commands: { addCommand: (c: { id: string; name: string }) => c, removeCommand: () => {} },
    viewRegistry: { registerView: () => {}, unregisterView: () => {}, openView: () => {} },
    ribbon: { addRibbonIcon: () => ({ remove: () => {} }) },
    statusbar: { addStatusBarItem: () => ({ el: {} as HTMLElement, remove: () => {} }) },
    settingsUi: { addSettingTab: () => {} },
    notice: { notice: () => {} },
    openTarget: async () => {},
    ...overrides,
  }
}

describe('UI 服务（ribbon/statusbar/settings）', () => {
  it('addRibbonIcon 返回 disposer 并调用 remove', async () => {
    const remove = vi.fn()
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi({ ribbon: { addRibbonIcon: vi.fn(() => ({ remove })) } })))
    const dispose = ctx.ribbon.addRibbonIcon('bot', '测试', () => {})
    dispose()
    expect(remove).toHaveBeenCalled()
  })

  it('addStatusBarItem 返回条目元素与移除', async () => {
    const remove = vi.fn()
    const el = { textContent: '' }
    const ctx = new Context()
    await ctx.plugin(
      obsidianAdapterPlugin(stubApi({ statusbar: { addStatusBarItem: vi.fn(() => ({ el, remove })) } })),
    )
    const item = ctx.statusbar.addStatusBarItem()
    expect(item.el).toBe(el)
    item.remove()
    expect(remove).toHaveBeenCalled()
  })

  it('registerSettingTab 委托宿主注册', async () => {
    const addSettingTab = vi.fn()
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi({ settingsUi: { addSettingTab } })))
    const tab = { display: () => {} }
    ctx.settings.registerSettingTab(tab)
    expect(addSettingTab).toHaveBeenCalledWith(tab)
  })
})

describe('命令卸载与 vault 别名（真实 Obsidian 行为）', () => {
  it('addCommand 返回 undefined 时，卸载仍按传入 id 移除命令', async () => {
    const removed: string[] = []
    const added: string[] = []
    const ctx = new Context()
    await ctx.plugin(
      obsidianAdapterPlugin(
        stubApi({
          commands: {
            // 对齐真实 Obsidian：app.commands.addCommand 返回 undefined
            addCommand: (c: { id: string }) => {
              added.push(c.id)
              return undefined as never
            },
            removeCommand: (id: string) => {
              removed.push(id)
            },
          },
        }),
      ),
    )
    const dispose = ctx.commands.addCommand({ id: 'test-plugin:cmd', name: '测试' })
    expect(added).toEqual(['test-plugin:cmd'])
    dispose()
    expect(removed).toEqual(['test-plugin:cmd'])
  })

  it('vault.getMarkdownPaths 别名与 listMarkdown 等价', async () => {
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi()))
    expect(ctx.vault.getMarkdownPaths()).toEqual([])
    expect(ctx.vault.listMarkdown()).toEqual([])
  })
})
