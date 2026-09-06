<template>
  <section class="inspiration-archive page-container" id="inspiration-archive">
    <header class="archive-header">
      <div>
        <h2 class="page-title">灵感记录</h2>
        <p>创建前的讨论存档，与书内助手对话独立保存。备选或已否定的想法不代表最终设定。</p>
      </div>
      <div class="archive-actions">
        <n-button :disabled="!messages.length" @click="exportArchive('markdown')">导出 Markdown</n-button>
        <n-button :disabled="!messages.length" @click="exportArchive('json')">导出 JSON</n-button>
      </div>
    </header>
    <div v-if="!messages.length" class="archive-empty paper-panel">
      <h3>这本书没有灵感对话记录</h3>
      <p>通过灵感模式创建书籍后，确认保留的讨论会显示在这里。</p>
      <p>书内助手的聊天不会被收录到这份存档。</p>
    </div>
    <template v-else>
      <nav class="archive-pagination" aria-label="灵感记录分页">
        <n-button :disabled="page <= 1" @click="changePage(page - 1)">上一页</n-button>
        <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ messages.length }} 条</span>
        <n-button :disabled="page >= pageCount" @click="changePage(page + 1)">下一页</n-button>
      </nav>
      <div class="archive-history" ref="historyElement" tabindex="0" aria-label="灵感对话存档">
        <article v-for="message in visibleMessages" :key="message.id" class="archive-message" :class="message.role">
          <div class="archive-bubble paper-panel">
            <strong>{{ message.role === 'user' ? '我' : 'AI' }}</strong>
            <div v-if="message.role === 'user'" class="archive-author">{{ message.content }}</div>
            <div v-else class="archive-content" v-html="renderMd(formatChatReply(message.content, message.search))"></div>
            <ChatSearchEvidence :record="message.search" />
          </div>
        </article>
      </div>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NButton } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { exportInspirationArchive } from '@/services/export'
import { formatChatReply } from '@/utils/chatPresentation'
import { renderMd } from '@/utils/markdown'
import ChatSearchEvidence from '@/components/ChatSearchEvidence.vue'

const route = useRoute()
const store = useNovelStore()
const novel = computed(() => store.getNovel(route.params.novelId as string))
const messages = computed(() => novel.value?.inspirationHistory || [])
const page = ref(1)
const pageSize = 20
const pageCount = computed(() => Math.max(1, Math.ceil(messages.value.length / pageSize)))
const visibleMessages = computed(() => messages.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const historyElement = ref<HTMLElement | null>(null)
const error = ref('')

async function changePage(value: number) {
  page.value = Math.min(pageCount.value, Math.max(1, value))
  await nextTick()
  if (historyElement.value) historyElement.value.scrollTop = 0
}
function exportArchive(format: 'markdown' | 'json') {
  if (!novel.value || !messages.value.length) return
  error.value = ''
  try { exportInspirationArchive(novel.value, format) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败，请重试' }
}
watch(() => route.params.novelId, () => { void changePage(1); error.value = '' })
watch(pageCount, () => { if (page.value > pageCount.value) void changePage(pageCount.value) })
</script>

<style scoped>
.inspiration-archive { height: 100%; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.archive-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; flex-shrink: 0; }
.archive-header p { color: var(--text-color-secondary); font-size: 13px; margin: 8px 0 0; }
.archive-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.archive-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; flex-shrink: 0; }
.archive-pagination span { font-size: 12px; color: var(--text-color-secondary); }
.archive-history { flex: 1; min-height: 100px; overflow-y: auto; overscroll-behavior: contain; padding: 4px; }
.archive-message { display: flex; margin-bottom: 16px; }
.archive-message.user { justify-content: flex-end; }
.archive-bubble { max-width: min(90%, 860px); min-width: 0; padding: 16px; overflow-wrap: anywhere; }
.user .archive-bubble { background: var(--color-primary-light); border: 1px solid var(--color-primary); }
.archive-bubble strong { display: block; margin-bottom: 8px; color: var(--color-primary); }
.archive-author { white-space: pre-wrap; }
.archive-content { line-height: 1.8; }
.archive-content :deep(pre) { max-width: 100%; overflow-x: auto; }
.archive-empty { padding: 32px; text-align: center; color: var(--text-color-secondary); }
@media (max-width: 600px) {
  .inspiration-archive { padding: 12px; }
  .archive-bubble { max-width: 96%; padding: 12px; }
}
</style>
