<template>
  <div class="chapter-list" id="chapter-list-view">
    <div class="list-header">
      <h2 class="page-title">章节列表</h2>
      <div class="header-actions">
        <n-popconfirm
          v-if="novel?.chapters?.length"
          @update:show="show => captureDeletionDialog(show)"
          @positive-click="clearAllChapters"
        >
          <template #trigger>
            <n-button size="small" type="error" quaternary :disabled="deletionSaving">清空全部章节</n-button>
          </template>
          确定清空所有章节？正文将移至已删除章节，相关来源需要重新核对。
        </n-popconfirm>
        <n-button v-if="novel?.writingMode === 'ai' && novel.chapters.length" size="small" @click="openEmptyChapterRun">
          批量生成空章
        </n-button>
        <n-button v-if="novel?.chapters?.length" size="small" @click="batchReviewChapters">
          批量审校
        </n-button>
        <n-button v-if="novel?.chapters?.length" size="small" @click="openAutonomousRun">
          自动写作任务
        </n-button>
        <n-button type="primary" size="small" :disabled="deletionSaving" @click="addNewChapter" id="add-chapter-btn">
          + 新建章节
        </n-button>
      </div>
    </div>

    <section v-for="entry in pendingBatchReviews.filter(row => row.novelId === novelId)" :key="entry.input.chapterId"
      class="paper-panel" aria-label="待保存的批量审核报告">
      <strong>{{ entry.title }}</strong>
      <p role="alert">{{ entry.error || '审核报告尚未保存，原有审核保留。' }}</p>
      <details><summary>查看未保存的报告</summary><pre>{{ entry.input.report }}</pre></details>
      <n-button :loading="entry.saving" @click="retryBatchReview(entry)">重试保存审核报告</n-button>
      <n-button :disabled="entry.saving" @click="pendingBatchReviews = pendingBatchReviews.filter(row => row !== entry)">放弃未保存报告</n-button>
    </section>

    <details v-if="novel?.archivedChapters?.length" class="paper-panel archived-chapters" aria-label="已删除章节">
      <summary>已删除章节（{{ novel.archivedChapters.length }}）</summary>
      <p>保留删除时的正文和审核报告，供作者查看；不计入当前作品字数。</p>
      <div class="archived-chapter-links">
        <n-button v-for="chapter in novel.archivedChapters" :key="chapter.id" size="small"
          @click="selectedArchivedChapterId = chapter.id">{{ chapter.title || '未命名章节' }}</n-button>
      </div>
      <article v-if="selectedArchivedChapter">
        <h3>{{ selectedArchivedChapter.title }}</h3>
        <p>删除时为第 {{ selectedArchivedChapter.chapterIndex + 1 }} 章 · {{ selectedArchivedChapter.wordCount }} 字</p>
        <pre>{{ selectedArchivedChapter.content }}</pre>
        <details v-if="selectedArchivedChapter.contentReview"><summary>删除时的审核报告（历史记录）</summary>
          <pre>{{ selectedArchivedChapter.contentReview }}</pre>
        </details>
      </article>
    </details>

    <!-- 空状态 -->
    <div v-if="!novel?.chapters?.length" class="empty-chapters paper-panel">
      <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
      <h3>还没有章节</h3>
      <p>创建第一个章节，开始你的写作之旅</p>
      <n-button type="primary" :disabled="deletionSaving" @click="addNewChapter">创建第一章</n-button>
    </div>

    <!-- 按卷分组章节列表 -->
    <div v-else class="chapters-container">
      <div
        v-for="group in groupedChapters"
        :key="group.volumeIndex"
        class="volume-group"
      >
        <!-- 卷标题 -->
        <div
          v-if="hasVolumes"
          class="volume-group-header"
          @click="toggleVolume(group.volumeIndex)"
        >
          <span class="volume-group-icon">{{ collapsedVolumes.has(group.volumeIndex) ? '▶' : '▼' }}</span>
          <span class="volume-group-title">{{ group.volumeTitle }}</span>
          <span class="volume-group-count">{{ group.chapters.length }} 章</span>
        </div>

        <!-- 章节卡片 -->
        <div v-show="!collapsedVolumes.has(group.volumeIndex)" class="chapters-grid">
          <div
            v-for="(chapter, idx) in group.chapters"
            :key="chapter.id"
            class="chapter-card paper-panel"
            :ref="el => { if (isLastChapter(group, idx)) lastChapterEl = el as HTMLElement }"
          >
            <div class="chapter-main" role="button" tabindex="0" @click="openChapter(chapter.id)" @keydown.enter.self.prevent="openChapter(chapter.id)" @keydown.space.self.prevent="openChapter(chapter.id)">
              <div class="chapter-header-row">
                <div class="chapter-number">第 {{ chapter.chapterIndex + 1 }} 章</div>
                <n-popconfirm @update:show="show => captureDeletionDialog(show, chapter.id)" @positive-click="removeChapter(chapter.id)">
                  <template #trigger>
                    <n-button size="tiny" quaternary type="error" class="delete-btn" :disabled="deletionSaving" @click.stop>删除</n-button>
                  </template>
                  确定删除此章节？删除后保留历史，相关来源需要重新核对。
                </n-popconfirm>
              </div>
              <h4 class="chapter-title">{{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex) }}</h4>
              <div class="chapter-meta">
                <span :class="['status-dot', chapter.status]"></span>
                <span>{{ statusText(chapter.status) }}</span>
                <span class="meta-sep">·</span>
                <span>{{ chapter.wordCount.toLocaleString() }} 字</span>
              </div>
              <p class="chapter-preview" v-if="chapter.content">
                {{ chapter.content.substring(0, 80) }}...
              </p>
            </div>

            <!-- 单章总结展开/收起 -->
            <div class="summary-toggle" :aria-expanded="expandedSummaries.has(chapter.id)" role="button" tabindex="0" @click.stop="toggleSummary(chapter.id)" @keydown.enter.stop.prevent="toggleSummary(chapter.id)" @keydown.space.stop.prevent="toggleSummary(chapter.id)">
              <span v-if="chapter.summary" class="summary-indicator has-summary">{{ getChapterSummaryStatus(chapter) === 'current' ? '总结有效' : '总结待核对' }}</span>
              <span v-else class="summary-indicator no-summary">无总结</span>
              <span class="summary-arrow">{{ expandedSummaries.has(chapter.id) ? '▲' : '▼' }}</span>
            </div>

            <!-- 单章总结内容 -->
            <div v-if="expandedSummaries.has(chapter.id)" class="summary-panel" @click.stop>
              <template v-if="editingSummaryId === chapter.id">
                <n-input
                  v-model:value="editSummaryText"
                  :disabled="summarySaving"
                  type="textarea"
                  :rows="4"
                  size="small"
                  placeholder="输入章节总结..."
                />
                <div class="summary-actions">
                  <n-button size="tiny" :disabled="summarySaving" @click="editingSummaryId = ''">取消</n-button>
                  <n-button size="tiny" type="primary" :loading="summarySaving" :disabled="summarySaving || chapter.status === 'locked'" @click="saveSummary(chapter.id)">保存并确认</n-button>
                </div>
              </template>
              <template v-else>
                <p class="summary-text" v-if="chapter.summary">{{ chapter.summary }}</p>
                <p class="summary-text no-content" v-else>暂无总结</p>
                <p v-if="chapter.summary && getChapterSummaryStatus(chapter) !== 'current'" class="summary-text no-content">总结来源未确认或正文已经变化，暂不用于 AI 写作和审核。请核对正文后编辑并确认。</p>
                <div class="summary-actions">
                  <n-button size="tiny" :disabled="summarySaving || chapter.status === 'locked'" @click="startEditSummary(chapter)">{{ chapter.summary ? '编辑并核对' : '添加总结' }}</n-button>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <n-modal v-model:show="showAutonomousRun" preset="card" title="自动写作任务" style="width: min(560px, calc(100vw - 32px));">
      <div class="autonomous-run-panel">
        <p class="autonomous-run-description">自动模式为范围内的空白章节生成候选稿，并完成审核。稿件、审核和故事变化先保存在任务中，由你接受后才写入正文。</p>
        <AutonomousDraftPanel :novel-id="novelId" :runs="autonomousRuns" :disabled="autonomousBusy || autonomousCancelBusy" />

        <div v-if="latestAutonomousRun" class="autonomous-run-status">
          <div class="autonomous-run-status-header">
            <strong>{{ aiRunStatusText(latestAutonomousRun.status) }}</strong>
            <span>{{ aiRunCheckpointText(latestAutonomousRun) }}</span>
          </div>
          <n-progress
            type="line"
            :percentage="aiRunProgress(latestAutonomousRun)"
            :show-indicator="true"
          />
          <p class="autonomous-run-hint">{{ aiRunUsageText(latestAutonomousRun) }}</p>
          <details v-if="latestAutonomousRun.requests?.length" class="autonomous-run-ledger">
            <summary>请求记录（{{ latestAutonomousRun.requests.length }}）</summary>
            <ol>
              <li v-for="request in latestAutonomousRun.requests" :key="request.id">
                第 {{ request.chapterIndex + 1 }} 章 · {{ { writing: '生成', review: '审核', analysis: '故事变化提取' }[request.phase] }} · {{ request.modelId }}
                <br />{{ request.inputTokens + request.outputTokens }} Token · {{ { pending: '请求中', completed: '已返回', failed: '请求失败', interrupted: '已中断', unknown: '结果未知', not_sent: '未发送' }[request.status] }} · {{ { reservation: '已预留', reported: '接口用量', estimated: '保守估算' }[request.usageSource] }}
              </li>
            </ol>
          </details>
          <p v-if="latestAutonomousRun.error" class="autonomous-run-error">{{ latestAutonomousRun.error }}</p>
          <details v-if="['paused', 'needs_author'].includes(latestAutonomousRun.status)" class="autonomous-run-limits">
            <summary>调整任务总额度</summary>
            <div class="autonomous-run-fields">
              <label>任务总 Token 预算<n-input-number v-model:value="runLimitForm.tokenBudget" :min="Math.max(1, latestAutonomousRun.usedTokens || 0)" :disabled="autonomousBusy || autonomousCancelBusy" /></label>
              <label>任务总请求上限<n-input-number v-model:value="runLimitForm.requestLimit" :min="Math.max(1, latestAutonomousRun.requests?.length || 0)" :max="2000" :disabled="autonomousBusy || autonomousCancelBusy" /></label>
            </div>
            <p class="autonomous-run-hint">已记录的用量不会清零。保存额度后，由你点击“继续任务”恢复执行。</p>
            <n-button :loading="autonomousCancelBusy" :disabled="autonomousBusy" @click="saveAutonomousLimits">保存额度</n-button>
          </details>
          <div class="autonomous-run-actions">
            <n-button
              v-if="['paused', 'needs_author', 'failed'].includes(latestAutonomousRun.status)"
              type="primary"
              :loading="autonomousBusy"
              :disabled="autonomousCancelBusy"
              @click="resumeAutonomousRun"
            >继续任务</n-button>
            <n-button
              v-if="latestAutonomousRun.status === 'running'"
              :disabled="autonomousBusy === false"
              @click="pauseAutonomousRun"
            >暂停</n-button>
            <n-button v-if="latestAutonomousRun.status === 'running' && !autonomousBusy" :loading="autonomousCancelBusy" @click="recoverAutonomousRun">恢复中断任务</n-button>
            <n-button
              v-if="['queued', 'running', 'paused', 'needs_author'].includes(latestAutonomousRun.status)"
              type="error"
              :loading="autonomousCancelBusy"
              @click="cancelAutonomousRun"
            >取消任务</n-button>
          </div>
        </div>

        <div v-if="!latestAutonomousRun || !['queued', 'running', 'paused', 'needs_author'].includes(latestAutonomousRun.status)" class="autonomous-run-form">
          <div class="autonomous-run-fields">
            <label>起始章节
              <n-input-number v-model:value="autonomousForm.chapterStart" :min="1" :max="novel?.chapters.length || 1" :disabled="autonomousBusy" />
            </label>
            <label>结束章节
              <n-input-number v-model:value="autonomousForm.chapterEnd" :min="autonomousForm.chapterStart || 1" :max="novel?.chapters.length || 1" :disabled="autonomousBusy" />
            </label>
            <label>Token 预算
              <n-input-number v-model:value="autonomousForm.tokenBudget" :min="1000" :max="2000000" :step="1000" :disabled="autonomousBusy" />
            </label>
            <label>请求次数上限
              <n-input-number v-model:value="autonomousForm.requestLimit" :min="1" :max="2000" :disabled="autonomousBusy" />
            </label>
            <label>每几章停下检查
              <n-input-number v-model:value="autonomousForm.checkpointEvery" :min="0" :max="1000" :disabled="autonomousBusy" />
            </label>
          </div>
          <p class="autonomous-run-hint">当前范围：第 {{ autonomousForm.chapterStart }} 至第 {{ autonomousForm.chapterEnd }} 章；任务会在章节审核需要作者处理时自动停下。</p>
          <p class="autonomous-run-hint">检查点填 0 表示连续执行。设置为正整数时，每完成相应章数会暂停并等待作者确认。</p>
          <p class="autonomous-run-hint">每次生成、分段审核、格式重试和故事变化提取都计入预算。发送前预留完整输入和最大输出额度；接口未返回用量时保留估算。预算是本任务的停止条件，不等同于服务商账单上限。</p>
          <div class="autonomous-run-actions">
            <n-button type="primary" :loading="autonomousBusy" @click="() => startAutonomousRun()">开始自动写作</n-button>
          </div>
        </div>

        <div v-if="latestAutonomousRun?.status === 'needs_author'" class="autonomous-run-boundary">
          本次任务已在作者介入点停止：{{ latestAutonomousRun.error || '请先处理当前章节，再创建下一段自动任务。' }}
        </div>
        <div v-if="autonomousReviewCoverage" class="autonomous-run-coverage">
          当前章节审核进度：{{ autonomousReviewCoverageText }}
        </div>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NInputNumber, NModal, NPopconfirm, NProgress, useMessage } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useKnowledgeStore } from '@/stores/knowledge'
