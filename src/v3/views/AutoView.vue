<template>
  <Teleport defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link>
    <span class="crumb-sep">/</span>
    <span class="crumb-b">自动写作 · 运行中心</span>
  </Teleport>
  <Teleport defer to="#v3-tools">
    <span v-if="latestRun" class="run-top-status" :class="latestRun.status">{{ statusLabel(latestRun.status) }}</span>
  </Teleport>

  <div v-if="loading" class="auto-state">正在读取自动写作任务…</div>
  <div v-else-if="error" class="auto-state error">{{ error }}</div>
  <div v-else-if="!novel" class="auto-state error">作品不存在。</div>
  <div v-else class="auto-view">
    <div class="auto-page">
    <aside class="auto-config" aria-label="运行配置">
      <div class="eyebrow">运行配置</div>
      <h1>《{{ novel.title }}》</h1>
      <dl>
        <dt>章节范围</dt><dd><span class="num">{{ rangeText }}</span></dd>
        <dt>章纲来源</dt><dd>{{ planSource }}</dd>
        <dt>模型</dt><dd>{{ modelText }}</dd>
        <dt>每章字数</dt><dd class="num">{{ lengthText }}</dd>
        <dt>单章篇幅</dt>
        <dd>
          <form class="length-policy" aria-label="单章篇幅设置" @submit.prevent="saveLengthPolicy">
            <fieldset :disabled="lengthPolicyLocked">
              <div class="length-fields">
                <label>下限
                  <input aria-label="每章最低字数" type="number" min="100" max="20000" step="1" inputmode="numeric"
                    :value="lengthInputs.minWords" @input="updateLengthInput('minWords', $event)" />
                </label>
                <label>目标
                  <input aria-label="每章目标字数" type="number" min="100" max="20000" step="1" inputmode="numeric"
                    :value="lengthInputs.targetWords" @input="updateLengthInput('targetWords', $event)" />
                </label>
                <label>上限
                  <input aria-label="每章最高字数" type="number" min="100" max="20000" step="1" inputmode="numeric"
                    :value="lengthInputs.maxWords" @input="updateLengthInput('maxWords', $event)" />
                </label>
              </div>
              <p class="length-help">目标用于生成指引，范围用于定稿检查；正文不会按字数硬截断。</p>
              <p v-if="lengthPolicyIssue" class="length-issue" role="status">{{ lengthPolicyIssue }}</p>
              <div class="length-actions">
                <button class="m-btn" type="submit" :disabled="!canSaveLengthPolicy || lengthSaving">{{ lengthSaving ? '保存中…' : '保存篇幅' }}</button>
              </div>
            </fieldset>
            <p v-if="lengthPolicyLocked" class="length-state" role="status">任务尚未结束或仍可恢复，篇幅设置已锁定。</p>
            <p v-else-if="lengthSaveState === 'saved'" class="length-state" role="status">篇幅设置已保存。</p>
            <p v-else-if="lengthSaveState === 'error'" class="length-state error" role="alert">保存失败，设置仍保留在当前页面。可再次保存。</p>
          </form>
        </dd>
        <dt>Token 预算</dt><dd class="num">{{ budget.cap === undefined ? '开始任务时设定' : `${fmt(budget.cap)} · 请求上限 ${fmt(budget.requestLimit)}` }}</dd>
        <dt>停止条件</dt>
        <dd><ul class="stops"><li v-for="item in stops" :key="item">{{ item }}</li></ul></dd>
        <dt>写入方式</dt>
        <dd><span class="m-tag line"><V3Icon name="lock" size="s" />只生成候选稿，不写入正式正文</span></dd>
      </dl>
    </aside>

    <main class="auto-main" aria-label="章节流水线">
      <section class="runbar" :class="latestRun?.status || 'idle'">
        <span class="st"><i aria-hidden="true" />{{ latestRun ? statusLabel(latestRun.status) : '尚未开始任务' }}</span>
        <span v-if="latestRun" class="tiny">第 {{ progressChapter }} 章 · {{ checkpointText }}</span>
        <span class="grow" />
        <div class="runbar-actions">
          <button v-if="runIsActive" class="m-btn" type="button" @click="invokeRunControl('pauseAutonomousRun')">暂停</button>
          <button v-else-if="runIsInterrupted" class="m-btn" type="button" @click="invokeRunControl('recoverAutonomousRun')">恢复中断任务</button>
          <button v-else-if="runCanResume" class="m-btn" type="button" @click="invokeRunControl('resumeAutonomousRun')">继续任务</button>
          <button v-if="runCanCancel" class="m-btn stop" type="button" @click="invokeRunControl('cancelAutonomousRun')">停止</button>
          <button class="m-btn" type="button" :aria-expanded="controlOpen" @click="controlOpen = !controlOpen">{{ controlOpen ? '收起任务控制' : latestRun ? '任务控制' : '设置并开始任务' }}</button>
        </div>
      </section>
      <p v-if="latestRun?.error && latestRun.status !== 'completed'" class="run-note" role="status">{{ latestRun.error }}</p>

      <article v-for="row in pipeline" :key="row.chapter.id" class="rch" :class="row.stage">
        <div class="rch-h">
          <span class="num muted">{{ row.chapter.chapterIndex + 1 }}</span><b>{{ chapterTitleForDisplay(row.chapter.title, row.chapter.chapterIndex) }}</b>
          <span class="r">
            <span v-if="row.draftWords !== null" class="m-tag jin">候选稿 · {{ row.draftWords.toLocaleString() }} 字</span>
            <span v-if="row.findingCount !== null" class="m-tag line">{{ row.findingCount }} 条提示</span>
            <span v-if="row.stageLabel" class="m-tag" :class="stageTone[row.stage]">{{ row.stageLabel }}</span>
          </span>
        </div>
        <div class="pipe"><span v-for="(state, index) in row.steps" :key="index" :class="state">{{ steps[index].label }}</span></div>
        <p v-if="row.note" class="rch-note">{{ row.note }}</p>
        <div v-if="showCheckpoint(row)" class="ckpt">检查点 · 每 {{ latestRun!.checkpointEvery }} 章暂停，等待作者确认后继续</div>
      </article>
      <p v-if="!pipeline.length" class="empty-pipeline">当前作品还没有章节。请先创建章节，再启动自动写作任务。</p>
    </main>

    <aside class="auto-ledger" aria-label="预算与运行日志">
      <section class="budget">
        <h2 class="h-sec">预算</h2>
        <div class="bmeter" role="img" :aria-label="`已结算 ${budget.settledPercent}%，预留 ${budget.reservedPercent}%`"><i class="used" :style="{ width: budget.settledPercent + '%' }" /><i class="held" :style="{ width: budget.reservedPercent + '%' }" /></div>
        <div class="bm-l"><span>已结算 <b>{{ fmt(budget.settled) }}</b></span><span>预留 <b>{{ fmt(budget.reserved) }}</b></span></div>
        <div class="bm-l second"><span>剩余</span><b>{{ fmt(budget.remaining) }}</b></div>
        <div class="bm-l second"><span>请求</span><b>{{ budget.requests }}{{ budget.requestLimit ? ' / ' + budget.requestLimit : '' }}</b></div>
        <table v-if="ledger.length" class="ledger"><tbody><tr v-for="row in ledger" :key="row.key"><td>{{ row.label }}<small v-if="row.reserved">（进行中）</small></td><td>{{ row.reserved ? '预留 ' : '' }}{{ fmt(row.tokens) }}</td></tr></tbody></table>
        <p v-else class="ledger-empty">任务开始后会在这里显示请求账本。</p>
      </section>
      <h2 class="h-sec">运行日志</h2>
      <ol v-if="logRows.length" class="log"><li v-for="row in logRows" :key="row.id"><b>{{ row.time }}</b>第 {{ row.chapter }} 章 {{ row.phase }} · {{ row.status }}</li></ol>
      <p v-else class="ledger-empty log-empty">暂无运行记录。</p>
      <p class="iso"><V3Icon name="refresh" size="s" /><span>中断后可从最近检查点恢复，已完成的请求不会重复计费。</span></p>
    </aside>

    </div>

    <button v-if="controlOpen" class="control-backdrop" type="button" aria-label="关闭任务控制" @click="controlOpen = false" />
    <section v-show="controlOpen" class="control-drawer" :class="{ open: controlOpen }" role="dialog" aria-label="自动任务控制" :aria-hidden="!controlOpen" @keydown.esc="controlOpen = false">
      <header><div><h2>章节任务与作者控制</h2><p>设置范围、预算和检查点，暂停、继续、取消任务，并处理候选稿。</p></div><button class="m-ibtn" type="button" aria-label="关闭任务控制" @click="controlOpen = false"><V3Icon name="x" size="s" /></button></header>
      <div class="drawer-body"><ChapterList v-if="controlMounted" ref="chapterListRef" :focus-last-chapter="false" /></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import ChapterList from '@/views/workspace/ChapterList.vue'
