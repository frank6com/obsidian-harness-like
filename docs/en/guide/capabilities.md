# Implemented Capabilities

Everything the agent can call in conversation (tools are filtered by the active agent mode).

## Built-in tools (available from Chat Mode)

| Tool | Description |
| --- | --- |
| `read_note` | Read the full content of a note in the vault |
| `write_note` | Write/overwrite a note (goes through the approval chain) |
| `list_notes` | List notes (filter by folder, limit results) |
| `search_notes` | Full-text keyword search across notes |
| `insert_to_editor` | Insert text at the cursor in the active editor |
| `open_in_browser` | Open a link in the system browser |

## Plugin development tools (Create Mode only)

| Tool | Description |
| --- | --- |
| `plugin_guide` | Fetch the plugin development guide (templates & API reference) |
| `create_plugin` | Scaffold a plugin (folder + package.json) |
| `write_plugin_file` | Write/overwrite a plugin file (overwrites need confirmation) |
| `plugin_status` | Show plugin status and load errors |
| `reload_plugin` | Stop and reload a plugin (authorization prompt if not granted) |
| `open_view` | Open a panel registered by a plugin |

## What user plugins can register

Via `ctx.*` services (see [Plugin Development](/en/dev/hello-world)):

- **Tools**: custom tools callable by the agent (`ctx.toolsCompat.register`)
- **Commands**: command palette entries (auto-grouped as `Harness Like: command (plugin-id)`)
- **Panels**: custom ItemView views (`ctx.views.registerView`)
- **Ribbon icons / status bar / settings tabs**: `ctx.ribbon` / `ctx.statusbar` / `ctx.settings`
- **Translations**: per-key UI string overrides (`ctx.dshI18n`)

## Host services (ctx.*)

`vault`, `editor`, `workspace`, `commands`, `views`, `settings`, `ribbon`, `statusbar`, `notice`, `sandbox`, `approval`, `sessionLog`, `llmCaller`, `dshI18n` — full signatures in [Services Reference](/en/dev/services).
