/**
 * 用户插件设置页注册服务（ctx.settingsTab）：
 * 用户插件通过 inject: ['settingsTab'] + register({ id, name, render }) 注册自己的设置页，
 * 宿主为其创建真实的 PluginSettingTab（随插件卸载自动移除）。
 */

import { PluginSettingTab, type App, type Plugin } from 'obsidian'
import type { Context, Plugin as CordisPlugin } from '@deepseek-ai/cordis'

export interface UserSettingsTabDesc {
  /** 唯一 id（如 "my-plugin-settings"） */
  id: string
  /** 设置页名称（显示在设置列表） */
  name: string
  /** 渲染函数：在传入的容器中构建设置界面（可用 Obsidian 的 Setting 组件） */
  render(containerEl: HTMLElement): void
}

export interface SettingsTabFacade {
  register(desc: UserSettingsTabDesc): () => void
}

class UserPluginSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private desc: UserSettingsTabDesc,
  ) {
    super(app, plugin)
  }

  // 注意：display() 在 obsidian 1.13 类型面已标 deprecated（改推荐 getSettingDefinitions），
  // 但仍在 SettingTab 基类声明且运行时照常调用，故保留 override
  override display(): void {
    this.containerEl.empty()
    this.desc.render(this.containerEl)
  }

  // getDisplayText 不在 1.13 类型面（运行时存在），定义为普通方法
  getDisplayText(): string {
    return this.desc.name
  }
}

/** removeSettingTab 不在 obsidian 1.13 类型面（运行时存在），结构断言访问 */
function removeTab(plugin: Plugin, tab: PluginSettingTab): void {
  ;(plugin as unknown as { removeSettingTab?(t: PluginSettingTab): void }).removeSettingTab?.(tab)
}

export function userSettingsTabPlugin(app: App, plugin: Plugin): CordisPlugin.Object {
  return {
    name: 'user-settings-tabs',
    apply(ctx: Context) {
      const tabs = new Map<string, UserPluginSettingTab>()
      ctx.reflect.provide('settingsTab', {
        register(desc: UserSettingsTabDesc): () => void {
          if (tabs.has(desc.id)) throw new Error(`设置页已注册: ${desc.id}`)
          const tab = new UserPluginSettingTab(app, plugin, desc)
          tabs.set(desc.id, tab)
          try {
            plugin.addSettingTab(tab)
          } catch (err) {
            tabs.delete(desc.id)
            throw err
          }
          return () => {
            if (!tabs.has(desc.id)) return
            tabs.delete(desc.id)
            try {
              removeTab(plugin, tab)
            } catch (err) {
              console.warn('[harness-like] 设置页卸载失败（忽略）:', err)
            }
          }
        },
      } satisfies SettingsTabFacade)
      // 宿主卸载时清理全部（防御：插件停止未正确 dispose 的场景）
      ctx.effect(() => () => {
        for (const tab of tabs.values()) {
          try {
            removeTab(plugin, tab)
          } catch {
            // 忽略卸载期异常
          }
        }
        tabs.clear()
      })
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 用户插件设置页注册（随插件卸载自动移除） */
    settingsTab: SettingsTabFacade
  }
}
