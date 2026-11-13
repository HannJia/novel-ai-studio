// Development-only desktop fixture. All prose and model replies are synthetic.
// The desktop workflow imports this module only for an explicit isolated run.
import { useKnowledgeStore } from '@/stores/knowledge'
import { type ModelConfig } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { executeAutonomousRun } from '@/services/reconstructionAutonomous'
import { createAutonomousEmptyChapterProcessor } from '@/services/reconstructionAutonomousChapter'
import { extractAutonomousChapterCandidates } from '@/services/reconstructionAutonomousReview'
import { createAiRun } from '@/services/reconstructionAiRun'
import type { AiChapterDraft, AiRun, AiRunRequest } from '@/types/reconstruction'

export type DesktopAutoWorkflowPhase = 'write' | 'reopen' | 'verify-stale'

export interface DesktopAutoWorkflowInput {
  novelId: string
  /** Two adjacent empty chapters. When omitted, write discovers them. */
  chapterIds?: readonly string[]
  /** Keep this stable when the caller runs phases across process restarts. */
  runId?: string
}

export interface DesktopAutoWorkflowResult {
  phase: DesktopAutoWorkflowPhase
  novelId: string
  runId: string
  chapterIds: string[]
  status: AiRun['status']
  checkpoint?: string
  requestCount: number
  requestCounts: Record<AiRunRequest['phase'], number>
  fetchPhaseCounts: Record<AiRunRequest['phase'], number>
  usedTokens: number
  draftCount: number
  draftStages: Array<AiChapterDraft['stage']>
  reviewCoverageComplete: boolean
  resumed: boolean
  staleRejected?: boolean
  pauseCheckpoint?: string
}

interface ResolvedInput {
  novelId: string
  chapterIds?: readonly string[]
  runId: string
}

interface ResolvedTarget {
  novelId: string
  chapterIds: [string, string]
  chapterIndexes: [number, number]
}

type FixturePhase = AiRunRequest['phase']
type PhaseCounts = Record<FixturePhase, number>

export interface FixtureStats {
  fetchPhaseCounts: PhaseCounts
}

const fixtureEndpoint = 'http://127.0.0.1:1/v3-desktop-auto-fixture'
const defaultRunId = (novelId: string) => `desktop-auto-checkpoint:${novelId}`

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error('V3 desktop auto: ' + message)
}

function normalizeInput(input: DesktopAutoWorkflowInput | string): ResolvedInput {
  if (typeof input === 'string') return { novelId: input, runId: defaultRunId(input) }
  assert(input.novelId.trim(), '缺少小说编号')
  return {
    novelId: input.novelId,
    chapterIds: input.chapterIds,
    runId: input.runId?.trim() || defaultRunId(input.novelId),
  }
}

function assertDesktopEnvironment() {
  assert(typeof window !== 'undefined' && import.meta.env.DEV && window.electronAPI?.projectRequest,
    '需要开发版桌面环境和项目 IPC')
}

function emptyPhaseCounts(): PhaseCounts {
  return { writing: 0, review: 0, analysis: 0 }
}

function resolveTarget(input: ResolvedInput, useRunRange = false): ResolvedTarget {
  const novels = useNovelStore()
  const novel = novels.getNovel(input.novelId)
  assert(novel, '找不到目标作品')

  let chapters = input.chapterIds?.map(id => novel.chapters.find(chapter => chapter.id === id))
  if (useRunRange && (!chapters || chapters.length !== 2)) {
    const run = useReconstructionWorkspaceStore().getAiRun(input.novelId, input.runId)
    assert(run?.chapterStart !== undefined && run.chapterEnd !== undefined, '任务没有可恢复的章节范围')
    chapters = [
      novel.chapters.find(chapter => chapter.chapterIndex === run.chapterStart),
      novel.chapters.find(chapter => chapter.chapterIndex === run.chapterEnd),
    ]
  }

  if (!chapters || chapters.length !== 2 || chapters.some(chapter => !chapter)) {
    if (useRunRange) throw new Error('V3 desktop auto: 任务对应的章节已不存在')
    chapters = novel.chapters
      .filter(chapter => !chapter.content.trim() && chapter.status !== 'locked')
      .sort((left, right) => left.chapterIndex - right.chapterIndex)
      .slice(0, 2)
  }

  assert(chapters.length === 2 && chapters.every(Boolean), '需要两个相邻的空白章节')
  const resolved = chapters as [NonNullable<typeof chapters[number]>, NonNullable<typeof chapters[number]>]
  resolved.sort((left, right) => left.chapterIndex - right.chapterIndex)
  assert(resolved[0].chapterIndex + 1 === resolved[1].chapterIndex, '自动任务章节必须相邻')
  assert(resolved.every(chapter => chapter.status !== 'locked'), '自动任务不能处理锁定章节')
  return {
    novelId: input.novelId,
    chapterIds: [resolved[0].id, resolved[1].id],
    chapterIndexes: [resolved[0].chapterIndex, resolved[1].chapterIndex],
  }
}

