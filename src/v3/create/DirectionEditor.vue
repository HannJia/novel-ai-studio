<template>
  <div class="generate-page fade-in" :class="{ 'outline-ready': isDone && !showContractEditor, 'choosing-skeleton': choosingSkeleton }" id="generate-outline-page">
    <!-- 生成动画头部 -->
    <div v-if="!showContractEditor" class="generate-header">
      <h2>{{ !contractConfirmed ? '先确认作品契约' : choosingSkeleton ? '先确认故事骨架' : isDone ? '检查大纲草稿' : generationBusy ? 'AI 正在构思...' : '准备故事规划' }}</h2>
      <p v-if="isDone" class="generate-ready-hint">先检查和调整，再继续规划。</p>
      <p v-if="creationDraft" class="structured-plan-status" role="status">
        结构化创作流程：{{ creationStageLabel }}<span v-if="creationDraft.skeletons.length"> · 已提取 {{ creationDraft.skeletons.length }} 个故事骨架候选</span>
      </p>
      <ol v-if="isDone" class="generation-steps" aria-label="创作进度"><li class="done">✓ 生成大纲</li><li :class="{ active: !acceptingOutline }">2 检查确认</li><li :class="{ active: acceptingOutline }">3 分卷规划</li></ol>
      <p v-if="generationBusy && !hasError" class="generate-hint">
        正在生成候选；已有方向、作者输入和输出记录会保留。
      </p>
      <p v-if="hasError" class="generate-error">{{ errorMessage }}</p>
    </div>
    <p v-if="showContractEditor && hasError" class="generate-error" role="alert">{{ errorMessage }}</p>

    <StoryContractEditor v-if="creationDraft && (!contractConfirmed || editingContract)" :contract="contractInput || creationDraft.contract"
      :exploration="contractExploration" :flush="flushContractRecovery" :busy="initializing || contractBusy || generationBusy || acceptingOutline"
      :cancelable="editingContract && contractConfirmed"
      @change="changeContractInput" @exploring="setContractExploring" @save="saveContract" @confirm="confirmContract" @cancel="editingContract = false" />
    <n-button v-else-if="contractConfirmed" :disabled="generationBusy || acceptingOutline || editingOutline" @click="openContractEditor">查看或修改作品契约</n-button>
    <CreationEntrySource v-if="creationDraft?.initialInput && creationDraft.initialInput.method !== 'custom'" :input="creationDraft.initialInput" />

    <StorySkeletonPicker v-if="choosingSkeleton && creationDraft"
      :skeletons="skeletonOptions" :selected-id="selectedSkeletonId"
      :confirmed-id="skeletonConfirmed ? creationDraft.selectedSkeletonId : undefined" :dirty="!!skeletonDraft"
      :busy="generationBusy || contractBusy || acceptingOutline" :has-outline="isDone" @select="selectSkeleton" @edit="editSkeleton" @confirm="confirmSkeletonAndGenerate"
      @save="saveSkeleton" @create="createSkeleton" @mix="mixSkeletons" @regenerate="requestSkeletonGeneration()" />
    <StorySkeletonHistory v-if="creationDraft && !editingContract" :history="creationDraft.skeletonHistory || []" :attempts="creationDraft.skeletonAttempts || []"
      :busy="generationBusy || contractBusy || acceptingOutline" @restore="restoreSkeleton" @recover="recoverSkeletonOutput"
      @retry="id => requestSkeletonGeneration('retry', id)" @continue="id => requestSkeletonGeneration('continue', id)" />
    <section v-if="creationDraft?.editorDrafts?.length" class="paper-panel recovery-panel" aria-label="暂存输入恢复">
      <h3>作者暂存输入</h3><p>包含未保存为候选的修改与冲突草稿；恢复保留原打开基线。</p>
      <button v-for="draft in creationDraft.editorDrafts" :key="draft.id" :disabled="generationBusy || contractBusy" @click="restoreEditorDraft(draft)">恢复 {{ draft.updatedAt }} 的输入（{{ draft.savedAt ? '已保存版本' : '未提交' }}）</button>
      <n-button :disabled="generationBusy || contractBusy" @click="rebindEditorDraft">已核对当前设定，另存输入草稿</n-button>
    </section>
    <n-button v-if="contractConfirmed && !editingContract && !generationBusy && !isDone && !creationDraft?.skeletons.length"
      :disabled="contractBusy" @click="requestSkeletonGeneration()">生成故事骨架候选</n-button>
    <n-button v-if="generationBusy" @click="cancelGeneration">停止生成并保留输出</n-button>
    <n-button v-if="skeletonConfirmed && !generationBusy && !isDone" @click="startGenerate">按已确认方向生成大纲</n-button>
    <section v-if="contractConfirmed && !editingContract && !generationBusy && !isDone" class="manual-outline paper-panel" aria-label="手动准备大纲">
      <h3>已有大纲或手动设计</h3>
      <p>可以粘贴已有大纲，或直接写下故事前提、分卷方向和结局，再检查提取出的故事骨架。</p>
      <n-input v-model:value="manualOutline" type="textarea" :rows="10" aria-label="手写或粘贴大纲" placeholder="例如：## 小说简介、## 第一卷、## 结局方向" />
      <n-button :disabled="!manualOutline.trim() || contractBusy" @click="saveManualOutline">保存大纲并核对骨架</n-button>
    </section>

    <!-- 流式输出内容 -->
    <div class="output-container paper-panel" v-if="!showContractEditor && (streamContent || isDone || editingOutline)">
      <div v-if="isDone || editingOutline" class="outline-edit-toolbar" role="toolbar" aria-label="大纲编辑操作">
        <h3>大纲草稿 <span>已生成</span></h3>
        <span v-if="acceptingOutline" class="outline-edit-status" role="status">正在规划分卷，完成后可在工作区编辑大纲</span>
        <n-button v-if="!editingOutline" :disabled="acceptingOutline || generationBusy || contractBusy" @click="startOutlineEdit">
          <template #icon><n-icon><create-outline /></n-icon></template>编辑大纲
        </n-button>
        <template v-else>
          <n-button :disabled="contractBusy" @click="editingOutline = false">取消修改</n-button>
          <n-button type="primary" :loading="contractBusy" :disabled="contractBusy || generationBusy || !outlineDraft.trim()" @click="saveOutlineEdit">
            <template #icon><n-icon><save-outline /></n-icon></template>保存修改
          </n-button>
        </template>
      </div>
      <div class="outline-output-scroll" tabindex="0" aria-label="大纲正文">
        <n-input v-if="editingOutline" v-model:value="outlineDraft" :disabled="contractBusy || generationBusy" type="textarea" :rows="24" aria-label="编辑生成的大纲" />
        <div v-else class="output-content" v-html="renderedContent"></div>
        <div v-if="generationBusy && !hasError" class="typing-cursor">▌</div>
      </div>
    </div>

    <section v-if="!showContractEditor && isDone && skeletonConfirmed && selectedSkeleton" class="skeleton-candidates paper-panel" aria-label="已确认故事骨架">
      <div class="skeleton-candidates-header">
        <div><h3>已确认方向：{{ selectedSkeleton.title }}</h3><p>{{ selectedSkeleton.logline }}</p></div>
      </div>
    </section>

    <!-- 操作按钮 -->
    <div class="generate-actions" v-if="!showContractEditor && isDone">
      <p>作品名称：{{ creationDraft?.contract.title }}（可在作品契约中修改）</p>
      <n-button @click="regenerate" size="large" :disabled="acceptingOutline || editingOutline || editingContract || !skeletonConfirmed">重新生成</n-button>
      <n-button type="primary" size="large" :loading="acceptingOutline" :disabled="acceptingOutline || generationBusy || contractBusy || editingOutline || editingContract || !skeletonConfirmed || !visibleOutlineContent || creationDraft?.outlineCandidate?.complete === false" @click="acceptOutline">确认并规划分卷</n-button>
    </div>

    <div class="generate-actions" v-if="hasError">
      <n-button @click="$router.push('/')" size="large">返回书架</n-button>
      <n-button @click="$router.push('/settings')" size="large">检查设置</n-button>
      <n-button v-if="skeletonConfirmed" type="primary" @click="startGenerate" size="large" :disabled="generationBusy">重试大纲生成</n-button>
      <n-button :disabled="generationBusy || contractBusy" @click="retryRecoverySaves">重试保存保留的输入与输出</n-button>
    </div>

    <!-- 未配置提示 -->
    <div class="no-config-hint" v-if="!configStore.isConfigured && !streamContent && !hasError">
      <n-alert type="warning" title="未配置 AI 模型">
        请先在设置页面配置接口密钥才能使用 AI 功能。<br><br>
        <n-button size="small" @click="$router.push('/settings')">前往设置</n-button>
      </n-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NAlert, NInput, NIcon, useMessage } from 'naive-ui'
