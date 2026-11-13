<template>
  <section class="scene-planner" aria-label="章节与场景设计">
    <p>先确认本章的目标、开场状态、结束状态与禁止揭露的信息，再将这一章拆成可编辑场景。只有作者批准的方案会进入写作和审核。</p>
    <p v-if="!ready" role="status">正在读取创作工作区…</p>
    <template v-else>
      <p v-if="!storyConfirmed">请先在作品创建页确认作品契约和故事骨架。<button @click="router.push('/generate/' + novel.id)">检查作品契约</button></p>
      <label>目标章节
        <select v-model="selectedId" aria-label="场景目标章节" :disabled="busy && !generating">
          <option value="">选择单章计划</option>
          <option v-for="plan in availablePlans" :key="plan.id" :value="plan.id">第 {{ plan.number }} 章 · {{ plan.title }}</option>
        </select>
      </label>
      <p v-if="!availablePlans.length">请先在“章节计划”中添加一条起止章节相同的详细计划。</p>
      <form v-if="chapterForm" @submit.prevent="saveChapter(true)">
        <h3>本章计划 <small>{{ selectedPlan?.approval === 'approved' ? '已批准' : '待确认' }}</small></h3>
        <fieldset :disabled="busy"><div class="field-grid">
          <label v-for="field in chapterFields" :key="field.key">{{ field.label }}
            <textarea v-model="chapterForm[field.key]" :aria-label="field.label" rows="3"></textarea>
          </label>
          <label v-for="field in chapterListFields" :key="field.key">{{ field.label }}（每行一条）
            <textarea :value="chapterForm[field.key].join('\n')" :aria-label="field.label" rows="3" @input="chapterForm[field.key] = split(($event.target as HTMLTextAreaElement).value)"></textarea>
          </label>
        </div></fieldset>
        <div class="actions"><button type="button" :disabled="busy" @click="saveChapter(false)">保存章计划草稿</button><button class="confirm-action" type="submit" :disabled="busy || !storyConfirmed">确认本章计划</button></div>
      </form>
      <template v-if="selectedPlan">
        <h3>场景方案</h3>
        <p v-if="approvedScenes.length">当前有 {{ approvedScenes.length }} 个已批准场景。新草稿经确认后才会替换它们。</p>
        <label>方案名称<input v-model="optionTitle" :disabled="busy" placeholder="例如：潜入方案／正面交涉方案" /></label>
        <label>本次生成要求<textarea v-model="instructions" :disabled="busy" rows="3" placeholder="希望比较的方向、节奏和限制；随编辑草稿保存"></textarea></label>
        <div class="actions"><button :disabled="busy || selectedPlan.approval !== 'approved' || chapterDirty" @click="generate('generate')">生成一个新方案（先保留当前输入）</button><button :disabled="busy || scenes.length >= 12" @click="addScene">添加场景</button><button v-if="generating" @click="cancelGeneration">取消并保留部分输出</button></div>
        <p v-if="chapterDirty" role="status">本章计划有未保存修改，请先确认本章计划。</p>
        <p v-if="scenesDirty" role="status">场景输入已加入恢复保存队列；保存作者版本后才能批准。</p>
        <p v-if="incomplete" role="status">当前输入来自未完整输出，不能直接批准。请编辑补齐，并勾选核对后保存作者版本。</p>
        <p v-if="optionConflict" role="status">此方案已有更新版本；当前版本仍在历史中，请另存为新方案后比较。</p>
        <p v-if="baselineConflict" role="status">打开时的规划已变化。你的输入和原基线保留；核对当前章计划后，可明确关联到最新规划。</p>
        <button v-if="baselineConflict" :disabled="busy" @click="rebindInputs">已核对，保留输入并关联最新规划</button>
        <label v-if="incomplete"><input v-model="authorCompleted" type="checkbox" :disabled="busy" />我已手工补齐并核对全部场景，保存为完整作者版本</label>
        <form v-if="scenes.length" @submit.prevent="saveScenes(true)">
          <fieldset v-for="(scene, index) in scenes" :key="scene.id" :disabled="busy" class="scene-card">
            <legend>场景 {{ index + 1 }}</legend>
            <div class="actions"><button type="button" :disabled="index === 0" @click="moveScene(index, -1)">上移</button><button type="button" :disabled="index === scenes.length - 1" @click="moveScene(index, 1)">下移</button><button type="button" @click="scenes.splice(index, 1)">移除</button></div>
            <div class="field-grid">
              <label v-for="field in sceneFields" :key="field.key">{{ field.label }}<textarea v-model="scene[field.key]" :aria-label="'场景' + (index + 1) + field.label" rows="2"></textarea></label>
              <label>视角角色<select :value="scene.viewpointCharacterId || ''" :aria-label="'场景' + (index + 1) + '视角角色'" @change="scene.viewpointCharacterId = ($event.target as HTMLSelectElement).value || undefined"><option value="">未指定</option><option v-for="character in novel.characters" :key="character.id" :value="character.id">{{ character.name }}</option></select></label>
              <label>必须发生的动作<textarea :value="scene.requiredActions.join('\n')" :aria-label="'场景' + (index + 1) + '必须动作'" @input="scene.requiredActions = split(($event.target as HTMLTextAreaElement).value)"></textarea></label>
              <label>信息变化（谁得知什么）<textarea :value="scene.informationChanges.join('\n')" :aria-label="'场景' + (index + 1) + '信息变化'" @input="scene.informationChanges = split(($event.target as HTMLTextAreaElement).value)"></textarea></label>
            </div>
          </fieldset>
          <div class="actions"><button type="button" :disabled="busy" @click="saveScenes(false)">保存作者方案版本</button><button type="button" :disabled="busy" @click="saveAsNewOption">另存为新方案</button><button class="confirm-action" type="submit" :disabled="busy || chapterDirty || incomplete || scenesDirty || optionConflict || !selectedRevision || selectedPlan.approval !== 'approved'">确认并使用这些场景</button></div>
        </form>
        <ScenePlanningHistory :options="recoveryOptions" :revisions="recoveryRevisions" :attempts="recoveryAttempts" :editors="recoveryEditors"
          :selected-revision-id="revisionId" :baseline="currentBaseline" :busy="busy" :scope="novel.id + ':' + selectedId"
          @select="selectVersion" @restore-version="restoreVersion" @restore-editor="restoreEditor" @discard-editor="discardEditor"
          @retry="generate('retry', $event)" @continue="generate('continue', $event)" @recover="recoverOutput" />
        <details v-if="history.length"><summary>已替换的场景（{{ history.length }}）</summary><article v-for="scene in history" :key="scene.id"><strong>{{ scene.title }}</strong><p>{{ scene.purpose }} → {{ scene.outputState }}</p></article></details>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button v-if="error" :disabled="busy" @click="reloadLatest">保留输入快照并重新读取规划</button>
      <p v-if="pendingCount" role="status">{{ pendingCount }} 项输入或输出尚未完成保存；切换后仍保留在保存队列。</p>
      <button :disabled="busy" @click="retryRecovery">重试本页及离页保留的输入与输出</button>
      <pre v-if="generating && liveOutput" class="partial-output">{{ liveOutput }}</pre>
      <p v-if="notice" role="status">{{ notice }}</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ScenePlanningHistory from './ScenePlanningHistory.vue'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { applySkillInstructions, callAI } from '@/services/ai'
