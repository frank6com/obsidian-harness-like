/**
 * 设置页：模型端点/凭据、审批默认模式、数据目录信息。
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type DshObsidianPlugin from './main'

export class DshSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: DshObsidianPlugin,
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
