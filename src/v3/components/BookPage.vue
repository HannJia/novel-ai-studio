<template>
  <Teleport defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span>
    <router-link v-if="novel" class="crumb-link book-crumb" :title="novel.title" :to="'/codex/' + novel.id">《{{ novel.title }}》</router-link><span v-if="novel" class="crumb-sep">/</span>
    <span class="crumb-b">{{ route.meta.title }}</span>
  </Teleport>
  <div class="book-page">
    <template v-if="novel">
      <nav class="book-nav" aria-label="作品工具">
        <router-link :to="'/write/' + novel.id">写作台</router-link>
        <router-link :to="'/plan/' + novel.id">结构与规划</router-link>
        <router-link :to="'/codex/' + novel.id">典籍</router-link>
        <router-link v-for="item in tools" :key="item.id" :to="'/' + item.id + '/' + novel.id" :aria-current="route.meta.bookTool === item.id ? 'page' : undefined">{{ item.label }}</router-link>
      </nav>
      <main class="book-body"><slot /></main>
    </template>
    <div v-else class="tool-empty"><h1>作品不存在</h1><p>作品可能已移除，请返回书架重新选择。</p><router-link class="m-btn" to="/">返回书架</router-link></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
const route = useRoute(), novels = useNovelStore()
const novel = computed(() => novels.getNovel(String(route.params.novelId)))
const tools = [
  { id: 'characters', label: '人物资料' }, { id: 'data', label: '数据面板' },
  { id: 'inspiration', label: '灵感记录' }, { id: 'chapters', label: '章节管理' }, { id: 'outline', label: '总纲修订' },
]
</script>
<style scoped>

.book-page { position: absolute; inset: 0; overflow: auto; padding: 24px 32px 48px; background: var(--desk); }
.book-nav { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.book-nav a { padding: 6px 10px; border: 1px solid transparent; border-radius: var(--r-s); color: var(--ink-3); text-decoration: none; font-size: 12px; }
.book-nav a:hover, .book-nav a[aria-current="page"] { background: var(--paper); border-color: var(--line-2); color: var(--zhu); }
.tool-empty { padding: 48px 20px; text-align: center; color: var(--ink-3); }
.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-link:hover { color: var(--zhu); }.crumb-sep { margin: 0 7px; color: var(--ink-4); }
.book-crumb { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.crumb-b, .crumb-sep { flex-shrink: 0; white-space: nowrap; }
@media (max-width: 680px) { .book-page { padding: 16px 12px 32px; }.book-nav { gap: 3px; }.book-nav a { padding: 6px 8px; } }

.book-body { min-width: 0; }
</style>
