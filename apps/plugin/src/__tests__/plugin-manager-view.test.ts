// @vitest-environment jsdom

/**
 * PluginManagerView 渲染测试（jsdom）：插件名后复制 ID 按钮（0.39.0）。
 * 复制的是插件 id 本身——agent 工具参数即 plugin_id，便于用户在对话中引用。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

function polyfillObsidianDom(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  if (proto.createDiv) return
  const make = (tag: string) =>
    function (this: HTMLElement, opts?: { cls?: string; text?: string }) {
      const el = document.createElement(tag)
      if (opts?.cls) el.className = opts.cls
      if (opts?.text) el.textContent = opts.text
      this.appendChild(el)
      return el
    }
  proto.createDiv = make('div')
  proto.createSpan = make('span')
  proto.createEl = function (this: HTMLElement, tag: string, opts?: { cls?: string; text?: string }) {
    const el = document.createElement(tag)
    if (opts?.cls) el.className = opts.cls
    if (opts?.text) el.textContent = opts.text
    this.appendChild(el)
    return el
  }
  proto.empty = function (this: HTMLElement) {
    this.innerHTML = ''
  }
  proto.setText = function (this: HTMLElement, t: string) {
    this.textContent = t
  }
}

import { PluginManagerView } from '../views/PluginManagerView'
import { DeletedPluginsModal, PluginDetailModal } from '../modals'
import { setLanguage } from '../i18n'

type Rec = Record<string, unknown>

function makeView(recs: Rec): PluginManagerView
function makeView(recs: Rec[]): PluginManagerView
function makeView(recs: Rec | Rec[]): PluginManagerView {
  polyfillObsidianDom()
  const list = Array.isArray(recs) ? recs : [recs]
  const byId = new Map(list.map((r) => [r.id as string, r]))
  const ctx = {
    on: vi.fn(() => () => {}),
    pluginRuntime: {
      discover: async () => list.map((r) => r.id as string),
      get: (id: string) => byId.get(id),
      inspect: (id: string) => byId.get(id) ?? { id, status: 'stopped' },
    },
    approval: { getGrant: () => null },
    sandbox: { scope: { pluginsDir: '/tmp/plugins', configDir: '.obsidian' } },
    notice: { notice: () => {} },
    settings: { get: (_k: string, d: unknown) => d, set: () => {} },
    views: { open: () => {} },
    commands: { execute: () => {} },
  }
  return new PluginManagerView({} as never, ctx as never, { openFolder: () => {} })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('插件管理器：复制插件 ID 按钮（0.39.0）', () => {
  it('插件名后装配复制按钮，点击写入剪贴板并反馈 ✓', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = makeView({
      id: 'demo-plugin',
      manifest: { version: '1.2.3', description: '示例' },
      status: 'stopped',
      capabilities: [],
      viewType: null,
      error: null,
    })
    await view.onOpen()
    const btn = view.contentEl.querySelector('.dsh-pm-copy-id') as HTMLButtonElement
    expect(btn).toBeTruthy()
    // 名称行含 id 与版本号文本
    const nameEl = view.contentEl.querySelector('.dsh-pm-name')!
    expect(nameEl.textContent).toContain('demo-plugin')
    expect(nameEl.textContent).toContain('v1.2.3')
    // 点击复制 id（非带版本号的显示文本）
    btn.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).toHaveBeenCalledWith('demo-plugin')
    expect(btn.textContent).toBe('✓')
  })
})

describe('插件管理器：状态分组排序', () => {
  const base = { manifest: null, capabilities: [], viewType: null, error: null }

  it('全部视图下运行中在前，其后已停止，错误最后；组内按 id 字母序（目录顺序无关）', async () => {
    // discover 故意打乱：错误 → 停止 → 运行
    const view = makeView([
      { ...base, id: 'zeta-error', status: 'error' },
      { ...base, id: 'mid-stopped', status: 'stopped' },
      { ...base, id: 'alpha-running', status: 'running' },
      { ...base, id: 'beta-running', status: 'running' },
      { ...base, id: 'aaa-error', status: 'error' },
      { ...base, id: 'abc-stopped', status: 'stopped' },
    ])
    await view.onOpen()
    const names = [...view.contentEl.querySelectorAll('.dsh-pm-name > span')].map((el) => el.textContent)
    expect(names).toEqual(['alpha-running', 'beta-running', 'abc-stopped', 'mid-stopped', 'aaa-error', 'zeta-error'])
  })
})

describe('插件管理器：状态过滤 tab 分组', () => {
  const base = { manifest: null, capabilities: [], viewType: null, error: null }
  const recs = [
    { ...base, id: 'alpha-running', status: 'running' },
    { ...base, id: 'beta-running', status: 'running' },
    { ...base, id: 'abc-stopped', status: 'stopped' },
    { ...base, id: 'aaa-error', status: 'error' },
  ]

  beforeEach(() => {
    setLanguage('zh') // jsdom navigator.language 为 en，固定中文以断言文案
  })

  const rowIds = (view: PluginManagerView): string[] =>
    [...view.contentEl.querySelectorAll('.dsh-pm-name > span')].map((el) => el.textContent ?? '')

  const tabTexts = (view: PluginManagerView): string[] =>
    [...view.contentEl.querySelectorAll('.dsh-pm-tab')].map((el) => el.textContent ?? '')

  it('渲染四个带计数的 tab，默认「全部」显示所有插件', async () => {
    const view = makeView(recs)
    await view.onOpen()
    expect(tabTexts(view)).toEqual(['全部4', '运行中2', '已停止1', '错误1'])
    expect(rowIds(view)).toHaveLength(4)
  })

  it('点击 tab 只显示对应状态的插件，选中态高亮且跨刷新保留', async () => {
    const view = makeView(recs)
    await view.onOpen()
    const tabs = [...view.contentEl.querySelectorAll('.dsh-pm-tab')] as HTMLButtonElement[]
    tabs[1]!.click() // 运行中
    await new Promise((r) => setTimeout(r, 0))
    expect(rowIds(view)).toEqual(['alpha-running', 'beta-running'])
    const active = view.contentEl.querySelector('.dsh-pm-tab.is-active')
    expect(active?.textContent).toBe('运行中2')
    // 操作（刷新）后仍保持该过滤
    await view.onOpen()
    expect(rowIds(view)).toEqual(['alpha-running', 'beta-running'])
  })

  it('切到空分组时显示占位提示而非空白', async () => {
    const view = makeView([{ ...base, id: 'only-running', status: 'running' }])
    await view.onOpen()
    const tabs = [...view.contentEl.querySelectorAll('.dsh-pm-tab')] as HTMLButtonElement[]
    tabs[3]!.click() // 错误（0 个）
    await new Promise((r) => setTimeout(r, 0))
    expect(rowIds(view)).toEqual([])
    expect(view.contentEl.querySelector('.dsh-pm-tab-empty')?.textContent).toBeTruthy()
  })
})

describe('插件管理器：工具栏布局', () => {
  it('刷新/打开插件目录/已删除插件按钮位于 tabs 右侧工具区', async () => {
    setLanguage('zh')
    const view = makeView([
      { id: 'a', status: 'running', manifest: null, capabilities: [], viewType: null, error: null },
    ])
    await view.onOpen()
    const toolbar = view.contentEl.querySelector('.dsh-pm-toolbar')
    expect(toolbar).toBeTruthy()
    expect(toolbar!.querySelector('.dsh-pm-tabs .dsh-pm-tab')).toBeTruthy()
    const toolBtns = [...toolbar!.querySelectorAll('.dsh-pm-tools button')].map((b) => b.textContent)
    expect(toolBtns).toEqual(['刷新', '打开插件目录', '已删除插件'])
  })
})

describe('已删除插件弹窗：清空全部 + 单项永久删除', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    polyfillObsidianDom()
    setLanguage('zh')
  })

  function makeModal(deletedIds: string[]) {
    const ctx = {
      pluginRuntime: { discover: async () => ['live-plugin'] },
      pluginBackups: {
        deletedPlugins: async (_live: string[]) => deletedIds,
        list: async (id: string) =>
          deletedIds.includes(id)
            ? [{ id: '1-delete', time: 1, reason: 'delete', fileCount: 2, bytes: 10 }]
            : [],
        removeAll: vi.fn(async () => {}),
      },
      notice: { notice: vi.fn() },
      sandbox: { scope: { pluginsDir: '/tmp/plugins' } },
    }
    return new DeletedPluginsModal({} as never, ctx as never)
  }

  it('列表项带恢复+永久删除两个按钮，顶部带清空全部按钮与提示语', async () => {
    const modal = makeModal(['gone-x', 'gone-y'])
    await (modal as unknown as { render(): Promise<void> }).render()
    const rows = modal.contentEl.querySelectorAll('.dsh-pm-backup-row')
    expect(rows.length).toBe(2)
    for (const row of rows) {
      const btns = [...row.querySelectorAll('button')]
      expect(btns.map((b) => b.textContent)).toEqual(['恢复', '永久删除'])
    }
    const clearAll = modal.contentEl.querySelector('.dsh-deleted-head .dsh-btn-danger') as HTMLButtonElement
    expect(clearAll).toBeTruthy()
    expect(clearAll.textContent).toBe('清空全部')
    expect(modal.contentEl.querySelector('.dsh-deleted-hint')?.textContent).toContain('永久删除')
  })

  it('空列表时只显示空态，无清空按钮', async () => {
    const modal = makeModal([])
    await (modal as unknown as { render(): Promise<void> }).render()
    expect(modal.contentEl.querySelector('.dsh-modal-empty')).toBeTruthy()
    expect(modal.contentEl.querySelector('.dsh-deleted-head')).toBeFalsy()
  })
})

describe('插件详情弹窗：块语言名分区与改名', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    polyfillObsidianDom()
    setLanguage('zh')
  })

  function makeDetailModal(opts: {
    blocks: Array<{ pluginId: string; type: string; lang: string; status: string }>
    rename?: (pluginId: string, type: string, alias: string) => boolean
  }) {
    const notices: string[] = []
    const ctx = {
      pluginRuntime: {
        get: () => ({
          id: 'demo',
          status: 'running',
          manifest: { id: 'demo', version: '0.1.0' },
          capabilities: ['block'],
        }),
        inspect: () => ({ id: 'demo', status: 'stopped' }),
      },
      blocks: { list: vi.fn(() => opts.blocks), rename: opts.rename ?? (() => true) },
      notice: { notice: (m: string) => notices.push(m) },
      pluginBackups: { list: async () => [] },
    }
    return { modal: new PluginDetailModal({} as never, ctx as never, 'demo'), notices }
  }

  it('渲染块行（类型/语言串/冲突徽章），输入框预填当前语言串', async () => {
    const { modal } = makeDetailModal({
      blocks: [
        { pluginId: 'demo', type: 'chart', lang: 'hl:demo:chart', status: 'active' },
        { pluginId: 'demo', type: 'table', lang: 'hl:x', status: 'conflict' },
      ],
    })
    await (modal as unknown as { render(): Promise<void> }).render()
    expect(modal.contentEl.querySelector('h4.dsh-pm-section')?.textContent).toBeTruthy()
    const rows = modal.contentEl.querySelectorAll('.dsh-block-row')
    expect(rows.length).toBe(2)
    expect(rows[0]!.querySelector('.dsh-pm-backup-sub')?.textContent).toBe('```hl:demo:chart')
    expect((rows[1]!.querySelector('input') as HTMLInputElement).value).toBe('hl:x')
    expect(rows[1]!.textContent).toContain('冲突')
    // 无块注册的其他插件不渲染该分区——由 filter 保证，此处验证空列表情形
    const { modal: empty } = makeDetailModal({ blocks: [] })
    await (empty as unknown as { render(): Promise<void> }).render()
    expect(empty.contentEl.querySelectorAll('.dsh-block-row').length).toBe(0)
  })

  it('保存非法值提示且不调用 rename；合法值调用 rename 并刷新', async () => {
    const rename = vi.fn(() => true)
    const { modal, notices } = makeDetailModal({
      blocks: [{ pluginId: 'demo', type: 'chart', lang: 'hl:demo:chart', status: 'active' }],
      rename,
    })
    await (modal as unknown as { render(): Promise<void> }).render()
    const row = modal.contentEl.querySelector('.dsh-block-row')!
    const input = row.querySelector('input') as HTMLInputElement
    const save = [...row.querySelectorAll('button')].find((b) => b.textContent === '保存') as HTMLButtonElement

    input.value = 'no-prefix'
    save.click()
    expect(rename).not.toHaveBeenCalled()
    expect(notices.some((n) => n.includes('非法'))).toBe(true)

    input.value = 'HL:NC'
    save.click()
    expect(rename).toHaveBeenCalledWith('demo', 'chart', 'HL:NC')
    expect(notices.some((n) => n.includes('hl:nc'))).toBe(true)
  })
})

describe('插件管理器：打开面板按钮', () => {
  const findOpenPanelBtn = (view: PluginManagerView): HTMLButtonElement | null =>
    ([...view.contentEl.querySelectorAll('.dsh-pm-action-open')] as HTMLButtonElement[]).find(
      (b) => b.textContent === '▤',
    ) ?? null

  it('运行中且有 viewType 时显示按钮，点击打开对应面板', async () => {
    const opened: string[] = []
    const view = makeView({
      id: 'demo-plugin',
      manifest: { version: '1.0.0' },
      status: 'running',
      capabilities: ['panel'],
      viewType: 'demo-view',
      error: null,
    })
    ;(view as unknown as { ctx: { views: { open(t: string): void } } }).ctx.views.open = (t) => opened.push(t)
    await view.onOpen()
    const btn = findOpenPanelBtn(view)
    expect(btn).toBeTruthy()
    btn!.click()
    expect(opened).toEqual(['demo-view'])
  })

  it('无 viewType 或未运行时不显示打开面板按钮（命令菜单按钮不受影响）', async () => {
    const view = makeView([
      {
        id: 'a-no-viewtype',
        status: 'running',
        manifest: null,
        capabilities: ['commands'],
        viewType: null,
        error: null,
      },
      { id: 'b-not-running', status: 'stopped', manifest: null, capabilities: ['panel'], viewType: 'x-view', error: null },
    ])
    await view.onOpen()
    expect(findOpenPanelBtn(view)).toBeFalsy()
  })
})
