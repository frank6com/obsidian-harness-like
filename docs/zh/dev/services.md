# ctx.* 服务速查

按此签名调用，不要臆测方法名。

## 服务列表（inject 声明）

- **vault**：`getMarkdownPaths()` → string[]（vault 相对路径，别名 `listMarkdown`）；`read(path)` → string；`write(path, content)`；`create(path, content)`；`createFolder(path)`（逐层创建）；`delete(path)`；`rename(old, new)`；`on(ev, cb)`（`vault/modify|create|delete|rename`）
- **views**：`registerView(type, (leaf) => view)`；`open(type)`
- **commands**：`addCommand({ id, name, callback })`
- **ribbon**：`addRibbonIcon(icon, title, callback)` → `{ remove }`
- **statusbar**：`addStatusBarItem()` → `{ el, remove }`
- **notice**：`notice(message, timeoutMs?)`
- **workspace**：`getActiveFile()` → string | null；`onFileOpen(cb)`
- **editor**：`getSelection()` / `insertText(text)` / `replaceSelection(text)`（无活动编辑器返回 null）
- **toolsCompat**：`register({ name, description, input, execute })`（execute 返回 JSON 可序列化对象）
- **settings**：`get(key, fallback)` / `set(key, value)`；`registerSettingTab(tab)`
- **protocol**：`register(cmd, handler(params))` —— 注册 obsidian:// 深链动作，返回 disposer。入口 URL：`obsidian://harness-like?plugin=<你的插件id>&cmd=<动作名>&key=value`（loader 自动携带插件 id；params 为其余 query 透传，字符串值，已剥离 plugin/cmd；无值参数为 `"true"`）。动作参数是 `cmd` 不是 `action`——Obsidian 保留 action 且恒覆盖为入口名
- **blocks**：`register(type, handler(source, el, ctx, meta))` —— 注册自定义围栏代码块渲染器，返回 disposer。笔记写法 ```` ```hl <插件id>[:<type>] [参数...] ````（loader 自动携带插件 id；`hl` 命名空间归宿主独占，不与 `html`/`mermaid` 等原生语言冲突）。type 可省略（注册了名为 `default` 的 type，或该插件只注册了一个 type 时）。参数可选且顺序无关：`k:v`、`k=v`、`k:"含 空格 的值"`、`--flag`、`--k=v`、裸词，分别落入 `meta.params` / `meta.flags`（小写归一）/ `meta.positional`；`meta` 另含 `info`、`pluginId`、`type`、`line`。插件停止后显示"未运行"占位；旧写法 ```` ```hl:<插件id>:<type> ```` 已不支持。用户可在插件详情设置【笔记别名】，之后 ```` ```hl <别名>[:<type>] ```` 同样路由到你的 handler
- **sandbox / approval / sessionLog / llmCaller / dshI18n**：见对应章节

## 事件（ctx.on）

`dsh/session/event`（会话事件）、`vault/modify|create|delete|rename`、`workspace/file-open`、`dsh/waiting-approval`（审批弹窗打开）。

## 面板插件

```js
const { ItemView } = require('obsidian')
class MyView extends ItemView {
  getViewType() { return 'my-view' }
  getDisplayText() { return '我的面板' }
  onOpen() { this.contentEl.createEl('h3', { text: '你好' }) }
}
module.exports = {
  name: 'my-plugin',
  inject: ['views', 'commands'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.views.registerView('my-view', (leaf) => new MyView(leaf)),
      ctx.commands.addCommand({ id: 'open', name: '打开面板', callback: () => ctx.views.open('my-view') }),
    ])
  },
}
```
