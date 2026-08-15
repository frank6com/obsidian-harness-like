# 已实现的能力清单

agent 在对话中可调用的能力一览（工具按当前智能体模式的权限过滤）。

## 内置工具（对话模式起即可用）

| 工具 | 说明 |
| --- | --- |
| `read_note` | 读取 vault 中一篇笔记的完整内容 |
| `write_note` | 写入/覆盖笔记（写操作走审批链） |
| `list_notes` | 列出笔记（可按文件夹过滤、限制条数） |
| `search_notes` | 全文关键词搜索笔记（标题与内容） |
| `insert_to_editor` | 向当前编辑器光标处插入文本 |
| `open_in_browser` | 在系统浏览器打开链接 |

## 插件开发工具（创造模式专属）

| 工具 | 说明 |
| --- | --- |
| `plugin_guide` | 获取插件开发指南（模板与 API 速查） |
| `create_plugin` | 创建插件骨架（目录 + package.json） |
| `write_plugin_file` | 写入/覆盖插件内文件（覆盖需用户确认） |
| `plugin_status` | 查看插件运行状态与加载错误 |
| `reload_plugin` | 停止并重新加载插件（未授权先弹授权） |
| `open_view` | 打开插件注册的面板视图 |

## 用户插件可注册的能力

通过 `ctx.*` 服务（详见[插件开发](/dev/hello-world)）：

- **工具**：agent 可调用的自定义工具（`ctx.toolsCompat.register`）
- **命令**：命令面板条目（自动归组 `Harness Like: 命令（插件id）`）
- **面板**：自定义 ItemView 视图（`ctx.views.registerView`）
- **侧边栏图标 / 状态栏 / 设置页**：`ctx.ribbon` / `ctx.statusbar` / `ctx.settings`
- **翻译**：键级覆盖界面文案（`ctx.dshI18n`）

## 宿主服务（ctx.*）

`vault`（读写/建目录/事件）、`editor`、`workspace`、`commands`、`views`、`settings`、`ribbon`、`statusbar`、`notice`、`sandbox`、`approval`、`sessionLog`、`llmCaller`、`dshI18n`——完整签名见[服务速查](/dev/services)。
