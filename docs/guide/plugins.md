# 用户插件体系

用户插件是运行在 Obsidian 内的 **Cordis 插件**（非 Obsidian 原生插件），位于 `.obsidian/harness-like-plugins/<id>/`（一个 `package.json` + 编译好的 `main.js`），通过 `ctx.*` 服务适配 Obsidian，可注册：

- 工具（agent 可调用）
- 命令（自动以 `Harness Like: 命令（插件id）` 归组显示）
- 自定义面板（ItemView）
- 侧边栏图标、状态栏、设置页

## 获取插件

- **对话内创建**：切到「创造模式」，让 agent 用 `create_plugin` → `write_plugin_file` → `reload_plugin` 三步产出插件。
- **手动放置**：复制插件目录到 `.obsidian/harness-like-plugins/<id>/`。

## 插件管理器

对话面板头部右侧「插件管理器」按钮：

- 刷新 / 打开插件目录；
- **授权并加载**（单勾/双勾）→ 运行中可：打开面板、重新加载、停止、删除；
- 状态行显示能力徽章（面板/命令/工具/图标/状态栏/设置页）与授权信息。

## 示例

仓库 `apps/plugin/examples/my-first-plugin/`（含预编译产物，可直接复制）。开发文档见本站[插件开发](/dev/hello-world)章节。
