/**
 * 块 info string 解析（纯函数层：无 Obsidian / 宿主依赖，便于单测与复用）。
 *
 * 笔记形态（v2）：
 *   ```hl <target> [params...]
 *   <source>
 *   ```
 *   - target = <插件id 或 别名>[:<type>]，必填且必须是第一个参数
 *   - params 支持 k:v、k=v、k:"含 空格"（单双引号 + \ 转义）、--flag、--k=v、裸词
 *
 * 为什么需要这一层：Obsidian 的 registerMarkdownCodeBlockProcessor 只按
 *   info.split(/\s+/)[0].split(':')[0]
 * 查找处理器（2026-09-01 dev-vault 实测结论，见 block-service.ts 文件头），
 * handler 三个入参里【没有任何参数信息】——空格后的参数被原生剥掉，冒号后的段
 * 连注册都不生效。因此参数只能靠 ctx.getSectionInfo(el) 反查原始 fence 行拿回，
 * 本文件即负责"拿回"与"解析"两步。
 *
 * 大小写约定：pluginId / type / flag 小写归一（路由键必须稳定）；
 * params 的 key 与 positional 保留原样（语义由子插件自定义，归一反而会静默覆盖）。
 */

/** 命名空间首 token（Obsidian 侧的查找键；注册点也只有这一个） */
export const BLOCK_LANG = 'hl'

/** 别名最大长度 */
export const ALIAS_MAX_LEN = 32

/** 别名保留字：与目标解析冲突，禁止占用 */
const RESERVED_ALIASES = new Set(['hl'])

/** 别名合法形态：小写字母或数字开头，允许 - 与 _ */
const ALIAS_RE = /^[a-z0-9][a-z0-9_-]*$/

/** 围栏起始行（info 部分捕获） */
const FENCE_OPEN_RE = /^\s*(?:```+|~~~+)([^\n]*)$/
/** 围栏结束行 */
const FENCE_CLOSE_RE = /^\s*(?:```+|~~~+)\s*$/

/** 解析结果类别：ok=可用；legacy=旧语法 hl:<id>:<type>；notHl=非本命名空间；missingTarget=缺插件 id */
export type ParsedBlockInfoKind = 'ok' | 'legacy' | 'notHl' | 'missingTarget'

export interface ParsedBlockInfo {
  kind: ParsedBlockInfoKind
  /** 首 token 的小写形态（正常为 'hl'） */
  lang: string
  /** 第一个参数原文（如 'demo:chart'） */
  target: string
  /** target 冒号前的部分（小写归一），可能是插件 id 或别名，需宿主 resolve */
  pluginToken: string
  /** target 冒号后的 type（小写归一）；省略时为 '' */
  type: string
  /** 笔记是否显式写了 type（决定能否走默认 type 解析） */
  typeExplicit: boolean
  /** 键值参数（k:v / k=v / --k=v），key 保留原样 */
  params: Record<string, string>
  /** 开关（--flag，小写归一） */
  flags: string[]
  /** 其余位置参数（去引号，保留原样） */
  positional: string[]
  /** 旧语法解析结果（kind==='legacy' 时有值），用于提示新写法 */
  legacy?: { pluginId: string; type: string }
}

/**
 * 按空白切分 info，引号内的空白不切分（保留引号原文，供后续引号感知解析）。
 * 支持 \ 转义引号内的任意字符。
 *
 * 未闭合引号（用户漏写右引号）退化为"不识别引号"的纯空白切分：否则它会一直
 * 吞到行尾，把后面的参数全部并进这一个值里，错误静默且难排查。
 */
function tokenize(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (quote) {
      cur += c
      if (c === '\\' && i + 1 < input.length) {
        cur += input[i + 1]!
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += c
  }
  if (cur) out.push(cur)
  if (quote) return String(input).split(/\s+/).filter(Boolean)
  return out
}

/** 找第一个位于引号外的 `:`（用于切分 target 的 type） */
function findColon(s: string): number {
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === ':') return i
  }
  return -1
}