import { safeAiErrorMessage } from '@/services/aiDiagnostics'
import { startAiActivity, finishAiActivity, type AiActivity } from '@/services/aiActivity'
import { flushEditorDrafts, registerDraftSaver, type DraftFlushToken } from '@/services/appLifecycle'
import { buildScenePlanningPrompt, normalizeScenePlans, parseScenePlanningOutput, recoverPartialScenePlans, requireConfirmedStory } from '@/services/reconstructionPlanning'
import { captureScenePlanningBaseline, type ScenePlanningEdit } from '@/services/scenePlanningTransactions'
import { sceneContentSignature, sceneRecovery } from '@/services/planningRecovery'
import type { SceneEditorDraft, SceneGenerationAttempt, SceneOptionRevision, SceneRecoveryEdit } from '@/types/planningRecovery'
import type { Novel } from '@/types/novel'
import type { ChapterPlanV2, ScenePlan } from '@/types/reconstruction'

const props = defineProps<{ novel: Novel; ready: boolean; initialPlanId?: string }>()
const route = useRoute(), router = useRouter(), config = useConfigStore(), workspace = useReconstructionWorkspaceStore()
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const split = (value: string) => value.split(/\r?\n/)
const now = () => new Date().toISOString()
const draft = computed(() => workspace.getCreationDraft(props.novel.id))
const recovery = computed(() => sceneRecovery(draft.value))
const storyConfirmed = computed(() => { try { if (!draft.value) return false; requireConfirmedStory(draft.value); return true } catch { return false } })
const selectedId = ref(''), busy = ref(false), error = ref(''), notice = ref(''), generating = ref(false), liveOutput = ref('')
const availablePlans = computed(() => (draft.value?.chapterPlans || []).filter(plan => plan.status !== 'archived' && (plan.endNumber ?? plan.number) === plan.number))
const requestedPlanId = computed(() => props.initialPlanId ?? route.query.plan)
const selectedPlan = computed(() => availablePlans.value.find(plan => plan.id === selectedId.value))
const chapterForm = ref<ChapterPlanV2>(), scenes = ref<ScenePlan[]>([])
const instructions = ref(''), optionTitle = ref(''), optionId = ref<string>(), revisionId = ref<string>()
const incomplete = ref(false), incompleteSignature = ref<string>(), authorCompleted = ref(false), loadedForms = ref(''), syncHealthy = ref(false)
const formBaseline = ref(''), pendingCount = ref(0)
const currentBaseline = computed(() => captureScenePlanningBaseline(props.novel, draft.value))
const baselineConflict = computed(() => !!formBaseline.value && formBaseline.value !== currentBaseline.value)
const selectedRevision = computed(() => recovery.value.revisions.find(row => row.id === revisionId.value))
const optionConflict = computed(() => !!selectedRevision.value && recovery.value.options.find(row => row.id === optionId.value)?.revisionId !== revisionId.value)
const scenesDirty = computed(() => !selectedRevision.value || sceneContentSignature(scenes.value) !== sceneContentSignature(selectedRevision.value.scenes)
  || optionTitle.value !== selectedRevision.value.title || instructions.value !== selectedRevision.value.instructions
  || formBaseline.value !== selectedRevision.value.baseline || JSON.stringify(chapterForm.value) !== JSON.stringify(selectedRevision.value.chapter))
