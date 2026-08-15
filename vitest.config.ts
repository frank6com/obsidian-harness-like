import { defineConfig } from 'vitest/config'
import * as path from 'path'

export default defineConfig({
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
