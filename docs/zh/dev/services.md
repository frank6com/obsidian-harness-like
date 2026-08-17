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
