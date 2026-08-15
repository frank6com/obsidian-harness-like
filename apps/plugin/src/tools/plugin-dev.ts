/**
 * 插件创造模式工具集（第一批）：
 * - plugin_guide：插件开发指南（模板/API/流程，agent 需要时调用）
 * - create_plugin：创建插件骨架（目录 + package.json）
 * - write_plugin_file：写插件内文件（限制在插件目录内，防穿越）
 * - plugin_status：读取插件状态与加载错误（迭代诊断）
 * - reload_plugin：停止 + 重新加载（未授权时先走授权弹窗）
 *
 * 纯 JS 插件免编译即时生效（D7 附注路径）——agent 写 main.js 即可被加载。
 */

import * as path from 'path'
import type { Plugin } from '@deepseek-ai/cordis'
import type { PluginRecord } from '@harness-like/plugin-runtime'

export interface PluginDevToolsOptions {
  /** 授权确认（宿主弹窗）；返回是否已授权 */
  ensureGranted(pluginId: string, version: string, description?: string): Promise<boolean>
  /** 覆盖已有插件文件的确认（高风险操作拦截）；返回是否允许覆盖 */
  confirmOverwrite(pluginId: string, file: string): Promise<boolean>
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

export const PLUGIN_GUIDE = `# Harness Like 用户插件开发指南（纯 JS 路径）

插件位于 vault 的 .obsidian/dsh-plugins/<id>/ 目录，结构：

- package.json：声明插件元数据（dsh 字段必填）
- main.js：CJS 产物，module.exports 导出插件对象

package.json 模板：

{
  "name": "my-plugin",
  "version": "0.0.1",
  "description": "一句话描述",
  "dsh": { "id": "my-plugin", "version": "0.0.1", "entry": "main.js" }
}

main.js 最小模板（纯 JS，无需构建）：

const { Context } = require('@deepseek-ai/cordis')

module.exports = {
  name: 'my-plugin',
  inject: ['toolsCompat', 'commands', 'notice'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.toolsCompat.register({
        name: 'my_tool',
        description: '工具做什么',
        input: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
        execute(input) {
          return { ok: true, x: input.x }
        },
      }),
      ctx.commands.addCommand({
        id: 'my-plugin:hello',
        name: '示例命令',
        callback: () => ctx.notice.notice('你好'),
      }),
    ])
  },
}

可用服务（inject 声明）：toolsCompat（注册工具）、commands（注册命令）、views（注册/打开自定义面板）、
vault（读写笔记）、editor（当前编辑器）、workspace（活跃文件）、notice（通知）、ribbon（侧边栏图标）、
statusbar（状态栏）、settings（设置/设置页）、sandbox、approval、sessionLog、llmCaller。
可用事件（ctx.on）：dsh/session/event（会话事件）、vault/modify|create|delete|rename、
workspace/file-open、dsh/waiting-approval（审批弹窗打开）。

铁律（违反会导致报错或错误实现）：
1. inject 必须声明 apply 里用到的【每一个】服务——漏一个访问就报
   "cannot get property X without inject"。
2. 禁止直接操作 Obsidian DOM（document.querySelector('.workspace-ribbon') 等内部类名），
   一律通过 ctx.* 服务：侧边栏图标用 ctx.ribbon.addRibbonIcon，状态栏用 ctx.statusbar。
3. 所有注册必须包进 ctx.effect(() => [disposer1, disposer2])，插件停止时自动撤销。

带界面的插件（自定义面板：注册视图 + 命令打开，构建需 --external:obsidian）：

const { ItemView } = require('obsidian')

class MyView extends ItemView {
  getViewType() { return 'my-view' }
  getDisplayText() { return '我的面板' }
  getIcon() { return 'pencil' }
  onOpen() {
    this.contentEl.createEl('h3', { text: '你好，dsh！' })
  }
}

module.exports = {
  name: 'my-plugin',
  inject: ['views', 'commands', 'ribbon', 'notice'],   // ← 用到谁就声明谁
  apply(ctx) {
    ctx.effect(() => [
      ctx.views.registerView('my-view', (leaf) => new MyView(leaf)),
      ctx.commands.addCommand({
        id: 'my-plugin:open-view',
        name: '打开我的面板',
        callback: () => ctx.views.open('my-view'),
      }),
      ctx.ribbon.addRibbonIcon('pencil', '打开我的面板', () => ctx.views.open('my-view')),
    ])
  },
}

更多 UI 能力（与 Obsidian 原生插件对齐）：
- 底部状态栏：const item = ctx.statusbar.addStatusBarItem(); item.el.setText('...')（disposer = item.remove）
- 设置页：ctx.settings.registerSettingTab(new (require('obsidian').PluginSettingTab)(...))——需在设置 Tab 的 display() 里渲染

注意：
- 工具 execute 返回 JSON 可序列化对象。
- 修改 main.js 后调用 reload_plugin 生效；运行中插件重载需用户确认授权。
- 插件构建命令把 obsidian 也 external：esbuild src/main.js --bundle --external:@deepseek-ai/cordis --external:obsidian --format=cjs --outfile=main.js`

export function pluginDevToolsPlugin(options: PluginDevToolsOptions): Plugin.Object {
  return {
    name: 'plugin-dev-tools',
    inject: ['vault', 'sandbox', 'toolsCompat', 'pluginRuntime', 'approval', 'notice', 'views'],
    apply(ctx) {
      const pluginsDir = ctx.sandbox.scope.pluginsDir
      /** vault API 一律用 vault 相对路径（绝对路径会破坏 Obsidian 路径语义） */
      const pluginsDirRel = path.posix.join('.obsidian', 'dsh-plugins')

      ctx.toolsCompat.register({
        name: 'plugin_guide',
        description: '获取 Harness Like 用户插件开发指南（模板代码、API、流程）',
        input: { type: 'object', properties: {} },
        execute() {
          return { guide: PLUGIN_GUIDE }
        },
      })

      ctx.toolsCompat.register({
        name: 'create_plugin',
        description: '创建 Harness Like 用户插件骨架：建目录并写 package.json（纯 JS 插件随后用 write_plugin_file 写 main.js）',
        input: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '插件 id（小写字母数字，可含 - _，最长 64）' },
            description: { type: 'string', description: '一句话描述' },
          },
          required: ['id'],
        },
        async execute(input) {
          const id = String(input.id ?? '').trim()
          if (!PLUGIN_ID_RE.test(id)) throw new Error(`插件 id 非法: ${id}（需匹配 ${PLUGIN_ID_RE}）`)
          const relDir = path.posix.join(pluginsDirRel, id)
          ctx.sandbox.assertWrite(relDir)
          const existing = await fileExists(ctx, path.posix.join(relDir, 'package.json'))
          if (existing) throw new Error(`插件已存在: ${id}（目录: ${path.join(pluginsDir, id)}）`)
          await ctx.vault.createFolder(relDir)
          const pkg = {
            name: id,
            version: '0.0.1',
            description: String(input.description ?? ''),
            dsh: { id, version: '0.0.1', entry: 'main.js' },
          }
          await ctx.vault.write(path.posix.join(relDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
          return {
            ok: true,
            plugin_id: id,
            dir: path.join(pluginsDir, id),
            next: '用 write_plugin_file 写 main.js（纯 JS，模板见 plugin_guide），然后用 reload_plugin 加载生效',
          }
        },
      })

      ctx.toolsCompat.register({
        name: 'write_plugin_file',
        description: '写入插件目录内的文件（覆盖已存在文件需用户确认；读取文件请用 read_note，勿用本工具）',
        input: {
          type: 'object',
          properties: {
            plugin_id: { type: 'string', description: '插件 id' },
            file: { type: 'string', description: '相对插件目录的文件路径，如 main.js' },
            content: { type: 'string', description: '文件完整内容' },
          },
          required: ['plugin_id', 'file', 'content'],
        },
        async execute(input) {
          const pluginId = String(input.plugin_id ?? '')
          const rel = normalizePluginRel(String(input.file ?? ''))
          if (!rel) throw new Error(`文件路径非法: ${input.file}`)
          const vaultRel = path.posix.join(pluginsDirRel, pluginId, rel)
          ctx.sandbox.assertWrite(vaultRel)
          // 高风险拦截：覆盖已存在文件需用户确认
          const exists = await fileExists(ctx, vaultRel)
          if (exists) {
            const allow = await options.confirmOverwrite(pluginId, rel)
            if (!allow) return { ok: false, reason: '用户拒绝覆盖，文件未修改' }
          }
          // 子目录先建（write 要求父目录存在）
          const parent = path.posix.dirname(rel)
          if (parent !== '.') {
            await ctx.vault.createFolder(path.posix.join(pluginsDirRel, pluginId, parent))
          }
          await ctx.vault.write(vaultRel, String(input.content ?? ''))
          return { ok: true, path: vaultRel }
        },
      })

      ctx.toolsCompat.register({
        name: 'plugin_status',
        description: '列出用户插件及其状态/版本/加载错误（未加载插件也可查询）',
        input: {
          type: 'object',
          properties: { plugin_id: { type: 'string', description: '可选：只查一个插件' } },
        },
        async execute(input) {
          const wanted = input.plugin_id ? String(input.plugin_id) : undefined
          const ids = await ctx.pluginRuntime.discover()
          const rows: Array<{ id: string; version?: string; status: string; error?: string }> = []
          for (const id of ids) {
            if (wanted && id !== wanted) continue
            const rec: PluginRecord | undefined = ctx.pluginRuntime.get(id)
            const info = rec ?? ctx.pluginRuntime.inspect(id)
            rows.push(
              JSON.parse(
                JSON.stringify({
                  id,
                  version: info.manifest?.version,
                  status: info.status,
                  error: info.error,
                }),
              ),
            )
          }
          return { count: rows.length, plugins: rows }
        },
      })

      ctx.toolsCompat.register({
        name: 'open_view',
        description: '打开（或聚焦）一个已注册类型的自定义面板视图（插件注册的 ItemView）',
        input: {
          type: 'object',
          properties: { type: { type: 'string', description: '视图类型，如 note-count-view' } },
          required: ['type'],
        },
        execute(input) {
          ctx.views.open(String(input.type ?? ''))
          return { ok: true, type: String(input.type ?? '') }
        },
      })

      ctx.toolsCompat.register({
        name: 'reload_plugin',
        description: '停止并重新加载一个用户插件（未授权时先请求用户授权；返回加载结果与错误）',
        input: {
          type: 'object',
          properties: { plugin_id: { type: 'string', description: '插件 id' } },
          required: ['plugin_id'],
        },
        async execute(input) {
          const id = String(input.plugin_id ?? '')
          const inspected = ctx.pluginRuntime.inspect(id)
          if (inspected.status === 'error') {
            throw new Error(`无法读取插件 ${id}: ${inspected.error ?? '未知错误'}`)
          }
          const manifest = inspected.manifest!
          const granted = await options.ensureGranted(id, manifest.version, manifest.description)
          if (!granted) return { ok: false, reason: '用户未授权，插件未加载' }
          await ctx.pluginRuntime.stop(id)
          const result = await ctx.pluginRuntime.load(id)
          return JSON.parse(
            JSON.stringify({
              ok: result.status === 'running',
              plugin_id: id,
              status: result.status,
              error: result.error,
            }),
          )
        },
      })
    },
  }
}

/** 规范化插件内相对路径：拒绝绝对路径与穿越（..），返回 posix 相对路径 */
function normalizePluginRel(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = normalized.split('/')
  if (parts.some((p) => p === '..' || p === '')) return ''
  return parts.join('/')
}

async function fileExists(ctx: { vault: { read(p: string): Promise<string> } }, rel: string): Promise<boolean> {
  try {
    await ctx.vault.read(rel)
    return true
  } catch {
    return false
  }
}
