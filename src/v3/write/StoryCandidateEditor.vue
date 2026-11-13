<template>
  <form class="story-candidate-editor" @submit.prevent="confirm">
    <strong>修改故事候选</strong>
    <p class="edit-hint">核对正文证据后确认，修改内容将保存到正式设定，并保留原始提案。</p>
    <p v-if="identity" class="fixed-identity">{{ identity }}</p>
    <p v-for="evidence in baseline.evidence" :key="evidence.id" class="edit-evidence">证据：{{ evidence.quote || evidence.label || '缺少正文引文' }}</p>
    <label v-for="field in fields" :key="field.key">
      <span>{{ field.label }}<span v-if="field.required"> *</span></span>
      <select v-if="field.kind === 'select'" v-model="draft[field.key]" :aria-label="field.label" :disabled="busy || disabled || field.readonly">
        <option value="">{{ field.required ? '请选择' : '未指定' }}</option>
        <option v-if="draft[field.key] && !field.options?.some(option => option.value === draft[field.key])" :value="draft[field.key]">{{ draft[field.key] }}（需核对）</option>
        <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <textarea v-else-if="field.kind === 'multiline' || field.kind === 'list'" v-model="draft[field.key]" rows="3" :aria-label="field.label" :disabled="busy || disabled || field.readonly"></textarea>
      <input v-else v-model="draft[field.key]" :type="field.kind === 'number' ? 'number' : 'text'" step="any" :aria-label="field.label" :disabled="busy || disabled || field.readonly" />
    </label>
    <fieldset v-if="baseline.type === 'knowledge'" :disabled="busy || disabled" class="proposition-choice">
      <legend>作者决定命题身份</legend>
      <label>身份处理<select v-model="identityAction"><option value="new">保留独立命题</option><option value="link">明确引用已有命题</option><option value="merge">确认两个已有命题等价</option></select></label>
      <div v-if="identityAction === 'new' && sameWording.length" class="same-wording" role="status">
        <p>该角色已有文字相同的命题。若是同一件事的认知变化，请明确引用；保留独立时两条认知都会标为待处理冲突。</p>
        <button v-for="entry in sameWording" :key="entry.proposition.id" type="button" @click="chooseSameWording(entry.proposition.id)">引用：{{ entry.proposition.text }} · {{ describeProposition(entry.proposition) }}</button>
      </div>
      <template v-if="identityAction !== 'new'">
        <p>相似文字只是线索。选择并确认表示作者已核对主体、对象、范围和证据；相反认知仍会并列显示。</p>
        <label>归入命题<select v-model="targetId"><option value="">请选择已有命题</option><option v-for="entry in propositions" :key="entry.proposition.id" :value="entry.proposition.id">{{ entry.proposition.text }} · {{ describeProposition(entry.proposition) }}</option></select></label>
        <label v-if="identityAction === 'merge'">另一个已有命题<select v-model="mergeFromId"><option value="">请选择待归并命题</option><option v-for="entry in propositions" :key="entry.proposition.id" :value="entry.proposition.id">{{ entry.proposition.text }} · {{ describeProposition(entry.proposition) }}</option></select></label>
        <label>等价说明<textarea v-model="identityReason" rows="2"></textarea></label>
        <div v-if="resolutionStates.length > 1" class="conflict-choice">
          <p>以下认知仍独立保留。仅确认等价不会消除它们。</p>
          <p v-for="state in resolutionStates" :key="state.id">{{ knowledgeStateLabels[state.state] }}：{{ state.fact }}<span v-if="state.state === 'false_belief'">；角色误信：{{ state.belief }}（不代表客观事实）</span> · {{ state.id }}</p>
          <label><input v-model="resolveConflicts" type="checkbox" />以本次认知明确取代上述认知；保留原记录、证据与处理说明。</label>
        </div>
        <label><input v-model="identityConfirmed" type="checkbox" />我已核对并确认命题等价；原 ID、证据、冲突认知及本次决定保留。</label>
      </template>
    </fieldset>
    <label>作者说明（可选）<textarea v-model="authorNote" rows="2" aria-label="候选修改说明" :disabled="busy || disabled"></textarea></label>
    <p v-if="error" class="edit-error" role="alert">{{ error }}</p>
    <div class="edit-actions">
      <button type="submit" :disabled="busy || disabled || !!error || !baseline.evidence.length">{{ busy ? '正在保存…' : '修改并确认入库' }}</button>
      <button type="button" :disabled="busy" @click="emit('cancel')">取消修改</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CandidateChange } from '@/types/reconstruction'
