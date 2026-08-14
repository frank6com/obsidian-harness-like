# 事件与能力 Seam 文档（dsh-obsidian）

> 状态：v0.1（2026-08-14）｜ 对应设计文档 §5.4 与 P1 清单"事件 seam 文档"
> 目的：说明本项目与 dsh 官方包的能力对接现状、阻碍与迁移路线，以及**用户插件现在就能用的事件**。

---

## 1. Seam 模型（dsh 架构文档定义）

一个 **seam** 是一项可替换能力，包含三种角色：

- **Service Definition**：声明接口（如 `ctx.llm` 的类型）
- **Service Provider**：实现它（如 DeepSeek 适配器）
- **Consumer**：使用它（通常是面向模型的工具或 agent loop）

替换提供方即可改变整个产品行为，无需改消费者。本项目（Obsidian 宿主）与 dsh 官方包的对接，就是把每个 seam 的 Provider 换成"Obsidian 适配版"或直接使用官方实现。

## 2. 依赖星座（2026-08-14 实测）

| 包 | 版本 | 状态 |
|---|---|---|
| `@deepseek-ai/cordis` | 4.0.1 | ✅ 已使用（运行时内核） |
| `@deepseek-ai/dsh-llm` | 0.1.0-rc.6 | ✅ 已锁版本（待集成） |
| `@deepseek-ai/dsh-tools` | 0.1.0-rc.6 | ✅ 已锁版本（待集成） |
| `@deepseek-ai/dsh-session` | 0.1.0-rc.6 | ✅ 已锁版本（待集成） |
| `@deepseek-ai/dsh-sandbox` | 0.1.0-rc.6 | ✅ 已锁版本（评估后暂不集成，见 §3.4） |
| `@deepseek-ai/dsh-workspace` | 0.1.0-rc.6 | ✅ 已锁版本（评估后延后，见 §3.5） |
| `@deepseek-ai/dsh-agent` | 0.1.0-rc.6 | ✅ 已锁版本（待集成） |
| `@deepseek-ai/dsh-agent-loop` | 0.1.0-rc.6 | ✅ 可发布（Stage 3+ 需要） |
| `@deepseek-ai/dsh-scope` | 0.0.1-rc.1 | ✅ 可发布（dsh-tools/session 的类型依赖） |
| `@deepseek-ai/dsh-type-meta` | — | ❌ **未发布**（rc.1 依赖线的阻断项；rc.6 线不需要） |

**关键结论**：rc.1/0.0.1 依赖线引用未发布的 `dsh-type-meta`（npm 404），**全部对齐 0.1.0-rc.6 后可解析**——这是本阶段完成的依赖对齐。

## 3. Seam 明细

### 3.1 llm（模型）

| | dsh 官方 | 本项目现状 |
|---|---|---|
| 服务 | `ctx.llm: LlmRuntime`（`registerAdapter(providers, adapter)`，`llm/stream` 瀑布事件，`LlmError`） | `ctx.llm: LLMClient`（自研，fetch + SSE，OpenAI 兼容） |
| 事件 | `llm/stream`（waterfall，重试/路由/回放） | 无 |

**状态：待集成（Stage 2）**。阻碍：需要按 `LlmAdapter` 接口实现 DeepSeek 适配器（流协议 + `Message`/`ToolSchema`/`ContentBlock` 词汇），并把 agent loop 的请求组装迁移到官方 Message 形状；迁移期间聊天不可回归（回归清单：流式、工具调用、中止、温度参数透传）。

### 3.2 tools（工具）

| | dsh 官方 | 本项目现状 |
|---|---|---|
| 服务 | `ctx.tools: ToolRuntime`（defineTool + pre/guard/around/post/result 流水线） | `ctx.tools: ToolRegistry`（自研注册表） |
| 事件 | `tools/pre-execute`（waterfall，allow/deny/ask）、`tools/execute`、`tools/post-execute` | 无（审批走宿主钩子 `askWriteApproval`） |

**状态：待集成（Stage 3）**。阻碍：`ToolRuntime` 与 `dsh-agent-loop` 的并行调度器强耦合（`TOOL_RUNTIME_SCHEDULER`），需同时引入 agent-loop；工具定义 API 迁移（`defineTool` + schemastery schema vs 当前 `ToolDef`）。

