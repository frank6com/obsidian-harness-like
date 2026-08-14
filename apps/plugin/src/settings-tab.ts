/**
 * 设置页：模型端点/凭据/参数、审批默认模式、grant 管理（查看/撤销）、数据位置。
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type { Context } from '@deepseek-ai/cordis'
import type DshObsidianPlugin from './main'

export class DshSettingsTab extends PluginSettingTab {
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

    containerEl.createEl('h2', { text: 'dsh-obsidian' })
    containerEl.createEl('p', {
      text: '在 Obsidian 内运行 Cordis 插件体系与 agent。模型请求仅发往下方配置的端点。',
    })

    // ---------- 模型 ----------
    containerEl.createEl('h3', { text: '模型' })
    new Setting(containerEl)
      .setName('Base URL')
      .setDesc('OpenAI 兼容端点（默认 DeepSeek API）')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.baseURL)
          .onChange(async (v) => {
            this.plugin.settings.baseURL = v.trim() || 'https://api.deepseek.com'
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('明文保存在本插件 data.json 中（Obsidian 惯例），注意保管')
      .addText((t) =>
        t
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim()
            await this.plugin.saveSettings()
          }),
      )
      .addExtraButton((b) =>
        b.setIcon('eye').onClick(() => {
          const input = containerEl.querySelector<HTMLInputElement>('input[placeholder="sk-..."]')
          if (input) input.type = input.type === 'password' ? 'text' : 'password'
        }),
      )

    new Setting(containerEl)
      .setName('模型')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.model)
          .onChange(async (v) => {
            this.plugin.settings.model = v.trim() || 'deepseek-chat'
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('采样温度：越低越保守，越高越发散（0 = 端点默认）')
      .addSlider((s) =>
        s
          .setLimits(0, 2, 0.1)
          .setValue(this.plugin.settings.temperature)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.temperature = v
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('最大输出 token 数')
      .setDesc('0 = 不限制')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.maxTokens))
          .onChange(async (v) => {
            const n = Math.max(0, Math.floor(Number(v) || 0))
            this.plugin.settings.maxTokens = n
            t.setValue(String(n))
            await this.plugin.saveSettings()
          }),
      )

    // ---------- 审批 ----------
    containerEl.createEl('h3', { text: '审批' })
    new Setting(containerEl)
      .setName('写操作审批默认模式')
      .setDesc('ask = 每次询问；deny = 默认拒绝（可在 Chat 面板会话级放宽）')
      .addDropdown((d) =>
        d
          .addOption('ask', '每次询问 (ask)')
          .addOption('deny', '默认拒绝 (deny)')
          .setValue(this.plugin.settings.approvalDefault)
          .onChange(async (v) => {
            this.plugin.settings.approvalDefault = v as 'ask' | 'deny'
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName('目录级审批白名单')
      .setDesc('每行一个 vault 相对目录（如 Inbox / Projects）。agent 写入这些目录下的笔记免审批。')
      .addTextArea((t) =>
        t
          .setValue(this.plugin.settings.writeAllowDirs.join('\n'))
          .onChange(async (v) => {
            this.plugin.settings.writeAllowDirs = v
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
            await this.plugin.saveSettings()
          }),
      )

    // ---------- 会话 ----------
    containerEl.createEl('h3', { text: '会话' })
    new Setting(containerEl)
      .setName('会话保留天数')
      .setDesc('启动时自动清理超过 N 天未更新的会话日志（0 = 不清理）')
      .addText((t) =>
        t
          .setValue(String(this.plugin.settings.sessionRetentionDays))
          .onChange(async (v) => {
            const n = Math.max(0, Math.floor(Number(v) || 0))
            this.plugin.settings.sessionRetentionDays = n
            t.setValue(String(n))
            await this.plugin.saveSettings()
          }),
      )

    // ---------- 日志 ----------
    containerEl.createEl('h3', { text: '日志' })
    new Setting(containerEl)
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

    // ---------- 插件授权管理 ----------
    containerEl.createEl('h3', { text: '插件授权（grant）' })
    const grants = this.ctx.approval.listGrants()
    if (!grants.length) {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: '暂无授权。在插件管理器中"授权并加载"后，这里可查看与撤销。',
      })
    }
    for (const { pluginId, grant } of grants) {
      const row = new Setting(containerEl)
        .setName(pluginId)
        .setDesc(
          `${grant.mode === 'all' ? '信任所有版本（双勾）' : '仅信任当前版本（单勾）'} · v${grant.version} · ${new Date(grant.grantedAt).toLocaleString()}`,
        )
      row.addButton((b) =>
        b
          .setButtonText('撤销')
          .setWarning()
          .onClick(() => {
            this.ctx.approval.revoke(pluginId)
            this.display()
          }),
      )
    }

    // ---------- 数据 ----------
    containerEl.createEl('h3', { text: '数据位置（vault 内）' })
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: [
        '会话日志: .obsidian/dsh/sessions/*.jsonl',
        '用户插件: .obsidian/dsh-plugins/<id>/',
      ].join('\n'),
    })
  }
}
