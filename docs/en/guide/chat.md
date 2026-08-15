# Chat Panel

## Layout

- **Header**: collapse session list (☰), new chat, plugin manager.
- **Session list**: title + message count, selected row highlighted; hover for export/delete.
- **Messages**: each exchange is a turn (user message + tool cards + reply) with a "Copy this exchange" button; code blocks keep their own copy button.
- **Toolbar**: agent picker, model picker (upward menus), "Current note only" toggle.
- **Footer**: auto-growing input (Enter to send / Shift+Enter for newline), send/stop button.

## Highlights

- **Streaming** can be disabled in Settings → Interface.
- **Markdown rendering** uses the official renderer; can be switched to plain text.
- **Phase bar** shows thinking / tool / waiting-for-approval states.
- **Retry**: failed turns persist an error message with a Retry button.
- **Stop**: the send button becomes Stop during generation.

## Sessions

- Sessions persist to `.obsidian/harness-like/sessions/*.jsonl` and survive restarts.
- Export directory: Settings → Sessions (default: a `sessions/` folder at the vault root).
- Retention (auto-cleanup days): Settings → Sessions.

## Language

Default is "Follow system": matches Obsidian's app language (zh → 中文, otherwise English). Pin 中文 or English in Settings → Interface.
