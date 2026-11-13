// Development-only Electron fixture. The review requests below are answered by
// a local deterministic fetch double. No product model or external network is
// used, and the fixture owns only the chapters with its private title prefix.
import { nextTick } from 'vue'
import router from '@/router'
import { useConfigStore, type ConfigData, type ModelConfig } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { buildChapterReviewInput } from '@/services/chapterReviewInput'
import { buildReviewContextVersion } from '@/services/reconstructionReviewVersion'
import { readProjectLibrary } from '@/services/projectKernelClient'
import { readStoryAggregate } from '@/services/storyAggregate'
import { deriveReviewCenter } from '@/v3/selectors/reviewCenter'
import type { Chapter, Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'

export type DesktopReviewWorkflowPhase = 'write' | 'reopen' | 'verify-stale'

export interface DesktopReviewWorkflowResult {
  phase: DesktopReviewWorkflowPhase
  novelId: string
  chapterIds: string[]
  excludedChapterIds: string[]
  requestCount: number
  reportPersisted: boolean
  coverageComplete: boolean
  signaturePersisted: boolean
  manuscriptUnchanged: boolean
  emptyAndLockedExcluded: boolean
  staleDetected?: boolean
  reused?: boolean
}

interface ReviewFixtureChapters {
  reviewed: [Chapter, Chapter]
  empty: Chapter
  locked: Chapter
}

interface FixtureStats {
  requestCount: number
}

const fixturePrefix = 'V3批量审校验收·'
const fixtureTitles = {
  reviewedA: fixturePrefix + '甲',
  reviewedB: fixturePrefix + '乙',
  empty: fixturePrefix + '空正文',
  locked: fixturePrefix + '锁定章',
}
const fixtureContent = {
  reviewedA: '黎安在清晨走到旧码头，先检查木箱上的蓝色封条，又把封条编号抄在防潮纸上。她发现木箱边缘留着新鲜泥痕，便叫住值守人，询问昨夜谁从北岸进出。值守人翻出交接册，确认木箱来自北岸渡船，随后把货物交给她重新封存。黎安记下泥痕和交接时间，决定午后去北岸查问船夫。',
  reviewedB: '周岚在仓库门口核对名单，确认三件货物都在原位。她逐一检查封绳和木牌，发现第三件货物的编号比交接册少了一笔，便请搬运工停下手里的活。搬运工回忆说，昨晚有人把旧木牌换成了新牌，却没有改册。周岚关上侧门，带着两张木牌沿石阶返回住处，决定晚上整理记录并追查换牌的人。',
  empty: '',
  locked: '锁定章只用于验证批量审校排除条件。',
}
const staleMarker = '批量审校夹具重审后的补充句。'
const fixtureEndpoint = 'http://127.0.0.1:1/v3-desktop-review-fixture'
const fixtureModel: ModelConfig = {
  id: 'desktop-review-deterministic',
  name: '桌面批量审校确定性替身',
  baseUrl: fixtureEndpoint,
  apiKey: '',
  modelName: 'synthetic-desktop-review',
  maxTokens: 4096,
  temperature: 0,
  topP: 1,
  contextWindow: 32000,
}
const reviewReport = [
  '## 结论',
  '总体判断：可通过',
  '必改数量：0',
  '## 必改问题',
  '无',
  '## 建议修改',
  '无',
  '## 编辑建议',
  '无',
  '## 夹具标记',
  '批量审校确定性报告。',
].join('\n')

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error('V3 desktop review: ' + message)
}

function assertDesktopEnvironment() {
  assert(typeof window !== 'undefined' && import.meta.env.DEV && window.electronAPI?.projectRequest,
    '需要开发版桌面环境和项目 IPC')
}

async function until(check: () => unknown, label: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) {
      const error = document.querySelector('[role="alert"]')?.textContent?.trim()
      throw new Error(`${label}${error ? `：${error}` : ''}`)
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await nextTick()
}

async function clickExact(text: string) {
  const find = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === text && !button.disabled)
  await until(find, '找不到可点击按钮：' + text)
  find()!.click()
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function cloneConfig(config: ConfigData): ConfigData {
  return JSON.parse(JSON.stringify(config)) as ConfigData
}

function reviewSources(novelId: string) {
  const workspace = useReconstructionWorkspaceStore()
  const knowledge = useKnowledgeStore()
  return {
    knowledge: knowledge.knowledgeBases,
    creationDraft: workspace.getCreationDraft(novelId),
    canonMutations: workspace.getCanonMutations(novelId),
    storyMemories: workspace.getStoryMemories(novelId),
  }
}

