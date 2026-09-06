<template>
  <div v-if="writing" class="ai-status"><div class="spinner"></div><span>{{ writingText }}</span><n-button size="tiny" @click="emit('stop')">停止</n-button></div>
  <div v-if="completing" class="ai-status"><div class="spinner"></div><span>{{ completingText }}</span></div>
  <div v-if="backgroundText" class="ai-status background"><div v-if="backgroundPending > 0" class="spinner"></div><span>{{ backgroundText }}</span></div>
</template>

<script setup lang="ts">
import { NButton } from 'naive-ui'

defineProps<{
  writing: boolean
  writingText: string
  completing: boolean
  completingText: string
  backgroundText: string
  backgroundPending: number
}>()
const emit = defineEmits<{ stop: [] }>()
</script>

<style scoped>
.ai-status { position: fixed; left: 50%; bottom: 64px; z-index: 25; display: flex; align-items: center; gap: 9px; max-width: min(680px, calc(100vw - 32px)); padding: 9px 13px; transform: translateX(-50%); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-color-card); box-shadow: var(--shadow-md); color: var(--text-color-secondary); font-size: 13px; }
.ai-status.background { bottom: 18px; }
.ai-status span { min-width: 0; overflow-wrap: anywhere; }
.spinner { width: 15px; height: 15px; flex: 0 0 auto; border: 2px solid var(--border-color); border-top-color: var(--color-primary); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
