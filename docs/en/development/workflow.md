# Workflow

## Daily loop

1. `pnpm dev`: esbuild watch — after each build, artifacts are synced to:
   - the **repository root** (official plugin package: main.js / manifest.json / styles.css / versions.json, committed);
   - **dev-vault/** (the in-repo Obsidian test vault, fully gitignored).
2. Open `dev-vault` in Obsidian for testing; reload the plugin (or restart Obsidian) if changes don't show.
3. Code → build → test → commit.

## Commit conventions

- Message: `feat|fix|chore|docs|refactor(scope): summary`;
- **Bump the version on every commit** (see [Versioning](/en/development/versioning));
- Before committing: `pnpm typecheck && pnpm test` green + manual acceptance (Chat panel, plugin loading, approval flow).

## Testing notes

- Session logs live in `dev-vault/.obsidian/harness-like/sessions/*.jsonl` — read them first when diagnosing user-reported issues;
- When changing pure-logic layers (e.g. sandbox), update the matching unit tests (constructing `SandboxScope` requires `configDir`).

## Constraints

- **Never** create tags, push, or create Releases without the user's explicit approval (local commits are always fine);
- The working directory name must not change (it breaks the dev sandbox binding).
