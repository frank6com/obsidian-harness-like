import esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const watch = process.argv.includes('--watch')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEV_VAULT_DIR = path.resolve(
  ROOT,
  process.env.DEV_VAULT_DIR || 'dev-vault',
)
const PLUGIN_DIR = path.join(DEV_VAULT_DIR, '.obsidian', 'plugins', 'harness-like')

/** 构建后把四个产物同步进 dev-vault 的插件目录（dev-vault 不存在则跳过） */
function syncDevVault() {
  if (!fs.existsSync(DEV_VAULT_DIR)) return
  fs.mkdirSync(PLUGIN_DIR, { recursive: true })
  for (const name of ['main.js', 'manifest.json', 'styles.css', 'versions.json']) {
    const src = path.join(ROOT, 'apps', 'plugin', name === 'main.js' ? 'dist/main.js' : name)
    fs.copyFileSync(src, path.join(PLUGIN_DIR, name))
  }
  console.log(`[sync] 产物已同步 → ${PLUGIN_DIR}`)
}

const syncPlugin = {
  name: 'sync-dev-vault',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return
      try {
        syncDevVault()
      } catch (err) {
        console.warn('[sync] 同步失败:', err)
      }
    })
  },
}

/**
 * Obsidian renderer 兼容：
 * - node:module → 本地垫片（dsh-llm 顶层 createRequire 读 package.json 会炸）
 * - 其余 node:* 内置模块 → 剥掉 node: 前缀（裸名是 Obsidian require shim 最稳的形态）
 */
const nodeShimPlugin = {
  name: 'node-module-shim',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => {
      const name = args.path.slice('node:'.length)
      if (name === 'module') {
        return { path: path.join(ROOT, 'apps', 'plugin', 'shims', 'node-module.ts') }
      }
      return { path: name, external: true }
    })
  },
}

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  // obsidian 由 Obsidian 运行时提供；node 内置模块保持 external（platform: node）
  external: ['obsidian', 'electron'],
  sourcemap: 'inline',
  logLevel: 'info',
  plugins: [nodeShimPlugin, syncPlugin],
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[esbuild] watching…（构建后自动同步 dev-vault）')
} else {
  await esbuild.build(options)
  console.log('[esbuild] built dist/main.js')
}