import V3Icon from '../components/V3Icon.vue'
import { PIPELINE_STEPS, checkpointOf, deriveBudget, deriveLedger, derivePipeline, lengthRange, phaseLabel, stopConditions, type PipelineRow } from '../selectors/autoRun'
import { isAutonomousRunActive } from '@/services/reconstructionAutonomous'
import { resolveChapterLengthPolicy, type ChapterLengthPolicy } from '@/services/chapterLength'
import type { AiRun, AiRunRequest } from '@/types/reconstruction'

defineOptions({ name: 'V3AutoView' })
const route = useRoute()
const novels = useNovelStore(), config = useConfigStore()
const workspace = useReconstructionWorkspaceStore()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const novel = computed(() => novels.getNovel(novelId.value))
const loading = ref(true), error = ref('')
const controlOpen = ref(false)
const lengthInputs = ref({ minWords: '', targetWords: '', maxWords: '' })
const lengthSaving = ref(false)
const lengthSaveState = ref<'idle' | 'saved' | 'error'>('idle')
let lengthFormRevision = 0
// 任务控制区里的章节列表一旦挂载就保留，让正在运行的任务不会因关闭抽屉而被当成“离开页面”暂停。
const controlMounted = ref(false)
watch(controlOpen, open => { if (open) controlMounted.value = true })
const chapterListRef = ref<InstanceType<typeof ChapterList> | null>(null)

