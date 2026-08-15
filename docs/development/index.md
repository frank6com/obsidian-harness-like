# 开发文档

本栏目面向 **Harness Like 插件的开发者/贡献者**（想完善本插件本身），与面向使用者的[插件开发](/dev/hello-world)（在 Obsidian 里写用户插件）不同。

## 项目结构

```
packages/harness-base/      纯逻辑：sandbox / approval / session-log / agent-loop / llm & tools 官方集成
packages/obsidian-adapter/  唯一接触 Obsidian API 的层（结构化接口 + 服务）
packages/plugin-runtime/    用户插件加载器（require shim + 状态机 + 命令前缀归一化）
apps/plugin/                主入口 / Chat 面板 / 插件管理器 / tabs 设置页 / 弹窗 / 工具集 / i18n
docs/                       VitePress 用户文档站（本站）
```

## 技术栈

- **运行时**：Cordis（`@deepseek-ai/cordis` 4.0.1）+ dsh 官方包（`dsh-llm/tools/session/sandbox/workspace/agent/agent-loop`），全部**锁定 0.1.0-rc.6**；
- **语言/构建**：TypeScript strict；pnpm workspace；esbuild 打包（产物可读、不混淆）；
- **测试**：vitest（当前 129 项，`pnpm test` 必须全绿）+ typecheck。

## 快速开始

```sh
pnpm install
pnpm dev          # esbuild watch，产物自动同步 dev-vault/（项目内测试库）
pnpm test         # vitest 全量
pnpm typecheck    # 四个包类型检查
pnpm build        # 构建并同步（仓库根目录 = 官方插件包）
```

详细流程见[开发流程](/development/workflow)，版本规则见[版本号规范](/development/versioning)，发布见[发布与审核](/development/release)，约定见[架构约定](/development/conventions)。
