<template>
  <Teleport defer to="#v3-crumb"><router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">审校中心</span></Teleport>
  <Teleport defer to="#v3-tools">
    <button class="m-btn sm" type="button" :disabled="batchBusy || !reviewModel || !allTargets.length" :title="reviewModel ? '' : '尚未配置审校模型'" @click="runBatchReview(allTargets)">{{ batchBusy ? `审校中 ${batchIndex}/${batchTotal}` : allTargets.length ? `批量审校 ${allTargets.length} 章` : '批量审校' }}</button>
  </Teleport>
  <Teleport defer to="#v3-status"><span class="status-it">{{ snapshot.totals.reviewed }}/{{ snapshot.totals.chapters }} 章已审校</span><span class="status-it">{{ snapshot.totals.blockers }} 条阻塞</span><span class="status-it">{{ snapshot.totals.pendingDecisions }} 项待处理</span></Teleport>

  <div v-if="loading" class="review-loading">正在读取审校工作区…</div>
  <div v-else-if="loadError" class="review-error" role="alert">{{ loadError }}</div>
  <div v-else-if="!novel" class="review-error">作品不存在。</div>
  <div v-else class="review-page">
    <main class="review-main">
      <header class="review-head">
        <div><h1>审校中心</h1><p class="review-sub">全书 {{ snapshot.totals.chapters }} 章 · 按章查看审核状态、失效原因和待处理问题。</p></div>
        <button v-if="focusRow" class="m-btn" type="button" title="优先定位到最需要处理的章节，没有待处理项时为最后一个有正文的章节" @click="openChapter(focusRow.chapter.id)">打开第 {{ focusRow.chapter.chapterIndex + 1 }} 章</button>
      </header>

      <div class="review-pills" role="list" aria-label="审校状态概览">
        <span v-for="pill in reviewPills" :key="pill.key" class="review-pill" role="listitem" :title="pill.hint"><i :class="'d-' + pill.key" aria-hidden="true" />{{ pill.label }} <b class="num">{{ pill.value }}</b></span>
      </div>

      <template v-if="chapterGroups.length">
        <section v-for="group in chapterGroups" :key="group.key" class="heat-group">
          <h2 class="h-sec">{{ group.title }}</h2>
          <div class="heat">
            <button v-for="row in group.rows" :key="row.chapter.id" type="button" class="heat-cell" :class="['h-' + row.heat, { cur: focusRow?.chapter.id === row.chapter.id }]" :title="cellTitle(row)" :aria-label="cellTitle(row)" @click="openChapter(row.chapter.id)"><span class="num">{{ row.chapter.chapterIndex + 1 }}</span></button>
          </div>
        </section>
      </template>
      <p v-else class="empty">还没有章节。</p>

      <section v-if="staleRows.length" class="stale-banner" role="status">
        <V3Icon name="refresh" />
        <div>
          <b>{{ staleRows.length }} 章审核已失效</b>
          <p>{{ staleChapterText }}曾经审校过，之后正文、审核依据或剧情设定发生了变化（{{ staleReasons }}）。重新审校后才恢复有效。<template v-if="lockedStale">另有 {{ lockedStale }} 章已锁定，需先解锁。</template></p>
        </div>
        <button class="m-btn" type="button" :disabled="batchBusy || !reviewModel || !staleTargets.length" :title="reviewModel ? '' : '尚未配置审校模型'" @click="runBatchReview(staleTargets)">批量重审 {{ staleTargets.length }} 章</button>
      </section>
      <p v-if="batchError" class="batch-error" role="alert">{{ batchError }}</p>

      <h2 class="h-sec queue-title">待处理问题</h2>
      <div v-if="snapshot.queue.length" class="qwrap">
        <table class="qtable">
          <thead><tr><th>级别</th><th>章</th><th>类型</th><th>问题</th><th /></tr></thead>
          <tbody>
            <tr v-for="item in snapshot.queue" :key="item.id">
              <td><span class="m-tag" :class="levelTag[item.level].tone">{{ levelTag[item.level].label }}</span></td>
              <td class="num"><button type="button" class="chapter-link" :aria-label="'打开第' + (item.chapterIndex + 1) + '章'" @click="openChapter(item.chapterId)">{{ item.chapterIndex + 1 }}</button></td>
              <td>{{ item.category }}</td>
              <td><strong>{{ item.title }}</strong><small v-if="item.detail">{{ item.detail }}</small></td>
              <td class="act">
                <button v-if="item.kind === 'review'" class="m-btn sm" type="button" :disabled="batchBusy || taskStatus[item.chapterId] === 'running' || !reviewModel" :title="reviewModel ? '' : '尚未配置审校模型'" @click="reviewOne(item.chapterId)">{{ reviewLabel(item.chapterId) }}</button>
                <button v-else class="m-btn sm" type="button" @click="openChapter(item.chapterId)">处理</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-card">当前没有待处理项目。</p>
    </main>

    <aside class="review-guide" aria-label="五层审校与作者处理">
      <h2 class="h-sec">五层审校</h2>
      <div v-for="(layer, index) in reviewLayers" :key="layer.title" class="layer"><span class="no num">{{ index + 1 }}</span><div><b>{{ layer.title }}</b><p>{{ layer.detail }}</p></div></div>
      <h2 class="h-sec author-title">全书作者处理</h2>
      <div class="author-stats"><span>采纳修改 <b class="num">{{ authorProcessing.accepted }}</b></span><span>有意设计 <b class="num">{{ authorProcessing.intentional }}</b></span><span>延后 <b class="num">{{ authorProcessing.deferred }}</b></span><span>驳回误报 <b class="num">{{ authorProcessing.rejected }}</b></span></div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { buildReviewContextVersion } from '@/services/reconstructionReviewVersion'
