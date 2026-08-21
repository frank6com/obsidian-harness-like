# Chat Panel

## Layout

- **Header**: collapse session list (☰), new chat, plugin manager.
- **Session list**: title + message count, selected row highlighted; hover for export/delete.
- **Messages**: each exchange is a turn (user message + tool cards + reply) with a "Copy this exchange" button; code blocks keep their own copy button; when scrolling a long conversation, **⤒ / ⤓** quick buttons briefly appear at the bottom-right (scroll up → jump-to-top, scroll down → jump-to-bottom, auto-hide after ~2s).
- **Toolbar**: agent picker, model picker (upward menus), "Current note only" toggle.
- **Footer**: auto-growing input (Enter to send / Shift+Enter for newline), send/stop button.

## Highlights

- **Streaming** can be disabled in Settings → Interface.
- **Markdown rendering** uses the official renderer; can be switched to plain text.
- **Phase bar** shows thinking / tool / waiting-for-approval states.
- **Retry**: failed turns persist an error message with a Retry button.
- **Empty-response auto-continuation**: if the model thinks for a long time and returns nothing (e.g. thinking exhausted the output quota), Harness Like automatically nudges it to continue (up to 2 retries) before surfacing the reason — raising Settings → Models → "Max output tokens" (8192+ recommended) fixes it at the root.
- **Stop**: the send button becomes Stop during generation.

## Sessions

- Sessions persist to `.obsidian/harness-like/sessions/*.jsonl` and survive restarts.
- Export directory: Settings → Sessions (default: a `sessions/` folder at the vault root).
- Retention (auto-cleanup days): Settings → Sessions.

## Export & backup

- **Export as Markdown**: hover the session in the list and click "⤓" — exports that session as a Markdown note;
- **Export directory**: Settings → Sessions → "Export directory" (default: a `sessions/` folder at the vault root; empty = root);
- **Full backup**: session logs live in `.obsidian/harness-like/sessions/` — copy that folder to migrate with your vault.

## Language

Default is "Follow system": matches Obsidian's app language (zh → 中文, otherwise English). Pin 中文 or English in Settings → Interface.
