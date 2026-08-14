/**
 * obsidian-bridge：把真实的 Obsidian App 适配为 ObsidianApiLike。
 * 这是唯一接触 obsidian 运行时 API 的桥接层（适配包保持结构化）。
 *
 * 注：obsidian@1.13 类型面已不再公开 app.commands / app.viewRegistry，
 * 运行时仍然存在，此处以最小结构断言访问。
 */

import { App, Notice, TFile, type EventRef } from 'obsidian'
import type { CommandsLike, ObsidianApiLike, ViewRegistryLike } from '@dsh-obsidian/obsidian-adapter'

/** esbuild bundle 内可见的宿主 require（解析 node 内置模块 / electron / obsidian） */
declare function require(id: string): unknown

interface AppLike {
  commands: CommandsLike
  viewRegistry: ViewRegistryLike
}

export function toApiLike(app: App): ObsidianApiLike {
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
        // 新文件：需要父目录已存在（P0 限制，文档说明）
        await app.vault.create(path, content)
      },
      async create(path, content) {
        await app.vault.create(path, content)
      },
      async delete(path) {
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
    },
    viewRegistry: {
      registerView(type, creator) {
        viewApi.registerView(type, creator)
      },
      unregisterView(type) {
        viewApi.unregisterView(type)
      },
    },
    notice: {
      notice(message, timeout) {
        new Notice(message, timeout)
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
