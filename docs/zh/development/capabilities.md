# 已实现的能力清单（Obsidian 扩展点映射）

本页面向**开发者**：Harness Like（主插件）把 Obsidian 的哪些扩展点映射成了什么，以及 agent 内置工具按智能体模式的可用权限。

## 主插件 → Obsidian 扩展点映射

| Obsidian 扩展点 | Harness Like 的映射 |
| --- | --- |
| 命令（`app.commands`） | 主插件命令：打开 Harness Like 面板 / 打开插件管理器 / 重载已授权子插件；子插件命令自动归组为 `Harness Like: 命令（子插件id）` |
| 视图（`viewRegistry`） | 主插件面板：Chat 面板、插件管理器；子插件 ItemView 面板 |
| 设置页（`addSettingTab`） | tabs 分类设置页：模型 / 智能体 / 审批 / 会话 / 数据 / 界面 / 日志 / 插件授权 |
| 侧边栏图标（ribbon） | 主插件机器人图标（打开 Chat 面板）；子插件可注册自己的图标 |
| 状态栏（statusbar） | 子插件可注册状态栏条目 |
| `obsidian://` 协议处理器 | 统一入口 `obsidian://harness-like?plugin=<id>&cmd=<动作名>` 路由到子插件 handler（`ctx.protocol.register`） |
| 编辑器桥 | `ctx.editor`（当前编辑器选区/插入/替换） |
| 文件系统 | `ctx.vault`（读写/建目录/事件桥 `vault/create|modify|delete|rename`） |
| 工作区 | `ctx.workspace`（当前活跃文件、file-open 事件） |
| 通知 | `ctx.notice` |
| 浏览器 | `openTarget`（打开外部链接/路径） |

## 内置工具与智能体模式权限

| 工具 | 对话（只读） | 修编（读写笔记） | 创造（完整） |
| --- | :---: | :---: | :---: |
| `read_note` 读取笔记 | ✅ | ✅ | ✅ |
| `list_notes` 列出笔记 | ✅ | ✅ | ✅ |
| `search_notes` 搜索笔记 | ✅ | ✅ | ✅ |
| `write_note` 写入笔记 | — | ✅ | ✅ |
| `insert_to_editor` 编辑器插入 | — | ✅ | ✅ |
| `open_in_browser` 打开链接 | — | ✅ | ✅ |
| `plugin_guide` 插件开发指南 | — | — | ✅ |
| `create_plugin` 创建子插件 | — | — | ✅ |
| `write_plugin_file` 写子插件文件 | — | — | ✅ |
| `check_plugin` 校验子插件代码（语法/禁用 API） | — | — | ✅ |
| `plugin_status` 子插件状态 | — | — | ✅ |
| `reload_plugin` 重载子插件 | — | — | ✅ |
| `open_view` 打开子插件面板 | — | — | ✅ |

> 自定义智能体通过能力白名单（勾选工具）覆盖上述内置权限。

## 子插件可注册的扩展点

工具（`ctx.toolsCompat.register`）、命令、ItemView 面板、ribbon 图标、状态栏、设置页、界面翻译（`ctx.dshI18n`）、obsidian:// 深链动作（`ctx.protocol.register`）——签名见[服务速查](/zh/dev/services)。完整说明见[开发你的第一个插件](/zh/dev/hello-world)。
