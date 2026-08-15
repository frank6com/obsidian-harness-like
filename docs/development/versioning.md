# 版本号规范

正式发布前采用 `0.x.y`，**版本号是开发进展的镜像**：

- **x（次版本）= 功能批次累计**：每个 `feat` 提交 +1；
- **y（补丁）= 修复/重构批次累计**：每个 `fix`/`refactor` 提交 +1；
- `docs`/`chore` 不强制递增；同一提交含多类内容按最高位 +1。

每次提交必须同步更新：

1. `apps/plugin/manifest.json` 与 `apps/plugin/package.json` 的 `version`（一致）；
2. `apps/plugin/versions.json`（新增 `"版本": "1.5.0"` 映射）；
3. README 顶部状态行、本地 HANDOVER 的"当前状态"。

当前基线：**0.28.21**（28 个功能批次 + 21 个修复批次）。**发布 1.0.0 后切换标准 semver**（feat → minor、fix → patch、破坏性 → major）。
