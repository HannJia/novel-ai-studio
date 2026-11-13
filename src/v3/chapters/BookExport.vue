<template>
      <section v-if="novel" class="book-export" aria-label="作品导出">
        <div><strong>导出作品</strong><p>导出已保存的正式正文，可选择包含总纲。</p></div>
        <label><span class="export-label">导出格式</span><select v-model="exportFormat" :disabled="exporting" aria-label="导出作品格式">
          <option value="txt">TXT（含总纲）</option><option value="txt-body">TXT（仅正文）</option>
          <option value="word">Word 兼容 HTML .doc（含总纲）</option><option value="word-body">Word 兼容 HTML .doc（仅正文）</option>
          <option value="epub">EPUB</option>
        </select></label>
        <button class="m-btn" type="button" :disabled="exporting" @click="exportBook">{{ exporting ? '正在导出…' : '导出作品' }}</button>
        <p v-if="exportError" class="export-error" role="alert">{{ exportError }}</p>
      </section>

</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { flushEditorDrafts } from '@/services/appLifecycle'
import { exportToTXT, exportToWordHtml, exportToEpub } from '@/services/export'
import { toast } from '@/v3/shell'

const route = useRoute(), novels = useNovelStore()
const novel = computed(() => novels.getNovel(String(route.params.novelId)))
const exportFormat = ref('txt'), exporting = ref(false), exportError = ref('')
async function exportBook() {
  if (!novel.value || exporting.value) return
  const owner = novel.value.id, format = exportFormat.value
  exporting.value = true; exportError.value = ''
  try {
    await flushEditorDrafts()
    await novels.flushPendingSaves()
    if (novel.value?.id !== owner) throw new Error('作品已切换，请重新选择要导出的作品。')
    const snapshot = JSON.parse(JSON.stringify(novel.value))
    if (format === 'epub') await exportToEpub(snapshot)
    else if (format === 'word' || format === 'word-body') exportToWordHtml(snapshot, { bodyOnly: format === 'word-body' })
    else exportToTXT(snapshot, { bodyOnly: format === 'txt-body' })
    toast('作品已导出')
  } catch (cause) { exportError.value = cause instanceof Error ? cause.message : '导出失败，请重试。' }
  finally { exporting.value = false }
}

</script>
<style scoped>
.book-export { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 22px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.book-export > div { margin-right: auto; }.book-export strong { font: 600 15px var(--f-serif); }.book-export p { margin: 4px 0 0; color: var(--ink-3); font-size: 12px; }
.book-export label { min-width: 0; }.book-export select { max-width: 100%; padding: 7px 8px; border: 1px solid var(--line-2); border-radius: var(--r-s); background: var(--paper); color: var(--ink-2); font: 12px var(--f-ui); }
.export-label { margin-right: 8px; font-size: 12px; color: var(--ink-3); }.book-export .export-error { width: 100%; color: var(--zhu); }
</style>
