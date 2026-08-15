import { defineConfig } from 'vitepress'

const zhNav = [
  { text: '首页', link: '/' },
  { text: '使用指南', link: '/guide/quickstart' },
  { text: '开发你的插件', link: '/dev/hello-world' },
]

const enNav = [
  { text: 'Home', link: '/en/' },
  { text: 'Guide', link: '/en/guide/quickstart' },
  { text: 'Plugin Guide', link: '/en/dev/hello-world' },
]

const zhSidebar = {
  '/guide/': [
    {
      text: '使用指南',
      items: [
        { text: '快速开始', link: '/guide/quickstart' },
        { text: '对话面板', link: '/guide/chat' },
        { text: '智能体与模型', link: '/guide/agents-models' },
        { text: '审批与安全', link: '/guide/approval' },
        { text: '用户插件体系', link: '/guide/plugins' },
        { text: '常见问题', link: '/guide/faq' },
      ],
    },
  ],
  '/dev/': [
    {
      text: '插件开发（面向使用者）',
      items: [
        { text: '最小插件', link: '/dev/hello-world' },
        { text: 'ctx.* 服务速查', link: '/dev/services' },
        { text: '翻译插件', link: '/dev/translation' },
      ],
    },
  ],
}

const enSidebar = {
  '/en/guide/': [
    {
      text: 'Guide',
      items: [
        { text: 'Quick Start', link: '/en/guide/quickstart' },
        { text: 'Chat Panel', link: '/en/guide/chat' },
        { text: 'Agents & Models', link: '/en/guide/agents-models' },
        { text: 'Approval & Security', link: '/en/guide/approval' },
        { text: 'User Plugins', link: '/en/guide/plugins' },
        { text: 'FAQ', link: '/en/guide/faq' },
      ],
    },
  ],
  '/en/dev/': [
    {
      text: 'Plugin Development (for users)',
      items: [
        { text: 'Minimal Plugin', link: '/en/dev/hello-world' },
        { text: 'ctx.* Services', link: '/en/dev/services' },
        { text: 'Translation Plugins', link: '/en/dev/translation' },
      ],
    },
  ],
}

export default defineConfig({
  title: 'Harness Like',
  description: 'DeepSeek Harness 理念的 Obsidian 实现：在桌面版 Obsidian 内运行 Cordis 插件体系与 AI agent',
  cleanUrls: true,
  locales: {
    root: { label: '中文', lang: 'zh-CN', title: 'Harness Like', description: 'DeepSeek Harness 理念的 Obsidian 实现', themeConfig: { nav: zhNav, sidebar: zhSidebar } },
    en: { label: 'English', lang: 'en', title: 'Harness Like', description: 'An Obsidian implementation inspired by DeepSeek Harness', themeConfig: { nav: enNav, sidebar: enSidebar } },
  },
  themeConfig: {
    logo: '/harness.svg',
    socialLinks: [{ icon: 'github', link: 'https://github.com/frank6com/obsidian-harness-like' }],
    outline: { level: [2, 3] },
  },
})