const localChanges = computed(() => !!loadedForms.value && formValues() !== loadedForms.value)
const chapterDirty = computed(() => JSON.stringify(chapterForm.value) !== JSON.stringify(selectedPlan.value))
const approvedScenes = computed(() => (draft.value?.scenePlans || []).filter(scene => scene.chapterPlanId === selectedId.value && scene.approval === 'approved'))
const history = computed(() => (draft.value?.scenePlans || []).filter(scene => scene.chapterPlanId === selectedId.value && scene.approval === 'rejected'))
const recoveryOptions = computed(() => recovery.value.options.filter(row => row.chapterPlanId === selectedId.value))
const recoveryRevisions = computed(() => recovery.value.revisions.filter(row => row.chapterPlanId === selectedId.value))
const recoveryAttempts = computed(() => recovery.value.attempts.filter(row => row.chapterPlanId === selectedId.value))
const recoveryEditors = computed(() => recovery.value.editors.filter(row => row.chapterPlanId === selectedId.value))
const chapterFields = [{ key: 'title', label: '章节名称' }, { key: 'objective', label: '章节目标' }, { key: 'conflict', label: '章节冲突' }, { key: 'openingState', label: '开场状态' }, { key: 'endingState', label: '结束状态' }] as const
const chapterListFields = [{ key: 'requiredEvents', label: '必须发生的事件' }, { key: 'prohibitedReveals', label: '禁止揭露的信息' }, { key: 'characterChangeNotes', label: '人物变化' }] as const
const sceneFields = [{ key: 'title', label: '名称' }, { key: 'purpose', label: '目的' }, { key: 'locationId', label: '地点' }, { key: 'conflict', label: '冲突' }, { key: 'outputState', label: '结束状态' }] as const
let disposed = false, suppress = false, formOwner = '', formPlanId = '', editorId = '', editorSequence = 0, operations = 0, cancelEpoch = 0
let syncTicket = 0, deferredSync = false, syncTail: Promise<void> = Promise.resolve(), writeTail: Promise<void> = Promise.resolve()
let controller: AbortController | undefined, generationTask: Promise<void> | undefined, operationTask: Promise<void> | undefined
let interruptReason = '', activeAttempt: SceneGenerationAttempt | undefined
let appliedSelectionScope = ''
const pending = new Map<string, { owner: string; edit: SceneRecoveryEdit }>()
const pendingKey = (owner: string, edit: SceneRecoveryEdit) => owner + ':' + edit.kind + ':' + (edit.kind === 'scene-revision' ? edit.revision.id
  : edit.kind === 'scene-discard-editor' ? edit.id : edit.kind === 'scene-selection' ? edit.value.chapterPlanId : edit.value.id)