import { buildChapterReviewInput, buildChapterReviewSubmission } from '@/services/chapterReviewInput'
import { requestCoveredContentReview } from '@/services/chapterReview'
import type { StoredReviewCoverage } from '@/services/chapterReviewCoverage'
import V3Icon from '../components/V3Icon.vue'
import { deriveReviewCenter, type ReviewCenterRow, type ReviewCenterSnapshot, type ReviewHeat, type ReviewQueueLevel } from '../selectors/reviewCenter'

defineOptions({ name: 'V3ReviewView' })
const route = useRoute(), router = useRouter()
const novelStore = useNovelStore(), knowledge = useKnowledgeStore(), config = useConfigStore(), workspace = useReconstructionWorkspaceStore()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const novel = computed(() => novelStore.getNovel(novelId.value))
const loading = ref(true), loadError = ref(''), batchBusy = ref(false), batchIndex = ref(0), batchTotal = ref(0), batchError = ref('')
const taskStatus = reactive<Record<string, 'queued' | 'running' | 'done' | 'error'>>({})
const reviewModel = computed(() => config.getModelForTask('review') || config.getModelForTask('writing'))

const emptySnapshot: ReviewCenterSnapshot = { rows: [], queue: [], totals: { chapters: 0, reviewed: 0, needsReview: 0, stale: 0, blockers: 0, pendingDecisions: 0 } }
const snapshot = computed<ReviewCenterSnapshot>(() => {
  const current = novel.value
  if (!current) return emptySnapshot
  return deriveReviewCenter({ novel: current, findings: workspace.getReviewFindings(current.id), candidates: workspace.getCandidates(current.id), reviews: workspace.getChapterReviews(current.id), impactReports: workspace.getImpactReports(current.id),
    contextVersion: chapter => buildReviewContextVersion(current, chapter, knowledge.knowledgeBases, workspace.getCreationDraft(current.id), workspace.getCanonMutations(current.id), workspace.getStoryMemories(current.id)) })
})
const rows = computed(() => snapshot.value.rows)

const heatLabel: Record<ReviewHeat, string> = { idea: '构思', outlined: '章纲', drafting: '待审校', reviewing: '审校中', revision: '待修订', ready: '可定稿', stale: '审核失效', final: '定稿' }
const heatOrder: ReviewHeat[] = ['final', 'ready', 'revision', 'stale', 'reviewing', 'drafting', 'outlined', 'idea']
const levelTag: Record<ReviewQueueLevel, { tone: string; label: string }> = {
  blocker: { tone: 'zhu', label: '阻塞' }, warning: { tone: 'jin', label: '提醒' }, suggestion: { tone: 'dai', label: '建议' },
  candidate: { tone: 'qing', label: '候选' }, review: { tone: 'zi', label: '重审' },
}
const reviewLayers = [
  { title: '确定性检查', detail: '字数、占位符、重复段落、名称一致、事件顺序' },
  { title: '结构化提取', detail: '新增人物、事件、关系、知情变化、伏笔变化' },
  { title: '连续性检查', detail: '时间、地点、人物状态、物品归属、角色知情' },
  { title: 'AI 语义审核', detail: '章纲完成度、因果、动机、视角、节奏' },
  { title: '作者确认', detail: '逐条接受、拒绝、编辑、延后或标为有意设计' },
]

