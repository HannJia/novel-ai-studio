import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { CandidateChange, ChapterReview, ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { ProjectKernelRequest } from '@/types/projectKernel'
import type { Novel } from '@/types/novel'
import type { StoredReviewCoverage } from './chapterReviewCoverage'
import { createAiRun } from './reconstructionAiRun'
import { confirmTestContractCards } from '@/test/contractCardsFixture'

const require = createRequire(import.meta.url)
const { createProjectKernel } = require('../../app-main/projectKernel.cjs')
const { validateBackup } = require('../../app-main/projectKernelRpc.cjs')
const now = '2026-10-27T06:00:00.000Z'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe.each(['sql', 'kernel'] as const)('atomic story decisions (%s)', backend => {
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
    draft.contract = confirmTestContractCards(draft.contract, now)
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
      deterministicChecksPassed: true, semanticChecksPassed: true, status: 'ready_to_finalize', findings: [], candidateChanges: [candidate] }
    const backup = copy(createTestProjectBackup([novel], [], [], [], [{ novelId: novel.id, creationDraft: draft, candidates: [candidate],
      reviewFindings: [], chapterReviews: [review], canonMutations: [], aiRuns: [{ ...createAiRun({ id: 'run', mode: 'autonomous', taskType: 'draft',
        targetId: novel.id, chapterStart: 0, chapterEnd: 2, tokenBudget: 10000, now }), status: 'needs_author' }] }]))
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

  let dataTestId = 0
  const nextDataId = () => 'data-boundary-' + ++dataTestId
  function commitPanelEdit(edit: Extract<import('./dataPanelTransactions').DataPanelEdit, { action: 'create' }>, baseline?: string): Promise<import('@/types/novel').DataPanelItem | null>
  function commitPanelEdit(edit: Exclude<import('./dataPanelTransactions').DataPanelEdit, { action: 'create' }>, baseline?: string): Promise<boolean>
  async function commitPanelEdit(edit: import('./dataPanelTransactions').DataPanelEdit, baseline?: string) {
    const expected = baseline ?? novels.captureDataPanelEditBaseline(novel.id, edit.action === 'create' ? '' : edit.itemId)
    if (edit.action === 'create') return novels.addDataPanelItem(novel.id, edit.item, expected)
    if (edit.action === 'update') return novels.updateDataPanelItem(novel.id, edit.itemId, edit.item, expected)
    if (edit.action === 'delete') return novels.deleteDataPanelItem(novel.id, edit.itemId, expected)
    return novels.restoreDataPanelVersion(novel.id, edit.itemId, edit.versionId, expected)
  }
  async function seedPanel() {
    const result = await commitPanelEdit({ action: 'create', item: { name: '钥匙', category: '资源', fields: [
      { id: 'stock', name: '数量', value: '0', unit: '枚', note: '', type: 'number' },
      { id: 'cost', name: '支出', value: '0', unit: '文', note: '', type: 'number' },
    ], relatedKeywords: [] } })
    return novel.dataPanels.find(item => item.id === result!.id)!
  }

  it('commits manual data creation and impacts together, keeps caller fields isolated, and skips unchanged edits', async () => {
    const before = copy(await stored())
    const payload: import('./dataPanelTransactions').DataPanelEdit = { action: 'create', item: { name: '行囊', category: '资源', relatedKeywords: [],
      fields: [{ id: 'count', name: '数量', value: '1', unit: '个', note: '' }] } }
    failWrite()
    await expect(commitPanelEdit(payload)).rejects.toThrow('模拟磁盘事务失败')
    expect(novel.dataPanels).toEqual(before.novel!.dataPanels)
    expect(await stored()).toEqual(before)
    const gate = holdWrite(), saving = commitPanelEdit(payload)
    await gate.started
    expect(novel.dataPanels).toEqual(before.novel!.dataPanels)
    gate.release()
    const result = await saving, saved = await stored()
    expect(saved.novel!.dataPanels).toHaveLength(1)
    expect(saved.workspace.impactReports![saved.workspace.impactReports!.length - 1].changes[0].fields).toEqual(['dataPanels'])
    payload.item.fields![0].value = '外部改动'
    expect(novel.dataPanels[0].fields[0].value).toBe('1')
    const writes = writeCount
    const repeated = await commitPanelEdit({ action: 'update', itemId: result!.id, item: { name: '行囊' } })
    expect(repeated).toBe(true)
    expect(writeCount).toBe(writes)
  })

  it.each(['update', 'restore', 'delete'] as const)('rolls back data %s with its history and impact, then permits a retry', async action => {
    const panel = await seedPanel()
    await commitPanelEdit({ action: 'update', itemId: panel.id, item: { fields: [{ ...panel.fields[0], value: '4' }, panel.fields[1]] } })
    const before = copy(await stored()), live = copy(novel)
    const edit: import('./dataPanelTransactions').DataPanelEdit = action === 'update'
      ? { action, itemId: panel.id, item: { name: '钥匙记录' } }
      : action === 'restore' ? { action, itemId: panel.id, versionId: panel.versions![0].id }
        : { action, itemId: panel.id }
    failWrite()
    await expect(commitPanelEdit(edit)).rejects.toThrow('模拟磁盘事务失败')
    expect(novel).toEqual(live); expect(await stored()).toEqual(before)
    expect(await commitPanelEdit(edit)).toBe(true)
    const saved = await stored()
    expect(saved.workspace.impactReports!.length).toBe(before.workspace.impactReports!.length + 1)
    if (action === 'delete') expect(saved.novel!.dataPanels).toHaveLength(0)
    else if (action === 'restore') expect(saved.novel!.dataPanels[0].fields[0].value).toBe('0')
    else expect(saved.novel!.dataPanels[0].name).toBe('钥匙记录')
  })

  it.each(['accept', 'reject'] as const)('persists a complete batch of data %s decisions only after save, with no duplicate replay', async decision => {
    const panel = await seedPanel()
    const { bindDataPanelProposalSource } = await import('./dataPanelProposalSource')
    await workspace.transactStory(novel.id, aggregate => {
      const chapter = aggregate.novel.chapters[0]
      aggregate.novel.dataPanelChanges = panel.fields.map((field, index) => {
        const proposal: import('@/types/novel').DataPanelChange = { id: 'data-proposal-' + index, itemId: panel.id, itemName: panel.name,
          fieldId: field.id, fieldName: field.name, oldValue: '0', newValue: String(index + 1), reason: '林澈拿到了钥匙。',
          chapterIndex: 0, status: 'pending', createdAt: now }
        proposal.sourceBinding = bindDataPanelProposalSource(aggregate.novel, chapter, proposal, 'chapter')
        return proposal
      })
    })
    const ids = novel.dataPanelChanges.map(change => change.id), before = copy(await stored())
    const commit = () => decision === 'accept' ? novels.applyDataPanelChanges(novel.id, ids) : novels.rejectDataPanelChanges(novel.id, ids)
    failWrite()
    await expect(commit()).rejects.toThrow('模拟磁盘事务失败')
    expect(novel.dataPanelChanges.every(change => change.status === 'pending')).toBe(true)
    expect(await stored()).toEqual(before)
    const gate = holdWrite(), saving = commit()
    await gate.started
    expect(novel.dataPanelChanges.every(change => change.status === 'pending')).toBe(true)
    expect(panel.fields.map(field => field.value)).toEqual(['0', '0'])
    gate.release(); expect(await saving).toBe(2)
    const saved = await stored()
    expect(saved.novel!.dataPanelChanges.map(change => change.status)).toEqual([decision === 'accept' ? 'accepted' : 'rejected', decision === 'accept' ? 'accepted' : 'rejected'])
    expect(saved.novel!.dataPanels[0].fields.map(field => field.value)).toEqual(decision === 'accept' ? ['1', '2'] : ['0', '0'])
    expect(saved.novel!.dataPanels[0].referenceHistory).toEqual(novel.dataPanels[0].referenceHistory)
    expect(saved.novel!.dataPanels[0].referenceHistory!.revisions).toHaveLength(decision === 'accept' ? 3 : 1)
    const reloadedPanel = (await (await import('./db/novels')).loadAllNovelsFromDb()).find(book => book.id === novel.id)!.dataPanels[0]
    expect(reloadedPanel.referenceHistory).toEqual(saved.novel!.dataPanels[0].referenceHistory)
    if (decision === 'accept') {
      const { projectDataPanelReferences } = await import('./dataPanelReference')
      const restoredNovel = copy(saved.novel!)
      expect(projectDataPanelReferences(restoredNovel, 0).items[0].fields.map(field => field.value)).toEqual(['0', '0'])
      expect(projectDataPanelReferences(restoredNovel, 1).items[0].fields.map(field => field.value)).toEqual(['1', '2'])
      restoredNovel.chapters[0].content = restoredNovel.chapters[0].content.replace('钥匙', '书信')
      expect(projectDataPanelReferences(restoredNovel, 1).items[0].fields).toEqual([])
    }
    const writes = writeCount
    expect(await commit()).toBe(0); expect(writeCount).toBe(writes)
    workspace.clearNovel(novel.id); await workspace.hydrateFromPersistence(novel.id)
    expect(await stored()).toEqual(saved)
  })

  it.each(['accept', 'reject'] as const)('atomically saves a zero schedule %s decision and resumes its next step after reading storage', async decision => {
    const panel = await seedPanel()
    const service = await import('./dataPanelTransactions')
    await commitPanelEdit({ action: 'update', itemId: panel.id, item: { fields: panel.fields.map((field, index) => index === 0
      ? { ...field, automationRules: [{ id: 'zero-start', trigger: 'per_chapter', amount: 0, schedule: [0, 2], interval: 1, enabled: true }] }
      : field) } })
    await workspace.transactStory(novel.id, aggregate => {
      const chapter = aggregate.novel.chapters[0]
      service.queueDataPanelAutomation(aggregate.novel, chapter.chapterIndex, chapter.content, now, nextDataId)
    })
    const proposalId = novel.dataPanelChanges[0].id, before = copy(await stored())
    const commit = () => decision === 'accept' ? novels.applyDataPanelChange(novel.id, proposalId) : novels.rejectDataPanelChange(novel.id, proposalId)
    failWrite()
    await expect(commit()).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before)
    const gate = holdWrite(), saving = commit()
    await gate.started
    expect(novel.dataPanelChanges[0].status).toBe('pending')
    expect(novel.dataPanels[0].fields[0].automationRules![0].appliedCount || 0).toBe(0)
    gate.release(); expect(await saving).toBe(true)
    const recovered = await stored(), loaded = recovered.novel!
    expect(loaded.dataPanelChanges[0]).toMatchObject({ status: decision === 'accept' ? 'accepted' : 'rejected', oldValue: '0', newValue: '0' })
    expect(loaded.dataPanels[0].fields[0]).toMatchObject({ value: '0', automationRules: [{ appliedCount: 1, lastEvaluatedChapterIndex: 0 }] })
    const writes = writeCount
    expect(await commit()).toBe(false); expect(writeCount).toBe(writes)
    const nextChapter = loaded.chapters.find(chapter => chapter.chapterIndex === 1)
      || { ...loaded.chapters[0], id: 'next-zero-step', chapterIndex: 1, content: '林澈清点钥匙。' }
    if (!loaded.chapters.includes(nextChapter)) loaded.chapters.push(nextChapter)
    expect(service.queueDataPanelAutomation(loaded, nextChapter.chapterIndex, nextChapter.content, now, nextDataId).added).toBe(1)
    expect(loaded.dataPanelChanges[0].newValue).toBe('2')
  })

  it('keeps native unverified provenance through failed history cleanup, retry and storage reload', async () => {
    const panel = await seedPanel()
    const { recordDataPanelReference } = await import('./dataPanelReference')
    await workspace.transactStory(novel.id, aggregate => {
      const item = aggregate.novel.dataPanels[0]
      const previous = copy(item)
      item.fields[0].value = '7'; delete item.referenceHistory
      recordDataPanelReference(item, previous, { kind: 'unverified' }, now, 'unverified-value')
      aggregate.novel.dataPanelChanges = [{ id: 'unverified-data-change', itemId: panel.id, itemName: panel.name,
        fieldId: 'stock', fieldName: '数量', oldValue: '0', newValue: '7', reason: '来源待核对',
        chapterIndex: 0, status: 'accepted', createdAt: now }]
    })
    const before = copy(await stored()), { projectDataPanelReferences } = await import('./dataPanelReference')
    expect(projectDataPanelReferences(novel).unknownFields.get(panel.id)).toContain('field:stock')
    failWrite()
    await expect(novels.cleanupDataPanelChanges(novel.id, { mode: 'all' })).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    expect(await novels.cleanupDataPanelChanges(novel.id, { mode: 'all' })).toBe(1)
    const saved = (await stored()).novel!
    expect(saved.dataPanelChanges).toHaveLength(0)
    expect(saved.dataPanels[0].fields[0].value).toBe('7')
    expect(saved.dataPanels[0].referenceHistory!.revisions[0].source.kind).toBe('unverified')
    const reloaded = (await (await import('./db/novels')).loadAllNovelsFromDb()).find(book => book.id === novel.id)!
    expect(projectDataPanelReferences(reloaded).unknownFields.get(panel.id)).toContain('field:stock')
  })

  it('freezes author proposal meaning before a queued target rename commits', async () => {
    const panel = await seedPanel()
    const input = { itemId: panel.id, itemName: panel.name, fieldId: panel.fields[0].id, fieldName: panel.fields[0].name,
      oldValue: '0', newValue: '2', reason: '作者确认数量', chapterIndex: 0 }
    const gate = holdWrite()
    const rename = workspace.transactStory(novel.id, aggregate => {
      aggregate.novel.dataPanels[0].fields[0].name = '重量'
    })
    await gate.started
    const pending = expect(novels.addDataPanelChange(novel.id, input)).rejects.toThrow('已变化')
    gate.release(); await rename; await pending
    expect(novel.dataPanelChanges).toHaveLength(0)
    expect((await stored()).novel!.dataPanels[0].fields[0].name).toBe('重量')
  })

  it('binds an automation request to its chapter identity before an identical-body reorder commits', async () => {
    await seedPanel()
    await workspace.transactStory(novel.id, aggregate => {
      aggregate.novel.dataPanels[0].fields[0].automationRules = [{ id: 'per-chapter', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true }]
      aggregate.novel.chapters[1].content = aggregate.novel.chapters[0].content
    })
    const content = novel.chapters[0].content
    const gate = holdWrite()
    const reorder = workspace.transactStory(novel.id, aggregate => {
      aggregate.novel.chapters[0].chapterIndex = 1
      aggregate.novel.chapters[1].chapterIndex = 0
    })
    await gate.started
    const pending = expect(novels.queueAutomaticDataPanelChanges(novel.id, 0, content)).rejects.toThrow('已变化')
    gate.release(); await reorder; await pending
    expect(novel.dataPanelChanges).toHaveLength(0)
    expect((await stored()).novel!.dataPanels[0].fields[0].automationRules![0].pendingChapterIndex).toBeUndefined()
  })

  it('saves a clock edit, rule reservations and proposals atomically and retries after disk failure', async () => {
    const panel = await seedPanel(), { STORY_CLOCK_SOURCE } = await import('./dataPanel')
    // Configure the author-owned rule through its source-recording entry point,
    // then establish a completed chapter before exercising the clock transaction.
    await commitPanelEdit({ action: 'update', itemId: panel.id, item: { fields: [
      { ...panel.fields[0], automationRules: [{ id: 'elapsed', trigger: 'elapsed_days', amount: 1, interval: 2,
        sourceFieldName: STORY_CLOCK_SOURCE, enabled: true }] }, panel.fields[1],
    ] } })
    await workspace.transactStory(novel.id, aggregate => { aggregate.novel.chapters[0].status = 'completed' })
    const { projectDataPanelReferences } = await import('./dataPanelReference')
    expect(projectDataPanelReferences(novel, 0).issues).toEqual([])
    expect(novel.chapters[0].status).toBe('completed')
    const before = copy(await stored())
    const commit = () => novels.advanceStoryClock(novel.id, 5, 0)
    failWrite()
    await expect(commit()).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before)
    expect(novel.storyClock!.currentDay).toBe(0)
    const gate = holdWrite(), saving = commit()
    await gate.started
    expect(panel.fields[0].automationRules![0].pendingChapterIndex).toBeUndefined()
    expect(novel.dataPanelChanges).toHaveLength(0)
    gate.release(); expect((await saving)!.currentDay).toBe(5)
    const saved = await stored()
    expect(saved.novel!.dataPanelChanges).toMatchObject([{ status: 'pending', oldValue: '0', newValue: '2', sourceBinding: { kind: 'automation' } }])
    expect(saved.novel!.dataPanels[0].fields[0]).toMatchObject({ value: '0', automationRules: [{ pendingChapterIndex: 0, lastSourceValue: 0 }] })
    const writes = writeCount
    expect((await commit())!.currentDay).toBe(5)
    expect(writeCount).toBe(writes)
  })

  let creationTestId = 0
  async function commitCreation(edit: import('./creationTransactions').CreationEdit, baseline?: string) {
    const { applyCreationEdit, captureCreationBaseline } = await import('./creationTransactions')
    const expected = baseline ?? captureCreationBaseline(novel, workspace.getCreationDraft(novel.id))
    return workspace.transactStory(novel.id, aggregate => applyCreationEdit(aggregate, edit, expected,
      '2026-10-31T06:00:00.000Z', () => 'creation-test-' + (++creationTestId)), changed => !changed)
  }

  it('persists an outline candidate without publishing it or invalidating the current manuscript review', async () => {
    const previous = copy(novel)
    await commitCreation({ action: 'outline-candidate', source: 'model', content: '## 小说简介\n等待作者确认的大纲' })
    expect(novel.outline).toBe(previous.outline)
    expect(novel.chapters).toEqual(previous.chapters)
    const saved = await stored()
    expect(saved.workspace.creationDraft!.outlineCandidate!.content).toContain('等待作者确认')
    expect(saved.workspace.impactReports![saved.workspace.impactReports!.length - 1].reviewChapterIds).toEqual([])
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCreationDraft(novel.id)!.outlineCandidate).toEqual(saved.workspace.creationDraft!.outlineCandidate)
  })

  it('keeps existing reviews valid while first skeleton candidates are saved and edited before confirmation', async () => {
    const { buildChapterReviewSourceVersion, buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const skeleton = copy(workspace.getCreationDraft(novel.id)!.skeletons[0])
    await workspace.transactStory(novel.id, aggregate => {
      const draft = aggregate.workspace.creationDraft!
      draft.skeletons = []; delete draft.selectedSkeletonId; delete draft.approval.skeleton
      const chapter = aggregate.novel.chapters[0]
      const source = buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(aggregate.novel, chapter, [], draft))
      chapter.contentReviewSignature = 'existing-manuscript-review'
      aggregate.workspace.chapterReviews![0].sourceVersionId = source
    })
    const before = copy(await stored())
    const edits: import('./creationTransactions').CreationEdit[] = [
      { action: 'skeleton-candidates', candidates: [{ ...skeleton, approval: 'draft' }] },
      { action: 'skeleton', selectedId: skeleton.id, skeleton: { ...skeleton, ending: '尚未确认的新结局' } },
      { action: 'outline-candidate', source: 'author', content: '## 小说简介\n作者准备中的方向' },
    ]
    for (const edit of edits) {
      await commitCreation(edit)
      const saved = await stored(), chapter = saved.novel!.chapters[0]
      expect(saved.novel!.chapters).toEqual(before.novel!.chapters)
      expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
      expect(saved.workspace.impactReports![saved.workspace.impactReports!.length - 1].reviewChapterIds).toEqual([])
      expect(buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(saved.novel!, chapter, [], saved.workspace.creationDraft)))
        .toBe(before.workspace.chapterReviews![0].sourceVersionId)
    }
    await commitCreation({ action: 'confirm-skeleton' })
    expect((await stored()).novel!.chapters[0].contentReviewSignature).toBe('')
    expect((await stored()).novel!.chapters[0].status).toBe('writing')
  })

  it('still invalidates reviews when editing withdraws an already confirmed story direction', async () => {
    const skeleton = copy(workspace.getCreationDraft(novel.id)!.skeletons[0])
    await commitCreation({ action: 'skeleton', selectedId: skeleton.id, skeleton: { ...skeleton, ending: '变更已确认方向' } })
    await commitCreation({ action: 'confirm-skeleton' })
    const saved = await stored()
    expect(saved.novel!.chapters[0].status).toBe('writing')
    expect(saved.novel!.chapters[0].contentReviewSignature).toBe('')
    expect(saved.workspace.impactReports![saved.workspace.impactReports!.length - 1].reviewChapterIds).toContain(novel.chapters[0].id)
  })

  it('atomically accepts outline, imported entities, volumes and approval state and does not duplicate a retry', async () => {
    const content = '## 小说简介\n查清失窃案\n## 主要角色表\n| 姓名 | 身份 | 性格 | 背景 |\n| --- | --- | --- | --- |\n| 陈伯 | 守夜人 | 克制 | 渡口旧友 |\n## 全书伏笔\n- 铜印 — 指向值夜记录\n## 第一卷：调查\n预估章节数：3章\n预估字数：1万字'
    await commitCreation({ action: 'outline-candidate', source: 'model', content })
    const previous = copy(await stored())
    failWrite()
    await expect(commitCreation({ action: 'accept-outline', content })).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(previous)
    expect(novel.outline).toBe(previous.novel!.outline)
    expect(workspace.getCreationDraft(novel.id)!.outlineCandidate!.content).toBe(content)
    const hold = holdWrite(), accepted = commitCreation({ action: 'accept-outline', content })
    await hold.started
    expect(novel.outline).toBe(previous.novel!.outline)
    expect(novel.characters.some(person => person.name === '陈伯')).toBe(false)
    hold.release(); await accepted
    const saved = await stored()
    expect(saved.novel!.outline).toBe(content)
    expect(saved.novel!.status).toBe('writing')
    expect(saved.novel!.characters.filter(person => person.name === '陈伯')).toHaveLength(1)
    expect(saved.novel!.eventLog.filter(event => event.title === '铜印')).toHaveLength(1)
    expect(saved.novel!.volumes).toHaveLength(1)
    expect(saved.workspace.creationDraft!.outlineCandidate).toBeUndefined()
    expect(saved.novel!.chapters[0].contentReviewSignature).toBe('')
    expect(saved.workspace.impactReports!.length).toBe(previous.workspace.impactReports!.length + 1)
    const writes = writeCount
    expect(await commitCreation({ action: 'accept-outline', content })).toBe(false)
    expect(writeCount).toBe(writes)
    expect(await stored()).toEqual(saved)
  })

  it('rejects acceptance of an incomplete candidate before any durable write', async () => {
    const content = '## 小说简介\n尚未完整的返回'
    await commitCreation({ action: 'outline-candidate', source: 'model', content, complete: false })
    const before = copy(await stored()), writes = writeCount
    await expect(commitCreation({ action: 'accept-outline', content })).rejects.toThrow('未完整生成')
    expect(writeCount).toBe(writes)
    expect(await stored()).toEqual(before)
  })

  it('reopens explicit native confirmations without changing review signatures or approved plans', async () => {
    const { materializeContractConfirmations } = await import('./storyContract')
    const { buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const before = copy(await stored()), draft = workspace.getCreationDraft(novel.id)!
    const priorVersion = buildReviewContextVersion(novel, novel.chapters[0], [], draft)
    await commitCreation({ action: 'contract', confirm: false, contract: materializeContractConfirmations(copy(draft.contract)) })
    const saved = await stored()
    expect(saved.workspace.creationDraft!.contract.cardConfirmations).toHaveLength(8)
    expect(saved.workspace.creationDraft!.approval).toEqual(before.workspace.creationDraft!.approval)
    expect(saved.workspace.creationDraft!.selectedSkeletonId).toBe(before.workspace.creationDraft!.selectedSkeletonId)
    expect(saved.novel!.chapters).toEqual(before.novel!.chapters)
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    expect(buildReviewContextVersion(saved.novel!, saved.novel!.chapters[0], [], saved.workspace.creationDraft)).toBe(priorVersion)
  })

  it('rolls back a confirmed contract and its title and review invalidation together', async () => {
    const original = copy(await stored()), draft = workspace.getCreationDraft(novel.id)!
    const edit = { action: 'contract' as const, confirm: true, contract: { ...copy(draft.contract),
      title: '新作品名', genre: '悬疑', centralConflict: '查清证据', endingDirection: '澄清误会' } }
    edit.contract = confirmTestContractCards(edit.contract, now)
    failWrite()
    await expect(commitCreation(edit)).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(original)
    expect(novel.title).toBe(original.novel!.title)
    expect(workspace.getCreationDraft(novel.id)).toEqual(original.workspace.creationDraft)
    await commitCreation(edit)
    const saved = await stored()
    expect(saved.novel!.title).toBe('新作品名')
    expect(saved.workspace.creationDraft!.contract.approval).toBe('approved')
    expect(saved.workspace.creationDraft!.approval.skeleton).not.toBe('approved')
    expect(saved.novel!.chapters[0].status).toBe('writing')
    expect(saved.workspace.impactReports).toHaveLength(1)
  })

  it('rejects a delayed creation result captured before the author changed the contract', async () => {
    const { captureCreationBaseline } = await import('./creationTransactions')
    const before = captureCreationBaseline(novel, workspace.getCreationDraft(novel.id))
    const draft = workspace.getCreationDraft(novel.id)!
    await commitCreation({ action: 'contract', confirm: false, contract: { ...copy(draft.contract), title: '作者正在改的标题' } })
    const saved = copy(await stored())
    await expect(commitCreation({ action: 'skeleton-candidates', candidates: [{ ...copy(draft.skeletons[0]), approval: 'draft' }] }, before))
      .rejects.toThrow('已经变化')
    expect(await stored()).toEqual(saved)
  })

  it('rejects an old model outline after its confirmed story direction changes', async () => {
    const content = '## 小说简介\n旧方向候选'
    await commitCreation({ action: 'outline-candidate', source: 'model', content })
    const skeleton = copy(workspace.getCreationDraft(novel.id)!.skeletons[0])
    await commitCreation({ action: 'skeleton', selectedId: skeleton.id, skeleton: { ...skeleton, ending: '作者的新结局' } })
    await commitCreation({ action: 'confirm-skeleton' })
    const saved = copy(await stored())
    await expect(commitCreation({ action: 'accept-outline', content })).rejects.toThrow('来源设定或故事方向已经变化')
    expect(await stored()).toEqual(saved)
  })

  it('commits an author-confirmed plan batch with V2 planning, invalidation and one report atomically', async () => {
    const { applyChapterPlanEdit, chapterPlanningSourceVersion } = await import('./storyPlanTransactions')
    const input = copy(novel.chapterPlans![0])
    const edit = { action: 'create-batch' as const, planningSourceVersion: chapterPlanningSourceVersion(novel, workspace.getStoryMemories(novel.id)),
      plans: [{ ...input, title: '核对登记册', source: 'ai' as const }, { ...input, title: '追访守夜人', source: 'ai' as const }] }
    const commit = () => workspace.transactStory(novel.id, aggregate => applyChapterPlanEdit(aggregate, edit, now, () => 'batch-' + (++creationTestId)))
    const before = copy(await stored())
    failWrite(); await expect(commit()).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before); expect(novel.chapterPlans).toHaveLength(1)
    const hold = holdWrite(), pending = commit()
    await hold.started; expect(novel.chapterPlans).toHaveLength(1)
    hold.release(); await pending
    const saved = await stored()
    expect(saved.novel!.chapterPlans).toHaveLength(3)
    expect(saved.workspace.creationDraft!.chapterPlans).toHaveLength(3)
    expect(saved.workspace.impactReports).toHaveLength(1)
    expect(saved.workspace.impactReports![0].changes.filter(change => change.target.kind === 'plan')).toHaveLength(2)
    expect(saved.novel!.chapters[0].contentReviewSignature).toBe('')
    workspace.clearNovel(novel.id); await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCreationDraft(novel.id)).toEqual(saved.workspace.creationDraft)
  })

  it('rejects stale plan candidates and stale planning confirmation before writing', async () => {
    const { applyChapterPlanEdit, chapterPlanningSourceVersion } = await import('./storyPlanTransactions')
    const source = chapterPlanningSourceVersion(novel, workspace.getStoryMemories(novel.id))
    const confirm = { action: 'confirm-planning' as const, expectedVolumes: JSON.stringify(novel.volumes), expectedPlans: JSON.stringify(novel.chapterPlans) }
    await workspace.transactStory(novel.id, aggregate => {
      aggregate.novel.outline = '作者改变总纲'
      aggregate.novel.chapterPlans![0].objective = '作者改变目标'
    })
    const before = copy(await stored()), writes = writeCount
    await expect(workspace.transactStory(novel.id, aggregate => applyChapterPlanEdit(aggregate,
      { action: 'create-batch', plans: [{ ...copy(novel.chapterPlans![0]), title: '旧方向建议' }], planningSourceVersion: source }, now, () => 'stale'))).rejects.toThrow('已经变化')
    await expect(workspace.transactStory(novel.id, aggregate => applyChapterPlanEdit(aggregate, confirm, now, () => 'stale'))).rejects.toThrow('已经变化')
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
  })

  async function commitScenes(edit: import('./scenePlanningTransactions').ScenePlanningEdit, baseline?: string) {
    const { captureScenePlanningBaseline } = await import('./scenePlanningTransactions')
    return workspace.commitScenePlanningEdit(novel.id, edit, baseline ?? captureScenePlanningBaseline(novel, workspace.getCreationDraft(novel.id)))
  }

  it('persists pending scene candidates without changing approved review inputs or current chapters', async () => {
    const { buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const draft = workspace.getCreationDraft(novel.id)!, before = copy(await stored())
    const input = { ...copy(draft.scenePlans[0]), title: '先问守卫', outputState: '只得知缺页' }
    const versions = novel.chapters.map(chapter => buildReviewContextVersion(novel, chapter, [], draft))
    await commitScenes({ action: 'scenes', planId: input.chapterPlanId, scenes: [input], confirm: false })
    const saved = await stored()
    expect(saved.novel!.chapters).toEqual(before.novel!.chapters)
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    expect(saved.workspace.creationDraft!.scenePlans.filter(scene => scene.approval === 'approved')).toHaveLength(1)
    expect(saved.workspace.creationDraft!.scenePlans.filter(scene => scene.approval === 'awaiting_approval')).toHaveLength(1)
    expect(saved.novel!.chapters.map(chapter => buildReviewContextVersion(saved.novel!, chapter, [], saved.workspace.creationDraft))).toEqual(versions)
    expect(saved.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs', reviewChapterIds: [] })
    const writes = writeCount
    expect((await commitScenes({ action: 'scenes', planId: input.chapterPlanId, scenes: [input], confirm: false })).changed).toBe(false)
    expect(writeCount).toBe(writes)
    expect(await stored()).toEqual(saved)
  })

  it('approves scenes atomically and invalidates only chapters with changed approved inputs', async () => {
    const before = copy(await stored()), draft = workspace.getCreationDraft(novel.id)!
    const input = { ...copy(draft.scenePlans[0]), title: '仓库门前', outputState: '找到门锁上的刻痕' }
    const edit = { action: 'scenes' as const, planId: input.chapterPlanId, scenes: [input], confirm: true }
    failWrite(); await expect(commitScenes(edit)).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before); expect(workspace.getCreationDraft(novel.id)).toEqual(before.workspace.creationDraft)
    const hold = holdWrite(), pending = commitScenes(edit)
    await hold.started
    expect(workspace.getCreationDraft(novel.id)).toEqual(before.workspace.creationDraft)
    expect(novel.chapters).toEqual(before.novel!.chapters)
    hold.release(); await pending
    const saved = await stored()
    expect(saved.novel!.chapters[0].contentReviewSignature).toBe('')
    expect(saved.novel!.chapters[0].status).toBe('writing')
    expect(saved.novel!.chapters.slice(1)).toEqual(before.novel!.chapters.slice(1))
    expect(saved.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs', reviewChapterIds: [novel.chapters[0].id] })
    expect(saved.workspace.creationDraft!.scenePlans.filter(scene => scene.approval === 'approved')).toHaveLength(1)
    expect(saved.workspace.creationDraft!.scenePlans.filter(scene => scene.approval === 'rejected')).toHaveLength(1)
    const writes = writeCount
    expect((await commitScenes(edit)).changed).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(saved)
    workspace.clearNovel(novel.id); await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCreationDraft(novel.id)).toEqual(saved.workspace.creationDraft)
    expect(workspace.getImpactReports(novel.id)).toEqual(saved.workspace.impactReports)
  })

  it('rejects an old scene form or model result before any write and keeps the newer plan', async () => {
    const { captureScenePlanningBaseline } = await import('./scenePlanningTransactions')
    const draft = workspace.getCreationDraft(novel.id)!, baseline = captureScenePlanningBaseline(novel, draft)
    const input = copy(draft.scenePlans[0])
    await workspace.transactStory(novel.id, aggregate => { aggregate.workspace.creationDraft!.chapterPlans[0].conflict = '另一窗口的冲突设计' })
    const before = copy(await stored()), writes = writeCount
    await expect(commitScenes({ action: 'scenes', planId: input.chapterPlanId, scenes: [input], confirm: false }, baseline)).rejects.toThrow('已变化')
    await expect(commitScenes({ action: 'chapter', plan: copy(draft.chapterPlans[0]), confirm: true }, baseline)).rejects.toThrow('已变化')
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
  })

  it('does not save an unchanged scene sync and keeps chapter approval with its affected review in one transaction', async () => {
    const before = copy(await stored()), writes = writeCount
    expect((await commitScenes({ action: 'sync' })).changed).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
    const plan = { ...copy(workspace.getCreationDraft(novel.id)!.chapterPlans[0]), prohibitedReveals: ['不得提前知晓信中内容'] }
    failWrite(); await expect(commitScenes({ action: 'chapter', plan, confirm: true })).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before)
    await commitScenes({ action: 'chapter', plan, confirm: true })
    const saved = await stored()
    expect(saved.workspace.creationDraft!.chapterPlans[0]).toMatchObject({ prohibitedReveals: ['不得提前知晓信中内容'], approval: 'approved' })
    expect(saved.workspace.creationDraft!.scenePlans[0].approval).not.toBe('approved')
    expect(saved.workspace.impactReports![0].reviewChapterIds).toEqual([novel.chapters[0].id])
    expect(saved.novel!.chapters.slice(1)).toEqual(before.novel!.chapters.slice(1))
  })

  it('publishes an impact report only with the durable definition edit and reloads it intact', async () => {
    const hold = holdWrite()
    const update = novels.updateCharacter(novel.id, 'person-0', { identity: '调查员' })
    await hold.started
    expect(workspace.getImpactReports(novel.id)).toEqual([])
    expect(novel.characters[0].identity).not.toBe('调查员')
    novels.updateChapter(novel.id, novel.chapters[0].id, { content: novel.chapters[0].content + '保存期间作者继续写作。' })
    hold.release(); await update
    const reports = copy(workspace.getImpactReports(novel.id))
    expect(reports).toHaveLength(1)
    expect(reports[0].changes[0]).toMatchObject({ target: { kind: 'character', id: 'person-0' }, fields: ['identity'] })
    await novels.flushPendingSaves()
    const saved = await stored()
    expect(saved.workspace.impactReports).toEqual(reports)
    expect(saved.novel!.chapters[0].content).toContain('保存期间作者继续写作。')
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getImpactReports(novel.id)).toEqual(reports)
  })

  it('rolls back reports with a failed batch and leaves no extra history for a stale retry', async () => {
    failWrite()
    await expect(novels.commitEntityDefinitions(novel.id, [
      { action: 'create', kind: 'character', data: { name: '顾临' } },
      { action: 'create', kind: 'event', data: { title: '寻找铜钥匙', description: '', chapterIndex: -1, characters: [], type: '伏笔' } },
    ])).rejects.toThrow('模拟磁盘事务失败')
    expect(workspace.getImpactReports(novel.id)).toEqual([])
    expect((await stored()).workspace.impactReports || []).toEqual([])
    expect(novel.characters.some(character => character.name === '顾临')).toBe(false)
    const baseline = JSON.stringify(novel.characters[0])
    const hold = holdWrite()
    const first = novels.saveEntityDefinition(novel.id, 'character', 'person-0', baseline, { identity: '调查员' })
    await hold.started
    const stale = expect(novels.saveEntityDefinition(novel.id, 'character', 'person-0', baseline, { identity: '旧请求' })).rejects.toThrow()
    hold.release(); await first; await stale
    expect(workspace.getImpactReports(novel.id)).toHaveLength(1)
    expect((await stored()).workspace.impactReports).toHaveLength(1)
  })

  it('commits arc reports with current unsaved workspace references in the shared queue', async () => {
    const draft = copy(workspace.getCreationDraft(novel.id)!)
    draft.scenePlans[0].title = '未单独保存的场景'
    workspace.setCreationDraft(novel.id, draft)
    await novels.commitStoryArcEdit(novel.id, { action: 'create', definition: { title: '钥匙的秘密', description: '', type: 'mystery',
      importance: 3, status: 'active', reactivateAt: '', characterIds: ['person-0'] }, nodes: [{ title: '找到铜钥匙', description: '', targetChapter: 0 }] })
    const reports = workspace.getImpactReports(novel.id)
    expect(reports).toHaveLength(1)
    expect(reports[0].changes[0].target.kind).toBe('arc')
    expect(reports[0].affected.some(item => item.target.kind === 'node')).toBe(true)
    expect((await stored()).workspace.creationDraft!.scenePlans[0].title).toBe('未单独保存的场景')
    expect((await stored()).workspace.impactReports).toEqual(copy(reports))
    await workspace.persistToDatabase(novel.id)
    expect((await stored()).workspace.impactReports).toEqual(copy(reports))
  })

  it('commits outline and review invalidation together, without reports or writes for unchanged context', async () => {
    const chapter = novel.chapters[0], before = copy(await stored())
    failWrite()
    await expect(novels.updateOutlineWithImpact(novel.id, '修订后的全书方向')).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    expect(chapter.status).toBe('completed')
    await novels.updateOutlineWithImpact(novel.id, '修订后的全书方向')
    const saved = await stored()
    expect(saved.novel!.outline).toBe('修订后的全书方向')
    expect(saved.novel!.chapters[0]).toMatchObject({ status: 'writing', contentReviewSignature: '' })
    expect(saved.workspace.impactReports).toHaveLength(1)
    expect(saved.workspace.impactReports![0].changes).toEqual([
      { target: { kind: 'novel', id: novel.id, label: novel.title }, action: 'update', fields: ['outline'] },
    ])
    const writes = writeCount
    await novels.updateOutlineWithImpact(novel.id, novel.outline)
    await novels.updateTitleWithImpact(novel.id, novel.title)
    expect(writeCount).toBe(writes)
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getImpactReports(novel.id)).toEqual(saved.workspace.impactReports)
  })

  it('rejects a queued context edit whose baseline changed before its turn', async () => {
    const hold = holdWrite()
    const first = novels.updateOutlineWithImpact(novel.id, '先确认的大纲')
    await hold.started
    const stale = expect(novels.updateOutlineWithImpact(novel.id, '旧窗口大纲')).rejects.toThrow('已经变化')
    hold.release()
    await first
    await stale
    expect((await stored()).novel!.outline).toBe('先确认的大纲')
    expect(workspace.getImpactReports(novel.id)).toHaveLength(1)
    expect(writeCount).toBe(1)
  })

  it('keeps durable volume history, rejects stale edits and remaps chapters by volume identity', async () => {
    const volume = { id: 'volume-a', volumeIndex: 0, title: '启程', theme: '选择', summary: '原卷纲',
      keyTurningPoints: '', characterChanges: '', estimatedChapters: 10, estimatedWordCount: 2, versions: [] }
    const second = { ...volume, id: 'volume-b', volumeIndex: 1, title: '归来' }
    await novels.setVolumesWithImpact(novel.id, [volume, second])
    const chapter = novel.chapters[0]
    novels.updateChapter(novel.id, chapter.id, { volumeIndex: 1 })
    await novels.saveNovelNow(novel.id)
    const before = copy(await stored())
    failWrite()
    await expect(novels.updateVolumeWithImpact(novel.id, volume.id, { summary: '失败的卷纲' })).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    const hold = holdWrite()
    const first = novels.updateVolumeWithImpact(novel.id, volume.id, { summary: '新卷纲' })
    await hold.started
    const stale = expect(novels.updateVolumeWithImpact(novel.id, volume.id, { summary: '迟到的卷纲' })).rejects.toThrow('已经变化')
    hold.release(); await first; await stale
    const edited = (await stored()).novel!.volumes[0]
    expect(edited.summary).toBe('新卷纲')
    expect(JSON.parse(edited.versions![0].snapshot)).toMatchObject({ volumeIndex: 0, summary: '原卷纲' })
    const reports = workspace.getImpactReports(novel.id)
    expect(reports[reports.length - 1].changes[0]).toMatchObject({ target: { kind: 'volume', id: volume.id }, fields: ['summary'] })
    await novels.deleteVolumeWithImpact(novel.id, volume.id)
    expect(chapter.volumeIndex).toBe(0)
    expect((await stored()).novel!.chapters[1].volumeIndex).toBe(-1)
    expect((await stored()).novel!.volumes[0].id).toBe(second.id)
    const writes = writeCount
    await novels.setVolumesWithImpact(novel.id, copy(novel.volumes))
    expect(writeCount).toBe(writes)
    novels.updateChapter(novel.id, chapter.id, { status: 'locked' })
    await novels.saveNovelNow(novel.id)
    await expect(novels.deleteVolumeWithImpact(novel.id, second.id)).rejects.toThrow('锁定')
    expect((await stored()).novel!.volumes).toHaveLength(1)
  })

  it('keeps other-volume reviews and reports only actual changed inputs in the same durable edit', async () => {
    const volume = { id: 'scope-volume-a', volumeIndex: 0, title: '前卷', theme: '寻找', summary: '渡口寻找钥匙',
      keyTurningPoints: '', characterChanges: '', estimatedChapters: 2, estimatedWordCount: 4000, versions: [] }
    await novels.setVolumesWithImpact(novel.id, [volume, { ...volume, id: 'scope-volume-b', volumeIndex: 1, title: '后卷' }])
    const later = novel.chapters[2]
    novels.updateChapter(novel.id, later.id, { volumeIndex: 1 })
    for (const chapter of novel.chapters) novels.updateChapter(novel.id, chapter.id, { status: 'reviewed', contentReviewSignature: 'retained-' + chapter.id })
    await novels.saveNovelNow(novel.id)
    const before = copy(await stored()), original = copy(novel)
    failWrite()
    await expect(novels.updateVolumeWithImpact(novel.id, volume.id, { summary: '渡口验证钥匙的来历' })).rejects.toThrow('模拟磁盘')
    expect(copy(novel)).toEqual(original); expect(await stored()).toEqual(before)
    await novels.updateVolumeWithImpact(novel.id, volume.id, { summary: '渡口验证钥匙的来历' })
    expect(later.contentReviewSignature).toBe('retained-' + later.id)
    expect(later.status).toBe('reviewed')
    const saved = await stored(), report = saved.workspace.impactReports!.slice(-1)[0]
    expect(report.reviewPolicy).toBe('changed-inputs')
    expect(report.reviewChapterIds).toEqual(novel.chapters.slice(0, 2).map(chapter => chapter.id))
    expect(saved.novel!.chapters[2].contentReviewSignature).toBe('retained-' + later.id)
  })

  it.each(['summary', 'theme', 'estimatedChapters'] as const)('atomically invalidates volume approval and dependent plans/scenes for %s, retaining them on a failed save', async field => {
    const volume = { id: 'volume-approval', volumeIndex: 0, title: '渡口', theme: '寻找', summary: '旧卷纲',
      keyTurningPoints: '找到线索', characterChanges: '开始调查', estimatedChapters: 10, estimatedWordCount: 2, versions: [] }
    await novels.setVolumesWithImpact(novel.id, [volume, { ...volume, id: 'volume-unrelated', volumeIndex: 1, title: '远期分卷' }])
    const draft = copy(workspace.getCreationDraft(novel.id)!)
    draft.volumes.forEach(item => { item.approval = 'approved' })
    draft.chapterPlans.forEach(item => { item.approval = 'approved' })
    draft.scenePlans.forEach(item => { item.approval = 'approved' })
    draft.approval['volume-outline'] = 'approved'
    draft.approval['chapter-outline'] = 'approved'
    workspace.setCreationDraft(novel.id, draft)
    novels.setChapterPlanConfirmed(novel.id, true)
    novels.updateChapter(novel.id, novel.chapters[0].id, { status: 'completed' })
    await novels.saveNovelNow(novel.id)
    await workspace.persistToDatabase(novel.id)
    const baseline = novels.capturePlanningEditBaseline(novel.id, volume.id), before = copy(await stored())
    const updates = field === 'estimatedChapters' ? { estimatedChapters: 12 } : { [field]: '新卷纲' }
    const writes = writeCount
    await novels.updateVolumeWithImpact(novel.id, volume.id, { summary: volume.summary }, baseline)
    expect(writeCount).toBe(writes)
    expect(novel.chapterPlanConfirmed).toBe(true)
    failWrite()
    await expect(novels.updateVolumeWithImpact(novel.id, volume.id, updates, baseline)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    expect(novel.chapterPlanConfirmed).toBe(true)
    expect(workspace.getCreationDraft(novel.id)).toEqual(draft)
    const writesBeforeRetry = writeCount
    await novels.updateVolumeWithImpact(novel.id, volume.id, updates, baseline)
    expect(writeCount).toBe(writesBeforeRetry + 1)
    const saved = await stored()
    expect(saved.novel!.chapterPlanConfirmed).toBe(false)
    expect(saved.novel!.chapters[0].status).toBe('writing')
    expect(saved.workspace.creationDraft!.volumes[0].approval).toBe('draft')
    expect(saved.workspace.creationDraft!.volumes[1].approval).toBe('approved')
    expect(saved.workspace.creationDraft!.chapterPlans[0].approval).toBe('draft')
    expect(saved.workspace.creationDraft!.scenePlans[0].approval).toBe('draft')
    expect(saved.workspace.impactReports).toHaveLength(before.workspace.impactReports!.length + 1)
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCreationDraft(novel.id)).toEqual(saved.workspace.creationDraft)
  })

  it.each(['edit', 'replace', 'delete'] as const)('rejects a %s using a form/request baseline from before a completed context change', async action => {
    const volume = { id: 'volume-form', volumeIndex: 0, title: '渡口', theme: '', summary: '旧卷纲',
      keyTurningPoints: '', characterChanges: '', estimatedChapters: 10, estimatedWordCount: 2, versions: [] }
    await novels.setVolumesWithImpact(novel.id, [volume])
    const baseline = novels.capturePlanningEditBaseline(novel.id, volume.id)
    await novels.updateOutlineWithImpact(novel.id, '作者已经确认的新方向')
    const before = copy(await stored()), writes = writeCount
    const stale = action === 'edit' ? novels.updateVolumeWithImpact(novel.id, volume.id, { summary: '旧窗口修改' }, baseline)
      : action === 'replace' ? novels.setVolumesWithImpact(novel.id, [{ ...volume, summary: '迟到的 AI 规划' }], baseline)
        : novels.deleteVolumeWithImpact(novel.id, volume.id, baseline)
    await expect(stale).rejects.toThrow('已经变化')
    expect(await stored()).toEqual(before)
    expect(writeCount).toBe(writes)
  })

  it('rejects an outline form baseline captured before a completed edit', async () => {
    const { captureStoryContextBaseline } = await import('./storyImpactTransactions')
    const baseline = captureStoryContextBaseline(novel)
    await novels.updateOutlineWithImpact(novel.id, '较新的大纲')
    const writes = writeCount
    await expect(novels.updateOutlineWithImpact(novel.id, '旧窗口大纲', baseline)).rejects.toThrow('已经变化')
    expect(writeCount).toBe(writes)
    expect((await stored()).novel!.outline).toBe('较新的大纲')
  })

  async function completedReviewSubmission(): Promise<import('./chapterReviewTransactions').ChapterReviewSubmission> {
    const { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const { buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const chapter = novel.chapters[0]
    const context = buildReviewContextVersion(novel, chapter, [], workspace.getCreationDraft(novel.id),
      workspace.getCanonMutations(novel.id), workspace.getStoryMemories(novel.id))
    const signature = buildChapterReviewSignature(chapter.content, context)
    return { chapterId: chapter.id, content: chapter.content, report: '## 结论\n总体判断：✅可通过\n## 必改问题\n无。',
      review: { ...copy(workspace.getLatestChapterReview(novel.id, chapter.id)!), id: 'new-manual-review',
        sourceVersionId: buildChapterReviewSourceVersion(chapter.content, context),
        findings: [{ id: 'manual-finding', chapterId: chapter.id, sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
          type: 'style', severity: 'suggestion', title: '措辞建议', explanation: '可以进一步精炼。', evidence: [], status: 'open', blocksFinalization: false }] },
      coverage: { signature, status: 'complete', globalStatus: 'not-needed', totalChunks: 1, completedChunks: 1,
        coveredCharacters: chapter.content.length, totalCharacters: chapter.content.length },
    }
  }

  it('saves a full review report, findings and structured result atomically and restores them after reload', async () => {
    const input = await completedReviewSubmission(), before = copy(await stored()), chapter = novel.chapters[0]
    failWrite()
    await expect(workspace.commitChapterReview(novel.id, input)).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before)
    expect(chapter.contentReview).toBe(before.novel!.chapters[0].contentReview)
    expect(workspace.getReviewFindings(novel.id, chapter.id)).toEqual(before.workspace.reviewFindings)
    const gate = holdWrite(), saving = workspace.commitChapterReview(novel.id, input)
    await gate.started
    expect(chapter.contentReview).toBe(before.novel!.chapters[0].contentReview)
    expect(workspace.getReviewFindings(novel.id, chapter.id)).toEqual(before.workspace.reviewFindings)
    gate.release(); await saving
    expect(chapter.contentReview).toBe(input.report)
    expect(workspace.getReviewFindings(novel.id, chapter.id)).toHaveLength(1)
    expect(workspace.getLatestChapterReview(novel.id, chapter.id)?.status).toBe('ready_to_finalize')
    expect(workspace.getChapterReviews(novel.id, chapter.id).filter(row => row.sourceVersionId === version)).toHaveLength(1)
    expect((await stored()).workspace.canonMutations).toEqual(before.workspace.canonMutations)
    const writes = writeCount
    await workspace.commitChapterReview(novel.id, input)
    expect(writeCount).toBe(writes)
    disposePinia(pinia); pinia = createPinia(); setActivePinia(pinia)
    novels = (await import('@/stores/novel')).useNovelStore(); await novels.initStore(); novel = novels.novels[0]
    workspace = (await import('@/stores/reconstructionWorkspace')).useReconstructionWorkspaceStore()
    await workspace.hydrateFromPersistence(novel.id)
    expect(novel.chapters[0].contentReview).toBe(input.report)
    expect(novel.chapters[0].contentReviewCoverage).toEqual(input.coverage)
    expect(workspace.getLatestChapterReview(novel.id, chapter.id)?.findings).toEqual(workspace.getReviewFindings(novel.id, chapter.id))
  })

  it('preserves author decisions only for the same completed review input', async () => {
    const input = await completedReviewSubmission()
    await workspace.commitChapterReview(novel.id, input)
    await workspace.resolveStoryReviewFinding(novel.id, 'manual-finding', 'intentional', now)
    await workspace.commitChapterReview(novel.id, input)
    expect(workspace.getReviewFindings(novel.id)[0].status).toBe('intentional')
    await novels.updateOutlineWithImpact(novel.id, '作者改了全书规则，需要重新核对相同问题。')
    await workspace.commitChapterReview(novel.id, await completedReviewSubmission())
    expect(workspace.getReviewFindings(novel.id)[0].status).toBe('open')
    expect((await stored()).workspace.reviewFindings[0].status).toBe('open')
  })

  it('recomputes a completed review verdict and removes a stale finalized state when new findings block', async () => {
    const input = await completedReviewSubmission()
    novel.chapters[0].status = 'finalized'
    input.report = '## 结论\n总体判断：⚠️建议修改\n## 必改问题\n1. 时间矛盾'
    input.review.status = 'approved'; input.review.semanticChecksPassed = true
    Object.assign(input.review.findings[0], { severity: 'blocker', blocksFinalization: true })
    await workspace.commitChapterReview(novel.id, input)
    expect(novel.chapters[0].status).toBe('writing')
    expect(workspace.getLatestChapterReview(novel.id, input.chapterId)).toMatchObject({ semanticChecksPassed: false, status: 'needs_revision' })
    expect((await stored()).novel!.chapters[0].status).toBe('writing')
  })

  it.each(['body', 'context', 'coverage', 'finding', 'report'] as const)('refuses a completed review with changed or incomplete %s', async kind => {
    const input = await completedReviewSubmission()
    if (kind === 'body') novel.chapters[0].content += '作者的新句子。'
    if (kind === 'context') novel.outline = '作者的新大纲。'
    if (kind === 'coverage') input.coverage.globalStatus = 'failed'
    if (kind === 'finding') input.review.findings[0].chapterId = novel.chapters[1].id
    if (kind === 'report') input.report = '服务器繁忙，请稍后重试。'
    const before = copy(await stored()), writes = writeCount
    await expect(workspace.commitChapterReview(novel.id, input)).rejects.toThrow()
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
    expect(novel.chapters[0].contentReview).toBe(before.novel!.chapters[0].contentReview)
  })

  it('freezes queued review submissions and cancels before committing', async () => {
    const input = await completedReviewSubmission(), frozen = copy(input), gate = holdWrite()
    const blocker = workspace.transactStory(novel.id, () => undefined)
    await gate.started
    const saving = workspace.commitChapterReview(novel.id, input)
    input.report = '调用方后来改写的报告'; input.review.findings[0].title = '调用方后来修改'
    gate.release(); await blocker; await saving
    expect(novel.chapters[0].contentReview).toBe(frozen.report)
    expect(workspace.getReviewFindings(novel.id)[0].title).toBe(frozen.review.findings[0].title)
    const controller = new AbortController(), before = copy(await stored()), writes = writeCount
    controller.abort(new Error('作者停止审核'))
    await expect(workspace.commitChapterReview(novel.id, frozen, controller.signal)).rejects.toThrow('作者停止审核')
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
  })

  it('atomically accepts an autonomous draft and its review while keeping story facts proposed', async () => {
    const { createAiRun } = await import('./reconstructionAiRun')
    const { buildReviewContextVersion, buildChapterReviewSignature, buildChapterReviewSourceVersion } = await import('./reconstructionReviewVersion')
    const { buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const chapter = novel.chapters[0], original = chapter.content, content = original + '林澈把线索记了下来。'
    const later = novel.chapters[1]
    novels.updateChapter(novel.id, later.id, { status: 'finalized', contentReviewSignature: 'old-later-review' })
    const contextVersion = buildReviewContextVersion(novel, { ...chapter, content, status: 'writing', summary: '', summarySource: undefined }, [], workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id))
    const proposed = { ...copy(candidate), id: 'draft-only-candidate', sourceVersionId: buildAnalysisSourceVersionId(content) }
    const draft = { id: 'isolated-draft', chapterId: chapter.id, chapterIndex: 0, baseContent: original, content, contextVersion,
      status: 'pending' as const, stage: 'analyzed' as const, report: '审核通过',
      reviewCoverage: { signature: buildChapterReviewSignature(content, contextVersion), status: 'complete' as const,
        globalStatus: 'not-needed' as const, totalChunks: 1, completedChunks: 1,
        coveredCharacters: content.length, totalCharacters: content.length },
      createdAt: now, updatedAt: now, history: [],
      review: { id: 'draft-only-review', chapterId: chapter.id, sourceVersionId: buildChapterReviewSourceVersion(content, contextVersion),
        startedAt: now, completedAt: now, deterministicChecksPassed: true, semanticChecksPassed: true, status: 'ready_to_finalize' as const, findings: [], candidateChanges: [proposed] } }
    const run = { ...createAiRun({ id: 'isolated-run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 1, tokenBudget: 10000, now }),
      status: 'completed' as const, chapterDrafts: [draft] }
    await workspace.saveAiRun(novel.id, run)
    expect(workspace.getCandidates(novel.id).some(row => row.id === proposed.id)).toBe(false)
    const before = copy(await stored())
    failWrite()
    await expect(workspace.decideAiDraft(novel.id, run.id, draft, 'accept')).rejects.toThrow('模拟磁盘事务失败')
    expect(await stored()).toEqual(before)
    expect(chapter.content).toBe(original)
    expect(workspace.getAiRun(novel.id, run.id)?.chapterDrafts?.[0].status).toBe('pending')
    await workspace.decideAiDraft(novel.id, run.id, draft, 'accept')
    expect(chapter.content).toBe(content)
    const after = await stored()
    expect(after.workspace.candidates.find(row => row.id === proposed.id)?.status).toBe('proposed')
    expect(after.workspace.chapterReviews?.find(row => row.id === draft.review.id)?.sourceVersionId).toBe(draft.review.sourceVersionId)
    expect(after.workspace.canonMutations).toEqual(before.workspace.canonMutations)
    expect(after.workspace.aiRuns?.find(row => row.id === run.id)?.chapterDrafts?.[0].status).toBe('accepted')
    expect(chapter.status).toBe('reviewed')
    expect(after.novel!.chapters.find(row => row.id === later.id)).toMatchObject({ status: 'writing', contentReviewSignature: '' })
    const impact = after.workspace.impactReports![after.workspace.impactReports!.length - 1]
    expect(impact).toMatchObject({ reviewPolicy: 'changed-inputs', changes: [{ target: { kind: 'chapter', id: chapter.id }, fields: ['content'] }] })
    expect(impact.reviewChapterIds).toContain(later.id)
    expect(impact.reviewChapterIds).not.toContain(chapter.id)
  })

  it.each(['missing', 'failed', 'wrong-source'] as const)('rejects an analyzed autonomous candidate with %s review coverage without publishing', async kind => {
    const { createAiRun } = await import('./reconstructionAiRun')
    const { buildReviewContextVersion, buildChapterReviewSignature, buildChapterReviewSourceVersion } = await import('./reconstructionReviewVersion')
    const chapter = novel.chapters[0], original = chapter.content, content = original + '林澈把线索记了下来。'
    const contextVersion = buildReviewContextVersion(novel, { ...chapter, content, status: 'writing', summary: '', summarySource: undefined }, [], workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id))
    const coverage: StoredReviewCoverage = { signature: buildChapterReviewSignature(content, contextVersion), status: 'complete',
      globalStatus: 'not-needed' as const, totalChunks: 1, completedChunks: 1,
      coveredCharacters: content.length, totalCharacters: content.length }
    const draft: any = { id: 'coverage-' + kind, chapterId: chapter.id, chapterIndex: 0, baseContent: original, content, contextVersion,
      status: 'pending', stage: 'analyzed', report: '审核通过', reviewCoverage: coverage,
      createdAt: now, updatedAt: now, history: [], review: { id: 'coverage-review-' + kind, chapterId: chapter.id,
        sourceVersionId: buildChapterReviewSourceVersion(content, contextVersion), startedAt: now, completedAt: now, deterministicChecksPassed: true,
        semanticChecksPassed: true, status: 'ready_to_finalize', findings: [], candidateChanges: [] } }
    const run = { ...createAiRun({ id: 'coverage-run-' + kind, mode: 'autonomous', taskType: 'draft', targetId: novel.id,
      chapterStart: 0, chapterEnd: 0, tokenBudget: 10000, now }), status: 'completed' as const, chapterDrafts: [draft] }
    await workspace.saveAiRun(novel.id, run)
    const liveDraft = workspace.getAiRun(novel.id, run.id)!.chapterDrafts![0]!
    liveDraft.reviewCoverage = kind === 'missing' ? undefined : { ...coverage, ...(kind === 'failed' ? { status: 'failed' as const } : { signature: 'review:wrong-source' }) }
    const before = copy(await stored())
    await expect(workspace.decideAiDraft(novel.id, run.id, copy(liveDraft), 'accept')).rejects.toThrow('审核或提取结果不属于当前正文')
    expect(novel.chapters[0].content).toBe(original)
    expect((await stored())).toEqual(before)
    expect(workspace.getAiRun(novel.id, run.id)?.chapterDrafts?.[0].status).toBe('pending')
  })

  it('saves manuscript memories, source and history together and reloads them', async () => {
    const { resolveStoryMemorySource, getStoryMemoryStatus } = await import('./storyMemory')
    const scope = { kind: 'book' as const, throughChapterId: novel.chapters[0].id }
    const input = { id: 'memory', title: '开篇回顾', scope, summary: '林澈得到钥匙。',
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null }
    const first = await workspace.saveStoryMemory(novel.id, input)
    expect(writeCount).toBe(1)
    expect(getStoryMemoryStatus(novel, first)).toBe('current')
    expect((await stored()).workspace.storyMemories).toEqual([first])
    const second = await workspace.saveStoryMemory(novel.id, { ...input, summary: '林澈取得钥匙后离开城门。', expectedRecord: JSON.stringify(first) })
    expect(second.history).toHaveLength(1)
    expect(second.history[0].summary).toBe(first.summary)
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getStoryMemories(novel.id)).toEqual([second])
    novels.updateChapter(novel.id, novel.chapters[0].id, { content: '正文已改写。' })
    expect(getStoryMemoryStatus(novel, second)).toBe('stale')
    expect(workspace.getStoryMemories(novel.id)[0].history).toHaveLength(1)
  })

  it('saves memory impact and invalidates only later eligible chapters without duplicating an unchanged confirmation', async () => {
    const { resolveStoryMemorySource } = await import('./storyMemory')
    const before = copy(await stored()), scope = { kind: 'book' as const, throughChapterId: novel.chapters[0].id }
    const input = { id: 'memory', title: '第一章回顾', scope, summary: '林澈取得了钥匙。',
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null }
    const record = await workspace.saveStoryMemory(novel.id, input)
    const saved = await stored()
    expect(saved.novel!.chapters[0]).toEqual(before.novel!.chapters[0])
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    expect(saved.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs',
      reviewChapterIds: novel.chapters.slice(1).map(chapter => chapter.id), changes: [{ target: { kind: 'memory', id: 'memory' } }] })
    expect(saved.novel!.chapters.slice(1).every(chapter => chapter.contentReviewSignature === '')).toBe(true)
    const writes = writeCount
    expect(await workspace.saveStoryMemory(novel.id, { ...input, expectedRecord: JSON.stringify(record) })).toEqual(record)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(saved)
  })

  it('does not invalidate earlier chapters for a memory whose source is still in their future', async () => {
    const { resolveStoryMemorySource } = await import('./storyMemory')
    const before = copy(await stored()), scope = { kind: 'book' as const, throughChapterId: novel.chapters[novel.chapters.length - 1].id }
    await workspace.saveStoryMemory(novel.id, { id: 'future-memory', title: '后文回顾', scope, summary: '三章之后才掌握的线索。',
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null })
    const saved = await stored()
    expect(saved.novel!.chapters).toEqual(before.novel!.chapters)
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    expect(saved.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs', reviewChapterIds: [] })
  })

  it('keeps the previous memory on disk failure and rejects an outdated editor baseline', async () => {
    const { resolveStoryMemorySource } = await import('./storyMemory')
    const scope = { kind: 'book' as const, throughChapterId: novel.chapters[0].id }
    const input = { id: 'memory', title: '回顾', scope, summary: '原回顾。',
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null }
    const first = await workspace.saveStoryMemory(novel.id, input)
    const update = { ...input, summary: '更新回顾。', expectedRecord: JSON.stringify(first) }
    const disk = copy(await stored())
    failWrite()
    await expect(workspace.saveStoryMemory(novel.id, update)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(disk)
    expect(workspace.getStoryMemories(novel.id)).toEqual([first])
    const updated = await workspace.saveStoryMemory(novel.id, update)
    await expect(workspace.saveStoryMemory(novel.id, update)).rejects.toThrow('已被修改')
    expect(workspace.getStoryMemories(novel.id)).toEqual([updated])
  })

  it('checks memory source again after an earlier save and preserves edits during commit', async () => {
    const { resolveStoryMemorySource, getStoryMemoryStatus } = await import('./storyMemory')
    const chapter = novel.chapters[0], scope = { kind: 'book' as const, throughChapterId: chapter.id }
    const input = { id: 'memory', title: '回顾', scope, summary: '钥匙回顾。',
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null }
    novels.updateTitle(novel.id, '排队前保存')
    const gate = holdWrite(), saving = novels.saveNovelNow(novel.id)
    await gate.started
    const confirmation = workspace.saveStoryMemory(novel.id, input)
    const rejected = expect(confirmation).rejects.toThrow('来源正文')
    novels.updateChapter(novel.id, chapter.id, { content: chapter.content + '新增事实。' })
    gate.release(); await saving; await rejected
    expect(workspace.getStoryMemories(novel.id)).toEqual([])
    const currentInput = { ...input, expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId }
    const secondGate = holdWrite(), secondSave = workspace.saveStoryMemory(novel.id, currentInput)
    await secondGate.started
    novels.updateChapter(novel.id, chapter.id, { content: chapter.content + '保存期间新写。' })
    secondGate.release(); await secondSave
    expect(chapter.content).toContain('保存期间新写。')
    expect(getStoryMemoryStatus(novel, workspace.getStoryMemories(novel.id)[0])).toBe('stale')
    await novels.flushPendingSaves()
    expect((await stored()).novel!.chapters[0].content).toBe(chapter.content)
  })

  it('keeps unopened manuscript memory when saving a different workspace collection', async () => {
    const { resolveStoryMemorySource } = await import('./storyMemory')
    const scope = { kind: 'book' as const, throughChapterId: novel.chapters[0].id }
    const record = await workspace.saveStoryMemory(novel.id, { id: 'memory', title: '回顾', scope, summary: '钥匙回顾。',
      expectedSourceVersionId: resolveStoryMemorySource(novel, scope).versionId, expectedRecord: null })
    workspace.clearNovel(novel.id)
    workspace.replaceAiRun(novel.id, { id: 'other-run', mode: 'assist', taskType: 'review', status: 'queued', createdAt: now, updatedAt: now })
    await workspace.persistToDatabase(novel.id)
    expect((await stored()).workspace.storyMemories).toEqual([record])
  })

  it('saves summary provenance and history atomically and reloads both from storage', async () => {
    const { getCurrentChapterSummary } = await import('./derivedSources')
    const chapter = novel.chapters[0], before = copy(chapter)
    const workspaceBefore = copy((await stored()).workspace)
    await novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '林澈带着钥匙离开城门。', 'ai')
    expect(writeCount).toBe(1)
    expect(novel.chapters[0]).toBe(chapter)
    expect(chapter.summarySource).toMatchObject({ chapterId: chapter.id, derivedValue: chapter.summary, origin: 'ai' })
    expect(getCurrentChapterSummary(chapter)).toBe(chapter.summary)
    const result = await stored()
    expect(result.novel?.chapters[0].summarySource).toEqual(chapter.summarySource)
    expect(result.workspace.chapterReviews).toEqual(workspaceBefore.chapterReviews)
    expect(result.workspace.canonMutations).toEqual(workspaceBefore.canonMutations)
    expect(result.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs',
      reviewChapterIds: novel.chapters.slice(1).map(item => item.id), changes: [{ target: { kind: 'chapter', id: chapter.id } }] })
    expect(chapter.status).toBe(before.status)
    const history = result.novel!.chapters[0].versions!.map(item => JSON.parse(item.snapshot))
    expect(history).toContainEqual(expect.objectContaining({ content: before.content, summary: before.summary }))
    const reloaded = (await (await import('./db/novels')).loadAllNovelsFromDb()).find(item => item.id === novel.id)!
    expect(getCurrentChapterSummary(reloaded.chapters[0])).toBe(chapter.summary)
    expect(reloaded.chapters[0].summarySource).toEqual(chapter.summarySource)
    const writes = writeCount
    await novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, chapter.summary, 'ai')
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(result)
  })

  it('retains old summary, binding and history on persistence failure, then permits retry and clear', async () => {
    const chapter = novel.chapters[0]
    await novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '核对过的总结。')
    const liveBefore = copy(novel), diskBefore = await stored()
    failWrite()
    await expect(novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '改写后的总结。')).rejects.toThrow('模拟磁盘')
    expect(copy(novel)).toEqual(liveBefore)
    expect(await stored()).toEqual(diskBefore)
    await novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '改写后的总结。')
    expect(chapter.summary).toBe('改写后的总结。')
    await novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '')
    expect(chapter.summary).toBe('')
    expect(chapter.summarySource).toBeUndefined()
    expect((await stored()).novel!.chapters[0].summarySource).toBeUndefined()
    expect(chapter.versions!.some(item => JSON.parse(item.snapshot).summarySource?.derivedValue === '核对过的总结。')).toBe(true)
  })

  it.each(['body', 'summary'] as const)('rejects a queued confirmation when the author changed its %s', async field => {
    const chapter = novel.chapters[0], baseline = copy(chapter)
    novels.updateTitle(novel.id, '先保存标题')
    const gate = holdWrite()
    const saving = novels.saveNovelNow(novel.id)
    await gate.started
    const confirming = novels.saveChapterSummary(novel.id, chapter.id, baseline.content, baseline.summary, '排队等待的总结。')
    const rejected = expect(confirming).rejects.toThrow('正文或总结已变化')
    novels.updateChapter(novel.id, chapter.id, field === 'body' ? { content: chapter.content + '作者新写。' } : { summary: '作者新的总结。' })
    gate.release()
    await saving
    await rejected
    await novels.flushPendingSaves()
    expect(chapter.summary).not.toBe('排队等待的总结。')
    expect((await stored()).novel!.chapters[0].summary).not.toBe('排队等待的总结。')
  })

  it('preserves prose typed during summary confirmation and leaves the saved summary stale', async () => {
    const { getChapterSummaryStatus, getCurrentChapterSummary } = await import('./derivedSources')
    const chapter = novel.chapters[0], content = chapter.content
    const gate = holdWrite()
    const confirming = novels.saveChapterSummary(novel.id, chapter.id, content, chapter.summary, '按旧正文核对的总结。')
    await gate.started
    novels.updateChapter(novel.id, chapter.id, { content: content + '作者改变了后续行动。' })
    const saving = novels.saveNovelNow(novel.id)
    gate.release()
    await Promise.all([confirming, saving])
    expect(chapter.content).toBe(content + '作者改变了后续行动。')
    expect(chapter.summary).toBe('按旧正文核对的总结。')
    expect(getCurrentChapterSummary(chapter)).toBe('')
    expect(getChapterSummaryStatus(chapter)).toBe('stale')
    expect(getChapterSummaryStatus((await stored()).novel!.chapters[0])).toBe('stale')
    expect(novels.hasPendingSaves).toBe(false)
  })

  it('keeps a newer author summary and its binding when an older summary is committing', async () => {
    const { getCurrentChapterSummary } = await import('./derivedSources')
    const chapter = novel.chapters[0]
    const gate = holdWrite()
    const confirming = novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '迟到的总结。', 'ai')
    await gate.started
    novels.updateChapter(novel.id, chapter.id, { summary: '作者当前核对的总结。' })
    const saving = novels.saveNovelNow(novel.id)
    gate.release()
    await Promise.all([confirming, saving])
    expect(getCurrentChapterSummary(chapter)).toBe('作者当前核对的总结。')
    expect(chapter.summarySource?.origin).toBe('author')
    expect(getCurrentChapterSummary((await stored()).novel!.chapters[0])).toBe(chapter.summary)
  })

  it('refuses summary confirmation on locked or empty chapters without a write', async () => {
    const chapter = novel.chapters[0]
    chapter.status = 'locked'
    await expect(novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '总结。')).rejects.toThrow('已锁定')
    chapter.status = 'draft'; chapter.content = ''
    await expect(novels.saveChapterSummary(novel.id, chapter.id, chapter.content, chapter.summary, '总结。')).rejects.toThrow('非空章节')
    expect(writeCount).toBe(0)
  })

  it('commits the event, author decision, review snapshot and Canon record in one durable write', async () => {
    const chapter = novel.chapters[0]
    await workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    expect(writeCount).toBe(1)
    expect(novels.novels[0]).toBe(novel)
    expect(novel.chapters[0]).toBe(chapter)
    const result = await stored()
    expect(result.novel?.eventLog).toHaveLength(1)
    expect(result.workspace.candidates[0].status).toBe('accepted')
    expect(result.workspace.chapterReviews![0].candidateChanges[0].status).toBe('accepted')
    expect(result.workspace.canonMutations[0].candidateId).toBe(candidate.id)
    expect(result.workspace.impactReports).toHaveLength(1)
    expect(result.workspace.impactReports![0].changes[0]).toMatchObject({ target: { kind: 'event' }, action: 'create' })
    expect(result.novel!.chapters[0].status).toBe('completed')
    expect(result.workspace.impactReports![0].reviewChapterIds).not.toContain(chapter.id)
    expect(result.workspace.impactReports![0].reviewChapterIds).toContain(novel.chapters[1].id)
    expect(result.novel!.eventLog[0].provenance!.revisions).toEqual(result.workspace.canonMutations[0].entityChanges)
    const { projectCanonicalEntities } = await import('./entityProvenance')
    expect(projectCanonicalEntities(result.novel!).events).toHaveLength(1)
    expect(projectCanonicalEntities(result.novel!, 0).events).toHaveLength(0)
    expect(projectCanonicalEntities(result.novel!).issues).toEqual([])
    await expect(workspace.rejectStoryCandidate(novel.id, candidate.id, now)).rejects.toThrow('已入库')
    expect(writeCount).toBe(1)
  })

  it('keeps completed source analysis after its own knowledge acceptance but requires a fresh review before finalizing', async () => {
    const { knowledgeCandidate } = await import('@/test/characterStateFixture')
    const { storyDecisionSourceVersion } = await import('./storyDecisions')
    const chapter = novel.chapters[0]
    const proposal = knowledgeCandidate(novel, 0, { fact: '林澈已经取得钥匙', state: 'knows', belief: '',
      learnedFrom: '亲手取得', evidence: '林澈拿到了钥匙。' })
    await workspace.transactStory(novel.id, aggregate => { aggregate.workspace.candidates.push(proposal) })
    await workspace.commitChapterReview(novel.id, await completedReviewSubmission())
    const before = await stored()
    const oldVersion = storyDecisionSourceVersion({ ...before, novel: before.novel! }, chapter.id, [])
    expect(chapter.status).toBe('completed')
    await workspace.acceptStoryCandidate(novel.id, proposal.id, now)
    const after = await stored(), currentVersion = storyDecisionSourceVersion({ ...after, novel: after.novel! }, chapter.id, [])
    // Prove this exercises a real context change, unlike the simple event fixture above.
    expect(currentVersion).not.toBe(oldVersion)
    expect(after.novel!.chapters[0].status).toBe('completed')
    expect(after.novel!.chapters[0].contentReviewSignature).toBe('')
    expect(after.novel!.chapters[0].contentReviewCoverage).toBeUndefined()
    await expect(workspace.finalizeChapter(novel.id, chapter.id, currentVersion, now)).rejects.toThrow('有效')
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    await workspace.commitChapterReview(novel.id, await completedReviewSubmission())
    await workspace.finalizeChapter(novel.id, chapter.id, currentVersion, now)
    expect((await stored()).novel!.chapters[0].status).toBe('finalized')
    expect(workspace.getCanonMutations(novel.id)).toHaveLength(1)
    await workspace.transactStory(novel.id, aggregate => { aggregate.novel.chapters[0].content += '作者改写了正文。' })
    expect((await stored()).novel!.chapters[0].status).toBe('writing')
  })

  it('creates definitions only after commit, rolls back failure and preserves captured input', async () => {
    const before = copy(await stored())
    failWrite()
    await expect(novels.addCharacter(novel.id, { name: '新来的客人' })).rejects.toThrow('模拟磁盘')
    expect(novel.characters.some(character => character.name === '新来的客人')).toBe(false)
    expect(await stored()).toEqual(before)
    const gate = holdWrite(), data = { name: '新来的客人', aliases: ['客人'] }
    const saving = novels.addCharacter(novel.id, data)
    await gate.started
    data.name = '调用后篡改'; data.aliases.push('不应保存')
    expect(novel.characters.some(character => character.name === '新来的客人')).toBe(false)
    novels.updateChapter(novel.id, novel.chapters[0].id, { content: novel.chapters[0].content + '作者继续写作。' })
    gate.release()
    const created = await saving
    expect(created).toMatchObject({ name: '新来的客人', aliases: ['客人'] })
    expect(novel.chapters[0].status).toBe('writing')
    expect(novel.chapters[0].contentReviewSignature).toBe('')
    expect(novel.chapters[0].content).toContain('作者继续写作。')
    await novels.flushPendingSaves()
    expect((await stored()).novel?.characters.find(character => character.id === created.id)).toEqual(copy(created))
    expect((await stored()).novel?.chapters[0].content).toBe(novel.chapters[0].content)
    expect((await stored()).workspace.candidates).toEqual(before.workspace.candidates)
  })

  it('rolls back the entire batch if a later definition fails validation', async () => {
    const before = copy(await stored())
    await expect(novels.commitEntityDefinitions(novel.id, [
      { action: 'create', kind: 'character', data: { name: '批次新角色' } },
      { action: 'create', kind: 'event', data: { title: '', description: '错误条目', type: '伏笔', chapterIndex: -1, characters: [] } },
    ])).rejects.toThrow()
    expect(novel.characters.some(character => character.name === '批次新角色')).toBe(false)
    expect(await stored()).toEqual(before)
  })

  it('keeps a failed deletion intact and rejects queued deletion of a newer definition', async () => {
    const character = await novels.addCharacter(novel.id, { name: '待删除的独立角色' })
    const before = copy(await stored())
    failWrite()
    await expect(novels.deleteCharacter(novel.id, character.id)).rejects.toThrow('模拟磁盘')
    expect(novel.characters.some(item => item.id === character.id)).toBe(true)
    expect(await stored()).toEqual(before)
    const gate = holdWrite()
    const editing = novels.updateCharacter(novel.id, character.id, { identity: '已确认的新身份' })
    await gate.started
    const deleting = expect(novels.deleteCharacter(novel.id, character.id)).rejects.toThrow('编辑期间发生变化')
    gate.release(); await editing; await deleting
    expect(character.identity).toBe('已确认的新身份')
    await novels.deleteCharacter(novel.id, character.id)
    expect((await stored()).novel?.characters.some(item => item.id === character.id)).toBe(false)
  })

  it('blocks deleting a current scene viewpoint and preserves its workspace', async () => {
    const draft = copy(workspace.getCreationDraft(novel.id)!)
    draft.scenePlans[0].viewpointCharacterId = novel.characters[0].id
    workspace.setCreationDraft(novel.id, draft)
    const before = copy(await stored())
    await expect(novels.deleteCharacter(novel.id, novel.characters[0].id)).rejects.toThrow('场景')
    expect(await stored()).toEqual(before)
    expect(workspace.getCreationDraft(novel.id)?.scenePlans[0].viewpointCharacterId).toBe(novel.characters[0].id)
  })

  it('persists event tracking fields, clears optional fields and keeps Canon history after deletion', async () => {
    await workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    const event = novel.eventLog.find(event => event.title === '取得钥匙')!
    const history = copy((await stored()).workspace.canonMutations)
    await novels.updateEvent(novel.id, event.id, { scope: 'global', hintCount: 2, lastProgressChapterIndex: 0, resolvedChapterIndex: 0 })
    await novels.updateEventStatus(novel.id, event.id, 'developing', 3)
    await novels.updateEvent(novel.id, event.id, { resolvedChapterIndex: undefined })
    expect((await stored()).novel?.eventLog.find(item => item.id === event.id)).toMatchObject({ scope: 'global', status: 'developing', hintCount: 3, lastProgressChapterIndex: 0 })
    expect((await stored()).novel?.eventLog.find(item => item.id === event.id)?.resolvedChapterIndex).toBeUndefined()
    failWrite()
    await expect(novels.deleteEvent(novel.id, event.id)).rejects.toThrow('模拟磁盘')
    expect(novel.eventLog.some(item => item.id === event.id)).toBe(true)
    await novels.deleteEvent(novel.id, event.id)
    const after = await stored()
    expect(after.novel?.eventLog.some(item => item.id === event.id)).toBe(false)
    expect(after.workspace.canonMutations).toEqual(history)
    expect(after.novel?.chapters[0]).toMatchObject({ status: 'writing', contentReviewSignature: '' })
  })

  it('persists an author definition and restores it after SQL or kernel reload', async () => {
    const { projectCanonicalEntities } = await import('./entityProvenance')
    const character = novel.characters[0]
    await novels.saveEntityDefinition(novel.id, 'character', character.id, JSON.stringify(character), { identity: '作者指定的调查员' })
    expect(writeCount).toBe(1)
    const reloaded = (await stored()).novel!
    expect(projectCanonicalEntities(reloaded, 0).characters[0].identity).toBe('作者指定的调查员')
    expect(projectCanonicalEntities(reloaded).issues).toEqual([])
    const revisions = reloaded.characters[0].provenance!.revisions
    expect(revisions[revisions.length - 1].source.kind).toBe('author')
    expect(novel.chapters[0].status).toBe('writing')
    expect(reloaded.chapters[0].status).toBe('writing')
    expect(reloaded.chapters[0].contentReviewSignature).toBe('')
  })

  it('rolls back a failed definition save and rejects a queued edit with an outdated baseline', async () => {
    const character = novel.characters[0], baseline = JSON.stringify(character), before = await stored()
    failWrite()
    await expect(novels.saveEntityDefinition(novel.id, 'character', character.id, baseline, { identity: '失败的修改' })).rejects.toThrow('模拟磁盘')
    expect(JSON.stringify(character)).toBe(baseline)
    expect(await stored()).toEqual(before)
    const gate = holdWrite()
    const first = novels.saveEntityDefinition(novel.id, 'character', character.id, baseline, { identity: '先确认的定义' })
    await gate.started
    const second = novels.saveEntityDefinition(novel.id, 'character', character.id, baseline, { identity: '过期表单' })
    const rejected = expect(second).rejects.toThrow('编辑期间发生变化')
    gate.release(); await first; await rejected
    expect(character.identity).toBe('先确认的定义')
    expect((await stored()).novel!.characters[0].identity).toBe(character.identity)
  })

  it('invalidates a derived entity when source prose changes during its commit, preserving the new prose', async () => {
    const { projectCanonicalEntities } = await import('./entityProvenance')
    const chapter = novel.chapters[0], gate = holdWrite()
    const applying = workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    await gate.started
    novels.updateChapter(novel.id, chapter.id, { content: chapter.content + '作者补充：钥匙其实是假的。' })
    gate.release(); await applying; await novels.flushPendingSaves()
    const result = (await stored()).novel!
    expect(result.chapters[0].content).toContain('钥匙其实是假的')
    expect(result.eventLog).toHaveLength(1)
    expect(projectCanonicalEntities(result).events).toHaveLength(0)
    expect(projectCanonicalEntities(result).issues.length).toBeGreaterThan(0)
  })

  it('commits a story proposal with provenance atomically and refuses changed body versions', async () => {
    const { normalizeStoryPromiseDrafts } = await import('./storyPlanning')
    const { projectCanonicalEntities } = await import('./entityProvenance')
    const chapter = novel.chapters[0]
    const draft = normalizeStoryPromiseDrafts(novel, chapter, [{ title: '钥匙的来历', description: '以后解释钥匙', evidence: '林澈拿到了钥匙。' }])[0]
    const proposal = novels.addStoryStateProposal(novel.id, draft)!
    await novels.flushPendingSaves()
    const before = await stored()
    failWrite()
    await expect(novels.applyStoryStateProposal(novel.id, proposal.id)).rejects.toThrow('模拟磁盘')
    expect(proposal.status).toBe('pending')
    expect(novel.eventLog).toEqual([])
    expect(await stored()).toEqual(before)
    expect(await novels.applyStoryStateProposal(novel.id, proposal.id)).toBe(true)
    expect(projectCanonicalEntities((await stored()).novel!).events[0].title).toBe('钥匙的来历')
    expect(workspace.getImpactReports(novel.id)).toHaveLength(1)
    expect(workspace.getImpactReports(novel.id)[0].changes[0]).toMatchObject({ target: { kind: 'event' }, action: 'create', fields: ['$exists'] })
    const stale = novels.addStoryStateProposal(novel.id, { ...draft, targetId: 'new', eventDraft: { ...draft.eventDraft!, title: '另一把钥匙' } })!
    novels.updateChapter(novel.id, chapter.id, { content: chapter.content + '后来钥匙丢了。' })
    expect(await novels.applyStoryStateProposal(novel.id, stale.id)).toBe(false)
    expect(stale.status).toBe('pending')
    expect(novel.eventLog).toHaveLength(1)
    expect(workspace.getImpactReports(novel.id)).toHaveLength(1)
  })

  it('publishes no partial Canon or decision on disk failure and allows a complete retry', async () => {
    const before = await stored()
    failWrite()
    await expect(workspace.acceptStoryCandidate(novel.id, candidate.id, now)).rejects.toThrow('模拟磁盘')
    expect(novel.eventLog).toEqual([])
    expect(workspace.getCandidates(novel.id)[0].status).toBe('proposed')
    expect(workspace.getCanonMutations(novel.id)).toEqual([])
    expect(await stored()).toEqual(before)
    await workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    expect((await stored()).novel?.eventLog).toHaveLength(1)
    expect(novels.saveError).toBe('')
  })

  it('serializes duplicate timeline acceptance with ordinary saves without advancing time twice', async () => {
    workspace.replaceCandidates(novel.id, [{ ...candidate, type: 'timeline', proposedValue: JSON.stringify({ elapsedDays: 2 }) }])
    const before = novel.storyClock?.currentDay || 0
    await Promise.all([workspace.acceptStoryCandidate(novel.id, candidate.id, now), workspace.persistToDatabase(novel.id),
      workspace.acceptStoryCandidate(novel.id, candidate.id, now), novels.saveNovelNow(novel.id)])
    const result = await stored()
    expect(result.novel?.storyClock?.currentDay).toBe(before + 2)
    expect(result.workspace.canonMutations).toHaveLength(1)
  })

  it('retains author prose and workspace edits arriving during a commit and drains queued saves', async () => {
    const gate = holdWrite()
    const accepting = workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    await gate.started
    novels.updateChapter(novel.id, novel.chapters[1].id, { content: '等待落盘时继续写作。' })
    workspace.updateCreationDraft(novel.id, { contract: { ...workspace.getCreationDraft(novel.id)!.contract, title: '新增作者标题' } })
    const saving = novels.saveNovelNow(novel.id)
    const workspaceSaving = workspace.persistToDatabase(novel.id)
    const closing = novels.flushPendingSaves()
    expect(novel.eventLog).toEqual([])
    expect(workspace.getCandidates(novel.id)[0].status).toBe('proposed')
    gate.release()
    await Promise.all([accepting, saving, workspaceSaving, closing])
    const result = await stored()
    expect(result.novel?.chapters[1].content).toBe('等待落盘时继续写作。')
    expect(result.novel?.eventLog).toHaveLength(1)
    expect(result.workspace.canonMutations).toHaveLength(1)
    expect(result.workspace.creationDraft?.contract.title).toBe('新增作者标题')
    expect(novels.hasPendingSaves).toBe(false)
  })

  it('preserves unloaded creation and run collections when accepting a loaded candidate', async () => {
    const before = await stored()
    workspace.clearNovel(novel.id)
    workspace.addCandidateChanges(novel.id, [candidate])
    await workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    const result = await stored()
    expect(result.workspace.creationDraft).toEqual(before.workspace.creationDraft)
    expect(result.workspace.aiRuns).toEqual(before.workspace.aiRuns)
  })

  it('runs a decision after an older autosave without overwriting the latest author revision', async () => {
    novels.updateTitle(novel.id, '较早的标题')
    const gate = holdWrite()
    const firstSave = novels.saveNovelNow(novel.id)
    await gate.started
    const acceptance = workspace.acceptStoryCandidate(novel.id, candidate.id, now)
    novels.updateTitle(novel.id, '最终作者标题')
    const flushing = novels.flushPendingSaves()
    gate.release()
    await Promise.all([firstSave, acceptance, flushing])
    const result = await stored()
    expect(result.novel?.title).toBe('最终作者标题')
    expect(result.novel?.eventLog).toHaveLength(1)
    expect(result.workspace.candidates[0].status).toBe('accepted')
    expect(novels.hasPendingSaves).toBe(false)
  })

  it('rejects changes to the stored aggregate since preparation instead of overwriting them', async () => {
    const expected = await repository.readStoryAggregate(novel.id)
    const staged = copy(expected) as import('./storyAggregate').StoryAggregate
    staged.novel.title = '过期标题'
    const other = copy(expected.workspace)
    other.candidates[0].authorNote = '另一个操作已更新'
    await (await import('./db/reconstruction')).saveReconstructionWorkspace(novel.id, other)
    await expect(repository.saveStoryAggregate(staged, expected)).rejects.toMatchObject({ code: 'PROJECT_CONFLICT' })
    const result = await stored()
    expect(result.novel?.title).not.toBe('过期标题')
    expect(result.workspace.candidates[0].authorNote).toBe('另一个操作已更新')
  })

  it('rolls back failed rejection and finding decisions before publishing them to the author', async () => {
    failWrite()
    await expect(workspace.rejectStoryCandidate(novel.id, candidate.id, now)).rejects.toThrow('模拟磁盘')
    expect(workspace.getCandidates(novel.id)[0].status).toBe('proposed')
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    const finding = { id: 'finding', type: 'continuity' as const, severity: 'blocker' as const, title: '需要核对', explanation: '时间不符',
      chapterId: novel.chapters[0].id, sourceVersionId: candidate.sourceVersionId, evidence: [], blocksFinalization: true, status: 'open' as const }
    workspace.replaceChapterFindings(novel.id, finding.chapterId, [finding])
    await workspace.persistToDatabase(novel.id)
    failWrite()
    await expect(workspace.resolveStoryReviewFinding(novel.id, finding.id, 'intentional', now)).rejects.toThrow('模拟磁盘')
    expect(workspace.getReviewFindings(novel.id)[0].status).toBe('open')
    expect((await stored()).workspace.reviewFindings[0].status).toBe('open')
    await workspace.resolveStoryReviewFinding(novel.id, finding.id, 'intentional', now)
    expect((await stored()).workspace.reviewFindings[0].status).toBe('intentional')
  })

  it('commits an edited candidate with original proposal and note, or rolls back everything on disk failure', async () => {
    const editedValue = JSON.stringify({ title: '作者核对：取得钥匙', description: '尚未使用', eventType: '主线', characters: ['林澈'] })
    const options = { expectedRecord: copy(candidate), expectedSourceVersionId: version, authorNote: '保留未使用的状态' }
    const before = await stored()
    failWrite()
    await expect(workspace.acceptStoryCandidate(novel.id, candidate.id, now, editedValue, options)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    expect(workspace.getCandidates(novel.id)[0]).toEqual(candidate)
    await workspace.acceptStoryCandidate(novel.id, candidate.id, now, editedValue, options)
    const result = await stored()
    expect(result.workspace.candidates[0]).toMatchObject({ status: 'edited', proposedValue: editedValue,
      originalProposedValue: candidate.proposedValue, authorNote: options.authorNote, evidence: candidate.evidence })
    expect(result.novel?.eventLog?.[0].title).toBe('作者核对：取得钥匙')
    expect(result.workspace.canonMutations).toHaveLength(1)
    await workspace.acceptStoryCandidate(novel.id, candidate.id, now, editedValue, options)
    await expect(workspace.acceptStoryCandidate(novel.id, candidate.id, now, candidate.proposedValue, options)).rejects.toThrow('其他内容')
    await expect(workspace.acceptStoryCandidate(novel.id, candidate.id, now, editedValue, { ...options, authorNote: '另一份表单说明' })).rejects.toThrow('作者说明')
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCandidates(novel.id)[0].originalProposedValue).toBe(candidate.proposedValue)
  })

  it('keeps deferred candidates durable and blocks finalization until an author decision', async () => {
    const options = { expectedRecord: copy(candidate), expectedSourceVersionId: version, authorNote: '下一章核对钥匙用途' }
    failWrite()
    await expect(workspace.deferStoryCandidate(novel.id, candidate.id, now, options)).rejects.toThrow('模拟磁盘')
    expect(workspace.getCandidates(novel.id)[0].status).toBe('proposed')
    await workspace.deferStoryCandidate(novel.id, candidate.id, now, options)
    expect((await stored()).workspace.candidates[0]).toMatchObject({ status: 'deferred', authorNote: options.authorNote })
    expect((await stored()).workspace.canonMutations).toHaveLength(0)
    workspace.clearNovel(novel.id)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getPendingCandidates(novel.id)[0].status).toBe('deferred')
    await expect(workspace.finalizeChapter(novel.id, novel.chapters[0].id, version, now)).rejects.toThrow('候选待处理')
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    expect((await stored()).workspace.candidates[0].status).toBe('rejected')
  })

  it('retains a deferred blocking finding and its note until the author resolves it', async () => {
    const finding = { id: 'finding-defer', type: 'continuity' as const, severity: 'blocker' as const, title: '核对钥匙', explanation: '待核对用途',
      chapterId: novel.chapters[0].id, sourceVersionId: candidate.sourceVersionId, evidence: candidate.evidence, blocksFinalization: true, status: 'open' as const }
    workspace.replaceChapterFindings(novel.id, finding.chapterId, [finding])
    await workspace.persistToDatabase(novel.id)
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    const options = { expectedRecord: copy(finding), expectedSourceVersionId: version, authorNote: '等待后文说明' }
    failWrite()
    await expect(workspace.resolveStoryReviewFinding(novel.id, finding.id, 'deferred', now, options)).rejects.toThrow('模拟磁盘')
    expect(workspace.getReviewFindings(novel.id)[0].status).toBe('open')
    await workspace.resolveStoryReviewFinding(novel.id, finding.id, 'deferred', now, options)
    const result = await stored()
    expect(result.workspace.reviewFindings[0]).toMatchObject({ status: 'deferred', authorNote: '等待后文说明' })
    expect(result.workspace.chapterReviews![0].status).toBe('needs_revision')
    await expect(workspace.finalizeChapter(novel.id, finding.chapterId, version, now)).rejects.toThrow('阻塞问题')
    await workspace.resolveStoryReviewFinding(novel.id, finding.id, 'intentional', now,
      { ...options, expectedRecord: copy(workspace.getReviewFindings(novel.id)[0]), authorNote: '角色故意隐瞒，保留悬念' })
    expect((await stored()).workspace.reviewFindings[0]).toMatchObject({ status: 'intentional', authorNote: '角色故意隐瞒，保留悬念' })
    expect((await stored()).workspace.chapterReviews![0].status).toBe('ready_to_finalize')
  })

  it.each(['record', 'body', 'context', 'locked'] as const)('rejects an opened candidate decision after %s changes', async change => {
    const options = { expectedRecord: copy(candidate), expectedSourceVersionId: version, authorNote: '旧表单' }
    if (change === 'record') workspace.updateCandidate(novel.id, { ...candidate, proposedValue: '{"title":"重新分析的提案"}' })
    if (change === 'body') novels.updateChapter(novel.id, novel.chapters[0].id, { content: novel.chapters[0].content + '新正文' })
    if (change === 'context') novel.outline += '新的设定依据'
    if (change === 'locked') novel.chapters[0].status = 'locked'
    const before = await stored()
    await expect(workspace.acceptStoryCandidate(novel.id, candidate.id, now, '{"title":"旧表单确认"}', options)).rejects.toThrow()
    await expect(workspace.deferStoryCandidate(novel.id, candidate.id, now, options)).rejects.toThrow()
    await expect(workspace.rejectStoryCandidate(novel.id, candidate.id, now, options)).rejects.toThrow()
    expect(await stored()).toEqual(before)
    expect(workspace.getCanonMutations(novel.id)).toHaveLength(0)
  })

  it('captures a candidate before queueing and never overwrites a newer pending author note', async () => {
    const pending = workspace.deferStoryCandidate(novel.id, candidate.id, now)
    workspace.updateCandidate(novel.id, { ...candidate, authorNote: '较新的作者记录' })
    await expect(pending).rejects.toThrow('已经变化')
    expect(workspace.getCandidates(novel.id)[0].authorNote).toBe('较新的作者记录')
    expect((await stored()).workspace.candidates[0].status).toBe('proposed')
  })

  it.each(['record', 'body', 'missing-version', 'locked'] as const)('refuses a finding decision with %s instead of making it resolved', async change => {
    const finding = { id: 'finding-stale', type: 'timeline' as const, severity: 'blocker' as const, title: '核对', explanation: '核对日期',
      chapterId: novel.chapters[0].id, sourceVersionId: change === 'missing-version' ? undefined : candidate.sourceVersionId,
      evidence: [], blocksFinalization: true, status: 'open' as const }
    workspace.replaceChapterFindings(novel.id, finding.chapterId, [finding])
    await workspace.persistToDatabase(novel.id)
    const options = { expectedRecord: copy(finding), expectedSourceVersionId: version }
    if (change === 'record') workspace.replaceChapterFindings(novel.id, finding.chapterId, [{ ...finding, explanation: '重新审核后的说明' }])
    if (change === 'body') novels.updateChapter(novel.id, finding.chapterId, { content: novel.chapters[0].content + '新正文' })
    if (change === 'locked') novel.chapters[0].status = 'locked'
    await expect(workspace.resolveStoryReviewFinding(novel.id, finding.id, 'intentional', now, options)).rejects.toThrow()
    expect((await stored()).workspace.reviewFindings[0].status).toBe('open')
  })

  it('finalizes the chapter, review and approved plans atomically, with rollback and retry', async () => {
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    const before = await stored()
    const chapter = novel.chapters[0]
    failWrite()
    await expect(workspace.finalizeChapter(novel.id, chapter.id, version, now)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    expect(chapter.status).toBe('completed')
    expect(workspace.getChapterReviews(novel.id)[0].status).toBe('ready_to_finalize')
    writeCount = 0
    await workspace.finalizeChapter(novel.id, chapter.id, version, now)
    expect(writeCount).toBe(1)
    expect(chapter.status).toBe('finalized')
    const result = await stored()
    expect(result.novel?.chapters[0].status).toBe('finalized')
    expect(result.novel?.chapterPlans?.[0].status).toBe('completed')
    expect(result.workspace.chapterReviews![0].status).toBe('approved')
    expect(result.workspace.creationDraft?.chapterPlans[0].status).toBe('completed')
    expect(result.workspace.creationDraft?.scenePlans[0].status).toBe('completed')
    expect(result.workspace.impactReports).toHaveLength(1)
    expect(result.workspace.impactReports![0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: expect.objectContaining({ kind: 'plan' }), action: 'confirm' }),
      expect.objectContaining({ target: expect.objectContaining({ kind: 'scene' }), action: 'confirm' }),
      expect.objectContaining({ target: expect.objectContaining({ kind: 'plan' }), action: 'create' }),
    ]))
  })

  it('keeps newly edited prose unfinalized when the author writes while finalization is committing', async () => {
    await workspace.rejectStoryCandidate(novel.id, candidate.id, now)
    const gate = holdWrite()
    const chapter = novel.chapters[0]
    const finalizing = workspace.finalizeChapter(novel.id, chapter.id, version, now)
    await gate.started
    novels.updateChapter(novel.id, chapter.id, { content: chapter.content + '作者的新段落。' })
    const saving = novels.saveNovelNow(novel.id)
    gate.release()
    await Promise.all([finalizing, saving])
    expect(chapter.status).toBe('writing')
    expect(chapter.content).toContain('作者的新段落。')
    const result = await stored()
    expect(result.novel?.chapters[0].status).toBe('writing')
    expect(result.novel?.chapters[0].content).toContain('作者的新段落。')
    await expect(workspace.finalizeChapter(novel.id, chapter.id, version, now)).rejects.toThrow('已经变化')
  })

  it.each(['deferred', 'missing-canon', 'semantic', 'blocking', 'stale-review', 'stale-request', 'length'] as const)(
    'refuses finalization for %s without changing durable or live state', async reason => {
      const { finalizeStoryChapter } = await import('./storyDecisions')
      const { buildChapterReviewSourceVersion, buildReviewContextVersion } = await import('./reconstructionReviewVersion')
      const aggregate = copy(await stored()) as import('./storyAggregate').StoryAggregate
      aggregate.workspace.candidates[0].status = 'rejected'
      const chapter = aggregate.novel.chapters[0], review = aggregate.workspace.chapterReviews![0]
      if (reason === 'deferred') aggregate.workspace.candidates[0].status = 'deferred'
      if (reason === 'missing-canon') aggregate.workspace.candidates[0].status = 'accepted'
      if (reason === 'semantic') review.semanticChecksPassed = false
      if (reason === 'blocking') review.findings = [{ id: 'blocker', type: 'timeline', severity: 'blocker', title: '时间矛盾',
        explanation: '本章日期错误', chapterId: chapter.id, evidence: [], blocksFinalization: true, status: 'open' }]
      if (reason === 'length') {
        chapter.content = '短文。'
        review.sourceVersionId = buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(aggregate.novel, chapter, [], aggregate.workspace.creationDraft))
      }
      const expected = reason === 'stale-request' ? 'outdated' : review.sourceVersionId
      if (reason === 'stale-review') review.sourceVersionId = 'outdated'
      const before = copy(aggregate)
      expect(() => finalizeStoryChapter(aggregate, chapter.id, expected, now)).toThrow()
      expect(aggregate).toEqual(before)
      expect(writeCount).toBe(0)
    })

  it.each(['unconfirmed-story', 'changed-source'] as const)('does not complete plans with %s', async reason => {
    const { finalizeStoryChapter } = await import('./storyDecisions')
    const { buildChapterReviewSourceVersion, buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const aggregate = copy(await stored()) as import('./storyAggregate').StoryAggregate
    aggregate.workspace.candidates[0].status = 'rejected'
    const draft = aggregate.workspace.creationDraft!, chapter = aggregate.novel.chapters[0]
    if (reason === 'unconfirmed-story') draft.contract.approval = 'draft'
    else aggregate.novel.chapterPlans![0].summary = '修改后的计划，需要重新确认'
    const currentVersion = buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(aggregate.novel, chapter, [], draft))
    aggregate.workspace.chapterReviews![0].sourceVersionId = currentVersion
    finalizeStoryChapter(aggregate, chapter.id, currentVersion, now)
    expect(chapter.status).toBe('finalized')
    expect(draft.chapterPlans[0].status).not.toBe('completed')
    expect(draft.scenePlans[0].status).not.toBe('completed')
  })

  it('applies an allowed awaiting-review plan proposal after its scan is committed', async () => {
    const { captureStoryStateScanBaseline, normalizeStoryStateProposalDrafts } = await import('./storyPlanning')
    const chapter = novel.chapters[0]
    novel.chapterPlans![0].status = 'planned'
    const proposals = normalizeStoryStateProposalDrafts(novel, chapter, [{ targetType: 'chapter_plan', targetId: 'plan-1',
      field: 'status', newValue: 'awaiting_review', evidence: '林澈拿到了钥匙。' }])
    expect(proposals).toHaveLength(1)
    expect(await workspace.saveStoryStateScan(novel.id, { chapterId: chapter.id,
      baseline: captureStoryStateScanBaseline(novel, chapter), proposals })).toBe(1)
    expect(await novels.applyStoryStateProposal(novel.id, novel.storyStateProposals![0].id)).toBe(true)
    expect((await stored()).novel!.chapterPlans![0].status).toBe('awaiting_review')
  })

  it.each(['event', 'chapter_plan'] as const)('does not apply a previously saved AI proposal outside the current allowlist (%s)', async targetType => {
    const { bindStoryProposalSource } = await import('./storyProposalSource')
    const chapter = novel.chapters[0], evidence = '林澈拿到了钥匙。'
    novel.chapterPlans![0].status = 'archived'
    novel.eventLog = [{ id: 'closed-event', chapterIndex: 0, title: '已解决事件', description: '', type: '主线',
      characters: [], source: 'user', status: 'resolved', timestamp: now }]
    const proposal = novels.addStoryStateProposal(novel.id, { targetType, targetId: targetType === 'event' ? 'closed-event' : 'plan-1',
      targetTitle: '已关闭目标', field: 'status', oldValue: targetType === 'event' ? 'resolved' : 'archived',
      newValue: targetType === 'event' ? 'developing' : 'active', reason: '旧扫描返回了范围外目标', evidence,
      chapterSource: bindStoryProposalSource(chapter, evidence), chapterIndex: chapter.chapterIndex, source: 'ai' })!
    await novels.flushPendingSaves()
    const before = await stored(), writes = writeCount
    expect(await novels.applyStoryStateProposal(novel.id, proposal.id)).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
    expect(proposal.status).toBe('pending')
  })

  async function stateScanSubmission() {
    const { captureStoryStateScanBaseline, normalizeStoryPromiseDrafts } = await import('./storyPlanning')
    const { novel: source } = await workspace.prepareChapterAnalysis(novel.id), chapter = source.chapters[0]
    return { chapterId: chapter.id, baseline: captureStoryStateScanBaseline(source, chapter),
      proposals: normalizeStoryPromiseDrafts(source, chapter, [
        { title: '钥匙来历', description: '以后解释钥匙的来历', evidence: '林澈拿到了钥匙。' },
        { title: '城门之谜', description: '以后说明离城的原因', evidence: '他离开城门。' },
      ]) }
  }

  it('commits a whole state-scan batch only after persistence and preserves author rejections on retries', async () => {
    const input = await stateScanSubmission(), before = copy(await stored()), live = copy(novel)
    expect(input.proposals).toHaveLength(2)
    failWrite()
    await expect(workspace.saveStoryStateScan(novel.id, input)).rejects.toThrow('模拟磁盘')
    expect(copy(novel)).toEqual(live); expect(await stored()).toEqual(before)
    const gate = holdWrite(), saving = workspace.saveStoryStateScan(novel.id, input)
    await gate.started; expect(novel.storyStateProposals || []).toHaveLength(0)
    gate.release(); expect(await saving).toBe(2)
    const saved = await stored(), proposal = novel.storyStateProposals![0]
    const { editorDrafts: _savedDrafts, ...savedWorkspace } = saved.workspace
    const { editorDrafts: _beforeDrafts, ...beforeWorkspace } = before.workspace
    expect({ ...savedWorkspace, impactReports: saved.workspace.impactReports || [], storyMemories: saved.workspace.storyMemories || [] }).toEqual({ ...beforeWorkspace,
      impactReports: before.workspace.impactReports || [], storyMemories: before.workspace.storyMemories || [] })
    expect(novel.eventLog).toEqual(before.novel!.eventLog)
    failWrite()
    await expect(novels.rejectStoryStateProposal(novel.id, proposal.id)).rejects.toThrow('模拟磁盘')
    expect(proposal.status).toBe('pending'); expect(await stored()).toEqual(saved)
    expect(await novels.rejectStoryStateProposal(novel.id, proposal.id)).toBe(true)
    const rejected = await stored(), writes = writeCount
    expect(await workspace.saveStoryStateScan(novel.id, input)).toBe(0)
    expect(await novels.rejectStoryStateProposal(novel.id, proposal.id)).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(rejected)
    expect(novel.storyStateProposals!.find(item => item.id === proposal.id)!.status).toBe('rejected')
    const reloaded = (await (await import('./db/novels')).loadAllNovelsFromDb()).find(item => item.id === novel.id)!
    expect(reloaded.storyStateProposals).toEqual(rejected.novel!.storyStateProposals)
  })

  it.each(['body', 'plan', 'source', 'payload'] as const)('refuses a stale or invalid state-scan batch (%s) without partial records', async change => {
    const input = await stateScanSubmission(), before = copy(await stored())
    if (change === 'body') novel.chapters[0].content = novel.chapters[0].content.replace('钥匙', '书信')
    if (change === 'plan') novel.chapterPlans![0].objective = '作者调整后的规划目标'
    if (change === 'source') input.proposals[1].chapterSource!.chapterId = 'another-chapter'
    if (change === 'payload') input.proposals[1].newValue = 'resolved'
    await expect(workspace.saveStoryStateScan(novel.id, input)).rejects.toThrow()
    expect(writeCount).toBe(0); expect(await stored()).toEqual(before)
    expect(novel.storyStateProposals || []).toHaveLength(0)
  })

  it('checks cancellation again when a state-scan batch reaches the commit queue', async () => {
    const input = await stateScanSubmission(), gate = holdWrite(), controller = new AbortController()
    const prior = workspace.transactStory(novel.id, aggregate => { aggregate.workspace.aiRuns![0].updatedAt = now })
    await gate.started
    const saving = workspace.saveStoryStateScan(novel.id, input, controller.signal)
    const rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); gate.release(); await prior; await rejected
    expect(writeCount).toBe(1); expect((await stored()).novel!.storyStateProposals || []).toHaveLength(0)
  })

  async function analysisSubmission() {
    const { captureChapterAnalysisBaseline } = await import('./chapterAnalysisTransactions')
    const { buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const { buildDataMemoryProposals } = await import('./dataPanelExtraction')
    const source = await workspace.prepareChapterAnalysis(novel.id), chapter = source.novel.chapters[0]
    return { chapterId: chapter.id, sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
      baseline: captureChapterAnalysisBaseline(source.novel, chapter, source.canonMutations),
      candidates: [{ ...copy(candidate), id: 'analysis-new-candidate' }],
      dataProposals: buildDataMemoryProposals(source.novel, chapter.chapterIndex, chapter.content, {
        newItems: [{ name: '钥匙', category: '道具', confidence: 'clear', reason: '林澈拿到了钥匙。', fields: [] }],
      }) }
  }

  it('saves story candidates and data proposals in one commit without premature publication or duplicate retries', async () => {
    const input = await analysisSubmission(), before = copy(await stored()), live = copy(novel)
    failWrite()
    await expect(workspace.saveChapterAnalysis(novel.id, input)).rejects.toThrow('模拟磁盘')
    expect(copy(novel)).toEqual(live); expect(await stored()).toEqual(before)
    expect(workspace.getCandidates(novel.id)).toEqual(before.workspace.candidates)
    const gate = holdWrite(), saving = workspace.saveChapterAnalysis(novel.id, input)
    await gate.started
    expect(copy(novel)).toEqual(live); expect(workspace.getCandidates(novel.id)).toEqual(before.workspace.candidates)
    gate.release(); expect(await saving).toMatchObject({ changed: true, candidates: 1, dataChanges: 1 })
    const saved = await stored(), writes = writeCount
    expect(saved.novel!.dataPanelChanges).toHaveLength(1); expect(saved.novel!.dataPanels).toEqual(before.novel!.dataPanels)
    expect(saved.novel!.eventLog).toEqual(before.novel!.eventLog)
    expect(saved.workspace.canonMutations).toEqual(before.workspace.canonMutations)
    expect(saved.workspace.candidates).toHaveLength(before.workspace.candidates.length + 1)
    expect((await workspace.saveChapterAnalysis(novel.id, input)).changed).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(saved)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCandidates(novel.id).some(item => item.id === 'analysis-new-candidate')).toBe(true)
  })

  it.each(['body', 'reference', 'data-evidence', 'candidate-evidence'] as const)('refuses an invalid analysis batch (%s) without saving either collection', async change => {
    const input = await analysisSubmission(), before = copy(await stored())
    if (change === 'body') novel.chapters[0].content = novel.chapters[0].content.replace('钥匙', '书信')
    if (change === 'reference') novel.settings.protagonist.name = '新的主人公'
    if (change === 'data-evidence') input.dataProposals[0].reason = '并未出现在正文的句子'
    if (change === 'candidate-evidence') input.candidates[0].evidence[0].quote = '并未出现在正文的句子'
    await expect(workspace.saveChapterAnalysis(novel.id, input)).rejects.toThrow()
    expect(writeCount).toBe(0); expect(await stored()).toEqual(before)
    expect(workspace.getCandidates(novel.id)).toEqual(before.workspace.candidates)
  })

  it('honors cancellation while an analysis save waits in the workspace queue', async () => {
    const input = await analysisSubmission(), gate = holdWrite(), controller = new AbortController()
    const prior = workspace.transactStory(novel.id, aggregate => { aggregate.workspace.aiRuns![0].updatedAt = now })
    await gate.started
    const saving = workspace.saveChapterAnalysis(novel.id, input, controller.signal)
    const rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); gate.release(); await prior; await rejected
    expect(writeCount).toBe(1)
    expect((await stored()).workspace.candidates.some(item => item.id === 'analysis-new-candidate')).toBe(false)
  })

  async function suggestionInput(action: 'plan' | 'note') {
    const { writingAdviceSourceVersion } = await import('./writingAdviceSource')
    const chapter = novel.chapters[0]
    return { action, chapterId: chapter.id, sourceVersion: writingAdviceSourceVersion(novel, chapter, chapter.content,
      workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id), workspace.getStoryMemories(novel.id)),
      suggestion: { id: 'direction', kind: 'scene' as const, title: '追查来信', approach: '找到送信人核对来源。', storyEffect: '建立下一章目标',
        nextBeat: '到城门询问守卫。', risk: '保持线索来源明确', evidence: [] } }
  }

  it.each(['plan', 'note'] as const)('commits a writing suggestion as %s with impact and rollback, and does not duplicate retries', async action => {
    const input = await suggestionInput(action), before = copy(await stored()), live = copy(novel)
    failWrite()
    await expect(workspace.commitWritingSuggestion(novel.id, input)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before); expect(copy(novel)).toEqual(live)
    const gate = holdWrite(), saving = workspace.commitWritingSuggestion(novel.id, input)
    await gate.started; expect(copy(novel)).toEqual(live)
    gate.release(); const result = await saving
    expect(result.changed).toBe(true)
    const saved = await stored()
    expect(saved.novel!.chapters.map(item => item.content)).toEqual(before.novel!.chapters.map(item => item.content))
    expect(saved.workspace.canonMutations).toEqual(before.workspace.canonMutations)
    if (action === 'plan') expect(saved.novel!.chapterPlans!.find(item => item.id === result.id)).toMatchObject({ title: '追查来信', targetChapterStart: 1 })
    else {
      expect(saved.novel!.chapters[0].sceneNotes!.find(item => item.id === result.id)?.content).toContain(String.fromCharCode(10) + '下一拍：')
      expect(saved.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs', reviewChapterIds: [novel.chapters[0].id] })
    }
    const writes = writeCount
    expect((await workspace.commitWritingSuggestion(novel.id, input)).changed).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(saved)
  })

  it.each(['plan', 'note'] as const)('rejects a writing %s from stale inputs and preserves an edited previous adoption', async action => {
    const input = await suggestionInput(action), original = novel.chapters[0].content
    novel.chapters[0].content = original.replace('钥匙', '书信')
    await expect(workspace.commitWritingSuggestion(novel.id, input)).rejects.toThrow('正文或资料已变化')
    expect(writeCount).toBe(0)
    novel.chapters[0].content = original
    const result = await workspace.commitWritingSuggestion(novel.id, input)
    await workspace.transactStory(novel.id, aggregate => {
      const item = action === 'plan' ? aggregate.novel.chapterPlans!.find(plan => plan.id === result.id)!
        : aggregate.novel.chapters[0].sceneNotes!.find(note => note.id === result.id)!
      item.title = '作者调整过的方向'
    })
    const before = copy(await stored()), writes = writeCount
    await expect(workspace.commitWritingSuggestion(novel.id, input)).rejects.toThrow('未覆盖作者修改')
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(before)
  })

  async function characterScanInput() {
    const { captureCharacterScanBaseline } = await import('./characterScanTransactions')
    const { buildChapterAnalysisCandidates, buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const chapter = novel.chapters[0]
    return { baseline: captureCharacterScanBaseline(novel), candidates: buildChapterAnalysisCandidates(novel, chapter,
      buildAnalysisSourceVersionId(chapter.content), { characters: [{ name: '林澈', identity: '持钥匙的人', evidence: '林澈拿到了钥匙。' }] }) }
  }

  it('saves character scan candidates atomically, preserving manuscript, Canon and old author decisions on retry', async () => {
    const input = await characterScanInput(), before = copy(await stored()), live = copy(novel)
    failWrite()
    await expect(workspace.saveCharacterScanCandidates(novel.id, input.baseline, input.candidates)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before); expect(copy(novel)).toEqual(live)
    expect(workspace.getCandidates(novel.id)).toEqual(before.workspace.candidates)
    const gate = holdWrite(), saving = workspace.saveCharacterScanCandidates(novel.id, input.baseline, input.candidates)
    await gate.started
    expect(workspace.getCandidates(novel.id)).toEqual(before.workspace.candidates)
    gate.release(); expect(await saving).toBe(1)
    const saved = await stored()
    expect(saved.novel).toEqual(before.novel)
    expect(saved.workspace.canonMutations).toEqual(before.workspace.canonMutations)
    expect(saved.workspace.impactReports || []).toEqual(before.workspace.impactReports || [])
    await workspace.rejectStoryCandidate(novel.id, input.candidates[0].id, now)
    const decided = await stored(), writes = writeCount
    expect(await workspace.saveCharacterScanCandidates(novel.id, input.baseline, input.candidates)).toBe(0)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(decided)
    await workspace.hydrateFromPersistence(novel.id)
    expect(workspace.getCandidates(novel.id).find(item => item.id === input.candidates[0].id)?.status).toBe('rejected')
  })

  it.each(['body', 'characters', 'evidence', 'collision'] as const)('rejects stale or invalid character scans (%s) without a partial batch', async change => {
    const input = await characterScanInput()
    if (change === 'body') novel.chapters[0].content = novel.chapters[0].content.replace('钥匙', '书信')
    if (change === 'characters') novel.characters[0].identity = '新的身份'
    if (change === 'evidence') input.candidates.push({ ...copy(input.candidates[0]), id: 'invalid-evidence',
      evidence: [{ ...copy(input.candidates[0].evidence[0]), quote: '正文不存在的引文' }] })
    if (change === 'collision') input.candidates[0].id = candidate.id
    const before = copy(await stored()), local = copy(workspace.getCandidates(novel.id))
    await expect(workspace.saveCharacterScanCandidates(novel.id, input.baseline, input.candidates)).rejects.toThrow()
    expect(writeCount).toBe(0); expect(await stored()).toEqual(before)
    expect(workspace.getCandidates(novel.id)).toEqual(local)
  })

  async function addHistoricalChapter() {
    await workspace.transactStory(novel.id, aggregate => {
      const chapter = aggregate.novel.chapters[0]
      chapter.versions = [{ id: 'historical', label: '原稿', savedAt: now, snapshot: JSON.stringify({
        title: chapter.title, content: chapter.content.slice(0, -1) + '雷', summary: '尚未核对的旧总结', status: 'finalized',
      }) }]
    })
    writeCount = 0
  }

  it('restores historical prose, invalidation and impact together without publishing a failed or pending write', async () => {
    await addHistoricalChapter()
    novels.updateChapter(novel.id, novel.chapters[2].id, { status: 'reviewed', contentReviewSignature: 'unaffected-review' })
    const chapter = novel.chapters[0], before = copy(await stored()), live = copy(novel)
    failWrite()
    await expect(novels.restoreChapterVersion(novel.id, chapter.id, 'historical')).rejects.toThrow('模拟磁盘')
    expect(copy(novel)).toEqual(live); expect(await stored()).toEqual(before)
    const gate = holdWrite()
    const restoring = novels.restoreChapterVersion(novel.id, chapter.id, 'historical')
    await gate.started
    expect(copy(novel)).toEqual(live)
    gate.release(); expect(await restoring).toBe(true)
    const saved = await stored()
    expect(chapter.content).toBe(live.chapters[0].content.slice(0, -1) + '雷')
    expect(chapter.status).toBe('writing'); expect(chapter.contentReviewSignature).toBe('')
    expect(chapter.summarySource).toBeUndefined()
    expect(chapter.versions!.some(item => JSON.parse(item.snapshot).content === live.chapters[0].content)).toBe(true)
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    expect(saved.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs',
      reviewChapterIds: novel.chapters.slice(0, 2).map(item => item.id), changes: [{ target: { kind: 'chapter', id: chapter.id } }] })
    expect(novel.chapters[2].contentReviewSignature).toBe('unaffected-review')
    expect(novel.chapters[2].status).toBe('reviewed')
    const writes = writeCount
    expect(await novels.restoreChapterVersion(novel.id, chapter.id, 'historical')).toBe(false)
    expect(writeCount).toBe(writes); expect(await stored()).toEqual(saved)
    const reloaded = (await (await import('./db/novels')).loadAllNovelsFromDb()).find(item => item.id === novel.id)!
    expect(reloaded.chapters[0]).toEqual(saved.novel!.chapters[0])
  })

  it('rejects historical restoration from an old form or into a locked chapter without writing', async () => {
    await addHistoricalChapter()
    const chapter = novel.chapters[0], baseline = JSON.stringify(chapter)
    chapter.title = '作者新标题'
    await expect(novels.restoreChapterVersion(novel.id, chapter.id, 'historical', baseline)).rejects.toThrow('章节已变化')
    chapter.status = 'locked'
    await expect(novels.restoreChapterVersion(novel.id, chapter.id, 'historical')).rejects.toThrow('已锁定')
    expect(chapter.title).toBe('作者新标题'); expect(writeCount).toBe(0)
  })

  it('retains newer author prose typed while a historical restoration is committing', async () => {
    await addHistoricalChapter()
    const chapter = novel.chapters[0], content = chapter.content + '作者的新句子。', gate = holdWrite()
    const restoring = novels.restoreChapterVersion(novel.id, chapter.id, 'historical')
    await gate.started
    novels.updateChapter(novel.id, chapter.id, { content })
    const saving = novels.saveNovelNow(novel.id)
    gate.release(); await Promise.all([restoring, saving])
    expect(chapter.content).toBe(content); expect((await stored()).novel!.chapters[0].content).toBe(content)
  })

  it('accepts revision text and its decision together, publishing neither on disk failure', async () => {
    const { getChapterRevision } = await import('./db/chapterRevisions')
    const chapter = novel.chapters[0], original = chapter.content
    const later = novel.chapters[1]
    await workspace.transactStory(novel.id, aggregate => {
      const target = aggregate.novel.chapters.find(item => item.id === later.id)!
      target.status = 'reviewed'; target.contentReviewSignature = 'later-input-review'
    })
    writeCount = 0
    const revision = (await novels.proposeChapterRevision(novel.id, chapter.id, original + '修订后的结尾。'))!
    const before = copy(novel)
    failWrite()
    await expect(novels.acceptChapterRevision(novel.id, chapter.id, revision.id)).rejects.toThrow('模拟磁盘')
    expect(copy(novel)).toEqual(before)
    expect((await stored()).novel?.chapters[0].content).toBe(original)
    expect((await getChapterRevision(revision.id))?.status).toBe('pending')
    writeCount = 0
    const accepted = await novels.acceptChapterRevision(novel.id, chapter.id, revision.id)
    expect(writeCount).toBe(1)
    expect(chapter.content).toBe(revision.proposedContent)
    expect(chapter.status).toBe('writing')
    expect(chapter.versions!.some(item => JSON.parse(item.snapshot).content === original)).toBe(true)
    expect(await getChapterRevision(revision.id)).toEqual(accepted)
    const saved = await stored()
    expect(saved.novel?.chapters[0].content).toBe(revision.proposedContent)
    expect(saved.novel?.chapters[1]).toMatchObject({ status: 'writing', contentReviewSignature: '' })
    expect(saved.workspace.chapterReviews).toHaveLength(1)
    const reports = saved.workspace.impactReports || [], impact = reports[reports.length - 1]
    expect(impact).toMatchObject({ reviewPolicy: 'changed-inputs', changes: [{ target: { kind: 'chapter', id: chapter.id }, fields: ['content'] }] })
    expect(impact?.reviewChapterIds).toContain(later.id)
  })

  it('accepts revision with real downstream input changes while retaining an unrelated complete review', async () => {
    const { getChapterRevision } = await import('./db/chapterRevisions')
    const { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const chapter = novel.chapters[1], unrelated = novel.chapters[0], affected = novel.chapters[2]
    const completeReview = (aggregate: import('./storyAggregate').StoryAggregate, target: typeof chapter, id: string) => {
      const context = buildReviewContextVersion(aggregate.novel, target, [], aggregate.workspace.creationDraft,
        aggregate.workspace.canonMutations, aggregate.workspace.storyMemories)
      aggregate.workspace.chapterReviews = [...(aggregate.workspace.chapterReviews || []).filter(review => review.chapterId !== target.id), {
        id, chapterId: target.id, sourceVersionId: buildChapterReviewSourceVersion(target.content, context), startedAt: now,
        completedAt: now, deterministicChecksPassed: true, semanticChecksPassed: true, status: 'ready_to_finalize', findings: [], candidateChanges: [],
      }]
    }
    await workspace.transactStory(novel.id, aggregate => {
      completeReview(aggregate, unrelated, 'unrelated-review')
      completeReview(aggregate, affected, 'affected-review')
    })
    await workspace.transactStory(novel.id, aggregate => {
      for (const target of [aggregate.novel.chapters[0], aggregate.novel.chapters[2]]) {
        const context = buildReviewContextVersion(aggregate.novel, target, [], aggregate.workspace.creationDraft,
          aggregate.workspace.canonMutations, aggregate.workspace.storyMemories)
        const signature = buildChapterReviewSignature(target.content, context)
        target.contentReviewSignature = signature
        target.contentReviewCoverage = { signature, status: 'complete', globalStatus: 'not-needed', totalChunks: 1,
          completedChunks: 1, coveredCharacters: target.content.length, totalCharacters: target.content.length }
      }
    })
    writeCount = 0
    const original = chapter.content, revision = (await novels.proposeChapterRevision(novel.id, chapter.id, original + '修订改变后文审核输入。'))!
    const before = copy(await stored())
    const beforeAggregate = before as import('./storyAggregate').StoryAggregate
    const signatureFor = (aggregate: import('./storyAggregate').StoryAggregate, target: typeof chapter) => buildChapterReviewSignature(target.content,
      buildReviewContextVersion(aggregate.novel, target, [], aggregate.workspace.creationDraft, aggregate.workspace.canonMutations, aggregate.workspace.storyMemories))
    const beforeAffectedSignature = signatureFor(beforeAggregate, beforeAggregate.novel.chapters[2])
    const beforeUnrelatedSignature = signatureFor(beforeAggregate, beforeAggregate.novel.chapters[0])
    const beforeWorkspace = { chapterReviews: copy(workspace.getChapterReviews(novel.id)), reviewFindings: copy(workspace.getReviewFindings(novel.id)),
      impactReports: copy(workspace.getImpactReports(novel.id)) }
    expect(beforeUnrelatedSignature).toBe(before.novel!.chapters[0].contentReviewSignature)
    expect(before.novel!.chapters[0].contentReviewCoverage).toMatchObject({ signature: beforeUnrelatedSignature, status: 'complete' })
    failWrite()
    await expect(novels.acceptChapterRevision(novel.id, chapter.id, revision.id)).rejects.toThrow('模拟磁盘')
    expect(await stored()).toEqual(before)
    expect(copy(workspace.getChapterReviews(novel.id))).toEqual(beforeWorkspace.chapterReviews)
    expect(copy(workspace.getReviewFindings(novel.id))).toEqual(beforeWorkspace.reviewFindings)
    expect(copy(workspace.getImpactReports(novel.id))).toEqual(beforeWorkspace.impactReports)
    expect(novel.chapters[1].content).toBe(original)
    expect((await getChapterRevision(revision.id))?.status).toBe('pending')
    await novels.acceptChapterRevision(novel.id, chapter.id, revision.id)
    const saved = await stored(), savedAggregate = saved as import('./storyAggregate').StoryAggregate
    const afterAffectedSignature = signatureFor(savedAggregate, savedAggregate.novel.chapters[2])
    const afterUnrelatedSignature = signatureFor(savedAggregate, savedAggregate.novel.chapters[0])
    expect(afterAffectedSignature).not.toBe(beforeAffectedSignature)
    expect(afterUnrelatedSignature).toBe(beforeUnrelatedSignature)
    expect(saved.novel!.chapters[0].contentReviewCoverage).toEqual(before.novel!.chapters[0].contentReviewCoverage)
    expect(saved.novel!.chapters[2]).toMatchObject({ status: 'draft', contentReviewSignature: '' })
    const reports = saved.workspace.impactReports || [], impact = reports[reports.length - 1]
    expect(impact?.reviewChapterIds).toContain(affected.id)
    expect(impact?.reviewChapterIds).not.toContain(unrelated.id)
  })

  it('preserves author edits and later saves when a revision is accepted during writing', async () => {
    const { getChapterRevision } = await import('./db/chapterRevisions')
    const chapter = novel.chapters[0], original = chapter.content
    const revision = (await novels.proposeChapterRevision(novel.id, chapter.id, original + 'AI 修订。'))!
    const gate = holdWrite()
    const accepting = novels.acceptChapterRevision(novel.id, chapter.id, revision.id)
    await gate.started
    expect(chapter.content).toBe(original)
    novels.updateChapter(novel.id, chapter.id, { content: original + '作者继续输入。', status: 'writing' })
    const saving = novels.saveNovelNow(novel.id)
    gate.release()
    await Promise.all([accepting, saving])
    expect(chapter.content).toBe(original + '作者继续输入。')
    expect((await stored()).novel?.chapters[0].content).toBe(chapter.content)
    expect((await getChapterRevision(revision.id))?.status).toBe('accepted')
    expect(novels.hasPendingSaves).toBe(false)
  })

  it('keeps unrelated prose dirty on duplicate acceptance instead of pretending it was persisted', async () => {
    const chapter = novel.chapters[0]
    const revision = (await novels.proposeChapterRevision(novel.id, chapter.id, chapter.content + '修订。'))!
    const accepted = await novels.acceptChapterRevision(novel.id, chapter.id, revision.id)
    novels.updateTitle(novel.id, '尚未保存的新标题')
    writeCount = 0
    expect(await novels.acceptChapterRevision(novel.id, chapter.id, revision.id)).toEqual(accepted)
    expect(writeCount).toBe(0)
    expect(novels.hasPendingSaves).toBe(true)
    expect((await stored()).novel?.title).not.toBe('尚未保存的新标题')
    await novels.flushPendingSaves()
    expect((await stored()).novel?.title).toBe('尚未保存的新标题')
  })

  it('rejects a stale pending revision snapshot after another decision has already rejected it', async () => {
    const chapter = novel.chapters[0], original = chapter.content
    const revision = (await novels.proposeChapterRevision(novel.id, chapter.id, chapter.content + '修订。'))!
    const expected = await repository.readStoryAggregate(novel.id)
    const staged = copy(expected) as import('./storyAggregate').StoryAggregate
    staged.novel.chapters[0].content = revision.proposedContent
    await novels.rejectChapterRevision(revision.id)
    writeCount = 0
    await expect(repository.saveStoryAggregate(staged, expected, { expected: revision, acceptedAt: now })).rejects.toMatchObject({ code: 'PROJECT_CONFLICT' })
    expect(writeCount).toBe(0)
    expect((await stored()).novel?.chapters[0].content).toBe(original)
  })

  it('retains the author draft and pending proposal when marking a stale proposal fails', async () => {
    const { getChapterRevision } = await import('./db/chapterRevisions')
    const chapter = novel.chapters[0]
    const revision = (await novels.proposeChapterRevision(novel.id, chapter.id, chapter.content + 'AI 修订。'))!
    const authorDraft = chapter.content + '作者先修改了原文。'
    novels.updateChapter(novel.id, chapter.id, { content: authorDraft })
    failWrite()
    await expect(novels.acceptChapterRevision(novel.id, chapter.id, revision.id)).rejects.toThrow('模拟磁盘')
    expect(chapter.content).toBe(authorDraft)
    expect((await getChapterRevision(revision.id))?.status).toBe('pending')
    await expect(novels.acceptChapterRevision(novel.id, chapter.id, revision.id)).rejects.toThrow('chapter changed')
    expect((await getChapterRevision(revision.id))?.status).toBe('stale')
    await novels.flushPendingSaves()
    expect((await stored()).novel?.chapters[0].content).toBe(authorDraft)
  })

  async function createArcForAuthorTest() {
    const definition: import('./storyArcEditing').ArcDefinition = { title: '钥匙线', description: '查明真相', type: 'character', importance: 4,
      status: 'active', reactivateAt: '', characterIds: ['person-0'], goal: '找到暗门', falseBelief: '钥匙已经丢失', finalState: '学会核实' }
    await novels.commitStoryArcEdit(novel.id, { action: 'create', definition, nodes: [{ title: '得到钥匙', description: '', targetChapter: 0 }] })
    return { definition, arc: novels.getNovel(novel.id)!.storyArcs!.slice(-1)[0]! }
  }

  it('publishes arc design and review invalidation only after durable success', async () => {
    const { definition, arc } = await createArcForAuthorTest()
    const expectedArc = JSON.stringify(arc), original = copy((await stored()).novel!.storyArcs)
    failWrite()
    await expect(novels.commitStoryArcEdit(novel.id, { action: 'update', arcId: arc.id, expectedArc, definition: { ...definition, goal: '打开暗门' } })).rejects.toThrow('模拟磁盘')
    expect(novels.getNovel(novel.id)!.storyArcs).toEqual(original)
    expect((await stored()).novel!.storyArcs).toEqual(original)
    const impact = await novels.commitStoryArcEdit(novel.id, { action: 'update', arcId: arc.id, expectedArc, definition: { ...definition, goal: '打开暗门' } })
    expect(impact.chapterIds).toContain(novel.chapters[0].id)
    expect((await stored()).novel!.storyArcs![0].goal).toBe('打开暗门')
    await expect(novels.commitStoryArcEdit(novel.id, { action: 'delete', arcId: arc.id, expectedArc })).rejects.toThrow('编辑期间发生变化')
    expect((await stored()).workspace.chapterReviews).toHaveLength(1) // retain past evidence, current signatures reject it
  })

  it('atomically saves actual chapter evidence and rejects an open form after the source changes', async () => {
    const { arc } = await createArcForAuthorTest()
    const { buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const chapter = novels.getNovel(novel.id)!.chapters[0]
    const source = { kind: 'chapter' as const, chapterId: chapter.id, chapterIndex: chapter.chapterIndex,
      sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: [{ quote: '林澈拿到了钥匙。' }] }
    const edit = { action: 'node_status' as const, arcId: arc.id, nodeId: arc.nodes[0].id, expectedArc: JSON.stringify(arc), status: 'completed' as const, source }
    failWrite()
    await expect(novels.commitStoryArcEdit(novel.id, edit)).rejects.toThrow('模拟磁盘')
    expect((await stored()).novel!.storyArcs![0].nodes[0].status).toBe('pending')
    await novels.commitStoryArcEdit(novel.id, edit)
    const durable = (await stored()).novel!.storyArcs![0].nodes[0]
    expect(durable.status).toBe('completed')
    expect(durable.actualChapter).toBe(0)
    expect(durable.provenance!.revisions.slice(-1)[0]!.source).toMatchObject({ kind: 'chapter', evidence: [{ quote: '林澈拿到了钥匙。', startOffset: 0, endOffset: 8 }] })
    const currentArc = novels.getNovel(novel.id)!.storyArcs![0]
    const staleEdit = { ...edit, expectedArc: JSON.stringify(currentArc) }
    novels.updateChapter(novel.id, chapter.id, { content: chapter.content + '作者改稿。' })
    await expect(novels.commitStoryArcEdit(novel.id, staleEdit)).rejects.toThrow('正文已经变化')
  })

  async function createSelectionProposal() {
    const { buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const chapter = novel.chapters[0]
    const contextVersion = buildReviewContextVersion(novel, chapter, [], workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id))
    return (await novels.proposeChapterRevision(novel.id, chapter.id, '主角' + chapter.content.slice(2), 'ai', '润色选区', {
      expectedBaseContent: chapter.content, selection: { startOffset: 0, endOffset: 2, mode: 'polish', contextVersion },
    }))!
  }

  it('persists selection scope and author edits, then rejects acceptance if the writing context changes', async () => {
    const { getChapterRevision, editPendingChapterRevision } = await import('./db/chapterRevisions')
    const original = novel.chapters[0].content
    const revision = await createSelectionProposal()
    expect((await getChapterRevision(revision.id))?.selection).toEqual(revision.selection)
    const edited = await editPendingChapterRevision(revision, '少年' + original.slice(2))
    expect((await getChapterRevision(revision.id))?.proposedContent).toBe(edited.proposedContent)
    expect(novel.chapters[0].content).toBe(original)
    novel.settings.protagonist.name = '设定已更新'
    await expect(novels.acceptChapterRevision(novel.id, novel.chapters[0].id, revision.id)).rejects.toThrow('写作依据已经变化')
    expect((await getChapterRevision(revision.id))?.status).toBe('pending')
    expect(novel.chapters[0].content).toBe(original)
  })

  it('rolls back failed candidate creation and failed author edits without leaving phantom revisions', async () => {
    const { getChapterRevision, editPendingChapterRevision, loadProjectChapterRevisions } = await import('./db/chapterRevisions')
    failWrite()
    await expect(createSelectionProposal()).rejects.toThrow('模拟磁盘')
    expect(await loadProjectChapterRevisions()).toHaveLength(0)
    const revision = await createSelectionProposal()
    failWrite()
    await expect(editPendingChapterRevision(revision, '少年' + revision.baseContent.slice(2))).rejects.toThrow('模拟磁盘')
    expect((await getChapterRevision(revision.id))?.proposedContent).toBe(revision.proposedContent)
    await editPendingChapterRevision(revision, '少年' + revision.baseContent.slice(2))
    expect((await getChapterRevision(revision.id))?.proposedContent.startsWith('少年')).toBe(true)
  })

  it('refuses candidate edits outside the captured selection and stale edits after rejection', async () => {
    const { getChapterRevision, editPendingChapterRevision } = await import('./db/chapterRevisions')
    const revision = await createSelectionProposal()
    await expect(editPendingChapterRevision(revision, revision.proposedContent + '修改了尾部')).rejects.toThrow('选区以外')
    expect((await getChapterRevision(revision.id))?.proposedContent).toBe(revision.proposedContent)
    await novels.rejectChapterRevision(revision.id)
    await expect(editPendingChapterRevision(revision, '少年' + revision.baseContent.slice(2))).rejects.toThrow('候选已经变化')
    expect((await getChapterRevision(revision.id))?.status).toBe('rejected')
  })

  it('rejects imported selection metadata that claims a broader manuscript edit is local', async () => {
    const { createTestProjectBackup } = await import('@/test/projectBackupFixture')
    const { parseProjectBackup } = await import('./projectBackup')
    const revision = await createSelectionProposal()
    const durable = await stored()
    const backup = createTestProjectBackup([copy(novel)], [], [revision], [], [{ ...copy(durable.workspace), novelId: novel.id,
      chapterReviews: durable.workspace.chapterReviews || [], aiRuns: durable.workspace.aiRuns || [] }])
    expect(parseProjectBackup(JSON.stringify(backup)).chapterRevisions[0].selection).toEqual(revision.selection)
    backup.chapterRevisions[0].proposedContent += '篡改了选区外文字'
    expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow('选区以外')
  })
})
