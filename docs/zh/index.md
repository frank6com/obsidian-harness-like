---
layout: home

hero:
  name: Harness Like
  text: 在 Obsidian 内运行 Cordis 插件体系与 AI agent
  tagline: DeepSeek Harness 理念的 Obsidian 实现——agent 带审批读写笔记，可在对话内创建 Cordis 插件，扩展命令、工具与面板。仅限桌面端。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/quickstart
    - theme: alt
      text: 插件开发指南
      link: /zh/dev/hello-world

features:
  - title: 对话 + 工具
    details: 流式输出、工具卡片实时状态、阶段提示条、停止/重试
  - title: 带审批的笔记操作
    details: 写操作按「工具级策略 → 仅当前笔记 → 目录白名单 → 审批弹窗」逐级放行
  - title: 创造模式
    details: 在对话里让 agent 创建、迭代、重载你自己的 Cordis 插件
  - title: 智能体与模型
    details: 内置对话/修编/创造三模式 + 自定义智能体；多模型提供方、模型级默认
  - title: 中英文界面
    details: 跟随 Obsidian 语言自动切换；翻译插件可键级覆盖界面文案
  - title: 隐私优先
    details: 零遥测，模型请求只发往你配置的端点
---

## 快速上手

1. 在 [Obsidian 社区插件目录](https://community.obsidian.md/plugins/harness-like) 安装 Harness Like（仅桌面端）。
2. 打开插件设置 →「模型」，填入 API Key（已预置 DeepSeek 端点），添加模型并设置默认。
3. 点击侧边栏机器人图标，试试示例问题："统计 vault 里有多少笔记"。

> 安装与使用细节见 [快速开始](/zh/guide/quickstart)。
