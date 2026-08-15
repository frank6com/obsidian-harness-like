# Harness Like — 会话交接文档（HANDOVER）

> 用途：本文件完整记录项目背景、架构决策、当前状态与**全部约束**。新会话/新 agent 接手任务时，先读本文件 + [docs/design.md](design.md) + [docs/SOP.md](SOP.md) + [docs/seams.md](seams.md)，即可无缝继续。
> 最后更新：2026-08-15（项目重命名为 harness-like 后）

---

## 1. 项目一句话

**Harness Like（harness-like）**：把 DeepSeek Harness（dsh）的体验集成进 Obsidian——在 Obsidian 插件进程内运行 Cordis 运行时，把 Obsidian API 暴露为 Cordis 服务，用户编写的 Cordis 插件可直接扩展 Obsidian（工具/命令/面板/图标/状态栏/设置页），agent 可直接操作笔记库。核心特色：**"创造模式"下 agent 能全程对话内创建/迭代插件**。

## 2. 完整约束（新会话必须遵守）

### 2.1 目录与命名
- **物理工作目录名固定为 `obsidian-harness-cordis`，禁止改名**。改名会破坏 DSH 沙箱（沙箱绑定会话工作区路径，目录 mv 后所有 bash/写操作失效、会话上下文丢失）。本次已踩坑验证。
- 插件 id / 包名 / 类名 / npm scope 已统一为 **harness-like**（`@harness-like/*`、`HarnessLikePlugin`、`HarnessLikeSettings`、`harness-like-plugin`）。
- **保留的内部协议命名（勿改）**：数据目录 `.obsidian/dsh/`（会话日志）、用户插件目录 `.obsidian/dsh-plugins/`、Cordis 服务键 `ctx.sessionLog/toolsCompat/llmCaller/sandbox/approval`、事件域 `dsh/session/event`、`dsh/waiting-approval`、`dsh/settings-updated`、日志前缀 `[dsh]`。改动这些 = 全链路迁移，收益低风险高。

### 2.2 技术约束
- 上游 dsh 包全部**锁 0.1.0-rc.6**（`@deepseek-ai/{cordis,dsh-llm,dsh-tools,dsh-session,dsh-sandbox,dsh-workspace,dsh-agent,dsh-agent-loop}`）。rc.1 依赖线引用未发布的 `dsh-type-meta`，不可用。
- **esbuild 必须保留 `node-module-shim` 插件**：dsh-llm 模块顶层 `createRequire("../package.json")` 在 Obsidian 环境必炸（历史事故），由 `apps/plugin/shims/node-module.ts` 垫片解决；`node:*` 统一剥前缀。
- obsidian@1.13 类型面缺失 `app.commands/viewRegistry/setting/workspace.addRibbonIcon/addStatusBarItem/app.addSettingTab`——运行时存在，统一在 `apps/plugin/src/obsidian-bridge.ts` 用结构断言访问。
- 插件执行机制：只执行本地预编译产物（纯 JS 免编译；TS 需本地 esbuild 构建），`@deepseek-ai/cordis` 与 `obsidian` 由宿主 require shim 注入。
- 沙箱白名单：读 = 整个 vault；写 = 笔记区 + `.obsidian/dsh/` + `.obsidian/dsh-plugins/` + 临时目录；**禁止写 `.obsidian/` 其他区域**。
- 测试基线：**104 项 vitest 全绿**（`pnpm test`）；改动必须保持全绿。

### 2.3 安全模型
- 动态插件只执行用户本地文件；运行需授权（单勾=当前版本 / 双勾=信任后续）。
- 写操作审批：默认 ask；目录白名单（设置）内免审批；工具级策略（`tool=ask|allow|deny`）最优先。
- 智能体模式：**只有创造（create）模式能创建/修改插件**；修编（edit）无插件开发工具；对话（chat）仅只读工具。
- 模型请求仅发往用户配置端点；v1 零遥测。

## 3. 当前功能全景（均已实现并验证）

### 3.1 宿主核心
- Cordis 运行时引导（onload/onunload 完整生命周期，fiber dispose 链）
- Obsidian 适配服务：`ctx.vault`（读写/建目录/事件桥）/ `editor` / `workspace` / `commands` / `views`（含 `open()` 打开面板）/ `settings` / `ribbon` / `statusbar` / `notice`
- Harness 服务：`ctx.sandbox`（vault 白名单）/ `approval`（grant + 会话级写开关）/ `sessionLog`（追加式 JSONL，串行化防竞态）/ `toolsCompat`（官方 ToolRuntime 流水线 + 审批瀑布）/ `llmCaller`（官方 LlmRuntime + DeepSeekAdapter）
- agent loop（自研，`packages/harness-base/src/agent-loop.ts`）：阶段事件、中止（AbortSignal）、孤儿消息防御

### 3.2 Chat 面板
- 会话（标题/绑定笔记/模型选择/删除/导出 Markdown，均随 `session/meta` 持久化）
- 输入区工具栏：智能体上拉菜单（向上展开）+ 模型上拉菜单（向上展开，管理入口在菜单内）
- 阶段状态条 / 工具卡片实时状态 / 流式光标 / 三态发送按钮 / 错误持久化 + 重试
- Markdown 渲染（marked + DOMPurify + 自研样式层）/ 消息复制 / 代码块复制

