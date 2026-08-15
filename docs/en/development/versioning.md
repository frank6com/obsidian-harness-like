# Versioning

Before 1.0, use `0.x.y` — **the version mirrors development progress**:

- **x (minor) = cumulative feature batches**: every `feat` commit +1;
- **y (patch) = cumulative fix/refactor batches**: every `fix`/`refactor` commit +1;
- `docs`/`chore` commits don't require a bump; mixed commits bump the highest relevant digit.

Every commit must update:

1. `apps/plugin/manifest.json` and `apps/plugin/package.json` `version` (kept in sync);
2. `apps/plugin/versions.json` (add `"version": "1.5.0"` mapping);
3. README status line and the local HANDOVER "current status".

Current baseline: **0.28.21** (28 feature batches + 21 fix batches). **Switch to standard semver after 1.0.0** (feat → minor, fix → patch, breaking → major).
