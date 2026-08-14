/**
 * 设置页（tabs 分类）：
 * 模型（提供方侧向列表 + 参数）｜审批｜会话｜数据｜界面｜日志｜插件授权
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import type DshObsidianPlugin from './main'
import { ConfirmModal } from './modals'

type TabId = 'model' | 'approval' | 'session' | 'data' | 'ui' | 'log' | 'grants'

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

  override display(): void {
    const { containerEl } = this
    containerEl.empty()

    const tabs: Array<{ id: TabId; label: string }> = [
      { id: 'model', label: '模型' },
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
        text: p.id === settings.defaultProviderId ? '✓ 默认' : (p.models?.length ? p.models.join(', ') : p.model),
      })
      item.onclick = () => {
        this.activeProviderId = p.id
        this.display()
      }
    }
    const add = list.createEl('button', { cls: 'dsh-btn dsh-provider-add', text: '＋ 添加提供方' })
    add.onclick = () => {
      const id = `provider-${Date.now()}`
      settings.providers.push({
        id,
        name: '新提供方',
        baseURL: 'https://',
        apiKey: '',
        model: '',
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
    const isDefault = settings.defaultProviderId === p.id

    new Setting(form).setName('提供方').setDesc(p.id).addButton((b) =>
      b
        .setButtonText(isDefault ? '✓ 默认模型' : '设为默认模型')
        .setCta()
        .onClick(() => {
          settings.defaultProviderId = p.id
          void this.plugin.saveSettings()
          this.display()
        }),
    )
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
    new Setting(form)
      .setName('默认模型')
      .addText((t) =>
        t.setValue(p.model).onChange(async (v) => {
          p.model = v.trim()
          await this.plugin.saveSettings()
        }),
      )
    new Setting(form)
      .setName('模型列表')
      .setDesc('逗号分隔（对话面板选择器用）；留空则仅默认模型')
      .addText((t) =>
        t
          .setValue((p.models ?? []).join(', '))
          .onChange(async (v) => {
            p.models = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
            await this.plugin.saveSettings()
          }),
      )
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
    if (settings.providers.length > 1 && !isDefault) {
      new Setting(form).addButton((b) =>
        b.setButtonText('删除此提供方').setWarning().onClick(async () => {
          const ok = await new ConfirmModal(this.app, `删除提供方 ${p.name}？`, '删除').ask()
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
