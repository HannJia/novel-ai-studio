<template>
  <section class="causality-panel" aria-label="作者确认的事件因果">
    <p>方向为来源事件 → 目标事件。导致＝产生结果；使能＝提供必要条件；阻碍＝妨碍目标；动机＝促使行动。计划依赖、共现和模型猜测不作事实。</p>
    <button type="button" :disabled="saving" @click="open()">新增因果决定</button>
    <article v-for="edge in projection.edges" :key="edge.revision.edgeId">
      <strong>{{ eventName(edge.revision.fromEventId) }} —{{ eventCausalityLabels[edge.revision.relation] }}→ {{ eventName(edge.revision.toEventId) }}</strong>
      <p>{{ edge.revision.explanation }}；第 {{ edge.revision.evidence.chapterIndex + 1 }} 章 @{{ edge.revision.evidence.startOffset }}–{{ edge.revision.evidence.endOffset }}「{{ edge.revision.evidence.quote }}」</p>
      <button type="button" :disabled="saving" @click="open(edge.revision)">修改</button>
      <button type="button" :disabled="saving" @click="open(edge.revision, 'revoke')">撤销</button>
    </article>
    <article v-for="item in projection.inactive" :key="item.recordId">
      {{ item.edgeId }}：{{ item.reason }}（历史保留）
      <button type="button" :disabled="saving" @click="openHistorical(item.edgeId)">重新核对</button>
      <button type="button" :disabled="saving" @click="openHistorical(item.edgeId, 'revoke')">登记撤销</button>
    </article>
    <article v-for="row in proposalRows" :key="row.candidate.id">
      <strong>{{ row.preview.title }}</strong>
      <p>{{ row.preview.detail }}</p>
      <small>待作者核对，尚非事实</small>
      <button type="button" :disabled="saving" @click="openProposal(row.candidate)">编辑并核对</button>
    </article>
    <EditorRecoveryPicker :drafts="recoverableDrafts" :busy="saving" :conflict="recoveryConflict" @restore="restoreRecovery" @discard="discardRecovery" />
    <form v-if="draft" @submit.prevent="save">
      <fieldset :disabled="saving">
        <legend>{{ draft.action === 'revoke' ? '撤销因果决定' : '核对因果决定' }}</legend>
        <label>来源事件（起因）<select v-model="draft.fromEventId"><option value="">请选择</option><option v-for="event in novel.eventLog" :key="event.id" :value="event.id">{{ event.title }} [{{ event.id }}]</option></select></label>
        <label>目标事件（结果/行动）<select v-model="draft.toEventId"><option value="">请选择</option><option v-for="event in novel.eventLog" :key="event.id" :value="event.id">{{ event.title }} [{{ event.id }}]</option></select></label>
        <label>关系类型<select v-model="draft.relation"><option v-for="(label, key) in eventCausalityLabels" :key="key" :value="key">{{ label }}</option></select></label>
        <label>明确说明<textarea v-model="draft.explanation" required /></label>
        <label>生效及证据章节<select v-model="draft.chapterId" :disabled="!!candidateId"><option v-for="chapter in orderedChapters" :key="chapter.id" :value="chapter.id">第 {{ chapter.chapterIndex + 1 }} 章 {{ chapter.title }}</option></select></label>
        <label>完整唯一正文引文<textarea v-model="draft.quote" :required="!candidateId" :readonly="!!candidateId" /></label>
        <label>引文起始位置（从 0 起）<input v-model.number="draft.startOffset" type="number" min="0" :readonly="!!candidateId" required /></label>
        <button v-if="!candidateId" type="button" @click="locate">定位唯一引文</button>
        <p v-if="candidateId && !proposalCanAdopt" role="status">这是未验证候选，缺少完整、有效的正文证据，不能采用。可以保存文字修改、暂缓或拒绝；请重新分析取得证据，或另建有证据的作者决定。</p>
        <label>作者说明<textarea v-model="authorNote" /></label>
        <p>打开时的正文与决定已绑定；正文、顺序或端点变化后请重新打开核对。失败时本表输入保留。</p>
        <label><input v-model="authorChecked" type="checkbox" />我已核对两端事件、方向、类型和正文证据，确认此作者决定</label>
        <button type="submit" :disabled="!authorChecked || !proposalCanAdopt">{{ saving ? '保存中…' : '确认并保存' }}</button>
        <template v-if="candidateId">
          <button type="button" @click="saveProposal('save')">保存候选修改</button>
          <button type="button" @click="saveProposal('defer')">保存修改并暂缓</button>
          <button type="button" @click="saveProposal('reject')">保存修改并拒绝</button>
        </template>
        <button type="button" @click="draft = null">取消</button>
      </fieldset>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <details><summary>因果决定历史（{{ history.length }}）</summary><p v-for="record in history" :key="record.id">{{ record.appliedAt }} {{ record.summary }} [{{ record.id }}]</p></details>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EditorRecoveryPicker from '@/components/EditorRecoveryPicker.vue'
