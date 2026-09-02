# User Plugins

User plugins are **Cordis plugins** running inside Obsidian (loaded by Harness Like) that extend commands, tools, panels and more — see [Capabilities (extension mapping)](/development/capabilities) for the full list of extension points.

## Two ways to get one

- **Create in conversation (recommended, zero-code)**: in Create Mode, let the agent build, load and open it — see [Creating Plugins in Conversation](/guide/plugin-agent);
- **Manually**: copy a plugin folder to `.obsidian/harness-like-plugins/<id>/` in your vault (a `package.json` + a compiled `main.js`).

## Authorization & loading

Plugin Manager (top-right "Plugin Manager" button in the chat header):

- **Authorize & Load**: single-check = this version only; double-check = trust future versions;
- While running: **Open Panel / Reload / Stop / Delete**; the **⧉ next to each plugin name copies its ID** (for referencing in chat);
- Grants can be reviewed/revoked in Settings → Plugin Grants.

## Using sub-plugin commands

Commands registered by sub-plugins appear in the palette as `Harness Like: command (sub-plugin-id)` (e.g. `Harness Like: Open panel (folder-stats)`) — press Ctrl/Cmd+P and search "Harness Like", or just ask the agent to run it.

## Triggering sub-plugins from outside (obsidian:// deep links)

Sub-plugins that register deep-link actions can be triggered from browsers, shortcuts, or other apps:

```
obsidian://harness-like?plugin=<sub-plugin-id>&cmd=<action>&param=value
```

For example, if a sub-plugin offers an `add-task` action, then `obsidian://harness-like?plugin=tasks&cmd=add-task&text=Buy%20milk` runs it inside the vault. If the action doesn't exist or the plugin isn't running, a notice explains why.

## Using sub-plugin blocks in notes (```hl ...)

Sub-plugins that register block renderers can turn fenced code blocks into rich UI:

````md
```hl <sub-plugin-id or plugin alias>[:<type>] [params...]
data...
```
````

For example ```` ```hl tasks:board ```` is handed to the tasks sub-plugin to render as a board. Rules:

- The first token is always `hl` (the Harness Like namespace — it never clashes with native languages like mermaid or with other plugins). The first argument after it is the sub-plugin id, optionally followed by `:<type>`;
- **Type may be omitted** when the plugin registers a type named `default`, or when it registers exactly one type — `` ```hl tasks `` is enough. With several types it must be stated, and the note lists the available ones;
- **Params are optional and order-independent**: `k:v`, `k=v`, `k:"value with spaces"`, `--flag`, `--k=v` and bare words, handed to the renderer as `meta.params` / `meta.flags` / `meta.positional`;
- While the plugin isn't running the block shows a "not running" placeholder; reloading restores it. An **empty block shows an "empty content" box**;
- In Plugin Manager → Details you can set a **plugin alias** (e.g. `tasks` → `t`); `` ```hl t:board `` then works too, and the alias may also omit the type;
- The old `` ```hl:<sub-plugin-id>:<type> `` spelling (colon-style language) is **no longer supported** — the note shows the new spelling instead.

## Backup & migration

A sub-plugin is just the files under `.obsidian/harness-like-plugins/<id>/` (package.json + main.js). **Backup/migrate = copy the folder**:

1. Copy `.obsidian/harness-like-plugins/` (or a single sub-plugin folder) to the same location in the new vault;
2. Open the Plugin Manager there → "Authorize & Load" (one-time re-authorization).

## Security

- Plugins only execute local files under `.obsidian/harness-like-plugins/`; nothing is downloaded or executed remotely;
- Plugin writes still go through the approval chain — the security model cannot be bypassed.

## Going further

Want to hand-write plugins? See [Development → User Plugin Development](/development/index).