const scopeCurrent = (owner: string, planId: string) => !disposed && props.novel.id === owner && selectedId.value === planId
function maybeReleaseSaver() { if (disposed && !pending.size && !activeAttempt && !operations) unregisterDraftSaver() }
function queueRecovery(owner: string, edit: SceneRecoveryEdit, token?: DraftFlushToken): Promise<void> {
  const entry = { owner, edit: clone(edit) }, key = pendingKey(owner, edit)
  pending.set(key, entry); pendingCount.value = pending.size
  const write = writeTail.catch(() => undefined).then(async () => {
    if (pending.get(key) !== entry) return
    await workspace.saveCreationRecovery(owner, entry.edit, token)
    if (pending.get(key) === entry) pending.delete(key)
    pendingCount.value = pending.size
    maybeReleaseSaver()
  })
  writeTail = write
  void write.catch(cause => { if (!disposed) error.value = '恢复数据尚未保存：' + safeAiErrorMessage(cause) })
  return write
}
async function flushPending(token?: DraftFlushToken) {
  await writeTail.catch(() => undefined)
  do {
    let failure: unknown
    for (const [key, entry] of [...pending]) if (pending.get(key) === entry) {
      try { await queueRecovery(entry.owner, entry.edit, token) } catch (cause) { failure ||= cause }
    }
    if (failure) throw failure
  } while (pending.size)
  maybeReleaseSaver()
}
const unregisterDraftSaver = registerDraftSaver(async token => {
  // Token exists only for this flush. Stop paid work before saving its terminal checkpoint.
  cancelEpoch++; interruptReason = '项目保存流程中断'; controller?.abort(new DOMException(interruptReason, 'AbortError'))
  await generationTask?.catch(() => undefined)
  await operationTask?.catch(() => undefined)
  const captured = captureEditor()
  if (captured && localChanges.value) {
    try { await queueRecovery(formOwner, { kind: 'scene-editor', value: captured }, token) } catch { /* Retry all retained scopes below. */ }
  }
  await flushPending(token)
})
function formValues() { return JSON.stringify([chapterForm.value, scenes.value, instructions.value, optionTitle.value, incomplete.value, optionId.value, revisionId.value]) }
function captureEditor(): SceneEditorDraft | undefined {
  if (!chapterForm.value || !formOwner || !formPlanId || !formBaseline.value) return undefined
  return clone({ id: editorId, chapterPlanId: formPlanId, baseline: formBaseline.value, sequence: ++editorSequence,
    chapter: chapterForm.value, scenes: scenes.value, instructions: instructions.value, title: optionTitle.value,
    optionId: optionId.value, revisionId: revisionId.value, incomplete: incomplete.value, incompleteSignature: incompleteSignature.value, updatedAt: now() })
}
function checkpointEditor(): Promise<void> {
  const captured = captureEditor()
  return captured ? queueRecovery(formOwner, { kind: 'scene-editor', value: captured }) : Promise.resolve()
}
function loadForms(baseline?: string) {
  suppress = true
  chapterForm.value = selectedPlan.value ? clone(selectedPlan.value) : undefined
  const candidates = (draft.value?.scenePlans || []).filter(scene => scene.chapterPlanId === selectedId.value && ['draft', 'awaiting_approval'].includes(scene.approval))
  scenes.value = clone(candidates.length ? candidates : approvedScenes.value).sort((a, b) => a.order - b.order)
  formOwner = props.novel.id; formPlanId = selectedId.value
  formBaseline.value = baseline ?? currentBaseline.value
  instructions.value = ''; optionTitle.value = selectedPlan.value ? selectedPlan.value.title + ' · 手工方案' : ''
  incomplete.value = false; incompleteSignature.value = undefined; authorCompleted.value = false; optionId.value = undefined; revisionId.value = undefined
  editorId = crypto.randomUUID(); editorSequence = 0; loadedForms.value = formValues(); suppress = false
}
watch([chapterForm, scenes, instructions, optionTitle, incomplete], () => {
  if (suppress || disposed || !formOwner) return
  void checkpointEditor().catch(() => undefined)
}, { deep: true, flush: 'sync' })
watch(selectedId, () => {
  if (formOwner && localChanges.value) void checkpointEditor().catch(() => undefined)
  if (generating.value) { cancelEpoch++; interruptReason = '切换章节计划'; controller?.abort(new DOMException(interruptReason, 'AbortError')) }
  loadForms()
}, { flush: 'sync' })
watch(() => props.novel.id, () => {
  if (formOwner && localChanges.value) void checkpointEditor().catch(() => undefined)
  cancelEpoch++; interruptReason = '切换作品'; controller?.abort(new DOMException(interruptReason, 'AbortError'))
  suppress = true; chapterForm.value = undefined; scenes.value = []; formOwner = ''; formPlanId = ''; loadedForms.value = ''; suppress = false
  selectedId.value = ''; syncHealthy.value = false
}, { flush: 'sync' })
watch([requestedPlanId, availablePlans], ([planId]) => {
  const scope = props.novel.id + ':' + String(planId || '')
  if (scope === appliedSelectionScope) return
  if ((!busy.value || generating.value) && typeof planId === 'string' && availablePlans.value.some(plan => plan.id === planId)) {
    appliedSelectionScope = scope; selectedId.value = planId
  }
}, { immediate: true })
// A new novel can finish synchronizing while the previous request is still unwinding.
// Also apply a requested selection deferred by an author save. Never rebase existing inputs.
watch(busy, value => {
  if (value || disposed || !props.ready) return
  if (deferredSync) { deferredSync = false; void synchronize() }
  if (!syncHealthy.value) return
  const planId = typeof requestedPlanId.value === 'string' ? requestedPlanId.value : ''
  const scope = props.novel.id + ':' + planId
  if (scope !== appliedSelectionScope && availablePlans.value.some(plan => plan.id === planId)) {
    appliedSelectionScope = scope; selectedId.value = planId
  }
  if (formOwner !== props.novel.id || !chapterForm.value) {
    if (!availablePlans.value.some(plan => plan.id === selectedId.value)) selectedId.value = availablePlans.value[0]?.id || ''
    loadForms()
  }
}, { flush: 'sync' })
watch(() => [props.ready, props.novel.id, JSON.stringify([props.novel.volumes, props.novel.chapterPlans, props.novel.chapters.map(chapter => [chapter.chapterIndex, chapter.volumeIndex])])], () => {
  void synchronize()
}, { immediate: true })
function synchronize(discardInputs = false): Promise<void> {
  // Publishing an author transaction updates the novel before its workspace
  // snapshot. Capture the next sync baseline only after that operation settles.
  if (busy.value && !discardInputs) { deferredSync = true; return Promise.resolve() }
  const ticket = ++syncTicket
  syncTail = syncTail.catch(() => undefined).then(async () => {
    if (disposed || !props.ready || ticket !== syncTicket) return
    const owner = props.novel.id
    try {
      const result = await workspace.commitScenePlanningEdit(owner, { action: 'sync' }, captureScenePlanningBaseline(props.novel, draft.value))
      if (disposed || props.novel.id !== owner || ticket !== syncTicket) return
      syncHealthy.value = true
      if (discardInputs || !busy.value && !localChanges.value) {
        if (!availablePlans.value.some(plan => plan.id === selectedId.value)) selectedId.value = availablePlans.value[0]?.id || ''
        loadForms(result.baseline)
        if (discardInputs) error.value = ''
      } else if (result.changed) error.value = '规划来源已变化，你的输入与生成结果仍保留，请核对后再保存。'
    } catch (cause) {
      if (disposed || props.novel.id !== owner || ticket !== syncTicket) return
      syncHealthy.value = false; error.value = '场景工作区保存失败：' + safeAiErrorMessage(cause)
    }
  })
  return syncTail
}
async function operate(action: () => Promise<void>, allowUnsynced = false) {
  if (busy.value || disposed || !props.ready) return
  const owner = props.novel.id, planId = selectedId.value
  operations++
  busy.value = true; error.value = ''; notice.value = ''
  const task = (async () => {
    await syncTail
    if (!scopeCurrent(owner, planId)) return
    if (!syncHealthy.value && !allowUnsynced) throw new Error('场景工作区尚未同步，请重试读取；输入已保留。')
    await action()
  })()
  operationTask = task
  try { await task }
  catch (cause) { if (!disposed) error.value = safeAiErrorMessage(cause) }
  finally { if (operationTask === task) operationTask = undefined; busy.value = false; operations--; maybeReleaseSaver() }
}
async function reloadLatest() {
  await operate(async () => {
    const owner = props.novel.id, planId = selectedId.value
    await checkpointEditor()
    if (scopeCurrent(owner, planId)) await synchronize(true)
  }, true)
}
async function retryRecovery() {
  if (busy.value || disposed) return
  const owner = props.novel.id
  operations++; busy.value = true; error.value = ''; notice.value = ''
  try {
    // Includes savers retained by unmounted scene editors, even after changing scope.
    await flushEditorDrafts()
    if (!disposed && props.novel.id === owner) notice.value = '本页及离页保留的输入和输出已保存'
  } catch (cause) { if (!disposed) error.value = '恢复保存仍未完成：' + safeAiErrorMessage(cause) }
  finally { operations--; busy.value = false; maybeReleaseSaver() }
}
async function persist(edit: ScenePlanningEdit, owner = formOwner, planId = formPlanId, baseline = formBaseline.value) {
  if (!scopeCurrent(owner, planId)) throw new Error('当前作品或章节已切换，输入仍在原章节恢复记录中')
  const result = await workspace.commitScenePlanningEdit(owner, edit, baseline)
  if (disposed || props.novel.id !== owner || selectedId.value !== planId) return
  // Only this successful author transaction may advance the local baseline.
  suppress = true; formBaseline.value = result.baseline
  chapterForm.value = selectedPlan.value ? clone(selectedPlan.value) : chapterForm.value
  suppress = false
  await checkpointEditor()
}
async function saveChapter(confirm: boolean) {
  await operate(async () => {
    if (!chapterForm.value) return
    const plan = clone(chapterForm.value), owner = formOwner, planId = formPlanId, baseline = formBaseline.value
    await checkpointEditor()
    await persist({ action: 'chapter', plan, confirm }, owner, planId, baseline)
    notice.value = confirm ? '本章计划已确认；场景输入仍保留，保存新版本后可确认' : '章节草稿已保存，场景仍需核对'
  })
}
function addScene() {
  scenes.value.push({ id: crypto.randomUUID(), chapterPlanId: selectedId.value, order: scenes.value.length + 1, title: '', purpose: '',
    outputState: '', requiredActions: [], informationChanges: [], status: 'planned', approval: 'draft' })
}
function moveScene(index: number, delta: number) { const [scene] = scenes.value.splice(index, 1); scenes.value.splice(index + delta, 0, scene) }
async function saveVersion(input: SceneEditorDraft, kind: SceneOptionRevision['kind'], complete: boolean,
  owner: string, forceNew = false, attemptId?: string): Promise<SceneOptionRevision> {
  const state = sceneRecovery(workspace.getCreationDraft(owner)), existing = !forceNew && input.optionId ? state.options.find(row => row.id === input.optionId) : undefined
  const revision: SceneOptionRevision = { id: crypto.randomUUID(), optionId: existing?.id || crypto.randomUUID(), chapterPlanId: input.chapterPlanId,
    parentRevisionId: input.revisionId, attemptId, kind, title: input.title || '场景方案', baseline: input.baseline,
    chapter: clone(input.chapter), instructions: input.instructions, scenes: clone(input.scenes), complete, createdAt: now() }
  await queueRecovery(owner, { kind: 'scene-revision', option: { id: revision.optionId, chapterPlanId: input.chapterPlanId,
    revisionId: revision.id, createdAt: existing?.createdAt || revision.createdAt }, revision, expectedRevisionId: existing ? input.revisionId : undefined })
  return revision
}
function openRevision(revision: SceneOptionRevision) {
  suppress = true
  chapterForm.value = clone(revision.chapter); scenes.value = clone(revision.scenes); instructions.value = revision.instructions; optionTitle.value = revision.title
  optionId.value = revision.optionId; revisionId.value = revision.id; incomplete.value = !revision.complete; authorCompleted.value = false
  incompleteSignature.value = revision.complete ? undefined : sceneContentSignature(revision.scenes)
  formBaseline.value = revision.baseline; formOwner = props.novel.id; formPlanId = revision.chapterPlanId
  editorId = crypto.randomUUID(); editorSequence = 0; loadedForms.value = formValues(); suppress = false
}
async function selectVersion(id: string) {
  await operate(async () => {
    const owner = formOwner, planId = formPlanId
    const revision = recovery.value.revisions.find(row => row.id === id && row.chapterPlanId === selectedId.value)
    if (!revision) throw new Error('场景版本不存在')
    await checkpointEditor()
    await queueRecovery(owner, { kind: 'scene-selection', value: { chapterPlanId: revision.chapterPlanId, optionId: revision.optionId, revisionId: revision.id, updatedAt: now() } })
    if (!scopeCurrent(owner, planId)) return
    openRevision(revision); await checkpointEditor(); notice.value = '方案已打开供编辑，正式场景未改变'
  })
}
async function restoreVersion(id: string) {
  await operate(async () => {
    const owner = formOwner, planId = formPlanId
    const revision = recovery.value.revisions.find(row => row.id === id && row.chapterPlanId === selectedId.value)
    if (!revision) throw new Error('场景历史版本不存在')
    await checkpointEditor()
    const input: SceneEditorDraft = { id: crypto.randomUUID(), chapterPlanId: revision.chapterPlanId, baseline: revision.baseline, sequence: 0,
      chapter: clone(revision.chapter), scenes: clone(revision.scenes), instructions: revision.instructions, title: revision.title + ' · 恢复',
      revisionId: revision.id, optionId: revision.optionId, incomplete: !revision.complete, updatedAt: now() }
    const restored = await saveVersion(input, 'restored', revision.complete, owner, true)
    if (!scopeCurrent(owner, planId)) return
    openRevision(restored); await checkpointEditor()
  })
}
async function restoreEditor(id: string) {
  await operate(async () => {
    const owner = formOwner, planId = formPlanId
    const saved = recovery.value.editors.find(row => row.id === id && row.chapterPlanId === selectedId.value)
    if (!saved) throw new Error('恢复输入不存在')
    await checkpointEditor()
    if (!scopeCurrent(owner, planId)) return
    suppress = true
    chapterForm.value = clone(saved.chapter); scenes.value = clone(saved.scenes); instructions.value = saved.instructions; optionTitle.value = saved.title
    optionId.value = saved.optionId; revisionId.value = saved.revisionId; incomplete.value = saved.incomplete; authorCompleted.value = false
    incompleteSignature.value = saved.incomplete ? saved.incompleteSignature ?? sceneContentSignature(saved.scenes) : undefined
    formBaseline.value = saved.baseline; editorId = crypto.randomUUID(); editorSequence = 0; suppress = false
    await checkpointEditor(); notice.value = '已恢复输入；原基线保留，未覆盖已批准规划'
  })
}
async function discardEditor(id: string) {
  await operate(async () => {
    const owner = formOwner
    const saved = recovery.value.editors.find(row => row.id === id && row.chapterPlanId === selectedId.value)
    if (!saved) return
    await queueRecovery(owner, { kind: 'scene-discard-editor', id, expected: JSON.stringify(saved) })
    if (editorId === id) { editorId = crypto.randomUUID(); editorSequence = 0 }
  })
}
async function rebindInputs() {
  await operate(async () => {
    const owner = formOwner, planId = formPlanId, baseline = currentBaseline.value
    await checkpointEditor()
    if (!scopeCurrent(owner, planId)) return
    if (!selectedPlan.value) throw new Error('原章节计划已不存在，恢复记录仍保留')
    // Preserve the old snapshot; only explicit author reconciliation changes the baseline.
    formBaseline.value = baseline; editorId = crypto.randomUUID(); editorSequence = 0
    await checkpointEditor(); notice.value = '输入已关联当前规划；请保存新的作者版本再确认'
  })
}
async function saveAuthorVersion(forceNew: boolean) {
  const owner = formOwner, planId = formPlanId, characterIds = props.novel.characters.map(person => person.id)
  const input = captureEditor()
  if (!input) return
  const completed = authorCompleted.value
  await queueRecovery(owner, { kind: 'scene-editor', value: input })
  if (input.incomplete && (!completed || sceneContentSignature(input.scenes) === input.incompleteSignature)) throw new Error('部分输出仍须编辑补齐，并明确勾选核对后保存')
  input.scenes = normalizeScenePlans(input.scenes, input.chapterPlanId, crypto.randomUUID(), characterIds)
  const revision = await saveVersion(input, 'author', true, owner, forceNew)
  if (!scopeCurrent(owner, planId)) return
  openRevision(revision); await checkpointEditor(); notice.value = '作者方案版本已保存，尚未替换正式场景'
}
async function saveAsNewOption() { await operate(() => saveAuthorVersion(true)) }
async function saveScenes(confirm: boolean) {
  await operate(async () => {
    if (!confirm) { await saveAuthorVersion(false); return }
    if (chapterDirty.value || incomplete.value || scenesDirty.value || !selectedRevision.value) throw new Error('请先确认章计划，并补齐保存当前场景方案版本')
    const owner = formOwner, planId = formPlanId, baseline = formBaseline.value
    const edit: ScenePlanningEdit = { action: 'scenes', planId, scenes: clone(scenes.value), confirm: true, revisionId: selectedRevision.value.id }
    await checkpointEditor()
    await persist(edit, owner, planId, baseline)
    notice.value = '本方案已批准，正式场景及相关审核状态已按事务更新'
  })
}
async function recoverOutput(id: string) {
  await operate(async () => {
    const owner = formOwner, planId = formPlanId
    const attempt = recovery.value.attempts.find(row => row.id === id && row.chapterPlanId === selectedId.value)
    if (!attempt) throw new Error('原请求不存在')
    await checkpointEditor()
    if (!scopeCurrent(owner, planId)) return
    let recovered: ScenePlan[]
    try { recovered = parseScenePlanningOutput(attempt.output, attempt.chapterPlanId, crypto.randomUUID(), props.novel.characters.map(row => row.id)) }
    catch { recovered = recoverPartialScenePlans(attempt.output, attempt.chapterPlanId, crypto.randomUUID(), props.novel.characters.map(row => row.id)) }
    suppress = true
    chapterForm.value = clone(attempt.input.chapter); scenes.value = recovered; instructions.value = attempt.input.instructions
    optionTitle.value = attempt.input.title + ' · 输出恢复'; optionId.value = undefined; revisionId.value = undefined
    incomplete.value = true; incompleteSignature.value = sceneContentSignature(recovered); authorCompleted.value = false; formBaseline.value = attempt.baseline; editorId = crypto.randomUUID(); editorSequence = 0
    suppress = false; await checkpointEditor()
    notice.value = recovered.length ? '部分输出已恢复，补齐保存作者版本后才可确认' : '原始输出保留在请求记录中；请添加场景并手工补齐'
  })
}
function cancelGeneration() { cancelEpoch++; interruptReason = ''; controller?.abort(new DOMException('作者取消场景生成', 'AbortError')) }
async function generate(mode: SceneGenerationAttempt['mode'], parentId?: string) {
  if (busy.value || disposed) return
  const epoch = cancelEpoch
  generating.value = true
  generationTask = operate(async () => {
    if (epoch !== cancelEpoch) return
    await runGeneration(mode, parentId)
  })
  await generationTask
  generating.value = false
}
async function runGeneration(mode: SceneGenerationAttempt['mode'], parentId?: string) {
  if (!draft.value || !selectedPlan.value || chapterDirty.value) throw new Error('请先确认本章计划')
  if (baselineConflict.value) throw new Error('规划来源已变化，请先核对并明确关联当前规划')
  const configured = config.getModelForTask('outline')
  if (!configured) throw new Error('请先配置大纲模型')
  const model = { ...configured }, owner = formOwner, planId = formPlanId, baseline = formBaseline.value
  const requestDraft = clone(draft.value), characters = props.novel.characters.map(({ id, name }) => ({ id, name })), epoch = cancelEpoch
  const parent = parentId ? recovery.value.attempts.find(row => row.id === parentId && row.chapterPlanId === planId) : undefined
  if (mode !== 'generate' && !parent) throw new Error('原请求不存在')
  const input = captureEditor()
  if (!input) return
  await queueRecovery(owner, { kind: 'scene-editor', value: input })
  if (!scopeCurrent(owner, planId) || epoch !== cancelEpoch) throw new DOMException('生成准备已中断，输入已保留', 'AbortError')
  // Preserve the current option and unsaved scenes before every regeneration.
  if (input.scenes.length) await saveVersion(input, 'author', !input.incomplete && input.scenes.every(row => !!row.title.trim() && !!row.purpose.trim() && !!row.outputState.trim()), owner, true)
  if (!scopeCurrent(owner, planId) || epoch !== cancelEpoch) throw new DOMException('生成准备已中断，输入已保留', 'AbortError')
  const source = buildScenePlanningPrompt(requestDraft, planId, characters, {
    instructions: input.instructions, scenes: input.scenes, alternatives: recoveryOptions.value.map(option => recovery.value.revisions.find(row => row.id === option.revisionId)!)
      .filter(Boolean).slice(-3).map(row => ({ title: row.title, scenes: row.scenes })),
  })
  const messages = applySkillInstructions([{ role: 'user', content: source }], config.getSkillPrompt('planning'))
  if (mode === 'continue' && parent) messages.push({ role: 'user', content: '参考上次保留的部分输出，补齐并重新输出完整 scenes JSON 对象；不要只输出剩余片段。仍遵守本次已确认章计划。\n' + parent.output })
  const request: SceneGenerationAttempt = { id: crypto.randomUUID(), chapterPlanId: planId, parentAttemptId: parent?.id, mode, status: 'queued', sequence: 0,
    baseline, modelId: model.id, modelSettings: { modelName: model.modelName, maxTokens: model.maxTokens, temperature: model.temperature, topP: model.topP },
    messages, input, output: '', createdAt: now(), updatedAt: now() }
  let activity: AiActivity | undefined, checkpoint = Promise.resolve(), checkpointError: unknown, timer: ReturnType<typeof setTimeout> | undefined, responseRecorded = false
  const abort = new AbortController(); controller = abort; interruptReason = ''; activeAttempt = request
  generating.value = true; liveOutput.value = ''
  const saveAttempt = () => {
    request.updatedAt = now(); request.sequence++
    checkpoint = queueRecovery(owner, { kind: 'scene-attempt', value: request })
    void checkpoint.catch(cause => { checkpointError = cause; abort.abort(new DOMException('部分输出暂存失败', 'AbortError')) })
    return checkpoint
  }
  try {
    activity = startAiActivity('场景方案生成与恢复保存')
    await saveAttempt(); abort.signal.throwIfAborted()
    if (disposed || props.novel.id !== owner || selectedId.value !== planId || baseline !== currentBaseline.value) throw new Error('请求发出前规划已变化，输入已保留')
    request.status = 'running'; await saveAttempt(); abort.signal.throwIfAborted()
    if (!scopeCurrent(owner, planId) || baseline !== currentBaseline.value) throw new Error('请求发出前规划已变化，未发起模型请求')
    const response = await callAI({ model, messages, taskName: '生成一个场景方案', activityParentId: activity.id,
      noAutomaticRetry: true, stream: true, signal: abort.signal, onChunk: chunk => {
        request.output += chunk
        if (!disposed && props.novel.id === owner && selectedId.value === planId) liveOutput.value = request.output
        if (!timer) timer = setTimeout(() => { timer = undefined; void saveAttempt().catch(() => undefined) }, 350)
      } })
    clearTimeout(timer); timer = undefined; await checkpoint
    if (checkpointError) throw checkpointError
    if (!request.output) request.output = response.content
    else if (response.content.startsWith(request.output)) request.output = response.content
    request.finishReason = response.finishReason
    abort.signal.throwIfAborted()
    let result: ScenePlan[], complete = !response.finishReason || response.finishReason === 'stop'
    try { result = parseScenePlanningOutput(request.output, planId, request.id, characters.map(row => row.id)) }
    catch (cause) { complete = false; request.error = safeAiErrorMessage(cause); result = recoverPartialScenePlans(request.output, planId, request.id, characters.map(row => row.id)) }
    request.status = complete ? 'completed' : 'partial'
    if (disposed || props.novel.id !== owner || selectedId.value !== planId || baseline !== currentBaseline.value) request.status = 'conflict'
    await saveAttempt(); responseRecorded = true; abort.signal.throwIfAborted()
    if (result.length) {
      const candidate = await saveVersion({ ...input, title: input.title + ' · AI ' + (recoveryOptions.value.length + 1), scenes: result,
        optionId: undefined, revisionId: undefined, incomplete: !complete || request.status === 'conflict' }, 'model', complete && request.status === 'completed', owner, true, request.id)
      if (!disposed && props.novel.id === owner && selectedId.value === planId) {
        openRevision(candidate); await checkpointEditor()
      }
    }
    if (scopeCurrent(owner, planId)) notice.value = request.status === 'conflict' ? '规划已变化，输出只保留为候选，请核对原基线'
      : complete ? '新方案已保存，可与其他方案比较；确认前不改变正式场景' : '部分输出和输入已保存，可手工补齐、明确继续或重试'
  } catch (cause) {
    if (!responseRecorded) request.status = abort.signal.aborted ? (disposed || interruptReason ? 'interrupted' : 'cancelled') : 'failed'
    request.error = safeAiErrorMessage(checkpointError || cause, [model.apiKey])
    if (scopeCurrent(owner, planId)) error.value = request.error
  } finally {
    clearTimeout(timer)
    await checkpoint.catch(() => undefined)
    try { await saveAttempt() } catch (cause) { if (!disposed) error.value = '输出尚未落盘，可重试保存：' + safeAiErrorMessage(cause) }
    if (activity) finishAiActivity(activity, checkpointError || (request.error ? new Error(request.error) : undefined))
    if (controller === abort) controller = undefined
    activeAttempt = undefined; generating.value = false; maybeReleaseSaver()
  }
}
onBeforeUnmount(() => {
  if (localChanges.value) void checkpointEditor().catch(() => undefined)
  disposed = true; cancelEpoch++; interruptReason = '离开场景页面'; controller?.abort(new DOMException(interruptReason, 'AbortError'))
  maybeReleaseSaver()
})
</script>
<style scoped>
.scene-planner { display: grid; gap: 16px; max-width: 1100px; }
.scene-planner p { line-height: 1.8; } .partial-output { max-height:300px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; } .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
label { display: grid; gap: 6px; } fieldset { min-inline-size: 0; margin: 14px 0; padding: 16px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-color-card); }
input, textarea, select, button { font: inherit; color: var(--text-color-primary); background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px; padding: 9px; box-sizing: border-box; }
textarea, select { width: 100%; } textarea { resize: vertical; } .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0; }
input, textarea, select { background: var(--bg-color-card); line-height: 1.6; }
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.confirm-action { color: #fff8ef; background: var(--color-primary); border-color: var(--color-primary); }
button { cursor: pointer; } button:disabled { opacity: .5; cursor: default; } small { font-size: .8em; font-weight: normal; } .error { color: var(--color-error); }
@media (max-width: 700px) { .field-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