import { CreateOutline, SaveOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useConfigStore } from '@/stores/config'
import { callAI, applySkillInstructions } from '@/services/ai'
import { startAiActivity, finishAiActivity, activeAiCount, type AiActivity } from '@/services/aiActivity'
import { registerDraftSaver, type DraftFlushToken } from '@/services/appLifecycle'
import { skeletonCompletionIssues } from '@/services/creationDraft'
import { buildOutlinePrompt } from '@/services/prompts'
import { renderMd } from '@/utils/markdown'
import { buildConfirmedSkeletonConstraint, buildPlotSkeletonPrompt } from '@/services/reconstructionCreation'
import type { CreationEdit } from '@/services/creationTransactions'
import { safeAiErrorMessage, structuredOutputDiagnostic } from '@/services/aiDiagnostics'
import { parsePlotSkeletonResponse, recoverPartialSkeletons } from '@/services/plotSkeletonResponse'
import StorySkeletonPicker from '@/components/StorySkeletonPicker.vue'
import StorySkeletonHistory from '@/components/StorySkeletonHistory.vue'
import StoryContractEditor from '@/components/StoryContractEditor.vue'
import CreationEntrySource from '@/components/CreationEntrySource.vue'
import type { PlotSkeleton, StoryContract, ContractExploration, CreationEditorDraft, SkeletonGenerationAttempt, SkeletonSourceSelection } from '@/types/reconstruction'

const route = useRoute()
const emit = defineEmits<{ step: [value: number] }>()
const router = useRouter()
const novelStore = useNovelStore()
const reconstructionWorkspaceStore = useReconstructionWorkspaceStore()
const configStore = useConfigStore()
const message = useMessage()

const novelId = route.params.novelId as string
const novel = computed(() => novelStore.getNovel(novelId))
const creationDraft = computed(() => reconstructionWorkspaceStore.getCreationDraft(novelId))
const skeletonDraft = ref<PlotSkeleton>()
const selectedSkeletonId = computed(() => skeletonDraft.value?.id || creationDraft.value?.editingSkeletonId || creationDraft.value?.selectedSkeletonId)
const skeletonOptions = computed(() => {
  const pending = skeletonDraft.value
  return creationDraft.value?.skeletons.map(item => pending && item.id === pending.id ? pending : item) || []
})
const selectedSkeleton = computed(() => creationDraft.value?.skeletons.find(item => item.id === creationDraft.value?.selectedSkeletonId))
const editingContract = ref(false)
const initializing = ref(true)
const contractBusy = ref(false)
const contractInput = ref<StoryContract>()
const contractExploration = ref<ContractExploration>({ input: '', messages: [] })
const contractExploring = ref(false)
let contractBaseline = ''
let contractSessionId: string = crypto.randomUUID()
const contractConfirmed = computed(() => creationDraft.value?.approval.contract === 'approved' && creationDraft.value?.contract.approval === 'approved')
const showContractEditor = computed(() => !!creationDraft.value && (!contractConfirmed.value || editingContract.value))
const skeletonConfirmed = computed(() => contractConfirmed.value && creationDraft.value?.approval.skeleton === 'approved' && selectedSkeleton.value?.approval === 'approved')
const choosingSkeleton = computed(() => contractConfirmed.value && !editingContract.value)
const creationStageLabel = computed(() => ({
  contract: '作品契约', skeleton: '故事骨架', 'volume-outline': '卷级大纲', 'chapter-outline': '章节大纲', 'scene-outline': '场景设计', ready: '可以开始写作',
}[creationDraft.value?.stage || 'skeleton']))

let pageBaseline = ''
let skeletonEditBaseline = ''
async function commitCreation(edit: CreationEdit, baseline = pageBaseline) {
  const result = await reconstructionWorkspaceStore.commitCreationEdit(novelId, edit, baseline)
  pageBaseline = result.baseline
  return result
}
function openContractEditor() {
  pageBaseline = reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)
  editingContract.value = true
}

