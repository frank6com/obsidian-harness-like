# Quick Start

## Install (the host plugin)

From the **official Obsidian plugin directory**: [Harness Like](https://community.obsidian.md/plugins/harness-like) (desktop only).

In Obsidian: Settings → Community plugins → Browse → search **Harness Like** → Install → Enable.

Manual install (alternative): copy `main.js`, `manifest.json`, `styles.css` from the GitHub repository root to `.obsidian/plugins/harness-like/` in your vault.

## Configure a model

1. Click the bot icon in the left ribbon, or run the host command "Open Harness Like Panel";
2. Open host settings (Settings → Community plugins → Harness Like) → Models tab:
   - The DeepSeek channel is pre-configured — enter your **API Key**;
   - "Fetch from endpoint" to pull the model list, or add models manually;
   - Set your usual model as the default.

## First chat

Try an example:

- "Count the notes in this vault"
- "Find notes containing 'reading'"
- "Summarize the current note" (tick "Current note only" in the toolbar first)

The agent calls tools with visible cards; write operations ask for approval.

## Host commands (in the command palette)

| Command | Purpose |
| --- | --- |
| Open Harness Like Panel | Opens the chat panel (same as the ribbon bot icon) |
| Open Harness Like Plugin Manager | Opens the sub-plugin management view |
| Reload authorized user plugins | Reloads all authorized sub-plugins |

> Sub-plugin commands appear as `Harness Like: command (sub-plugin-id)` and are used the same way — see [User Plugins](/en/guide/plugins).

## Next steps

- [Chat Panel](/en/guide/chat) (including session export)
- [Agents & Models](/en/guide/agents-models) (what the three modes are for)
- [Describing what you want](/en/guide/speak-to-agent) (Obsidian areas & how to phrase requests)
- [Creating Plugins in Conversation](/en/guide/plugin-agent)