function findUniqueChapter(novel: Novel, title: string): Chapter | undefined {
  const matches = novel.chapters.filter(chapter => chapter.title === title)
  assert(matches.length <= 1, `验收章节标题重复：${title}`)
  return matches[0]
}

function requireChapter(novel: Novel, title: string): Chapter {
  const chapter = findUniqueChapter(novel, title)
  assert(chapter, `找不到验收章节：${title}`)
  return chapter
}

function validateFixtureChapter(chapter: Chapter, expectedContent: string, label: string) {
  assert(chapter.content === expectedContent, `${label}正文不是夹具预期内容，拒绝覆盖现有数据`)
}

function ensureFixtureChapters(novelId: string): ReviewFixtureChapters {
  const novels = useNovelStore()
  const novel = novels.getNovel(novelId)
  assert(novel, '找不到目标合成作品')

  const addIfMissing = (title: string, content: string) => {
    const existing = findUniqueChapter(novel, title)
    if (existing) return existing
    const created = novels.addChapter(novelId, { title, content })
    assert(created, `无法创建验收章节：${title}`)
    return created
  }

  const reviewedA = addIfMissing(fixtureTitles.reviewedA, fixtureContent.reviewedA)
  const reviewedB = addIfMissing(fixtureTitles.reviewedB, fixtureContent.reviewedB)
  const empty = addIfMissing(fixtureTitles.empty, fixtureContent.empty)
  const locked = addIfMissing(fixtureTitles.locked, fixtureContent.locked)

  validateFixtureChapter(reviewedA, fixtureContent.reviewedA, fixtureTitles.reviewedA)
  validateFixtureChapter(reviewedB, fixtureContent.reviewedB, fixtureTitles.reviewedB)
  validateFixtureChapter(empty, fixtureContent.empty, fixtureTitles.empty)
  validateFixtureChapter(locked, fixtureContent.locked, fixtureTitles.locked)
  assert(reviewedA.status !== 'locked' && reviewedB.status !== 'locked', '批量审校目标章已锁定')

  if (locked.status !== 'locked') {
    assert(novels.updateChapter(novelId, locked.id, { status: 'locked' }), '锁定验收章节失败')
  }
  return { reviewed: [reviewedA, reviewedB], empty, locked }
}

function reviewSnapshot(novelId: string) {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const knowledge = useKnowledgeStore()
  const novel = novels.getNovel(novelId)
  assert(novel, '找不到目标合成作品')
  return deriveReviewCenter({
    novel,
    findings: workspace.getReviewFindings(novelId),
    candidates: workspace.getCandidates(novelId),
    reviews: workspace.getChapterReviews(novelId),
    impactReports: workspace.getImpactReports(novelId),
    contextVersion: chapter => buildReviewContextVersion(novel, chapter, knowledge.knowledgeBases,
      workspace.getCreationDraft(novelId), workspace.getCanonMutations(novelId), workspace.getStoryMemories(novelId)),
  })
}

function assertOnlyFixtureTargetsArePending(novelId: string, fixture: ReviewFixtureChapters) {
  const targetIds = new Set(fixture.reviewed.map(chapter => chapter.id))
  const pending = reviewSnapshot(novelId).rows.filter(row => row.chapter.content.trim() && !row.workflow.locked
    && (row.status === 'needs_review' || row.reviewStale))
  const foreign = pending.filter(row => !targetIds.has(row.chapter.id))
  assert(foreign.length === 0,
    `批量审校快照包含夹具之外的章节，拒绝触碰原有数据：${foreign.map(row => row.chapter.title).join('、')}`)
  assert(fixture.reviewed.every(chapter => pending.some(row => row.chapter.id === chapter.id)),
    '两个独立验收章节没有同时进入待审校快照')
  assert(!pending.some(row => row.chapter.id === fixture.empty.id || row.chapter.id === fixture.locked.id),
    '空正文或锁定章错误进入批量审校快照')
}