const streamContent = ref('')
const isDone = ref(false)
const hasError = ref(false)
const errorMessage = ref('')
const acceptingOutline = ref(false)
const editingOutline = ref(false)
const outlineDraft = ref('')
const generationBusy = ref(false)
const manualOutline = ref('')
let abortController: AbortController | null = null
let disposed = false
let editorReady = false
let editorSessionId: string = crypto.randomUUID()
let editorBaseline = ''
let skeletonSessionId: string = crypto.randomUUID()
let manualSessionId: string = crypto.randomUUID()
let manualBaseline = ''
let editorWrite: Promise<unknown> = Promise.resolve()
const pendingEditors = new Map<string, CreationEditorDraft>()
const pendingAttempts = new Map<string, SkeletonGenerationAttempt>()
watch(() => showContractEditor.value ? 1 : isDone.value ? 3 : 2, value => emit('step', value), { immediate: true })
function setContractExploring(value: boolean) {
  contractExploring.value = value
  if (disposed && !value && !generationBusy.value && !pendingEditors.size && !pendingAttempts.size) unregisterDraftSaver()
}
function changeContractInput(contract: StoryContract, exploration?: ContractExploration) {
  if (initializing.value) return
  contractInput.value = JSON.parse(JSON.stringify(contract))
  if (exploration) contractExploration.value = JSON.parse(JSON.stringify(exploration))
  contractBaseline ||= pageBaseline
  void queueEditorDraft({ id: contractSessionId, surface: 'contract', baseline: contractBaseline, contract: contractInput.value,
    exploration: contractExploration.value, manualOutline: '', outlineText: '', updatedAt: new Date().toISOString() }).catch(() => undefined)
}
async function flushContractRecovery() { await editorWrite }
async function queueAttempt(attempt: SkeletonGenerationAttempt, token?: DraftFlushToken) {
  const snapshot = JSON.parse(JSON.stringify(attempt)) as SkeletonGenerationAttempt
  pendingAttempts.set(snapshot.id, snapshot)
  await reconstructionWorkspaceStore.saveCreationRecovery(novelId, { kind: 'attempt', value: snapshot }, token)
  if (pendingAttempts.get(snapshot.id) === snapshot) pendingAttempts.delete(snapshot.id)
  if (disposed && !generationBusy.value && !contractExploring.value && !pendingEditors.size && !pendingAttempts.size) unregisterDraftSaver()
}
function queueEditorDraft(draft: CreationEditorDraft, token?: DraftFlushToken) {
  pendingEditors.set(draft.id, draft)
  editorWrite = reconstructionWorkspaceStore.saveCreationRecovery(novelId, { kind: 'editor', value: draft }, token).then(() => {
    if (pendingEditors.get(draft.id) === draft) pendingEditors.delete(draft.id)
    if (disposed && !generationBusy.value && !contractExploring.value && !pendingEditors.size && !pendingAttempts.size) unregisterDraftSaver()
  }).catch(error => {
    if (!disposed) { hasError.value = true; errorMessage.value = '输入暂存失败：' + safeAiErrorMessage(error) }
    throw error
  })
  void editorWrite.catch(() => undefined)
  return editorWrite
}
const unregisterDraftSaver = registerDraftSaver(async token => {
  do {
    await editorWrite.catch(() => undefined)
    let failure: unknown
    for (const [id, draft] of [...pendingEditors]) if (pendingEditors.get(id) === draft) {
      try { await queueEditorDraft(draft, token) } catch (error) { failure ||= error }
    }
    for (const [id, attempt] of [...pendingAttempts]) if (pendingAttempts.get(id) === attempt) {
      try { await queueAttempt(attempt, token) } catch (error) { failure ||= error }
    }
    if (failure) throw failure
  } while (pendingEditors.size || pendingAttempts.size)
  if (disposed && !generationBusy.value && !contractExploring.value) unregisterDraftSaver()
})
watch(skeletonDraft, () => {
  if (!editorReady || disposed) return
  if (skeletonDraft.value) void queueEditorDraft({ id: skeletonSessionId, surface: 'skeleton', baseline: skeletonEditBaseline,
    skeleton: skeletonDraft.value, manualOutline: '', outlineText: '', updatedAt: new Date().toISOString() }).catch(() => undefined)
}, { deep: true, flush: 'sync' })
watch(manualOutline, () => {
  if (!editorReady || disposed) return
  manualBaseline ||= pageBaseline
  void queueEditorDraft({ id: manualSessionId, surface: 'manual-outline', baseline: manualBaseline,
    manualOutline: manualOutline.value, outlineText: '', updatedAt: new Date().toISOString() }).catch(() => undefined)
}, { flush: 'sync' })
watch(outlineDraft, () => {
  if (!editorReady || disposed) return
  editorBaseline ||= pageBaseline
  void queueEditorDraft({ id: editorSessionId, surface: 'outline', baseline: editorBaseline,
    manualOutline: '', outlineText: outlineDraft.value, updatedAt: new Date().toISOString() }).catch(() => undefined)
}, { flush: 'sync' })
async function markEditorSaved(id: string) {
  const current = creationDraft.value?.editorDrafts?.find(item => item.id === id)
  if (current) {
    try { await queueEditorDraft({ ...current, savedAt: new Date().toISOString() }) }
    catch { message.warning('候选版本已经保存；暂存记录的完成标记尚未落盘，可重试保存') }
  }
}
function restoreEditorDraft(draft: CreationEditorDraft, fork = true) {
  if (generationBusy.value || contractBusy.value || contractExploring.value) return
  editorReady = false
  if (draft.contract) {
    contractSessionId = fork ? crypto.randomUUID() : draft.id; contractBaseline = draft.baseline
    contractInput.value = JSON.parse(JSON.stringify(draft.contract))
    contractExploration.value = JSON.parse(JSON.stringify(draft.exploration || { input: '', messages: [] }))
    for (const item of contractExploration.value.messages) if (item.status === 'running') item.status = 'interrupted'
    editingContract.value = true
  }
  if (draft.skeleton) {
    skeletonSessionId = fork ? crypto.randomUUID() : draft.id; skeletonEditBaseline = draft.baseline
    skeletonDraft.value = JSON.parse(JSON.stringify(draft.skeleton))
  }
  if (draft.surface === 'manual-outline' || draft.manualOutline) {
    manualSessionId = fork ? crypto.randomUUID() : draft.id; manualBaseline = draft.baseline; manualOutline.value = draft.manualOutline
  }
  if (draft.surface === 'outline' || draft.outlineText) {
    editorSessionId = fork ? crypto.randomUUID() : draft.id; editorBaseline = draft.baseline; outlineDraft.value = draft.outlineText
    editingOutline.value = !!draft.outlineText
  }
  editorReady = true
}
async function rebindEditorDraft() {
  if (generationBusy.value || contractBusy.value || contractExploring.value || acceptingOutline.value) return
  await editorWrite.catch(() => undefined)
  pageBaseline = reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)
  editorSessionId = crypto.randomUUID(); skeletonSessionId = crypto.randomUUID(); manualSessionId = crypto.randomUUID()
  editorBaseline = pageBaseline; skeletonEditBaseline = pageBaseline; manualBaseline = pageBaseline
  contractBaseline = pageBaseline; contractSessionId = crypto.randomUUID()
  try {
    if (contractInput.value) changeContractInput(contractInput.value)
    await editorWrite
    if (skeletonDraft.value) await queueEditorDraft({ id: skeletonSessionId, surface: 'skeleton', baseline: pageBaseline, skeleton: skeletonDraft.value, manualOutline: '', outlineText: '', updatedAt: new Date().toISOString() })
    if (manualOutline.value) await queueEditorDraft({ id: manualSessionId, surface: 'manual-outline', baseline: pageBaseline, manualOutline: manualOutline.value, outlineText: '', updatedAt: new Date().toISOString() })
    if (outlineDraft.value) await queueEditorDraft({ id: editorSessionId, surface: 'outline', baseline: pageBaseline, manualOutline: '', outlineText: outlineDraft.value, updatedAt: new Date().toISOString() })
    hasError.value = false
  }
  catch (error) { message.error(safeAiErrorMessage(error)) }
}
async function retryRecoverySaves() {
  if (generationBusy.value || contractBusy.value) return
  try {
    for (const draft of [...pendingEditors.values()]) await queueEditorDraft(draft)
    for (const attempt of [...pendingAttempts.values()]) await queueAttempt(attempt)
    hasError.value = false; message.success('保留的输入与输出已保存')
  } catch (error) { message.error(safeAiErrorMessage(error)) }
}
function cancelGeneration() { abortController?.abort(new DOMException('作者停止生成', 'AbortError')) }