**迁移后的审批形态（预告）**：写审批将从宿主钩子改为 `tools/pre-execute` 瀑布监听器：

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'write_note') {
    const decision = await askWriteApproval(exec.arguments.path)
    if (decision === 'deny') return { approved: false, reason: '用户拒绝' }
  }
  return next()
})
```

### 3.3 sessions（会话）

| | dsh 官方 | 本项目现状 |
|---|---|---|
| 服务 | `ctx.sessions: SessionStore`（事件溯源、内存存储、`session/created` 等事件） | `ctx.sessions: SessionLog`（自研追加式 JSONL） |
| 事件 | `session/event`、`session/flush`（持久化是插件关切：订阅 + drain） | `session/event`（自研事件域，`session/meta`/`system/message` 等） |

**状态：待集成（Stage 4）**。阻碍：官方 `SessionEventMap` 词汇（`UserMessage`/`AssistantMessage`/`ToolResultMessage`）与自研 `SessionEvent` 不同，迁移波及 agent loop、ChatView、导出、buildMessages 全链路；`session/meta`（标题/绑定）与 `system/message`（错误持久化）是自研扩展，需映射或补充官方事件。**持久化订阅模式（迁移后）**：

```ts
ctx.on('session/event', (e) => void sessionLog.append(e.sessionId, e))
ctx.on('session/flush', () => void sessionLog.flush())
```

### 3.4 sandbox（沙箱）

| | dsh 官方 | 本项目现状 |
|---|---|---|
| 服务 | `ctx.sandbox`：**子进程 argv 约束**（`SandboxMode`/`EscalationApproval`，把 argv 包进宿主路径策略） | `ctx.sandbox: SandboxPolicy`（自研 vault 路径白名单，直接文件操作） |

**状态：保留自研（有明确理由）**。dsh 沙箱是"同世界进程约束"（包 subprocess argv），本项目的 v1 决策（D2）是**无子进程**——agent 直接通过 Obsidian API 操作 vault 文件，约束对象是路径而非进程。强行引入 dsh-sandbox 会引入其服务依赖链而不产生约束能力。迁移条件：将来支持子进程工具（如 `run_js`）时再接入，届时候选实现（bash/终端）即为该 seam 的消费者。

### 3.5 workspace（工作区）

dsh 官方为**持久化工作区注册表**（`ctx.workspaceRegistry`，基于 dsh-session 的 workspace 成员模型）；本项目 v1 语义是"vault 根即工作区"（单工作区）。**状态：延后**，随 Stage 4（session 模型迁移）一并评估。

### 3.6 agent（智能体）

dsh 官方提供 `ctx.agents`（Agent 注册表）、`agent/*` 事件（inbox/步骤/状态）与 `dsh-agent-loop` 驱动。本项目现状：无 agents 服务，`runAgentLoop`（自研，harness-base）直接消费 llm/tools。**状态：待 Stage 5**，与 dsh-tools 集成一并引入（ToolRuntime 调度器依赖它）。

## 4. 用户插件现在就能用的事件（无需等待迁移）

以下事件域已就绪，插件作者可直接 `ctx.on(...)`：

| 事件 | 载荷 | 说明 |
|---|---|---|
| `session/event` | `SessionEvent` | 会话持久事件：user/assistant/system 消息、tool/call、tool/result、turn/start、turn/end、session/meta |
| `dsh/waiting-approval` | `path: string` | 宿主弹出写审批弹窗时触发（阶段状态联动） |
| `vault/modify` `vault/create` `vault/delete` `vault/rename` | `path, oldPath?` | vault 文件变更（Obsidian 事件桥接） |
| `workspace/file-open` | `path: string` | 活动笔记切换 |

**示例：写一个"工具调用记录器"插件**（注册到 `.obsidian/dsh-plugins/tool-logger/`）：

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'tool-logger',
  inject: ['notice'],
  apply(ctx: Context) {
    ctx.on('session/event', (e) => {
      if (e.type === 'tool/call') {
        ctx.notice.notice(`🔧 ${e.tool} 参数: ${JSON.stringify(e.input).slice(0, 80)}`)
      }
    })
    ctx.on('dsh/waiting-approval', (path) => {
      ctx.notice.notice(`⏳ 等待审批: ${path}`)
    })
  },
}
```

## 5. 迁移路线图

| Stage | 内容 | 验收标准 | 风险 |
|---|---|---|---|
| 1（本轮） | 依赖对齐 rc.6；seam 文档 | 全量安装可解析；文档评审通过 | 低 |
| 2 | llm：实现 DeepSeek `LlmAdapter`，`ctx.llm` 换为 `LlmRuntime` | 回归清单全过：流式/工具/中止/温度；`llm/stream` 监听生效 | 中（流协议） |
| 3 | tools：引入 dsh-tools + agent-loop；工具定义迁移 `defineTool`；审批改 `tools/pre-execute` 瀑布 | 内置工具与示例插件迁移；审批弹窗行为不变；流水线事件可拦截 | 高（调度器耦合） |
| 4 | sessions：`SessionStore` + JSONL 持久化订阅；事件词汇迁移（含 session/meta、system/message 映射） | 会话恢复/标题/绑定/导出回归全过 | 高（全链路） |
| 5 | agent：`ctx.agents` + 官方 agent loop 替换 `runAgentLoop` | 阶段状态/中止/重试行为不变 | 高 |

每个 Stage 独立提交，**回归清单**（§6）全过后才合并。

## 6. 回归清单（迁移专用）

1. 流式输出 + 光标；2. 工具调用多轮循环（≥3 次）无 400；3. 写审批弹窗（含预览）与会话级开关；4. 中止（停止按钮）日志闭合；5. 会话重启恢复（标题/绑定/错误消息）；6. 导出 Markdown；7. 示例插件加载/重新加载；8. 温度/max_tokens 透传。

## 7. 附录：npm 版本核对（2026-08-14）

- rc.6 线可用：dsh-llm / dsh-tools / dsh-session / dsh-sandbox / dsh-workspace / dsh-agent / dsh-agent-loop / dsh-typert-protocol
- 未发布：`dsh-type-meta`（rc.1 线依赖，npm 404）
- 其余传递依赖（dsh-scope、dsh-attachment、schemastery 等）均可解析
