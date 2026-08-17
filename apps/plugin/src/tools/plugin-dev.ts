/**
 * 插件创造模式工具集（第一批）：
 * - plugin_guide：插件开发指南（模板/API/流程，agent 需要时调用）
 * - create_plugin：创建插件骨架（目录 + package.json）
 * - write_plugin_file：写插件内文件（限制在插件目录内，防穿越；覆盖前自动备份）
 * - plugin_status：读取插件状态与加载错误（迭代诊断）
 * - reload_plugin：停止 + 重新加载（未授权时先走授权弹窗）
 * - plugin_history：查看插件历史版本备份（每次 AI 覆盖写入前自动留存）
 * - plugin_rollback：回退插件到历史版本（执行前自动备份当前状态，可撤销）
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
  /** 回退插件版本的确认（用户拍板，agent 不可自行回退）；返回是否允许 */
  confirmRestore(pluginId: string, backupTime: string): Promise<boolean>
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

export const PLUGIN_GUIDE = `# Harness Like 用户插件开发指南（纯 JS 路径）

插件位于 vault 的 .obsidian/harness-like-plugins/<id>/ 目录，结构：

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
statusbar（状态栏）、settings（设置/设置页）、sandbox、approval、sessionLog、llmCaller、
dshI18n（覆盖主插件界面文案，翻译插件用）。

服务方法速查（务必按此签名调用，不要臆测方法名）：
- ctx.vault：getMarkdownPaths() -> string[]（vault 相对路径列表）；read(path) -> string；write(path, content)；
  create(path, content)；createFolder(path)（逐层创建）；delete(path)；rename(oldPath, newPath)；
  on(ev, cb)（ev: vault/modify|create|delete|rename，cb(path, oldPath?)）
- ctx.views：registerView(type, (leaf) => view)；open(type)
- ctx.commands：addCommand({ id, name, callback })（id/名称自动带主插件前缀，无需手写）；execute(id)（执行任意已注册命令，含 Obsidian 核心插件命令如 templates:insert-template）
- ctx.ribbon：addRibbonIcon(icon, title, callback) -> { remove }
- ctx.statusbar：addStatusBarItem() -> { el, remove }
- ctx.settingsTab：register({ id, name, render(containerEl) })（注册自己的设置页；render 里可用 Obsidian 的 Setting 组件）
- ctx.notice：notice(message, timeoutMs?)
- ctx.workspace：getActiveFile() -> string | null；onFileOpen(cb)
- ctx.editor：getSelection()、insertText(text)、replaceSelection(text)；无活动编辑器时方法返回 null
- ctx.toolsCompat：register({ name, description, input, execute })（execute 返回 JSON 可序列化对象）

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

翻译插件（覆盖主插件界面文案，键级覆盖 zh/en，插件停止自动还原）：

module.exports = {
  name: 'my-translation',
  inject: ['dshI18n'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.dshI18n.registerLocale('en', {
        'chat.send': 'Send it!',
        'chat.header.newSession': '＋ New Conversation',
        // ...按需覆盖任意文案 key；不写 key 则保持主插件原文
      }),
    ])
  },
}

注意：
- 工具 execute 返回 JSON 可序列化对象。
- ctx.commands.addCommand 注册的命令自动归一化命名：id 为 \`<主插件id>:<插件id>:<命令>\`，
  显示名为 \`<主插件名>: <命令名>（<插件id>）\`（如 Harness Like: 打开面板（my-plugin）），
  命令面板按主插件名即可找到全部功能；id 无需手写前缀，写了也会被归一化去重。
- 修改 main.js 后调用 reload_plugin 生效；运行中插件重载需用户确认授权。
- 插件构建命令把 obsidian 也 external：esbuild src/main.js --bundle --external:@deepseek-ai/cordis --external:obsidian --format=cjs --outfile=main.js`

