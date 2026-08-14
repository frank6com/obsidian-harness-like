/**
 * 设置页（tabs 分类）：
 * 模型（提供方侧向列表 + 参数）｜审批｜会话｜数据｜界面｜日志｜插件授权
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import type DshObsidianPlugin from './main'
import { AgentEditModal, ConfirmModal, ModelPickModal } from './modals'
import { BUILTIN_AGENTS, type AgentMode, type AgentPreset } from './settings'

export type TabId = 'model' | 'agent' | 'approval' | 'session' | 'data' | 'ui' | 'log' | 'grants'

export class DshSettingsTab extends PluginSettingTab {
  private activeTab: TabId = 'model'
  private activeProviderId = ''

  constructor(
    app: App,
    private plugin: DshObsidianPlugin,
    private ctx: Context,
  ) {
    super(app, plugin)
  }

  /** 打开 Obsidian 设置并定位到指定 tab */
  openTo(tabId: TabId): void {
    this.activeTab = tabId
    ;(this.app as unknown as { setting: { open(): void } }).setting.open()
    this.display()
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()

    const tabs: Array<{ id: TabId; label: string }> = [
      { id: 'model', label: '模型' },
      { id: 'agent', label: '智能体' },
      { id: 'approval', label: '审批' },
      { id: 'session', label: '会话' },
      { id: 'data', label: '数据' },
      { id: 'ui', label: '界面' },
      { id: 'log', label: '日志' },
      { id: 'grants', label: '插件授权' },
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
    const renderers: Record<TabId, (c: HTMLElement) => void> = {
      model: (c) => this.renderModelTab(c),
      agent: (c) => this.renderAgentTab(c),
      approval: (c) => this.renderApprovalTab(c),
      session: (c) => this.renderSessionTab(c),
      data: (c) => this.renderDataTab(c),
      ui: (c) => this.renderUiTab(c),
      log: (c) => this.renderLogTab(c),
      grants: (c) => this.renderGrantsTab(c),
    }
    renderers[this.activeTab](content)
  }

  // ---------- 模型（提供方侧向列表 + 参数） ----------

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
        text: p.models.length ? `${p.models.length} 个模型` : '无模型',
      })
      item.onclick = () => {
        this.activeProviderId = p.id
        this.display()
      }
    }
    const add = list.createEl('button', { cls: 'dsh-btn dsh-provider-add', text: '＋ 添加通道' })
    add.onclick = () => {
      const id = `provider-${Date.now()}`
      settings.providers.push({
        id,
        name: '新通道',
        baseURL: 'https://',
        apiKey: '',
        models: [],
        temperature: 0.7,
        maxTokens: 0,
        extraHeaders: [],
      })
      this.activeProviderId = id
      void this.plugin.saveSettings()
      this.display()
    }

    const p = settings.providers.find((x) => x.id === this.activeProviderId) ?? settings.providers[0]
    if (!p) return

    new Setting(form).setName('通道').setDesc(p.id)
    new Setting(form)
      .setName('名称')
      .addText((t) =>
        t.setValue(p.name).onChange(async (v) => {
          p.name = v.trim() || p.id
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName('Base URL')
      .setDesc('OpenAI 兼容端点')
      .addText((t) =>
        t.setValue(p.baseURL).onChange(async (v) => {
          p.baseURL = v.trim()
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName('API Key')
      .setDesc('明文保存在本插件 data.json 中，注意保管')
      .addText((t) =>
        t.setPlaceholder('sk-...').setValue(p.apiKey).onChange(async (v) => {
          p.apiKey = v.trim()
          await this.plugin.saveSettings()
        }),
      )

    // 模型列表：从端点获取 / 手动添加 / 设为默认 / 删除
    new Setting(form)
      .setName('模型列表')
      .setDesc('从端点获取或手动添加；默认模型 = 新会话的兜底')
      .addButton((b) =>
        b
          .setButtonText('从端点获取')
          .onClick(async () => {
            try {
              const fetched = await this.fetchModels(p.baseURL, p.apiKey)
              if (!fetched.length) {
                this.ctx.notice.notice('端点未返回模型列表，请手动添加')
                return
              }
              const picked = await new ModelPickModal(this.app, fetched, new Set()).ask()
              if ('cancel' in picked || !picked.models.length) {
                this.ctx.notice.notice('未选择模型')
                return
              }
              p.models = [...new Set([...p.models, ...picked.models])]
              await this.plugin.saveSettings()
              this.display()
              this.ctx.notice.notice(`已添加 ${picked.models.length} 个模型`)
            } catch (err) {
              this.ctx.notice.notice(`获取模型失败: ${err instanceof Error ? err.message : String(err)}`)
            }
          }),
      )
    const modelsBox = form.createDiv({ cls: 'dsh-model-list' })
    for (const m of p.models) {
      const row = modelsBox.createDiv({ cls: 'dsh-model-item' })
      const isDefault = settings.defaultModelId === `${p.id}/${m}`
      row.createDiv({ cls: 'dsh-model-name', text: m })
      if (isDefault) {
        row.createEl('span', { cls: 'dsh-model-default', text: '✓ 默认' })
      }
      const setDefault = row.createEl('button', {
        cls: 'dsh-btn',
        text: isDefault ? '默认' : '设为默认',
      })
      setDefault.onclick = async () => {
        settings.defaultModelId = `${p.id}/${m}`
        await this.plugin.saveSettings()
        this.display()
      }
      const del = row.createEl('button', { cls: 'dsh-btn', text: '✕', attr: { title: '移除模型' } })
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
    const addInput = addRow.createEl('input', { cls: 'dsh-model-input', attr: { placeholder: '手动输入模型名' } })
    const addBtn = addRow.createEl('button', { cls: 'dsh-btn', text: '添加' })
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
      .setName('Temperature')
      .setDesc('采样温度：越低越保守，越高越发散（0 = 端点默认）')
      .addSlider((s) =>
        s
          .setLimits(0, 2, 0.1)
          .setValue(p.temperature)
          .setDynamicTooltip()
          .onChange(async (v) => {
            p.temperature = v
            await this.plugin.saveSettings()
          }),
      )
    new Setting(form)
      .setName('最大输出 token 数')
      .setDesc('0 = 不限制')
      .addText((t) =>
        t.setValue(String(p.maxTokens)).onChange(async (v) => {
          p.maxTokens = Math.max(0, Math.floor(Number(v) || 0))
          t.setValue(String(p.maxTokens))
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName('自定义请求头')
      .setDesc('每行 "Header: value"（如网关鉴权）')
      .addTextArea((t) =>
        t.setValue(p.extraHeaders.join('\n')).onChange(async (v) => {
          p.extraHeaders = v.split('\n').map((s) => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
        }),
      )
    if (settings.providers.length > 1) {
      new Setting(form).addButton((b) =>
        b.setButtonText('删除此通道').setWarning().onClick(async () => {
          const ok = await new ConfirmModal(this.app, `删除通道 ${p.name}？`, '删除').ask()
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

  /** 从 OpenAI 兼容端点获取模型列表 */
  private async fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
    const url = baseURL.replace(/\/+$/, '') + '/models'
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    return (data.data ?? []).map((m) => m.id ?? '').filter(Boolean)
  }

  // ---------- 智能体 ----------

  private renderAgentTab(c: HTMLElement): void {
    const { settings } = this.plugin
    const activeId = settings.activeAgentId
    const allTools = this.ctx.toolsCompat.list().map((t) => t.name)

    c.createEl('h4', { text: '内置智能体' })
    c.createEl('p', {
      cls: 'setting-item-description',
      text: '启用开关控制该模式是否出现在对话面板的智能体选择中',
    })
    for (const a of BUILTIN_AGENTS) {
      new Setting(c)
        .setName(a.name)
        .setDesc(`${a.description ?? ''}${a.id === activeId ? ' · ✓ 当前' : ''}`)
        .addToggle((t) =>
          t.setValue(a.enabled !== false).onChange(async (v) => {
            a.enabled = v
            if (!v && settings.activeAgentId === a.id) settings.activeAgentId = 'edit'
            await this.plugin.saveSettings()
            this.display()
          }),
        )
        .addButton((b) =>
          b
            .setButtonText(a.id === activeId ? '✓ 当前' : '激活')
            .setCta()
            .onClick(async () => {
              settings.activeAgentId = a.id
              a.enabled = true
              await this.plugin.saveSettings()
              this.display()
            }),
        )
    }

    c.createEl('h4', { text: '自定义智能体' })
    const customs = settings.agents.filter((a) => !BUILTIN_AGENTS.some((b) => b.id === a.id))
    if (!customs.length) {
      c.createEl('p', { cls: 'setting-item-description', text: '暂无自定义智能体。点下方按钮添加，可在弹窗中勾选可调用的能力。' })
    }
    for (const a of customs) {
      const row = new Setting(c)
        .setName(a.name)
        .setDesc(
          `${a.description ?? ''} · ${a.capabilities?.length ? `${a.capabilities.length} 项能力` : '按模式默认'}${a.id === activeId ? ' · ✓ 当前' : ''}`,
        )
      row.addToggle((t) =>
        t.setValue(a.enabled !== false).onChange(async (v) => {
          a.enabled = v
          if (!v && settings.activeAgentId === a.id) settings.activeAgentId = 'edit'
          await this.plugin.saveSettings()
        }),
      )
      row.addButton((b) =>
        b.setButtonText(a.id === activeId ? '✓ 当前' : '激活').setCta().onClick(async () => {
          settings.activeAgentId = a.id
          a.enabled = true
          await this.plugin.saveSettings()
          this.display()
        }),
      )
      row.addButton((b) =>
        b.setButtonText('编辑').onClick(async () => {
          await new AgentEditModal(this.app, a, allTools).ask()
          await this.plugin.saveSettings()
          this.display()
        }),
      )
      row.addButton((b) =>
        b.setButtonText('删除').setWarning().onClick(async () => {
          const ok = await new ConfirmModal(this.app, `删除智能体 ${a.name}？`, '删除').ask()
          if (!ok) return
          settings.agents = settings.agents.filter((x) => x.id !== a.id)
          if (settings.activeAgentId === a.id) settings.activeAgentId = 'edit'
          await this.plugin.saveSettings()
          this.display()
        }),
      )
    }
    new Setting(c).addButton((b) =>
      b.setButtonText('＋ 添加自定义智能体').onClick(async () => {
        const id = `agent-${Date.now()}`
        const agent: AgentPreset = { id, name: '新智能体', mode: 'edit', description: '', enabled: true }
        settings.agents.push(agent)
        await new AgentEditModal(this.app, agent, allTools).ask()
        await this.plugin.saveSettings()
        this.display()
      }),
    )
  }

  // ---------- 审批 ----------

  private renderApprovalTab(c: HTMLElement): void {
    const { settings } = this.plugin
    new Setting(c)
      .setName('写操作审批默认模式')
      .setDesc('ask = 每次询问；deny = 默认拒绝（可在 Chat 面板会话级放宽）')
      .addDropdown((d) =>
        d
          .addOption('ask', '每次询问 (ask)')
          .addOption('deny', '默认拒绝 (deny)')
          .setValue(settings.approvalDefault)
          .onChange(async (v) => {
            settings.approvalDefault = v as 'ask' | 'deny'
            await this.plugin.saveSettings()
          }),
      )
    new Setting(c)
      .setName('目录级审批白名单')
      .setDesc('每行一个 vault 相对目录（如 Inbox / Projects）。agent 写入这些目录下的笔记免审批。')
      .addTextArea((t) =>
        t.setValue(settings.writeAllowDirs.join('\n')).onChange(async (v) => {
          settings.writeAllowDirs = v.split('\n').map((s) => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
        }),
      )
    new Setting(c)
      .setName('工具级策略覆盖')
      .setDesc('每行 "工具名=ask|allow|deny"，如 write_note=deny。覆盖默认审批行为。')
      .addTextArea((t) =>
        t.setValue(settings.toolPolicy.join('\n')).onChange(async (v) => {
          settings.toolPolicy = v.split('\n').map((s) => s.trim()).filter(Boolean)
          await this.plugin.saveSettings()
        }),
      )
  }

  // ---------- 会话 ----------

  private renderSessionTab(c: HTMLElement): void {
    const { settings } = this.plugin
    new Setting(c)
      .setName('会话保留天数')
      .setDesc('启动时自动清理超过 N 天未更新的会话日志（0 = 不清理）')
      .addText((t) =>
        t.setValue(String(settings.sessionRetentionDays)).onChange(async (v) => {
          settings.sessionRetentionDays = Math.max(0, Math.floor(Number(v) || 0))
          t.setValue(String(settings.sessionRetentionDays))
          await this.plugin.saveSettings()
        }),
      )
  }

  // ---------- 数据 ----------

  private renderDataTab(c: HTMLElement): void {
    c.createEl('p', {
      cls: 'setting-item-description',
      text: ['会话日志: .obsidian/dsh/sessions/*.jsonl', '用户插件: .obsidian/dsh-plugins/<id>/'].join(
        '\n',
      ),
    })
    new Setting(c).addButton((b) =>
      b.setButtonText('清空全部会话').setWarning().onClick(async () => {
        const ok = await new ConfirmModal(this.app, '删除全部会话日志？此操作不可恢复。', '清空').ask()
        if (!ok) return
        const list = await this.ctx.sessionLog.list()
        for (const s of list) await this.ctx.sessionLog.remove(s.id)
        this.ctx.notice.notice(`已清空 ${list.length} 个会话`)
      }),
    )
  }

  // ---------- 界面 ----------

  private renderUiTab(c: HTMLElement): void {
    const { settings } = this.plugin
    new Setting(c)
      .setName('流式输出')
      .setDesc('关闭后等完整消息再显示（省流量/减少闪烁）')
      .addToggle((t) =>
        t.setValue(settings.streamingEnabled).onChange(async (v) => {
          settings.streamingEnabled = v
          await this.plugin.saveSettings()
        }),
      )
    new Setting(c)
      .setName('Markdown 渲染')
      .setDesc('关闭后消息以纯文本显示')
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
      .setName('日志级别')
      .setDesc('控制 [dsh] 前缀的 console 输出（llm/stream 耗时等）')
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

  private renderGrantsTab(c: HTMLElement): void {
    const grants = this.ctx.approval.listGrants()
    if (!grants.length) {
      c.createEl('p', {
        cls: 'setting-item-description',
        text: '暂无授权。在插件管理器中"授权并加载"后，这里可查看与撤销。',
      })
    }
    for (const { pluginId, grant } of grants) {
      new Setting(c)
        .setName(pluginId)
        .setDesc(
          `${grant.mode === 'all' ? '信任所有版本（双勾）' : '仅信任当前版本（单勾）'} · v${grant.version} · ${new Date(grant.grantedAt).toLocaleString()}`,
        )
        .addButton((b) =>
          b.setButtonText('撤销').setWarning().onClick(() => {
            this.ctx.approval.revoke(pluginId)
            this.display()
          }),
        )
    }
  }
}