function assertStoredReview(novelId: string, chapterId: string, persistedNovel?: Novel, persistedWorkspace?: ReconstructionWorkspaceSnapshot) {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const novel = novels.getNovel(novelId)
  const chapter = novel?.chapters.find(row => row.id === chapterId)
  assert(novel && chapter, '找不到待核对的验收章节')
  const input = buildChapterReviewInput(novel, chapter, reviewSources(novelId))
  const review = workspace.getChapterReviews(novelId, chapterId).find(row => row.sourceVersionId === input.sourceVersionId)
  assert(review, `真实审校提交没有保存：${chapter.title}`)
  assert(review.status === 'ready_to_finalize', `审校提交状态不正确：${chapter.title}`)
  assert(typeof chapter.contentReview === 'string' && chapter.contentReview.includes('批量审校确定性报告'), `审校报告正文没有保存：${chapter.title}`)
  assert(chapter.contentReviewSignature === input.signature, `审校签名不匹配：${chapter.title}`)
  const coverage = chapter.contentReviewCoverage
  assert(coverage?.status === 'complete' && coverage.signature === input.signature
    && coverage.completedChunks === coverage.totalChunks && coverage.coveredCharacters === coverage.totalCharacters,
  `审校覆盖记录不完整：${chapter.title}`)

  if (persistedNovel && persistedWorkspace) {
    const storedChapter = persistedNovel.chapters.find(row => row.id === chapterId)
    const storedReview = persistedWorkspace.chapterReviews?.find(row => row.chapterId === chapterId && row.sourceVersionId === input.sourceVersionId)
    assert(storedChapter?.content === chapter.content, `持久层正文不一致：${chapter.title}`)
    assert(storedChapter?.contentReview === chapter.contentReview, `持久层审校报告不一致：${chapter.title}`)
    assert(storedChapter?.contentReviewSignature === chapter.contentReviewSignature, `持久层审校签名不一致：${chapter.title}`)
    assert(storedChapter?.contentReviewCoverage?.status === 'complete', `持久层审校覆盖不完整：${chapter.title}`)
    assert(storedReview?.status === 'ready_to_finalize', `持久层审校记录不完整：${chapter.title}`)
  }
}

function assertExcludedChapter(novelId: string, chapter: Chapter, expectedContent: string, locked: boolean) {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const current = novels.getNovel(novelId)?.chapters.find(row => row.id === chapter.id)
  assert(current, '找不到应被排除的验收章节')
  assert(current.content === expectedContent, `被排除章节正文发生变化：${chapter.title}`)
  assert(locked ? current.status === 'locked' : current.status !== 'locked', `被排除章节锁定状态错误：${chapter.title}`)
  assert(!current.contentReview && !current.contentReviewSignature && !current.contentReviewCoverage,
    `被排除章节出现了审校结果：${chapter.title}`)
  assert(workspace.getChapterReviews(novelId, chapter.id).length === 0, `被排除章节出现了审校记录：${chapter.title}`)
}

function chapterCell(chapter: Chapter) {
  const prefix = `第${chapter.chapterIndex + 1}章 · `
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.heat-cell'))
    .find(button => button.getAttribute('aria-label')?.startsWith(prefix))
}

async function openReviewView(novelId: string) {
  await router.push(`/review/${novelId}`)
  await until(() => document.querySelector('.review-page') && !document.querySelector('.review-loading'), '审校中心没有渲染完成')
}

async function openChapterFromReview(chapter: Chapter) {
  await until(() => chapterCell(chapter), `审校中心没有显示第 ${chapter.chapterIndex + 1} 章`)
  chapterCell(chapter)!.click()
  await until(() => document.querySelector('.review-summary'), '写作台没有显示持久化审校状态')
}

function deterministicResponse() {
  const usage = { prompt_tokens: 220, completion_tokens: 64, total_tokens: 284 }
  const body = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: reviewReport }, finish_reason: null }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage }),
    'data: [DONE]',
    '',
  ].join('\n\n')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

async function withDeterministicReviewRuntime<T>(work: (stats: FixtureStats) => Promise<T>): Promise<T> {
  const config = useConfigStore()
  const originalConfig = cloneConfig(config.exportConfig())
  const temporaryConfig = cloneConfig(originalConfig)
  temporaryConfig.models = [...temporaryConfig.models.filter(model => model.id !== fixtureModel.id), { ...fixtureModel }]
  temporaryConfig.assignments = { ...temporaryConfig.assignments, review: fixtureModel.id }
  const originalConfigSignature = JSON.stringify(originalConfig)
  await config.importConfig(temporaryConfig, () => JSON.stringify(config.exportConfig()) === originalConfigSignature)

  const previousFetch = window.fetch.bind(window)
  const expectedUrl = fixtureEndpoint + '/v1/chat/completions'
  const stats: FixtureStats = { requestCount: 0 }
  window.fetch = async (input, init) => {
    const url = requestUrl(input)
    if (url === expectedUrl) {
      let payload: { messages?: Array<{ content?: unknown }>; stream?: boolean }
      try { payload = JSON.parse(String(init?.body || '{}')) as typeof payload }
      catch { throw new Error('确定性审校请求不是合法 JSON') }
      const prompt = (payload.messages || []).map(message => String(message.content || '')).join('\n')
      assert(payload.stream === true && payload.messages?.length === 2 && prompt.includes('全维度审查'),
        '请求没有遵循真实内容审校协议')
      stats.requestCount++
      return deterministicResponse()
    }
    const origin = new URL(url, location.href).origin
    assert(origin === location.origin, '确定性审校夹具拦截到非同源网络请求')
    return previousFetch(input, init)
  }

  try {
    return await work(stats)
  } finally {
    window.fetch = previousFetch
    await config.importConfig(originalConfig, () => true)
  }
}