import { useEditorRecovery, type EditorDraftSession } from '@/composables/useEditorRecovery'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { CandidateChange } from '@/types/reconstruction'
import type { EventCausalityDraft, EventCausalityRevision } from '@/types/eventCausality'
import { projectEventCausality, eventCausalityLabels } from '@/services/eventCausality'
import { eventCausalityCandidateHasCurrentEvidence, saveEventCausalityProposal } from '@/services/eventCausalityTransactions'
import { assertEventCausalityPayload } from '@/services/eventCausalityValidation'
import { candidatePreview } from '@/v3/selectors/candidatePreview'
import type { EditorDraft } from '@/types/editorRecovery'
import type { Novel } from '@/types/novel'
const props = defineProps<{ novel: Novel; focusCandidateId?: string; initialAuthorNote?: string }>()
const store = useReconstructionWorkspaceStore()
const recovery = useEditorRecovery()
const recoverySession = ref<EditorDraftSession>()
const recoveryScope = () => candidateId.value ? 'candidate:' + candidateId.value : 'edge:' + (draft.value?.edgeId || 'new')
const recoveryRecord = computed(() => store.getEditorDrafts(props.novel.id).find(row => row.kind === 'event-causality' && row.scope === recoveryScope()))
const recoverableDrafts = computed(() => store.getEditorDrafts(props.novel.id).filter(row => row.kind === 'event-causality'))
function recoveryBaseline() { return JSON.stringify({ openBaseline: baseline.value, candidate: expectedCandidate.value || '', edge: draft.value?.edgeId || '' }) }
function captureRecoverySession() {
  if (!draft.value) return
  const current = recoverySession.value
  const record = recoveryRecord.value
  const sameIdentity = current && current.identity.openedBaseline === recoveryBaseline() && current.identity.scope === recoveryScope()
  if (sameIdentity && !current.error) { recovery.queue(current, recoveryPayload()); return }
  if (current && !sameIdentity && (current.running || current.pending || current.sequence > current.savedSequence)) {
    void recovery.flushSession(current).catch(() => undefined)
  }
  if (record && record.openedBaseline === recoveryBaseline() && record.scope === recoveryScope()) {
    try { recoverySession.value = recovery.restore(record); recovery.queue(recoverySession.value, recoveryPayload()); return } catch { /* Keep this edited payload under its own id and baseline. */ }
  }
  recoverySession.value = recovery.begin({ novelId: props.novel.id, kind: 'event-causality', scope: recoveryScope(),
    targetId: candidateId.value || draft.value.edgeId, openedBaseline: recoveryBaseline() })
  recovery.queue(recoverySession.value, recoveryPayload())
}
function recoveryPayload() {
  return { mode: candidateId.value ? 'candidate' : 'edge', baseline: baseline.value, candidateId: candidateId.value || '',
    expectedCandidate: expectedCandidate.value || '', authorNote: authorNote.value, authorChecked: authorChecked.value, draft: draft.value! }
}
function queueRecovery() {
  if (!draft.value || !recoverySession.value) return
  try { recovery.queue(recoverySession.value, recoveryPayload()) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复草稿保存失败' }
}
const recoveryConflict = (item: Pick<EditorDraft, 'openedBaseline'>) => item.openedBaseline === recoveryBaseline() ? '' : '事件、正文或候选已变化；草稿保留原基线，恢复后需重新核对。'
async function restoreRecovery(item: EditorDraft) {
  if (item.novelId !== props.novel.id || item.kind !== 'event-causality') return
  try {
    const session = recoverySession.value
    if (session?.identity.id === item.id && (session.running || session.pending || session.sequence > session.savedSequence)) await recovery.flushSession(session)
    const restored = recovery.restore(item), payload = item.payload!
    if (typeof payload.draft !== 'object' || !payload.draft || Array.isArray(payload.draft)) throw new Error('事件因果草稿内容无效')
    draft.value = JSON.parse(JSON.stringify(payload.draft)) as EventCausalityDraft
    baseline.value = String(payload.baseline); candidateId.value = String(payload.candidateId || '') || undefined
    expectedCandidate.value = String(payload.expectedCandidate || '') || undefined; authorNote.value = String(payload.authorNote || '')
    authorChecked.value = false; recoverySession.value = restored; error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复事件因果输入失败' }
}
async function discardRecovery(item: EditorDraft) {
  try {
    const session = recoverySession.value
    if (session?.identity.id === item.id && (session.running || session.pending || session.sequence > session.savedSequence)) await recovery.flushSession(session)
    await recovery.discard(item)
    if (session?.identity.id === item.id) recoverySession.value = undefined
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '丢弃失败' }
}
const records = computed(() => store.getCanonMutations(props.novel.id))
const history = computed(() => records.value.filter(r => r.type === 'event_causality'))
const projection = computed(() => projectEventCausality(props.novel, records.value))
const proposals = computed(() => store.getCandidates(props.novel.id).filter(c => c.type === 'event_causality' && ['proposed','deferred'].includes(c.status)))
const proposalRows = computed(() => proposals.value.map(candidate => ({ candidate, preview: candidatePreview(candidate, props.novel.characters, props.novel.eventLog) })))
const orderedChapters = computed(() => [...props.novel.chapters].sort((a,b) => a.chapterIndex-b.chapterIndex))
const draft = ref<EventCausalityDraft | null>(null), baseline = ref(''), saving = ref(false), error = ref(''), authorChecked = ref(false)
const candidateId = ref<string>(), expectedCandidate = ref<string>()
const authorNote = ref('')
type LocalProposalDraft = { draft:EventCausalityDraft; baseline:string; expected:string; note:string }
const localDrafts = new Map<string,LocalProposalDraft>()
const proposalCanAdopt = computed(() => {
  if (!candidateId.value) return true
  try {
    const candidate: CandidateChange = JSON.parse(expectedCandidate.value || 'null')
    return eventCausalityCandidateHasCurrentEvidence(props.novel,candidate)
  } catch { return false }
})
function stash() {
  if (candidateId.value && draft.value && expectedCandidate.value) localDrafts.set(candidateId.value,{
    draft:JSON.parse(JSON.stringify(draft.value)),baseline:baseline.value,expected:expectedCandidate.value,note:authorNote.value })
}
function eventName(id: string) { return props.novel.eventLog.find(e => e.id === id)?.title || id }
function capture() { baseline.value = store.captureEventCausalityOpenBaseline(props.novel.id); error.value = ''; authorChecked.value = false; candidateId.value = undefined; expectedCandidate.value = undefined; authorNote.value = '' }
function open(revision?: EventCausalityRevision, action: EventCausalityDraft['action'] = 'confirm') {
  stash()
  capture()
  draft.value = revision ? { edgeId:revision.edgeId,fromEventId:revision.fromEventId,toEventId:revision.toEventId,relation:revision.relation,
    explanation:revision.explanation,chapterId:revision.effectiveChapterId,quote:revision.evidence.quote,startOffset:revision.evidence.startOffset,action }
    : { edgeId:'event-causality:' + crypto.randomUUID(),fromEventId:'',toEventId:'',relation:'causes',explanation:'',chapterId:orderedChapters.value.slice(-1)[0]?.id || '',quote:'',startOffset:0,action }
  captureRecoverySession()
}
function openHistorical(edgeId: string, action: EventCausalityDraft['action'] = 'confirm') { const r = history.value.filter(r => r.targetId === edgeId).slice(-1)[0]?.eventCausality; if (r) open(r,action) }
function openProposal(candidate: CandidateChange) {
  if (candidateId.value === candidate.id && draft.value) return
  stash()
  try {
    const saved = localDrafts.get(candidate.id)
    if (saved) { draft.value = JSON.parse(JSON.stringify(saved.draft)); baseline.value = saved.baseline; expectedCandidate.value = saved.expected; authorNote.value = saved.note; candidateId.value = candidate.id; authorChecked.value = false; error.value = ''; captureRecoverySession(); return }
    const value: unknown = JSON.parse(candidate.proposedValue)
    assertEventCausalityPayload(value)
    const evidence = candidate.evidence[0]
    capture()
    draft.value = { edgeId:'event-causality:' + candidate.id,fromEventId:value.fromEventId,toEventId:value.toEventId,relation:value.relation,
      explanation:value.explanation,chapterId:candidate.chapterId || '',quote:evidence?.quote || '',startOffset:evidence?.startOffset ?? 0,action:'confirm' }
    candidateId.value = candidate.id; expectedCandidate.value = JSON.stringify(candidate)
    authorNote.value = candidate.id === props.focusCandidateId ? props.initialAuthorNote ?? candidate.authorNote ?? '' : candidate.authorNote || ''
    captureRecoverySession()
  }
  catch (e) { error.value = e instanceof Error ? e.message : '候选无效' }
}
watch([draft, baseline, candidateId, expectedCandidate, authorNote, authorChecked], () => { queueRecovery() }, { deep: true, flush: 'sync' })
watch(() => [props.novel.id, props.focusCandidateId], () => {
  const candidate = proposals.value.find(c => c.id === props.focusCandidateId)
  if (candidate) openProposal(candidate)
}, { immediate: true })
function locate() {
  const d = draft.value, c = props.novel.chapters.find(c => c.id === d?.chapterId)
  if (!d || !c || !d.quote.trim() || c.content.indexOf(d.quote) < 0 || c.content.indexOf(d.quote) !== c.content.lastIndexOf(d.quote)) { error.value = '引文必须在当前章节正文中唯一出现。'; return }
  d.startOffset = c.content.indexOf(d.quote); error.value = ''
  queueRecovery()
}
async function save() {
  if (!draft.value || saving.value || !authorChecked.value || !proposalCanAdopt.value) return
  saving.value = true; error.value = ''
  const input = JSON.parse(JSON.stringify({ draft:draft.value,openBaseline:baseline.value,candidateId:candidateId.value,expectedCandidate:expectedCandidate.value,authorNote:authorNote.value }))
  try {
    const checkpoint = recoverySession.value ? await recovery.flushSession(recoverySession.value) : undefined
    const session = recoverySession.value
    await store.saveEventCausality(props.novel.id,input)
    if (candidateId.value) localDrafts.delete(candidateId.value)
    draft.value = null; recoverySession.value = undefined
    if (checkpoint && session) void recovery.consume(session, checkpoint).catch(() => undefined)
  }
  catch (e) { error.value = e instanceof Error ? e.message : '保存失败，输入已保留。' }
  finally { saving.value = false }
}
async function saveProposal(action: 'save' | 'defer' | 'reject') {
  if (!draft.value || !candidateId.value || saving.value) return
  saving.value = true; error.value = ''
  const input = JSON.parse(JSON.stringify({ draft:draft.value,openBaseline:baseline.value,candidateId:candidateId.value,expectedCandidate:expectedCandidate.value,authorNote:authorNote.value }))
  try {
    const checkpoint = recoverySession.value ? await recovery.flushSession(recoverySession.value) : undefined
    const session = recoverySession.value
    const result = await store.transactStory(props.novel.id,aggregate => saveEventCausalityProposal(aggregate,input,action,new Date().toISOString()))
    expectedCandidate.value = JSON.stringify(result); authorChecked.value = false
    if (checkpoint && session) void recovery.consume(session, checkpoint).catch(() => undefined)
    if (action === 'reject') { localDrafts.delete(result.id); draft.value = null; recoverySession.value = undefined }
    else stash()
  } catch (e) { error.value = e instanceof Error ? e.message : '保存失败，输入已保留。' }
  finally { saving.value = false }
}
</script>

<style scoped>
.causality-panel { display: grid; gap: 1rem; }
article, fieldset { padding: 1rem; border: 1px solid var(--line-2); border-radius: 8px; }
label { display: grid; gap: .4rem; margin: .8rem 0; }
textarea, select, input { max-width: 100%; padding: .5rem; color: inherit; background: transparent; }
textarea, select, input:not([type=checkbox]):not([type=radio]) { box-sizing: border-box; min-width: 0; border: 1px solid var(--line-2); border-radius: var(--r-s); background: var(--paper); font: inherit; }
textarea { min-height: 5rem; }
button { padding: .5rem .8rem; margin-right: .5rem; border: 1px solid var(--line-2); border-radius: var(--r-s); color: var(--ink-2); background: var(--paper); cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
[role=alert] { color: var(--zhu); }
</style>
