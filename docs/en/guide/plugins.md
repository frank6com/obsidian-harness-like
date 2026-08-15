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

## Security

- Plugins only execute local files under `.obsidian/harness-like-plugins/`; nothing is downloaded or executed remotely;
- Plugin writes still go through the approval chain — the security model cannot be bypassed.

## Going further

Want to hand-write plugins? See [Development → User Plugin Development](/en/development/index).
