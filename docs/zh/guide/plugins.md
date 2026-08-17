# 用户插件体系

用户插件是运行在 Obsidian 内的 **Cordis 插件**（由 Harness Like 加载），用于扩展命令、工具、面板等能力。

## 两种获得方式

- **对话创建（推荐，零代码）**：创造模式下让 agent 直接创建、加载并打开——见[通过对话创建插件](/zh/guide/plugin-agent)；
- **手动放置**：把插件目录复制到 vault 的 `.obsidian/harness-like-plugins/<id>/`（含 `package.json` 与编译好的 `main.js`）。

## 授权与加载

对话面板头部右侧「插件管理器」：

- **授权并加载**：单勾 = 仅信任当前版本；双勾 = 信任后续所有版本；
- 运行中可：**打开面板 / 重新加载 / 停止 / 删除**；
- 授权记录可在 设置 → 插件授权 查看/撤销。

## 使用子插件注册的命令

子插件注册的命令会在命令面板中显示为 `Harness Like: 命令（子插件id）`（如 `Harness Like: 打开面板（folder-stats）`）——打开命令面板（Ctrl/Cmd+P）搜索 "Harness Like" 即可找到；也可以直接问 agent 帮你执行。

## 备份与迁移

子插件 = `.obsidian/harness-like-plugins/<id>/` 下的文件（package.json + main.js）。**备份/迁移 = 复制该目录**：

1. 把整个 `.obsidian/harness-like-plugins/`（或单个子插件目录）复制到新 vault 的相同位置；
2. 在新 vault 中打开插件管理器 →「授权并加载」（重新授权一次即可）。

## 安全

- 插件只执行本地文件（`.obsidian/harness-like-plugins/`），不会下载或远程执行代码；
- 插件的写操作仍走审批链，不会绕过安全模型。

## 进阶

想手写插件？见[开发文档 → 用户插件开发](/zh/development/index)。