const steps = PIPELINE_STEPS
const latestRun = computed<AiRun | undefined>(() => workspace.getAiRuns(novelId.value)
  .filter(run => run.mode === 'autonomous')
  .slice()
  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0])
const runIsActive = computed(() => !!latestRun.value && latestRun.value.status === 'running'
  && isAutonomousRunActive(latestRun.value))
const runIsInterrupted = computed(() => latestRun.value?.status === 'running' && !runIsActive.value)
const runCanResume = computed(() => ['paused', 'needs_author', 'failed'].includes(latestRun.value?.status || ''))
const runCanCancel = computed(() => ['queued', 'running', 'paused', 'needs_author'].includes(latestRun.value?.status || ''))
type RunControlName = 'pauseAutonomousRun' | 'resumeAutonomousRun' | 'cancelAutonomousRun' | 'recoverAutonomousRun'
async function invokeRunControl(name: RunControlName) {
  if (!chapterListRef.value) {
    controlMounted.value = true
    await nextTick()
  }
  await chapterListRef.value?.ensureWorkspace()
  const control = chapterListRef.value?.[name]
  if (control) await control()
}
const pipeline = computed<PipelineRow[]>(() => novel.value ? derivePipeline(novel.value, latestRun.value) : [])
const budget = computed(() => deriveBudget(latestRun.value))
const ledger = computed(() => deriveLedger(latestRun.value))
const stops = computed(() => stopConditions(latestRun.value))
const lengthText = computed(() => novel.value ? lengthRange(novel.value) : '')
const chapterLengthPolicy = computed(() => resolveChapterLengthPolicy(novel.value?.chapterLengthPolicy))
const lengthPolicyLocked = computed(() => ['queued', 'running', 'paused', 'needs_author', 'failed'].includes(latestRun.value?.status || ''))
const lengthPolicyDraft = computed<ChapterLengthPolicy | null>(() => {
  const minWords = Number(lengthInputs.value.minWords)
  const targetWords = Number(lengthInputs.value.targetWords)
  const maxWords = Number(lengthInputs.value.maxWords)
  if (![lengthInputs.value.minWords, lengthInputs.value.targetWords, lengthInputs.value.maxWords].every(value => /^\d+$/.test(value))) return null
  if ([minWords, targetWords, maxWords].some(value => !Number.isInteger(value) || value < 100 || value > 20000)) return null
  if (minWords > targetWords || targetWords > maxWords) return null
  return { minWords, targetWords, maxWords }
})
const lengthPolicyIssue = computed(() => {
  const fields = [lengthInputs.value.minWords, lengthInputs.value.targetWords, lengthInputs.value.maxWords]
  if (fields.some(value => !/^\d+$/.test(value))) return '请填写 100–20,000 之间的整数。'
  const [minWords, targetWords, maxWords] = fields.map(Number)
  if ([minWords, targetWords, maxWords].some(value => value < 100 || value > 20000)) return '每项需在 100–20,000 字之间。'
  if (minWords > targetWords || targetWords > maxWords) return '字数顺序需满足下限 ≤ 目标 ≤ 上限。'
  return ''
})
const canSaveLengthPolicy = computed(() => {
  const draft = lengthPolicyDraft.value
  return !!draft && !lengthPolicyLocked.value && !!novel.value
    && (draft.minWords !== chapterLengthPolicy.value.minWords
      || draft.targetWords !== chapterLengthPolicy.value.targetWords
      || draft.maxWords !== chapterLengthPolicy.value.maxWords)
})
const stageTone: Record<PipelineRow['stage'], string> = { queued: 'line', writing: 'dai', reviewing: 'dai', waiting_author: 'jin', accepted: 'qing', rejected: 'zhu', blocked: 'line', existing: 'line', outside: 'line' }

