# Agents & Models

## Agents

Three built-in modes:

| Mode | Capabilities |
| --- | --- |
| Chat | Chat and read-only tools |
| Edit | Read/write notes (default) |
| Create | Full capabilities, can create/modify plugins |

**Which mode when**:

- **Chat Mode**: read-only questions — counting, searching, summarizing, Q&A;
- **Edit Mode**: reading and writing notes — journals, lists, editing content;
- **Create Mode**: creating/modifying sub-plugins — panels, commands, tools, icons (see [Creating Plugins in Conversation](/guide/plugin-agent)).

- Switch via the agent button (upward menu) in the toolbar; disabled modes are hidden.
- **Custom agents**: Settings → Agents → "＋ Add Custom Agent", check capability whitelists, and optionally fill a custom **system prompt (persona)** — written in English; when non-empty it shadows that mode's default prompt, leave empty to use the built-in default.
- **Fork as template**: built-ins are immutable; click "Fork as template" on a built-in row to copy it into an editable custom agent (starting from its current effective persona text). The original stays untouched as fallback.
- **Prompt architecture**: the system prompt is assembled in layers — shared identity & safety baseline (identical for all agents) + agent persona + response-language directive (generated dynamically from Obsidian's language) + dynamic context. Built-in personas are maintained as English markdown files and inlined at build time; your reply language is unaffected.
- **Default agent**: Settings → Agents → Default agent dropdown (enabled ones only).

## Models

- **Providers (channels)**: Settings → Models. Each channel = name + Base URL (OpenAI-compatible) + API Key + model list + parameters.
- **Fetch models**: "Fetch from endpoint" opens a searchable picker (typing a new name adds it as a candidate); if the endpoint exposes model metadata, the context window is auto-filled.
- **Per-model default**: set any model as default — the fallback for new chats.
- **Per-session switching**: via the model button (upward menu) in the panel toolbar.
- Parameters: temperature (slider), max output tokens (0 = endpoint default; reasoning models share this quota between thinking and answer — 8192+ recommended, too small causes "thinks forever but no answer"), input context window (informational), custom headers (one `Header: value` per line).