// Markdown 渲染
const visibleOutlineContent = computed(() => sanitizeOutlineContent(streamContent.value))
const renderedContent = computed(() => renderMd(visibleOutlineContent.value))

async function storeContract(contract: StoryContract, confirm: boolean) {
  if (initializing.value || !creationDraft.value || contractBusy.value || contractExploring.value || generationBusy.value || acceptingOutline.value) return
  contractBusy.value = true
  try {
    await editorWrite
    await commitCreation({ action: 'contract', contract, confirm }, contractBaseline || pageBaseline)
    await markEditorSaved(contractSessionId)
    contractInput.value = JSON.parse(JSON.stringify(creationDraft.value.contract))
    contractBaseline = pageBaseline; contractSessionId = crypto.randomUUID()
    if (confirm) {
      editingContract.value = false
      hasError.value = false
    }
    message.success(confirm ? '作品契约已确认' : '作品契约草稿已保存')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '作品契约保存失败')
  } finally {
    contractBusy.value = false
  }
}
function saveContract(contract: StoryContract) { return storeContract(contract, false) }
function confirmContract(contract: StoryContract) { return storeContract(contract, true) }

async function saveManualOutline() {
  if (!novel.value || !creationDraft.value || !contractConfirmed.value || contractBusy.value || generationBusy.value || !manualOutline.value.trim()) return
  contractBusy.value = true
  try {
    const text = sanitizeOutlineContent(manualOutline.value)
    if (!text) throw new Error('请填写有效的大纲内容')
    await editorWrite
    await commitCreation({ action: 'outline-candidate', content: text, source: 'author', importSkeleton: true }, manualBaseline || pageBaseline)
    await markEditorSaved(manualSessionId)
    streamContent.value = text
    isDone.value = true
    hasError.value = false
    message.success('大纲已保存，请核对故事骨架')
  } catch (error) { message.error(error instanceof Error ? error.message : '大纲保存失败') }
  finally { contractBusy.value = false }
}