export function desktopAutoFixtureModel(): ModelConfig {
  return {
    id: 'desktop-auto-deterministic',
    name: '桌面自动任务确定性替身',
    baseUrl: fixtureEndpoint,
    apiKey: 'synthetic-not-a-real-key',
    modelName: 'synthetic-desktop-auto',
    maxTokens: 4096,
    temperature: 0,
    topP: 1,
    contextWindow: 32000,
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function chapterNumber(prompt: string): number {
  const match = prompt.match(/【本章写作事实卡】[\s\S]*?(?:^|\r?\n)章节：第\s*(\d+)\s*章(?:[^\d]|$)/m)
  assert(match, '写作请求缺少本章事实卡，不能猜测章节编号')
  return Number(match[1])
}

function generatedContent(number: number): string {
  if (number % 2 === 1) return [
    `午后的潮水退到石阶下，林澈带着铜牌走进浮标管理所。自动验收第${number}章从一张航道记录开始，值班人把昨日的巡查簿摊在窗前，解释第二处浮标为什么会在夜里偏移。纸上记着修缮日期和领料人的签名，最末一笔却使用了已经停用的印章。`,
    `他没有急着指认谁伪造记录，而是请值班人取出原始收据，逐项核对绳索的长度与铁环数量。一份收据背面粘着细小的蓝色碎屑，与仓房门缝留下的漆片颜色相近。这个发现只能说明材料可能来自同处，还不足以证明交接人与管理所有直接联系。`,
    `靠近傍晚时，一名送货人抱着空木箱赶来索取签字。他看见铜牌便停下脚步，随后改口说自己走错了地方。林澈把通往后院的门让开，请值班人核实送货地址，同时留意木箱底部用炭笔写下的编号，没有当场惊动对方。`,
    `核对结果表明，那只木箱属于城西修船铺，原本用来运送新铁环，送货单上的目的地却是早已停工的旧船坞。值班人同意保留原单，另写了一张盖有当日印章的凭据。林澈只抄下编号和地址，把铜牌收回衣袋，准备在营业时间查访修船铺。`,
    `夜色落下后，他回到客栈，将航道记录与地图分开装好。这一次留下的是可供复查的收据，没有解开的仍是旧船坞与蓝灯之间的联系。窗外的雨已经停了，他在记录末尾注明尚待核实的部分，决定次日请另一名巡查人独立确认浮标位置。`,
  ].join('\n\n')
  return [
    `天色刚亮，林澈便把昨夜记下的路线重新核对了一遍。自动验收第${number}章的任务只有一个，沿着渡口北侧的旧栈桥找到交接人，并确认钥匙没有被人调包。纸页上的潮痕遮住了半行字，他没有凭猜测补全，而是把缺口标在地图边缘。`,
    `守夜人把一盏未熄的灯放到栏杆上，提醒他雾里有三处浮标，第二处已经偏离原来的位置。林澈先查看水面，再检查桥桩上的刻痕，发现刻痕与信封内侧的暗号相互对应。他因此确定交接地点仍在渡口，却把会面时间往后推了半刻。`,
    `等候期间，他没有打开那封信，而是将钥匙、地图和记录分开收好，分别记下触碰过它们的人。远处传来船铃，雾中有人亮起两次蓝灯。林澈没有立即回应，先让守夜人从侧门离开，再沿着石阶绕到仓房后方观察。`,
    `仓房里的人果然带着一把外形相同的钥匙，但锁孔留下的新划痕暴露了替换痕迹。林澈当场指出差异，要求对方说出信中没有写明的暗语。对方答错后转身逃走，他只取回真正的钥匙和一枚铜牌，没有追入窄巷。`,
    `事情有了明确结果，林澈把铜牌压在地图上，决定天亮后先查浮标的移动记录，再寻找下一位可靠的联络人。他离开渡口时回头看了一眼，确认蓝灯已经熄灭，也确认这次交接没有把陌生人引向客栈。`,
  ].join('\n\n')
}

function reviewReport(): string {
  return '## 结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无\n## 建议修改\n无\n## 编辑建议\n无'
}

function analysisPayload(number: number): string {
  const evidence = `自动验收第${number}章`
  return JSON.stringify({
    events: [{ title: '自动验收检查点', description: `第${number}章完成合成行动。`, type: '主线', characters: [], evidence }],
    characters: [],
    globalPlans: [],
    eventCausalityChanges: [],
    timeAdvanceDays: 0,
    knowledgeChanges: [],
    relationshipChanges: [],
  })
}

export function installDeterministicFetch(stats: FixtureStats, options: { holdWritingChapter?: number } = {}): () => void {
  const previousFetch = window.fetch.bind(window)
  let activeChapterNumber = 0
  let heldWritingRequest = false
  window.fetch = async (input, init) => {
    const url = requestUrl(input)
    if (!url.startsWith(fixtureEndpoint + '/')) {
      assert(new URL(url, location.href).origin === location.origin, '确定性自动任务拦截到非同源网络请求')
      return previousFetch(input, init)
    }

    let payload: { messages?: Array<{ content?: unknown }>; stream?: boolean }
    try { payload = JSON.parse(String(init?.body || '{}')) as typeof payload } catch { throw new Error('确定性自动任务请求不是合法 JSON') }
    const prompt = (payload.messages || []).map(message => String(message.content || '')).join('\n')
    const phase: FixturePhase = payload.stream ? 'review' : prompt.includes('knowledgeChanges') ? 'analysis' : 'writing'
    stats.fetchPhaseCounts[phase] += 1
    if (phase === 'writing') activeChapterNumber = chapterNumber(prompt)
    assert(activeChapterNumber > 0, '批审和分析必须对应本阶段已生成的章节')
    const number = activeChapterNumber
    if (phase === 'writing' && number === options.holdWritingChapter && !heldWritingRequest) {
      heldWritingRequest = true
      const signal = init?.signal
      assert(signal, '在途暂停夹具需要请求取消信号')
      return new Promise<Response>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const usage = phase === 'writing'
      ? { prompt_tokens: 260, completion_tokens: 96, total_tokens: 356 }
      : phase === 'review'
        ? { prompt_tokens: 220, completion_tokens: 48, total_tokens: 268 }
        : { prompt_tokens: 240, completion_tokens: 72, total_tokens: 312 }
    const content = phase === 'writing' ? generatedContent(number) : phase === 'review' ? reviewReport() : analysisPayload(number)

    if (payload.stream) {
      const body = [
        'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] }),
        'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }),
        'data: [DONE]',
        '',
      ].join('\n\n')
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
      { headers: { 'Content-Type': 'application/json' } })
  }
  return () => { window.fetch = previousFetch }
}

function runtimeFor(novelId: string, writingModel: ModelConfig, progress: unknown[]) {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const knowledge = () => {
    try { return useKnowledgeStore().knowledgeBases } catch { return [] }
  }
  return {
    novelId,
    getNovel: () => novels.getNovel(novelId),
    getKnowledgeRevisions: knowledge,
    getCreationDraft: () => workspace.getCreationDraft(novelId),
    getCanonMutations: () => workspace.getCanonMutations(novelId),
    getStoryMemories: () => workspace.getStoryMemories(novelId),
    writingModel,
    reviewModel: writingModel,
    analysisModel: writingModel,
    onReviewProgress: (_bookId: string, _chapterId: string, coverage: unknown) => progress.push(coverage),
    extractCandidates: async (input: { novel: import('@/types/novel').Novel; chapterId: string; model: ModelConfig; signal?: AbortSignal; requestLifecycle: import('@/services/ai').AiRequestLifecycle }) => {
      const chapter = input.novel.chapters.find(row => row.id === input.chapterId)
      if (!chapter) return { candidates: [], error: '确定性夹具找不到分析章节' }
      return extractAutonomousChapterCandidates({ novel: input.novel, chapter, model: input.model,
        canonMutations: workspace.getCanonMutations(novelId), signal: input.signal, requestLifecycle: input.requestLifecycle })
    },
  }
}

function countRequests(run: AiRun): PhaseCounts {
  const counts = emptyPhaseCounts()
  for (const request of run.requests || []) counts[request.phase] += 1
  return counts
}

function assertRequestLedger(run: AiRun, expectedTotal: number) {
  const counts = countRequests(run)
  assert((run.requests || []).length === expectedTotal, `请求账本数量错误：期望 ${expectedTotal}，实际 ${run.requests?.length || 0}`)
  assert(Object.values(counts).every(value => value > 0), '写作、批审、分析阶段请求不完整')
  assert((run.requests || []).every(request => request.status === 'completed'), '请求账本存在未结算条目')
  return counts
}

function assertPhaseCountsEqual(actual: PhaseCounts, expected: PhaseCounts, message: string) {
  for (const phase of ['writing', 'review', 'analysis'] as const) {
    assert(actual[phase] === expected[phase], `${message}（${phase}：期望 ${expected[phase]}，实际 ${actual[phase]}）`)
  }
}

function subtractPhaseCounts(total: PhaseCounts, baseline: PhaseCounts): PhaseCounts {
  const result = emptyPhaseCounts()
  for (const phase of ['writing', 'review', 'analysis'] as const) {
    assert(total[phase] >= baseline[phase], `请求账本阶段计数倒退：${phase}`)
    result[phase] = total[phase] - baseline[phase]
  }
  return result
}

function summarize(phase: DesktopAutoWorkflowPhase, target: ResolvedTarget, run: AiRun, stats: FixtureStats, extra: Partial<DesktopAutoWorkflowResult> = {}): DesktopAutoWorkflowResult {
  const requestCounts = countRequests(run)
  const drafts = run.chapterDrafts || []
  return {
    phase,
    novelId: target.novelId,
    runId: run.id,
    chapterIds: target.chapterIds.slice(),
    status: run.status,
    checkpoint: run.checkpoint,
    requestCount: run.requests?.length || 0,
    requestCounts,
    fetchPhaseCounts: { ...stats.fetchPhaseCounts },
    usedTokens: run.usedTokens || 0,
    draftCount: drafts.length,
    draftStages: drafts.map(draft => draft.stage),
    reviewCoverageComplete: drafts.length > 0 && drafts.every(draft => draft.reviewCoverage?.status === 'complete'),
    resumed: false,
    ...extra,
  }
}

function runtimeAndProcessor(target: ResolvedTarget, progress: unknown[]) {
  const writingModel = desktopAutoFixtureModel()
  return {
    processor: createAutonomousEmptyChapterProcessor(runtimeFor(target.novelId, writingModel, progress)),
    writingModel,
  }
}

export async function write(input: DesktopAutoWorkflowInput | string): Promise<DesktopAutoWorkflowResult> {
  assertDesktopEnvironment()
  const normalized = normalizeInput(input)
  const workspace = useReconstructionWorkspaceStore()
  await workspace.hydrateFromPersistence(normalized.novelId)
  const target = resolveTarget(normalized)
  const novels = useNovelStore()
  const novel = novels.getNovel(target.novelId)!
  assert(target.chapterIds.every(id => novel.chapters.find(chapter => chapter.id === id)?.content.trim() === ''), '写入阶段要求目标章节正文为空')
  assert(!workspace.getAiRun(target.novelId, normalized.runId), '确定性自动任务已经存在，拒绝覆盖')

  const progress: unknown[] = []
  const stats: FixtureStats = { fetchPhaseCounts: emptyPhaseCounts() }
  const restoreFetch = installDeterministicFetch(stats)
  try {
    const { processor } = runtimeAndProcessor(target, progress)
    const run = createAiRun({ id: normalized.runId, mode: 'autonomous', taskType: 'draft', targetId: target.novelId,
      chapterStart: target.chapterIndexes[0], chapterEnd: target.chapterIndexes[1], tokenBudget: 120000,
      requestLimit: 20, checkpointEvery: 1, now: new Date().toISOString() })
    const result = await executeAutonomousRun({ run, processChapter: processor,
      persist: next => useReconstructionWorkspaceStore().saveAiRun(target.novelId, next) })
    const counts = assertRequestLedger(result, 3)
    assertPhaseCountsEqual(stats.fetchPhaseCounts, counts, '写入阶段实际 fetch 与累计请求账本不一致')
    assert(result.status === 'needs_author' && result.checkpoint === `chapter-${target.chapterIndexes[0]}:checkpoint`, '第一章没有按 reviewed 检查点暂停')
    assert(result.chapterDrafts?.length === 1 && result.chapterDrafts[0].stage === 'analyzed', '第一章候选稿没有完成批审和分析')
    assert(result.chapterDrafts[0].review?.status === 'ready_to_finalize', '第一章批审未通过确定性门槛')
    assert(result.chapterDrafts[0].review.candidateChanges.length > 0, '第一章分析未提取到有来源证据的候选')
    assert(result.chapterDrafts[0].reviewCoverage?.status === 'complete', '第一章批审覆盖未完成')
    assert(novel.chapters.find(chapter => chapter.id === target.chapterIds[0])?.content === ''
      && novel.chapters.find(chapter => chapter.id === target.chapterIds[1])?.content === '', '候选稿提前写入正式正文')
    await useReconstructionWorkspaceStore().flushPendingSaves([target.novelId])
    return summarize('write', target, result, stats, { requestCounts: counts })
  } finally {
    restoreFetch()
  }
}

export async function reopen(input: DesktopAutoWorkflowInput | string): Promise<DesktopAutoWorkflowResult> {
  assertDesktopEnvironment()
  const normalized = normalizeInput(input)
  const workspace = useReconstructionWorkspaceStore()
  workspace.clearNovel(normalized.novelId)
  await workspace.hydrateFromPersistence(normalized.novelId)
  const target = resolveTarget(normalized, true)
  const persisted = workspace.getAiRun(target.novelId, normalized.runId)
  assert(persisted, '重开后找不到自动任务')
  const persistedCounts = assertRequestLedger(persisted, 3)
  assert(persisted.status === 'needs_author' && persisted.checkpoint === `chapter-${target.chapterIndexes[0]}:checkpoint`, '重开后的检查点不正确')
  assert(persisted.chapterDrafts?.length === 1 && persisted.chapterDrafts[0].stage === 'analyzed', '重开后候选稿或批审阶段丢失')

  const progress: unknown[] = []
  const stats: FixtureStats = { fetchPhaseCounts: emptyPhaseCounts() }
  const restoreFetch = installDeterministicFetch(stats)
  try {
    const { processor } = runtimeAndProcessor(target, progress)
    const pauseController = new AbortController()
    let pauseRequested = false
    const paused = await executeAutonomousRun({ run: persisted, signal: pauseController.signal, processChapter: processor,
      persist: async next => {
        await workspace.saveAiRun(target.novelId, next)
        if (!pauseRequested && next.status === 'running' && next.checkpoint === `chapter-${target.chapterIndexes[1]}:started`) {
          pauseRequested = true
          pauseController.abort(new DOMException('确定性桌面夹具暂停', 'AbortError'))
        }
      } })
    assert(paused.status === 'paused' && paused.checkpoint === `chapter-${target.chapterIndexes[1]}:started`, '暂停续跑未保留第二章 started 检查点')
    assert(paused.chapterDrafts?.length === 1, '暂停时不应生成第二章候选稿')
    assert(paused.requests?.length === 3, '暂停时不应重复第一章请求')
    await workspace.flushPendingSaves([target.novelId])

    workspace.clearNovel(target.novelId)
    await workspace.hydrateFromPersistence(target.novelId)
    const reopenedPaused = workspace.getAiRun(target.novelId, normalized.runId)
    assert(reopenedPaused?.status === 'paused' && reopenedPaused.checkpoint === `chapter-${target.chapterIndexes[1]}:started`, '暂停任务未从持久化重开')

    const { processor: resumedProcessor } = runtimeAndProcessor(target, progress)
    const resumed = await executeAutonomousRun({ run: reopenedPaused, processChapter: resumedProcessor,
      persist: next => workspace.saveAiRun(target.novelId, next) })
    const counts = assertRequestLedger(resumed, 6)
    assertPhaseCountsEqual(stats.fetchPhaseCounts, subtractPhaseCounts(counts, persistedCounts), '重开阶段实际 fetch 与累计账本增量不一致')
    assert(resumed.status === 'completed' && resumed.checkpoint === `chapter-${target.chapterIndexes[1]}:reviewed`,
      '续跑未完成第二章真实 processor 流程 ' + JSON.stringify({ status: resumed.status, checkpoint: resumed.checkpoint,
        error: resumed.error, drafts: resumed.chapterDrafts?.map(draft => ({ chapterIndex: draft.chapterIndex,
          stage: draft.stage, reviewStatus: draft.review?.status })) }))
    assert(resumed.chapterDrafts?.length === 2 && resumed.chapterDrafts.every(draft => draft.stage === 'analyzed'), '续跑后批审或分析阶段不完整')
    assert(resumed.chapterDrafts.every(draft => draft.review?.status === 'ready_to_finalize' && draft.reviewCoverage?.status === 'complete'), '续跑后批审门槛未完成')
    assert(resumed.chapterDrafts.every(draft => draft.review!.candidateChanges.length > 0), '续跑后分析候选缺少有效来源证据')
    const novel = useNovelStore().getNovel(target.novelId)!
    assert(target.chapterIds.every(id => novel.chapters.find(chapter => chapter.id === id)?.content === ''), '续跑将候选稿写入正式正文')
    await workspace.flushPendingSaves([target.novelId])

    workspace.clearNovel(target.novelId)
    await workspace.hydrateFromPersistence(target.novelId)
    const durable = workspace.getAiRun(target.novelId, normalized.runId)
    assert(durable?.status === 'completed' && durable.chapterDrafts?.length === 2, '完成任务未能从持久化重开')
    return summarize('reopen', target, durable, stats, {
      requestCounts: counts,
      resumed: true,
      pauseCheckpoint: paused.checkpoint,
    })
  } finally {
    restoreFetch()
  }
}

export async function verifyStale(input: DesktopAutoWorkflowInput | string): Promise<DesktopAutoWorkflowResult> {
  assertDesktopEnvironment()
  const normalized = normalizeInput(input)
  const workspace = useReconstructionWorkspaceStore()
  workspace.clearNovel(normalized.novelId)
  await workspace.hydrateFromPersistence(normalized.novelId)
  const target = resolveTarget(normalized, true)
  const run = workspace.getAiRun(target.novelId, normalized.runId)
  assert(run?.status === 'completed' && run.chapterDrafts?.length === 2, '过期校验要求已有完成的双章任务')
  const expectedDraft = run.chapterDrafts.find(draft => draft.chapterId === target.chapterIds[0])
  assert(expectedDraft, '找不到第一章候选稿')

  const novels = useNovelStore()
  const staleContent = '作者在自动任务完成后写入的新正文，候选稿来源已经过期。'
  assert(novels.updateChapter(target.novelId, target.chapterIds[0], { content: staleContent }), '无法写入过期校验正文')
  await novels.saveNovelNow(target.novelId)
  workspace.clearNovel(target.novelId)
  await workspace.hydrateFromPersistence(target.novelId)
  const persisted = workspace.getAiRun(target.novelId, normalized.runId)
  assert(persisted?.chapterDrafts?.find(draft => draft.id === expectedDraft.id)?.status === 'pending', '重开后候选稿不应提前消费')

  const stats: FixtureStats = { fetchPhaseCounts: emptyPhaseCounts() }
  const restoreFetch = installDeterministicFetch(stats)
  try {
    let rejected = false
    try {
      await workspace.decideAiDraft(target.novelId, normalized.runId, expectedDraft, 'accept')
    } catch (error) {
      rejected = true
      assert(error instanceof Error && error.message.includes('正式正文已变化'), '过期候选拒绝原因不明确')
    }
    assert(rejected, '过期候选稿被错误接受')
    const after = workspace.getAiRun(target.novelId, normalized.runId)
    const chapter = novels.getNovel(target.novelId)?.chapters.find(item => item.id === target.chapterIds[0])
    assert(after?.chapterDrafts?.find(draft => draft.id === expectedDraft.id)?.status === 'pending', '过期候选拒绝后状态被错误消费')
    assert(chapter?.content === staleContent, '过期校验覆盖了作者新正文')
    const counts = assertRequestLedger(after!, 6)
    assertPhaseCountsEqual(stats.fetchPhaseCounts, emptyPhaseCounts(), '过期校验阶段不应发送模型 fetch')
    return summarize('verify-stale', target, after!, stats, { requestCounts: counts, staleRejected: true, resumed: true })
  } finally {
    restoreFetch()
  }
}

export async function runDesktopAutoWorkflow(phase: DesktopAutoWorkflowPhase, input: DesktopAutoWorkflowInput | string): Promise<DesktopAutoWorkflowResult> {
  if (phase === 'write') return write(input)
  if (phase === 'reopen') return reopen(input)
  return verifyStale(input)
}

export const writeDesktopAutoWorkflow = write
export const reopenDesktopAutoWorkflow = reopen
export const verifyStaleDesktopAutoWorkflow = verifyStale
