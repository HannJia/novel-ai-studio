<template>
  <div v-if="record" class="search-evidence">
    <div class="search-status" :class="{ warning: record.status !== 'searched' }">{{ statusLabel }}</div>
    <details v-if="record.sources?.length" class="search-sources">
      <summary>来源（{{ record.sources.length }}）</summary>
      <div v-for="(source, index) in record.sources" :key="source.url">
        <a v-if="safeSourceUrl(source.url)" :href="safeSourceUrl(source.url)!" target="_blank"
          rel="noopener noreferrer" referrerpolicy="no-referrer">{{ chatSourceTitle(source, index) }}</a>
        <span v-else>{{ chatSourceTitle(source, index) }}（无效链接）</span>
        <q v-if="source.excerpt">{{ chatSourceExcerpt(source.excerpt, record) }}</q>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { safeSourceUrl } from '@/services/chatSearch'
import { chatSourceExcerpt, chatSourceTitle } from '@/utils/chatPresentation'
import type { ChatSearchRecord } from '@/types/chat'

const props = defineProps<{ record?: ChatSearchRecord }>()
const statusLabel = computed(() => {
  if (props.record?.status === 'searched') return props.record.sources.length ? '🌐 接口已返回搜索来源' : '🌐 搜索已执行，未提供可引用来源'
  return props.record?.status === 'not-used'
    ? '本轮未执行搜索；此回答并非实时核实结果'
    : '未收到可验证的搜索证据；接口可能忽略了联网参数'
})
</script>

<style scoped>
.search-evidence { font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.search-status { color: var(--color-primary); margin-top: 6px; }
.search-status.warning { color: var(--text-color-secondary); }
.search-sources { margin-top: 6px; }
.search-sources summary { cursor: pointer; color: var(--color-primary); }
.search-sources a { color: var(--color-primary); text-decoration: underline; }
.search-sources q { display: block; color: var(--text-color-secondary); }
.search-sources > div { padding: 4px 0; }
</style>
