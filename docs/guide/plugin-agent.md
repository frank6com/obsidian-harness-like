# Creating Plugins in Conversation

The best Harness Like experience: **no coding — let the agent create, load and use your plugin right in the chat**.

## Prerequisites

1. Harness Like installed and enabled (see [Quick Start](/guide/quickstart));
2. Switch the agent in the chat toolbar to **Create Mode** (full capabilities, can create plugins).

## Three steps

**① Describe what you want** — one sentence is enough:

> Create a plugin with a panel showing the folders in this vault and the file count under each folder.

**② The agent does the rest** — it reads the dev guide, scaffolds the plugin, writes the code, **verifies it automatically** (syntax & forbidden-API checks, self-fixes issues), loads it (authorize in the prompt on first load) and opens the panel.

**③ Use and iterate** — done when the panel appears; ask for changes right in the chat:

> Change the stats to group by file type instead.

The agent modifies the code and reloads it — changes apply immediately.

## What you can ask for

- **Tools**: custom capabilities the agent can call;
- **Commands**: new command palette entries (auto-grouped as `Harness Like: command (plugin-id)`);
- **Panels**: custom views (stats, dashboards, toolkits…);
- **Ribbon icons / status bar / settings tabs**;
- **UI translations**: override Harness Like's interface strings.

## Managing plugins

Plugin Manager (top-right "Plugin Manager" button in the chat header): authorize (single = this version / double = trust future versions), reload, stop, delete; the **⧉ button next to each plugin name copies its ID** for easy referencing in chat (it's the parameter the agent's plugin tools take); grants can be reviewed/revoked in Settings → Plugin Grants.

## Tips

- The more specific your request, the closer the result (features, layout, data source);
- Want to hand-write plugins? See [Development → User Plugin Development](/development/index).