function sanitizeOutlineContent(text: string): string {
  return text
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis[\s\S]*?<\/analysis>/gi, '')
    .replace(/<reasoning[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<thinking[\s\S]*$/i, '')
    .replace(/<think[\s\S]*$/i, '')
    .replace(/<analysis[\s\S]*$/i, '')
    .replace(/<reasoning[\s\S]*$/i, '')
    .replace(/^\s*(?:thinking|analysis|reasoning)\s*[:：][\s\S]*?(?=\n#{1,3}\s|\n(?:一句话概括|推荐书名|小说简介|主线剧情走向|主要角色表|核心冲突|分卷建议|预估总字数|全书伏笔)|$)/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isOutlineComplete(text: string): boolean {
  const clean = sanitizeOutlineContent(text)
  const requiredPatterns = [
    /推荐书名/,
    /小说简介/,
    /主线剧情走向/,
    /主要角色表/,
    /核心冲突/,
    /分卷建议/,
    /预估总字数分配|总字数分配/,
    /全书伏笔|伏笔线|伏笔设计/,
  ]
  return requiredPatterns.every(pattern => pattern.test(clean))
}

async function selectSkeleton(skeletonId: string) {
  if (generationBusy.value || contractBusy.value) return
  if (skeletonDraft.value) { message.warning('请先保存当前作者版本，输入也已留在暂存记录中'); return }
  await actOnSkeleton({ action: 'skeleton', selectedId: skeletonId })
}
function editSkeleton(skeleton: PlotSkeleton) {
  if (generationBusy.value || contractBusy.value) return
  if (!skeletonDraft.value) { skeletonEditBaseline = pageBaseline; skeletonSessionId = crypto.randomUUID() }
  skeletonDraft.value = JSON.parse(JSON.stringify(skeleton))
}
async function saveSkeleton() {
  if (generationBusy.value || contractBusy.value) return
  const pending = skeletonDraft.value || skeletonOptions.value.find(item => item.id === selectedSkeletonId.value)
  if (!pending) return
  contractBusy.value = true
  try {
    await editorWrite
    const complete = skeletonCompletionIssues({ ...pending, complete: true }).length === 0
    await commitCreation({ action: 'skeleton', selectedId: pending.id, skeleton: { ...pending, complete }, authorComplete: complete }, skeletonDraft.value ? skeletonEditBaseline : pageBaseline)
    await markEditorSaved(skeletonSessionId)
    skeletonEditBaseline = pageBaseline; skeletonDraft.value = undefined
    hasError.value = false; message.success(complete ? '作者版本已保存，可以确认故事方向' : '未完成的作者版本已保存，补齐后才能确认')
  } catch (error) { hasError.value = true; errorMessage.value = safeAiErrorMessage(error); message.error(errorMessage.value) }
  finally { contractBusy.value = false }
}
async function actOnSkeleton(edit: CreationEdit) {
  if (generationBusy.value || contractBusy.value || acceptingOutline.value) return
  if (skeletonDraft.value) { message.warning('请先保存当前作者版本，再切换或添加候选'); return }
  contractBusy.value = true
  try { await editorWrite; await commitCreation(edit); hasError.value = false }
  catch (error) { hasError.value = true; errorMessage.value = safeAiErrorMessage(error); message.error(errorMessage.value) }
  finally { contractBusy.value = false }
}
function createSkeleton() { return actOnSkeleton({ action: 'new-skeleton' }) }
function mixSkeletons(sources: SkeletonSourceSelection[]) { return actOnSkeleton({ action: 'mix-skeleton', sources }) }
function restoreSkeleton(revisionId: string) { return actOnSkeleton({ action: 'restore-skeleton', revisionId }) }
function recoverSkeletonOutput(attemptId: string) { return actOnSkeleton({ action: 'recover-skeleton-output', attemptId }) }
async function confirmSkeletonAndGenerate() {
  if (!creationDraft.value || generationBusy.value || contractBusy.value) return
  if (skeletonDraft.value) { message.warning('请先明确保存作者版本'); return }
  contractBusy.value = true
  try {
    await editorWrite
    await commitCreation({ action: 'confirm-skeleton' })
    message.success('正式故事方向已确认；需要 AI 展开时请点击生成大纲')
  } catch (error) { message.error(safeAiErrorMessage(error, configStore.models.map(model => model.apiKey))) }
  finally { contractBusy.value = false }
}


async function requestSkeletonGeneration(mode: SkeletonGenerationAttempt['mode'] = 'generate', parentId?: string) {
  if (disposed || generationBusy.value || contractBusy.value || acceptingOutline.value) return
  if (!novel.value || !creationDraft.value || !contractConfirmed.value || editingContract.value) { message.warning('请先确认作品契约'); return }
  const configured = configStore.getModelForTask('outline')
  const model = configured ? { ...configured } : undefined
  if (!model) { message.warning('请先配置大纲模型；手写与混合方案无需模型'); return }
  let activity: AiActivity | undefined, attempt: SkeletonGenerationAttempt | undefined
  let checkpoint: Promise<void> = Promise.resolve(), checkpointError: unknown
  let timer: ReturnType<typeof setTimeout> | undefined
  let committed = false
  const controller = new AbortController(); abortController = controller
  const persistAttempt = () => {
    if (!attempt) return Promise.resolve()
    attempt.updatedAt = new Date().toISOString()
    checkpoint = queueAttempt(attempt)
    void checkpoint.catch(error => { checkpointError = error; controller.abort(new DOMException('输出暂存失败，已停止生成', 'AbortError')) })
    return checkpoint
  }
  try {
    activity = startAiActivity('骨架生成与恢复保存')
    generationBusy.value = true; hasError.value = false
    await editorWrite
    if (pageBaseline !== reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)) throw new Error('作品设定或候选已变化，请核对当前设定后再发起请求；暂存输入仍保留')
    const parent = parentId ? creationDraft.value.skeletonAttempts?.find(item => item.id === parentId) : undefined
    if (mode !== 'generate' && !parent) throw new Error('原请求不存在')
    const messages = applySkillInstructions([
      { role: 'system', content: '你是长篇小说结构编辑，只输出严格 JSON。所有结果都是待作者确认的候选。' },
      { role: 'user', content: buildPlotSkeletonPrompt(creationDraft.value.contract) },
    ], configStore.getSkillPrompt('planning'))
    if (parent && mode === 'continue') messages.push({ role: 'user', content: '下面是上次保留的部分输出。请参考已有方向补齐，重新输出完整可解析的 skeletons JSON 对象（包含所有字段和关键节点）。原输出仅作参考，仍须遵守本次作品契约。\n' + parent.output })
    const now = new Date().toISOString()
    attempt = { id: crypto.randomUUID(), parentAttemptId: parent?.id, mode, status: 'queued', baseline: pageBaseline, modelId: model.id,
      modelSettings: { modelName: model.modelName, maxTokens: model.maxTokens, temperature: model.temperature, topP: model.topP },
      messages, output: '', candidateIds: [], createdAt: now, updatedAt: now }
    await persistAttempt()
    controller.signal.throwIfAborted()
    if (attempt.baseline !== reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)) throw new Error('请求准备期间设定变化，未发送请求')
    attempt.status = 'running'; await persistAttempt()
    controller.signal.throwIfAborted()
    if (attempt.baseline !== reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)) throw new Error('请求发出前设定变化，未发送请求')
    const response = await callAI({ model: { ...model }, messages: attempt.messages, taskName: '生成故事骨架候选', activityParentId: activity.id,
      noAutomaticRetry: true, stream: true, signal: controller.signal, onChunk: chunk => {
        attempt!.output += chunk
        if (!timer) timer = setTimeout(() => { timer = undefined; void persistAttempt().catch(() => undefined) }, 350)
      } })
    clearTimeout(timer); timer = undefined; await checkpoint
    if (checkpointError) throw checkpointError
    if (!attempt.output) attempt.output = response.content
    attempt.finishReason = response.finishReason
    let candidates: PlotSkeleton[]
    try { candidates = parsePlotSkeletonResponse(novel.value!, { ...response, content: attempt.output }, new Date().toISOString()) }
    catch (error) { attempt.error = safeAiErrorMessage(error); candidates = recoverPartialSkeletons(novel.value!, attempt.output, new Date().toISOString()) }
    const complete = candidates.length > 0 && candidates.every(item => item.complete !== false) && (!response.finishReason || response.finishReason === 'stop')
    attempt.status = complete ? 'completed' : 'partial'
    await persistAttempt()
    controller.signal.throwIfAborted()
    if (disposed) throw new DOMException('页面已离开', 'AbortError')
    candidates = candidates.map((item, index) => ({ ...item, id: 'skeleton:' + attempt!.id + ':' + index,
      beats: item.beats.map((beat, beatIndex) => ({ ...beat, id: 'beat:' + attempt!.id + ':' + index + ':' + beatIndex })), complete: complete && item.complete !== false }))
    if (candidates.length) {
      try { await commitCreation({ action: 'skeleton-candidates', candidates, attemptId: attempt.id }, attempt.baseline); committed = true }
      catch (error) { attempt.status = 'conflict'; throw error }
    }
    if (!complete) { hasError.value = true; errorMessage.value = '部分输出已保留；可明确续作、重试，或恢复后手工补齐并保存。' }
  } catch (error) {
    if (attempt) {
      if (attempt.status !== 'conflict') attempt.status = controller.signal.aborted ? (disposed ? 'interrupted' : 'cancelled') : 'failed'
      attempt.error = safeAiErrorMessage(checkpointError || error, configStore.models.map(item => item.apiKey))
    }
    if (!disposed) { hasError.value = true; errorMessage.value = attempt?.error || safeAiErrorMessage(error) }
  } finally {
    clearTimeout(timer)
    try {
      await checkpoint.catch(() => undefined)
      if (attempt && !committed) await persistAttempt()
    } catch (error) { if (!disposed) { hasError.value = true; errorMessage.value = '输出保存未完成，请重试保存：' + safeAiErrorMessage(error) } }
    if (activity) finishAiActivity(activity, checkpointError)
    generationBusy.value = false
    if (disposed && !pendingEditors.size && !pendingAttempts.size) unregisterDraftSaver()
  }
}

