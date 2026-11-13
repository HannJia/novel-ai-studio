<template>
  <div class="time-box">
    <strong>故事时间</strong>
    <p v-if="time.known">本章已记录故事日 {{ time.startDay }}–{{ time.endDay }}。</p>
    <template v-else>
      <p>{{ time.reason }}请核对正文后确认本章时间。</p>
      <form class="chapter-time-form" @submit.prevent="confirm">
        <label>记录方式
          <select v-model="mode" :disabled="disabled">
            <option value="absolute">明确开始日和结束日</option>
            <option value="relative" :disabled="time.startDay === undefined">从紧邻前章推进</option>
          </select>
        </label>
        <template v-if="mode === 'absolute'">
          <label>开始日<input v-model.number="startDay" type="number" min="0" step="0.01" required :disabled="disabled"></label>
          <label>结束日<input v-model.number="endDay" type="number" min="0" step="0.01" required :disabled="disabled"></label>
        </template>
        <label v-else>经过天数<input v-model.number="elapsedDays" type="number" min="0" step="0.01" required :disabled="disabled"></label>
        <label v-if="expectedRecordId" class="replace-time"><input v-model="replace" type="checkbox" :disabled="disabled">已核对正文，替换失效的时间来源并保留历史</label>
        <div class="finding-actions">
          <button class="m-btn xs zhu" type="submit" :disabled="disabled || (!!expectedRecordId && !replace)">{{ saving ? '保存中…' : '确认本章时间' }}</button>
          <button class="m-btn xs" type="button" :disabled="disabled" @click="readSource">重新读取来源</button>
        </div>
      </form>
    </template>
    <p v-if="error" class="time-error" role="alert">{{ error }}</p>
    <router-link class="m-link" :to="{ path: `/data/${novel.id}`, query: { chapterId: chapter.id } }">查看时间来源与历史</router-link>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Chapter, Novel } from '@/types/novel'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { captureDataClockBaseline } from '@/services/dataPanelTransactions'
import { projectStoryTime, storyTimeSourceVersion } from '@/services/storyTime'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'

const props = defineProps<{ novel: Novel; chapter: Chapter; busy: boolean; saveContent: () => Promise<boolean> }>()
const emit = defineEmits<{ saved: [] }>()
const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
const time = computed(() => projectStoryTime(props.novel, props.chapter))
const saving = ref(false), error = ref('')
const disabled = computed(() => props.busy || saving.value || props.chapter.status === 'locked')
const mode = ref<'absolute' | 'relative'>('absolute')
const startDay = ref<number | ''>(''), endDay = ref<number | ''>(''), elapsedDays = ref<number | ''>('')
const expectedRecordId = ref<string>(), replace = ref(false)
let source: { novelId: string; chapterId: string; chapterIndex: number; content: string; version: string; baseline: string }

function readSource() {
  const { novel, chapter } = props
  source = { novelId: novel.id, chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content,
    version: storyTimeSourceVersion(chapter.content), baseline: captureDataClockBaseline(novel) }
  const projection = time.value
  mode.value = projection.startDay !== undefined && !projection.recordId ? 'relative' : 'absolute'
  startDay.value = projection.startDay ?? ''; endDay.value = projection.endDay ?? ''
  elapsedDays.value = projection.elapsedDays ?? ''; expectedRecordId.value = projection.recordId
  replace.value = false; error.value = ''
}
watch(() => [props.novel.id, props.chapter.id], readSource, { immediate: true })

async function confirm() {
  if (disabled.value) return
  saving.value = true; error.value = ''
  const captured = { ...source }
  try {
    const values = mode.value === 'absolute' ? [startDay.value, endDay.value] : [elapsedDays.value]
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      || (mode.value === 'absolute' && Number(endDay.value) < Number(startDay.value))) throw new Error('请明确填写有效的时间数值，包括 0；结束日不能早于开始日。')
    if (expectedRecordId.value && !replace.value) throw new Error('请确认替换失效的时间来源。')
    if (!await props.saveContent()) throw new Error('正文尚未保存，请先保存后核对时间。')
    if (props.novel.id !== captured.novelId || props.chapter.id !== captured.chapterId
      || props.chapter.content !== captured.content) throw new Error('正文或章节已变化，请重新读取来源并核对时间。')
    if (workspace.getCandidates(captured.novelId).some(row => row.chapterId === captured.chapterId && row.type === 'timeline'
      && ['proposed', 'deferred'].includes(row.status) && (!row.sourceVersionId || row.sourceVersionId === buildAnalysisSourceVersionId(captured.content)))) {
      throw new Error('本章已有时间候选，请先确认或忽略该候选，避免重复推进。')
    }
    const result = await novels.confirmChapterStoryTime(captured.novelId, {
      chapterId: captured.chapterId, chapterIndex: captured.chapterIndex, content: captured.content,
      expectedSourceVersionId: captured.version, expectedRecordId: expectedRecordId.value, replace: replace.value,
      mode: mode.value, startDay: startDay.value === '' ? undefined : startDay.value,
      endDay: endDay.value === '' ? undefined : endDay.value, elapsedDays: elapsedDays.value === '' ? undefined : elapsedDays.value,
    }, captured.baseline)
    if (!result) throw new Error('作品已不存在，时间未保存。')
    emit('saved'); readSource()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { saving.value = false }
}
</script>

<style scoped>
.chapter-time-form { display: grid; gap: 10px; margin: 10px 0; }
.chapter-time-form label { display: grid; gap: 4px; font-size: 12px; color: var(--ink-2); }
.chapter-time-form input, .chapter-time-form select { width: 100%; min-width: 0; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink); font: inherit; }
.chapter-time-form .replace-time { display: flex; align-items: flex-start; }
.replace-time input { width: auto; }
.time-error { color: var(--zhu); }
</style>
