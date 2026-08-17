# FAQ

<details><summary>Where are my API keys stored?</summary>

Plain text in `.obsidian/plugins/harness-like/data.json` — keep the file safe.

</details>

<details><summary>Where are chats stored?</summary>

Session logs in `.obsidian/harness-like/sessions/*.jsonl` (auto-migrated from legacy `.obsidian/dsh/`).

</details>

<details><summary>Is it safe to run user plugins?</summary>

Plugins only execute local files under `.obsidian/harness-like-plugins/`; loading requires authorization and grants can be revoked anytime.

</details>

<details><summary>Single-check vs double-check?</summary>

Single-check trusts only the current version; double-check trusts future versions without prompting.

</details>

<details><summary>Can the agent write anywhere?</summary>

No — writes are restricted to the vault and filtered by the approval chain (see [Approval](/guide/approval)).

</details>

<details><summary>How do I change the UI language?</summary>

Settings → Interface → Interface language: Follow system (default) / 中文 / English.

</details>

<details><summary>Why desktop only?</summary>

Harness Like depends on desktop capabilities; the manifest declares `isDesktopOnly`, so the mobile store hides it automatically.

</details>

<details><summary>Does it phone home?</summary>

No telemetry; model requests go only to the providers you configured.

</details>
