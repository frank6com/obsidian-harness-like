# 快速开始

## 安装（主插件）

从 **Obsidian 官方插件目录**安装：[Harness Like](https://community.obsidian.md/plugins/harness-like)（仅限桌面端）。

Obsidian 内操作：设置 → 第三方插件 → 浏览 → 搜索 **Harness Like** → 安装 → 启用。

手动安装（备选）：从 GitHub 仓库根目录复制 `main.js`、`manifest.json`、`styles.css` 到 vault 的 `.obsidian/plugins/harness-like/`。

## 配置模型

1. 点击左侧边栏的机器人图标，或运行主插件命令「打开 Harness Like 面板」；
2. 打开主插件设置（设置 → 第三方插件 → Harness Like）→「模型」tab：
   - 已有预置 DeepSeek 通道，填入 **API Key**；
   - 点「从端点获取」拉取模型列表，或手动输入添加；
   - 把常用模型「设为默认」。

## 第一次对话

输入示例问题：

- "统计 vault 里有多少笔记"
- "搜索包含'读书'的笔记"
- "总结当前笔记的要点"（可先勾选工具栏「仅当前笔记」）

agent 会调用工具并展示卡片；写操作会弹出审批，按需允许。

## 主插件命令（命令面板中可用）

| 命令 | 作用 |
| --- | --- |
| 打开 Harness Like 面板 | 打开对话面板（等同点击机器人图标） |
| 打开 Harness Like 插件管理器 | 打开子插件管理界面 |
| 重载已授权的用户插件 | 重新加载已授权的子插件 |

> 子插件注册的命令会显示为 `Harness Like: 命令（子插件id）`，同样在命令面板使用，见[用户插件体系](/guide/plugins)。

## 下一步

- [对话面板详解](/guide/chat)（含会话导出）
- [智能体与模型](/guide/agents-models)（三种模式的用途）
- [在对话中描述需求](/guide/speak-to-agent)（Obsidian 区域术语与对话表述）
- [通过对话创建插件](/guide/plugin-agent)