watch([novelId, chapterLengthPolicy], ([id, policy], [previousId]) => {
  if (id !== previousId) {
    lengthFormRevision++
    lengthSaveState.value = 'idle'
  }
  if (lengthSaving.value && id === previousId) return
  lengthInputs.value = {
    minWords: String(policy.minWords),
    targetWords: String(policy.targetWords),
    maxWords: String(policy.maxWords),
  }
}, { immediate: true })

function updateLengthInput(field: keyof ChapterLengthPolicy, event: Event) {
  lengthInputs.value[field] = (event.currentTarget as HTMLInputElement).value
  lengthFormRevision++
  lengthSaveState.value = 'idle'
}

async function saveLengthPolicy() {
  const policy = lengthPolicyDraft.value
  if (!policy || !novel.value || !canSaveLengthPolicy.value || lengthSaving.value) return
  const id = novelId.value
  const revision = lengthFormRevision
  lengthSaving.value = true
  lengthSaveState.value = 'idle'
  try {
    await novels.saveChapterLengthPolicy(id, policy)
    if (novelId.value === id && lengthFormRevision === revision) lengthSaveState.value = 'saved'
  } catch {
    if (novelId.value === id && lengthFormRevision === revision) lengthSaveState.value = 'error'
  } finally {
    lengthSaving.value = false
  }
}