/** 找第一个位于引号外的 `:` 或 `=`（用于切分键值） */
function findSep(s: string): { index: number; len: number } | null {
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quote) {
      if (c === '\\') {
        i++
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (c === ':' || c === '=') return { index: i, len: 1 }
  }
  return null
}

/** 去掉成对引号并处理转义；未成对则原样返回（宽容，不报错） */
function unquote(s: string): string {
  const q = s[0]
  if ((q !== '"' && q !== "'") || s.length < 2 || s[s.length - 1] !== q) {
    // 未成对：仍处理转义，避免 \" 残留
    let out = ''
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      if (c === '\\' && i + 1 < s.length) {
        out += s[i + 1]!
        i++
        continue
      }
      out += c
    }
    return out
  }
  const inner = s.slice(1, -1)
  let out = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!
    if (c === '\\' && i + 1 < inner.length) {
      out += inner[i + 1]!
      i++
      continue
    }
    out += c
  }
  return out
}

/**
 * 解析整条 info string（不含 ``` 前缀，由 readFenceInfo 负责剥离）。
 *
 * 判定顺序：首 token 必须是 hl（否则按 legacy / notHl 处理）→ 第一个参数恒为 target
 * （无论是否含冒号，规则最可预测）→ 其余参数逐个归位。
 */
export function parseBlockInfo(info: string): ParsedBlockInfo {
  const empty = {
    target: '',
    pluginToken: '',
    type: '',
    typeExplicit: false,
    params: {} as Record<string, string>,
    flags: [] as string[],
    positional: [] as string[],
  }
  const tokens = tokenize(String(info ?? ''))
  const first = tokens[0] ?? ''
  const lang = first.toLowerCase()

  if (lang !== BLOCK_LANG) {
    // 只有 lookupKey 为 hl 的块会进本处理器，因此首 token 含冒号即旧写法 hl:<id>:<type>
    const seg = first.split(':')
    if (seg.length > 1 && seg[0]!.toLowerCase() === BLOCK_LANG) {
      return {
        kind: 'legacy',
        lang,
        ...empty,
        legacy: { pluginId: (seg[1] ?? '').toLowerCase(), type: (seg[2] ?? '').toLowerCase() },
      }
    }
    return { kind: 'notHl', lang, ...empty }
  }

  const rest = tokens.slice(1)
  if (!rest.length) return { kind: 'missingTarget', lang, ...empty }

  const target = rest[0]!
  const colon = findColon(target)
  const pluginToken = (colon >= 0 ? target.slice(0, colon) : target).toLowerCase()
  const type = (colon >= 0 ? target.slice(colon + 1) : '').toLowerCase()

  const params: Record<string, string> = {}
  const flags: string[] = []
  const positional: string[] = []
  for (const tok of rest.slice(1)) {
    if (tok.startsWith('--')) {
      const body = tok.slice(2)
      const sep = findSep(body)
      if (sep) {
        params[unquote(body.slice(0, sep.index))] = unquote(body.slice(sep.index + sep.len))
      } else if (body) {
        flags.push(body.toLowerCase())
      }
      continue
    }
    const sep = findSep(tok)
    if (sep && sep.index > 0) {
      params[unquote(tok.slice(0, sep.index))] = unquote(tok.slice(sep.index + sep.len))
      continue
    }
    positional.push(unquote(tok))
  }

  return {
    kind: 'ok',
    lang,
    target,
    pluginToken,
    type,
    typeExplicit: type !== '',
    params,
    flags,
    positional,
  }
}

/** fence 候选（section 反查结果） */
export interface FenceHit {
  /** 整条 info（已 trim，不含 ``` 前缀） */
  info: string
  /** fence 起始行的绝对行号（0-based）；经 CM 直读时可能拿不到，为 null */
  line: number | null
  /** 块内容是否与 source 一致（同一 section 多块时用于唯一定位） */
  exact: boolean
}

