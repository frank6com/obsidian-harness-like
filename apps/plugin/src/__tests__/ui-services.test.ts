// @vitest-environment jsdom

/**
 * UI 服务测试（第三批）：ribbon / statusbar / 设置页注册。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { obsidianAdapterPlugin } from '@harness-like/obsidian-adapter'
import { userSettingsTabPlugin } from '../user-settings-tab'

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
    workspace: { getActiveFile: () => null, onFileOpen: () => ({ unref: () => {} }), getLeavesOfType: () => [] },
    commands: { addCommand: (c: { id: string; name: string }) => c, removeCommand: () => {}, executeCommandById: () => {} },
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

describe('视图卸载容错（dispose 链不中断）', () => {
  it('卸载视图：先 detach 打开的 leaf；unregisterView 抛错被吞，不影响后续 disposer', async () => {
    const detach = vi.fn()
    const unregisterView = vi.fn(() => {
      throw new Error('view type in use')
    })
    const ctx = new Context()
    await ctx.plugin(
      obsidianAdapterPlugin(
        stubApi({
          workspace: {
            getActiveFile: () => null,
            onFileOpen: () => ({ unref: () => {} }),
            getLeavesOfType: () => [{ detach }],
          },
          viewRegistry: { registerView: () => {}, unregisterView, openView: () => {} },
        }),
      ),
    )
    const dispose = ctx.views.registerView('my-view', () => {})
    expect(() => dispose()).not.toThrow()
    expect(detach).toHaveBeenCalled()
    expect(unregisterView).toHaveBeenCalled()
  })
})

describe('commands.execute + 用户插件设置页（0.33.0）', () => {
  it('ctx.commands.execute(id) 调用 executeCommandById（可执行核心插件命令）', async () => {
    const exec = vi.fn()
    const ctx = new Context()
    await ctx.plugin(obsidianAdapterPlugin(stubApi({ commands: { addCommand: (c: unknown) => c, removeCommand: () => {}, executeCommandById: exec } })))
    ctx.commands.execute('templates:insert-template')
    expect(exec).toHaveBeenCalledWith('templates:insert-template')
  })

  it('ctx.settingsTab.register 创建真实设置页并随卸载移除', async () => {
    const added: unknown[] = []
    const removed: unknown[] = []
    const plugin = {
      manifest: { id: 'harness-like' },
      addSettingTab: (t: unknown) => added.push(t),
      removeSettingTab: (t: unknown) => removed.push(t),
    }
    const ctx = new Context()
    await ctx.plugin(userSettingsTabPlugin({} as never, plugin as never))

    const render = vi.fn()
    const dispose = ctx.settingsTab.register({ id: 'demo-settings', name: 'Demo', render })
    expect(added.length).toBe(1)
    // 触发 display()：渲染回调应收到容器
    const tab = added[0] as { display(): void; containerEl: HTMLElement }
    tab.containerEl = document.createElement('div')
    ;(tab.containerEl as unknown as { empty(): void }).empty = () => {}
    tab.display()
    expect(render).toHaveBeenCalledWith(tab.containerEl)

    dispose()
    expect(removed.length).toBe(1)
    // 重复 dispose 幂等
    dispose()
    expect(removed.length).toBe(1)
  })

  it('ctx.settingsTab.register 重复 id 抛错', async () => {
    const plugin = { addSettingTab: () => {}, removeSettingTab: () => {} }
    const ctx = new Context()
    await ctx.plugin(userSettingsTabPlugin({} as never, plugin as never))
    ctx.settingsTab.register({ id: 'dup', name: 'A', render: () => {} })
    expect(() => ctx.settingsTab.register({ id: 'dup', name: 'B', render: () => {} })).toThrow()
  })
})