export function pluginDevToolsPlugin(options: PluginDevToolsOptions): Plugin.Object {
  return {
    name: 'plugin-dev-tools',
    inject: ['vault', 'sandbox', 'toolsCompat', 'pluginRuntime', 'approval', 'notice', 'views'],
    apply(ctx) {
      const pluginsDir = ctx.sandbox.scope.pluginsDir
      /** vault API 一律用 vault 相对路径（绝对路径会破坏 Obsidian 路径语义） */
      const pluginsDirRel = path.posix.join(ctx.sandbox.scope.configDir, 'harness-like-plugins')

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
            // 覆盖前自动备份整个插件目录（AI 迭代的安全网，可回退）
            await ctx.pluginBackups.snapshot(path.join(ctx.sandbox.scope.pluginsDir, pluginId), pluginId, 'overwrite')
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

      ctx.toolsCompat.register({
        name: 'plugin_history',
        description: '列出插件的历史版本备份（每次 AI 覆盖写入前自动留存；含时间/原因/文件数；配合 plugin_rollback 回退）',
        input: {
          type: 'object',
          properties: { plugin_id: { type: 'string', description: '插件 id' } },
          required: ['plugin_id'],
        },
        async execute(input) {
          const id = String(input.plugin_id ?? '')
          const backups = await ctx.pluginBackups.list(id)
          return {
            plugin_id: id,
            count: backups.length,
            backups: backups.map((b) => ({
              backup_id: b.id,
              time: new Date(b.time).toLocaleString(),
              reason: b.reason,
              file_count: b.fileCount,
              bytes: b.bytes,
            })),
          }
        },
      })

      ctx.toolsCompat.register({
        name: 'plugin_rollback',
        description: '把插件文件回退到某个历史备份（默认最新一份；执行前自动备份当前状态，因此回退本身也可撤销；回退后重新加载生效）。高风险操作，会请求用户确认',
        input: {
          type: 'object',
          properties: {
            plugin_id: { type: 'string', description: '插件 id' },
            backup_id: { type: 'string', description: '可选：plugin_history 返回的 backup_id；缺省用最新一份' },
          },
          required: ['plugin_id'],
        },
        async execute(input) {
          const id = String(input.plugin_id ?? '')
          let backupId = input.backup_id ? String(input.backup_id) : undefined
          if (!backupId) {
            const latest = await ctx.pluginBackups.latest(id)
            if (!latest) throw new Error(`插件 ${id} 没有任何历史备份`)
            backupId = latest.id
          }
          const meta = (await ctx.pluginBackups.list(id)).find((b) => b.id === backupId)
          if (!meta) throw new Error(`备份不存在: ${backupId}`)
          // 用户拍板：回退不可由 AI 自行决定
          const allow = await options.confirmRestore(id, new Date(meta.time).toLocaleString())
          if (!allow) return { ok: false, reason: '用户拒绝回退' }
          const pluginDir = path.join(ctx.sandbox.scope.pluginsDir, id)
          // 回退前先备份当前状态（可撤销回退）
          await ctx.pluginBackups.snapshot(pluginDir, id, 'rollback')
          await ctx.pluginBackups.restore(pluginDir, id, backupId)
          // 重新加载生效（沿用 reload_plugin 的授权流程）
          const inspected = ctx.pluginRuntime.inspect(id)
          const manifest = inspected.manifest
          if (inspected.status !== 'error' && manifest) {
            const granted = await options.ensureGranted(id, manifest.version, manifest.description)
            if (granted) {
              await ctx.pluginRuntime.stop(id)
              const result = await ctx.pluginRuntime.load(id)
              return JSON.parse(
                JSON.stringify({
                  ok: result.status === 'running',
                  plugin_id: id,
                  backup_id: backupId,
                  status: result.status,
                  error: result.error,
                }),
              )
            }
            return { ok: true, plugin_id: id, backup_id: backupId, note: '文件已回退，未重新加载（未授权）' }
          }
          return { ok: true, plugin_id: id, backup_id: backupId, note: '文件已回退，插件目录状态异常或已删除，未重新加载' }
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
