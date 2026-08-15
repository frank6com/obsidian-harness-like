import { defineConfig } from 'vitepress'

const zhNav = [
  { text: '首页', link: '/' },
  { text: '使用教程', link: '/guide/quickstart' },
  { text: '开发文档', link: '/development/index' },
]

const enNav = [
  { text: 'Home', link: '/en/' },
  { text: 'Tutorial', link: '/en/guide/quickstart' },
  { text: 'Development', link: '/en/development/index' },
]

/** 使用教程导航树（/guide/ 与 /dev/ 共用，保证两类页面左侧 sidebar 完整） */
const zhTutorial = [
  {
    text: '入门',
    items: [
      { text: '快速开始', link: '/guide/quickstart' },
      { text: '已实现的能力清单', link: '/guide/capabilities' },
    ],
  },
  {
    text: '日常使用',
    items: [
      { text: '对话面板', link: '/guide/chat' },
      { text: '智能体与模型', link: '/guide/agents-models' },
      { text: '审批与安全', link: '/guide/approval' },
    ],
  },
  {
    text: '扩展',
    items: [
      { text: '用户插件体系', link: '/guide/plugins' },
      { text: '开发你的第一个插件', link: '/dev/hello-world' },
      { text: 'ctx.* 服务速查', link: '/dev/services' },
      { text: '翻译插件', link: '/dev/translation' },
    ],
  },
  {
    text: '帮助',
    items: [{ text: '常见问题', link: '/guide/faq' }],
  },
]

const enTutorial = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Quick Start', link: '/en/guide/quickstart' },
      { text: 'Implemented Capabilities', link: '/en/guide/capabilities' },
    ],
  },
  {
    text: 'Daily Use',
    items: [
      { text: 'Chat Panel', link: '/en/guide/chat' },
      { text: 'Agents & Models', link: '/en/guide/agents-models' },
      { text: 'Approval & Security', link: '/en/guide/approval' },
    ],
  },
  {
    text: 'Extending',
    items: [
      { text: 'User Plugins', link: '/en/guide/plugins' },
      { text: 'Your First Plugin', link: '/en/dev/hello-world' },
      { text: 'ctx.* Services', link: '/en/dev/services' },
      { text: 'Translation Plugins', link: '/en/dev/translation' },
    ],
  },
  {
    text: 'Help',
    items: [{ text: 'FAQ', link: '/en/guide/faq' }],
  },
]

/** 开发文档导航树（面向本插件贡献者，分组分类） */
const zhDevDocs = [
  { text: '入门', items: [{ text: '开发总览', link: '/development/index' }] },
  {
    text: '流程与发布',
    items: [
      { text: '开发流程', link: '/development/workflow' },
      { text: '发布与审核', link: '/development/release' },
    ],
  },
  {
    text: '规范与约定',
    items: [
      { text: '版本号规范', link: '/development/versioning' },
      { text: '架构约定', link: '/development/conventions' },
    ],
  },
]

const enDevDocs = [
  { text: 'Getting Started', items: [{ text: 'Overview', link: '/en/development/index' }] },
  {
    text: 'Workflow & Release',
    items: [
      { text: 'Workflow', link: '/en/development/workflow' },
      { text: 'Release & Review', link: '/en/development/release' },
    ],
  },
  {
    text: 'Rules & Conventions',
    items: [
      { text: 'Versioning', link: '/en/development/versioning' },
      { text: 'Conventions', link: '/en/development/conventions' },
    ],
  },
]

const zhSidebar = {
  '/guide/': zhTutorial,
  '/dev/': zhTutorial,
  '/development/': zhDevDocs,
}

const enSidebar = {
  '/en/guide/': enTutorial,
  '/en/dev/': enTutorial,
  '/en/development/': enDevDocs,
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
