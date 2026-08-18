/**
 * 插件文件自愈：启动时检查 styles.css 是否缺失（Obsidian 将其视为 optional 资产，
 * 安装时网络不佳会静默跳过 → 设置页/对话面板无样式），缺失则自动从多个
 * 候选源下载并写回插件目录，并在设置页与对话面板展示状态。
 */

import type { Context } from '@deepseek-ai/cordis'
import { t } from './i18n'

export type PluginFilesPhase = 'ok' | 'downloading' | 'restored' | 'failed'

export interface PluginFilesStatus {
  /** styles.css 是否缺失 */
  stylesMissing: boolean
  phase: PluginFilesPhase
  /** 失败原因（phase = failed 时） */
  error?: string
}

export interface PluginFilesOptions {
  /** 插件目录（vault 相对，如 .obsidian/plugins/harness-like） */
  pluginDir: string
  /** GitHub 仓库（如 frank6com/obsidian-harness-like） */
  repo: string
  /** 当前版本（用于拼 release tag） */
  version: string
  exists(path: string): Promise<boolean>
  write(path: string, content: string): Promise<void>
  /** 抓取文本（网络层可注入，测试用 mock）；失败返回 null */
  fetchText(url: string): Promise<string | null>
}

/** 候选下载源（按国内网络可达性排序：jsdelivr CDN → raw → release 直连） */
export function candidateUrls(repo: string, version: string): string[] {
  return [
    `https://cdn.jsdelivr.net/gh/${repo}@${version}/styles.css`,
    `https://raw.githubusercontent.com/${repo}/${version}/styles.css`,
    `https://github.com/${repo}/releases/download/${version}/styles.css`,
  ]
}

/** 默认网络实现：带超时的 fetch（超时返回 null，不抛错） */
export function fetchTextWithTimeout(url: string, timeoutMs = 15000): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = globalThis.setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(url, { signal: ctrl.signal })
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null)
    .finally(() => globalThis.clearTimeout(timer))
}

/** 内容有效性校验：样式文件应包含样式规则标记，且非空壳 */
export function looksLikeStylesheet(text: string): boolean {
  return text.length > 500 && text.includes('.dsh-')
}

export class PluginFilesSelfHeal {
  /** 插件目录（vault 相对） */
  readonly pluginDir: string
  /** 对应版本的 GitHub release 页面（失败提示的下载入口） */
  readonly releaseUrl: string

  private status: PluginFilesStatus = { stylesMissing: false, phase: 'ok' }
  private running: Promise<void> | null = null

  constructor(private opts: PluginFilesOptions, private ctx: Context) {
    this.pluginDir = opts.pluginDir
    this.releaseUrl = `https://github.com/${opts.repo}/releases/tag/${opts.version}`
  }

  statusOf(): PluginFilesStatus {
    return this.status
  }

  /** 检查并自动下载（幂等：并发调用只跑一次；restored/failed 后可再次触发重试） */
  ensure(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async run(): Promise<void> {
    const stylesPath = `${this.opts.pluginDir}/styles.css`
    try {
      if (await this.opts.exists(stylesPath)) {
        this.status = { stylesMissing: false, phase: 'ok' }
        return
      }
    } catch {
      // 检查失败按缺失处理，进入下载流程
    }
    this.status = { stylesMissing: true, phase: 'downloading' }
    this.emit()
    for (const url of candidateUrls(this.opts.repo, this.opts.version)) {
      const text = await this.opts.fetchText(url)
      if (text && looksLikeStylesheet(text)) {
        try {
          await this.opts.write(stylesPath, text)
          this.status = { stylesMissing: false, phase: 'restored' }
          this.emit()
          return
        } catch {
          // 写入失败换下一个源
        }
      }
    }
    this.status = { stylesMissing: true, phase: 'failed', error: '全部下载源不可达或内容无效' }
    this.emit()
  }

  private emit(): void {
    this.ctx.emit('dsh/plugin-files', this.status)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 插件文件自愈（styles.css 缺失检测 + 自动下载） */
    pluginFiles: PluginFilesSelfHeal
    /** 打开外部目标（http(s) 走系统浏览器 / 本地路径走系统文件管理器） */
    openExternal(target: string): void
  }
  interface Events {
    /** 插件文件状态变化（下载中 / 已恢复 / 失败），设置页与对话面板订阅 */
    'dsh/plugin-files': (status: PluginFilesStatus) => void
  }
}

/** 自愈状态条的基础样式（内联，不依赖 styles.css——自愈 UI 在样式缺失时也必须可读） */
export const FILES_BANNER_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  padding: '4px 12px',
  borderRadius: '6px',
  border: '1px solid var(--background-modifier-border)',
  background: 'var(--background-primary)',
  color: 'var(--text-normal)',
  fontSize: '12px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export interface FilesOverlayHandlers {
  /** 重载宿主插件（restored 态按钮） */
  reload(): void
  /** 打开外部目标（release 下载页 / 插件目录） */
  openExternal(target: string): void
  /** 重试下载（failed 态按钮） */
  retry(): void
}