import AutonomousDraftPanel from '@/components/AutonomousDraftPanel.vue'
import { requestCoveredContentReview } from '@/services/chapterReview'
import { buildChapterReviewInput, buildChapterReviewSubmission } from '@/services/chapterReviewInput'
import type { ChapterReviewSubmission } from '@/services/chapterReviewTransactions'
import type { ChapterDeletionBaseline } from '@/services/chapterDeletionTransactions'
import type { StoredReviewCoverage } from '@/services/chapterReviewCoverage'
import { getChapterSummaryStatus } from '@/services/derivedSources'
import { chapterBackgroundQueue } from '@/services/aiTaskQueue'
import { createAiRun, cancelAiRun } from '@/services/reconstructionAiRun'
import { executeAutonomousRun, recoverInterruptedAiRun } from '@/services/reconstructionAutonomous'
import { createAutonomousEmptyChapterProcessor } from '@/services/reconstructionAutonomousChapter'
import { extractAutonomousChapterCandidates } from '@/services/reconstructionAutonomousReview'
import type { AiRun } from '@/types/reconstruction'
import type { Chapter } from '@/types/novel'

const route = useRoute()
const router = useRouter()
const props = withDefaults(defineProps<{ focusLastChapter?: boolean }>(), { focusLastChapter: true })
const novelStore = useNovelStore()
const configStore = useConfigStore()
const knowledgeStore = useKnowledgeStore()
const reconstructionStore = useReconstructionWorkspaceStore()
const message = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
type PendingBatchReview = { novelId: string; title: string; input: ChapterReviewSubmission; error?: string; saving?: boolean }
const pendingBatchReviews = ref<PendingBatchReview[]>([])