/**
 * 从渲染上下文反查本块所在 section 里的【全部】hl fence 候选。
 *
 * 为什么返回数组：Obsidian 的 section 按空行/标题切分——相邻的围栏块（中间无空行）
 * 属于同一个 section，而 ctx.getSectionInfo 只有 section 级粒度，handler 又拿不到
 * 自己的行号。单靠"内容 == source"匹配在多个内容相同的块（典型：插入的空模板）
 * 场景下会把所有块都定位到第一个 fence 上，导致全部渲染成同一语言。
 * 因此这里收集全部候选，由调用方（BlockService）按多级策略唯一定位。
 *
 * 只收集本命名空间的块（首 token 为 hl）：```html 等原生语言不参与定位。
 * 返回空数组表示拿不到（sectionInfo 不可用 / 无 hl 块）。
 */
export function readFenceCandidates(
  ctx: { getSectionInfo?: (el: HTMLElement) => { text?: string; lineStart?: number } | null } | null | undefined,
  el: HTMLElement,
  source: string,
): FenceHit[] {
  const si = ctx?.getSectionInfo?.(el)
  if (!si || typeof si.text !== 'string') return []
  const lines = si.text.split('\n')
  const want = String(source ?? '').replace(/\s+$/, '')
  const out: FenceHit[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN_RE.exec(lines[i]!)
    if (!m) continue
    const body: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      if (FENCE_CLOSE_RE.test(lines[j]!)) break
      body.push(lines[j]!)
    }
    const info = (m[1] ?? '').trim()
    if (!/^hl(\s|:|$)/i.test(info)) continue
    out.push({
      info,
      line: (si.lineStart ?? 0) + i,
      exact: body.join('\n').replace(/\s+$/, '') === want,
    })
    i = j // 跳过已消费的块体（j 为闭合行，外层 i++ 后落到闭合行的下一行）
  }
  return out
}

/**
 * 阅读模式定位：el 所在块在「渲染范围」内的序号（按文档顺序）。
 *
 * 不依赖任何容器类名（Obsidian 版本间 section 容器类名不稳定）：从 wrapper 的
 * 父级向上找第一个「同类块数量 === expected（section 候选数）」的祖先——数量恰好
 * 对上说明该祖先的渲染范围与本块的 section 一致；越过 section 边界后数量只会
 * 更多，即刻放弃。Live Preview 下块是独立 widget，各级容器要么只有 1 个、要么
 * 直接超过 expected，天然返回 null（定位走 CM 直读）。
 */
export function sectionOrdinal(el: HTMLElement, expected: number): number | null {
  const wrapper = el.closest('.block-language-hl')
  if (!wrapper || expected < 1) return null
  let anc: HTMLElement | null = wrapper.parentElement
  while (anc) {
    const all = Array.from(anc.querySelectorAll('.block-language-hl'))
    if (all.length === expected) {
      const k = all.indexOf(wrapper)
      return k >= 0 ? k : null
    }
    if (all.length > expected) return null
    anc = anc.parentElement
  }
  return null
}

/** 别名校验失败原因 */
export type AliasReject = 'invalid' | 'reserved' | 'takenById' | 'takenByAlias'

export type AliasCheck = { ok: true; alias: string } | { ok: false; reason: AliasReject }

/**
 * 校验插件 id 别名（ shorten 笔记里的 pluginId 输入用）。
 *
 * - 空串按 invalid 处理（清除别名由调用方先判空，不走校验）
 * - takenById：不得等于任何插件的真实 id —— 防止子插件用别名劫持他人命名空间
 * - takenByAlias：不得与其他插件已占用的别名重复（taken 需排除自己；
 *   指向已删除插件的残留别名由调用方先剔除，允许被抢占）
 */
export function validatePluginAlias(
  raw: string,
  opts: { knownIds?: readonly string[]; taken?: readonly string[] } = {},
): AliasCheck {
  const alias = String(raw ?? '').trim().toLowerCase()
  if (!alias || alias.length > ALIAS_MAX_LEN || !ALIAS_RE.test(alias)) return { ok: false, reason: 'invalid' }
  if (RESERVED_ALIASES.has(alias)) return { ok: false, reason: 'reserved' }
  const known = opts.knownIds ?? []
  if (known.some((id) => String(id).toLowerCase() === alias)) return { ok: false, reason: 'takenById' }
  const taken = opts.taken ?? []
  if (taken.some((a) => String(a).toLowerCase() === alias)) return { ok: false, reason: 'takenByAlias' }
  return { ok: true, alias }
}