async function prepareNovel(novelId: string) {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  assert(novels.getNovel(novelId), '目标作品不存在')
  await novels.flushPendingSaves()
  await workspace.flushPendingSaves([novelId])
  await readProjectLibrary(true)
  workspace.clearNovel(novelId)
  await workspace.hydrateFromPersistence(novelId)
}

async function writePhase(novelId: string): Promise<DesktopReviewWorkflowResult> {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const fixture = ensureFixtureChapters(novelId)
  await novels.saveNovelNow(novelId)
  await workspace.flushPendingSaves([novelId])
  const originalContents = new Map(fixture.reviewed.map(chapter => [chapter.id, chapter.content]))
  assertOnlyFixtureTargetsArePending(novelId, fixture)

  return withDeterministicReviewRuntime(async stats => {
    await openReviewView(novelId)
    await until(() => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .some(button => button.textContent?.trim() === '批量审校 2 章' && !button.disabled), '批量审校按钮没有只包含两个验收章节')
    await clickExact('批量审校 2 章')
    await until(() => stats.requestCount === fixture.reviewed.length
      && fixture.reviewed.every(chapter => workspace.getChapterReviews(novelId, chapter.id).some(row => row.status === 'ready_to_finalize')),
    '批量审校没有完成真实提交', 60000)
    assert(stats.requestCount === 2, '批量审校请求数不是两个章节各一次')
    assert(fixture.reviewed.every(chapter => originalContents.get(chapter.id)
      === novels.getNovel(novelId)?.chapters.find(row => row.id === chapter.id)?.content), '批量审校修改了正式正文')
    for (const chapter of fixture.reviewed) assertStoredReview(novelId, chapter.id)
    assertExcludedChapter(novelId, fixture.empty, fixtureContent.empty, false)
    assertExcludedChapter(novelId, fixture.locked, fixtureContent.locked, true)

    await novels.flushPendingSaves()
    await workspace.flushPendingSaves([novelId])
    const persisted = await readStoryAggregate(novelId)
    assert(persisted.novel, '批量审校后无法读取持久化作品')
    for (const chapter of fixture.reviewed) assertStoredReview(novelId, chapter.id, persisted.novel, persisted.workspace)
    return {
      phase: 'write', novelId, chapterIds: fixture.reviewed.map(chapter => chapter.id),
      excludedChapterIds: [fixture.empty.id, fixture.locked.id], requestCount: stats.requestCount,
      reportPersisted: true, coverageComplete: true, signaturePersisted: true,
      manuscriptUnchanged: true, emptyAndLockedExcluded: true,
    }
  })
}

async function reopenPhase(novelId: string): Promise<DesktopReviewWorkflowResult> {
  const workspace = useReconstructionWorkspaceStore()
  const fixture = resolveFixtureChapters(novelId)
  const persisted = await readStoryAggregate(novelId)
  assert(persisted.novel, '重开时找不到持久化作品')
  for (const chapter of fixture.reviewed) assertStoredReview(novelId, chapter.id, persisted.novel, persisted.workspace)
  assertExcludedChapter(novelId, fixture.empty, fixtureContent.empty, false)
  assertExcludedChapter(novelId, fixture.locked, fixtureContent.locked, true)

  return withDeterministicReviewRuntime(async stats => {
    await openReviewView(novelId)
    const target = fixture.reviewed[0]
    await until(() => chapterCell(target), '重开后审校中心没有验收章节')
    assert(chapterCell(target)?.classList.contains('h-ready') === true
      && reviewSnapshot(novelId).rows.find(row => row.chapter.id === target.id)?.workflow.reviewCurrent === true,
    '重开后审校中心没有显示有效审校状态')
    await openChapterFromReview(target)
    assert(document.querySelector('.review-summary')?.textContent?.includes('有效') === true,
      '重开后写作台没有读取有效审校状态')
    assert(stats.requestCount === 0, '重开验证意外发送了审校请求')
    assert(workspace.getChapterReviews(novelId, target.id).some(row => row.status === 'ready_to_finalize'),
      '重开后工作区审校记录丢失')
    return {
      phase: 'reopen', novelId, chapterIds: fixture.reviewed.map(chapter => chapter.id),
      excludedChapterIds: [fixture.empty.id, fixture.locked.id], requestCount: 0,
      reportPersisted: true, coverageComplete: true, signaturePersisted: true,
      manuscriptUnchanged: true, emptyAndLockedExcluded: true,
    }
  })
}