async function startGenerate() {
  if (disposed || acceptingOutline.value || generationBusy.value || contractBusy.value) return
  if (!contractConfirmed.value || editingContract.value) { message.warning('请先确认作品契约'); return }
  if (!skeletonConfirmed.value) { message.warning('请先保存并确认一个故事骨架；生成新骨架请使用候选区按钮'); return }
  if (!novel.value) {
    message.error('找不到小说数据')
    return
  }
  if (pageBaseline !== reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)) {
    message.warning('作品契约、规划或相关设定已经变化，请重新打开核对后再生成')
    return
  }

  const model = configStore.getModelForTask('outline')
  if (!model) {
    hasError.value = true
    errorMessage.value = '未配置 AI 模型，请先在设置页面添加模型配置。'
    return
  }

  abortController?.abort()
  editingOutline.value = false
  hasError.value = false
  errorMessage.value = ''
  abortController = new AbortController()
  generationBusy.value = true
  let generated = ''
  const outlineRequestDraftId = crypto.randomUUID()
  const requestBaseline = pageBaseline
  let outlineCheckpointTimer: ReturnType<typeof setTimeout> | undefined
  let outlineAccepted = false
  const saveOutlinePartial = () => queueEditorDraft({ id: outlineRequestDraftId, surface: 'outline', baseline: requestBaseline,
    manualOutline: '', outlineText: generated, savedAt: outlineAccepted ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() })
  let activity: AiActivity | undefined

  try {
    activity = startAiActivity('大纲生成与草稿保存')
    await editorWrite
    abortController.signal.throwIfAborted()
    if (disposed) return
    if (!skeletonConfirmed.value) return
    if (requestBaseline !== reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)) throw new Error('生成前设定发生变化，请重新核对；原有输入已保留')
    const messages = buildOutlinePrompt(novel.value, creationDraft.value)
    messages.push({ role: 'user', content: buildConfirmedSkeletonConstraint(creationDraft.value!) })
    const response = await callAI({
      model, skillTask: 'planning', messages, stream: true, noAutomaticRetry: true,
      signal: abortController.signal,
      activityParentId: activity.id,
      onChunk: chunk => {
        generated += chunk
        // Keep the existing candidate visible until a complete replacement is saved.
        if (!outlineCheckpointTimer) outlineCheckpointTimer = setTimeout(() => {
          outlineCheckpointTimer = undefined
          void saveOutlinePartial().catch(() => abortController?.abort())
        }, 350)
      },
    })
    abortController.signal.throwIfAborted()
    if (disposed) return
    const text = sanitizeOutlineContent(generated || response.content)
    if (!text) throw new Error('大纲未返回可用正文（' + structuredOutputDiagnostic(response) + '）')
    const complete = (!response.finishReason || response.finishReason === 'stop') && isOutlineComplete(text)
    await commitCreation({ action: 'outline-candidate', content: text, source: 'model', complete }, requestBaseline)
    outlineAccepted = complete
    streamContent.value = text
    isDone.value = true
    if (!complete) {
      hasError.value = true
      errorMessage.value = '大纲候选未完整生成，请编辑补齐后保存，或手动重新生成（' + structuredOutputDiagnostic(response) + '）'
    }


  } catch (err: any) {
    if (err.name === 'AbortError') return
    hasError.value = true
    errorMessage.value = safeAiErrorMessage(err, configStore.models.map(model => model.apiKey)) || '生成失败，请检查 API 配置'
  } finally {
    clearTimeout(outlineCheckpointTimer)
    if (generated) {
      try { await saveOutlinePartial() }
      catch (error) { if (!disposed) { hasError.value = true; errorMessage.value = '大纲部分输出尚未落盘：' + safeAiErrorMessage(error) } }
    }
    if (activity) finishAiActivity(activity)
    generationBusy.value = false
    if (disposed && !pendingEditors.size && !pendingAttempts.size) unregisterDraftSaver()
  }
}

function regenerate() {
  startGenerate()
}

function startOutlineEdit() {
  if (acceptingOutline.value || generationBusy.value || contractBusy.value) return
  pageBaseline = reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)
  editorSessionId = crypto.randomUUID(); editorBaseline = pageBaseline
  outlineDraft.value = creationDraft.value?.outlineCandidate?.content || novel.value?.outline || visibleOutlineContent.value
  editingOutline.value = true
}

async function saveOutlineEdit() {
  if (contractBusy.value || acceptingOutline.value || generationBusy.value) return
  const text = sanitizeOutlineContent(outlineDraft.value)
  if (!text) return
  contractBusy.value = true
  try {
    await editorWrite
    await commitCreation({ action: 'outline-candidate', content: text, source: 'author' }, editorBaseline || pageBaseline)
    await markEditorSaved(editorSessionId)
    hasError.value = false
    streamContent.value = text
    editingOutline.value = false
    message.success('大纲已保存，分卷将使用修改后的内容')
  } catch (error) { message.error(error instanceof Error ? error.message : '大纲保存失败') }
  finally { contractBusy.value = false }
}