async function saveBatchReview(entry: PendingBatchReview) {
  if (entry.saving) return
  entry.saving = true
  try {
    await reconstructionStore.commitChapterReview(entry.novelId, entry.input)
    pendingBatchReviews.value = pendingBatchReviews.value.filter(row => row !== entry)
  } catch (error) {
    entry.error = '审核报告未保存：' + (error instanceof Error ? error.message : String(error))
    throw error
  } finally { entry.saving = false }
}

async function retryBatchReview(entry: PendingBatchReview) {
  try { await saveBatchReview(entry); message.success('审核报告已保存') }
  catch (error) { message.warning(error instanceof Error ? error.message : '审核报告保存失败') }
}
const workspaceLoads = new Map<string, Promise<unknown>>()
function ensureWorkspace(targetNovelId = novelId.value) {
  let pending = workspaceLoads.get(targetNovelId)
  if (!pending) {
    pending = reconstructionStore.hydrateFromPersistence(targetNovelId).catch(error => {
      workspaceLoads.delete(targetNovelId)
      throw error
    })
    workspaceLoads.set(targetNovelId, pending)
  }
  return pending
}

const collapsedVolumes = ref(new Set<number>())
const expandedSummaries = ref(new Set<string>())
const editingSummaryId = ref('')
const editSummaryText = ref('')
const editSummaryBase = ref<{ novelId: string; chapterId: string; content: string; summary: string } | null>(null)
const summarySaving = ref(false)
const lastChapterEl = ref<HTMLElement | null>(null)
const showAutonomousRun = ref(false)
const autonomousBusy = ref(false)
const autonomousCancelBusy = ref(false)
const autonomousController = ref<AbortController | null>(null)
const autonomousPromise = ref<Promise<AiRun> | null>(null)
const autonomousCancelRequested = ref(false)
const autonomousReviewCoverage = ref<Record<string, unknown> | null>(null)
const autonomousForm = ref({ chapterStart: 1, chapterEnd: 1, tokenBudget: 120000, requestLimit: 200, checkpointEvery: 0 })

