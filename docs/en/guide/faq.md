# FAQ

**Where are my API keys stored?**
Plain text in `.obsidian/plugins/harness-like/data.json` — keep the file safe.

**Where are chats stored?**
Session logs in `.obsidian/harness-like/sessions/*.jsonl` (auto-migrated from legacy `.obsidian/dsh/`).

**Is it safe to run user plugins?**
Plugins only execute local files under `.obsidian/harness-like-plugins/`; loading requires authorization and grants can be revoked anytime.

**Single-check vs double-check?**
Single-check trusts only the current version; double-check trusts future versions without prompting.

**Can the agent write anywhere?**
No — writes are restricted to the vault and filtered by the approval chain (see [Approval](/en/guide/approval)).

**How do I change the UI language?**
Settings → Interface → Interface language: Follow system (default) / 中文 / English.

**Why desktop only?**
Harness Like depends on desktop capabilities; the manifest declares `isDesktopOnly`, so the mobile store hides it automatically.

**Does it phone home?**
No telemetry; model requests go only to the providers you configured.
