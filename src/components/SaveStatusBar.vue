<template>
  <div v-if="error" class="save-status-error" role="alert">
    <span>保存未完成：{{ error }}。请勿退出；可重试，或到书架导出当前项目备份。</span>
    <n-button size="small" :loading="retrying" @click="retry">重试保存</n-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
const novels = useNovelStore()
const knowledge = useKnowledgeStore()
const inspiration = useInspirationSessionsStore()
const retrying = ref(false)
const error = computed(() => [novels.saveError, knowledge.saveError, inspiration.saveError].filter(Boolean).join('；'))
async function retry() {
  retrying.value = true
  try { await Promise.all([novels.flushPendingSaves(), knowledge.flushPendingSaves(), inspiration.flushPendingSaves()]) }
  catch { /* Store errors remain visible until a successful write. */ }
  finally { retrying.value = false }
}
</script>

<style scoped>
.save-status-error { flex-shrink: 0; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 10px 18px; color: var(--color-error); background: var(--bg-color-secondary); border-bottom: 1px solid var(--color-error); font-size: 13px; overflow-wrap: anywhere; }
</style>
