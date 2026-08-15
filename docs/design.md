# harness-like 设计文档

> 状态：草案 v0.1 ｜ 日期：2026-08-14 ｜ 上游基线：`@deepseek-ai/dsh` 0.1.0-rc.6（开发者预览期，官方声明存在破坏性变更）
>
> 一句话定位：**让 Obsidian 成为 DeepSeek Harness 的宿主**——在 Obsidian 插件进程内运行一个 Cordis 运行时，把 Obsidian 的 API 暴露为 Cordis 服务，使用户编写的 Cordis 插件可以直接扩展 Obsidian（注册服务、工具、命令、原生面板）。

---

## 1. 背景与目标

用户深度使用 DeepSeek Harness（dsh），尤其喜欢其 Cordis 插件体验：动态插件 define → run → 审批 → 生效，服务/工具/UI 皆可插件化，副作用可逆。目标是把这个体验带进 Obsidian 笔记库，让 agent 与插件体系直接作用于 vault。

经确认的产品方向：

| 维度 | 决策 |
|---|---|
| 核心体验 | **用 Cordis 插件体系来扩展 Obsidian**（插件作者视角） |
| 平台 | 桌面端（Electron renderer） |
| 发布 | 最终上 Obsidian 社区商店；先用 BRAT 自用迭代 |
| 上游策略 | 依赖 dsh 官方 npm 包（锁版本），语义对齐 dsh 的插件编写模型 |

## 2. 范围与非目标

**范围内（v1）**

- 进程内 Cordis 运行时 + Obsidian API 适配层（vault / editor / workspace / commands / views / settings）
- 原生 UI：聊天面板（ChatView）、插件管理器（PluginManagerView）、设置页（SettingsTab）
- 动态插件子系统：define / run / stop / undefine / update / rollback + 审批与 grant
- 会话日志持久化（追加式 JSONL）与重放渲染
- 模型适配：OpenAI 兼容端点（默认 DeepSeek API），fetch 直连
- 沙箱：作用域 = vault 根 + 临时目录；写操作默认审批

**非目标（v1）**

- 不嵌 dsh Web GUI；不起本地 HTTP 服务器；不 spawn 子进程（审核友好、生命周期简单）
- 不支持移动端（Capacitor 无 renderer 内 Node 能力）；将来可做"远程 dsh 实例客户端"形态，另立设计
- 不做 dsh Web GUI 专属插件的二进制兼容；仅对齐"服务 / 事件 / 工具"语义层
- 不做云服务、账号体系、商业功能

## 3. 术语

| 词 | 含义 |
|---|---|
| Cordis | dsh 底层的插件框架（本项目直接依赖 `@deepseek-ai/cordis`） |
| profile / bundle | dsh 的分层组合概念：profile 是具名组装，bundle 是配置项 + 挂载代码的分发单元 |
| seam | 一项可替换能力：Service Definition + Service Provider + Consumer（如 `fs/*`、`tools/*`、`llm`） |
| 会话事件 | 追加到日志并经 `session/event` 广播的持久事实（`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*`） |
| 动态插件 | 运行时 define/run/stop 的 Cordis 插件；pluginId / packageId / runId 语义沿用 dsh |
| grant | 审批授权：单勾 = 仅当前版本，双勾 = 信任后续版本 |
| 沙箱 | 对工具可触达的文件系统范围的限制（v1 无子进程，进程沙箱不适用） |

## 4. 总体架构

### 4.1 进程模型

- Obsidian 桌面插件运行于 Electron renderer 进程，可用 Node 内置模块；本项目所有依赖以纯 JS bundle 内联（esbuild），**无外部进程、无本地服务器**。
- 模型请求走 renderer 的 `fetch` 直连用户配置的端点。
- 生命周期与 Obsidian 绑定：随插件 enable/disable 启动/停止，无端口、无孤儿进程问题。

### 4.2 组件图