### 3.3 插件系统（创造模式）
- 用户插件：`.obsidian/dsh-plugins/<id>/`（package.json 含 dsh 字段 + 预编译 main.js）
- 插件管理器：发现/授权/加载/停止/重新加载/删除/授权状态展示
- 创造模式工具集：`create_plugin` / `write_plugin_file`（覆盖需确认）/ `plugin_status` / `reload_plugin`（未授权弹窗）/ `open_view` / `plugin_guide`
- 插件可注册：工具、命令、ItemView 面板、ribbon 图标、状态栏、设置页

### 3.4 智能体与模型
- 智能体预设：内置对话模式/修编模式/创造模式（可启用/禁用，禁用不出现在面板菜单）+ 自定义智能体（弹窗编辑，checkbox 勾选能力白名单）
- 默认智能体独立下拉设置；默认模型 = "providerId/model" 粒度
- 多提供方（通道）管理：端点获取模型（弹窗搜索 + 已添加关联 + 手动输入即候选）/ 模型级默认 / 自定义请求头 / temperature / max_tokens

### 3.5 设置页（tabs 分类）
模型（通道侧向列表）｜智能体｜审批（默认模式/目录白名单/工具策略）｜会话（保留天数）｜数据（清空会话）｜界面（流式/Markdown 开关）｜日志（级别）｜插件授权

## 4. 架构与关键文件

```
packages/harness-base/      纯逻辑：sandbox/approval/session-log/log/llm(官方集成)/dsh-tools(官方集成)/agent-loop
packages/obsidian-adapter/  唯一接触 Obsidian 的层：api.ts(结构化接口) + 服务
packages/plugin-runtime/    用户插件加载器（require shim + 状态机）
apps/plugin/                主入口 main.ts / 视图 ChatView·PluginManagerView / settings-tab / tools(builtin·plugin-dev) / modals / markdown / policy / mode / export / shims
docs/                       design.md(设计) / SOP.md(开发发布规范) / seams.md(seam 文档+迁移路线) / ux-checklist.md / HANDOVER.md(本文件)
research/                   调研底料（dsh README/架构文档/npm 元数据）
dev-vault/                  项目内 Obsidian 测试库（gitignore）
```

## 5. 关键技术决策（详见 design.md §6）

| # | 决策 |
|---|---|
| D1 | 进程内嵌入 dsh 官方包（锁 rc.6）；llm/tools seam 已官方化，sessions 未迁移 |
| D2 | 无子进程/无本地服务器（dsh-sandbox 为子进程约束，未采用，保留自研路径白名单） |
| D3 | 原生 Obsidian UI（Markdown 渲染为自研管线，非 MarkdownRenderer） |
| D7 | 插件只执行本地预编译产物（纯 JS 即时生效；TS 需本地构建） |
| — | 事件/服务键 dsh-* 命名空间（官方包同 key 冲突的解法） |

## 6. 未完成事项（下一步候选）

1. **UX 清单剩余**（docs/ux-checklist.md）：消息操作（重新生成/编辑重发/删除）、工具卡片折叠、会话重命名、虚拟滚动、绑定笔记选择器
2. **技术债**：Stage 3b（agent-loop 调度器替换 toolsCompat 门面）、Stage 4（sessions 迁移——**建议继续暂缓**，设计见 seams.md §3.3）、全文倒排索引
3. **发布**：远程仓库创建（名 `harness-like`）+ BRAT + 社区商店申报（P3，SOP §7）
4. 插件加载失败时的视图注册残留清理（Obsidian viewRegistry 无公开清理 API，agent 曾用换视图名绕开）
5. 协议支持（OpenAI 兼容已覆盖主流；Anthropic/Gemini 按需添加，架构已支持多 provider 注册）

## 7. 开发速查

```sh
pnpm dev            # esbuild watch + 自动同步 dev-vault 插件目录
pnpm typecheck      # 四包类型检查
pnpm test           # 104 项 vitest
pnpm build          # 产物构建 + 同步
pnpm init:vault     # 初始化 dev-vault（示例笔记/插件）
pnpm link:vault     # 文件级软链接入外部真实 vault
```

Obsidian 测试：重载插件（`dev-vault/.obsidian/plugins/harness-like/`，data.json 已迁移，设置/授权保留）。

## 8. 沟通与协作约定（用户偏好）

- 先讨论方案再动手（重大方向变更先对齐）；功能优先于技术债（用户明确选择过：功能面 > Stage 4）
- UI 遵循成熟 AI 工具模式：tabs 分类设置、上拉菜单（向上展开）、分段控件语义清晰、弹窗（搜索+滚动+按钮固定）
- 用户发现问题会直接指出逻辑/体验问题，修改要基于根因，防回归测试必须补
- 会话日志在 `dev-vault/.obsidian/dsh/sessions/*.jsonl`，排查用户报告的问题先读日志
- **重大环境操作（如目录改名）会破坏沙箱与会话，先警告用户**（本次踩坑：工作目录改名 → bash/写操作全失效、会话上下文丢失）
- 远程仓库按新命名 `harness-like` 创建；代码/文档内已全部改名完成
