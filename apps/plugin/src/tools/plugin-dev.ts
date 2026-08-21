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
import { autoRecoverLastGood } from '../plugin-backups'

export interface PluginDevToolsOptions {
  /** 授权确认（宿主弹窗）；返回是否已授权 */
  ensureGranted(pluginId: string, version: string, description?: string): Promise<boolean>
  /** 覆盖已有插件文件的确认（高风险操作拦截）；返回是否允许覆盖 */
  confirmOverwrite(pluginId: string, file: string): Promise<boolean>
  /** 回退插件版本的确认（用户拍板，agent 不可自行回退）；返回是否允许 */
  confirmRestore(pluginId: string, backupTime: string): Promise<boolean>
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/

export const PLUGIN_GUIDE = `# Harness Like 用户插件开发指南（纯 JS）

## 标准工作流（严格按顺序执行）
1. create_plugin(id, description) —— 创建插件骨架（目录 + package.json 自动生成）
2. write_plugin_file(plugin_id, 'main.js', 完整代码) —— 写实现（模板见下文，纯 JS 无需任何构建）
3. check_plugin(plugin_id) —— 必须调用：校验语法与禁用 API；errors 全部修正并重新校验通过后才能进入下一步
4. reload_plugin(plugin_id) —— 加载生效（版本变化会弹授权确认，等用户操作）
5. 有面板时 open_view(type) 打开展示给用户
排错：plugin_status 查状态与加载错误；plugin_history 列历史备份；plugin_rollback 回退版本。
回读已写文件：用 read_note，路径为 vault 相对路径 .obsidian/harness-like-plugins/<id>/<file>。

## 第一步：选交互入口（写代码前先定，勿默认 ribbon）
- 默认优先：命令（命令面板可调用）/ 面板（ItemView，配 open_view 即时展示）/ 状态栏（轻量信息）
- 左侧边栏 ribbon 图标：仅在用户明确要求时添加——侧栏空间宝贵；即使旧对话或示例出现过 ribbon，也不要主动加
- 版本号由宿主在每次 write_plugin_file 后自动递增，不要手动改

## 插件目录结构
位于 vault 的 .obsidian/harness-like-plugins/<id>/：
- package.json：元数据（dsh 字段必填）—— create_plugin 自动生成，无需手写
- main.js：CJS 模块，module.exports 导出插件对象 —— 用 write_plugin_file 写

package.json 内容（供参考，create_plugin 已自动生成）：

{
  "name": "my-plugin",
  "version": "0.0.1",
  "description": "一句话描述",
  "dsh": { "id": "my-plugin", "version": "0.0.1", "entry": "main.js" }
}

## main.js 模板 A：无界面（工具 / 命令 / 状态栏）
注意：不需要 require('@deepseek-ai/cordis')，ctx 由宿主注入。

module.exports = {
  name: 'my-plugin',
  inject: ['toolsCompat', 'commands', 'notice'],   // ← 用到谁就声明谁
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
        id: 'hello',
        name: '示例命令',
        callback: () => ctx.notice.notice('你好'),
      }),
    ])
  },
}

## main.js 模板 B：带面板（ItemView）
唯一允许的 require 是 obsidian（取 ItemView）；仍无需任何构建，写完直接 reload_plugin。

const { ItemView } = require('obsidian')

class MyView extends ItemView {
  getViewType() { return 'my-view' }        // 三个方法缺一不可
  getDisplayText() { return '我的面板' }
  getIcon() { return 'pencil' }
  onOpen() {
    this.contentEl.createEl('h3', { text: '你好，Harness Like！' })
  }
}

module.exports = {
  name: 'my-plugin',
  inject: ['views', 'commands'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.views.registerView('my-view', (leaf) => new MyView(leaf)),
      ctx.commands.addCommand({
        id: 'open-view',
        name: '打开我的面板',
        callback: () => ctx.views.open('my-view'),   // open 的 type 必须与 registerView 一致
      }),
    ])
  },
}

## 服务与方法速查（唯一权威来源；调用前核对此处，禁止臆测方法名）
inject 可声明的服务：toolsCompat / commands / views / vault / editor / workspace /
notice / ribbon / statusbar / settingsTab / sandbox / approval / sessionLog / llmCaller / dshI18n

- ctx.vault：getMarkdownPaths() -> string[]（vault 相对路径列表）；read(path) -> string；write(path, content)；
  create(path, content)；createFolder(path)（逐层创建）；delete(path)；rename(oldPath, newPath)；
  on(ev, cb)（ev: vault/modify|create|delete|rename，cb(path, oldPath?)）
  ⚠️ 没有 getFiles/getMarkdownFiles/list 方法，列笔记只用 getMarkdownPaths()
- ctx.toolsCompat：register({ name, description, input, execute })（execute 返回 JSON 可序列化对象）
- ctx.commands：addCommand({ id, name, callback })（id 自动带主插件前缀，无需手写）；execute(id)（可执行任意已注册命令，含 Obsidian 核心插件命令）
- ctx.views：registerView(type, (leaf) => view)；open(type)
- ctx.notice：notice(message, timeoutMs?)
- ctx.workspace：getActiveFile() -> string | null；onFileOpen(cb)
- ctx.editor：getSelection() / insertText(text) / replaceSelection(text)（无活动编辑器时返回 null）
- ctx.ribbon：addRibbonIcon(icon, title, callback) -> { remove }（仅用户明确要求时使用）
- ctx.statusbar：addStatusBarItem() -> { el, remove }（disposer = item.remove）
- ctx.settingsTab：register({ id, name, render(containerEl) })（注册独立设置页；render 里可用 Obsidian 的 Setting 组件）
- ctx.dshI18n：registerLocale(lang, dict)（键级覆盖主插件 zh/en 文案，翻译插件用）

## 可用事件（ctx.on）
dsh/session/event（会话事件）、dsh/waiting-approval（审批弹窗打开）、workspace/file-open、
vault/modify|create|delete|rename。

## 铁律（违反即加载失败或错误实现）
1. inject 必须声明 apply 里用到的【每一个】服务——漏一个访问就报
   "cannot get property X without inject"。
2. 所有注册必须包进 ctx.effect(() => [disposer1, disposer2])，插件停止时自动撤销；
   register/addCommand/addRibbonIcon 的返回值就是 disposer，不接入 effect 重载时会报"工具已注册"。
3. 禁止 this.app、禁止直接操作 Obsidian DOM（document.querySelector('.workspace-ribbon') 等），
   一律通过 ctx.* 服务。
4. 面板类必须 extends ItemView 并实现 getViewType/getDisplayText/onOpen 三个方法。
5. 工具 execute 只能返回 JSON 可序列化对象（不能返回函数 / DOM / 循环引用）。

## 命令命名归一化
addCommand 的 id 与显示名自动归一化为 \`<主插件id>:<插件id>:<命令>\` 与
\`Harness Like: <命令名>（<插件id>）\`；命令面板按主插件名即可找到全部功能，id 手写前缀也会被去重。

## 翻译插件模板（覆盖主插件界面文案，键级覆盖 zh/en，插件停止自动还原）

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

## 附：TS 开发者本地构建（纯 JS 场景忽略本节）
esbuild src/main.ts --bundle --external:@deepseek-ai/cordis --external:obsidian --format=cjs --outfile=main.js`

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
        description: '获取 Harness Like 用户插件开发指南（标准工作流、main.js 模板、API 速查）。创建或修改用户插件前必读',
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
        description: '写入插件目录内的文件（覆盖已存在文件需用户确认，覆盖前自动备份）。读取已写文件用 read_note（路径 .obsidian/harness-like-plugins/<插件id>/<file>），勿用本工具读',
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
          // 修改插件后自动递增版本号（version + dsh.version），新版本触发重新授权确认
          await bumpPluginVersion(ctx, pluginsDirRel, pluginId)
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
        name: 'check_plugin',
        description: '校验用户插件代码（JS 语法 / 禁用 API / 元数据 / 上次加载错误）。写完或修改插件代码后必须调用本工具；errors 全部修正并重新校验通过后，才能调用 reload_plugin',
        input: {
          type: 'object',
          properties: { plugin_id: { type: 'string', description: '插件 id' } },
          required: ['plugin_id'],
        },
        async execute(input) {
          const id = String(input.plugin_id ?? '')
          const errors: string[] = []
          const warnings: string[] = []

          // ① 元数据：package.json 结构与一致性
          const pkgPath = path.posix.join(pluginsDirRel, id, 'package.json')
          let entry = 'main.js'
          try {
            const pkg = JSON.parse(await ctx.vault.read(pkgPath)) as {
              dsh?: { id?: unknown; entry?: unknown }
            }
            if (!pkg.dsh || typeof pkg.dsh !== 'object') {
              errors.push('package.json 缺少 dsh 字段（{ "dsh": { "id", "version", "entry" } }）')
            } else {
              if (typeof pkg.dsh.id !== 'string' || !pkg.dsh.id) errors.push('package.json 缺少 dsh.id')
              else if (pkg.dsh.id !== id) errors.push(`package.json dsh.id（${pkg.dsh.id}）与插件目录名（${id}）不一致`)
              if (typeof pkg.dsh.entry === 'string' && pkg.dsh.entry) entry = pkg.dsh.entry
              else errors.push('package.json 缺少 dsh.entry')
            }
          } catch {
            errors.push('package.json 缺失或不是合法 JSON（用 create_plugin 生成骨架）')
          }

          // ② 入口文件：存在性 + JS 语法（new Function 只编译不执行）
          let code = ''
          try {
            code = await ctx.vault.read(path.posix.join(pluginsDirRel, id, entry))
          } catch {
            errors.push(`入口文件不存在: ${entry}（用 write_plugin_file 写入）`)
          }
          if (code) {
            try {
              // eslint-disable-next-line no-new-func
              new Function(code)
            } catch (err) {
              errors.push(`JS 语法错误: ${err instanceof Error ? err.message : String(err)}`)
            }
            scanPluginCode(code, errors, warnings)
          }

          // ③ 运行时状态：带出上次加载失败的真实错误
          try {
            const inspected = ctx.pluginRuntime.inspect(id)
            if (inspected.status === 'error' && inspected.error) {
              warnings.push(`上次加载失败: ${inspected.error}`)
            }
          } catch {
            // 未加载过：忽略
          }

          return JSON.parse(
            JSON.stringify({
              ok: errors.length === 0,
              plugin_id: id,
              errors,
              warnings,
              note: errors.length
                ? '必须修正全部 errors 后再次调用本工具，通过后才能 reload_plugin'
                : '检查通过，可以调用 reload_plugin 加载生效',
            }),
          )
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
          if (result.status === 'error') {
            // 加载失败自动回退到最近可用版本（备份阶梯，0.35.1）
            const rec = await autoRecoverLastGood(
              ctx.pluginBackups,
              ctx.pluginRuntime,
              ctx.sandbox.scope.pluginsDir,
              id,
            )
            if (rec.restored) {
              return {
                ok: true,
                plugin_id: id,
                backup_id: rec.backupId,
                note: '加载失败，已自动回退到最近可用版本并重新加载',
              }
            }
          }
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

/**
 * 插件代码静态扫描（check_plugin 第②层）：
 * 模型对 Obsidian 原生 API 有强先验（vault.getFiles/getMarkdownFiles 等），
 * 会写进生成的插件代码——ctx.vault 上并不存在，运行时才炸。此处加载前拦截并指路。
 */
function scanPluginCode(code: string, errors: string[], warnings: string[]): void {
  const vaultBlacklist: Array<[RegExp, string]> = [
    [/\.getFiles\s*\(/, 'ctx.vault.getFiles() 不存在：列笔记用 ctx.vault.getMarkdownPaths()（返回路径字符串数组）'],
    [/\.getMarkdownFiles\s*\(/, 'ctx.vault.getMarkdownFiles() 不存在：用 ctx.vault.getMarkdownPaths()'],
    [/\.getAbstractFileByPath\s*\(/, 'ctx.vault.getAbstractFileByPath() 不存在：读文件用 ctx.vault.read(path)'],
    [/\.cachedRead\s*\(/, 'ctx.vault.cachedRead() 不存在：用 ctx.vault.read(path)'],
  ]
  for (const [re, msg] of vaultBlacklist) {
    if (re.test(code)) errors.push(msg)
  }
  if (/\bthis\.app\b/.test(code)) {
    errors.push('禁止 this.app：一律通过 ctx.* 服务访问宿主能力')
  }
  if (/document\.(querySelector|getElementById|querySelectorAll)\s*\(/.test(code)) {
    errors.push('禁止 document.querySelector/getElementById 全局查询 Obsidian DOM：面板内操作自身 contentEl，其余一律走 ctx.* 服务')
  }
  if (/document\.createElement\s*\(/.test(code)) {
    warnings.push('建议用 Obsidian 的 el.createEl/createDiv 替代 document.createElement')
  }
  for (const m of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1]
    if (spec !== 'obsidian' && spec !== '@deepseek-ai/cordis') {
      warnings.push(`require('${spec}') 非法：仅 obsidian 可 require`)
    } else if (spec === '@deepseek-ai/cordis') {
      warnings.push("require('@deepseek-ai/cordis') 无必要：ctx 由宿主注入，直接使用即可")
    }
  }
}

async function fileExists(ctx: { vault: { read(p: string): Promise<string> } }, rel: string): Promise<boolean> {
  try {
    await ctx.vault.read(rel)
    return true
  } catch {
    return false
  }
}

/** 递增插件版本号：version 与 dsh.version 同时 +1 patch（非法版本跳过） */
async function bumpPluginVersion(
  ctx: { vault: { read(p: string): Promise<string>; write(p: string, c: string): Promise<void> } },
  pluginsDirRel: string,
  pluginId: string,
): Promise<void> {
  const pkgPath = path.posix.join(pluginsDirRel, pluginId, 'package.json')
  let pkg: { version?: unknown; dsh?: { version?: unknown } }
  try {
    pkg = JSON.parse(await ctx.vault.read(pkgPath))
  } catch {
    return // package.json 缺失/损坏：跳过
  }
  const bump = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    if (!m) return undefined
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
  }
  const version = bump(pkg.version)
  const dshVersion = pkg.dsh ? bump(pkg.dsh.version) : undefined
  if (!version && !dshVersion) return
  if (version) pkg.version = version
  if (dshVersion && pkg.dsh) pkg.dsh.version = dshVersion
  await ctx.vault.write(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}
