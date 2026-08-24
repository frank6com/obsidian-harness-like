# ctx.* Services Reference

Call these exact signatures — do not guess method names.

## Services (declare in inject)

- **vault**: `getMarkdownPaths()` → string[] (vault-relative paths; alias `listMarkdown`); `read(path)` → string; `write(path, content)`; `create(path, content)`; `createFolder(path)` (creates nested); `delete(path)`; `rename(old, new)`; `on(ev, cb)` (`vault/modify|create|delete|rename`)
- **views**: `registerView(type, (leaf) => view)`; `open(type)`
- **commands**: `addCommand({ id, name, callback })`; `execute(id)` (run any registered command, including Obsidian core plugin commands like `templates:insert-template`)
- **ribbon**: `addRibbonIcon(icon, title, callback)` → `{ remove }`
- **statusbar**: `addStatusBarItem()` → `{ el, remove }`
- **settingsTab**: `register({ id, name, render(containerEl) })` — register your own settings tab (render with Obsidian `Setting` components); auto-removed on unload
- **notice**: `notice(message, timeoutMs?)`
- **workspace**: `getActiveFile()` → string | null; `onFileOpen(cb)`
- **editor**: `getSelection()` / `insertText(text)` / `replaceSelection(text)` (null when no active editor)
- **toolsCompat**: `register({ name, description, input, execute })` (execute returns JSON-serializable)
- **settings**: `get(key, fallback)` / `set(key, value)`; `registerSettingTab(tab)`
- **protocol**: `register(cmd, handler(params))` — register an `obsidian://` deep-link action; returns a disposer. Entry URL: `obsidian://harness-like?plugin=<your-plugin-id>&cmd=<action>&key=value` (the loader injects your plugin id automatically; `params` receives the remaining query values as strings, with `plugin`/`cmd` stripped; valueless params arrive as `"true"`). The route parameter is `cmd`, **not** `action` — Obsidian reserves `action` and always overwrites it with the entry name
- **blocks**: `register(type, handler(source, el))` — register a custom fenced-code-block renderer; returns a disposer. The effective language is `hl:<your-plugin-id>:<type>` (the loader injects your plugin id; the `hl:` namespace belongs to the host, so you never clash with native languages or other plugins). Once a user writes ```` ```hl:my-plugin:chart ```` in a note, your handler receives the block text and an empty container div — fill it with DOM to render. Language collisions do not throw: the block is marked conflicted and can be renamed to `hl:<alias>` in the plugin details dialog
- **sandbox / approval / sessionLog / llmCaller / dshI18n**: see the respective chapters

## Events (ctx.on)

`dsh/session/event`, `vault/modify|create|delete|rename`, `workspace/file-open`, `dsh/waiting-approval`.

## Panel plugin

```js
const { ItemView } = require('obsidian')
class MyView extends ItemView {
  getViewType() { return 'my-view' }
  getDisplayText() { return 'My Panel' }
  onOpen() { this.contentEl.createEl('h3', { text: 'Hello' }) }
}
module.exports = {
  name: 'my-plugin',
  inject: ['views', 'commands'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.views.registerView('my-view', (leaf) => new MyView(leaf)),
      ctx.commands.addCommand({ id: 'open', name: 'Open panel', callback: () => ctx.views.open('my-view') }),
    ])
  },
}
```
