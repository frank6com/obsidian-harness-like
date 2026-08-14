/**
 * 沙箱策略（纯逻辑，可单测）。
 *
 * v1 白名单（设计文档 §5.8）：
 * - 读：整个 vault 根 + 临时目录
 * - 写/删：vault 内笔记区、.obsidian/dsh/、.obsidian/dsh-plugins/、临时目录
 * - 拒绝：vault 外任何路径；.obsidian/ 内其他区域（plugins/、app.json、workspace.json 等）
 */

import * as path from 'path'

export interface SandboxScope {
  /** vault 根目录（绝对路径） */
  vaultRoot: string
  /** 本插件数据目录，如 <vault>/.obsidian/dsh */
  dataDir: string
  /** 用户 Cordis 插件目录，如 <vault>/.obsidian/dsh-plugins */
  pluginsDir: string
  /** 临时目录（可写） */
  tempDir: string
}

export type SandboxAction = 'read' | 'write' | 'delete'

export interface SandboxDecision {
  allowed: boolean
  reason?: string
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 相对路径基于 vault 根解析；绝对路径原样归一化 */
export function resolveTarget(scope: SandboxScope, target: string): string {
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(scope.vaultRoot, target)
}

export function decideSandbox(
  scope: SandboxScope,
  target: string,
  action: SandboxAction,
): SandboxDecision {
  const abs = resolveTarget(scope, target)
  if (!isInside(scope.vaultRoot, abs)) {
    return { allowed: false, reason: `超出 vault 范围: ${abs}` }
  }
  if (action === 'read') return { allowed: true }

  // 写/删：白名单目录
  if (isInside(scope.dataDir, abs)) return { allowed: true }
  if (isInside(scope.pluginsDir, abs)) return { allowed: true }
  if (isInside(scope.tempDir, abs)) return { allowed: true }

  const obsidianDir = path.join(scope.vaultRoot, '.obsidian')
  if (isInside(obsidianDir, abs)) {
    return { allowed: false, reason: '禁止修改 Obsidian 配置目录（.obsidian/）' }
  }
  return { allowed: true }
}

export class SandboxPolicy {
  constructor(public readonly scope: SandboxScope) {}

  decide(target: string, action: SandboxAction): SandboxDecision {
    return decideSandbox(this.scope, target, action)
  }

  assertWrite(target: string): void {
    const d = this.decide(target, 'write')
    if (!d.allowed) throw new Error(`沙箱拒绝写 ${target}: ${d.reason}`)
  }
}