async function acceptOutline() {
  if (acceptingOutline.value || generationBusy.value || contractBusy.value || editingOutline.value || editingContract.value || !visibleOutlineContent.value) return
  acceptingOutline.value = true
  try {
    await commitCreation({ action: 'accept-outline', content: visibleOutlineContent.value })
    await router.push({ path: '/generate/' + novelId, query: { step: 'volumes' } })
  } catch (error) { message.error(safeAiErrorMessage(error, configStore.models.map(model => model.apiKey))) }
  finally { acceptingOutline.value = false }
}

onMounted(async () => {
  try {
    await reconstructionWorkspaceStore.hydrateFromPersistence(novelId)
    pageBaseline = reconstructionWorkspaceStore.captureCreationEditBaseline(novelId)
    await commitCreation({ action: 'initialize' })
    if (!activeAiCount.value) for (const prior of creationDraft.value?.skeletonAttempts || []) {
      if (prior.status === 'queued' || prior.status === 'running') await queueAttempt({ ...prior, status: 'interrupted',
        error: '上次请求未完成，保留已存输出；由作者明确选择续作或重试。', updatedAt: new Date().toISOString() })
    }
    const saved = creationDraft.value?.outlineCandidate
    const text = saved?.content || (route.query.regenerate !== '1' ? novel.value?.outline : '')
    if (text) { streamContent.value = text; isDone.value = true }
    if (saved?.complete === false) {
      hasError.value = true
      errorMessage.value = '已恢复未完整的大纲候选，请编辑补齐后保存，或手动重新生成'
    }
    // Reopening never starts a new paid request; use an explicit generation action.
    const editors = creationDraft.value?.editorDrafts?.filter(item => !item.savedAt) || []
    const contractEditor = creationDraft.value?.editorDrafts?.filter(item => item.surface === 'contract').slice(-1)[0]
    if (contractEditor?.savedAt && contractEditor.exploration) contractExploration.value = JSON.parse(JSON.stringify(contractEditor.exploration))
    if (contractEditor && !contractEditor.savedAt) restoreEditorDraft(contractEditor, false)
    for (const surface of ['skeleton', 'manual-outline', 'outline'] as const) {
      const editor = editors.filter(item => item.surface === surface || !item.surface).slice(-1)[0]
      if (editor && (editor.skeleton || editor.manualOutline || editor.outlineText && editor.outlineText !== text)) restoreEditorDraft(editor, false)
    }
    // An imported outline only pre-fills the author's manual path; saving it is still an explicit candidate action.
    const imported = creationDraft.value?.initialInput?.outline?.text
    if (imported && !text && !manualOutline.value) manualOutline.value = imported
    editorReady = true
  } catch (error) { message.warning('创作草稿读取失败：' + safeAiErrorMessage(error, configStore.models.map(model => model.apiKey))) }
  finally { initializing.value = false }
})
onUnmounted(() => {
  disposed = true
  abortController?.abort()
  if (!pendingEditors.size && !pendingAttempts.size && !generationBusy.value && !contractExploring.value) unregisterDraftSaver()
})

</script>

<style scoped>

.recovery-panel { width:100%; max-width:1100px; padding:20px; box-sizing:border-box; }
.recovery-panel button { margin:6px; }
.manual-outline { width: 100%; max-width: 1000px; box-sizing: border-box; padding: 24px; }
.manual-outline p { color: var(--ink-2); line-height: 1.8; }
.manual-outline .n-button { margin-top: 16px; }

.generate-hint {
  font-size: 14px;
  color: var(--ink-3);
}

.generate-error {
  font-size: 14px;
  color: var(--zhu);
}

/* 脉冲动画 */

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--zhu);
  opacity: 0;
  animation: pulse 2s ease-out infinite;
}

.delay-1 { animation-delay: 1s; }

@keyframes pulse {
  0% { transform: scale(0.5); opacity: 0.6; }
  100% { transform: scale(1.5); opacity: 0; }
}

.animation-done .pulse-ring {
  animation: none;
  opacity: 0;
}

.ai-icon {
  font-size: 40px;
  z-index: 1;
  animation: bob 2s ease-in-out infinite;
}

.animation-done .ai-icon {
  animation: none;
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* 输出区域 */
.output-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 880px;
  flex: 1 1 auto;
  min-height: 180px;
  max-height: none;
  overflow: hidden;
  padding: 0;
  margin-bottom: 0;
  position: relative;
}

.outline-output-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 28px 32px;
}

.output-content {
  font-size: 15px;
  line-height: 1.85;
  color: var(--ink);
  max-width: 720px;
  margin: 0 auto;
}

.output-content :deep(h2) {
  font-family: var(--f-serif);
  font-size: 21px;
  font-weight: 600;
  margin: 24px 0 12px;
  color: var(--zhu);
}

.output-content :deep(h3) {
  font-size: 17px;
  margin: 16px 0 8px;
  color: var(--ink);
}

.output-content :deep(h4) {
  font-size: 15px;
  margin: 12px 0 6px;
}

.output-content :deep(strong) {
  color: var(--zhu);
}

.output-content :deep(li) {
  margin-left: 20px;
  margin-bottom: 4px;
}

.typing-cursor {
  display: inline;
  color: var(--zhu);
  animation: blink 0.8s infinite;
  font-size: 18px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 操作按钮 */
.generate-actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: stretch;
  gap: 12px;
  width: 100%;
  max-width: 920px;
  padding: 16px;
  border: 1px solid var(--line-2);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: 0 2px 12px rgba(43, 42, 40, 0.08);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
}
.outline-edit-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 32px;
  border-bottom: 1px solid var(--line-2);
  background: var(--paper);
}
.outline-edit-status { flex: 1; min-width: 160px; font-size: 12px; color: var(--ink-2); }

.title-picker {
  width: 100%;
  max-width: none;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.title-picker-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.title-picker-header span {
  font-size: 12px;
  color: var(--ink-3);
}

.title-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 92px;
  overflow-y: auto;
  padding-right: 2px;
}

.title-option {
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-s);
  background: var(--desk);
  color: var(--ink-2);
  cursor: pointer;
}

.title-option:hover,
.title-option.active {
  border-color: var(--zhu);
  color: var(--zhu);
  background: var(--zhu-soft);
}

