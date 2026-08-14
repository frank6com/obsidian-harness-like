# dsh-obsidian

**DeepSeek Harness for Obsidian**：在 Obsidian 内运行一个 Cordis 运行时，把 Obsidian 的 API 暴露为 Cordis 服务——用户编写的 Cordis 插件可以直接扩展 Obsidian（注册工具、命令、服务、面板），agent 直接操作你的笔记库。

设计文档见 [docs/design.md](docs/design.md)，开发/发布规范见 [docs/SOP.md](docs/SOP.md)。

## P0 已实现

- ✅ Cordis 运行时引导（`@deepseek-ai/cordis` 4.0.1），onload/onunload 完整生命周期
- ✅ Obsidian 适配服务：`ctx.vault` / `ctx.editor` / `ctx.workspace` / `ctx.commands` / `ctx.views` / `ctx.settings` / `ctx.notice`
- ✅ Harness 服务：`ctx.sandbox`（vault 白名单）/ `ctx.approval`（单勾双勾 grant + 会话级写开关）/ `ctx.sessions`（追加式 JSONL）/ `ctx.tools` / `ctx.llm`（OpenAI 兼容，默认 DeepSeek）
- ✅ Agent 循环：工具调用 → 审批 → 回填 → 多轮（`turn/*`、`tool/*`、`user/message`、`assistant/message` 会话事件）
- ✅ 内置工具：`read_note` / `write_note`（沙箱+审批）/ `search_notes`
- ✅ UI：Chat 面板（会话列表/绑定笔记/流式输出/工具卡片/会话级允许写）、插件管理器（授权→加载→停止→卸载）、设置页
- ✅ 用户插件系统：`.obsidian/dsh-plugins/<id>/` 预编译产物 + require shim（与宿主共享同一 Cordis 实例）
- ✅ 示例插件 `my-first-plugin`（工具 + 命令，含预编译产物）
- ✅ 35 项单元测试 + 真实产物冒烟测试，全部通过

## 安装（手动，BRAT 待仓库上线 GitHub）

1. 构建：`pnpm install && pnpm build`
2. 在 vault 下创建目录 `.obsidian/plugins/dsh-obsidian/`
3. 复制 `apps/plugin/dist/main.js`、`apps/plugin/manifest.json`、`apps/plugin/styles.css` 到该目录
4. Obsidian 设置 → 第三方插件 → 重新加载 → 启用 **dsh-obsidian**

## 使用

1. **设置**：命令面板 → "打开 dsh 设置"（或 设置 → 第三方插件 → dsh-obsidian）→ 填写 API Key（默认 DeepSeek 端点）
2. **Chat**：点击侧边栏机器人图标 → 输入消息 → agent 可调用工具读写笔记；写操作会弹审批（可"本会话允许写"）
3. **示例插件**：把 `apps/plugin/examples/my-first-plugin/` 复制到 `.obsidian/dsh-plugins/my-first-plugin/` → 插件管理器 → "授权并加载"（单勾=仅此版本 / 双勾=信任后续）

> **插件迁移提示（示例 v0.0.2 起）**：注册工具使用 **`ctx.toolsCompat`**（`ctx.tools` 是官方 ToolRuntime 的保留键，旧式定义会被校验拒绝，报 `must declare output { schema, render, presentationMeta? }`）。若 vault 内副本仍显示 `v0.0.1`，说明是旧产物，重新复制整个示例目录（含重新构建的 `main.js`）。
4. **会话**：自动持久化在 `.obsidian/dsh/sessions/*.jsonl`，重启后恢复；"绑定当前笔记"让 agent 感知笔记内容

## 开发

```sh
pnpm install
pnpm dev          # esbuild watch → apps/plugin/dist/main.js
pnpm typecheck    # 四个包 + 插件类型检查
pnpm test         # vitest 全量
pnpm build        # 产物构建
```

**项目内测试库（推荐主流程）**：`dev-vault/` 是项目内的 Obsidian 测试库，整个目录被 gitignore 忽略——构建产物、`data.json`、会话、示例插件全部落在其中，仓库零污染：

```sh
pnpm init:vault           # 初始化 dev-vault（示例笔记 + 示例插件 + 首次构建同步）
open -a Obsidian dev-vault   # 用 Obsidian 打开测试库
pnpm dev                  # watch 构建，构建后自动同步产物到 dev-vault 插件目录
```

构建后的四个产物由 esbuild 的 onEnd 钩子自动写入 `dev-vault/.obsidian/plugins/dsh-obsidian/`（`DEV_VAULT_DIR` 环境变量可改目录），所以日常就是：改代码 → 自动构建 → Obsidian 重载（配合 obsidian-hot-reload 自动刷新）。

**接入真实 vault（替代方案）**：文件级软链，零复制、数据留在 vault 侧：

```sh
pnpm dev                      # 终端 1：watch 构建
pnpm link:vault /path/to/vault   # 把四个产物以软链接入 vault（幂等）
```

> 注意：`link:vault` 是文件级软链，`data.json` 会在 vault 侧生成真实文件；不要使用目录级软链（会把 `data.json` 穿透进仓库）。
> 注意：dev-vault 是**可丢弃的测试库**（已 gitignore），不要把真实笔记放进去；也不要再把项目根目录作为 Obsidian vault 打开（Obsidian 不允许 vault 嵌套，dev-vault 在其中会被拒绝）。

## 仓库结构

```
apps/plugin/                  # Obsidian 插件（main.ts、视图、设置、示例插件模板）
packages/obsidian-adapter/    # Obsidian API → Cordis 服务（唯一接触 Obsidian 的层）
packages/harness-base/        # 沙箱/审批/会话日志/工具表/LLM/agent 循环（纯逻辑，可单测）
packages/plugin-runtime/      # 用户插件加载器（预编译产物 + require shim）
docs/                         # 设计文档与 SOP
research/                     # 调研底料
```

## 安全模型（摘要，详见设计文档 §5.8）

- 动态插件**只执行用户本地编写的文件**，绝不下载/执行远程代码
- 沙箱白名单：读 = 整个 vault；写 = 笔记区 + `.obsidian/dsh/` + `.obsidian/dsh-plugins/` + 临时目录；**禁止写 `.obsidian/` 其他区域**（防改动 Obsidian 配置）
- 写操作默认每次询问；Chat 面板提供会话级"允许写"开关（不持久化）
- 模型请求仅发往设置页配置的端点；v1 不采集任何遥测

## 常见问题

**为什么 agent 创建的 .html 等文件在文件管理器中看不到？**
Obsidian 默认只显示它能原生打开的文件类型（md/图片/pdf/音视频/canvas 等），`.html` 不在其中——文件一直在磁盘上（Finder 可见），但 Obsidian 的索引不注册它，重载也不会出现。解决：**设置 → 文件与链接 → 检测所有文件扩展名（Detect all file extensions）**，之后这些文件会作为"不支持的文件"出现在文件管理器和快速切换器中（双击用默认应用打开）。无论是否开启，`open_in_browser` 工具都能随时在系统浏览器中打开它们。

## 路线图

- **P0 骨架** ✅（本版本）
- **P1**：插件状态机补全（update/rollback/诊断）、事件 seam 文档、dsh 官方包替换自研薄层（`@deepseek-ai/dsh-*`）
- **P2**：全文索引、子 agent/工作流、preset
- **P3**：商店申报（开源仓库 + 安全模型说明 + PR obsidian-releases）
