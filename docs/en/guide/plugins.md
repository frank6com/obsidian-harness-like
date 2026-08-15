# User Plugins

User plugins are **Cordis plugins** running inside Obsidian (not Obsidian-native plugins), living in `.obsidian/harness-like-plugins/<id>/` (a `package.json` + a compiled `main.js`). Through `ctx.*` services they can register:

- Tools (callable by the agent)
- Commands (auto-grouped as `Harness Like: command (plugin-id)`)
- Custom panels (ItemView)
- Ribbon icons, status-bar items, settings tabs

## Getting plugins

- **In conversation**: switch to Create Mode and let the agent run `create_plugin` → `write_plugin_file` → `reload_plugin`.
- **Manually**: copy a plugin folder to `.obsidian/harness-like-plugins/<id>/`.

## Plugin Manager

Open via the "Plugin Manager" button in the chat header:

- Refresh / open the plugins folder;
- **Authorize & Load** (single/double-check) → running plugins offer Open Panel / Reload / Stop / Delete;
- Each row shows capability badges (Panel/Commands/Tools/Icon/Status bar/Settings) and grant info.

## Example

See `apps/plugin/examples/my-first-plugin/` in the repo (precompiled, copy directly). Dev docs: [Plugin Development](/en/dev/hello-world).
