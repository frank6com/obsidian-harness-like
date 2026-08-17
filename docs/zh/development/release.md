# 发布与审核

## 发布流程

1. `pnpm typecheck && pnpm test` 全绿 + 手动验收；
2. 按[版本号规范](/zh/development/versioning) bump 版本，`pnpm build` 确保根目录插件包为最新；
3. 提交推送后打 tag（**tag 名 = manifest 版本号，严禁带 `v` 前缀**，如 `0.28.21`）；
4. push tag 触发全自动发布工作流：CI 构建 → 生成 Artifact Attestations（构建来源证明）→ 创建 release 并上传 `main.js` / `manifest.json` / `styles.css` 资产；
5. Obsidian 官网自动检查通过后即发布。

## 商店审核自查清单（每次修订后必查）

- manifest `description` ≤ 250 字符且**不含 "Obsidian" 一词**；
- release 必须附带三个资产文件（仅提交入库不够）；
- **minAppVersion 兼容**：禁用高于 minAppVersion 的 API（如 `workspace.revealLeaf` 需 1.7.2 → 用 `setActiveLeaf`；`setDestructive` 需 1.13 → 用 `setWarning`；`FileManager.trashFile` 需 1.6.6 慎用）；
- 设置标题用 `Setting.setHeading()`，不用手写 `h4`；
- 渲染走官方 `MarkdownRenderer`（禁 innerHTML）；
- 样式赋值走 CSS 类（textarea 自动增高用 `field-sizing: content`）；
- 仓库含 LICENSE（MIT）；`versions.json` 含当前版本映射。

## 本地预检

用 `eslint-plugin-obsidianmd`（recommended）+ `typescript-eslint` 跑一遍，Error 必须清零。
