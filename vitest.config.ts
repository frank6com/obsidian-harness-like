import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/__tests__/**/*.test.ts', 'apps/plugin/src/__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
