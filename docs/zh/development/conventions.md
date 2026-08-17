# 架构约定

## 分层纪律

- **只有 `packages/obsidian-adapter` 可以 import `obsidian` 依赖**；其余包只面向 Cordis 服务接口；
- Obsidian 类型面缺失的运行时 API（`app.commands` / `app.setting` / `app.viewRegistry` 等）统一在 `apps/plugin/src/obsidian-bridge.ts` 用结构断言访问；
- esbuild 必须保留 `node-module-shim` 插件（dsh-llm 的 `createRequire` 在 Obsidian 环境必炸，由 `apps/plugin/shims/node-module.ts` 解决）。

## 内部协议命名（勿改）

- 数据目录 `.obsidian/harness-like/`、用户插件目录 `.obsidian/harness-like-plugins/`；
- 服务键 `ctx.sessionLog / toolsCompat / llmCaller / sandbox / approval / dshI18n`；
- 事件域 `dsh/session/event`、`dsh/waiting-approval`、`dsh/settings-updated`；日志前缀 `[dsh]`；
- 用户插件 manifest 的 `dsh` 字段（`dsh.id` 等）。

## 安全模型

- 沙箱白名单：读 = 整个 vault；写 = 笔记区 + 数据目录 + 插件目录 + 临时目录；**禁止写配置目录其他区域**；
- 动态插件只执行用户本地文件，运行需授权（单勾/双勾）；
- 写操作审批链：工具级策略 → 仅当前笔记 → 目录白名单 → 审批弹窗；
- 智能体模式：只有创造（create）模式能创建/修改插件。

## 国际化

- 字典按语言分文件 `apps/plugin/src/i18n/{zh,en}.ts`，API 在 `i18n/index.ts`（`t()` / `resolveLanguage()` / `registerLocale`）；
- 语言偏好 `uiLanguage`：`auto`（默认，跟随 Obsidian 应用语言 `localStorage['language']`）或显式 `zh`/`en`；
- 所有用户可见文案走 `t('key')`，禁止硬编码中文。
