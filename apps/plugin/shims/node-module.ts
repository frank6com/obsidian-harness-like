/**
 * node:module 垫片（Obsidian renderer 兼容）。
 *
 * dsh-llm 在模块顶层执行 createRequire(import.meta.url)("../package.json")
 * 读取自身版本用于 APP_IDENTITY；打包进 Obsidian 后该相对 require
 * 指向不存在的路径，导致插件加载失败。此垫片在 bundle 内联，
 * 不触发任何顶层 require。
 */

export function createRequire(_filename: string | URL): (id: string) => unknown {
  return (id: string) => {
    // dsh-llm 仅用它读取自身 package.json 的 version（User-Agent 归属）
    if (id.endsWith('package.json')) return { version: '0.1.0' }
    // 兜底：交给宿主 require
    return require(id)
  }
}