.skeleton-candidates { width: 100%; max-width: none; padding: 18px 20px; text-align: left; }
.skeleton-candidates-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.skeleton-candidates-header h3 { margin: 0; font: 600 20px var(--f-serif); }
.skeleton-candidates-header p { margin: 6px 0 0; color: var(--ink-3); font-size: 12px; }
.skeleton-candidates-header > span { color: var(--ink-3); font-size: 12px; }
.skeleton-candidate-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 14px; }
.skeleton-card { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--desk); color: var(--ink); text-align: left; cursor: pointer; }
.skeleton-card:hover, .skeleton-card.active { border-color: var(--zhu); background: var(--zhu-soft); }
.skeleton-card strong { font: 600 16px var(--f-serif); }
.skeleton-card span, .skeleton-card small { color: var(--ink-2); line-height: 1.6; }

.no-config-hint {
  width: 100%;
  max-width: 500px;
  margin-top: var(--space-xl);
}

@media (max-height: 720px) {
  .generate-page {
    padding: var(--space-md);
    gap: var(--space-md);
  }

  .generate-animation {
    width: 56px;
    height: 56px;
    margin-bottom: 10px;
  }

  .ai-icon {
    font-size: 30px;
  }

  .generate-header h2 {
    font-size: 18px;
    margin-bottom: 4px;
  }

  .generate-hint,
  .generate-error {
    font-size: 13px;
  }

  .output-container {
    min-height: 140px;
  }

  .generate-actions {
    gap: 8px;
    padding: 8px;
  }

  .title-picker {
    padding: 10px;
    gap: 8px;
  }

  .title-options {
    max-height: 72px;
  }

  .title-option {
    padding: 4px 10px;
  }
}

@media (max-width: 768px) {
  .generate-page { padding: 20px; }
  .outline-output-scroll { padding: 20px 24px; }
  .outline-edit-toolbar { padding: 12px 24px; }
  .generate-actions { padding: 12px; gap: 10px; }
  .title-picker-header { flex-direction: column; gap: 4px; }
}
@media (max-width: 390px) {
  .generate-page { padding: 16px; }
  .outline-output-scroll { padding: 16px 20px; }
  .outline-edit-toolbar { padding: 10px 20px; }
  .generate-actions { align-items: stretch; }
  .generate-actions :deep(.n-button) { flex: 1 1 100%; }
}
.outline-ready .generate-animation { display: none; }
.generate-ready-hint { color: var(--ink-2); margin-top: 12px; font-size: 15px; }
.generation-steps { grid-column: 2; grid-row: 1 / 3; align-self: center; display: flex; flex-wrap: wrap; list-style: none; gap: 24px; color: var(--ink-3); font-size: 14px; }
.generation-steps .done { color: var(--dai); }
.generation-steps .active { color: var(--zhu); font-weight: 600; }
.outline-ready .outline-output-scroll { max-height: none; padding: 24px 32px; }
.outline-ready .output-content { padding: 0; font-size: 15px; line-height: 1.9; }
.outline-edit-toolbar h3 { margin-right: auto; font: 600 24px var(--f-serif); }
.outline-edit-toolbar h3 span { display: inline-block; margin-left: 8px; padding: 3px 8px; color: var(--qing); background: var(--hover); font: 12px var(--f-ui); }
.outline-ready .title-picker { width: 100%; padding: 0; box-shadow: none; border: 0; }
.outline-ready .title-picker-header { flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 24px; }
.outline-ready .title-picker-header strong { font: 600 28px var(--f-serif); }
.outline-ready .title-options { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; max-height: 360px; margin-bottom: 24px; }
.outline-ready .title-option { padding: 16px; text-align: left; font: 600 20px var(--f-serif); }
.outline-ready .generate-actions > .n-button:last-child { order: 1; }
.outline-ready .generate-actions > .n-button:nth-last-child(2) { order: 2; }
@media (max-width: 900px) { .generate-page.outline-ready { grid-template-columns: minmax(0, 1fr); padding: 24px; } .outline-ready .generate-header { grid-template-columns: minmax(0, 1fr); gap: 12px; } .generation-steps { grid-column: 1; grid-row: auto; } }
@media (max-width: 550px) { .generate-page.outline-ready { padding: 20px 16px; } .outline-ready .generate-header h2 { font-size: 30px; } .outline-ready .outline-output-scroll { padding: 20px; } .outline-ready .generate-actions { padding: 20px; } .outline-edit-toolbar h3 { font-size: 20px; } }
.generate-page {
  overflow-y: auto;
  flex-direction: column;
  display: flex; width: 100%; height: auto; min-height: 0; padding: 20px 0 48px; overflow: visible; align-items: stretch; gap: 18px; color: var(--ink); }
.generate-animation {
  justify-content: center;
  align-items: center;
  margin: 0 auto var(--space-lg);
  height: 80px;
  width: 80px;
  position: relative; display: none; }
.generate-header {
  flex-shrink: 0;
  margin-bottom: 0; max-width: 100%; text-align: left; }
.generate-header h2 {
  margin-bottom: 10px;
  font-weight: 600;
  font-size: 24px;
  font-family: var(--f-serif); margin: 0; color: var(--ink); font: 600 20px/1.5 var(--f-serif); }
.generate-header p { color: var(--ink-3); }
.structured-plan-status { font-size: 12px; margin-top: 8px; width: fit-content; max-width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink-3); }
.generate-page.outline-ready { overflow-y: auto; width: 100%; display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(280px, .8fr); align-items: start; gap: 16px; max-width: none; padding: 20px 0 48px; margin: 0; overflow: visible; }
.outline-ready .generate-header { width: 100%; padding: 0; margin: 0 0 8px; text-align: left; grid-template-columns: minmax(0, 1fr) auto; display: grid; grid-column: 1 / -1; }
.generate-page.choosing-skeleton { display: flex; flex-direction: column; align-items: stretch; }
.outline-ready .generate-header h2 { margin: 0; font: 700 38px var(--f-serif); font-size: 23px; }
.outline-ready .output-container { align-self: stretch; margin: 0; max-width: none; width: 100%; min-height: 460px; border-color: var(--line); border-radius: 8px; background: var(--paper); }
.outline-ready .generate-actions { box-shadow: none; border: 1px solid var(--line-2); margin: 0; max-width: none; width: 100%; gap: 16px; align-items: stretch; flex-direction: column; display: flex; bottom: auto; position: sticky; top: 16px; align-self: start; padding: 20px; border-color: var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }
:deep(.paper-panel) { border-color: var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }
@media (max-width: 900px) {
  .generate-page.outline-ready { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 900px) {
  .outline-ready .generate-actions { position: static; }
}

</style>
