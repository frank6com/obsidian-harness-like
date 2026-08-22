# 项目概览

![对话创建游戏插件](/screenshots/zh/CreateAGame.gif)

## 这是什么？

Harness Like 是 DeepSeek Harness 理念的 Obsidian 实现：在 Obsidian 插件进程内嵌入 Cordis 运行时，把 Obsidian 的 API 暴露为 Cordis 服务，让 agent 可以通过工具读写你的笔记，同时为了保障数据安全全程带人工审批；而在**创造模式**下，甚至能按照你的想法完全通过对话创建、迭代并重载你自己的 **Cordis 插件**，让您的想法言出法随。

（注意此并非 Obsidian 原生插件，而是通过本插件针对 Obsidian 提供的扩展点适配的 Cordis 插件）

## 一个直观的例子

上面的动画演示了完整流程：在对话里说一句"帮我创建一个能玩的小游戏插件"，agent 就自动完成了插件创建、代码编写、加载与面板打开——**零代码，纯对话**。

## 核心概念

- **主插件**：Harness Like 本身——负责对话、agent、审批、设置与子插件管理；
- **子插件**：你（或 agent）创建的 Cordis 插件，可注册工具、命令、面板、侧边栏图标、状态栏与设置页。

## 界面一览

![对话面板](/screenshots/zh/Chat.png)
![设置 — 模型](/screenshots/zh/Settings.gif)
![插件管理器](/screenshots/zh/Plugins.png)

## 下一步

- [快速开始](/zh/guide/quickstart)
- [通过对话创建插件](/zh/guide/plugin-agent)
- [已实现的能力清单](/zh/development/capabilities)
