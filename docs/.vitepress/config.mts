import { defineConfig } from 'vitepress'

// 默认语言 = 英文（根路径），中文在 /zh/（locales root/en → root/zh）

const enNav = [
  { text: 'Home', link: '/' },
  { text: 'Tutorial', link: '/guide/quickstart' },
  { text: 'Development', link: '/development/index' },
]

const zhNav = [
  { text: '首页', link: '/zh/' },
  { text: '使用教程', link: '/zh/guide/quickstart' },
  { text: '开发文档', link: '/zh/development/index' },
]

/** 英文使用教程导航树（/guide/ 与 /dev/ 共用，保证两类页面左侧 sidebar 完整） */
const enTutorial = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Overview', link: '/overview' },
      { text: 'Quick Start', link: '/guide/quickstart' },
    ],
  },
  {
    text: 'Daily Use',
    items: [
      { text: 'Chat Panel', link: '/guide/chat' },
      { text: 'Agents & Models', link: '/guide/agents-models' },
      { text: 'Describing What You Want', link: '/guide/speak-to-agent' },
      { text: 'Approval & Security', link: '/guide/approval' },
    ],
  },
  {
    text: 'Extending',
    items: [
      { text: 'Creating Plugins in Conversation', link: '/guide/plugin-agent' },
      { text: 'User Plugins', link: '/guide/plugins' },
    ],
  },
  {
    text: 'Help',
    items: [{ text: 'FAQ', link: '/guide/faq' }],
  },
]

/** 中文使用教程导航树 */
const zhTutorial = [
  {
    text: '入门',
    items: [
      { text: '项目概览', link: '/zh/overview' },
      { text: '快速开始', link: '/zh/guide/quickstart' },
    ],
  },
  {
    text: '日常使用',
    items: [
      { text: '对话面板', link: '/zh/guide/chat' },
      { text: '智能体与模型', link: '/zh/guide/agents-models' },
      { text: '在对话中描述需求', link: '/zh/guide/speak-to-agent' },
      { text: '审批与安全', link: '/zh/guide/approval' },
    ],
  },
  {
    text: '扩展',
    items: [
      { text: '通过对话创建插件', link: '/zh/guide/plugin-agent' },
      { text: '用户插件体系', link: '/zh/guide/plugins' },
    ],
  },
  {
    text: '帮助',
    items: [{ text: '常见问题', link: '/zh/guide/faq' }],
  },
]

/** 英文开发文档导航树（面向本插件贡献者，分组分类） */
const enDevDocs = [
  { text: 'Getting Started', items: [{ text: 'Overview', link: '/development/index' }, { text: 'Capabilities (extension mapping)', link: '/development/capabilities' }] },
  {
    text: 'Workflow & Release',
    items: [
      { text: 'Workflow', link: '/development/workflow' },
      { text: 'Release & Review', link: '/development/release' },
    ],
  },
  {
    text: 'Rules & Conventions',
    items: [
      { text: 'Versioning', link: '/development/versioning' },
      { text: 'Conventions', link: '/development/conventions' },
    ],
  },
  {
    text: 'User Plugin Development (advanced)',
    items: [
      { text: 'Your First Plugin', link: '/dev/hello-world' },
      { text: 'ctx.* Services', link: '/dev/services' },
      { text: 'Translation Plugins', link: '/dev/translation' },
    ],
  },
]

/** 中文开发文档导航树 */
const zhDevDocs = [
  { text: '入门', items: [{ text: '开发总览', link: '/zh/development/index' }, { text: '能力清单（扩展点映射）', link: '/zh/development/capabilities' }] },
  {
    text: '流程与发布',
    items: [
      { text: '开发流程', link: '/zh/development/workflow' },
      { text: '发布与审核', link: '/zh/development/release' },
    ],
  },
  {
    text: '规范与约定',
    items: [
      { text: '版本号规范', link: '/zh/development/versioning' },
      { text: '架构约定', link: '/zh/development/conventions' },
    ],
  },
  {
    text: '用户插件开发（进阶）',
    items: [
      { text: '开发你的第一个插件', link: '/zh/dev/hello-world' },
      { text: 'ctx.* 服务速查', link: '/zh/dev/services' },
      { text: '翻译插件', link: '/zh/dev/translation' },
    ],
  },
]

