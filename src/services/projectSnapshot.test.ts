import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const diskWrite = vi.fn().mockResolvedValue(undefined)
const restorePoint = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  vi.resetModules()
  setActivePinia(createPinia())
  diskWrite.mockReset().mockResolvedValue(undefined)
  restorePoint.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', { addEventListener: () => {}, electronAPI: { dbRead: async () => null, dbWrite: diskWrite, dbRetainProjectBackup: restorePoint } })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})
afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const { useNovelStore } = await import('@/stores/novel')
  const { useReconstructionWorkspaceStore } = await import('@/stores/reconstructionWorkspace')
  const { characterStateFixture, knowledgeCandidate, stateTestTime } = await import('@/test/characterStateFixture')
  const { plannedProjectWorkspace } = await import('@/test/projectBackupFixture')
  const { saveReconstructionWorkspace, loadReconstructionWorkspace } = await import('./db/reconstruction')
  const { exportProjectSnapshot, importProject } = await import('./projectTransfer')
  await useNovelStore().initStore()
  const { novel, store: novels } = characterStateFixture()
  const workspace = useReconstructionWorkspaceStore()
  const candidate = knowledgeCandidate(novel, 0)
  workspace.addCandidateChanges(novel.id, [candidate])
  await workspace.acceptCharacterStateCandidate(novel, candidate.id, stateTestTime)
  const characterState = await loadReconstructionWorkspace(novel.id)
  const { createStoryMemoryBinding } = await import('./storyMemory')
  const scope = { kind: 'book' as const, throughChapterId: novel.chapters[0].id }
  const state = { ...plannedProjectWorkspace(novel), editorDrafts: [], candidates: characterState.candidates, canonMutations: characterState.canonMutations,
    storyMemories: [{ id: 'story-memory', novelId: novel.id, title: '第一章回顾', scope, summary: '人物尚未得知密信。',
      source: createStoryMemoryBinding(novel, scope, '人物尚未得知密信。', 'author', stateTestTime), history: [] }],
    reviewFindings: [{ id: 'finding', type: 'knowledge' as const, severity: 'warning' as const, title: '留意知情边界', explanation: '作者有意设计',
      chapterId: novel.chapters[0].id, evidence: candidate.evidence, blocksFinalization: false, status: 'intentional' as const }],
    chapterReviews: [{ id: 'review', chapterId: novel.chapters[0].id, sourceVersionId: candidate.sourceVersionId!, startedAt: stateTestTime,
      deterministicChecksPassed: true, semanticChecksPassed: true, findings: [], candidateChanges: characterState.candidates, status: 'approved' as const }],
  }
  await saveReconstructionWorkspace(novel.id, state)
  // Export must read this from disk even though the workspace is not mounted.
  workspace.clearNovel(novel.id)
  return { novel, novels, workspace, state, exportProjectSnapshot, importProject, loadReconstructionWorkspace, saveReconstructionWorkspace }
}