const autonomousRuns = computed(() => reconstructionStore.getAiRuns(novelId.value)
  .filter(run => run.mode === 'autonomous')
  .slice()
  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
const latestAutonomousRun = computed(() => autonomousRuns.value[0])
const runLimitForm = ref({ tokenBudget: 120000, requestLimit: 200 })
watch(() => [latestAutonomousRun.value?.id, latestAutonomousRun.value?.tokenBudget, latestAutonomousRun.value?.requestLimit], () => {
  runLimitForm.value = { tokenBudget: latestAutonomousRun.value?.tokenBudget || 120000, requestLimit: latestAutonomousRun.value?.requestLimit || 200 }
}, { immediate: true })
const autonomousReviewCoverageText = computed(() => {
  const coverage = autonomousReviewCoverage.value
  if (!coverage) return ''
  const completed = Number(coverage.completedChunks || 0)
  const total = Number(coverage.totalChunks || 0)
  return total > 0 ? `${completed}/${total} 段` : String(coverage.status || '处理中')
})

function isLastChapter(group: ChapterGroup, idx: number): boolean {
  if (!novel.value) return false
  const allChapters = novel.value.chapters
  if (allChapters.length === 0) return false
  const lastChapter = allChapters[allChapters.length - 1]
  return group.chapters[idx]?.id === lastChapter.id
}

onMounted(() => {
  void ensureWorkspace().catch(error => message.warning('故事工作区读取失败：' + String(error)))
  nextTick(() => {
    if (props.focusLastChapter && lastChapterEl.value) {
      lastChapterEl.value.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
})

function openAutonomousRun() {
  const count = novel.value?.chapters.length || 1
  autonomousForm.value = {
    chapterStart: Math.min(Math.max(autonomousForm.value.chapterStart, 1), count),
    chapterEnd: Math.min(Math.max(autonomousForm.value.chapterEnd, 1), count),
    tokenBudget: autonomousForm.value.tokenBudget || 120000,
    requestLimit: autonomousForm.value.requestLimit || 200,
    checkpointEvery: Math.max(0, Math.min(1000, Math.round(autonomousForm.value.checkpointEvery || 0))),
  }
  if (autonomousForm.value.chapterEnd < autonomousForm.value.chapterStart) {
    autonomousForm.value.chapterEnd = autonomousForm.value.chapterStart
  }
  autonomousReviewCoverage.value = null
  showAutonomousRun.value = true
}

function aiRunStatusText(status: AiRun['status']): string {
  const labels: Record<AiRun['status'], string> = {
    queued: '排队中',
    running: '执行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '执行失败',
    cancelled: '已取消',
    needs_author: '等待作者处理',
  }
  return labels[status]
}

function aiRunCheckpointText(run: AiRun): string {
  if (!run.checkpoint) return '尚未产生检查点'
  const match = run.checkpoint.match(/^chapter-(\d+):(started|completed|reviewed|checkpoint|review-needs-author|needs-author)$/)
  if (!match) return '已保留上次执行位置'
  const labels: Record<string, string> = { started: '处理尚未完成', completed: '处理完成', reviewed: '审核完成',
    checkpoint: '达到作者检查点', 'review-needs-author': '审核等待作者处理', 'needs-author': '等待作者核对' }
  return `第 ${Number(match[1]) + 1} 章 · ${labels[match[2]]}`
}

function aiRunUsageText(run: AiRun): string {
  const requests = run.requests || []
  const uncertain = requests.filter(request => request.usageSource !== 'reported').length
  return `Token 用量 ${run.usedTokens || 0} / ${run.tokenBudget || 0} · 请求 ${requests.length} / ${run.requestLimit || 0}`
    + (uncertain ? `（${uncertain} 次含预留或估算）` : '')
}

function aiRunProgress(run: AiRun): number {
  const start = run.chapterStart ?? 0
  const end = run.chapterEnd ?? start
  const total = Math.max(1, end - start + 1)
  const match = run.checkpoint?.match(/^chapter-(\d+):(completed|reviewed|checkpoint|started|review-needs-author|needs-author)$/)
  if (!match) return run.status === 'completed' ? 100 : 0
  const completed = Number(match[1]) - start + (['completed', 'reviewed', 'checkpoint'].includes(match[2]) ? 1 : 0)
  return Math.max(0, Math.min(100, Math.round(completed / total * 100)))
}

async function persistAutonomousRun(run: AiRun, targetNovelId = novelId.value): Promise<void> {
  await reconstructionStore.saveAiRun(targetNovelId, run)
}

function createAutonomousProcessor(targetNovelId: string) {
  const writingModel = configStore.getModelForTask('writing')
  const reviewModel = configStore.getModelForTask('review') || writingModel
  const analysisModel = configStore.getModelForTask('outline') || reviewModel
  if (!writingModel || !reviewModel) return null
  return createAutonomousEmptyChapterProcessor({
    novelId: targetNovelId,
    getNovel: () => novelStore.getNovel(targetNovelId),
    getKnowledgeRevisions: () => useKnowledgeStore().knowledgeBases,
    getCreationDraft: () => reconstructionStore.getCreationDraft(targetNovelId),
    getCanonMutations: () => reconstructionStore.getCanonMutations(targetNovelId),
    getStoryMemories: () => reconstructionStore.getStoryMemories(targetNovelId),
    analysisModel: analysisModel || undefined,
    writingModel,
    reviewModel,
    extractCandidates: async ({ novel: targetNovel, chapterId, model, signal, requestLifecycle }) => {
      const chapter = targetNovel.chapters.find(item => item.id === chapterId)
      if (!chapter) return { candidates: [] }
      return extractAutonomousChapterCandidates({ novel: targetNovel, chapter, model, signal, requestLifecycle, canonMutations: reconstructionStore.getCanonMutations(targetNovel.id) })
    },
    onReviewProgress: (_targetNovelId, _chapterId, coverage) => {
      autonomousReviewCoverage.value = coverage as Record<string, unknown>
    },
  })
}

async function startAutonomousRun(existingRun?: AiRun) {
  if (autonomousBusy.value || autonomousCancelBusy.value) return
  const targetNovelId = novelId.value
  try { await ensureWorkspace(targetNovelId) }
  catch (error) { message.warning('故事工作区读取失败：' + String(error)); return }
  if (autonomousBusy.value) return
  if (novelId.value !== targetNovelId) return
  const processor = createAutonomousProcessor(targetNovelId)
  if (!processor) {
    message.warning('请先配置写作模型和审校模型')
    return
  }

  let run: AiRun
  try {
    if (existingRun) {
      if (!['paused', 'needs_author', 'failed'].includes(existingRun.status)) {
        message.info('只有已暂停、失败或等待作者处理的自动任务可以继续')
        return
      }
      run = existingRun
    } else {
      const chapterStart = Math.round((autonomousForm.value.chapterStart || 1) - 1)
      const chapterEnd = Math.round((autonomousForm.value.chapterEnd || 1) - 1)
      const chapterCount = novel.value?.chapters.length || 0
      if (chapterStart < 0 || chapterEnd < chapterStart || chapterEnd >= chapterCount) {
        message.warning('章节范围无效，请重新选择')
        return
      }
      run = createAiRun({
        id: `autonomous-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        mode: 'autonomous',
        taskType: 'draft',
        targetId: novelId.value,
        chapterStart,
        chapterEnd,
        tokenBudget: Math.round(autonomousForm.value.tokenBudget || 0),
        requestLimit: Math.round(autonomousForm.value.requestLimit || 0),
        checkpointEvery: autonomousForm.value.checkpointEvery ? Math.round(autonomousForm.value.checkpointEvery) : undefined,
        now: new Date().toISOString(),
      })
    }
  } catch (error) {
    message.warning(error instanceof Error ? error.message : String(error))
    return
  }

  autonomousBusy.value = true
  autonomousCancelRequested.value = false
  autonomousController.value = new AbortController()
  const controller = autonomousController.value
  const promise = executeAutonomousRun({
    run,
    persist: run => persistAutonomousRun(run, targetNovelId),
    processChapter: processor,
    signal: controller.signal,
  })
  autonomousPromise.value = promise

  try {
    const result = await promise
    if (autonomousCancelRequested.value && result.status === 'paused') {
      const cancelled = cancelAiRun(result, new Date().toISOString(), '作者取消自动任务')
      await persistAutonomousRun(cancelled, targetNovelId)
      message.info('自动写作任务已取消')
    } else if (result.status === 'completed') {
      message.success('自动写作任务已完成')
    } else if (result.status === 'needs_author') {
      message.warning(result.error || '自动写作已暂停，等待作者处理')
    } else if (result.status === 'paused') {
      message.info('自动写作任务已暂停')
    } else if (result.status === 'failed') {
      message.error(result.error || '自动写作任务失败')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '自动任务保存失败')
  } finally {
    if (autonomousPromise.value === promise) autonomousPromise.value = null
    if (autonomousController.value === controller) autonomousController.value = null
    autonomousBusy.value = false
  }
}

function resumeAutonomousRun() {
  const run = latestAutonomousRun.value
  if (run && ['paused', 'needs_author', 'failed'].includes(run.status)) void startAutonomousRun(run)
}

async function saveAutonomousLimits() {
  const run = latestAutonomousRun.value, targetNovelId = novelId.value
  if (!run || autonomousBusy.value || autonomousCancelBusy.value) return
  autonomousCancelBusy.value = true
  try {
    await reconstructionStore.saveAiRunLimits(targetNovelId, run, { ...runLimitForm.value })
    message.success('任务额度已保存；已记录的用量保持不变。')
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  finally { autonomousCancelBusy.value = false }
}

function pauseAutonomousRun() {
  if (!autonomousBusy.value || !autonomousController.value) return
  autonomousController.value.abort(new DOMException('作者暂停自动任务', 'AbortError'))
}

async function recoverAutonomousRun() {
  const run = latestAutonomousRun.value, targetNovelId = novelId.value
  if (!run || autonomousBusy.value || autonomousCancelBusy.value) return
  autonomousCancelBusy.value = true
  try {
    await persistAutonomousRun(recoverInterruptedAiRun(run, new Date().toISOString()), targetNovelId)
    message.info('已保留中断前的检查点和请求用量，请核对后继续任务。')
  } catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  finally { autonomousCancelBusy.value = false }
}

async function cancelAutonomousRun() {
  const run = latestAutonomousRun.value
  if (!run || autonomousCancelBusy.value) return
  autonomousCancelBusy.value = true
  autonomousCancelRequested.value = true
  try {
    if (autonomousController.value) {
      autonomousController.value.abort(new DOMException('作者取消自动任务', 'AbortError'))
      if (autonomousPromise.value) await autonomousPromise.value
    } else if (['queued', 'paused', 'needs_author'].includes(run.status)) {
      await persistAutonomousRun(cancelAiRun(run, new Date().toISOString(), '作者取消自动任务'))
      message.info('自动写作任务已取消')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error))
  } finally {
    autonomousCancelBusy.value = false
  }
}

defineExpose({
  ensureWorkspace,
  pauseAutonomousRun,
  resumeAutonomousRun,
  cancelAutonomousRun,
  recoverAutonomousRun,
})

onBeforeUnmount(() => {
  if (autonomousBusy.value && autonomousController.value) {
    autonomousController.value.abort(new DOMException('离开章节列表，自动任务已暂停', 'AbortError'))
  }
})

const hasVolumes = computed(() => (novel.value?.volumes?.length || 0) > 0)

// 按卷分组
interface ChapterGroup {
  volumeIndex: number
  volumeTitle: string
  chapters: Chapter[]
}

const groupedChapters = computed<ChapterGroup[]>(() => {
  if (!novel.value) return []
  const chapters = novel.value.chapters
  const volumes = novel.value.volumes || []

  if (!volumes.length) {
    // 没有分卷，全部放一组
    return [{ volumeIndex: -1, volumeTitle: '全部章节', chapters }]
  }

  // 按 volumeIndex 分组
  const groups: Record<number, Chapter[]> = {}
  const ungrouped: Chapter[] = []

  for (const ch of chapters) {
    const vi = ch.volumeIndex ?? -1
    if (vi >= 0) {
      if (!groups[vi]) groups[vi] = []
      groups[vi].push(ch)
    } else {
      ungrouped.push(ch)
    }
  }

  const result: ChapterGroup[] = []
  for (const vol of volumes) {
    result.push({
      volumeIndex: vol.volumeIndex,
      volumeTitle: `第${vol.volumeIndex + 1}卷 ${vol.title}`,
      chapters: groups[vol.volumeIndex] || [],
    })
  }
  if (ungrouped.length) {
    result.push({ volumeIndex: -1, volumeTitle: '未分卷', chapters: ungrouped })
  }
  return result
})

function statusText(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿',
    writing: '写作中',
    completed: '已完成',
    reviewed: '已审查',
    finalized: '已定稿',
    locked: '已锁定',
  }
  return map[status] || status
}

function toggleVolume(idx: number) {
  if (collapsedVolumes.value.has(idx)) {
    collapsedVolumes.value.delete(idx)
  } else {
    collapsedVolumes.value.add(idx)
  }
}

function toggleSummary(id: string) {
  if (expandedSummaries.value.has(id)) {
    expandedSummaries.value.delete(id)
  } else {
    expandedSummaries.value.add(id)
  }
}

function startEditSummary(chapter: Chapter) {
  editSummaryBase.value = { novelId: novelId.value, chapterId: chapter.id, content: chapter.content, summary: chapter.summary }
  editingSummaryId.value = chapter.id
  editSummaryText.value = chapter.summary || ''
}

async function saveSummary(chapterId: string) {
  const base = editSummaryBase.value
  if (!base || base.chapterId !== chapterId || base.novelId !== novelId.value || summarySaving.value) return
  summarySaving.value = true
  try {
    await novelStore.saveChapterSummary(base.novelId, chapterId, base.content, base.summary, editSummaryText.value)
    editingSummaryId.value = ''
    const saved = novelStore.getNovel(base.novelId)?.chapters.find(chapter => chapter.id === chapterId)
    if (!saved || getChapterSummaryStatus(saved) === 'stale' || getChapterSummaryStatus(saved) === 'unverified') {
      message.warning('保存期间正文或总结发生变化，请重新核对总结。')
    } else message.success(saved.summary.trim() ? '总结已保存并绑定核对过的正文版本' : '总结已清空')
  } catch (error) { message.error(error instanceof Error ? error.message : '总结保存失败') }
  finally { summarySaving.value = false }
}

function addNewChapter() {
  const chapter = novelStore.addChapter(novelId.value, {})
  if (chapter) {
    message.success('章节已创建')
    router.push(`/write/${novelId.value}/${chapter.id}`)
  }
}

function openChapter(chapterId: string) {
  router.push(`/write/${novelId.value}/${chapterId}`)
}

const deletionSaving = ref(false)
const selectedArchivedChapterId = ref('')
const selectedArchivedChapter = computed(() => novel.value?.archivedChapters?.find(chapter => chapter.id === selectedArchivedChapterId.value))
const deletionBaselines = new Map<string | undefined, ChapterDeletionBaseline>()
function captureDeletionDialog(show: boolean, chapterId?: string) {
  if (!show) return
  try { deletionBaselines.set(chapterId, novelStore.captureChapterDeletionBaseline(novelId.value, chapterId)) }
  catch (error) { message.error(error instanceof Error ? error.message : '删除确认读取失败') }
}

async function confirmChapterDeletion(chapterId?: string): Promise<boolean> {
  if (deletionSaving.value) return false
  const baseline = deletionBaselines.get(chapterId)
  if (!baseline || baseline.novelId !== novelId.value) {
    message.warning('请重新打开删除确认，再核对当前章节。')
    return false
  }
  deletionSaving.value = true
  try {
    const changed = chapterId === undefined
      ? await novelStore.clearChapters(baseline.novelId, baseline)
      : await novelStore.deleteChapter(baseline.novelId, chapterId, baseline)
    if (changed) message.success(chapterId === undefined ? '已清空全部章节' : '章节已删除')
    else message.info('待删章节已不存在')
    deletionBaselines.delete(chapterId)
    return true
  } catch (error) {
    message.error(error instanceof Error ? error.message : '章节删除保存失败')
    return false
  } finally { deletionSaving.value = false }
}

function removeChapter(chapterId: string) { return confirmChapterDeletion(chapterId) }
function clearAllChapters() { return confirmChapterDeletion() }

async function openEmptyChapterRun() {
  const targetNovelId = novelId.value
  try { await ensureWorkspace(targetNovelId) }
  catch (error) { message.warning('故事工作区读取失败：' + String(error)); return }
  const currentNovel = novel.value
  if (novelId.value !== targetNovelId || currentNovel?.writingMode !== 'ai') return
  if (autonomousBusy.value || autonomousCancelBusy.value
    || (latestAutonomousRun.value && ['queued', 'running', 'paused', 'needs_author'].includes(latestAutonomousRun.value.status))) {
    openAutonomousRun()
    return
  }

  const chapters = currentNovel.chapters.slice().sort((left, right) => left.chapterIndex - right.chapterIndex)
  const start = chapters.findIndex(chapter => !chapter.content.trim() && chapter.status !== 'locked')
  if (start < 0) {
    message.info('没有需要批量生成的空白章节')
    return
  }
  let end = start
  while (end + 1 < chapters.length) {
    const next = chapters[end + 1]
    if (next.content.trim() || next.status === 'locked' || next.chapterIndex !== chapters[end].chapterIndex + 1) break
    end++
  }
  autonomousForm.value.chapterStart = chapters[start].chapterIndex + 1
  autonomousForm.value.chapterEnd = chapters[end].chapterIndex + 1
  openAutonomousRun()
}

async function batchReviewChapters() {
  const queuedNovelId = novelId.value
  try { await ensureWorkspace(queuedNovelId) }
  catch (error) { message.warning('故事工作区读取失败：' + String(error)); return }
  if (!novel.value || novelId.value !== queuedNovelId) return
  const model = configStore.getModelForTask('review')
  if (!model) {
    message.warning('请先配置审校模型')
    return
  }
  const targets = novel.value.chapters.filter(ch => ch.content.trim().length > 100 && ch.status !== 'locked')
  if (targets.length === 0) {
    message.info('没有可审校的章节')
    return
  }

  chapterBackgroundQueue.enqueueBatch('批量审校章节', targets.map(chapter => ({
    name: `审校第${chapter.chapterIndex + 1}章`,
    task: async () => {
      const currentNovel = novelStore.getNovel(queuedNovelId)
      const currentChapter = currentNovel?.chapters.find(ch => ch.id === chapter.id)
      if (!currentNovel || !currentChapter || currentChapter.status === 'locked') return
      const pending = pendingBatchReviews.value.find(row => row.novelId === queuedNovelId && row.input.chapterId === currentChapter.id)
      if (pending) { await saveBatchReview(pending); return }
      const source = currentChapter.content
      const readInput = () => buildChapterReviewInput(currentNovel, currentChapter, {
        knowledge: knowledgeStore.knowledgeBases, creationDraft: reconstructionStore.getCreationDraft(queuedNovelId),
        canonMutations: reconstructionStore.getCanonMutations(queuedNovelId), storyMemories: reconstructionStore.getStoryMemories(queuedNovelId),
      })
      const input = readInput()
      let finalCoverage: StoredReviewCoverage | undefined
      const getSnapshot = () => readInput().signature
      const snapshot = getSnapshot()
      const ensureCurrent = () => {
        if (novelStore.getNovel(queuedNovelId) !== currentNovel || !currentNovel.chapters.includes(currentChapter)
          || currentChapter.status === 'locked' || getSnapshot() !== snapshot) throw new Error('正文或设定已变化，未采用旧版本的批量审查')
      }
      const reviewText = await requestCoveredContentReview({
        model, source, chapterIndex: currentChapter.chapterIndex,
        checkpoint: currentChapter.contentReviewCoverage?.status === 'complete' && currentChapter.contentReview ? undefined : currentChapter.contentReviewCoverage?.checkpoint, checkpointKey: input.signature,
        onCheckpoint: async coverage => {
          ensureCurrent()
          novelStore.updateChapter(queuedNovelId, currentChapter.id, { contentReviewCoverage: { ...coverage, signature: input.signature } })
          await novelStore.saveNovelNow(queuedNovelId)
          ensureCurrent()
        },
        buildContext: input.buildContext, ensureCurrent,
        onProgress: coverage => {
          finalCoverage = { ...coverage, signature: input.signature }
          novelStore.updateChapter(queuedNovelId, currentChapter.id, { contentReviewCoverage: finalCoverage })
        },
      })
      ensureCurrent()
      if (!finalCoverage) throw new Error('审核覆盖缺失，报告未保存。')
      const entry: PendingBatchReview = { novelId: queuedNovelId, title: currentChapter.title,
        input: buildChapterReviewSubmission(input, reviewText, finalCoverage,
          reconstructionStore.getChapterReviews(queuedNovelId, currentChapter.id), reconstructionStore.getCandidates(queuedNovelId), new Date().toISOString()),
      }
      pendingBatchReviews.value.push(entry)
      // Use the reactive record so saving state and retry removal share identity.
      await saveBatchReview(pendingBatchReviews.value[pendingBatchReviews.value.length - 1])
    },
  })))
  message.success(`已加入 ${targets.length} 个章节审校任务`)
}
</script>

<style scoped>
.list-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  margin-bottom: var(--space-lg);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--line-2);
}

.list-header .page-title {
  min-width: 0;
  flex: 1 1 auto;
  margin: 0;
  font-family: var(--f-serif);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  gap: 8px;
}

@media (max-width: 620px) {
  .list-header { align-items: flex-start; }
  .list-header .page-title { flex: 1 0 100%; font-size: 24px; }
  .header-actions { width: 100%; justify-content: flex-start; }
}

.autonomous-run-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.autonomous-run-description,
.autonomous-run-hint,
.autonomous-run-boundary,
.autonomous-run-coverage {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.7;
}

.autonomous-run-status {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-s);
  background: var(--panel);
}

.autonomous-run-status-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.autonomous-run-status-header span {
  color: var(--ink-3);
  font-size: 12px;
  word-break: break-all;
}

.autonomous-run-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.autonomous-run-fields label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-2);
  font-size: 12px;
}

.autonomous-run-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.autonomous-run-error,
.autonomous-run-boundary {
  color: var(--jin);
}

@media (max-width: 620px) {
  .autonomous-run-fields { grid-template-columns: 1fr; }
}

.empty-chapters {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 12px;
  text-align: center;
}

.empty-icon { width: 220px; color: var(--line-2); }

.empty-chapters h3 {
  font-family: var(--f-serif);
  font-size: 18px;
  color: var(--ink);
}

.empty-chapters p {
  font-size: 14px;
  color: var(--ink-3);
  margin-bottom: 8px;
}

/* 卷分组 */
.chapters-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.volume-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 10px;
  cursor: pointer;
  border-left: 3px solid var(--zhu);
  border-radius: 0 var(--r-s) var(--r-s) 0;
  background: var(--panel);
  transition: background var(--motion-fast);
  margin-bottom: 10px;
}

.volume-group-header:hover {
  background: var(--hover);
}

.volume-group-icon {
  font-size: 10px;
  color: var(--ink-3);
}

.volume-group-title {
  font-family: var(--f-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.03em;
}

.volume-group-count {
  font-size: 12px;
  color: var(--ink-3);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

/* 章节网格 */
.chapters-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 1250px) { .chapters-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .chapters-grid { grid-template-columns: 1fr; } }

.chapter-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 14px 16px 6px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--ink-4);
  border-radius: var(--r-s);
  background: var(--paper);
  transition: all var(--motion-fast);
}

.chapter-card:hover {
  border-left-color: var(--zhu);
  box-shadow: var(--shadow-1);
}

.chapter-main {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chapter-main:focus-visible {
  outline: 2px solid var(--zhu);
  outline-offset: 2px;
  border-radius: var(--r-s);
}

.chapter-main:hover .chapter-title {
  color: var(--zhu);
}

.chapter-number {
  font-size: 11px;
  color: var(--zhu);
  font-weight: 600;
  letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums;
}

.chapter-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.delete-btn {
  opacity: 0;
  transition: opacity var(--motion-fast);
}

.chapter-card:hover .delete-btn {
  opacity: 1;
}

.chapter-title {
  margin: 0;
  font-family: var(--f-serif);
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  transition: color var(--motion-fast);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chapter-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-dot.draft { background: var(--ink-4); }
.status-dot.writing { background: var(--jin); }
.status-dot.completed { background: var(--qing); }
.status-dot.reviewed { background: var(--dai); }
.status-dot.finalized { background: var(--zhu); }
.status-dot.locked { background: var(--ink-2); }

.meta-sep { color: var(--line-2); }

.chapter-preview {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--ink-3);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 单章总结切换 */
.summary-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  margin-top: 8px;
  border-top: 1px solid var(--line);
  cursor: pointer;
  font-size: 12px;
}

.summary-indicator {
  color: var(--ink-3);
}

.summary-indicator.has-summary {
  color: var(--dai);
}

.summary-arrow {
  font-size: 10px;
  color: var(--ink-3);
}

/* 单章总结面板 */
.summary-panel {
  padding: 8px 0;
  animation: slideDown 0.15s ease;
}

@keyframes slideDown {
  from { opacity: 0; max-height: 0; }
  to { opacity: 1; max-height: 300px; }
}

.summary-text {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink-2);
  white-space: pre-wrap;
  margin-bottom: 6px;
}

.summary-text.no-content {
  color: var(--ink-4);
  font-style: italic;
}

.summary-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 6px;
}
.archived-chapters { margin-bottom: 16px; padding: 16px; }
.archived-chapter-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.archived-chapters pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 60vh; overflow: auto; }
</style>