const reviewPills = computed(() => {
  const counts = new Map<ReviewHeat, number>()
  for (const row of rows.value) counts.set(row.heat, (counts.get(row.heat) || 0) + 1)
  return [
    // 入典是逐条故事变化的记录数，不是按章统计；入典记录没有“章级入典”状态，所以这里不按章冒充。
    { key: 'canon', label: '入典', value: workspace.getCanonMutations(novelId.value).length, hint: '已逐条确认入典的故事记录条数，不按章计' },
    ...heatOrder.filter(key => counts.get(key)).map(key => ({ key, label: heatLabel[key], value: counts.get(key)!, hint: '按章统计' })),
  ]
})

const authorProcessing = computed(() => {
  const findings = workspace.getReviewFindings(novelId.value)
  const candidates = workspace.getCandidates(novelId.value)
  return {
    accepted: findings.filter(item => item.status === 'accepted').length
      + candidates.filter(item => ['accepted', 'edited', 'merged'].includes(item.status)).length,
    intentional: findings.filter(item => item.status === 'intentional').length,
    deferred: findings.filter(item => item.status === 'deferred').length
      + candidates.filter(item => item.status === 'deferred').length,
    rejected: findings.filter(item => item.status === 'rejected').length
      + candidates.filter(item => item.status === 'rejected').length,
  }
})

const chapterGroups = computed(() => {
  const groups = new Map<number, { key: number; title: string; rows: ReviewCenterRow[] }>()
  const volumes = novel.value?.volumes || []
  const volumeTitle = (volumeIndex: number) => volumeIndex >= 0
    ? volumes.find(volume => volume.volumeIndex === volumeIndex)?.title || `第${volumeIndex + 1}卷`
    : '未分卷'
  for (const row of rows.value) {
    const key = row.chapter.volumeIndex
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, title: volumeTitle(key), rows: [row] })
  }
  return [...groups.values()].sort((left, right) => left.key - right.key)
})

// “当前章”：最需要处理的章节（队列已按严重程度排序）；没有待处理项时取最后一个有正文的章节。
const focusRow = computed(() => {
  const first = snapshot.value.queue[0]
  return (first && rows.value.find(row => row.chapter.id === first.chapterId))
    || [...rows.value].reverse().find(row => row.chapter.content.trim())
    || rows.value[0]
})
function cellTitle(row: ReviewCenterRow) {
  const reason = row.reviewStale && row.invalidationReason ? ` · ${row.invalidationReason}` : ''
  return `第${row.chapter.chapterIndex + 1}章 · ${heatLabel[row.heat]}${reason} · ${row.chapter.wordCount.toLocaleString()} 字`
}

const staleRows = computed(() => rows.value.filter(row => row.reviewStale))
const staleTargets = computed(() => staleRows.value.filter(row => !row.workflow.locked))
const lockedStale = computed(() => staleRows.value.length - staleTargets.value.length)
// 需要（重新）审校：从未审校，或审核已失效；已定稿且审核仍有效的章、已有当前审校结果的章不重复请求模型。
const allTargets = computed(() => rows.value.filter(row => row.chapter.content.trim() && !row.workflow.locked && (row.status === 'needs_review' || row.reviewStale)))
const staleChapterText = computed(() => {
  const numbers = staleRows.value.map(row => row.chapter.chapterIndex + 1)
  return numbers.length > 8 ? `第 ${numbers.slice(0, 8).join('、')} 等 ${numbers.length} 章` : `第 ${numbers.join('、')} 章`
})
const staleReasons = computed(() => {
  const counts = new Map<string, number>()
  for (const row of staleRows.value) {
    const reason = row.invalidationReason || '审核已不再对应当前内容'
    counts.set(reason, (counts.get(reason) || 0) + 1)
  }
  return [...counts].map(([reason, count]) => `${reason} ${count} 章`).join(' · ')
})
function reviewLabel(chapterId: string) { return taskStatus[chapterId] === 'running' ? '审校中' : taskStatus[chapterId] === 'error' ? '重试' : '审校' }

async function hydrate() {
  loading.value = true; loadError.value = ''
  try { if (!novelId.value) throw new Error('审校中心缺少作品编号。'); await workspace.hydrateFromPersistence(novelId.value) }
  catch (error) { loadError.value = error instanceof Error ? error.message : String(error) }
  finally { loading.value = false }
}
onMounted(() => { void hydrate() })
function openChapter(chapterId: string) { router.push(`/write/${novelId.value}/${chapterId}`) }