describe('complete project snapshots', () => {
  it('exports unloaded planning, reviews and evidence; round trips them with the manuscript through a full restore', async () => {
    const ctx = await setup()
    const backup = await ctx.exportProjectSnapshot()
    expect(backup.version).toBe(3)
    expect(backup.reconstructionWorkspaces).toEqual([ctx.state])
    const { replaceProjectInDb } = await import('./db/project')
    const { createTestProjectBackup } = await import('@/test/projectBackupFixture')
    const { adoptProjectSnapshot } = await import('./projectSnapshot')
    const empty = createTestProjectBackup([], [])
    await replaceProjectInDb(empty)
    adoptProjectSnapshot(empty)
    await ctx.importProject(backup)
    expect(ctx.novels.getNovel(ctx.novel.id)?.chapters[0].content).toBe(ctx.novel.chapters[0].content)
    expect(ctx.workspace.getCreationDraft(ctx.novel.id)).toEqual(ctx.state.creationDraft)
    expect(ctx.workspace.getCanonMutations(ctx.novel.id)).toEqual(ctx.state.canonMutations)
    expect(ctx.workspace.getStoryMemories(ctx.novel.id)).toEqual(ctx.state.storyMemories)
    expect(await ctx.loadReconstructionWorkspace(ctx.novel.id)).toMatchObject({ candidates: ctx.state.candidates, canonMutations: ctx.state.canonMutations })
    const { getCharacterStateSnapshot } = await import('./reconstructionCharacterState')
    expect(getCharacterStateSnapshot(ctx.novels.getNovel(ctx.novel.id)!, ctx.workspace.getCanonMutations(ctx.novel.id), 1).knowledge[0].state).toBe('false_belief')
  })

  it('flushes partially loaded edits without erasing unseen collections and saves a complete pre-import restore point', async () => {
    const ctx = await setup()
    const draft = JSON.parse(JSON.stringify(ctx.state.creationDraft!))
    draft.contract.title = '尚未落盘的契约'
    ctx.workspace.setCreationDraft(ctx.novel.id, draft)
    const backup = await ctx.exportProjectSnapshot()
    expect(backup.reconstructionWorkspaces[0].creationDraft?.contract.title).toBe('尚未落盘的契约')
    expect(backup.reconstructionWorkspaces[0].canonMutations).toEqual(ctx.state.canonMutations)
    backup.novels[0].title = '恢复作品'
    backup.reconstructionWorkspaces[0].creationDraft!.contract.title = '导入后的契约'
    await ctx.importProject(backup)
    const before = JSON.parse(restorePoint.mock.calls[0][0])
    expect(before.reconstructionWorkspaces[0].creationDraft.contract.title).toBe('尚未落盘的契约')
    expect(before.reconstructionWorkspaces[0].canonMutations).toEqual(ctx.state.canonMutations)
    expect(ctx.workspace.getCreationDraft(ctx.novel.id)?.contract.title).toBe('导入后的契约')
  })

  it('preserves unloaded Canon and reviews when saving a contract before any export', async () => {
    const ctx = await setup()
    const draft = JSON.parse(JSON.stringify(ctx.state.creationDraft!))
    draft.contract.title = '普通保存修改'
    draft.contract.targetWordCountMin = 1000
    draft.contract.targetWordCountMax = 100 // A saved draft may still need author correction.
    ctx.workspace.setCreationDraft(ctx.novel.id, draft)
    await ctx.workspace.persistToDatabase(ctx.novel.id)
    const stored = await ctx.loadReconstructionWorkspace(ctx.novel.id)
    expect(stored.creationDraft?.contract.title).toBe('普通保存修改')
    expect(stored.canonMutations).toEqual(ctx.state.canonMutations)
    expect(stored.chapterReviews).toEqual(ctx.state.chapterReviews)
    const backup = await ctx.exportProjectSnapshot()
    expect(backup.reconstructionWorkspaces[0].creationDraft?.contract).toMatchObject({ targetWordCountMin: 1000, targetWordCountMax: 100, approval: 'draft' })
  })

  it('rolls back all database tables and leaves all stores unchanged on disk failure, then removes stale rows on success', async () => {
    const ctx = await setup()
    const before = await ctx.exportProjectSnapshot()
    await ctx.workspace.hydrateFromPersistence(ctx.novel.id)
    const { createTestProjectBackup, emptyProjectWorkspace } = await import('@/test/projectBackupFixture')
    const { queryAll } = await import('./database')
    const changed = JSON.parse(JSON.stringify(before))
    changed.novels[0].title = '失败不应出现'
    changed.reconstructionWorkspaces = [emptyProjectWorkspace(ctx.novel.id)]
    diskWrite.mockRejectedValueOnce(new Error('模拟恢复落盘失败'))
    await expect(ctx.importProject(changed)).rejects.toThrow('模拟恢复落盘失败')
    expect(ctx.novels.getNovel(ctx.novel.id)?.title).toBe(before.novels[0].title)
    expect(ctx.workspace.getCanonMutations(ctx.novel.id)).toEqual(ctx.state.canonMutations)
    expect((await ctx.loadReconstructionWorkspace(ctx.novel.id)).creationDraft).toEqual(ctx.state.creationDraft)
    expect(queryAll<{ title: string }>('SELECT title FROM novels')[0].title).toBe(before.novels[0].title)
    await ctx.importProject(createTestProjectBackup([], []))
    for (const table of ['novels', 'reconstruction_creation_drafts', 'reconstruction_candidates', 'reconstruction_review_findings',
      'reconstruction_chapter_reviews', 'reconstruction_ai_runs', 'reconstruction_canon_mutations']) expect(queryAll('SELECT * FROM ' + table)).toEqual([])
    expect(ctx.workspace.getCreationDraft(ctx.novel.id)).toBeUndefined()
    expect(ctx.workspace.getCanonMutations(ctx.novel.id)).toEqual([])
  })

  it('refuses corrupt V3 records instead of exporting an apparently complete backup with missing history', async () => {
    const ctx = await setup()
    const { execute, runTransaction } = await import('./database')
    await runTransaction(() => execute("UPDATE reconstruction_canon_mutations SET value = '{broken'"))
    await expect(ctx.exportProjectSnapshot()).rejects.toThrow('工作区记录损坏')
    expect(restorePoint).not.toHaveBeenCalled()
  })

  it('stops before replacement when the complete restore point cannot be saved', async () => {
    const ctx = await setup()
    const backup = await ctx.exportProjectSnapshot()
    const oldTitle = backup.novels[0].title
    backup.novels[0].title = '不应写入'
    restorePoint.mockRejectedValueOnce(new Error('恢复点磁盘空间不足'))
    await expect(ctx.importProject(backup)).rejects.toThrow('恢复点磁盘空间不足')
    const { queryAll } = await import('./database')
    expect(queryAll<{ title: string }>('SELECT title FROM novels')[0].title).toBe(oldTitle)
    expect(ctx.novels.getNovel(ctx.novel.id)?.title).toBe(oldTitle)
    expect((await ctx.loadReconstructionWorkspace(ctx.novel.id)).canonMutations).toEqual(ctx.state.canonMutations)
  })

  it('flushes the editor before capture and prevents AI or competing imports from starting during the snapshot', async () => {
    const ctx = await setup()
    const before = await ctx.exportProjectSnapshot()
    const { registerDraftSaver, projectTransferBusy } = await import('./appLifecycle')
    const { startAiActivity } = await import('./aiActivity')
    const { chapterBackgroundQueue } = await import('./aiTaskQueue')
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const unregister = registerDraftSaver(async () => {
      await pending
      ctx.novels.updateChapter(ctx.novel.id, ctx.novel.chapters[0].id, { content: '刚从编辑器提交的正文' })
    })
    try {
      const capture = ctx.exportProjectSnapshot()
      expect(projectTransferBusy.value).toBe(true)
      expect(() => startAiActivity('新写作请求')).toThrow('不能启动 AI')
      expect(() => chapterBackgroundQueue.enqueue('新后台任务', async () => {})).toThrow('不能启动后台')
      await expect(ctx.importProject(before)).rejects.toThrow('正在进行')
      release()
      expect((await capture).novels[0].chapters[0].content).toBe('刚从编辑器提交的正文')
      expect(projectTransferBusy.value).toBe(false)
    } finally { release(); unregister() }
  })

  it('refuses import during the entire autonomous executor, including persistence between requests', async () => {
    const ctx = await setup()
    const backup = await ctx.exportProjectSnapshot()
    const { executeAutonomousRun } = await import('./reconstructionAutonomous')
    const { activeAutonomousRunCount } = await import('./appLifecycle')
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const run = executeAutonomousRun({ run: { ...ctx.state.aiRuns[0], status: 'queued', chapterEnd: 0, usedTokens: 0, requestLimit: 200, requests: [] },
      persist: () => pending, processChapter: async () => ({ status: 'completed' }) })
    try {
      expect(activeAutonomousRunCount.value).toBe(1)
      await expect(ctx.importProject(backup)).rejects.toThrow('自动写作任务')
    } finally { release(); await run }
    expect(activeAutonomousRunCount.value).toBe(0)
  })
})
