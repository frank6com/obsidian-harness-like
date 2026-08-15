# Release & Review

## Release flow

1. `pnpm typecheck && pnpm test` green + manual acceptance;
2. Bump the version ([Versioning](/en/development/versioning)), `pnpm build` to refresh the root plugin package;
3. Commit, push, then tag (**tag name = manifest version, no `v` prefix**, e.g. `0.28.21`);
4. Pushing the tag triggers the automated release workflow: CI build → Artifact Attestations (build provenance) → creates the release with `main.js` / `manifest.json` / `styles.css` assets;
5. The Obsidian official review passes automatically → published.

## Store review checklist (before every revision)

- manifest `description` ≤ 250 chars and **must not contain "Obsidian"**;
- release must attach all three assets (committing to the repo is not enough);
- **minAppVersion compatibility**: avoid APIs newer than minAppVersion (`workspace.revealLeaf` needs 1.7.2 → use `setActiveLeaf`; `setDestructive` needs 1.13 → use `setWarning`; `FileManager.trashFile` needs 1.6.6 — careful);
- Settings headings via `Setting.setHeading()`, never raw `h4`;
- Rendering via the official `MarkdownRenderer` (no innerHTML);
- Style changes via CSS classes (textarea auto-grow uses `field-sizing: content`);
- Repository has a LICENSE (MIT); `versions.json` includes the current version.

## Local pre-check

Run `eslint-plugin-obsidianmd` (recommended) + `typescript-eslint` — all Errors must be zero.
