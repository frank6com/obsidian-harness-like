/**
 * PLUGIN_GUIDE 章节化拆分：get_guide 返回的开发指南按语义维护为独立章节常量，
 * buildGuide() 按登记顺序拼装——新增能力（如 blocks）时加章节并入 CHAPTERS 即可，
 * 不再与工具逻辑混排在一个文件里。
 */

export const GUIDE_TITLE = `# Harness Like 用户插件开发指南（纯 JS）`

/** 标准工作流：工具调用顺序约束 */
export const CH_WORKFLOW = `## 标准工作流（严格按顺序执行）
1. create_plugin(id, description) —— 创建插件骨架（目录 + package.json 自动生成）
2. write_plugin_file(plugin_id, 'main.js', 完整代码) —— 写实现（模板见下文，纯 JS 无需任何构建）
3. check_plugin(plugin_id) —— 必须调用：校验语法与禁用 API；errors 全部修正并重新校验通过后才能进入下一步
4. reload_plugin(plugin_id) —— 加载生效（版本变化会弹授权确认，等用户操作）
5. 有面板时 open_view(type) 打开展示给用户
排错：plugin_status 查状态与加载错误；plugin_history 列历史备份；plugin_rollback 回退版本。
回读已写文件：用 read_note，路径为 vault 相对路径 .obsidian/harness-like-plugins/<id>/<file>。`

/** 交互入口选择：防止默认滥用 ribbon */
export const CH_ENTRY_SELECT = `## 第一步：选交互入口（写代码前先定，勿默认 ribbon）
- 默认优先：命令（命令面板可调用）/ 面板（ItemView，配 open_view 即时展示）/ 状态栏（轻量信息）
- 左侧边栏 ribbon 图标：仅在用户明确要求时添加——侧栏空间宝贵；即使旧对话或示例出现过 ribbon，也不要主动加
- 版本号由宿主在每次 write_plugin_file 后自动递增，不要手动改`

/** 插件目录结构与 package.json */
export const CH_DIR_STRUCTURE = `## 插件目录结构
位于 vault 的 .obsidian/harness-like-plugins/<id>/：
- package.json：元数据（dsh 字段必填）—— create_plugin 自动生成，无需手写
- main.js：CJS 模块，module.exports 导出插件对象 —— 用 write_plugin_file 写

package.json 内容（供参考，create_plugin 已自动生成）：

{
  "name": "my-plugin",
  "version": "0.0.1",
  "description": "一句话描述",
  "dsh": { "id": "my-plugin", "version": "0.0.1", "entry": "main.js" }
}`

/** 模板 A：无界面（工具 / 命令 / 状态栏） */
export const CH_TEMPLATE_BASIC = `## main.js 模板 A：无界面（工具 / 命令 / 状态栏）
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
}`

/** 模板 B：带面板（ItemView） */
export const CH_TEMPLATE_PANEL = `## main.js 模板 B：带面板（ItemView）
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
}`

/** 服务与方法速查（唯一权威来源；含 protocol/blocks 扩展点签名与示例） */
export const CH_SERVICES = `## 服务与方法速查（唯一权威来源；调用前核对此处，禁止臆测方法名）
inject 可声明的服务：toolsCompat / commands / views / vault / editor / workspace /
notice / ribbon / statusbar / settingsTab / sandbox / approval / sessionLog / llmCaller / dshI18n / protocol / blocks

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
- ctx.protocol：register(cmd, handler(params))（注册 obsidian:// 深链动作，返回 disposer）。
  实际 URL：obsidian://harness-like?plugin=<你的插件id>&cmd=<动作名>&key=value；
  handler 收到的 params 为其余 query 透传（已剥离 plugin/cmd，值均为 string；无值参数 = "true"）。
  动作名参数是 cmd 不是 action（action 被 Obsidian 保留，恒为入口名）；动作名无需带插件 id
  前缀（loader 自动注入）。示例：
  ctx.protocol.register('add-task', (p) => ctx.notice.notice(\`收到: \${p.text}\`))
  对应 obsidian://harness-like?plugin=my-plugin&cmd=add-task&text=hello
- ctx.blocks：register(type, handler(source, el, ctx, meta))（注册自定义围栏代码块渲染器，返回 disposer）。
  笔记写法（loader 自动携带插件 id，type 无需前缀）：
  \`\`\`hl <你的插件id>[:<type>] [参数...]
  data...
  \`\`\`
  · type 可省略：注册了名为 default 的 type，或该插件只注册了一个 type 时，可写成
    \`\`\`hl <你的插件id>；注册多个 type 时必须显式指定，否则渲染"请指定类型"占位
  · 参数均可选且顺序无关：k:v / k=v / k:"含 空格 的值" / --flag / --k=v / 裸词
  · handler 的 el 为空容器 div，填充 DOM 即完成渲染；meta = { info, pluginId, type,
    params, flags, positional, line }（flags 小写归一，params 的 key 保留原样）
  · hl 命名空间归宿主独占，不会与原生语言（html/mermaid…）冲突；插件停止显示"未运行"占位`

