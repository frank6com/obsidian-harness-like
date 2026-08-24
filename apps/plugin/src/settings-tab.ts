/**
 * 设置页（tabs 分类）：
 * 模型（提供方侧向列表 + 参数）｜审批｜会话｜数据｜界面｜日志｜插件授权
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import type HarnessLikePlugin from './main'
import { AgentEditModal, ConfirmModal, ModelPickModal } from './modals'
import { buildFilesOverlay } from './plugin-files'
import { BUILTIN_AGENTS, type AgentPreset } from './settings'
import { forkAgentDraft } from './agents'
import { agentDisplayDesc, agentDisplayName, resolveLanguage, setLanguage, t, type LanguagePreference } from './i18n'

export type TabId = 'model' | 'agent' | 'approval' | 'session' | 'data' | 'ui' | 'log' | 'grants'

export class HarnessLikeSettingsTab extends PluginSettingTab {
  private activeTab: TabId = 'model'
  private activeProviderId = ''
  /** 插件文件自愈状态条监听只绑一次 */
  private filesListenerBound = false

  constructor(
    app: App,
    private plugin: HarnessLikePlugin,
    private ctx: Context,
  ) {
    super(app, plugin)
  }

  /** 打开 Obsidian 设置并定位到本插件指定 tab */
  openTo(tabId: TabId): void {
    this.activeTab = tabId
    // app.setting 在 1.13 类型面外，运行时存在。Obsidian 的 openTabById 只负责
    // 切换 tab、不打开弹窗（插件 tab id = 插件 manifest id），必须先 open()。
    // 对齐 Obsidian 内部用法：setting.open() → setting.openTabById(id)。
    const setting = (this.app as unknown as {
      setting?: { open?(): void; openTabById?(id: string): unknown }
    }).setting
    if (!setting) return
    setting.open?.()
    if (setting.openTabById) {
      setting.openTabById(this.plugin.manifest.id)
    }
    this.display()
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()

    // 插件文件自愈状态条（styles.css 缺失/恢复中/失败）
    this.renderFilesBanner(containerEl)
    // 下载进度实时刷新设置页（只绑定一次，避免 display 重复叠加监听）
    if (!this.filesListenerBound) {
      this.filesListenerBound = true
      this.ctx.on('dsh/plugin-files', () => this.display())
    }

    const tabs: Array<{ id: TabId; label: string }> = [
      { id: 'model', label: t('settings.tab.model') },
      { id: 'agent', label: t('settings.tab.agent') },
      { id: 'approval', label: t('settings.tab.approval') },
      { id: 'session', label: t('settings.tab.session') },
      { id: 'data', label: t('settings.tab.data') },
      { id: 'ui', label: t('settings.tab.ui') },
      { id: 'log', label: t('settings.tab.log') },
      { id: 'grants', label: t('settings.tab.grants') },
    ]

    const nav = containerEl.createDiv({ cls: 'dsh-settings-nav' })
    for (const t of tabs) {
      const btn = nav.createEl('button', {
        cls: 'dsh-settings-tab' + (t.id === this.activeTab ? ' is-active' : ''),
        text: t.label,
      })
      btn.onclick = () => {
        this.activeTab = t.id
        this.display()
      }
    }

    const content = containerEl.createDiv({ cls: 'dsh-settings-content' })
    const renderers: Record<TabId, (c: HTMLElement) => void | Promise<void>> = {
      model: (c) => this.renderModelTab(c),
      agent: (c) => this.renderAgentTab(c),
      approval: (c) => this.renderApprovalTab(c),
      session: (c) => this.renderSessionTab(c),
      data: (c) => this.renderDataTab(c),
      ui: (c) => this.renderUiTab(c),
      log: (c) => this.renderLogTab(c),
      grants: (c) => this.renderGrantsTab(c),
    }
    void renderers[this.activeTab](content)
  }

  // ---------- 模型（提供方侧向列表 + 参数） ----------

  /** 插件文件自愈状态条：styles.css 缺失时置顶提示（下载中/已恢复/失败） */
  private renderFilesBanner(c: HTMLElement): void {
    const files = this.ctx.get('pluginFiles') as
      | {
          statusOf(): { stylesMissing: boolean; phase: string }
          ensure(): Promise<void>
          releaseUrl: string
          pluginDir: string
        }
      | undefined
    const status = files?.statusOf()
    if (!files || !status || status.phase === 'ok') return
    c.setCssStyles({ position: 'relative' })
    buildFilesOverlay(
      c,
      { phase: status.phase, pluginDir: files.pluginDir, releaseUrl: files.releaseUrl },
      {
        reload: () => {
          try {
            const plugins = (this.app as unknown as { plugins?: { disablePlugin(id: string): void; enablePlugin(id: string): void } }).plugins
            plugins?.disablePlugin('harness-like')
            plugins?.enablePlugin('harness-like')
          } catch (err) {
            this.ctx.notice.notice(String(err))
          }
        },
        openExternal: (target) => {
          const resolved =
            target === files.pluginDir
              ? `${(this.ctx.sandbox.scope as { vaultRoot?: string }).vaultRoot ?? ''}/${target}`
              : target
          this.ctx.openExternal(resolved)
        },
        retry: () => void files.ensure(),
      },
    )
  }

  private renderModelTab(c: HTMLElement): void {
    const { settings } = this.plugin
    if (!this.activeProviderId || !settings.providers.some((p) => p.id === this.activeProviderId)) {
      this.activeProviderId = settings.providers[0]?.id ?? ''
    }
    const wrap = c.createDiv({ cls: 'dsh-provider-layout' })
    const list = wrap.createDiv({ cls: 'dsh-provider-list' })
    const form = wrap.createDiv({ cls: 'dsh-provider-form' })

    for (const p of settings.providers) {
      const item = list.createEl('button', {
        cls: 'dsh-provider-item' + (p.id === this.activeProviderId ? ' is-active' : ''),
      })
      item.createDiv({ text: p.name || p.id })
      item.createDiv({
        cls: 'dsh-provider-sub',
        text: p.models.length ? t('settings.model.modelsCount', { count: p.models.length }) : t('settings.model.noModels'),
      })
      item.onclick = () => {
        this.activeProviderId = p.id
        this.display()
      }
    }
    const add = list.createEl('button', { cls: 'dsh-btn dsh-provider-add', text: t('settings.model.addChannel') })
    add.onclick = () => {
      const id = `provider-${Date.now()}`
      settings.providers.push({
        id,
        name: t('settings.model.newChannel'),
        baseURL: 'https://',
        apiKey: '',
        models: [],
        temperature: 0.7,
        maxTokens: 0,
        contextTokens: 0,
        extraHeaders: [],
      })
      this.activeProviderId = id
      void this.plugin.saveSettings()
      this.display()
    }

    const p = settings.providers.find((x) => x.id === this.activeProviderId) ?? settings.providers[0]
    if (!p) return

    new Setting(form).setName(t('settings.model.channel')).setDesc(p.id)
    new Setting(form)
      .setName(t('settings.model.name'))
      .addText((t) =>
        t.setValue(p.name).onChange(async (v) => {
          p.name = v.trim() || p.id
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName(t('settings.model.baseUrl'))
      .setDesc(t('settings.model.baseUrlDesc'))
      .addText((t) =>
        t.setValue(p.baseURL).onChange(async (v) => {
          p.baseURL = v.trim()
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName(t('settings.model.apiKey'))
      .setDesc(t('settings.model.apiKeyDesc'))
      .addText((t) =>
        t.setPlaceholder('sk-...').setValue(p.apiKey).onChange(async (v) => {
          p.apiKey = v.trim()
          await this.plugin.saveSettings()
        }),
      )

    // 模型列表：从端点获取 / 手动添加 / 设为默认 / 删除
    new Setting(form)
      .setName(t('settings.model.list'))
      .setDesc(t('settings.model.listDesc'))
      .addButton((b) =>
        b
          .setButtonText(t('settings.model.fetch'))
          .onClick(async () => {
            try {
              const fetched = await this.fetchModels(p.baseURL, p.apiKey)
              if (!fetched.models.length) {
                this.ctx.notice.notice(t('settings.model.fetchEmpty'))
                return
              }
              const picked = await new ModelPickModal(this.app, fetched.models, p.models).ask()
              if ('cancel' in picked || !picked.models.length) {
                this.ctx.notice.notice(t('settings.model.nonePicked'))
                return
              }
              p.models = [...new Set([...p.models, ...picked.models])]
              // 元数据预填：端点提供了上下文长度且当前未设置时自动填入
              let metaHint = ''
              if (fetched.contextTokens && !p.contextTokens) {
                p.contextTokens = fetched.contextTokens
                metaHint = ' ' + t('settings.model.contextDetected', { n: fetched.contextTokens })
              }
              await this.plugin.saveSettings()
              this.display()
              this.ctx.notice.notice(t('settings.model.added', { count: picked.models.length }) + metaHint)
            } catch (err) {
              this.ctx.notice.notice(
                t('settings.model.fetchFailed', { msg: err instanceof Error ? err.message : String(err) }),
              )
            }
          }),
      )
    const modelsBox = form.createDiv({ cls: 'dsh-model-list' })
    for (const m of p.models) {
      const row = modelsBox.createDiv({ cls: 'dsh-model-item' })
      const isDefault = settings.defaultModelId === `${p.id}/${m}`
      row.createDiv({ cls: 'dsh-model-name', text: m })
      if (isDefault) {
        row.createSpan({ cls: 'dsh-model-default', text: t('settings.model.defaultMark') })
      }
      const setDefault = row.createEl('button', {
        cls: 'dsh-btn',
        text: isDefault ? t('settings.model.default') : t('settings.model.setDefault'),
      })
      setDefault.onclick = async () => {
        settings.defaultModelId = `${p.id}/${m}`
        await this.plugin.saveSettings()
        this.display()
      }
      const del = row.createEl('button', { cls: 'dsh-btn', text: '✕', attr: { title: t('settings.model.removeTitle') } })
      del.onclick = async () => {
        p.models = p.models.filter((x) => x !== m)
        if (settings.defaultModelId === `${p.id}/${m}`) {
          settings.defaultModelId = `${p.id}/${p.models[0] ?? ''}`
        }
        await this.plugin.saveSettings()
        this.display()
      }
    }
    const addRow = form.createDiv({ cls: 'dsh-model-add' })
    const addInput = addRow.createEl('input', { cls: 'dsh-model-input', attr: { placeholder: t('settings.model.inputPlaceholder') } })
    const addBtn = addRow.createEl('button', { cls: 'dsh-btn', text: t('settings.model.add') })
    const commit = async () => {
      const name = addInput.value.trim()
      if (!name) return
      if (!p.models.includes(name)) p.models.push(name)
      addInput.value = ''
      await this.plugin.saveSettings()
      this.display()
    }
    addBtn.onclick = commit
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void commit()
    })

    new Setting(form)
      .setName(t('settings.model.temperature'))
      .setDesc(t('settings.model.temperatureDesc'))
      .addSlider((s) =>
        s
          .setLimits(0, 2, 0.1)
          .setValue(p.temperature)
          .onChange(async (v) => {
            p.temperature = v
            await this.plugin.saveSettings()
          }),
      )
    new Setting(form)
      .setName(t('settings.model.maxTokens'))
      .setDesc(t('settings.model.maxTokensDesc'))
      .addText((t) =>
        t.setValue(String(p.maxTokens)).onChange(async (v) => {
          p.maxTokens = Math.max(0, Math.floor(Number(v) || 0))
          t.setValue(String(p.maxTokens))
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName(t('settings.model.contextTokens'))
      .setDesc(t('settings.model.contextTokensDesc'))
      .addText((t) =>
        t.setValue(String(p.contextTokens ?? 0)).onChange(async (v) => {
          p.contextTokens = Math.max(0, Math.floor(Number(v) || 0))
          t.setValue(String(p.contextTokens))
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName(t('settings.model.headers'))
      .setDesc(t('settings.model.headersDesc'))
      .addTextArea((t) =>
        t.setValue(p.extraHeaders.join('\n')).onChange(async (v) => {
          p.extraHeaders = v.split('\n').map((s) => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
        }),
      )
    if (settings.providers.length > 1) {
      new Setting(form).addButton((b) =>
        b.setButtonText(t('settings.model.deleteChannel')).setWarning().onClick(async () => {
          const ok = await new ConfirmModal(
            this.app,
            t('settings.model.deleteChannelConfirm', { name: p.name }),
            t('common.delete'),
          ).ask()
          if (!ok) return
          settings.providers = settings.providers.filter((x) => x.id !== p.id)
          if (this.activeProviderId === p.id) {
            this.activeProviderId = settings.providers[0]?.id ?? ''
          }
          await this.plugin.saveSettings()
          this.display()
        }),
      )
    }
  }

  /** 从 OpenAI 兼容端点获取模型列表；尽力解析上下文长度元数据（非标准扩展字段，读不到为 undefined） */
  private async fetchModels(baseURL: string, apiKey: string): Promise<{ models: string[]; contextTokens?: number }> {
    const url = baseURL.replace(/\/+$/, '') + '/models'
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as {
      data?: Array<{
        id?: string
        context_length?: number
        max_model_len?: number
        max_context_length?: number
      }>
    }
    const arr = data.data ?? []
    const models = arr.map((m) => m.id ?? '').filter(Boolean)
    // 上下文元数据：OpenRouter(context_length) / vLLM(max_model_len) 等扩展字段，通道内取最大值
    const candidates = arr
      .map((m) => m.context_length ?? m.max_model_len ?? m.max_context_length)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    return { models, contextTokens: candidates.length ? Math.max(...candidates) : undefined }
  }

  // ---------- 智能体 ----------

  private renderAgentTab(c: HTMLElement): void {
    const { settings } = this.plugin
    const allTools = this.ctx.toolsCompat.list().map((t) => t.name)
    const visible = settings.agents.filter((a) => a.enabled !== false)

    // 默认智能体：独立设置项（下拉选择，只能选启用的）
    new Setting(c)
      .setName(t('settings.agent.defaultAgent'))
      .setDesc(t('settings.agent.defaultAgentDesc'))
      .addDropdown((d) => {
        for (const a of settings.agents) {
          if (a.enabled === false) continue
          d.addOption(a.id, agentDisplayName(a))
        }
        d.setValue(settings.activeAgentId)
        d.onChange(async (v) => {
          settings.activeAgentId = v
          await this.plugin.saveSettings()
          this.display()
        })
        return d
      })

    new Setting(c).setName(t('settings.agent.builtin')).setHeading()
    c.createEl('p', {
      cls: 'setting-item-description',
      text: t('settings.agent.builtinDesc'),
    })
    for (const a of BUILTIN_AGENTS) {
      const s = new Setting(c)
        .setName(agentDisplayName(a))
        .setDesc(
          `${agentDisplayDesc(a) ?? ''}${a.id === settings.activeAgentId ? t('settings.agent.currentMark') : ''}`,
        )
      // fork-on-edit：内置不可变——以模板复制出可编辑自定义副本（含当前生效 persona 文本起步）
      s.addButton((b) =>
        b.setButtonText(t('settings.agent.fork')).onClick(async () => {
          const draft = forkAgentDraft(a)
          await new AgentEditModal(this.app, draft, allTools, (saved) => {
            settings.agents.push(saved)
          }).ask()
          await this.plugin.saveSettings()
          this.display()
        }),
      )
      s.addToggle((t) =>
        t.setValue(a.enabled !== false).onChange(async (v) => {
          a.enabled = v
          if (!v && settings.activeAgentId === a.id) settings.activeAgentId = 'edit'
          await this.plugin.saveSettings()
          this.display()
        }),
      )
      if (visible.length === 1 && a.enabled !== false) {
        // 唯一启用的智能体不可禁用（保证默认智能体始终存在）
        s.settingEl.querySelector('input')?.setAttribute('disabled', 'disabled')
      }
    }

    new Setting(c).setName(t('settings.agent.custom')).setHeading()
    const customs = settings.agents.filter((a) => !BUILTIN_AGENTS.some((b) => b.id === a.id))
    if (!customs.length) {
      c.createEl('p', { cls: 'setting-item-description', text: t('settings.agent.customEmpty') })
    }
    for (const a of customs) {
      const row = new Setting(c)
        .setName(a.name)
        .setDesc(
          `${a.description ?? ''} · ${a.capabilities?.length ? t('settings.agent.capsCount', { count: a.capabilities.length }) : t('settings.agent.byMode')}${a.id === settings.activeAgentId ? t('settings.agent.currentMark') : ''}`,
        )
      row.addToggle((t) =>
        t.setValue(a.enabled !== false).onChange(async (v) => {
          a.enabled = v
          if (!v && settings.activeAgentId === a.id) settings.activeAgentId = 'edit'
          await this.plugin.saveSettings()
        }),
      )
      row.addButton((b) =>
        b.setButtonText(t('settings.agent.edit')).onClick(async () => {
          await new AgentEditModal(this.app, a, allTools, (draft) => {
            Object.assign(a, draft)
          }).ask()
          await this.plugin.saveSettings()
          this.display()
        }),
      )
      row.addButton((b) =>
        b.setButtonText(t('common.delete')).setWarning().onClick(async () => {
          const ok = await new ConfirmModal(
            this.app,
            t('settings.agent.deleteConfirm', { name: a.name }),
            t('common.delete'),
          ).ask()
          if (!ok) return
          settings.agents = settings.agents.filter((x) => x.id !== a.id)
          if (settings.activeAgentId === a.id) settings.activeAgentId = 'edit'
          await this.plugin.saveSettings()
          this.display()
        }),
      )
    }
    new Setting(c).addButton((b) =>
      b.setButtonText(t('settings.agent.addCustom')).onClick(async () => {
        const id = `agent-${Date.now()}`
        const draft: AgentPreset = { id, name: t('agent.new'), mode: 'edit', enabled: true }
        await new AgentEditModal(this.app, draft, allTools, (saved) => {
          settings.agents.push(saved)
        }).ask()
        await this.plugin.saveSettings()
        this.display()
      }),
    )
  }

  // ---------- 审批 ----------

  private renderApprovalTab(c: HTMLElement): void {
    const { settings } = this.plugin
    new Setting(c)
      .setName(t('settings.approval.mode'))
      .setDesc(t('settings.approval.modeDesc'))
      .addDropdown((d) =>
        d
          .addOption('ask', t('settings.approval.ask'))
          .addOption('deny', t('settings.approval.deny'))
          .setValue(settings.approvalDefault)
          .onChange(async (v) => {
            settings.approvalDefault = v as 'ask' | 'deny'
            await this.plugin.saveSettings()
          }),
      )
    new Setting(c)
      .setName(t('settings.approval.allowDirs'))
      .setDesc(t('settings.approval.allowDirsDesc'))
      .addTextArea((t) =>
        t.setValue(settings.writeAllowDirs.join('\n')).onChange(async (v) => {
          settings.writeAllowDirs = v.split('\n').map((s) => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
        }),
      )
    new Setting(c)
      .setName(t('settings.approval.toolPolicy'))
      .setDesc(t('settings.approval.toolPolicyDesc'))
      .addTextArea((t) =>
        t.setValue(settings.toolPolicy.join('\n')).onChange(async (v) => {
          settings.toolPolicy = v.split('\n').map((s) => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
        }),
      )
    // 命令行工具（默认关闭；开启后每次调用仍需审批）
    new Setting(c)
      .setName(t('settings.command.enable'))
      .setDesc(t('settings.command.enableDesc'))
      .addToggle((t) =>
        t.setValue(settings.enableCommandTool).onChange(async (v) => {
          settings.enableCommandTool = v
          await this.plugin.saveSettings()
        }),
      )
    new Setting(c)
      .setName(t('settings.command.fullAccess'))
      .setDesc(t('settings.command.fullAccessDesc'))
      .addToggle((t) =>
        t
          .setValue(settings.commandFullAccess)
          .setDisabled(!settings.enableCommandTool)
          .onChange(async (v) => {
            settings.commandFullAccess = v
            await this.plugin.saveSettings()
          }),
      )
  }

  // ---------- 会话 ----------

  private renderSessionTab(c: HTMLElement): void {
    const { settings } = this.plugin
    new Setting(c)
      .setName(t('settings.session.retention'))
      .setDesc(t('settings.session.retentionDesc'))
      .addText((t) =>
        t.setValue(String(settings.sessionRetentionDays)).onChange(async (v) => {
          settings.sessionRetentionDays = Math.max(0, Math.floor(Number(v) || 0))
          t.setValue(String(settings.sessionRetentionDays))
          await this.plugin.saveSettings()
        }),
      )
    new Setting(c)
      .setName(t('settings.session.exportDir'))
      .setDesc(t('settings.session.exportDirDesc'))
      .addText((t) =>
        t.setValue(settings.exportDir).onChange(async (v) => {
          settings.exportDir = v.trim().replace(/^\/+|\/+$/g, '')
          t.setValue(settings.exportDir)
          await this.plugin.saveSettings()
        }),
      )
  }

  // ---------- 数据 ----------

  private renderDataTab(c: HTMLElement): void {
    c.createEl('p', {
      cls: 'setting-item-description',
      text: [t('settings.data.paths.sessionLog'), t('settings.data.paths.plugins')].join('\n'),
    })
    new Setting(c).addButton((b) =>
      b.setButtonText(t('settings.data.clearAll')).setWarning().onClick(async () => {
        const ok = await new ConfirmModal(
          this.app,
          t('settings.data.clearAllConfirm'),
          t('settings.data.clear'),
        ).ask()
        if (!ok) return
        const list = await this.ctx.sessionLog.list()
        for (const s of list) await this.ctx.sessionLog.remove(s.id)
        this.ctx.notice.notice(t('settings.data.cleared', { count: list.length }))
      }),
    )
  }

  // ---------- 界面 ----------

  private renderUiTab(c: HTMLElement): void {
    const { settings } = this.plugin
    new Setting(c)
      .setName(t('settings.ui.language'))
      .setDesc(t('settings.ui.languageDesc'))
      .addDropdown((d) => {
        d.addOption('auto', t('settings.ui.lang.auto'))
        d.addOption('zh', t('settings.ui.lang.zh'))
        d.addOption('en', t('settings.ui.lang.en'))
        d.setValue(settings.uiLanguage)
        d.onChange(async (v) => {
          settings.uiLanguage = v as LanguagePreference
          setLanguage(resolveLanguage(settings.uiLanguage))
          await this.plugin.saveSettings()
          this.display()
        })
        return d
      })
    new Setting(c)
      .setName(t('settings.ui.streaming'))
      .setDesc(t('settings.ui.streamingDesc'))
      .addToggle((t) =>
        t.setValue(settings.streamingEnabled).onChange(async (v) => {
          settings.streamingEnabled = v
          await this.plugin.saveSettings()
        }),
      )
    new Setting(c)
      .setName(t('settings.ui.markdown'))
      .setDesc(t('settings.ui.markdownDesc'))
      .addToggle((t) =>
        t.setValue(settings.renderMarkdown).onChange(async (v) => {
          settings.renderMarkdown = v
          await this.plugin.saveSettings()
        }),
      )
  }

  // ---------- 日志 ----------

  private renderLogTab(c: HTMLElement): void {
    new Setting(c)
      .setName(t('settings.log.level'))
      .setDesc(t('settings.log.levelDesc'))
      .addDropdown((d) =>
        d
          .addOption('debug', 'debug')
          .addOption('info', 'info')
          .addOption('warn', 'warn')
          .addOption('error', 'error')
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (v) => {
            this.plugin.settings.logLevel = v as 'debug' | 'info' | 'warn' | 'error'
            await this.plugin.saveSettings()
          }),
      )
  }

  // ---------- 插件授权 ----------

  private async renderGrantsTab(c: HTMLElement): Promise<void> {
    const grants = this.ctx.approval.listGrants()
    // 与插件管理器对齐：授权记录 ≠ 磁盘现状，标注目录已不存在的残留授权
    const dirs = new Set(await this.ctx.pluginRuntime.discover())
    const stale: string[] = []
    if (!grants.length) {
      c.createEl('p', {
        cls: 'setting-item-description',
        text: t('settings.grants.empty'),
      })
    }
    for (const { pluginId, grant } of grants) {
      const exists = dirs.has(pluginId)
      if (!exists) stale.push(pluginId)
      new Setting(c)
        .setName(pluginId)
        .setDesc(
          [
            `${grant.mode === 'all' ? t('settings.grants.all') : t('settings.grants.version')} · v${grant.version} · ${new Date(grant.grantedAt).toLocaleString()}`,
            exists ? '' : t('settings.grants.stale'),
          ]
            .filter(Boolean)
            .join(''),
        )
        .addButton((b) =>
          b.setButtonText(t('settings.grants.revoke')).setWarning().onClick(() => {
            this.ctx.approval.revoke(pluginId)
            this.display()
          }),
        )
    }
    if (stale.length) {
      new Setting(c).addButton((b) =>
        b
          .setButtonText(t('settings.grants.cleanStale', { count: stale.length }))
          .setWarning()
          .onClick(() => {
            for (const id of stale) this.ctx.approval.revoke(id)
            this.display()
          }),
      )
    }
  }
}
