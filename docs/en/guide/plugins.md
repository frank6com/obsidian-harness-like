# User Plugins

User plugins are **Cordis plugins** running inside Obsidian (loaded by Harness Like) that extend commands, tools, panels and more.

## Two ways to get one

- **Create in conversation (recommended, zero-code)**: in Create Mode, let the agent build, load and open it — see [Creating Plugins in Conversation](/en/guide/plugin-agent);
- **Manually**: copy a plugin folder to `.obsidian/harness-like-plugins/<id>/` in your vault (a `package.json` + a compiled `main.js`).

## Authorization & loading

Plugin Manager (top-right "Plugin Manager" button in the chat header):

- **Authorize & Load**: single-check = this version only; double-check = trust future versions;
- While running: **Open Panel / Reload / Stop / Delete**;
- Grants can be reviewed/revoked in Settings → Plugin Grants.

## Using sub-plugin commands

Commands registered by sub-plugins appear in the palette as `Harness Like: command (sub-plugin-id)` (e.g. `Harness Like: Open panel (folder-stats)`) — press Ctrl/Cmd+P and search "Harness Like", or just ask the agent to run it.

## Backup & migration

A sub-plugin is just the files under `.obsidian/harness-like-plugins/<id>/` (package.json + main.js). **Backup/migrate = copy the folder**:

1. Copy `.obsidian/harness-like-plugins/` (or a single sub-plugin folder) to the same location in the new vault;
2. Open the Plugin Manager there → "Authorize & Load" (one-time re-authorization).

## Security

- Plugins only execute local files under `.obsidian/harness-like-plugins/`; nothing is downloaded or executed remotely;
- Plugin writes still go through the approval chain — the security model cannot be bypassed.

## Going further

Want to hand-write plugins? See [Development → User Plugin Development](/en/development/index).
