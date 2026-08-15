# Harness Like（harness-like）

**An Obsidian implementation inspired by DeepSeek Harness** — run a Cordis plugin system and an AI agent inside Obsidian. The agent reads and writes your notes, calls tools and goes through approvals; you (or the agent) can write your own Cordis plugins to extend Obsidian's commands, tools, panels, ribbon icons, status bar and settings tabs.

> **Status: beta (v0.1.0)** — core features are complete; the UI supports Chinese & English (and can follow Obsidian's language).

[English](#en) · [中文](#zh)

---

<a id="en"></a>
## English

### What is Harness Like?

Harness Like is an Obsidian implementation inspired by DeepSeek Harness. It embeds a Cordis runtime inside the Obsidian plugin process, exposes Obsidian's APIs as Cordis services, and lets an AI agent use tools to read and write your notes — with a human-in-the-loop approval flow. In **Create Mode**, the agent can even build, iterate and reload your own Cordis plugins — Obsidian-adapted plugins that run inside Obsidian and extend it through `ctx.*` services — entirely through conversation.

### Highlights

- **AI chat with tools** — streaming responses, tool call cards with live status, phase indicator, stop/retry.
- **Note operations with approval** — the agent reads/writes your notes; writes go through a configurable approval flow (per-tool policy, directory whitelist, per-session allowance).
- **Plugin system** — your own Cordis plugins (not Obsidian-native plugins) live in `.obsidian/dsh-plugins/<id>/` (a `package.json` + a compiled `main.js`). They adapt Obsidian through `ctx.*` services and can register tools, commands, panels, ribbon icons, status-bar items and settings tabs.
- **Create Mode** — the agent creates, modifies and reloads plugins for you in the chat: `create_plugin` → `write_plugin_file` → `reload_plugin`.
- **Agents & models** — three built-in agent modes (Chat / Edit / Create) plus custom agents with capability whitelists; multiple model providers with per-model defaults (OpenAI-compatible endpoints).
- **Privacy** — requests go only to the endpoints you configure; zero telemetry; everything runs locally.

### Installation

> The plugin is currently in beta. Community-store & BRAT installation will be available after the first release.

1. Get the build: clone the repository and run `pnpm install && pnpm build`, or download a release package when published.
2. Create the folder `.obsidian/plugins/harness-like/` inside your vault.
3. Copy `apps/plugin/dist/main.js`, `apps/plugin/manifest.json` and `apps/plugin/styles.css` into that folder.
4. In Obsidian: Settings → Community plugins → turn off Restricted mode if needed → **Reload** → enable **Harness Like**.

### Quick Start

1. **Configure a model** — open the Harness Like settings tab (via the ribbon icon or the command palette) → **Models** → enter your API Key (DeepSeek endpoint is pre-configured), fetch or add a model list, pick a default model.
2. **Open the chat panel** — click the bot icon in the left ribbon, or run the command "Open Harness Like Panel".
3. **Ask something** — try an example like *"How many notes are in this vault?"*. Watch the agent call tools; approve writes when asked.

### Using Harness Like

- **Chat panel** — session list with titles and message counts, per-turn "Copy this exchange" button (code blocks keep their own copy button), Markdown rendering, streaming toggle.
- **Agent picker** — switch between Chat / Edit / Create modes (upward menu above the input toolbar); disabled modes are hidden. Custom agents can whitelist specific tools.
- **Model picker** — per-session model selection (upward menu); "Manage models…" jumps into the plugin settings.
- **Current-note mode** — check "Current note only" in the toolbar to restrict the agent's write access to the note you are currently viewing (and inject its content).
- **Approval** — write requests are approved per the flow: per-tool policy → current-note restriction → directory whitelist → approval dialog (with an "allow for this chat" option). The session-level allowance is never persisted.
- **User plugins (Cordis)** — open the Plugin Manager from the chat header (right-aligned "Plugin Manager" button). Authorize (single-check = this version only, double-check = trust future versions), load, reload, stop or delete your Cordis plugins. Commands from them are grouped under the main plugin name in the palette, e.g. `Harness Like: Open panel (note-counter)`.
- **Export** — export any chat as Markdown; the target directory is configurable in Settings → Sessions (default: a `sessions` folder at the vault root).
- **Language** — Settings → Interface → Interface language: **Follow Obsidian language** (default), 中文, or English. Panels update automatically.
- **Settings tabs** — Models / Agents / Approval / Sessions / Data / Interface / Logs / Plugin Grants.

### FAQ

- **Where are my API keys stored?** In plain text inside `.obsidian/plugins/harness-like/data.json` — keep the file safe.
- **Where are chats stored?** Session logs live in `.obsidian/dsh/sessions/*.jsonl` inside your vault.
- **Is it safe to run user Cordis plugins?** Plugins are only executed from local files you placed in `.obsidian/dsh-plugins/`; nothing is downloaded or executed remotely. Loading requires your authorization, and the grant can be revoked in Settings → Plugin Grants.
- **What does single-check vs double-check mean?** Single-check trusts only the current version; double-check trusts future versions of that plugin (no prompt on updates).
- **Can the agent write anywhere?** No — writes are restricted to the vault and filtered by approval policy; Obsidian's own configuration is never modified.
- **Does it phone home?** No telemetry. Model requests go only to the providers you configured.

### License

MIT (pending: LICENSE file will be added with the first release).

---

<a id="zh"></a>
## 中文

### 这是什么？

Harness Like 是 DeepSeek Harness 理念的 Obsidian 实现：在 Obsidian 插件进程内嵌入 Cordis 运行时，把 Obsidian 的 API 暴露为 Cordis 服务，让 agent 通过工具读写你的笔记，全程带人工审批；在**创造模式**下，agent 甚至能完全通过对话创建、迭代并重载你自己的 **Cordis 插件**（运行在 Obsidian 内、通过 `ctx.*` 服务适配 Obsidian 的插件，而非 Obsidian 原生插件）。

### 功能亮点

- **对话 + 工具**：流式输出、工具卡片实时状态、阶段提示条、停止/重试。
- **读写笔记带审批**：写操作按「工具级策略 → 仅当前笔记限制 → 目录白名单 → 审批弹窗（可"本会话允许写"）」逐级放行。
- **插件体系**：你自己的 **Cordis 插件**（非 Obsidian 原生插件）位于 `.obsidian/dsh-plugins/<id>/`（一个 `package.json` + 编译好的 `main.js`），通过 `ctx.*` 服务适配 Obsidian，可注册工具、命令、面板、侧边栏图标、状态栏与设置页。
- **创造模式**：在对话里让 agent 帮你 `create_plugin` → `write_plugin_file` → `reload_plugin`，插件从无到有全程对话内完成。
- **智能体与模型**：内置对话/修编/创造三种模式 + 自定义智能体（能力白名单勾选）；多模型提供方、模型级默认（OpenAI 兼容端点）。
- **隐私**：请求只发往你配置的端点；零遥测；全部本地运行。

### 安装

> 当前为 beta。首个发布版上线后支持社区商店与 BRAT 安装。

1. 获取产物：克隆仓库后执行 `pnpm install && pnpm build`，或等发布后在 Releases 下载。
2. 在 vault 内创建目录 `.obsidian/plugins/harness-like/`。
3. 把 `apps/plugin/dist/main.js`、`apps/plugin/manifest.json`、`apps/plugin/styles.css` 复制进去。
4. Obsidian：设置 → 第三方插件（必要时关闭受限模式）→ **重新加载** → 启用 **Harness Like**。

### 快速开始

1. **配置模型**：点击左侧边栏机器人图标或从命令面板打开 Harness Like 设置 → 「模型」→ 填入 API Key（已预置 DeepSeek 端点），从端点获取或手动添加模型，并设置默认模型。
2. **打开对话面板**：点击侧边栏机器人图标，或运行命令「打开 Harness Like 面板」。
3. **提问**：试试示例问题，比如"统计 vault 里有多少笔记"。观察 agent 调用工具，按提示审批写操作。

### 使用指南

- **对话面板**：会话列表（标题 + 消息数）；每轮问答底部有「复制本段对话」按钮（代码块保留独立复制）；Markdown 渲染、流式开关。
- **智能体选择**：输入区上方上拉菜单切换 对话 / 修编 / 创造 模式（向上展开）；被禁用的模式不出现；自定义智能体可勾选能力白名单。
- **模型选择**：会话级模型切换（上拉菜单）；菜单内「管理模型…」直达插件设置。
- **仅当前笔记**：勾选输入区旁的「仅当前笔记」，agent 的写操作被限制在当前打开的笔记（并注入其内容）。
- **审批**：写操作按「工具级策略 → 仅当前笔记 → 目录白名单 → 审批弹窗」放行；「本会话允许写」不持久化。
- **用户插件（Cordis）**：对话面板头部右侧「插件管理器」按钮打开管理器；「授权并加载」（单勾=仅此版本 / 双勾=信任后续）、停止、重载、删除你的 Cordis 插件。其命令在命令面板以主插件名归组显示，如 `Harness Like: 打开面板（note-counter）`。
- **导出**：任意会话可导出为 Markdown；导出目录在 设置 → 会话 中配置（默认 vault 根下的 `sessions` 文件夹）。
- **语言**：设置 → 界面 → 界面语言：**跟随系统（与 Obsidian 语言一致）**（默认）/ 中文 / English，面板自动切换。
- **设置页**：模型 / 智能体 / 审批 / 会话 / 数据 / 界面 / 日志 / 插件授权，共 8 个分类 tab。

### 常见问题

- **API Key 存在哪里？** 明文保存在 `.obsidian/plugins/harness-like/data.json`，请注意保管该文件。
- **对话记录存在哪里？** 会话日志在 vault 内 `.obsidian/dsh/sessions/*.jsonl`。
- **跑用户 Cordis 插件安全吗？** 插件只执行你放在 `.obsidian/dsh-plugins/` 的本地文件，不会下载或远程执行代码；加载需要授权，且可在 设置 → 插件授权 中随时撤销。
- **单勾和双勾的区别？** 单勾=只信任当前版本；双勾=信任该插件后续所有版本（更新不再弹窗）。
- **agent 能随便写文件吗？** 不能——写操作限制在 vault 内并经过审批策略过滤，不会改动 Obsidian 自身配置。
- **会上传数据吗？** 零遥测；模型请求只发往你配置的提供方端点。

### 许可证

MIT（首个发布版将附带 LICENSE 文件）。

---

## 开发 / Development（面向贡献者）

> 使用者可直接跳过本节。开发文档详见 [docs/design.md](docs/design.md)（设计）、[docs/SOP.md](docs/SOP.md)（开发/发布规范）、[docs/HANDOVER.md](docs/HANDOVER.md)（约束与交接）。

```sh
pnpm install
pnpm dev          # esbuild watch，产物自动同步到 dev-vault/（项目内测试库）
pnpm typecheck    # 四个包 + 插件类型检查
pnpm test         # 123 项 vitest
pnpm build        # 产物构建 + 同步
```

**架构速览**：

```
packages/harness-base/      纯逻辑：sandbox / approval / session-log / agent-loop / llm & tools 官方集成
packages/obsidian-adapter/  唯一接触 Obsidian API 的层（结构化接口 + 服务）
packages/plugin-runtime/    用户插件加载器（require shim + 状态机 + 命令前缀归一化）
apps/plugin/                主入口 / Chat 面板 / 插件管理器 / tabs 设置页 / 弹窗 / 工具集 / i18n
```

**分层纪律**：只有 `packages/obsidian-adapter` 可以 import `obsidian` 依赖；用户插件一律通过 `ctx.*` 服务访问宿主能力，禁止直接操作 Obsidian DOM；所有注册必须挂 disposer（`ctx.effect`），保证卸载可逆。上游 dsh 包锁定 `0.1.0-rc.6`，esbuild 必须保留 `node-module-shim`（历史事故约束，详见 HANDOVER §2.2）。