const rangeText = computed(() => {
  const run = latestRun.value
  if (run?.chapterStart !== undefined && run.chapterEnd !== undefined) return `${run.chapterStart + 1} — ${run.chapterEnd + 1} · ${run.chapterEnd - run.chapterStart + 1} 章`
  const count = novel.value?.chapters.length || 0
  return count ? `1 — ${count} · ${count} 章（尚未开始）` : '尚未设置'
})
const planSource = computed(() => {
  const chapters = novel.value?.chapters || [], plans = novel.value?.chapterPlans || []
  if (!plans.length) return '等待作者确认章纲'
  const run = latestRun.value, start = run?.chapterStart ?? 0, end = run?.chapterEnd ?? chapters.length - 1
  const covered = chapters.filter(chapter => chapter.chapterIndex >= start && chapter.chapterIndex <= end
    && plans.some(plan => plan.targetChapterStart <= chapter.chapterIndex && plan.targetChapterEnd >= chapter.chapterIndex)).length
  const total = Math.max(0, Math.min(end, chapters.length - 1) - start + 1)
  return covered >= total ? `范围内 ${total} 章均有章纲` : `范围内 ${covered}/${total} 章有章纲，其余待生成并确认`
})
const modelText = computed(() => {
  const writing = config.getModelForTask('writing'), review = config.getModelForTask('review') || writing
  if (!writing) return '尚未配置写作模型'
  const label = (model: typeof writing) => model.name && model.name !== model.modelName ? model.name : model.modelName
  return `写作 ${label(writing)} · 审校 ${review ? label(review) : '未配置'}`
})
const progressChapter = computed(() => {
  const point = checkpointOf(latestRun.value)
  return point ? point.chapterIndex + 1 : latestRun.value?.chapterStart !== undefined ? latestRun.value.chapterStart + 1 : 1
})
const checkpointText = computed(() => {
  const run = latestRun.value, point = checkpointOf(run)
  if (!run) return ''
  if (!point) return run.status === 'completed' ? '范围内章节已处理完' : '尚未产生检查点'
  return ({ started: '处理尚未完成', completed: '处理完成', reviewed: '审核完成', checkpoint: '达到作者检查点，等待你确认', 'review-needs-author': '审核等待作者处理', 'needs-author': '等待作者核对' } as Record<string, string>)[point.phase]
})
// 检查点横幅只出现在真正到达检查点的那一章下面。
function showCheckpoint(row: PipelineRow) {
  const point = checkpointOf(latestRun.value)
  return !!latestRun.value?.checkpointEvery && point?.phase === 'checkpoint' && point.chapterIndex === row.chapter.chapterIndex
}

const logRows = computed(() => (latestRun.value?.requests || []).slice(-8).reverse().map(request => ({
  id: request.id, chapter: request.chapterIndex + 1, phase: phaseLabel[request.phase], status: requestStatus(request.status),
  time: (request.completedAt || request.startedAt || '').slice(11, 19),
})))

function fmt(value: number | undefined) { return value === undefined ? '—' : value.toLocaleString() }
function statusLabel(status: AiRun['status']) { return ({ queued: '排队中', running: '运行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消', needs_author: '等待作者确认' } as Record<AiRun['status'], string>)[status] }
function requestStatus(status: AiRunRequest['status']) { return ({ pending: '请求中', completed: '已完成', failed: '失败', interrupted: '已中断', unknown: '结果未知', not_sent: '未发送' } as Record<AiRunRequest['status'], string>)[status] }