```
┌ Obsidian 应用（renderer 进程）────────────────────────────────┐
│ ┌ main.ts 引导 ────────────────────────────────────────────┐ │
│ │  PluginAdapter.onload / onunload                         │ │
│ │   └─ Cordis App(ctx)                                     │ │
│ │        ├─ bundles/obsidian-adapter（自研）                │ │
│ │        │    ctx.vault · ctx.editor · ctx.workspace       │ │
│ │        │    ctx.commands · ctx.views · ctx.settings      │ │
│ │        │    ctx.ribbon · ctx.statusbar · ctx.notice      │ │
│ │        ├─ bundles/harness-base（自研装配）                │ │
│ │        │    ctx.llm 适配器注册 · 模型配置/凭据           │ │
│ │        │    审批 UI 桥（原生 modal）· 遥测关闭            │ │
│ │        ├─ dsh 官方包（锁版本依赖，见 5.3）                │ │
│ │        │    dsh-agent · dsh-llm · dsh-tools              │ │
│ │        │    dsh-session · dsh-sandbox · dsh-workspace    │ │
│ │        └─ 用户插件（.obsidian/dsh-plugins/<id>/）         │ │
│ │             动态加载的 Cordis 插件（本地文件，仅本地执行） │ │
│ └──────────────────────────────────────────────────────────┘ │
│  UI：ChatView │ PluginManagerView │ SettingsTab               │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 仓库布局（pnpm workspace）

```
obsidian-harness-cordis/
├─ apps/plugin/                  # Obsidian 插件产物（main.ts、manifest.json、esbuild）
├─ packages/obsidian-adapter/    # Obsidian API → Cordis 服务（唯一接触 obsidian 依赖的层）
├─ packages/harness-base/        # dsh 包装配 + 模型配置/凭据 + 审批 UI 桥
├─ packages/plugin-runtime/      # 动态插件加载、审批、grant 状态机
├─ packages/ui/                  # ChatView / PluginManagerView / SettingsTab
├─ docs/                         # design.md、SOP.md、plugin-author-guide.md（P1 产出）
└─ research/                     # 调研底料（dsh README、架构文档、npm 元数据等）
```

**分层纪律：只有 `obsidian-adapter` 依赖 Obsidian API**，其余包只面向 Cordis 服务接口——这是应对 Obsidian API 变更的隔离墙。

### 4.4 生命周期

- `onload`：读配置 → `new App(ctx)` → 按序挂载内置 bundles → 加载用户插件 → 注册视图/命令/设置。
- `onunload`：`ctx.stop()`。Cordis 保证所有注册（监听器、工具、视图）作为可逆副作用被撤销。
- 崩溃恢复：会话日志为追加式 JSONL，启动时重放渲染 UI，不依赖易失内存状态。

## 5. 核心设计

### 5.1 引导与组合

- 借鉴 dsh 的 profile/bundle 分层：内置组合 = `obsidian-adapter` + `harness-base`；用户插件从 `.obsidian/dsh-plugins/<id>/` 挂载到同一棵树。
- 用户插件通过 `inject` 声明服务依赖，就绪顺序由 Cordis 管理（与 dsh 一致）。
- v1 可选：vault 内 `dsh.patch.yml` overlay（对齐 dsh 的 patch 语义）。

### 5.2 Obsidian 适配层服务清单（v1）

| 服务 key | 职责 | 关键方法 / 事件 |
|---|---|---|
| `ctx.vault` | 文件读写、元数据、监听 | `read/write/create/delete/rename`、`on('modify'|'create'|'delete')` |
| `ctx.editor` | 活动编辑器、选区、插入替换 | `getActiveEditor()`、`insertText()`、`replaceRange()`、`getSelection()` |
| `ctx.workspace` | 视图/布局/活跃文件 | `getActiveFile()`、`getLeavesOfType()`、`on('file-open')` |
| `ctx.commands` | 注册 Obsidian 命令 | `addCommand({id, name, callback, checkCallback})` |
| `ctx.views` | 注册自定义 ItemView 类型 | `registerView(type, creator)` |
| `ctx.settings` | 设置读写与设置页注册 | `get/set`、`registerSettingTab()` |
| `ctx.ribbon` / `ctx.statusbar` | UI 杂项 | `addRibbonIcon()`、`setStatusBar()` |
| `ctx.notice` | 通知 | `notice(msg)` |

用户 Cordis 插件 `inject` 这些服务即可扩展 Obsidian——这就是"用 Cordis 扩展 Obsidian"的交付形态。

### 5.3 harness 层依赖清单（精确锁版本）

| 包 | 当前版本（2026-08-14 核对） | 用途 |
|---|---|---|
| `@deepseek-ai/cordis` | 4.0.1 | 运行时内核 |
| `@deepseek-ai/dsh-agent` | 0.1.0-rc.6 | Agent 接口、活跃 agent 注册表、`agent/*` 事件 |
| `@deepseek-ai/dsh-llm` | 0.0.1-rc.1 | 消息/流式词汇表、适配器 seam（`ctx.llm`） |
| `@deepseek-ai/dsh-tools` | 0.0.1-rc.1 | 工具注册与执行流水线（`ctx.tools`） |
| `@deepseek-ai/dsh-session` | 0.0.1-rc.1 | 会话事件日志与存储（`ctx.sessions`） |
| `@deepseek-ai/dsh-sandbox` | 0.0.1-rc.1 | 沙箱与审批原语（`ctx.sandbox`） |
| `@deepseek-ai/dsh-workspace` | 0.0.1-rc.1 | 工作区根目录语义（vault 根即工作区根） |

**自研 `harness-base` 需要补的缺口**：dsh 的 `dsh-base` bundle（模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测）目前仅存在于 monorepo，未单独发布到 npm——装配与缺失部分的实现由我们完成。全部包均发布 `lib/index.js` + 类型声明，esbuild 可直接打包进 renderer。

### 5.4 seam 对接（对齐 dsh 架构文档）

| seam | 本项目对接方式 |
|---|---|
| 文件系统 `fs/*` | 注册 `ctx.fs` 提供方，工作区根 = vault 根；读写白名单策略（见 5.8）通过 `fs/*` 事件挂接 |
| 沙箱 `ctx.sandbox` | 允许范围 = vault 根 + 临时目录；写操作默认 `ask`，读操作默认 `allow` |
| 模型 `ctx.llm` | 注册 OpenAI 兼容适配器（默认 DeepSeek 端点；baseURL / key / 模型名可配置） |
| 会话 `ctx.sessions` | 追加式 SessionEvent 日志 → `.obsidian/dsh/sessions/<id>.jsonl`；UI 从日志渲染/回放 |
| 工具 `ctx.tools` | 内置 vault 工具：read/write、search（v1 = 文件名/标题/链接搜索，基于 metadataCache；全文倒排索引 P1）、graph 查询；schema 进入提示词组装；用户插件可注册新工具 |
| 事件域 | 复用 dsh 分类：`session/event`（持久）、`agent/*`（实时）、`fs|tools|telemetry/*`（能力策略）；waterfall 事件：`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre-execute`、`tools/execute`、`tools/post-execute`；serial：`agent/turn-stopping` |

### 5.5 动态插件子系统

- **存储**：每个插件一个目录 `.obsidian/dsh-plugins/<id>/`（`package.json` + `src/` + 编译产物 `main.js`）。**只执行用户本地编写的文件，绝不自动下载/执行远程代码**（商店审核与安全底线）。执行机制见 5.5.1。
- **为什么不放插件自身目录**（`.obsidian/plugins/harness-like/`）：该目录由 Obsidian 插件管理器/更新流程接管，发布更新会覆盖目录内的发布文件，官方仅保证 `data.json` 保留——用户插件源码放进去会在每次升级/卸载时被删除。用户内容一律放 vault 级目录（`.obsidian/dsh-plugins/`），随 vault 备份/同步，与插件生命周期解耦。我们的插件目录只承载**内置示例插件模板**（只读，用户复制到 `.obsidian/dsh-plugins/` 后创作）。
- **状态机**：`defined → (审批) → running → stopped`；update / rollback 语义对齐 dsh 动态插件（保留 pluginId / packageId / runId 概念）。
- **审批与 grant**：define 不执行；run 需用户确认（原生 modal）；单勾 = 仅当前版本，双勾 = 信任后续版本；grant 持久化到插件 data.json。
- **管理 UI**：PluginManagerView 列出插件/版本/运行状态/诊断（对齐 dsh 的 run 卡片概念），提供 define / run / stop / undefine / update / rollback。
- **与 Obsidian 的关系**：用户插件注册的 command / view 直接出现在 Obsidian 命令面板与侧边栏。

### 5.5.1 插件执行机制（v1 定稿）

用户插件目录同时含**源码**（`src/main.ts`）与**编译产物**（`main.js`）。v1 推荐方案：**只执行本地预编译产物**——插件作者在目录内运行项目附带的构建脚本（esbuild CLI，纯本地）生成 `main.js`，运行时由 `plugin-runtime` 包读取产物文本、以受控方式加载并执行（支持 dispose，随插件 stop 卸载）。

- 不内置即时编译器：避免把 esbuild-wasm（约 10MB）打进插件，也缩小"运行时执行任意代码"的面（产物是用户自己编译的本地文件）。
- 纯 JS 插件可免编译直接加载；TS 插件必须过本地构建脚本（与 Obsidian 插件自身的开发模式一致）。
- `package.json` 的 `dsh` 字段约定（v1 定稿）：`{ id, version, entry: "main.js", minVersion }`，加载前校验字段与目录归属。
- 该工作流与 dsh Web GUI 的"界面内编辑源码"体验不同（这里是 vault 文件 + 本地构建）。PluginManagerView 内嵌源码编辑器 + 保存即构建列为 P2 优化项。

### 5.6 UI 组件

| 组件 | 内容 |
|---|---|
| ChatView（ItemView） | 会话列表 + 消息流 + 工具调用卡片（展示与审批入口）+ 输入框 + 会话级"允许写"开关；从 `session/event` 渲染 |
| PluginManagerView | 插件/版本/状态/审批入口/诊断 |
| SettingsTab | 模型（提供方 / baseURL / API key / 模型名）、审批策略默认值、会话保留策略、日志级别 |

不做 dsh Web GUI 的移植，按 Obsidian 原生风格实现（商店体验一致性）。

### 5.6.1 会话模型（v1 定稿）

- 会话可**绑定笔记**（会话记录 `notePath` 字段）：绑定后 agent 自动获得该笔记的内容与元数据上下文（经 `agent.inject()` 注入）；打开另一篇笔记可切换绑定或新建绑定会话。
- 同时支持**全局会话**（不绑定笔记，行为对齐 dsh Web GUI 的会话列表）。
- ChatView 顶部显示当前绑定笔记，可一键切换/解除。
- 活跃文件变化时（`workspace.on('file-open')`），UI 提示"是否将当前会话绑定到新笔记"（默认不自动切换，避免打断）。

### 5.7 数据与持久化

| 数据 | 位置 | 说明 |
|---|---|---|
| 插件配置 | `<vault>/.obsidian/plugins/harness-like/data.json` | Obsidian 标准 |
| 会话日志 | `.obsidian/dsh/sessions/*.jsonl` | 追加式；损坏时归档重建 |
| 用户插件 | `.obsidian/dsh-plugins/` | 本地源码 |
| 凭据 | `data.json`（明文，Obsidian 惯例） | 文档提示风险；支持系统钥匙串为后续优化项 |

### 5.8 安全模型

1. 动态代码 = 用户本地编写；不执行远程代码。
2. 工具执行经过 `ctx.sandbox` + 审批流水线（对齐 dsh 的 `tools/pre-execute → execute → post-execute` + ask 策略）。
3. 沙箱范围（白名单，v1 定稿）：
   - **读**：整个 vault 根 + 临时目录
   - **写**：vault 内笔记区、`.obsidian/dsh/`（本插件数据）、`.obsidian/dsh-plugins/`（用户插件）、临时目录
   - **拒绝**：vault 外任何路径；`.obsidian/` 内其他区域（如 `plugins/`、`app.json`、`workspace.json`）——防止 agent 改动 Obsidian 自身配置
   - 写操作默认 `ask`，读操作默认 `allow`；ChatView 提供**会话级"本会话允许写"开关**（一次性放宽到会话结束，不持久化）
4. 模型请求仅发往用户配置的端点；v1 不采集任何遥测/统计上报数据。
5. 商店审核材料：完整开源、无混淆、动态插件模型与审批语义说明。

## 6. 关键技术决策（ADR 摘要）

| # | 决策 | 理由 | 代价 / 风险 |
|---|---|---|---|
| D1 | 进程内嵌入 dsh 官方包（精确锁版本） | 语义兼容、省自研量 | rc 期版本漂移 → SOP §8。实施状态：依赖已对齐 0.1.0-rc.6 并锁版；服务替换按 seams.md §5 分阶段（llm→tools→sessions→agent） |
| D2 | 无子进程 / 无本地服务器 | 审核友好、生命周期简单 | 无 shell 类工具（v1 接受） |
| D3 | 原生 Obsidian UI 而非嵌入 Web GUI | 商店体验一致、无 CSP 问题 | UI 工作量 |
| D4 | 会话/插件数据放 vault 内 | 用户可见、可备份 | 大 vault 性能 → 懒渲染 + 索引 |
| D5 | 先 BRAT 自用，后商店申报 | 快速迭代 | 无 |
| D6 | 对齐 dsh 语义层，不承诺二进制兼容 | 明确边界 | 需文档写清 |
| D7 | 插件只执行本地预编译产物（源码 + 本地构建脚本） | 体积小、审核友好、机制简单 | 无内嵌编辑器（P2 优化项） |
| D8 | 搜索工具 v1 = 文件名/标题/链接（metadataCache）；全文索引 P1 | 零索引成本、P0 可用 | 全文搜索体验推迟 |
| D9 | 会话可绑定笔记 + 注入当前笔记上下文；支持全局会话 | 贴合笔记场景 | 绑定/切换交互需打磨 |
| D10 | 审批默认每次 ask + 会话级"允许写"开关 | 安全与顺手平衡 | 会话级放宽需明确提示 |

## 7. 里程碑与验收标准

### P0 骨架（目标 3–5 天）
- [x] 插件可 BRAT 安装；onload 启动 Cordis 运行时，onunload 干净 teardown（console 无泄漏错误）※需真实 Obsidian 验证
- [x] `ctx.vault` / `ctx.editor` 服务可用；示例用户插件（本地编译产物）注册 1 条命令 + 1 个工具 ✅（冒烟测试覆盖）
- [x] ChatView 能对话（DeepSeek API，key 来自设置页）※需真实 Obsidian 验证
- [x] 写操作触发原生审批 modal；grant 持久化 ※需真实 Obsidian 验证
- [x] 会话日志追加写入，Obsidian 重启后恢复渲染；会话可绑定当前笔记（注入笔记上下文）※恢复渲染需真实 Obsidian 验证

**P0 实施记录（2026-08-14）**：workspace 结构与四层包、Cordis 引导、全部适配/服务、agent 循环、内置工具、三个 UI 组件、插件加载器（预编译产物 + require shim）、示例插件模板（含预编译产物）、35 项单元/冒烟测试通过、产物 404KB。偏差与已知限制：
1. `packages/ui` 未单列，视图实现在 `apps/plugin/src/views/`（P1 视需要拆分）。
2. P0 的 `ctx.llm/tools/sessions/sandbox` 为**自研薄层**（形状对齐 dsh），P1 替换为 dsh 官方包（D1 的兑现路径）。
3. obsidian@1.13 类型面不再暴露 `app.commands/viewRegistry`，桥接层以结构断言访问（运行时存在，`apps/plugin/src/obsidian-bridge.ts`）。
4. `write_note` 新建文件要求父目录已存在（vault.create 限制，P1 补 mkdir）。
5. 会话绑定笔记（notePath）当前为内存态，持久化随会话元数据列入 P1。

### P1 插件系统（2–4 周）
- [ ] PluginManagerView 完整状态机（define/run/stop/undefine/update/rollback + 诊断）※重新加载/删除/授权状态已补，define/undefine 为文件操作
- [ ] 内置工具集（读/写、文件名/标题/链接搜索、图谱查询）；全文倒排索引列入后续里程碑；工具 schema 进入提示词组装
- [x] 事件 seam 文档（[docs/seams.md](docs/seams.md)）：seam 模型、依赖星座核对、各 seam 现状与阻碍、插件可用事件与示例、Stage 2–5 迁移路线
- [ ] dsh 官方包替换自研薄层（分阶段：llm→tools→sessions→agent，见 seams.md §5；依赖已对齐 rc.6）
- [ ] 单元测试覆盖状态机与沙箱策略
- [ ] Chat 体验改进落地（[docs/ux-checklist.md](docs/ux-checklist.md) P0.5 全组 + P1 首批）※P0.5 全组、P1 首批/二批已落地
- [ ] 设置面丰富（对照 dsh：模型参数、grant 管理、会话保留策略、日志级别）※模型参数与 grant 管理已落地

### P2 深度（后续）
- [ ] 子 agent / 工作流；preset 概念（isolate realm）
- [ ] 上游 rc 节奏化升级（SOP §8）

### P3 商店申报
- [ ] 仓库开源（MIT）+ 文档 + 安全模型说明；PR 至 obsidianmd/obsidian-releases；响应审核

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 上游破坏性变更 | 精确锁版本 + SOP §8 同步流程 + 回归清单 |
| 商店审核对"动态执行代码"的疑问 | 安全模型文档 + 仅执行本地代码 + 审批默认值谨慎 |
| renderer 性能（大 vault、长会话重放） | 追加式日志 + 懒渲染 + 可选索引 |
| 模型 API 成本 / 可用性 | 支持任意 OpenAI 兼容端点 |
| Obsidian API 变更 | 适配层隔离（仅 obsidian-adapter 接触 obsidian 依赖） |

## 9. 参考

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（README、docs/architecture.zh.md、docs/cordis-primer.zh.md，已缓存于 `research/`）
- npm 元数据核对：`@deepseek-ai/{cordis, dsh-agent, dsh-llm, dsh-tools, dsh-session, dsh-sandbox, dsh-workspace}`（2026-08-14，见 `research/dsh-npm.json`）
- [Obsidian Developer Policies](https://github.com/obsidianmd/obsidian-developer-docs/blob/master/en/Developer%20policies.md)、[Submit your plugin](https://github.com/obsidianmd/obsidian-developer-docs/blob/master/en/Plugins/Releasing/Submit%20your%20plugin.md)
- 先例：obsidian-mcp-plugin（进程内 MCP 服务器）、obsidian-mcp-assistants（Obsidian 内 MCP agent 聊天）、ObsidianCustomFrames（iframe 面板）、obsidian-git（renderer 内 child_process）
