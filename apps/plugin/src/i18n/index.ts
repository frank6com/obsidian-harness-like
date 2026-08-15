/**
 * 界面国际化（zh / en）——公共 API 入口。
 *
 * 字典按语言分文件：./zh.ts、./en.ts（每语言一个文件，键一一对应）。
 * 语言偏好（设置 → 界面）：'auto' = 跟随 Obsidian 应用语言（默认），
 * 或显式 'zh' / 'en'。Obsidian 的应用语言存放在 localStorage['language']
 * （已对照官方 bundle 核实：key 为 "language"，切语言后 location.reload()）。
 *
 * 用法：所有用户可见文案统一走 t('key', {vars})；语言切换后视图监听
 * dsh/settings-updated 重建。品牌名（Harness Like）、命令 id、工具名等
 * 协议面内容不翻译。字典键按模块前缀：chat.* / pm.* / settings.* / modal.* / cmd.* / agent.* / common.*
 */

import zh from './zh'
import en from './en'

export type Language = 'zh' | 'en'
/** 设置中保存的语言偏好：auto = 跟随 Obsidian 应用语言 */
export type LanguagePreference = 'auto' | Language

const dictionaries: Record<Language, Record<string, string>> = { zh, en }

let current: Language = resolveLanguage('auto')

/** 读取 Obsidian 应用语言（localStorage['language']，缺失回退 navigator.language） */
function obsidianLanguage(): string {
  try {
    const stored =
      typeof localStorage !== 'undefined' ? (localStorage.getItem('language') ?? '') : ''
    if (stored) return stored
  } catch {
    // localStorage 不可用（如部分测试环境）时忽略
  }
  try {
    return (typeof navigator !== 'undefined' ? navigator.language : '') ?? ''
  } catch {
    return ''
  }
}

/** 解析语言偏好 → 实际语言：auto 跟随 Obsidian 应用语言（zh* → 中文，否则英文） */
export function resolveLanguage(pref: LanguagePreference): Language {
  if (pref === 'zh' || pref === 'en') return pref
  const lang = obsidianLanguage().toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

/** 依据浏览器/Obsidian 语言自动选择默认界面语言（保留旧 API，等价 resolveLanguage('auto')） */
export function detectLanguage(): Language {
  return resolveLanguage('auto')
}

export function setLanguage(lang: Language): void {
  current = lang
}

export function getLanguage(): Language {
  return current
}

/** 取当前语言文案；缺失时回退中文，再回退 key 本身 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const table = dictionaries[current] ?? zh
  let text = table[key] ?? zh[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v))
    }
  }
  return text
}

/** 内置智能体显示名（自定义智能体用存储值） */
export function agentDisplayName(a: { id: string; name: string }): string {
  const key = `agent.${a.id}.name`
  return key in zh ? t(key) : a.name
}

/** 内置智能体显示描述（自定义智能体用存储值） */
export function agentDisplayDesc(a: { id: string; description?: string }): string | undefined {
  const key = `agent.${a.id}.desc`
  return key in zh ? t(key) : a.description
}
