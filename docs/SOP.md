# dsh-obsidian 开发与发布 SOP

> 适用：本仓库所有开发/发布/维护动作。涉及上游依赖升级、发布、数据安全相关操作，必须遵循本规范。
> 基线：dsh rc 期（2026-08，`@deepseek-ai/dsh` 0.1.0-rc.6）。所有版本号以 `research/` 缓存与 `npm view` 实时核对为准。

---

## 1. 环境准备

1. 工具：Node.js ≥ 20（LTS）、pnpm ≥ 9、git。
2. 双 vault 策略：
   - `dev-vault`：日常开发测试用（放仓库外，如 `~/Vaults/dev-vault`），可随意破坏。
   - `real-vault`：真实使用库，**只做只读回归验证**（P1 起启用），任何批量写操作须走审批。
3. 克隆仓库 → `pnpm install` → `pnpm --filter plugin build` 验证可构建。
4. Obsidian 开启 `Community plugins → Restricted mode: off`；安装 [obsidian-hot-reload](https://github.com/pjeby/hot-reload) 便于开发时热加载。

## 2. 每日开发循环

```sh
pnpm dev                      # esbuild watch，输出 apps/plugin/dist/main.js（终端 1）
pnpm link:vault <dev-vault>   # 文件级软链接入测试 vault（幂等；可设 DEV_VAULT 环境变量）
```

1. `link:vault` 在 vault 侧建立真实插件目录，仅软链 `main.js` / `manifest.json` / `styles.css` / `versions.json` 四个产物——**禁止目录级软链**（会把 `data.json` 穿透进仓库）。
2. hot-reload 自动重载；对软链不敏感时手动 `Cmd+R` 或使用 hot-reload 的重载命令。
3. DevTools（`Cmd+Opt+I`）查看 console；常见问题见 §6。
4. 提交前：`pnpm lint && pnpm test` + 手动验收清单（§5）。
5. 提交信息规范：`feat|fix|chore(dsh-obsidian|adapter|runtime|ui|docs): 摘要`，中英文均可，附上游版本号（涉及升级时）。

## 3. 编码规范

- TypeScript strict；服务 key 通过声明合并（`declare module '@deepseek-ai/cordis'`）暴露类型。
- **所有注册必须有 disposer**：用 `ctx.effect()` 返回释放函数或 `ctx.on()` 等自带清理的 API；禁止无清理的裸 `setTimeout`、全局监听器、`document` 挂载残留。
- 依赖一律精确版本（`save-exact`），提交 `pnpm-lock.yaml`；新增依赖需说明用途并过审。
- 产物构建为**可读 bundle**（不混淆、不压缩到不可读），商店要求代码可审查；源码仓库保持开源。
- 分层纪律：**只有 `packages/obsidian-adapter` 可以 import obsidian 依赖**；其余包只面向 Cordis 服务接口。
- 中文注释与文档；API 命名英文。

## 4. 编写本项目内 Cordis 插件的 SOP（作者向）

> 面向"用 Cordis 插件扩展 Obsidian"的用户与协作者。完整示例文档见 `docs/plugin-author-guide.md`（P1 产出）。

最小插件 `my-notes-tools`：

```
.obsidian/dsh-plugins/my-notes-tools/
├─ package.json        # 含 dsh 字段声明（插件元数据/入口）
└─ src/main.ts
```

```ts
import { Context } from '@deepseek-ai/cordis'

export default {
  inject: ['tools', 'commands', 'vault'],   // 声明依赖，就绪后才启动
  apply(ctx: Context) {
    // 1) 注册一个工具（进入 agent 的工具表）
    ctx.tools.register('read_note', {
      description: '读取 vault 中指定笔记',
      input: { type: 'object', properties: { path: { type: 'string' } } },
      async execute({ path }) {
        return ctx.vault.read(path)
      },
    })

    // 2) 注册一条 Obsidian 命令（出现在命令面板）
    ctx.commands.addCommand({
      id: 'my-summary',
      name: '生成当前笔记摘要',
      checkCallback: (checking) => {
        const f = ctx.workspace.getActiveFile()
        if (!f) return false
        if (!checking) { /* 入队到当前会话 */ }
        return true
      },
    })
  },
}
```

运行流程：PluginManagerView → run → 首次运行需确认（grant 单勾/双勾）→ 查看 run 卡片诊断。修改代码后 update；故障回滚用 rollback。

排查要点：工具不出现 → 检查 `inject` 是否声明、插件是否 running；审批不弹 → 检查策略是否被覆盖；服务取不到 → 确认服务 key 拼写与声明合并位置。

## 5. 测试 SOP

- 单元测试（vitest）：harness-base 装配、插件状态机、沙箱策略、会话日志追加/重放、grant 持久化。
- 适配层冒烟：用 Obsidian API mock（vault 用临时目录），不依赖真实 Obsidian 实例。
- 手动验收清单（P0 起每次发布前必跑）：
  1. BRAT/manual 安装全新 vault → 插件启用无报错
  2. 设置页配 API key → ChatView 对话成功（含流式输出）
  3. 写操作触发审批 modal；单勾/双勾行为符合预期
  4. 重启 Obsidian → 会话恢复渲染
  5. 禁用插件 → 命令/视图/工具全部消失（teardown 干净）
  6. 卸载插件 → `.obsidian/dsh/` 数据保留可备份
- 回归清单（上游升级后必跑，见 §8）：状态机、沙箱策略、工具 schema 示例、会话日志。

## 6. 调试 SOP

- 日志：设置页有日志级别开关，写 `.obsidian/dsh/logs/`；错误消息必须携带 session/plugin 上下文。
- 常见问题表：

| 现象 | 排查 |
|---|---|
| 模型 401 / 超时 | key 未配或端点错误；检查设置页 baseURL；确认网络可访问 |
| 工具不出现 | `inject` 缺声明、插件未 running、schema 校验失败 |
| 审批不弹 | 策略被配置覆盖；检查 sandbox/approval 默认值 |
| 会话不恢复 | JSONL 损坏 → 归档该文件并重建（数据安全见 §9） |
| 插件导致异常 | 先 stop 该插件；仍异常则禁用主插件并手动删除对应 `dsh-plugins/<id>` 目录 |
| bundle 报错 | 确认 `pnpm --filter plugin build` 最新产物已复制；DevTools 看具体堆栈 |

- 断点不便时：提升日志级别 + 最小复现插件定位。

## 7. 发布 SOP

### 7.1 BRAT 自用（每轮迭代）

1. `pnpm lint && pnpm test` + §5 手动验收清单通过。
2. `manifest.json` / `versions.json` 版本对齐；打 tag `vX.Y.Z`。
3. BRAT（[obsidian-brat](https://github.com/TfTHacker/obsidian42-brat)）添加仓库 → 安装 beta 版本。
4. 在真实 vault 只读回归后再宣告完成。

### 7.2 商店申报（正式版，P3）

对照 [Obsidian Developer Policies](https://github.com/obsidianmd/obsidian-developer-docs/blob/master/en/Developer%20policies.md) 逐项确认：

- [ ] 仓库开源（MIT LICENSE），README 说明功能/安全模型/数据存放
- [ ] 代码可读（无混淆、无压缩黑盒）；`manifest.json` id/version/minAppVersion 正确，`versions.json` 与历史版本对齐
- [ ] 无远程代码执行：动态插件仅执行用户本地文件；文档明确审批语义（单勾/双勾 grant）
- [ ] 隐私说明：模型请求端点（用户自配）、遥测默认关闭、会话/凭据存放位置
- [ ] 提交 PR 至 [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)（含 release notes）
- [ ] 预留 1–2 轮审核意见响应时间；修改后重新构建并重测

商店版发布后：同步更新文档与示例插件，记录发布版本到 CHANGELOG。

## 8. 上游同步 SOP（dsh 包升级）

1. **关注**：`npm view @deepseek-ai/dsh-agent version` 或订阅 release；上游处于 rc 期，发布频繁。
2. **评估**：读 release notes / CHANGELOG，标记破坏性变更（工具/事件签名、ctx key、包拆分）。
3. **分支升级**：新建分支 → 更新 `package.json` 精确版本 → `pnpm install` → 构建通过。
4. **回归**：跑 §5 回归清单（状态机、沙箱、会话、工具示例）。出现 API 缺口时：在适配层加兼容垫片并记录 ADR，不直接改官方包。
5. **合并**：升级与功能修复分开提交；建议上游发布后 1 周内完成评估，避免版本堆积。
6. **记录**：升级结果（成功/垫片清单/遗留问题）写入 `docs/upstream-log.md`。

## 9. 数据安全与回滚

- 会话/插件数据全部位于 vault 内（`.obsidian/dsh/`）；任何批量修改前先读、写操作默认走审批。
- 回滚主插件：直接替换 `main.js` 为旧版本（manifest 版本对应）；回滚用户插件：PluginManagerView 中 rollback。
- 事故流程：停止插件 → 备份 `.obsidian/dsh/` → 修复 → 验证 → 恢复；损坏 JSONL 归档不删除。

## 附：常用命令速查

```sh
pnpm --filter plugin dev|build        # 构建（watch / 产物）
pnpm lint && pnpm test                # 静态检查 + 单测
npm view @deepseek-ai/dsh version     # 上游版本
npm view @deepseek-ai/dsh-agent version
```
