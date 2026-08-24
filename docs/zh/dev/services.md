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
- **blocks**：`register(type, handler(source, el))` —— 注册自定义围栏代码块渲染器，返回 disposer。实际语言串为 `hl:<你的插件id>:<type>`（loader 自动携带插件 id；`hl:` 命名空间归宿主独占，不与原生语言或其他插件冲突）。用户在笔记中写 ```` ```hl:my-plugin:chart ```` 后，handler 收到块内文本与空容器 div，填充 DOM 即完成渲染。语言串撞车不报错——该块标记冲突，可在插件详情弹窗改名为 `hl:<别名>` 解除
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
