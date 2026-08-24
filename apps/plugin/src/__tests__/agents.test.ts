/**
 * 智能体提示词组装测试（0.45.0）：
 * persona 解析（内置 md / 自定义遮蔽）、语言指令、fork-on-edit 草稿。
 */

import { describe, expect, it } from 'vitest'
import { agentPersona, builtinPersona, forkAgentDraft, languageDirective, COMMON_PROMPT } from '../agents'
import { BUILTIN_AGENTS } from '../settings'

describe('agentPersona：内置 md 与自定义遮蔽', () => {
  it('三个内置智能体均有非空英文 persona，且 _common 为共享身份底线', () => {
    for (const a of BUILTIN_AGENTS) {
      expect(builtinPersona(a.id), a.id).toBeTruthy()
    }
    expect(COMMON_PROMPT).toContain('Harness Like')
    expect(COMMON_PROMPT).toContain('approval')
  })

  it('创造模式 persona 承载插件开发指引（自 ChatView 收编）', () => {
    const p = builtinPersona('create')!
    for (const anchor of ['create_plugin', 'check_plugin', 'reload_plugin', 'plugin_guide', 'ctx.effect', 'getMarkdownPaths']) {
      expect(p).toContain(anchor)
    }
  })

  it('对话模式 persona 声明只读边界；修编模式强调审批与最小改动', () => {
    expect(builtinPersona('chat')).toMatch(/read-only/i)
    expect(builtinPersona('edit')).toMatch(/approval|minimal/i)
  })

  it('自定义 systemPrompt 非空时遮蔽内置（scoped shadow）；内置 id 空白回退内置 md；自定义 id 空白仅剩 _common', () => {
    const edit = BUILTIN_AGENTS.find((a) => a.id === 'edit')!
    expect(agentPersona({ ...edit, id: 'agent-x', systemPrompt: 'You are a poetry editor.' })).toBe(
      'You are a poetry editor.',
    )
    // 内置 id + 空白 systemPrompt（normalize 本会剥离）→ 回退内置 md
    expect(agentPersona({ ...edit, systemPrompt: '   ' })).toBe(builtinPersona('edit'))
    // 自定义 id 无内置 md 可回退 → 空（组装层 filter 掉，仅剩 _common）
    expect(agentPersona({ ...edit, id: 'agent-x', systemPrompt: '   ' })).toBe('')
  })

  it('无内置且无自定义 → 空字符串（组装层 filter 掉）', () => {
    expect(agentPersona(undefined)).toBe('')
  })
})

describe('languageDirective', () => {
  it('zh 要求简体中文回复；en 要求英文', () => {
    expect(languageDirective('zh')).toContain('Simplified Chinese')
    expect(languageDirective('en')).toContain('English')
  })
})

describe('forkAgentDraft（内置不可变，复制出可编辑副本）', () => {
  it('副本携带新 id/名称/启用态，并内置当前生效 persona 文本起步', () => {
    const edit = BUILTIN_AGENTS.find((a) => a.id === 'edit')!
    const draft = forkAgentDraft(edit)
    expect(draft.id).not.toBe(edit.id)
    expect(draft.id.startsWith('agent-')).toBe(true)
    expect(draft.name).toContain(edit.name)
    expect(draft.enabled).toBe(true)
    expect(draft.systemPrompt).toBe(builtinPersona('edit'))
    // 原模板未被污染
    expect(BUILTIN_AGENTS.find((a) => a.id === 'edit')?.systemPrompt).toBeUndefined()
  })
})
