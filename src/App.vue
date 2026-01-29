<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUiStore, useAiStore } from '@/stores'

const uiStore = useUiStore()
const aiStore = useAiStore()

onMounted(() => {
  uiStore.loadSettings()
  // 应用启动时自动加载 AI 配置，确保创建书籍等功能可用
  aiStore.fetchConfigs()
})
</script>

<template>
  <RouterView />
</template>

<style scoped>
/* 根组件样式 */
</style>