function resolveFixtureChapters(novelId: string): ReviewFixtureChapters {
  const novel = useNovelStore().getNovel(novelId)
  assert(novel, '找不到目标合成作品')
  const reviewedA = requireChapter(novel, fixtureTitles.reviewedA)
  const reviewedB = requireChapter(novel, fixtureTitles.reviewedB)
  const empty = requireChapter(novel, fixtureTitles.empty)
  const locked = requireChapter(novel, fixtureTitles.locked)
  assert([fixtureContent.reviewedA, fixtureContent.reviewedA + '\n' + staleMarker].includes(reviewedA.content),
    '甲章正文不是夹具预期内容，拒绝覆盖现有数据')
  validateFixtureChapter(reviewedB, fixtureContent.reviewedB, fixtureTitles.reviewedB)
  validateFixtureChapter(empty, fixtureContent.empty, fixtureTitles.empty)
  validateFixtureChapter(locked, fixtureContent.locked, fixtureTitles.locked)
  assert(locked.status === 'locked', '锁定验收章节在重开后没有保持锁定')
  return { reviewed: [reviewedA, reviewedB], empty, locked }
}

async function verifyStalePhase(novelId: string): Promise<DesktopReviewWorkflowResult> {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const fixture = resolveFixtureChapters(novelId)
  const target = fixture.reviewed[0]
  const before = target.content
  const alreadyStale = before.includes(staleMarker)
    && !reviewSnapshot(novelId).rows.find(row => row.chapter.id === target.id)?.workflow.reviewCurrent
  let reused = false
  if (!alreadyStale) {
    assert(!before.includes(staleMarker), '独立验收章已有已完成的失效修改，拒绝重复污染正文')
    assert(novels.updateChapter(novelId, target.id, { content: before + '\n' + staleMarker }), '无法制造独立审校失效正文')
    await novels.saveNovelNow(novelId)
    await workspace.flushPendingSaves([novelId])
  } else {
    reused = true
  }
  const expectedContent = alreadyStale ? before : before + '\n' + staleMarker

  return withDeterministicReviewRuntime(async stats => {
    workspace.clearNovel(novelId)
    await workspace.hydrateFromPersistence(novelId)
    await openReviewView(novelId)
    await until(() => chapterCell(target), '失效验收章没有显示在审校中心')
    assert(chapterCell(target)?.classList.contains('h-stale') === true, '正文变化后审校中心没有显示失效状态')
    // Editing an earlier chapter may also invalidate later review context, so
    // the banner can list several chapter numbers in a single phrase.
    const staleChapterNumbers = document.querySelector('.stale-banner p')?.textContent
      ?.match(/第\s+(\d+(?:、\d+)*)\s+章/)?.[1].split('、').map(Number) || []
    assert(staleChapterNumbers.includes(target.chapterIndex + 1),
      '审校中心失效提示没有包含独立验收章')
    assert(stats.requestCount === 0, '失效投影校验不应发送模型请求')
    assert(novels.getNovel(novelId)?.chapters.find(row => row.id === target.id)?.content === expectedContent,
      '失效校验没有保留指定的独立验收正文')
    const persisted = await readStoryAggregate(novelId)
    assert(persisted.novel?.chapters.find(row => row.id === target.id)?.content === expectedContent,
      '失效校验没有持久化指定的独立验收正文')
    assertExcludedChapter(novelId, fixture.empty, fixtureContent.empty, false)
    assertExcludedChapter(novelId, fixture.locked, fixtureContent.locked, true)
    return {
      phase: 'verify-stale', novelId, chapterIds: fixture.reviewed.map(chapter => chapter.id),
      excludedChapterIds: [fixture.empty.id, fixture.locked.id], requestCount: 0,
      reportPersisted: true, coverageComplete: true, signaturePersisted: true,
      manuscriptUnchanged: true, emptyAndLockedExcluded: true, staleDetected: true, reused,
    }
  })
}

export async function runDesktopReviewWorkflow(phase: DesktopReviewWorkflowPhase, novelId: string): Promise<DesktopReviewWorkflowResult> {
  assertDesktopEnvironment()
  assert(novelId.trim(), '缺少目标作品编号')
  await prepareNovel(novelId)
  if (phase === 'write') return writePhase(novelId)
  if (phase === 'reopen') return reopenPhase(novelId)
  return verifyStalePhase(novelId)
}
