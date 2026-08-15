# Development

This section is for **developers/contributors of the Harness Like plugin itself** — not to be confused with [Plugin Development](/en/dev/hello-world), which teaches Obsidian users how to write their own user plugins.

## Repository layout

```
packages/harness-base/      Pure logic: sandbox / approval / session-log / agent-loop / official llm & tools integration
packages/obsidian-adapter/  The only layer touching the Obsidian API (structured interfaces + services)
packages/plugin-runtime/    User plugin loader (require shim + state machine + command prefixing)
apps/plugin/                Entry / Chat panel / Plugin Manager / settings tabs / modals / tools / i18n
docs/                       VitePress user docs (this site)
```

## Stack

- **Runtime**: Cordis (`@deepseek-ai/cordis` 4.0.1) + official dsh packages (`dsh-llm/tools/session/sandbox/workspace/agent/agent-loop`), all pinned to **0.1.0-rc.6**;
- **Language/build**: TypeScript strict; pnpm workspace; esbuild bundling (readable, not minified);
- **Tests**: vitest (currently 129, `pnpm test` must stay green) + typecheck.

## Getting started

```sh
pnpm install
pnpm dev          # esbuild watch, syncs artifacts to dev-vault/ automatically
pnpm test         # vitest suite
pnpm typecheck    # all four packages
pnpm build        # build & sync (repo root = the official plugin package)
```

See [Workflow](/en/development/workflow), [Versioning](/en/development/versioning), [Release](/en/development/release) and [Conventions](/en/development/conventions).
