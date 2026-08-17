# 开发流程

## 每日循环

1. `pnpm dev`：esbuild watch，每次构建后自动把产物同步到：
   - **仓库根目录**（官方插件包：main.js / manifest.json / styles.css / versions.json，必须入库）；
   - **dev-vault/**（项目内 Obsidian 测试库，整个目录 gitignore）。
2. 在 Obsidian 中打开 `dev-vault` 测试；不生效时手动重载插件（或完全重启 Obsidian）。
3. 改代码 → 构建 → 测试 → 提交。

## 提交规范

- 提交信息：`feat|fix|chore|docs|refactor(scope): 摘要`；
- **每次提交必须同步版本号**（见[版本号规范](/zh/development/versioning)）；
- 提交前 `pnpm typecheck && pnpm test` 全绿 + 手动验收（Chat 面板、插件加载、审批链路）。

## 测试注意

- 会话日志在 `dev-vault/.obsidian/harness-like/sessions/*.jsonl`——排查用户报告的问题先读日志；
- 修改 sandbox 等纯逻辑层时同步更新对应单测（构造 `SandboxScope` 需含 `configDir`）。

## 约束

- **未经用户明确同意，禁止**：创建 tag、推送远程、创建 Release（本地提交可随时做）；
- 工作目录名不可变更（破坏开发沙箱绑定）。
