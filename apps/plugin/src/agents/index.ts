/**
 * 智能体提示词组装（对齐 DeepSeek Harness system-prompt 的分层思想，按本项目规模简化）：
 *
 *   [_common 身份与安全底线] + [智能体 persona] + [语言指令] + [动态上下文（笔记等）]
 *
 * - 内置智能体的 persona 以英文 md 文件维护（src/agents/*.md，构建期 esbuild text loader
 *   内联——运行时零文件解析）；提示词用英文撰写（模型侧惯例），回复语言由语言指令动态约束。
 * - 自定义智能体的 systemPrompt 字段遮蔽内置 persona（scoped shadow 模型；dsh 同构：
 *   agent 级 persona 覆盖全局默认）。内置不可变，fork-on-edit 复制出可编辑副本。
 */

import commonMd from './_common.md'
import chatMd from './chat.md'
import createMd from './create.md'
import editMd from './edit.md'
import type { AgentPreset } from '../settings'

export const COMMON_PROMPT = commonMd.trim()

const BUILTIN_PERSONAS: Record<string, string> = {
  chat: chatMd.trim(),
  edit: editMd.trim(),
  create: createMd.trim(),
}

/** 内置智能体 persona（未知名返回 undefined） */
export function builtinPersona(agentId: string): string | undefined {
  return BUILTIN_PERSONAS[agentId]
}

/**
 * 解析某智能体最终生效的 persona：
 * 自定义 systemPrompt（非空白）优先遮蔽；否则按 id 取内置 md；两者皆无 → ''（仅剩 _common）。
 */
export function agentPersona(agent: AgentPreset | undefined): string {
  const custom = agent?.systemPrompt?.trim()
  if (custom) return custom
  return (agent && builtinPersona(agent.id)) || ''
}

/** 回复语言指令：提示词为英文基底，实际回复语言由此动态约束 */
export function languageDirective(lang: 'zh' | 'en'): string {
  return lang === 'zh'
    ? 'Always respond to the user in Simplified Chinese (简体中文).'
    : 'Always respond to the user in English.'
}

/** fork-on-edit：以内置（或任意）智能体为模板创建可编辑副本（含当前生效 persona 文本起步） */
export function forkAgentDraft(source: AgentPreset): AgentPreset & { enabled: true } {
  const persona = source.systemPrompt?.trim() || builtinPersona(source.id)
  return {
    ...source,
    id: `agent-${Date.now()}`,
    name: `${source.name} 副本`,
    enabled: true,
    ...(persona ? { systemPrompt: persona } : {}),
  }
}
