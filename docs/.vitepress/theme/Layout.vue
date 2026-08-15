<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import GiscusComment from './GiscusComment.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <!-- 正文末尾插入评论（首页/overview 为 home 布局，无此插槽，不显示） -->
    <template #doc-after>
      <GiscusComment />
    </template>
  </Layout>
</template>
