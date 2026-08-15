# 快速开始

## 安装

在 Obsidian 内：设置 → 第三方插件 → 浏览 → 搜索 "Harness Like" 安装并启用（**仅限桌面端**）。

手动安装（备选）：从仓库根目录复制 `main.js`、`manifest.json`、`styles.css` 到 vault 的 `.obsidian/plugins/harness-like/`。

## 配置模型

1. 点击侧边栏机器人图标（或命令面板运行「打开 Harness Like 面板」）。
2. 面板头部右侧「插件管理器」旁打开设置：设置 → 第三方插件 → Harness Like。
3. 进入「模型」tab：
   - 已有预置 DeepSeek 通道，填入 **API Key**；
   - 点「从端点获取」拉取模型列表（或手动输入添加）；
   - 将常用模型设为「默认」。

## 第一次对话

在输入框输入示例问题：

- "统计 vault 里有多少笔记"
- "搜索包含'读书'的笔记"
- "总结当前笔记的要点"（可先勾选工具栏「仅当前笔记」）

agent 会调用工具并展示卡片；写操作会弹出审批，按需允许。

## 下一步

- [对话面板详解](/guide/chat)
- [智能体与模型](/guide/agents-models)
- [审批与安全](/guide/approval)
- [用户插件体系](/guide/plugins)