const enSidebar = {
  '/overview': enTutorial,
  '/guide/': enTutorial,
  '/dev/': enDevDocs,
  '/development/': enDevDocs,
}

const zhSidebar = {
  '/zh/overview': zhTutorial,
  '/zh/guide/': zhTutorial,
  '/zh/dev/': zhDevDocs,
  '/zh/development/': zhDevDocs,
}

export default defineConfig({
  // 项目站点部署在子路径（frank6com.github.io/obsidian-harness-like/），必须配置 base
  base: '/obsidian-harness-like/',
  title: 'Harness Like',
  description: 'An Obsidian implementation inspired by DeepSeek Harness',
  cleanUrls: true,
  locales: {
    root: { label: 'English', lang: 'en', title: 'Harness Like', description: 'An Obsidian implementation inspired by DeepSeek Harness', themeConfig: { nav: enNav, sidebar: enSidebar } },
    zh: { label: '中文', lang: 'zh-CN', title: 'Harness Like', description: 'DeepSeek Harness 理念的 Obsidian 实现', themeConfig: { nav: zhNav, sidebar: zhSidebar } },
  },
  themeConfig: {
    logo: '/harness.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/frank6com/obsidian-harness-like' },
      {
        // Obsidian 官方插件目录入口（图标为 Obsidian 官方新版晶石 logo，取自 obsidian.md/favicon.svg）
        icon: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 256 256"><path fill="#9974F8" d="M94.82 149.44c6.53-1.94 17.13-4.9 29.26-5.71a102.97 102.97 0 0 1-7.64-48.84c1.63-16.51 7.54-30.38 13.25-42.1l3.47-7.14 4.48-9.18c2.35-5 4.08-9.38 4.9-13.56.81-4.07.81-7.64-.2-11.11-1.03-3.47-3.07-7.14-7.15-11.21a17.02 17.02 0 0 0-15.8 3.77l-52.81 47.5a17.12 17.12 0 0 0-5.5 10.2l-4.5 30.18a149.26 149.26 0 0 1 38.24 57.2ZM54.45 106l-1.02 3.06-27.94 62.2a17.33 17.33 0 0 0 3.27 18.96l43.94 45.16a88.7 88.7 0 0 0 8.97-88.5A139.47 139.47 0 0 0 54.45 106Z"/><path fill="#9974F8" d="m82.9 240.79 2.34.2c8.26.2 22.33 1.02 33.64 3.06 9.28 1.73 27.73 6.83 42.82 11.21 11.52 3.47 23.45-5.8 25.08-17.73 1.23-8.67 3.57-18.46 7.75-27.53a94.81 94.81 0 0 0-25.9-40.99 56.48 56.48 0 0 0-29.56-13.35 96.55 96.55 0 0 0-40.99 4.79 98.89 98.89 0 0 1-15.29 80.34h.1Z"/><path fill="#9974F8" d="M201.87 197.76a574.87 574.87 0 0 0 19.78-31.6 8.67 8.67 0 0 0-.61-9.48 185.58 185.58 0 0 1-21.82-35.9c-5.91-14.16-6.73-36.08-6.83-46.69 0-4.07-1.22-8.05-3.77-11.21l-34.16-43.33c0 1.94-.4 3.87-.81 5.81a76.42 76.42 0 0 1-5.71 15.9l-4.7 9.8-3.36 6.72a111.95 111.95 0 0 0-12.03 38.23 93.9 93.9 0 0 0 8.67 47.92 67.9 67.9 0 0 1 39.56 16.52 99.4 99.4 0 0 1 25.8 37.31Z"/></svg>',
        },
        link: 'https://community.obsidian.md/plugins/harness-like',
        ariaLabel: 'Obsidian Plugin Directory',
      },
    ],
    outline: { level: [2, 3] },
  },
})