/** 可用事件 */
export const CH_EVENTS = `## 可用事件（ctx.on）
dsh/session/event（会话事件）、dsh/waiting-approval（审批弹窗打开）、workspace/file-open、
vault/modify|create|delete|rename。`

/** 铁律：违反即加载失败或错误实现 */
export const CH_IRON_RULES = `## 铁律（违反即加载失败或错误实现）
1. inject 必须声明 apply 里用到的【每一个】服务——漏一个访问就报
   "cannot get property X without inject"。
2. 所有注册必须包进 ctx.effect(() => [disposer1, disposer2])，插件停止时自动撤销；
   register/addCommand/addRibbonIcon 的返回值就是 disposer，不接入 effect 重载时会报"工具已注册"。
3. 禁止 this.app、禁止直接操作 Obsidian DOM（document.querySelector('.workspace-ribbon') 等），
   一律通过 ctx.* 服务。
4. 面板类必须 extends ItemView 并实现 getViewType/getDisplayText/onOpen 三个方法。
5. 工具 execute 只能返回 JSON 可序列化对象（不能返回函数 / DOM / 循环引用）。`

/** 命令命名归一化说明 */
export const CH_COMMAND_NAMING = `## 命令命名归一化
addCommand 的 id 与显示名自动归一化为 \`<主插件id>:<插件id>:<命令>\` 与
\`Harness Like: <命令名>（<插件id>）\`；命令面板按主插件名即可找到全部功能，id 手写前缀也会被去重。`

/** 深链（obsidian://）入口 */
export const CH_DEEP_LINK = `## 深链（obsidian://）入口
protocol.register 的动作统一走宿主单一入口 obsidian://harness-like，
以 query 参数 plugin=<插件id>&cmd=<动作名> 路由到对应 handler（loader 自动携带你的插件 id）。
动作名参数是 cmd 不是 action（action 为 Obsidian 保留字，会被覆盖为入口名）。
插件停止后深链自动失效（提示"未运行"），重新加载即恢复。`

/** 块（```hl ...）渲染 */
export const CH_BLOCKS = `## 块（\`\`\`hl ...）渲染
blocks.register(type, handler) 注册的块，在笔记中这样写：

\`\`\`hl <你的插件id>[:<type>] [参数...]
块内容（原样交给 handler 的 source）
\`\`\`

- type 省略规则：注册了名为 default 的 type、或该插件只注册了一个 type 时，可写成
  \`\`\`hl <你的插件id>；注册了多个 type 时必须显式指定，否则渲染"请指定类型"占位。
- 参数全部可选且顺序无关：
  · k:v 或 k=v        → meta.params.k = 'v'
  · k:"含 空格 的值"  → 单/双引号包裹，内部支持 \\" 转义
  · --flag            → meta.flags 含 'flag'（小写归一）
  · --k=v             → meta.params.k = 'v'
  · 其余裸词          → 进入 meta.positional 数组
- handler 签名：(source, el, ctx, meta)；meta = { info, pluginId, type, params, flags,
  positional, line }。el 为空容器 div，向其中填充 DOM 即完成渲染。
- 插件停止后显示"未运行"占位；旧写法 \`\`\`hl:<你的插件id>:<type> 已不支持，会提示新写法。
- 用户可在插件详情里为该插件设置【插件别名】，之后 \`\`\`hl <别名>[:<type>] 同样路由到你。`

/** 翻译插件模板 */
export const CH_TRANSLATION = `## 翻译插件模板（覆盖主插件界面文案，键级覆盖 zh/en，插件停止自动还原）

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
}`

/** 附：TS 开发者本地构建（纯 JS 场景忽略） */
export const CH_TS_BUILD = `## 附：TS 开发者本地构建（纯 JS 场景忽略本节）
esbuild src/main.ts --bundle --external:@deepseek-ai/cordis --external:obsidian --format=cjs --outfile=main.js`

/** 章节登记表：顺序即 get_guide 输出顺序 */
export const CHAPTERS: readonly string[] = [
  CH_WORKFLOW,
  CH_ENTRY_SELECT,
  CH_DIR_STRUCTURE,
  CH_TEMPLATE_BASIC,
  CH_TEMPLATE_PANEL,
  CH_SERVICES,
  CH_EVENTS,
  CH_IRON_RULES,
  CH_COMMAND_NAMING,
  CH_DEEP_LINK,
  CH_BLOCKS,
  CH_TRANSLATION,
  CH_TS_BUILD,
]

/** 拼装完整指南 */
export function buildGuide(): string {
  return [GUIDE_TITLE, ...CHAPTERS].join('\n\n')
}

/** 兼容旧引用：完整指南文本（= buildGuide()） */
export const PLUGIN_GUIDE = buildGuide()
