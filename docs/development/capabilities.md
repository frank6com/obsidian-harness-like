# Implemented Capabilities (Obsidian Extension Mapping)

For **developers**: how Harness Like (the host plugin) maps Obsidian's extension points, and which built-in tools each agent mode can call.

## Host plugin → Obsidian extension mapping

| Obsidian extension point | Harness Like mapping |
| --- | --- |
| Commands (`app.commands`) | Host commands: Open Harness Like Panel / Open Plugin Manager / Reload authorized plugins; sub-plugin commands auto-grouped as `Harness Like: command (sub-plugin-id)` |
| Views (`viewRegistry`) | Host panels: Chat, Plugin Manager; sub-plugin ItemView panels |
| Settings tabs (`addSettingTab`) | Tabbed settings: Models / Agents / Approval / Sessions / Data / Interface / Logs / Plugin Grants |
| Ribbon icons | Host bot icon (opens Chat); sub-plugins can register their own |
| Status bar | Sub-plugins can add status bar items |
| Editor bridge | `ctx.editor` (selection / insert / replace) |
| Filesystem | `ctx.vault` (read/write/folders/events `vault/create|modify|delete|rename`) |
| Workspace | `ctx.workspace` (active file, file-open event) |
| Notifications | `ctx.notice` |
| Browser | `openTarget` (open external links/paths) |

## Built-in tools × agent modes

| Tool | Chat (read-only) | Edit (read/write notes) | Create (full) |
| --- | :---: | :---: | :---: |
| `read_note` | ✅ | ✅ | ✅ |
| `list_notes` | ✅ | ✅ | ✅ |
| `search_notes` | ✅ | ✅ | ✅ |
| `write_note` | — | ✅ | ✅ |
| `insert_to_editor` | — | ✅ | ✅ |
| `open_in_browser` | — | ✅ | ✅ |
| `plugin_guide` | — | — | ✅ |
| `create_plugin` | — | — | ✅ |
| `write_plugin_file` | — | — | ✅ |
| `check_plugin` (verify plugin code: syntax / forbidden APIs) | — | — | ✅ |
| `plugin_status` | — | — | ✅ |
| `reload_plugin` | — | — | ✅ |
| `open_view` | — | — | ✅ |
| `run_command` | — | ✅¹ | ✅¹ |

> ¹ `run_command`（shell 命令执行）需先在设置 → 审批 中开启「允许执行命令」，且每次调用弹审批确认；默认工作目录 = vault 根，指定任意目录需另开「完全放行」。

> Custom agents override these via capability whitelists (checked tools).

## What sub-plugins can register

Tools (`ctx.toolsCompat.register`), commands (+ `ctx.commands.execute(id)` to run any registered command, incl. Obsidian core plugin commands), ItemView panels (`ctx.views`), ribbon icons, status bar items, **settings tabs (`ctx.settingsTab.register`)** — signatures in the [Services Reference](/dev/services). Full walkthrough: [Your First Plugin](/dev/hello-world).
