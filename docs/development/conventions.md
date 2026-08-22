# Conventions

## Layering

- **Only `packages/obsidian-adapter` may import `obsidian`**; everything else talks to Cordis service interfaces;
- Obsidian runtime APIs missing from the type surface (`app.commands` / `app.setting` / `app.viewRegistry` …) are accessed via structural casts in `apps/plugin/src/obsidian-bridge.ts`;
- esbuild must keep the `node-module-shim` plugin (dsh-llm's `createRequire` crashes in Obsidian; solved by `apps/plugin/shims/node-module.ts`).

## Internal protocol names (do not change)

- Data dir `.obsidian/harness-like/`, user plugins dir `.obsidian/harness-like-plugins/`;
- Service keys `ctx.sessionLog / toolsCompat / llmCaller / sandbox / approval / dshI18n / protocol`;
- Deep-link entry `obsidian://harness-like?plugin=<id>&cmd=<name>` — the route parameter is `cmd`, **never** `action` (Obsidian's URI parser overwrites `data.action` with the URL action segment, verified in app.js: `return r.action = i`);
- Event domains `dsh/session/event`, `dsh/waiting-approval`, `dsh/settings-updated`; log prefix `[dsh]`;
- The `dsh` field in user plugin manifests (`dsh.id` etc.).

## Security model

- Sandbox whitelist: read = whole vault; write = notes + data dir + plugins dir + temp dir; **never other config-dir areas**;
- Dynamic plugins execute only local files, requiring authorization (single/double-check);
- Write approval chain: per-tool policy → current-note mode → directory whitelist → approval dialog;
- Only Create mode can create/modify plugins.

## i18n

- Dictionaries per language in `apps/plugin/src/i18n/{zh,en}.ts`; API in `i18n/index.ts` (`t()` / `resolveLanguage()` / `registerLocale`);
- `uiLanguage` preference: `auto` (default, follows Obsidian's app language via `localStorage['language']`) or explicit `zh`/`en`;
- All user-visible strings must go through `t('key')` — no hardcoded Chinese.