async function reviewOne(chapterId: string) {
  const currentNovel = novelStore.getNovel(novelId.value), currentChapter = currentNovel?.chapters.find(chapter => chapter.id === chapterId), model = reviewModel.value
  if (!currentNovel || !currentChapter || !model || !currentChapter.content.trim()) return
  taskStatus[chapterId] = 'running'; batchError.value = ''
  try {
    const source = currentChapter.content
    const input = buildChapterReviewInput(currentNovel, currentChapter, { knowledge: knowledge.knowledgeBases, creationDraft: workspace.getCreationDraft(currentNovel.id), canonMutations: workspace.getCanonMutations(currentNovel.id), storyMemories: workspace.getStoryMemories(currentNovel.id) })
    const signature = input.signature
    const ensureCurrent = () => {
      const latestNovel = novelStore.getNovel(currentNovel.id), latestChapter = latestNovel?.chapters.find(chapter => chapter.id === chapterId)
      if (!latestNovel || !latestChapter || latestChapter.content !== source || buildChapterReviewInput(latestNovel, latestChapter, { knowledge: knowledge.knowledgeBases, creationDraft: workspace.getCreationDraft(latestNovel.id), canonMutations: workspace.getCanonMutations(latestNovel.id), storyMemories: workspace.getStoryMemories(latestNovel.id) }).signature !== signature) throw new Error('正文或审核依据已变化，未采用旧版本审校结果。')
    }
    let coverage: StoredReviewCoverage | undefined
    const reviewText = await requestCoveredContentReview({ source, chapterIndex: currentChapter.chapterIndex, model, buildContext: input.buildContext, ensureCurrent, checkpoint: currentChapter.contentReviewCoverage?.checkpoint, checkpointKey: signature,
      onProgress: value => { coverage = { ...value, signature }; novelStore.updateChapter(currentNovel.id, chapterId, { contentReviewCoverage: coverage }) },
      onCheckpoint: async value => { ensureCurrent(); const next = { ...value, signature }; novelStore.updateChapter(currentNovel.id, chapterId, { contentReviewCoverage: next }); await novelStore.saveNovelNow(currentNovel.id); ensureCurrent() } })
    ensureCurrent()
    if (!coverage) throw new Error('审校覆盖进度缺失。')
    await workspace.commitChapterReview(currentNovel.id, buildChapterReviewSubmission(input, reviewText, coverage, workspace.getChapterReviews(currentNovel.id, chapterId), workspace.getCandidates(currentNovel.id), new Date().toISOString()))
    taskStatus[chapterId] = 'done'
  } catch (error) { taskStatus[chapterId] = 'error'; batchError.value = error instanceof Error ? error.message : String(error) }
}

async function runBatchReview(targets: ReviewCenterRow[]) {
  if (batchBusy.value || !reviewModel.value) return
  // 先固定要审校的章节：逐章提交会改变快照，不能边审边重新计算范围。
  const ids = targets.map(row => row.chapter.id)
  if (!ids.length) { batchError.value = '当前没有需要审校的章节。'; return }
  batchBusy.value = true; batchIndex.value = 0; batchTotal.value = ids.length; batchError.value = ''
  try { for (const id of ids) { batchIndex.value++; await reviewOne(id) } }
  finally { batchBusy.value = false }
}
</script>

<style scoped>
.review-page { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: 0; background: var(--desk); }
.review-main { min-width: 0; overflow: auto; padding: 22px 28px 40px; }
.review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.review-head h1 { margin: 0 0 3px; font: 600 18px var(--f-serif); letter-spacing: .06em; }
.review-sub { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.num { font-family: var(--f-num); font-variant-numeric: tabular-nums; }
.h-sec { margin: 0 0 10px; color: var(--ink-3); font: 600 12px/1 var(--f-ui); letter-spacing: .12em; }

.review-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.review-pill { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--line); border-radius: 13px; background: var(--paper); color: var(--ink-3); font-size: 12px; }
.review-pill b { color: var(--ink-2); font-weight: 600; }
.review-pill i { flex: none; width: 7px; height: 7px; border-radius: 50%; }
.d-canon { background: var(--ink-2); box-shadow: 0 0 0 2px var(--zhu-soft); }
.d-final { background: var(--qing); }
.d-ready { background: color-mix(in srgb, var(--qing) 30%, var(--paper)); box-shadow: inset 0 0 0 1.5px var(--qing); }
.d-revision { background: var(--zhu); }
.d-stale { background: var(--zi); }
.d-reviewing { background: var(--jin); }
.d-drafting { background: var(--dai); }
.d-outlined { border: 1.5px solid var(--ink-4); }
.d-idea { border: 1.5px dashed var(--ink-4); }

