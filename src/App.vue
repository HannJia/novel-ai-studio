<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useUiStore } from '@/stores'

const uiStore = useUiStore()

onMounted(() => {
  uiStore.loadSettings()
})
</script>

<template>
  <RouterView />
</template>

<style scoped>
/* 根组件样式 */
</style>
