/**
 * 智能体策略：按智能体预设过滤工具可用性。
 *
 * - 自定义智能体：capabilities 白名单（勾选的能力）优先
 * - 内置智能体：按基础模式过滤
 *   - chat（对话）：仅只读内置工具
 *   - edit（修编）：排除插件开发工具（可读写笔记）
 *   - create（创造）：完整能力（含插件创建/修改）
 */

import type { AgentMode, AgentPreset } from './settings'

const READONLY_TOOLS = new Set(['read_note', 'search_notes', 'list_notes'])
const PLUGIN_DEV_TOOLS = new Set([
  'create_plugin',
  'write_plugin_file',
  'plugin_status',
  'reload_plugin',
  'open_view',
  'plugin_guide',
])

/** 当前模式下工具是否可用（内置预设） */
export function modeAllows(mode: AgentMode, toolName: string): boolean {
  if (mode === 'create') return true
  if (mode === 'edit') return !PLUGIN_DEV_TOOLS.has(toolName)
  return READONLY_TOOLS.has(toolName)
}

/** 按智能体预设判断工具是否可用（自定义智能体能力白名单优先） */
export function agentAllows(agent: AgentPreset | undefined, toolName: string): boolean {
  if (!agent) return false
  if (agent.capabilities?.length) return agent.capabilities.includes(toolName)
  return modeAllows(agent.mode, toolName)
}