onMounted(async () => {
  try {
    if (!novelId.value) throw new Error('自动写作页缺少作品编号。')
    await workspace.hydrateFromPersistence(novelId.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.auto-view { position: absolute; inset: 0; min-width: 0; min-height: 0; overflow: hidden; background: var(--desk); }
.auto-page { position: absolute; inset: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr) 320px; min-height: 0; overflow: hidden; background: var(--desk); }
.num { font-family: var(--f-num); font-variant-numeric: tabular-nums; }
.muted { color: var(--ink-3); }
.tiny { color: var(--ink-3); font-size: 12px; }
.grow { flex: 1; }
.h-sec { margin: 0 0 10px; color: var(--ink-3); font: 600 12px/1 var(--f-ui); letter-spacing: .12em; }
.eyebrow { color: var(--zhu); font-size: 11px; letter-spacing: .12em; }

.auto-config { min-height: 0; overflow: auto; padding: 20px; border-right: 1px solid var(--line); background: var(--panel); }
.auto-config h1 { margin: 4px 0 0; font: 600 18px var(--f-serif); }
.auto-config dl { margin: 0; font-size: 13px; }
.auto-config dt { margin: 14px 0 5px; color: var(--ink-3); font-size: 12px; font-weight: 600; }
.auto-config dd { margin: 0; color: var(--ink-2); line-height: 1.6; overflow-wrap: anywhere; }
.length-policy fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.length-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.length-fields label { display: grid; min-width: 0; gap: 4px; color: var(--ink-3); font-size: 11px; }
.length-fields input { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; padding: 4px 6px; border: 1px solid var(--line-2); border-radius: 5px; background: var(--paper); color: var(--ink); font: 12px var(--f-num); }
.length-fields input:focus-visible { outline: 2px solid var(--zhu); outline-offset: 1px; }
.length-help, .length-issue, .length-state { margin: 7px 0 0; font-size: 11px; line-height: 1.55; }
.length-help, .length-state { color: var(--ink-3); }
.length-issue, .length-state.error { color: var(--zhu); }
.length-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
.length-actions .m-btn { min-height: 30px; padding: 4px 10px; }
.length-actions .m-btn:disabled { cursor: not-allowed; opacity: .55; }
.stops { margin: 0; padding: 0; list-style: none; }
.stops li { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 13px; }
.stops li::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--zhu); }

.auto-main { min-width: 0; min-height: 0; overflow: auto; padding: 22px 26px 40px; }
.runbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; padding: 14px 18px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.runbar-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; flex: none; min-width: 0; max-width: 100%; }
.runbar-actions .stop { color: var(--zhu); }
.runbar .st { display: flex; flex-shrink: 0; align-items: center; gap: 8px; font-weight: 600; }
.runbar .st i { width: 9px; height: 9px; border-radius: 50%; background: var(--ink-4); }
.runbar.running .st i { background: var(--qing); animation: auto-pulse 1.4s infinite; }
.runbar.paused .st i, .runbar.needs_author .st i { background: var(--jin); }
.runbar.failed .st i { background: var(--zhu); }
.runbar.completed .st i { background: var(--qing); }
@keyframes auto-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .runbar.running .st i { animation: none; } }
.run-note { margin: -6px 0 14px; padding: 10px 14px; border-radius: 7px; background: var(--jin-soft); color: var(--jin); font-size: 12px; line-height: 1.7; }