import { candidateFieldValues, parseEditableCandidate, type CandidateField } from '@/services/candidateEditing'
import { memoryCandidateFields, memoryCandidateValue } from '@/services/characterMemoryCandidateEditing'
import { describeProposition, knowledgeResolutionSignature } from '@/services/characterMemoryIdentity'
import { getCharacterStateSnapshot, getPropositionCatalog, knowledgeStateLabels } from '@/services/reconstructionCharacterState'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
const props = defineProps<{ candidate: CandidateChange; busy?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ confirm: [candidate: CandidateChange, editedValue: string, authorNote: string, memoryDecision?: CharacterMemoryAuthorDecision]; cancel: [] }>()
const novelStore = useNovelStore(), workspace = useReconstructionWorkspaceStore()
const book = computed(() => novelStore.getNovel(baseline.value.novelId || ''))
const identityAction = ref<'new' | 'link' | 'merge'>('new'), targetId = ref(''), mergeFromId = ref(''), identityReason = ref(''), identityConfirmed = ref(false)
const resolveConflicts = ref(false)
const baseline = ref<CandidateChange>(JSON.parse(JSON.stringify(props.candidate)))
const precedingRecords = computed(() => {
  const novel = book.value, candidate = baseline.value, chapter = novel?.chapters.find(item => item.id === candidate.chapterId)
  if (!novel || !chapter) return []
  const offset = candidate.evidence[0]?.startOffset ?? chapter.content.indexOf(candidate.evidence[0]?.quote || '')
  return workspace.getCanonMutations(novel.id).filter(record => record.chapterId !== chapter.id || (record.characterState?.after.evidence[0]?.startOffset ?? 0) <= offset)
})
const propositions = computed(() => {
  const novel = book.value, candidate = baseline.value
  const chapter = novel?.chapters.find(item => item.id === candidate.chapterId)
  if (!novel || !chapter) return []
  return getPropositionCatalog(novel, precedingRecords.value, chapter.chapterIndex, 'through')
})
const resolutionStates = computed(() => {
  const novel = book.value, chapter = novel?.chapters.find(item => item.id === baseline.value.chapterId)
  if (!novel || !chapter || identityAction.value === 'new') return []
  const roots = new Set(propositions.value.filter(entry => entry.proposition.id === targetId.value || (identityAction.value === 'merge' && entry.proposition.id === mergeFromId.value)).map(entry => entry.canonicalId))
  let actor: unknown
  try { actor = parseEditableCandidate(baseline.value).characterId } catch { return [] }
  return getCharacterStateSnapshot(novel, precedingRecords.value, chapter.chapterIndex, 'through').knowledge.filter(state => state.characterId === actor && roots.has(state.projectedFactId || state.factId))
})
/** Text equality is only a hint; choosing it still requires the explicit confirmation checkbox. */
const sameWording = computed(() => {
  const novel = book.value, chapter = novel?.chapters.find(item => item.id === baseline.value.chapterId)
  if (!novel || !chapter || baseline.value.type !== 'knowledge') return []
  let value: Record<string, unknown>
  try { value = parseEditableCandidate(baseline.value) } catch { return [] }
  const text = (input: unknown) => String(input || '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
  const fact = text(draft.value.fact ?? value.fact)
  const ownFacts = new Set(getCharacterStateSnapshot(novel, precedingRecords.value, chapter.chapterIndex, 'through').knowledge
    .filter(state => state.characterId === value.characterId).map(state => state.projectedFactId || state.factId))
  return fact ? propositions.value.filter(entry => entry.canonicalId === entry.proposition.id && ownFacts.has(entry.canonicalId) && text(entry.proposition.text) === fact) : []
})
function chooseSameWording(id: string) { identityAction.value = 'link'; targetId.value = id }
watch([identityAction, targetId, mergeFromId], () => { resolveConflicts.value = false; identityConfirmed.value = false }, { flush: 'sync' })
watch([identityReason, resolveConflicts], () => { identityConfirmed.value = false }, { flush: 'sync' })
watch(() => [targetId.value, mergeFromId.value].map(id => propositions.value.find(entry => entry.proposition.id === id)?.signature).join('\n') + knowledgeResolutionSignature(resolutionStates.value), () => { identityConfirmed.value = false; resolveConflicts.value = false }, { flush: 'sync' })
const draft = ref<Record<string, string>>({})
const fields = ref<CandidateField[]>([])
const authorNote = ref('')
const parseError = ref('')
const identity = ref('')
watch(() => props.candidate.id, () => {
  baseline.value = JSON.parse(JSON.stringify(props.candidate))
  authorNote.value = props.candidate.authorNote || ''
  identityAction.value = 'new'; targetId.value = ''; mergeFromId.value = ''; identityReason.value = ''; identityConfirmed.value = false
  resolveConflicts.value = false
  parseError.value = ''; fields.value = []; draft.value = {}; identity.value = ''
  try {
    const value = parseEditableCandidate(baseline.value)
    fields.value = memoryCandidateFields(baseline.value, value, book.value?.characters || [])
    draft.value = candidateFieldValues(fields.value, value)
    if (baseline.value.type === 'relationship' && String(value.dimension || '').startsWith('custom:')) { draft.value.dimension = 'custom'; draft.value.dimensionName = String(value.dimension).slice(7) }
    const actor = value.characterName || '已关联角色'
    if (baseline.value.type === 'relationship') identity.value = actor + ' → ' + (value.targetCharacterName || '已关联对象') + '（关系方向固定）'
    else if (['knowledge', 'state'].includes(baseline.value.type)) identity.value = '角色：' + actor
    else if (baseline.value.type === 'plotline') identity.value = '沿用原提案关联的事件或剧情线。'
  } catch (cause) { parseError.value = (cause as Error).message }
}, { immediate: true })
const serialized = computed(() => {
  if (parseError.value) return { error: parseError.value, value: '' }
  try {
    if (baseline.value.type === 'knowledge' && identityAction.value !== 'new') {
      const target = propositions.value.find(entry => entry.proposition.id === targetId.value)
      const from = propositions.value.find(entry => entry.proposition.id === mergeFromId.value)
      if (!identityConfirmed.value || !target) throw new Error('请选择已有命题并明确确认等价。')
      if (identityAction.value === 'merge' && (!from || from.canonicalId === target.canonicalId || !identityReason.value.trim())) throw new Error('请选择两个不同命题并填写归并说明。')
      if (resolveConflicts.value && !identityReason.value.trim()) throw new Error('请填写明确处理旧认知的说明。')
    }
    return { error: '', value: memoryCandidateValue(baseline.value, draft.value) }
  }
  catch (cause) { return { error: (cause as Error).message, value: '' } }
})
const error = computed(() => serialized.value.error)
function confirm() {
  if (props.busy || props.disabled || error.value || !baseline.value.evidence.length) return
  const target = propositions.value.find(entry => entry.proposition.id === targetId.value), from = propositions.value.find(entry => entry.proposition.id === mergeFromId.value)
  const memoryDecision: CharacterMemoryAuthorDecision | undefined = baseline.value.type === 'knowledge' ? { action: identityAction.value, confirmed: true,
    targetId: target?.proposition.id, targetSignature: target?.signature, mergeFromId: from?.proposition.id, mergeFromSignature: from?.signature, reason: identityReason.value.trim(),
    resolvedStateIds: resolveConflicts.value ? resolutionStates.value.map(state => state.id).sort() : undefined, resolutionSignature: resolveConflicts.value ? knowledgeResolutionSignature(resolutionStates.value) : undefined } : undefined
  emit('confirm', JSON.parse(JSON.stringify(baseline.value)), serialized.value.value, authorNote.value.trim(), memoryDecision)
}
</script>

<style scoped>
.story-candidate-editor { display: grid; gap: 10px; margin-bottom: 14px; padding: 12px; border: 1px solid var(--zhu); border-radius: var(--r-m); }
.story-candidate-editor label { display: grid; gap: 5px; }
.story-candidate-editor input, .story-candidate-editor textarea, .story-candidate-editor select { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px; font: inherit; color: var(--ink); background: var(--desk); border: 1px solid var(--line-2); border-radius: 5px; }
.story-candidate-editor textarea { resize: vertical; }
.story-candidate-editor input[type=checkbox] { width: auto; justify-self: start; }
.proposition-choice, .conflict-choice, .same-wording { display: grid; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
.same-wording p { margin: 0; font-size: 12px; color: var(--ink-2); }
.same-wording button { justify-self: start; padding: 5px 8px; border-radius: 5px; border: 1px solid var(--line-2); background: var(--panel); color: var(--ink); cursor: pointer; text-align: left; }
.edit-hint, .edit-evidence, .fixed-identity { margin: 0; font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.edit-error { color: var(--zhu); }
.edit-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.edit-actions button { padding: 7px 10px; border-radius: 5px; border: 1px solid var(--line-2); background: var(--panel); color: var(--ink); cursor: pointer; }
.edit-actions button:first-child { background: var(--zhu); color: white; }
.edit-actions button:disabled { opacity: .55; cursor: default; }
</style>
