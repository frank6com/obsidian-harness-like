import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

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
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[esbuild] watching…')
} else {
  await esbuild.build(options)
  console.log('[esbuild] built dist/main.js')
}
