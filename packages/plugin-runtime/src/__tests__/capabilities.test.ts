/**
 * 能力静态检测与命令前缀测试。
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import { detectCapabilities, loadUserPlugin } from '../index'

describe('detectCapabilities', () => {
  it('识别面板/图标/命令/工具/状态栏/设置/深链', () => {
    const code = `
      ctx.views.registerView('my-view', (leaf) => new MyView(leaf))
      ctx.ribbon.addRibbonIcon('hash', 't', () => {})
      ctx.commands.addCommand({ id: 'x', name: 'x' })
      ctx.toolsCompat.register({ name: 't', description: '', input: {}, execute() {} })
      ctx.statusbar.addStatusBarItem()
      ctx.settings.registerSettingTab(tab)
      ctx.protocol.register('open', (p) => p)
    `
    const d = detectCapabilities(code)
    expect(d.capabilities).toEqual(expect.arrayContaining(['panel', 'ribbon', 'commands', 'tools', 'statusbar', 'settings', 'protocol']))
    expect(d.viewType).toBe('my-view')
  })

  it('空代码无能力', () => {
    expect(detectCapabilities('')).toEqual({ capabilities: [], viewType: undefined })
  })

  it('常量声明的视图类型可解析（打包重命名场景）', () => {
    const code = `
      const VIEW_TYPE_NOTE_COUNTER = "note-counter-view"
      ctx.views.registerView(VIEW_TYPE_NOTE_COUNTER, (leaf) => new MyView(leaf))
    `
    const d = detectCapabilities(code)
    expect(d.capabilities).toContain('panel')
    expect(d.viewType).toBe('note-counter-view')
  })

  it('未知标识符不误报视图类型', () => {
    const code = `ctx.views.registerView(resolveType(), (leaf) => new MyView(leaf))`
    const d = detectCapabilities(code)
    expect(d.capabilities).toContain('panel')
    expect(d.viewType).toBeUndefined()
  })
})

describe('命令前缀强制', () => {
  it('用户插件命令自动带插件名前缀', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-cap-'))
    const dir = path.join(root, 'demo-plugin')
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dsh: { id: 'demo-plugin', version: '0.0.1', entry: 'main.js' } }),
    )
    await fs.promises.writeFile(
      path.join(dir, 'main.js'),
      [
        `const { Context } = require('@deepseek-ai/cordis')`,
        `module.exports = {`,
        `  inject: ['commands'],`,
        `  apply(ctx) {`,
        `    ctx.effect(() => [`,
        `      ctx.commands.addCommand({ id: 'hello', name: '打招呼' }),`,
        `      ctx.commands.addCommand({ id: 'demo-plugin:keep', name: '保留' }),`,
        `    ])`,
        `  },`,
        `}`,
      ].join('\n'),
    )

    const ctx = new Context()
    const registered: string[] = []
    ctx.reflect.provide('commands', {
      addCommand: (cmd: { id: string }) => {
        registered.push(cmd.id)
        return () => {} // 模仿 CommandsService：返回 disposer
      },
      removeCommand: () => {},
    })

    const loaded = await loadUserPlugin(ctx, dir, {
      require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
    })
    expect(registered).toEqual(['demo-plugin:hello', 'demo-plugin:keep'])
    await loaded.fiber.dispose()
  })

  it('用户插件协议动作自动携带插件 id（loader 注入）', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-cap-'))
    const dir = path.join(root, 'demo-plugin')
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dsh: { id: 'demo-plugin', version: '0.0.1', entry: 'main.js' } }),
    )
    await fs.promises.writeFile(
      path.join(dir, 'main.js'),
      [
        `const { Context } = require('@deepseek-ai/cordis')`,
        `module.exports = {`,
        `  inject: ['protocol'],`,
        `  apply(ctx) {`,
        `    ctx.effect(() => ctx.protocol.register('open', (p) => p))`,
        `  },`,
        `}`,
      ].join('\n'),
    )

    const ctx = new Context()
    const registered: Array<{ pluginId: string; action: string }> = []
    const disposers: Array<() => void> = []
    ctx.reflect.provide('protocol', {
      register: (pluginId: string, action: string) => {
        registered.push({ pluginId, action })
        disposers.push(() => {})
        return () => {}
      },
    })

    const loaded = await loadUserPlugin(ctx, dir, {
      require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
      hostId: 'harness-like',
    })
    // 子插件一元签名 register(action, handler) 被包裹为自动携带插件 id 的二元调用
    expect(registered).toEqual([{ pluginId: 'demo-plugin', action: 'open' }])
    expect(disposers.length).toBe(1)
    await loaded.fiber.dispose()
  })

  it('运行时捕获实际注册的视图类型（静态扫描常量漏检时仍可打开面板）', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dsh-cap-'))
    const dir = path.join(root, 'demo-plugin')
    await fs.promises.mkdir(dir, { recursive: true })
    // 产物用拼接表达式注册视图：静态扫描（字面量/常量声明）必然漏检 viewType
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dsh: { id: 'demo-plugin', version: '0.0.1', entry: 'main.js' } }),
    )
    await fs.promises.writeFile(
      path.join(dir, 'main.js'),
      [
        `module.exports = {`,
        `  inject: ['views'],`,
        `  apply(ctx) {`,
        `    ctx.effect(() => ctx.views.registerView(['runtime', 'view'].join('-'), () => ({})))`,
        `  },`,
        `}`,
      ].join('\n'),
    )

    const ctx = new Context()
    const unregistered: string[] = []
    ctx.reflect.provide('views', {
      registerView: (type: string) => {
        return () => unregistered.push(type)
      },
      openView: () => {},
    })

    const loaded = await loadUserPlugin(ctx, dir, {
      require: (id) => (id === '@deepseek-ai/cordis' ? cordis : undefined),
    })
    expect(loaded.viewTypes).toEqual(['runtime-view'])
    await loaded.fiber.dispose()
    expect(unregistered).toEqual(['runtime-view'])
  })
})
