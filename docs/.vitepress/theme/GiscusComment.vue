<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useData, useRoute } from 'vitepress'

// giscus 配置：评论存储于 GitHub Discussions（frank6com/obsidian-harness-like）
// 专用分类 Docs comments（Open-ended discussion 格式；Announcement 格式仅 maintainer 可建 discussion，普通访客首次评论会失败）
const GISCUS_REPO = 'frank6com/obsidian-harness-like'
const GISCUS_REPO_ID = 'R_kgDOT5Co7A'
const GISCUS_CATEGORY = 'Docs comments'
const GISCUS_CATEGORY_ID = 'DIC_kwDOT5Co7M4DDdTC'

const { lang, frontmatter } = useData()
const route = useRoute()
const container = ref<HTMLElement | null>(null)

/** 页面 frontmatter 写 comment: false 可关闭本页评论 */
const enabled = computed(() => frontmatter.value.comment !== false)
// 跟随站点语言：zh 页 zh-CN，en 页 en（配置器默认 zh-CN 仅是其生成时的界面语言）
const giscusLang = computed(() => (lang.value.startsWith('zh') ? 'zh-CN' : 'en'))

function renderGiscus() {
  const el = container.value
  if (!el || !enabled.value) return
  el.innerHTML = ''
  const script = document.createElement('script')
  script.src = 'https://giscus.app/client.js'
  script.async = true
  script.crossOrigin = 'anonymous'
  script.setAttribute('data-repo', GISCUS_REPO)
  script.setAttribute('data-repo-id', GISCUS_REPO_ID)
  script.setAttribute('data-category', GISCUS_CATEGORY)
  script.setAttribute('data-category-id', GISCUS_CATEGORY_ID)
  script.setAttribute('data-mapping', 'pathname')
  script.setAttribute('data-strict', '0')
  script.setAttribute('data-reactions-enabled', '1')
  script.setAttribute('data-emit-metadata', '0')
  script.setAttribute('data-input-position', 'top')
  script.setAttribute('data-theme', 'preferred_color_scheme')
  script.setAttribute('data-lang', giscusLang.value)
  script.setAttribute('data-loading', 'lazy')
  el.appendChild(script)
}

onMounted(renderGiscus)
// SPA 路由切换后按新 pathname 重新挂载（每个页面独立 Discussion）
watch(() => route.path, renderGiscus)
</script>

<template>
  <div ref="container" class="dsh-giscus" />
</template>
