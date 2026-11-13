import { createAiRun } from './reconstructionAiRun'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { CandidateChange, ChapterReview, ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { ProjectKernelRequest } from '@/types/projectKernel'
import { captureChapterAnalysisBaseline } from './chapterAnalysisTransactions'
import { captureCompletionClock } from './chapterCompletionTransactions'
import { buildChapterReviewInput } from './chapterReviewInput'
import { createChapterSourceBinding } from './derivedSources'
import { buildChapterReviewSignature, buildReviewContextVersion } from './reconstructionReviewVersion'
import { storyDecisionSourceVersion } from './storyDecisions'
import type { Novel } from '@/types/novel'

const require = createRequire(import.meta.url)
const { createProjectKernel } = require('../../app-main/projectKernel.cjs')
const { validateBackup } = require('../../app-main/projectKernelRpc.cjs')
const now = '2026-10-27T06:00:00.000Z'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe.each(['sql', 'kernel'] as const)('chapter completion transactions (%s)', backend => {
  let pinia: ReturnType<typeof createPinia>
  let root: string | undefined
  let writeCount: number
  let nextWrite: (() => Promise<void>) | undefined
  let releases: Array<() => void>
  let kernel: { commit: (request: unknown) => Promise<unknown>; read: () => Promise<any> } | undefined
  let novels: ReturnType<(typeof import('@/stores/novel'))['useNovelStore']>
  let workspace: ReturnType<(typeof import('@/stores/reconstructionWorkspace'))['useReconstructionWorkspaceStore']>
  let repository: typeof import('./storyAggregate')
  let novel: Novel
  let version: string
  let candidate: CandidateChange

  async function diskWrite() {
    writeCount++
    const hook = nextWrite
    nextWrite = undefined
    await hook?.()
  }
  function holdWrite() {
    let start!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    releases.push(release)
    nextWrite = async () => { start(); await gate }
    return { started, release }
  }
  function failWrite() { nextWrite = async () => { throw new Error('模拟磁盘事务失败') } }
  async function stored() {
    if (!kernel) return repository.readStoryAggregate(novel.id)
    const { backup } = await kernel.read()
    const { novelId: _owner, ...workspace } = backup.reconstructionWorkspaces[0]
    return { novel: backup.novels[0] as Novel, workspace: workspace as ReconstructionWorkspaceSnapshot }
  }

  beforeEach(async () => {
    vi.resetModules()
    pinia = createPinia(); setActivePinia(pinia)
    root = undefined; kernel = undefined; nextWrite = undefined; writeCount = 0; releases = []
    vi.stubGlobal('window', { addEventListener: () => {}, electronAPI: { dbRead: vi.fn().mockResolvedValue(null), dbWrite: diskWrite } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const { characterStateFixture } = await import('@/test/characterStateFixture')
    const { createTestProjectBackup } = await import('@/test/projectBackupFixture')
    const { createEmptyCreationDraft } = await import('@/types/reconstruction')
    const { setStoryTimeOrigin } = await import('@/types/storyTime')
    const { syncCreationDraftPlanning } = await import('./reconstructionCreation')
    const { buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const { buildChapterReviewSourceVersion, buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const fixture = characterStateFixture()
    novel = fixture.novel; novels = fixture.store
    novel.chapters[0].content = '林澈拿到了钥匙。两天后，他离开城门。' + '雨'.repeat(2100)
    novel.chapters[0].wordCount = novel.chapters[0].content.length
    novel.chapters[0].status = 'completed'
    setStoryTimeOrigin(novel, 0, '故事起点', now, () => 'story-origin')
    novel.chapterPlans = [{ id: 'plan-1', horizon: 'next', status: 'awaiting_review', title: '钥匙', objective: '得到线索',
      summary: '取得钥匙', beats: [], targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [],
      source: 'user', versions: [], createdAt: now, updatedAt: now }]
    let draft = createEmptyCreationDraft({ id: 'creation', now })
    draft.contract.approval = 'approved'; draft.approval.contract = 'approved'; draft.approval.skeleton = 'approved'
    draft.skeletons = [{ id: 'skeleton', title: '钥匙', premise: '雨城', logline: '追查真相', promise: '解开雨城谜团', ending: '找到真相',
      beats: [{ id: 'beat', title: '取得钥匙', description: '林澈得到关键线索。', kind: 'opening', relatedPlotlineIds: [], relatedCharacterIds: [] }], approval: 'approved', updatedAt: now }]
    draft.selectedSkeletonId = 'skeleton'
    draft = syncCreationDraftPlanning(draft, novel, now)
    draft.chapterPlans[0].approval = 'approved'
    draft.chapterPlans[0].scenePlanIds = ['scene']
    draft.scenePlans = [{ id: 'scene', chapterPlanId: draft.chapterPlans[0].id, order: 1, title: '城门', purpose: '得到钥匙',
      requiredActions: [], informationChanges: [], outputState: '离开城门', status: 'drafted', approval: 'approved' }]
    const chapter = novel.chapters[0]
    const contentVersion = buildAnalysisSourceVersionId(chapter.content)
    candidate = { id: 'event-candidate', novelId: novel.id, chapterId: chapter.id, type: 'fact', sourceVersionId: contentVersion,
      proposedValue: JSON.stringify({ title: '取得钥匙', description: '获得新线索', eventType: '主线', characters: ['林澈'] }),
      evidence: [{ id: 'evidence', sourceType: 'chapter', sourceId: chapter.id, sourceVersionId: contentVersion, quote: '林澈拿到了钥匙。' }],
      status: 'proposed', createdAt: now, updatedAt: now }
    version = buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(novel, chapter, [], draft))
    const review: ChapterReview = { id: 'review', chapterId: chapter.id, sourceVersionId: version, startedAt: now,
      completedAt: now, deterministicChecksPassed: true, semanticChecksPassed: true, status: 'ready_to_finalize', findings: [], candidateChanges: [candidate] }
    const backup = copy(createTestProjectBackup([novel], [], [], [], [{ novelId: novel.id, creationDraft: draft, candidates: [candidate],
      reviewFindings: [], chapterReviews: [review], canonMutations: [], aiRuns: [{ ...createAiRun({ id: 'run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 2, tokenBudget: 10000, now }), status: 'needs_author' }] }]))
    if (backend === 'kernel') {
      root = await mkdtemp(path.join(os.tmpdir(), 'mojian-story-transaction-'))
      kernel = await createProjectKernel({ root, validateBackup, fault: async (stage: string) => { if (stage === 'before-publish') await diskWrite() } })
      await kernel!.commit({ baseRevision: null, backup })
      window.electronAPI!.projectRequest = async (request: ProjectKernelRequest) => {
        try {
          if (request.method !== 'read' && request.method !== 'commit') throw new Error('Unexpected test request')
          return { ok: true, value: copy(await (request.method === 'read' ? kernel!.read() : kernel!.commit(request))) }
        } catch (error) { return { ok: false, error: { code: 'PROJECT_INVALID', message: (error as Error).message } } }
      }
      await (await import('./projectKernelClient')).initializeProjectKernel()
    } else await (await import('./db/project')).replaceProjectInDb(backup)
    await novels.initStore()
    novel = novels.novels[0]
    repository = await import('./storyAggregate')
    workspace = (await import('@/stores/reconstructionWorkspace')).useReconstructionWorkspaceStore()
    await workspace.hydrateFromPersistence(novel.id)
    writeCount = 0
  })

  afterEach(async () => {
    for (const release of releases) release()
    disposePinia(pinia)
    vi.unstubAllGlobals()
    if (root) {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mojian-story-transaction-')) throw new Error('Unexpected test root')
      await rm(root, { recursive: true, force: true })
    }
  })


  async function prepare() {
    await workspace.transactStory(novel.id, aggregate => {
      const chapter = aggregate.novel.chapters[0]
      chapter.status = 'writing'
      chapter.summary = '合成章节总结：林澈得到钥匙，离开城门寻找下一条线索。'
      chapter.summarySource = createChapterSourceBinding(chapter, chapter.summary, 'author', now)
      aggregate.workspace.candidates = []
      aggregate.novel.dataPanels = [{ id: 'pack', name: '钥匙', category: '自定义', relatedKeywords: [], createdAt: now, updatedAt: now,
        fields: [{ id: 'count', name: '数量', value: '0', unit: '', note: '', type: 'number',
          automationRules: [{ id: 'rule', trigger: 'on_mention', amount: 1, interval: 1, enabled: true }] }] }]
      version = storyDecisionSourceVersion(aggregate, chapter.id, [])
      aggregate.workspace.chapterReviews![0].sourceVersionId = version
      aggregate.workspace.chapterReviews![0].completedAt = now
      aggregate.workspace.chapterReviews![0].candidateChanges = []
      const signature = buildChapterReviewSignature(chapter.content, buildReviewContextVersion(aggregate.novel, chapter, [], aggregate.workspace.creationDraft))
      chapter.contentReviewSignature = signature
      chapter.contentReviewCoverage = { signature, totalChunks: 1, completedChunks: 1, totalCharacters: chapter.content.length,
        coveredCharacters: chapter.content.length, status: 'complete', globalStatus: 'not-needed' }
    })
    const currentSignature = buildChapterReviewSignature(novel.chapters[0].content, buildReviewContextVersion(novel, novel.chapters[0], [],
      workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id)))
    expect(novel.chapters[0].contentReviewSignature).toBe(currentSignature)
    expect(novel.chapters[0].contentReviewCoverage).toMatchObject({ signature: currentSignature, status: 'complete',
      totalCharacters: novel.chapters[0].content.length, coveredCharacters: novel.chapters[0].content.length })
    expect(workspace.getLatestChapterReview(novel.id, novel.chapters[0].id)?.completedAt).toBe(now)
    return { chapterId: novel.chapters[0].id, content: novel.chapters[0].content, reviewVersion: version, analysisComplete: true, analysisBaseline: captureChapterAnalysisBaseline(novel, novel.chapters[0], workspace.getCanonMutations(novel.id)) }
  }

  it('rolls back proposals and completion on disk failure, publishes together, and skips repeated finalization', async () => {
    const input = await prepare(), before = copy(await stored())
    const context = () => buildChapterReviewInput(novel, novel.chapters[0], { creationDraft: workspace.getCreationDraft(novel.id),
      canonMutations: workspace.getCanonMutations(novel.id), storyMemories: workspace.getStoryMemories(novel.id) }).buildContext(input.content)
    const beforeContext = context()
    failWrite()
    await expect(workspace.completeChapter(novel.id, input)).rejects.toThrow('模拟磁盘事务失败')
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.dataPanelChanges).toHaveLength(0)
    expect(await stored()).toEqual(before)
    const gate = holdWrite(), saving = workspace.completeChapter(novel.id, input)
    await gate.started
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.dataPanelChanges).toHaveLength(0)
    gate.release(); await saving
    expect(novel.chapters[0].status).toBe('finalized')
    expect(novel.dataPanelChanges).toHaveLength(1)
    expect(novel.dataPanelChanges[0].status).toBe('pending')
    expect(novel.dataPanels[0].fields[0].value).toBe('0')
    const writes = writeCount
    expect(context()).toEqual(beforeContext)
    await workspace.completeChapter(novel.id, input)
    expect(writeCount).toBe(writes)
    expect((await stored()).novel!.chapters[0].status).toBe('finalized')
  })

  it('persists explicit time confirmation atomically and never advances again after retry or reload', async () => {
    const input = await prepare(), chapter = novel.chapters[0]
    const baseline = captureCompletionClock(novel, chapter.id), before = copy(await stored())
    failWrite()
    await expect(workspace.confirmChapterCompletionClock(novel.id, chapter.id, 2, baseline)).rejects.toThrow('模拟磁盘事务失败')
    expect(chapter.storyDay).toBeUndefined()
    expect(await stored()).toEqual(before)
    await workspace.confirmChapterCompletionClock(novel.id, chapter.id, 2, baseline)
    expect(chapter.status).toBe('writing'); expect(chapter.storyDay).toBe(2)
    expect(novel.storyClock!.currentDay).toBe(2)
    await expect(workspace.completeChapter(novel.id, input)).rejects.toThrow('重新审核')
    disposePinia(pinia); pinia = createPinia(); setActivePinia(pinia)
    novels = (await import('@/stores/novel')).useNovelStore(); await novels.initStore(); novel = novels.novels[0]
    workspace = (await import('@/stores/reconstructionWorkspace')).useReconstructionWorkspaceStore()
    await workspace.hydrateFromPersistence(novel.id)
    const writes = writeCount
    await workspace.confirmChapterCompletionClock(novel.id, chapter.id, 2, baseline)
    expect(writeCount).toBe(writes); expect(novel.storyClock!.currentDay).toBe(2)
    await expect(workspace.confirmChapterCompletionClock(novel.id, chapter.id, 3, baseline)).rejects.toThrow('不能重复推进')
    expect((await stored()).novel!.storyClock!.currentDay).toBe(2)
  })

  it.each(['title', 'clock', 'analysis', 'coverage'] as const)('rejects stale or incomplete completion (%s)', async kind => {
    const input = await prepare()
    if (kind === 'title') novel.chapters[0].title = '作者的新标题'
    if (kind === 'clock') novel.storyClock!.label = '新的时间标签'
    if (kind === 'analysis') input.analysisComplete = false
    if (kind === 'coverage') novel.chapters[0].contentReviewCoverage = undefined
    const writes = writeCount
    await expect(workspace.completeChapter(novel.id, input)).rejects.toThrow()
    expect(writeCount).toBe(writes)
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.dataPanelChanges).toHaveLength(0)
  })


  it.each(['title', 'abort'] as const)('checks the captured completion after waiting for persistence (%s)', async action => {
    const input = await prepare(), gate = holdWrite()
    const blocker = workspace.transactStory(novel.id, () => undefined)
    await gate.started
    const controller = new AbortController()
    const saving = workspace.completeChapter(novel.id, input, controller.signal)
    const rejected = expect(saving).rejects.toThrow(action === 'abort' ? '停止' : '重新审核')
    if (action === 'abort') controller.abort(new Error('停止'))
    else novels.updateChapter(novel.id, input.chapterId, { title: '排队时作者修改了标题' })
    gate.release(); await blocker; await rejected
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.dataPanelChanges).toHaveLength(0)
    expect((await stored()).novel!.chapters[0].status).toBe('writing')
  })

  it.each(['clock', 'chapter order'] as const)('rejects an outdated time dialog (%s) and an undecided timeline candidate', async kind => {
    await prepare()
    const chapter = novel.chapters[0], baseline = captureCompletionClock(novel, chapter.id)
    if (kind === 'clock') novel.storyClock!.label = '作者重新核对后的标签'
    else [chapter.chapterIndex, novel.chapters[1].chapterIndex] = [novel.chapters[1].chapterIndex, chapter.chapterIndex]
    await expect(workspace.confirmChapterCompletionClock(novel.id, chapter.id, 2, baseline)).rejects.toThrow('重新核对')
    expect(chapter.storyDay).toBeUndefined()
    workspace.addCandidateChanges(novel.id, [{ ...candidate, id: 'pending-time', type: 'timeline', proposedValue: JSON.stringify({ elapsedDays: 2 }) }])
    await expect(workspace.confirmChapterCompletionClock(novel.id, chapter.id, 2, captureCompletionClock(novel, chapter.id))).rejects.toThrow('已有时间候选')
    expect(chapter.storyDay).toBeUndefined(); expect(novel.storyClock!.currentDay).toBe(0)
  })

  it('keeps proposed and deferred Canon decisions pending, then finalizes only after an author decision', async () => {
    const input = await prepare()
    workspace.addCandidateChanges(novel.id, [candidate])
    await workspace.completeChapter(novel.id, input)
    expect(novel.chapters[0].status).toBe('completed')
    expect(workspace.getCanonMutations(novel.id)).toHaveLength(0)
    input.analysisBaseline = captureChapterAnalysisBaseline(novel, novel.chapters[0], workspace.getCanonMutations(novel.id))
    await workspace.deferStoryCandidate(novel.id, candidate.id, now)
    await workspace.completeChapter(novel.id, input)
    expect(novel.chapters[0].status).toBe('completed')
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    await workspace.completeChapter(novel.id, input)
    expect(novel.chapters[0].status).toBe('finalized')
    expect(novel.dataPanelChanges).toHaveLength(1)
  })
})
