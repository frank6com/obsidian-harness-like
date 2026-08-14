/**
 * 智能体模式策略：按模式过滤工具可用性（对齐 dsh 预设模式）。
 *
 * - chat（对话）：仅只读内置工具（对话 + 读取信息）
 * - edit（修编）：排除插件开发工具（可读写笔记）
 * - create（创造）：完整能力（含插件创建/修改）
 */

import type { AgentMode } from './settings'

const READONLY_TOOLS = new Set(['read_note', 'search_notes', 'list_notes'])
const PLUGIN_DEV_TOOLS = new Set([
  'create_plugin',
  'write_plugin_file',
  'plugin_status',
  'reload_plugin',
  'open_view',
  'plugin_guide',
])

/** 当前模式下工具是否可用 */
export function modeAllows(mode: AgentMode, toolName: string): boolean {
  if (mode === 'create') return true
  if (mode === 'edit') return !PLUGIN_DEV_TOOLS.has(toolName)
  return READONLY_TOOLS.has(toolName)
}