export interface FilesOverlayInfo {
  phase: string
  pluginDir: string
  releaseUrl: string
}

/**
 * 构建自愈遮罩层（全屏蒙层 + 居中卡片；全部内联样式，不依赖 styles.css）。
 * 文案分行靠左：标题 / 因果说明 / 操作按钮。
 * root 需为相对定位容器（调用方设置 position: relative）。
 */
export function buildFilesOverlay(
  root: HTMLElement,
  info: FilesOverlayInfo,
  handlers: FilesOverlayHandlers,
): HTMLElement {
  const overlay = root.createDiv()
  overlay.setCssStyles({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.45)',
    zIndex: '100',
    padding: '24px',
    boxSizing: 'border-box',
  })
  const card = overlay.createDiv()
  card.setCssStyles({
    background: 'var(--background-primary)',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: '10px',
    padding: '20px 26px',
    maxWidth: '560px',
    width: '100%',
    textAlign: 'left',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.35)',
  })
  // 标题行
  const title = card.createDiv({ text: t('files.title') })
  title.setCssStyles({ fontWeight: '600', fontSize: '14px', marginBottom: '10px' })
  if (info.phase === 'downloading') {
    // spinner + 说明（同一行左对齐）
    const row = card.createDiv()
    row.setCssStyles({ display: 'flex', alignItems: 'center', gap: '10px' })
    const spin = row.createSpan({ text: '⟳' })
    spin.setCssStyles({ fontSize: '18px', color: 'var(--text-accent)' })
    // spinner 动画用 Web Animations API（官方 review 禁止运行时创建 <style> 元素）
    if (typeof spin.animate === 'function') {
      spin.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
        duration: 1000,
        iterations: Infinity,
      })
    }
    const downloading = row.createSpan({ text: t('files.downloading') })
    downloading.setCssStyles({ flex: '1' })
  } else if (info.phase === 'restored') {
    const restored = card.createDiv({ text: t('files.restored') })
    restored.setCssStyles({ fontSize: '13px', lineHeight: '1.6' })
    const actions = card.createDiv()
    actions.setCssStyles({ display: 'flex', gap: '8px', marginTop: '14px' })
    const btn = actions.createEl('button', { text: t('files.reload') })
    btn.setCssStyles(FILES_BANNER_BTN_STYLE)
    btn.onclick = () => handlers.reload()
  } else {
    // 失败：因果说明 → 可尝试选项 → 手动步骤（编号、整行可点击）→ 重试，全部左对齐分行
    const failed = card.createDiv({ text: t('files.failed') })
    failed.setCssStyles({ fontSize: '13px', lineHeight: '1.6' })
    const options = card.createDiv({ text: t('files.failedOptions') })
    options.setCssStyles({ fontSize: '13px', marginTop: '12px' })
    const reinstall = card.createDiv({ text: `· ${t('files.optionReinstall')}` })
    reinstall.setCssStyles({ fontSize: '13px', lineHeight: '1.7', marginLeft: '10px' })
    const manual = card.createDiv({ text: `· ${t('files.optionManual')}` })
    manual.setCssStyles({ fontSize: '13px', lineHeight: '1.7', marginLeft: '10px' })
    // 步骤 1：从 release 下载 styles.css（整行可点击跳转）
    const step1 = card.createEl('button', { text: t('files.stepDownload') })
    step1.setCssStyles({
      display: 'block',
      width: '100%',
      textAlign: 'left',
      marginLeft: '10px',
      marginTop: '4px',
      padding: '2px 0',
      background: 'transparent',
      border: 'none',
      color: 'var(--text-accent)',
      fontSize: '13px',
      lineHeight: '1.7',
      cursor: 'pointer',
    })
    step1.onclick = () => handlers.openExternal(info.releaseUrl)
    // 步骤 2：复制到插件所在目录（显示路径，整行可点击打开目录）
    const step2 = card.createEl('button', { text: `${t('files.stepCopy')}${info.pluginDir}` })
    step2.setCssStyles({
      display: 'block',
      width: '100%',
      textAlign: 'left',
      marginLeft: '10px',
      padding: '2px 0',
      background: 'transparent',
      border: 'none',
      color: 'var(--text-accent)',
      fontSize: '13px',
      lineHeight: '1.7',
      cursor: 'pointer',
      wordBreak: 'break-all',
      whiteSpace: 'normal',
    })
    step2.onclick = () => handlers.openExternal(info.pluginDir)
    // 重新尝试自动修复
    const actions = card.createDiv()
    actions.setCssStyles({ display: 'flex', gap: '8px', marginTop: '16px' })
    const retry = actions.createEl('button', { text: t('files.retry') })
    retry.setCssStyles(FILES_BANNER_BTN_STYLE)
    retry.onclick = () => handlers.retry()
  }
  return overlay
}
