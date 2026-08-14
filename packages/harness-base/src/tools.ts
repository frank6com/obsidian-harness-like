/**
 * 工具注册表（dsh ctx.tools 的薄实现；P1 替换为 @deepseek-ai/dsh-tools）。
 */

import type { ToolDef } from './types'

export class ToolRegistry {
  private map = new Map<string, ToolDef>()

  register(tool: ToolDef): () => void {
    if (this.map.has(tool.name)) {
      throw new Error(`工具已注册: ${tool.name}`)
    }
    this.map.set(tool.name, tool)
    return () => this.map.delete(tool.name)
  }

  unregister(name: string): void {
    this.map.delete(name)
  }

  get(name: string): ToolDef | undefined {
    return this.map.get(name)
  }

  list(): ToolDef[] {
    return [...this.map.values()]
  }
}