.rch { margin-bottom: 10px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.rch.existing, .rch.blocked, .rch.queued { background: color-mix(in srgb, var(--paper) 70%, var(--panel)); }
.rch-h { display: flex; align-items: center; gap: 10px; }
.rch-h b { font: 600 15px var(--f-serif); }
.rch-h .r { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.pipe { display: flex; gap: 4px; margin-top: 10px; }
.pipe span { position: relative; flex: 1; display: grid; place-items: center; height: 26px; overflow: hidden; border-radius: 5px; background: var(--panel-2); color: var(--ink-4); font-size: 11.5px; }
.pipe span.done { background: var(--qing-soft); color: var(--qing); }
.pipe span.current { background: var(--dai-soft); color: var(--dai); font-weight: 600; }
.pipe span.current::after { content: ''; position: absolute; left: 0; bottom: 0; width: 100%; height: 2px; background: var(--dai); }
.pipe span.waiting { background: var(--jin-soft); color: var(--jin); font-weight: 600; }
.rch-note { margin: 8px 0 0; color: var(--ink-3); font-size: 12px; }
.ckpt { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; color: var(--jin); font-size: 12px; }
.ckpt::before { content: ''; flex: none; width: 18px; height: 1px; background: var(--jin); }
.empty-pipeline { padding: 40px; color: var(--ink-3); }

.auto-ledger { min-height: 0; overflow: auto; padding: 20px; border-left: 1px solid var(--line); background: var(--panel); }
.budget { margin-bottom: 14px; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.bmeter { display: flex; height: 10px; margin: 10px 0 8px; overflow: hidden; border-radius: 5px; background: var(--line); }
.bmeter i { display: block; height: 100%; transition: width .4s; }
.bmeter .used { background: var(--ink-2); }
.bmeter .held { background: var(--jin); }
.bm-l { display: flex; justify-content: space-between; color: var(--ink-3); font-size: 12px; }
.bm-l.second { margin-top: 4px; }
.bm-l b { color: var(--ink); font-family: var(--f-num); font-weight: 500; }
.ledger { width: 100%; margin-top: 10px; border-collapse: collapse; font-size: 12px; }
.ledger td { padding: 6px 0; border-top: 1px dashed var(--line); }
.ledger td:last-child { text-align: right; font-family: var(--f-num); }
.ledger small { color: var(--ink-4); }
.ledger-empty { margin: 10px 0 0; color: var(--ink-4); font-size: 12px; }
.log { margin: 0; padding: 10px 12px; max-height: 240px; overflow: auto; list-style: none; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink-3); font: 11.5px/1.75 var(--f-num); }
.log b { margin-right: 8px; color: var(--ink-2); font-weight: 500; }
.log-empty { padding: 10px 12px; border: 1px dashed var(--line); border-radius: 8px; }
.iso { display: flex; gap: 8px; margin: 12px 0 0; padding: 12px; border: 1px dashed var(--line-2); border-radius: var(--r-m); color: var(--ink-3); font-size: 12px; line-height: 1.7; }
.iso svg { flex: none; margin-top: 3px; }

.control-backdrop { position: absolute; inset: 0; z-index: 20; background: var(--ink); opacity: .22; }
.control-drawer { position: absolute; top: 0; right: 0; bottom: 0; z-index: 21; display: flex; flex-direction: column; width: min(760px, 100%); border-left: 1px solid var(--line-2); background: var(--paper); box-shadow: var(--shadow-3); transform: translateX(102%); visibility: hidden; transition: transform .22s, visibility 0s .22s; }
.control-drawer.open { transform: none; visibility: visible; transition: transform .22s; }
@media (prefers-reduced-motion: reduce) { .control-drawer, .control-drawer.open { transition: none; } }
.control-drawer > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.control-drawer h2 { margin: 0; font: 600 16px var(--f-serif); }
.control-drawer header p { margin: 4px 0 0; color: var(--ink-3); font-size: 12px; }
.drawer-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 20px 24px; }
.drawer-body :deep(.chapter-list) { padding: 0; background: transparent; }

.auto-state { position: absolute; inset: 0; padding: 40px; color: var(--ink-3); }
.auto-state.error { color: var(--zhu); }
.run-top-status { color: var(--ink-3); font-size: 11px; }
.run-top-status.running { color: var(--qing); }
.run-top-status.needs_author, .run-top-status.paused { color: var(--jin); }
.run-top-status.failed { color: var(--zhu); }
.crumb-link { color: var(--ink-3); text-decoration: none; }
.crumb-link:hover { color: var(--zhu); }
.crumb-sep { margin: 0 7px; color: var(--ink-4); }

@media (max-width: 1180px) {
  /* 参照原型保留配置栏与流水线双列，账本在窄屏收起，避免把运行中心压成纵向长页。 */
  .auto-page { grid-template-columns: 280px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); overflow: hidden; }
  .auto-config, .auto-main { overflow: auto; }
  .auto-ledger { display: none; }
  .runbar { flex-wrap: wrap; }
  .runbar .grow { display: none; }
  .runbar-actions { width: 100%; justify-content: flex-end; }
  .runbar-actions .m-btn { max-width: 100%; height: auto; min-height: 32px; white-space: normal; overflow-wrap: anywhere; }
}
@media (max-width: 760px) {
  .auto-page { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(220px, 38%) minmax(0, 1fr); overflow: hidden; }
  .auto-config, .auto-main { min-width: 0; overflow: auto; border: 0; }
  .auto-config { border-bottom: 1px solid var(--line); }
  .auto-main { padding: 16px 16px 28px; }
  .rch-h { flex-wrap: wrap; }
  .rch-h .r { margin-left: 0; justify-content: flex-start; }
  .pipe { flex-wrap: wrap; }
  .pipe span { flex: 1 0 40px; height: auto; min-height: 26px; padding: 4px; font-size: 10px; line-height: 1.4; }
}
</style>