.heat-group .h-sec { margin-top: 14px; }
.heat { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 5px; margin: 8px 0 6px; }
.heat-cell { position: relative; display: grid; place-items: center; aspect-ratio: 1; border: 1px solid transparent; border-radius: 4px; color: var(--paper); font-size: 10px; cursor: pointer; transition: transform .15s; }
.heat-cell:hover { transform: scale(1.15); z-index: 2; }
.heat-cell:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; z-index: 2; }
.h-idea { background: var(--panel-2); color: var(--ink-4); border: 1px dashed var(--line-2); }
.h-outlined { background: var(--panel-2); color: var(--ink-3); border: 1px solid var(--line-2); }
.h-drafting { background: var(--dai); }
.h-reviewing { background: var(--jin); }
.h-revision { background: var(--zhu); }
.h-ready { background: color-mix(in srgb, var(--qing) 22%, var(--paper)); color: var(--qing); border-color: var(--qing); }
.h-stale { background: var(--zi); }
.h-final { background: var(--qing); }
.heat-cell.cur { box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--zhu); }

.stale-banner { display: flex; align-items: center; gap: 12px; margin: 18px 0; padding: 14px 16px; border: 1px solid var(--zi-soft); border-radius: var(--r-m); background: var(--zi-soft); }
.stale-banner > svg { flex: none; width: 20px; height: 20px; color: var(--zi); }
.stale-banner > div { flex: 1; min-width: 0; }
.stale-banner p { margin: 3px 0 0; color: var(--ink-2); font-size: 12px; line-height: 1.7; }
.batch-error { margin: 10px 0; padding: 10px 13px; border-radius: 7px; background: var(--zhu-soft); color: var(--zhu); font-size: 12px; }

.queue-title { margin-top: 22px; }
.qwrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.qtable { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 13px; }
.qtable th { padding: 9px 12px; background: var(--panel); color: var(--ink-3); font-size: 11.5px; font-weight: 600; letter-spacing: .05em; text-align: left; }
.qtable td { padding: 10px 12px; border-top: 1px solid var(--line); vertical-align: top; line-height: 1.55; }
.qtable tbody tr:hover td { background: var(--panel); }
.qtable td strong { font-weight: 500; }
.qtable td small { display: -webkit-box; margin-top: 2px; overflow: hidden; color: var(--ink-3); font-size: 12px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.qtable td.act { text-align: right; white-space: nowrap; }
.chapter-link { padding: 0; color: var(--ink); font: inherit; }
.chapter-link:hover { color: var(--zhu); text-decoration: underline; }
.empty-card { margin: 0; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); color: var(--ink-3); font-size: 13px; }

.review-guide { min-width: 0; overflow: auto; padding: 20px; border-left: 1px solid var(--line); background: var(--panel); }
.layer { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px dashed var(--line); }
.layer:last-of-type { border-bottom: 0; }
.layer .no { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--panel-2); font-size: 12px; font-weight: 600; }
.layer b { display: block; font-size: 13.5px; }
.layer p { margin: 2px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.author-title { margin-top: 20px; }
.author-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--ink-2); font-size: 12px; line-height: 2; }
.author-stats span { white-space: nowrap; }
.author-stats b { margin-left: 2px; color: var(--ink); }

.empty, .review-loading, .review-error { padding: 40px; color: var(--ink-3); }
.review-error { color: var(--zhu); }
.crumb-link { color: var(--ink-3); text-decoration: none; }
.crumb-link:hover { color: var(--zhu); }
.crumb-sep { margin: 0 7px; color: var(--ink-4); }

@media (max-width: 1100px) {
  .review-page { display: block; overflow: auto; }
  .review-main { overflow: visible; }
  .review-guide { overflow: visible; border-top: 1px solid var(--line); border-left: 0; }
}
@media (max-width: 680px) {
  .review-main { padding: 18px 14px 32px; }
  .review-guide { padding: 16px; }
  .heat { grid-template-columns: repeat(12, minmax(0, 1fr)); }
  .stale-banner { flex-wrap: wrap; }
  .stale-banner .m-btn { flex: 1 0 100%; }
  /* 窄屏把表格改成一行一张卡片：级别、章、类型排在一行，问题与“处理”各占一行，不再横向滚动。 */
  .qwrap { overflow: visible; border: 0; background: transparent; }
  .qtable, .qtable tbody { display: block; min-width: 0; }
  .qtable thead { display: none; }
  .qtable tr { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 4px 10px; margin-bottom: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
  .qtable td { padding: 0; border: 0; }
  .qtable tbody tr:hover td { background: transparent; }
  .qtable td:nth-child(4) { grid-column: 1 / -1; }
  .qtable td.act { grid-column: 1 / -1; text-align: left; }
  .qtable td:nth-child(2)::before { content: '第'; }
  .qtable td:nth-child(2)::after { content: '章'; }
}
</style>
