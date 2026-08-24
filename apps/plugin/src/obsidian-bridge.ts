/**
 * obsidian-bridge：把真实的 Obsidian App 适配为 ObsidianApiLike。
 * 这是唯一接触 obsidian 运行时 API 的桥接层（适配包保持结构化）。
 *
 * 注：obsidian@1.13 类型面已不再公开 app.commands / app.viewRegistry，
 * 运行时仍然存在，此处以最小结构断言访问。
 */

import { App, Notice, Plugin, TFile, type EventRef, type WorkspaceLeaf } from 'obsidian'
import type { CommandsLike, ObsidianApiLike, ViewRegistryLike } from '@harness-like/obsidian-adapter'

/** esbuild bundle 内可见的宿主 require（解析 node 内置模块 / electron / obsidian） */
declare function require(id: string): unknown

interface AppLike {
  commands: CommandsLike
  viewRegistry: ViewRegistryLike
}

export function toApiLike(app: App, plugin?: Plugin): ObsidianApiLike {
  const appLike = app as unknown as AppLike
  const cmdApi = appLike.commands
  const viewApi = appLike.viewRegistry

  return {
    vault: {
      async read(path) {
        const file = app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) return app.vault.read(file)
        return app.vault.adapter.read(path)
      },
      async write(path, content) {
        const file = app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) {
          await app.vault.modify(file, content)
          return
        }
        // 缓存没有：查磁盘（Obsidian 缓存可能滞后于磁盘，如刚由插件写入）
        const stat = await app.vault.adapter.stat(path).catch(() => null)
        if (stat) {
          // 磁盘已存在但缓存未知：直接写盘绕开 vault.create 的缓存检查
          await app.vault.adapter.write(path, content)
          return
        }
        // 真新文件：需要父目录已存在（P0 限制，文档说明）
        await app.vault.create(path, content)
      },
      async create(path, content) {
        await app.vault.create(path, content)
      },
      async createFolder(path) {
        // Obsidian createFolder 一次只建一层且父目录必须存在：逐层创建，已存在则忽略
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          if (app.vault.getAbstractFileByPath(current)) continue
          try {
            await app.vault.createFolder(current)
          } catch {
            // 并发创建竞态：已存在则跳过
          }
        }
      },
      async delete(path) {
        // 注：FileManager.trashFile 需 1.6.6（> minAppVersion 1.5.0），此处维持 vault.delete
        const file = app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) await app.vault.delete(file)
      },
      async rename(oldPath, newPath) {
        const file = app.vault.getAbstractFileByPath(oldPath)
        if (file instanceof TFile) await app.vault.rename(file, newPath)
      },
      getMarkdownPaths() {
        return app.vault.getMarkdownFiles().map((f) => f.path)
      },
      on(event, cb) {
        const ref = (app.vault.on as (
          ev: string,
          listener: (file: { path: string }, oldPath?: unknown) => void,
        ) => EventRef)(event, (file, oldPath) => {
          cb(file.path, typeof oldPath === 'string' ? oldPath : undefined)
        })
        return { unref: () => app.vault.offref(ref) }
      },
    },
    workspace: {
      getActiveFile() {
        return app.workspace.getActiveFile()?.path ?? null
      },
      getLeavesOfType(type) {
        return app.workspace.getLeavesOfType(type)
      },
      onFileOpen(cb) {
        const ref = app.workspace.on('file-open', (file) => {
          if (file) cb(file.path)
        })
        return { unref: () => app.workspace.offref(ref) }
      },
    },
    commands: {
      addCommand(cmd) {
        return cmdApi.addCommand(cmd)
      },
      removeCommand(id) {
        cmdApi.removeCommand(id)
      },
      executeCommandById(id) {
        cmdApi.executeCommandById?.(id)
      },
    },
    viewRegistry: {
      registerView(type, creator) {
        viewApi.registerView(type, creator)
      },
      unregisterView(type) {
        viewApi.unregisterView(type)
      },
      openView(type) {
        const leaves = app.workspace.getLeavesOfType(type)
        let leaf: WorkspaceLeaf | undefined | null = leaves[0]
        if (!leaf) {
          leaf = app.workspace.getRightLeaf(false)
          if (!leaf) return
          void leaf.setViewState({ type, active: true })
        }
        app.workspace.setActiveLeaf(leaf)
      },
    },
    ribbon: {
      addRibbonIcon(icon, title, callback) {
        // 正确 API 是 plugin.addRibbonIcon（workspace 上没有）；返回元素，disposer 移除
        if (!plugin) throw new Error('ribbon 服务需要宿主插件实例')
        const el = plugin.addRibbonIcon(icon, title, callback)
        return { remove: () => el.remove() }
      },
    },
    statusbar: {
      addStatusBarItem() {
        // 正确 API 是 plugin.addStatusBarItem（workspace 上没有）
        if (!plugin) throw new Error('statusbar 服务需要宿主插件实例')
        const el = plugin.addStatusBarItem()
        return { el, remove: () => el.remove() }
      },
    },
    settingsUi: {
      addSettingTab(tab) {
        // app.addSettingTab 在 1.13 类型面外，运行时存在
        if (plugin) {
          const appLike = app as unknown as { addSettingTab(p: Plugin, t: unknown): void }
          appLike.addSettingTab(plugin, tab)
        }
      },
    },
    notice: {
      notice(message, timeout) {
        new Notice(message, timeout)
      },
    },
    protocol: {
      registerObsidianProtocolHandler(action, handler) {
        // 唯一入口：宿主 Plugin 实例的 registerObsidianProtocolHandler（随宿主 unload 由 Obsidian 清理）
        if (!plugin) throw new Error('protocol 服务需要宿主插件实例')
        plugin.registerObsidianProtocolHandler(action, handler)
      },
    },
    codeBlockProcessor: {
      registerProcessor(language, handler) {
        // 懒注册入口：宿主 Plugin 实例的 registerMarkdownCodeBlockProcessor
        // （单个语言无公开注销 API——子插件卸载只删路由表，宿主 unload 时 Obsidian 统一清理）
        if (!plugin) throw new Error('codeBlockProcessor 服务需要宿主插件实例')
        plugin.registerMarkdownCodeBlockProcessor(language, (source, el, ctx) => handler(source, el, ctx))
      },
    },
    openTarget: async (target) => {
      const { shell } = require('electron') as {
        shell: {
          openExternal(url: string): Promise<void>
          openPath(path: string): Promise<string>
        }
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        await shell.openExternal(target)
      } else {
        const error = await shell.openPath(target)
        if (error) throw new Error(`打开失败: ${error}`)
      }
    },
  }
}
