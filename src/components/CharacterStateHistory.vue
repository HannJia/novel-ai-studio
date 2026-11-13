<template>
  <section class="character-state-history" aria-label="知情与关系历史">
    <div class="state-filters">
      <label>回看章节
        <select v-model="selectedChapterId" aria-label="回看章节">
          <option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">第{{ chapter.chapterIndex + 1 }}章 {{ chapter.title }}</option>
        </select>
      </label>
      <label>角色
        <select v-model="selectedCharacterId" aria-label="历史角色筛选">
          <option value="">全部角色</option>
          <option v-for="character in novel.characters" :key="character.id" :value="character.id">{{ character.name }}</option>
        </select>
      </label>
    </div>
    <p>显示所选章节结束时的状态。怀疑和错误信念不代表客观事实，单向关系不自动推定为双向。未记录表示未知。</p>
    <p v-if="!chapters.length">创建章节后可按章节回看人物状态。</p>
    <template v-else>
      <h4>截至第{{ chapterIndex + 1 }}章的有效状态</h4>
      <p v-if="!currentStates.length">没有已确认且证据有效的人物状态。请在章节审核中确认知情或关系候选。</p>
      <ul v-else><li v-for="change in currentStates" :key="change.after.id">{{ describeCharacterState(novel, change) }}</li></ul>
      <p v-for="item in invalidStates" :key="item.record.id" class="state-warning" role="status">{{ item.record.summary }}：{{ item.issue }}，需要重新审核。</p>
      <details>
        <summary>命题身份的作者决定（{{ snapshot.propositionDecisions.length }}）</summary>
        <article v-for="item in snapshot.propositionDecisions" :key="item.record.id" class="state-entry">
          <strong>{{ item.active ? '本章边界有效' : '已停用，恢复各自身份投影' }}</strong>
          <p>{{ memoryDecision(item.record)?.fromIds.join('、') }} → {{ memoryDecision(item.record)?.targetId }}</p>
          <p>作者说明：{{ memoryDecision(item.record)?.reason || '作者明确选择引用已有命题' }}</p>
          <p v-if="memoryDecision(item.record)?.resolvedStateIds?.length">作者明确处理的旧认知：{{ memoryDecision(item.record)?.resolvedStateIds?.join('、') }}；原记录和证据保留。</p>
          <p v-if="item.issue" class="state-warning">{{ item.issue }}</p>
          <blockquote v-for="ref in memoryDecision(item.record)?.evidence" :key="ref.id">{{ ref.quote }}</blockquote>
        </article>
      </details>
      <details>
        <summary>变化历史与原文证据（{{ history.length }}）</summary>
        <article v-for="item in history" :key="item.record.id" class="state-entry">
          <strong>{{ describeCharacterState(novel, item.record.characterState!) }}</strong>
          <small>作者确认时间：{{ item.record.appliedAt }}</small>
          <p v-if="item.issue" class="state-warning">{{ item.issue }}；保留历史，不作为当前事实。</p>
          <blockquote v-for="evidence in item.record.characterState!.after.evidence" :key="evidence.id">{{ evidence.quote }}</blockquote>
          <router-link v-if="novel.chapters.some(chapter => chapter.id === item.record.chapterId)"
            :to="{ name: 'V3Write', params: { novelId: novel.id, chapterId: item.record.chapterId } }">打开来源章节</router-link>
        </article>
      </details>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Novel } from '@/types/novel'
import type { CanonMutationRecord, CharacterStateChange } from '@/types/reconstruction'
import { describeCharacterState, getCharacterStateHistory, getCharacterStateSnapshot } from '@/services/reconstructionCharacterState'
import type { MemoryKnowledgeEdge } from '@/types/characterMemory'
const memoryDecision = (record: CanonMutationRecord) => record.characterState?.kind === 'knowledge' ? (record.characterState.after as MemoryKnowledgeEdge).propositionDecision : undefined

const props = defineProps<{ novel: Novel; records: CanonMutationRecord[] }>()
const selectedChapterId = ref(''), selectedCharacterId = ref('')
const chapters = computed(() => props.novel.chapters.slice().sort((a, b) => a.chapterIndex - b.chapterIndex))
watch(chapters, items => {
  if (!items.some(item => item.id === selectedChapterId.value)) selectedChapterId.value = items[items.length - 1]?.id || ''
}, { immediate: true })
const chapterIndex = computed(() => chapters.value.find(item => item.id === selectedChapterId.value)?.chapterIndex ?? -1)
const snapshot = computed(() => getCharacterStateSnapshot(props.novel, props.records, chapterIndex.value, 'through'))
const matches = (change: CharacterStateChange) => !selectedCharacterId.value || change.after.characterId === selectedCharacterId.value
  || (change.kind === 'relationship' && change.after.targetCharacterId === selectedCharacterId.value)
const currentStates = computed(() => [
  ...snapshot.value.knowledge.map(after => ({ kind: 'knowledge' as const, after })),
  ...snapshot.value.relationships.map(after => ({ kind: 'relationship' as const, after })),
].filter(matches))
const invalidStates = computed(() => snapshot.value.invalid.filter(item => matches(item.record.characterState!)))
const history = computed(() => getCharacterStateHistory(props.novel, props.records, chapterIndex.value)
  .filter(item => matches(item.record.characterState!)).reverse())
</script>

<style scoped>
.character-state-history { padding: 16px; color: var(--ink-2); line-height: 1.75; }
.state-filters { display: flex; flex-wrap: wrap; gap: 18px; }
.state-filters label { display: grid; gap: 4px; }
select { max-width: 100%; padding: 6px 10px; border: 1px solid var(--line-2); border-radius: 6px; color: var(--ink); background: var(--paper); }
h4 { color: var(--ink); margin: 14px 0 6px; }
summary { cursor: pointer; }
.state-entry { display: grid; gap: 5px; margin-top: 12px; padding: 12px; border: 1px solid var(--line-2); border-radius: 8px; overflow-wrap: anywhere; }
.state-entry blockquote { margin: 0; padding-left: 10px; border-left: 2px solid var(--line-2); white-space: pre-wrap; }
.state-warning { color: var(--jin); }
</style>
