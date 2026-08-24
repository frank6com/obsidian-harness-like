import { defineConfig, type Plugin } from 'vitest/config'
import * as path from 'path'

/** .md 以文本内联（与 esbuild loader: { '.md': 'text' } 对齐，供智能体 persona 测试） */
const mdText = (): Plugin => ({
  name: 'md-text',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('.md')) return `export default ${JSON.stringify(code)}`
  },
})

export default defineConfig({
  plugins: [mdText()],
  resolve: {
    alias: {
      // 测试环境用替身替代 obsidian（真实 API 不可在 node/jsdom 加载）
      obsidian: path.resolve(__dirname, 'apps/plugin/src/__tests__/mocks/obsidian.ts'),
    },
  },
  test: {
    include: ['packages/**/__tests__/**/*.test.ts', 'apps/plugin/src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
