/**
 * my-first-plugin：harness-like 示例 Cordis 插件。
 *
 * - 注册一个工具 count_notes（进入 agent 的工具表）
 * - 注册一条 Obsidian 命令（出现在命令面板）
 *
 * 构建（生成 main.js）：
 *   npm i -D esbuild   # 首次
 *   npm run build
 *
 * 注意：@deepseek-ai/cordis 保持 external，运行时由宿主注入同一个实例。
 */

import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-first-plugin',
  inject: ['commands', 'toolsCompat', 'vault', 'workspace', 'notice'],
  apply(ctx: Context) {
    // 注册全部包进 ctx.effect：插件停止时逆序撤销（Cordis 可逆副作用纪律）
    ctx.effect(() => [
      // 1) 工具：统计 vault 中的 markdown 笔记数
      ctx.toolsCompat.register({
        name: 'count_notes',
        description: '统计 vault 中的 markdown 笔记数量',
        input: { type: 'object', properties: {} },
        execute() {
          return { count: ctx.vault.listMarkdown().length }
        },
      }),

      // 2) 命令：有活动笔记时可用，点击提示当前笔记路径
      ctx.commands.addCommand({
        id: 'dsh-example:hello',
        name: '示例：打招呼（显示当前笔记路径）',
        checkCallback: (checking: boolean) => {
          const file = ctx.workspace.getActiveFile()
          if (!file) return false
          if (!checking) ctx.notice.notice(`你好！当前笔记: ${file}`)
          return true
        },
      }),
    ])
  },
}
