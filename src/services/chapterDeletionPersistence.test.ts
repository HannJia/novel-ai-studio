import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { Novel } from '@/types/novel'
import type { ProjectKernelRequest } from '@/types/projectKernel'
import type { StoryAggregate } from './storyAggregate'
import type { ProjectBackup } from './projectBackup'

const require = createRequire(import.meta.url)
const { createProjectKernel } = require('../../app-main/projectKernel.cjs')
const { validateBackup } = require('../../app-main/projectKernelRpc.cjs')
const now = '2026-10-31T09:00:00.000Z'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe.each(['sql', 'kernel'] as const)('chapter deletion persistence (%s)', backend => {
  let pinia: ReturnType<typeof createPinia>
  let root: string | undefined
  let diskBytes: Uint8Array | undefined
  let writeCount: number
  let nextWrite: (() => Promise<void>) | undefined
  let releases: Array<() => void>
  let kernel: { commit: (request: unknown) => Promise<unknown>; read: () => Promise<{ backup: ProjectBackup; revision: string }> } | undefined
  let novels: ReturnType<(typeof import('@/stores/novel'))['useNovelStore']>
  let workspace: ReturnType<(typeof import('@/stores/reconstructionWorkspace'))['useReconstructionWorkspaceStore']>
  let repository: typeof import('./storyAggregate')
  let novel: Novel

  async function diskWrite(bytes?: Uint8Array) {
    writeCount++
    const hook = nextWrite; nextWrite = undefined
    await hook?.()
    if (bytes) diskBytes = new Uint8Array(bytes)
  }
  function holdWrite() {
    let start!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { start = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    releases.push(release)
    nextWrite = async () => { start(); await gate }
    return { started, release }
  }
  function failWrite() { nextWrite = async () => { throw new Error('synthetic deletion disk failure') } }
  async function stored() {
    if (!kernel) return repository.readStoryAggregate(novel.id)
    const { backup } = await kernel.read()
    const { novelId: _owner, ...workspace } = backup.reconstructionWorkspaces[0]
    return { novel: backup.novels[0], workspace }
  }
  async function openStores() {
    if (backend === 'kernel') await (await import('./projectKernelClient')).initializeProjectKernel()
    novels = (await import('@/stores/novel')).useNovelStore()
    await novels.initStore(); novel = novels.novels[0]
    workspace = (await import('@/stores/reconstructionWorkspace')).useReconstructionWorkspaceStore()
    await workspace.hydrateFromPersistence(novel.id)
    repository = await import('./storyAggregate')
  }
  async function reopen() {
    disposePinia(pinia); vi.resetModules()
    pinia = createPinia(); setActivePinia(pinia)
    if (kernel) kernel = await createProjectKernel({ root, validateBackup, fault: async (stage: string) => { if (stage === 'before-publish') await diskWrite() } })
    await openStores()
  }

  beforeEach(async () => {
    vi.resetModules()
    pinia = createPinia(); setActivePinia(pinia)
    root = undefined; kernel = undefined; diskBytes = undefined; nextWrite = undefined; writeCount = 0; releases = []
    vi.stubGlobal('window', { addEventListener: () => {}, electronAPI: { dbRead: async () => diskBytes || null, dbWrite: diskWrite } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const { characterStateFixture, knowledgeCandidate } = await import('@/test/characterStateFixture')
    const { createTestProjectBackup } = await import('@/test/projectBackupFixture')
    const { acceptStoryChange } = await import('./storyDecisions')
    const { buildAnalysisSourceVersionId } = await import('./reconstructionCandidates')
    const { buildReviewContextVersion, buildChapterReviewSourceVersion, buildChapterReviewSignature } = await import('./reconstructionReviewVersion')
    const { createStoryMemoryBinding } = await import('./storyMemory')
    const fixture = characterStateFixture()
    const candidate = knowledgeCandidate(fixture.novel, 1)
    const aggregate: StoryAggregate = { novel: fixture.novel, workspace: {
      candidates: [candidate], canonMutations: [], reviewFindings: [], chapterReviews: [], aiRuns: [],
    } }
    acceptStoryChange(aggregate, candidate.id, now)
    const chapter = aggregate.novel.chapters[1], scope = { kind: 'book' as const, throughChapterId: chapter.id }
    aggregate.workspace.storyMemories = [{ id: 'memory', novelId: aggregate.novel.id, title: '合成回顾', scope, summary: '城主在世。',
      source: createStoryMemoryBinding(aggregate.novel, scope, '城主在世。', 'author', now), history: [] }]
    for (const row of aggregate.novel.chapters) {
      const context = buildReviewContextVersion(aggregate.novel, row, [], undefined, aggregate.workspace.canonMutations, aggregate.workspace.storyMemories)
      row.status = 'finalized'; row.contentReview = '【审核通过】合成报告'
      row.contentReviewSignature = buildChapterReviewSignature(row.content, context)
      const finding = { id: 'finding-' + row.id, chapterId: row.id, sourceVersionId: buildAnalysisSourceVersionId(row.content), type: 'plot' as const,
        severity: 'warning' as const, title: '保留伏笔', explanation: '合成审核', evidence: [], blocksFinalization: false, status: 'intentional' as const, authorNote: '作者明确保留' }
      aggregate.workspace.reviewFindings.push(finding)
      aggregate.workspace.chapterReviews!.push({ id: 'review-' + row.id, chapterId: row.id,
        sourceVersionId: buildChapterReviewSourceVersion(row.content, context), startedAt: now, completedAt: now,
        deterministicChecksPassed: true, semanticChecksPassed: true, status: 'approved', findings: [copy(finding)], candidateChanges: [] })
    }
    const backup = copy(createTestProjectBackup([aggregate.novel], [], [], [], [{ ...aggregate.workspace, novelId: aggregate.novel.id,
      chapterReviews: aggregate.workspace.chapterReviews || [], aiRuns: [] }]))
    if (backend === 'kernel') {
      root = await mkdtemp(path.join(os.tmpdir(), 'mojian-chapter-deletion-'))
      kernel = await createProjectKernel({ root, validateBackup, fault: async (stage: string) => { if (stage === 'before-publish') await diskWrite() } })
      await kernel!.commit({ baseRevision: null, backup })
      window.electronAPI!.projectRequest = async (request: ProjectKernelRequest) => {
        try {
          if (request.method !== 'read' && request.method !== 'commit') throw new Error('Unexpected synthetic request')
          return { ok: true, value: copy(await (request.method === 'read' ? kernel!.read() : kernel!.commit(request))) }
        } catch (error) { return { ok: false, error: { code: 'PROJECT_INVALID', message: (error as Error).message } } }
      }
    } else await (await import('./db/project')).replaceProjectInDb(backup)
    await openStores()
    writeCount = 0
  })

  afterEach(async () => {
    for (const release of releases) release()
    disposePinia(pinia)
    vi.restoreAllMocks(); vi.unstubAllGlobals()
    if (root) {
      const absolute = path.resolve(root)
      if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('mojian-chapter-deletion-')) throw new Error('Unexpected synthetic root')
      await rm(absolute, { recursive: true, force: true })
    }
  })

  it('rolls back disk failure, publishes the whole deletion only on success and reopens with history intact', async () => {
    const before = copy(await stored()), target = novel.chapters[1].id, following = novel.chapters[2].id
    const baseline = novels.captureChapterDeletionBaseline(novel.id, target), memoryBefore = copy(novel)
    failWrite()
    await expect(novels.deleteChapter(novel.id, target, baseline)).rejects.toThrow('synthetic deletion disk failure')
    expect(novel).toEqual(memoryBefore)
    expect(await stored()).toEqual(before)
    expect(workspace.getImpactReports(novel.id)).toEqual(before.workspace.impactReports || [])
    const gate = holdWrite(), deleting = novels.deleteChapter(novel.id, target, baseline)
    await gate.started
    expect(novel).toEqual(memoryBefore)
    expect(workspace.getImpactReports(novel.id)).toEqual(before.workspace.impactReports || [])
    expect(() => novels.updateChapter(novel.id, following, { content: '保存期间的合成编辑' })).toThrow('删除正在保存')
    expect(() => novels.addChapter(novel.id, { title: '保存期间新章' })).toThrow('删除正在保存')
    gate.release(); expect(await deleting).toBe(true)
    const saved = copy(await stored())
    expect(saved.novel!.chapters.map(row => [row.id, row.chapterIndex])).toEqual([[memoryBefore.chapters[0].id, 0], [following, 1]])
    expect(saved.novel!.currentWordCount).toBe(saved.novel!.chapters.reduce((sum, row) => sum + row.wordCount, 0))
    expect(saved.novel!.chapters[0].contentReviewSignature).toBe(memoryBefore.chapters[0].contentReviewSignature)
    expect(saved.novel!.chapters[1]).toMatchObject({ contentReviewSignature: '', status: 'writing' })
    expect(saved.workspace.canonMutations).toEqual(before.workspace.canonMutations)
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    expect(saved.workspace.reviewFindings).toEqual(before.workspace.reviewFindings)
    expect(saved.workspace.storyMemories).toEqual(before.workspace.storyMemories)
    expect(saved.workspace.impactReports).toHaveLength((before.workspace.impactReports?.length || 0) + 1)
    expect(saved.workspace.impactReports!.slice(-1)[0].reviewChapterIds).toEqual([following])
    const writes = writeCount
    expect(await novels.deleteChapter(novel.id, target, baseline)).toBe(false)
    expect(writeCount).toBe(writes)
    await reopen()
    expect(await stored()).toEqual(saved)
    const { getCharacterStateSnapshot } = await import('./reconstructionCharacterState')
    expect(getCharacterStateSnapshot(novel, workspace.getCanonMutations(novel.id), 100).knowledge).toEqual([])
    expect(getCharacterStateSnapshot(novel, workspace.getCanonMutations(novel.id), 100).invalid[0].issue).toBe('来源章节已删除')
  })

  it('clears atomically, rolls back a failed clear and does not save an empty clear twice', async () => {
    // The clear fixture has no unresolved positional author definitions.
    await workspace.transactStory(novel.id, aggregate => { aggregate.novel.characters = [] })
    const before = copy(await stored()), baseline = novels.captureChapterDeletionBaseline(novel.id)
    failWrite()
    await expect(novels.clearChapters(novel.id, baseline)).rejects.toThrow('synthetic deletion disk failure')
    expect(await stored()).toEqual(before)
    expect(novel.chapters).toHaveLength(3)
    const gate = holdWrite(), clearing = novels.clearChapters(novel.id, baseline)
    await gate.started
    expect(novel.chapters).toHaveLength(3)
    gate.release(); expect(await clearing).toBe(true)
    const saved = copy(await stored())
    expect(saved.novel!.chapters).toEqual([])
    expect(saved.novel!.currentWordCount).toBe(0)
    expect(saved.workspace.canonMutations).toEqual(before.workspace.canonMutations)
    expect(saved.workspace.reviewFindings).toEqual(before.workspace.reviewFindings)
    expect(saved.workspace.chapterReviews).toEqual(before.workspace.chapterReviews)
    const writes = writeCount
    expect(await novels.clearChapters(novel.id, baseline)).toBe(false)
    expect(writeCount).toBe(writes)
    await reopen(); expect(await stored()).toEqual(saved)
  })

  it('archives a deleted manuscript and its revision decisions through deletion, later saves and reopening', async () => {
    const chapter = novel.chapters[1]
    const revisions = await import('./db/chapterRevisions')
    const revision = await revisions.createChapterRevision(novel.id, chapter.id, chapter.content, chapter.content + '作者候选。', 'user')
    await revisions.updateChapterRevisionStatus(revision.id, 'rejected', undefined, 'pending')
    const before = copy(chapter), revisionBefore = copy(await revisions.listChapterRevisions(chapter.id))
    expect(await novels.deleteChapter(novel.id, chapter.id)).toBe(true)
    expect(novel.archivedChapters).toEqual([{ ...before, archivedAt: expect.any(String) }])
    expect(await revisions.listChapterRevisions(chapter.id)).toEqual(revisionBefore)
    expect(novel.chapters.some(row => row.id === chapter.id)).toBe(false)
    await workspace.transactStory(novel.id, current => { current.novel.title = '删除后的正常保存' })
    await (await import('./db/novels')).saveNovelToDb(novel)
    const saved = copy(await stored())
    await reopen()
    expect(await stored()).toEqual(saved)
    const reopenedRevisions = await import('./db/chapterRevisions')
    expect(await reopenedRevisions.listChapterRevisions(chapter.id)).toEqual(revisionBefore)
    expect(novel.archivedChapters?.[0].content).toBe(before.content)
  })

  it('round trips multiple deletions and a new chapter without rebinding archived history to display numbers', async () => {
    const removed = copy(novel.chapters.slice(1))
    expect(await novels.deleteChapter(novel.id, removed[0].id)).toBe(true)
    expect(await novels.deleteChapter(novel.id, removed[1].id)).toBe(true)
    const added = novels.addChapter(novel.id, { title: '后来新章', content: '新的合成正文。' })!
    expect(added.chapterIndex).toBe(1)
    expect(novel.archivedChapters?.map(row => row.id).sort()).toEqual(removed.map(row => row.id).sort())
    await novels.saveNovelNow(novel.id)
    const before = copy(await stored())
    await reopen()
    expect(await stored()).toEqual(before)
    expect(novel.chapters.map(row => row.id)).toContain(added.id)
    expect(novel.archivedChapters?.find(row => row.id === removed[1].id)?.chapterIndex).toBe(1)
  })

  it('keeps both copies intact on validation failure instead of stripping bad history', async () => {
    workspace.getCanonMutations(novel.id)[0].novelId = 'invalid-synthetic-owner'
    const before = copy(await stored()), memory = copy(novel), decisions = copy(workspace.getCanonMutations(novel.id)), writes = writeCount
    await expect(novels.deleteChapter(novel.id, novel.chapters[1].id)).rejects.toThrow()
    expect(novel).toEqual(memory)
    expect(workspace.getCanonMutations(novel.id)).toEqual(decisions)
    expect(await stored()).toEqual(before)
    expect(writeCount).toBe(writes)
  })

  it('rejects a concurrent durable change rather than overwriting it', async () => {
    const captured = copy(await stored()), target = novel.chapters[1].id
    const { captureChapterDeletionBaseline, deleteChaptersWithImpact } = await import('./chapterDeletionTransactions')
    const aggregate = copy(captured) as StoryAggregate
    deleteChaptersWithImpact(aggregate, target, captureChapterDeletionBaseline(aggregate.novel, target), now, () => 'conflict-impact')
    await workspace.transactStory(novel.id, current => { current.novel.title = '另一次已保存编辑' })
    const latest = copy(await stored()), writes = writeCount
    await expect(repository.saveStoryAggregate(aggregate, captured)).rejects.toThrow('已经更新')
    expect(await stored()).toEqual(latest)
    expect(writeCount).toBe(writes)
  })
})
