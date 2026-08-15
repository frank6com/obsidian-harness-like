# Approval & Security

## Write approval chain

Agent writes are decided in this order:

1. **Per-tool policy** (Settings → Approval → overrides, e.g. `write_note=deny`);
2. **Current-note mode**: only the currently open note is writable;
3. **Directory whitelist**: whitelisted directories skip the prompt;
4. **Approval dialog**: ask by default; choose "Allow once" or "Allow for this chat" (not persisted).

## User plugin security model

- Plugins only execute local files under `.obsidian/harness-like-plugins/`; nothing is downloaded or executed remotely.
- First load requires authorization: **single-check** = this version only; **double-check** = trust future versions.
- Grants can be viewed/revoked in Settings → Plugin Grants; revoking stops auto-loading, not the running plugin.
- Plugins can request: note read/write (writes need approval), commands/tools/panels, current note access, notifications.

## Data locations

- API keys: plain text in `.obsidian/plugins/harness-like/data.json` — keep it safe.
- Session logs: `.obsidian/harness-like/sessions/*.jsonl`.
- Privacy: zero telemetry; requests go only to configured endpoints.
