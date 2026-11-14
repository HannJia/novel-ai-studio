import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { ProjectBackup } from './projectBackup'
import type { ProjectKernelRequest, ProjectLibraryState } from '@/types/projectKernel'

const require = createRequire(import.meta.url)
const { createProjectKernelHandler, validateBackup } = require('../../app-main/projectKernelRpc.cjs')
const { createProjectKernel } = require('../../app-main/projectKernel.cjs')
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
let root: string
let pinia: ReturnType<typeof createPinia>
let failure = false
let malformed = false
let requests: ProjectKernelRequest[]
let bridge: ReturnType<typeof vi.fn>
let oldRead: ReturnType<typeof vi.fn>
let oldWrite: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  pinia = createPinia()
  setActivePinia(pinia)
  root = await mkdtemp(path.join(os.tmpdir(), 'mojian-kernel-integration-'))
  requests = []; failure = false; malformed = false
  const handler = createProjectKernelHandler({ root, authorize: () => {} })
  bridge = vi.fn(async (request: ProjectKernelRequest) => {
    requests.push(copy(request))
    if (failure && request.method === 'commit') return { ok: false, error: { code: 'PROJECT_BUSY', message: '测试磁盘失败' } }
    if (malformed && request.method === 'commit') return { ok: true, value: { revision: null, backup: null } }
    return copy(await handler({}, copy(request)))
  })
  oldRead = vi.fn().mockResolvedValue(null)
  oldWrite = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', { addEventListener: () => {}, electronAPI: { projectRequest: bridge, dbRead: oldRead, dbWrite: oldWrite } })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})
afterEach(async () => {
  disposePinia(pinia)
  vi.unstubAllGlobals()
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mojian-kernel-integration-')) throw new Error('Unexpected test root')
  await rm(root, { recursive: true, force: true })
})

async function fixture(): Promise<ProjectBackup> {
  const { characterStateFixture } = await import('@/test/characterStateFixture')
  const { createTestProjectBackup, plannedProjectWorkspace } = await import('@/test/projectBackupFixture')
  const { novel } = characterStateFixture()
  novel.chapters[0].content = '\n  林澈在雨中等待。\r\n\n'
  novel.knowledgeBaseIds = ['library']
  return copy(createTestProjectBackup([novel], [{ id: 'library', name: '资料', description: '', entries: [], createdAt: novel.createdAt }], [], [], [
    { ...plannedProjectWorkspace(novel), editorDrafts: [], storyMemories: [] },
  ]))
}
async function existing(backup: ProjectBackup) {
  const kernel = await createProjectKernel({ root, validateBackup })
  await kernel.commit({ baseRevision: null, backup })
  const client = await import('./projectKernelClient')
  await client.initializeProjectKernel()
  return { kernel, client }
}

describe('desktop project kernel integration', () => {
  it('restores review segments from the real kernel and rejects corrupted reports', async () => {
    const backup = await fixture(), novel = backup.novels[0], chapter = novel.chapters[0]
    chapter.content = '甲'.repeat(5000); chapter.wordCount = 5000
    const { kernel } = await existing(backup)
    const { saveNovelToDb } = await import('./db/novels')
    const { requestChapterReviewWithCoverage } = await import('./chapterReviewCoverage')
    const report = '总体判断：可通过\n必改数量：0\n## 本段事实摘要\n主角来到渡口。'
    const onCheckpoint = async (coverage: import('./chapterReviewCoverage').ReviewCoverage) => {
      chapter.contentReviewCoverage = { ...coverage, signature: 'kernel-checkpoint-review' }
      await saveNovelToDb(novel)
    }
    await expect(requestChapterReviewWithCoverage(chapter.content, async part => {
      if (part.index === 1) throw new Error('第二段中断')
      return report
    }, undefined, { binding: 'kernel-review', onCheckpoint })).rejects.toThrow('第二段中断')
    const reopened = await createProjectKernel({ root, validateBackup }), stored = await reopened.read()
    const savedCoverage = stored.backup.novels[0].chapters[0].contentReviewCoverage
    expect(savedCoverage.checkpoint.chunks).toHaveLength(1)
    expect(savedCoverage.checkpoint.chunks[0].report).toBe(report)
    const corrupt = copy(stored.backup)
    corrupt.novels[0].chapters[0].contentReviewCoverage.checkpoint.chunks[0].report = '没有结论'
    await expect(kernel.commit({ baseRevision: stored.revision, backup: corrupt })).rejects.toThrow()
    expect(await kernel.read()).toEqual(stored)
    const retry = vi.fn(async (_part, _kind) => report)
    await requestChapterReviewWithCoverage(chapter.content, retry, undefined, { binding: 'kernel-review', checkpoint: savedCoverage.checkpoint, onCheckpoint })
    expect(retry.mock.calls.map(([part, kind]) => kind === 'global' ? 'global' : part.index)).toEqual([1, 'global'])
    const after = await kernel.read()
    expect(after.backup.novels[0].chapters[0].content).toBe(chapter.content)
    expect(after.backup.novels[0].chapters[0].contentReviewCoverage).toMatchObject({ status: 'complete', completedChunks: 2, globalStatus: 'complete' })
  }, 20000)

  it('keeps autonomous drafts isolated and accepts manuscript plus decision in one durable commit', async () => {
    const backup = await fixture()
    const chapter = backup.novels[0].chapters[0]; chapter.content = ''; chapter.wordCount = 0; chapter.status = 'draft'
    const { kernel } = await existing(backup)
    const { useNovelStore } = await import('@/stores/novel')
    const { useReconstructionWorkspaceStore } = await import('@/stores/reconstructionWorkspace')
    const { createAiRun } = await import('./reconstructionAiRun')
    const { buildReviewContextVersion } = await import('./reconstructionReviewVersion')
    const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
    await novels.initStore(); await workspace.hydrateFromPersistence(backup.novels[0].id)
    const novel = novels.getNovel(backup.novels[0].id)!, now = backup.exportedAt
    const draft = { id: 'generated-draft', chapterId: chapter.id, chapterIndex: chapter.chapterIndex, baseContent: '', content: '林澈留下了新的线索。',
      contextVersion: buildReviewContextVersion(novel, { ...novel.chapters[0], content: '林澈留下了新的线索。', summary: '', summarySource: undefined }, [], workspace.getCreationDraft(novel.id), workspace.getCanonMutations(novel.id), workspace.getStoryMemories(novel.id)),
      status: 'pending' as const, stage: 'generated' as const, createdAt: now, updatedAt: now, history: [] }
    const run = { ...createAiRun({ id: 'draft-run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 1, tokenBudget: 10000, now }),
      status: 'completed' as const, chapterDrafts: [draft] }
    await workspace.saveAiRun(novel.id, run)
    const before = await kernel.read()
    expect(before.backup.novels[0].chapters[0].content).toBe('')
    failure = true
    await expect(workspace.decideAiDraft(novel.id, run.id, draft, 'accept')).rejects.toThrow('磁盘失败')
    expect(novel.chapters[0].content).toBe('')
    expect(workspace.getAiRun(novel.id, run.id)?.chapterDrafts?.[0].status).toBe('pending')
    expect(await kernel.read()).toEqual(before)
    failure = false
    await workspace.decideAiDraft(novel.id, run.id, draft, 'accept')
    const reopened = await createProjectKernel({ root, validateBackup }), saved = await reopened.read()
    expect(saved.backup.novels[0].chapters[0].content).toBe(draft.content)
    expect(saved.backup.reconstructionWorkspaces[0].aiRuns.find((row: { id: string }) => row.id === run.id).chapterDrafts[0].status).toBe('accepted')
    expect(saved.backup.reconstructionWorkspaces[0].canonMutations).toEqual(before.backup.reconstructionWorkspaces[0].canonMutations)
    expect(JSON.parse(novel.chapters[0].versions!.slice(-1)[0].snapshot).content).toBe('')
  }, 20000)

  it('persists request reservations and receipts through the kernel and rejects corrupt totals', async () => {
    const backup = await fixture()
    const { kernel } = await existing(backup)
    const { saveReconstructionRun, loadReconstructionRun } = await import('./db/reconstructionRuns')
    const { createAiRun } = await import('./reconstructionAiRun')
    const novelId = backup.novels[0].id, now = backup.exportedAt
    const pending = { ...createAiRun({ id: 'budget-run', mode: 'autonomous', taskType: 'draft', targetId: novelId,
      chapterStart: 0, chapterEnd: 1, tokenBudget: 1000, now }), status: 'running' as const, usedTokens: 500, requests: [{
      id: 'budget-run:request:1', chapterIndex: 0, phase: 'writing' as const, modelId: 'test', status: 'pending' as const,
      reservedTokens: 500, inputTokens: 300, outputTokens: 200, usageSource: 'reservation' as const, startedAt: now,
    }] }
    await saveReconstructionRun(novelId, pending)
    const admitted = await kernel.read()
    expect(await loadReconstructionRun(novelId, pending.id)).toEqual(pending)
    const receipt = { ...pending, usedTokens: 350, requests: [{ ...pending.requests[0],
      status: 'completed' as const, outputTokens: 50, usageSource: 'reported' as const, completedAt: now }] }
    failure = true
    await expect(saveReconstructionRun(novelId, receipt)).rejects.toThrow('磁盘失败')
    expect(await loadReconstructionRun(novelId, pending.id)).toEqual(pending)
    expect(await kernel.read()).toEqual(admitted)
    failure = false
    await saveReconstructionRun(novelId, receipt)
    const reopened = await createProjectKernel({ root, validateBackup })
    const committed = await reopened.read()
    expect(committed.backup.reconstructionWorkspaces[0].aiRuns.find((run: { id: string }) => run.id === pending.id)).toEqual(receipt)
    const corrupt = copy(committed.backup)
    corrupt.reconstructionWorkspaces[0].aiRuns.find((run: { id: string }) => run.id === pending.id)!.usedTokens = 0
    await expect(reopened.commit({ baseRevision: committed.revision, backup: corrupt })).rejects.toThrow('请求账本')
    expect(await reopened.read()).toEqual(committed)
  }, 20000)

  it('starts a new native V3 library without opening or importing historical SQL', async () => {
    oldRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const client = await import('./projectKernelClient')
    await client.initializeProjectKernel()
    const library = await client.readProjectLibrary()
    expect(library.backup).toMatchObject({ version: 3, novels: [], knowledgeBases: [], chapterRevisions: [], inspirationSessions: [], reconstructionWorkspaces: [] })
    expect(library.sync).toEqual({ state: null, conflicts: [] })
    expect(oldRead).not.toHaveBeenCalled()
    expect(oldWrite).not.toHaveBeenCalled()
    await client.initializeProjectKernel()
    expect(requests.filter(request => request.method === 'commit')).toHaveLength(1)
  })

  it('opens the authoritative project without consulting a missing or broken old database', async () => {
    const backup = await fixture()
    oldRead.mockRejectedValue(new Error('旧库已不可读'))
    const { client } = await existing(backup)
    const { loadAllNovelsFromDb } = await import('./db/novels')
    const { loadReconstructionWorkspace } = await import('./db/reconstruction')
    expect(await loadAllNovelsFromDb()).toEqual(backup.novels)
    expect(await loadReconstructionWorkspace(backup.novels[0].id)).toMatchObject({ creationDraft: backup.reconstructionWorkspaces[0].creationDraft })
    expect(client.usesProjectKernel()).toBe(true)
    expect(oldRead).not.toHaveBeenCalled()
    expect(oldWrite).not.toHaveBeenCalled()
  }, 20000)

  it('serializes manuscript and workspace writes, retaining every unloaded collection after reopening', async () => {
    const backup = await fixture()
    const { client } = await existing(backup)
    const { saveNovelToDb } = await import('./db/novels')
    const { saveReconstructionWorkspace } = await import('./db/reconstruction')
    backup.novels[0].title = '修改后的标题'
    const workspace = copy(backup.reconstructionWorkspaces[0])
    workspace.creationDraft!.contract.title = '修改后的契约'
    await Promise.all([saveNovelToDb(backup.novels[0]), saveReconstructionWorkspace(backup.novels[0].id, workspace)])
    const reopened = await createProjectKernel({ root, validateBackup })
    const saved = await reopened.read() as ProjectLibraryState
    expect(saved.backup?.novels[0].title).toBe('修改后的标题')
    expect(saved.backup?.reconstructionWorkspaces[0]).toEqual({ ...workspace, impactReports: [] })
    expect(saved.backup?.knowledgeBases).toEqual(backup.knowledgeBases)
    expect(await client.readProjectLibrary()).toEqual(saved)
    expect(oldWrite).not.toHaveBeenCalled()
  }, 20000)

  it('keeps failed author edits dirty and preserves the prior cache and disk until retry succeeds', async () => {
    const backup = await fixture()
    const { client, kernel } = await existing(backup)
    const { useNovelStore } = await import('@/stores/novel')
    const store = useNovelStore()
    await store.initStore()
    const before = await client.readProjectLibrary()
    store.updateTitle(backup.novels[0].id, '作者尚未保存的标题')
    failure = true
    await expect(store.flushPendingSaves()).rejects.toThrow('测试磁盘失败')
    expect(store.hasPendingSaves).toBe(true)
    expect(store.saveError).toContain('测试磁盘失败')
    expect(store.getNovel(backup.novels[0].id)?.title).toBe('作者尚未保存的标题')
    expect(await client.readProjectLibrary()).toEqual(before)
    expect(await kernel.read()).toEqual(before)
    failure = false
    await store.flushPendingSaves()
    expect(store.hasPendingSaves).toBe(false)
    expect((await kernel.read()).backup.novels[0].title).toBe('作者尚未保存的标题')
  }, 20000)

  it('commits cloud project content and sync state together and rejects both on failure', async () => {
    const backup = await fixture()
    const { client, kernel } = await existing(backup)
    const { persistCloudState } = await import('./db/cloudSync')
    const { emptySyncState } = await import('./cloudSyncModel')
    const before = await kernel.read()
    backup.novels[0].title = '云端合并的标题'
    const state = { ...emptySyncState(), bases: { ['novel:' + backup.novels[0].id]: { version: 2, hash: 'hash' } } }
    failure = true
    await expect(persistCloudState(state, [], backup)).rejects.toThrow('测试磁盘失败')
    expect(await kernel.read()).toEqual(before)
    expect(await client.readProjectLibrary()).toEqual(before)
    failure = false
    await persistCloudState(state, [], backup)
    const after = await kernel.read()
    expect(after.backup.novels[0].title).toBe('云端合并的标题')
    expect(after.sync.state).toEqual(state)
    expect((await kernel.history())).toHaveLength(2)
  }, 20000)

  it('rejects stale writers without replacing either their local cache or the external committed project', async () => {
    const backup = await fixture()
    const { client, kernel } = await existing(backup)
    const before = await client.readProjectLibrary()
    backup.novels[0].title = '另一个写入者'
    await kernel.commit({ baseRevision: before.revision, backup })
    await expect(client.mutateProjectLibrary(({ backup: draft }) => { draft.novels[0].title = '过期写入者' })).rejects.toMatchObject({ code: 'PROJECT_CONFLICT' })
    expect(await client.readProjectLibrary()).toEqual(before)
    expect((await kernel.read()).backup.novels[0].title).toBe('另一个写入者')
  }, 20000)

  it('never falls back to renderer SQL when the main bridge disappears', async () => {
    const { client } = await existing(await fixture())
    delete window.electronAPI!.projectRequest
    const { saveNovelToDb } = await import('./db/novels')
    await expect(saveNovelToDb((await client.readKernelBackup()).novels[0])).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' })
    expect(client.usesProjectKernel()).toBe(true)
    expect(oldWrite).not.toHaveBeenCalled()
  }, 20000)

  it('fails closed on corrupt published storage and never invokes legacy import', async () => {
    const backup = await fixture()
    const kernel = await createProjectKernel({ root, validateBackup })
    await kernel.commit({ baseRevision: null, backup })
    const names = await readdir(path.join(root, 'commits'))
    const filename = path.join(root, 'commits', names.find(name => name.endsWith('.json'))!)
    await writeFile(filename, (await readFile(filename, 'utf8')) + ' ')
    const client = await import('./projectKernelClient')
    await expect(client.initializeProjectKernel()).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
    expect(client.usesProjectKernel()).toBe(false)
    expect(oldRead).not.toHaveBeenCalled()
    expect(requests.filter(request => request.method === 'commit')).toHaveLength(0)
  }, 20000)

  it('validates main responses before replacing the cached project', async () => {
    const { client } = await existing(await fixture())
    const before = await client.readProjectLibrary()
    malformed = true
    await expect(client.mutateProjectLibrary(({ backup }) => { backup.novels[0].title = '无效回复' })).rejects.toMatchObject({ code: 'PROJECT_CORRUPT' })
    expect(await client.readProjectLibrary()).toEqual(before)
  }, 20000)

  it('persists a newly created knowledge library before its immediately bound novel', async () => {
    const { kernel } = await existing(await fixture())
    const { useNovelStore } = await import('@/stores/novel')
    const { useKnowledgeStore } = await import('@/stores/knowledge')
    const novels = useNovelStore(), knowledge = useKnowledgeStore()
    await novels.initStore(); await knowledge.initStore()
    const kb = knowledge.createKB('即建即用')
    novels.bindKnowledgeBase(novels.novels[0].id, kb.id)
    await novels.flushPendingSaves()
    const saved = await kernel.read()
    expect(saved.backup.knowledgeBases.some((row: { id: string }) => row.id === kb.id)).toBe(true)
    expect(saved.backup.novels[0].knowledgeBaseIds).toContain(kb.id)
    expect(knowledge.hasPendingSaves).toBe(false)
  }, 20000)

  it('saves a new chapter before recording its first revision without waiting for the autosave timer', async () => {
    const { kernel } = await existing(await fixture())
    const { useNovelStore } = await import('@/stores/novel')
    const store = useNovelStore()
    await store.initStore()
    const novel = store.novels[0]
    const chapter = store.addChapter(novel.id, { title: '刚刚新建', content: '作者初稿' })!
    const revision = await store.proposeChapterRevision(novel.id, chapter.id, '作者修订稿', 'user')
    const saved = await kernel.read()
    expect(saved.backup.novels[0].chapters.find((row: { id: string }) => row.id === chapter.id).content).toBe('作者初稿')
    expect(saved.backup.chapterRevisions).toEqual([revision])
    expect(revision?.baseContent).toBe('作者初稿')
  }, 20000)

  it('keeps native initialization retryable after a failed first commit', async () => {
    const client = await import('./projectKernelClient')
    failure = true
    await expect(client.initializeProjectKernel()).rejects.toThrow('测试磁盘失败')
    expect(client.usesProjectKernel()).toBe(false)
    failure = false
    await client.initializeProjectKernel()
    expect((await client.readKernelBackup()).novels).toEqual([])
    expect(oldRead).not.toHaveBeenCalled()
    expect(oldWrite).not.toHaveBeenCalled()
  })

  it('restores a deleted novel through the author-confirmed per-novel history flow', async () => {
    const backup = await fixture()
    const { client, kernel } = await existing(backup)
    const before = await client.readProjectLibrary()
    const { deleteNovelFromDb } = await import('./db/novels')
    await deleteNovelFromDb(backup.novels[0].id)
    expect((await client.readKernelBackup()).novels).toEqual([])
    const snapshotsBeforeRestore = await client.listProjectSnapshots()
    const { previewProjectHistory, restoreProjectHistory } = await import('./projectHistory')
    const preview = await previewProjectHistory(before.revision!, backup.novels[0].id)
    await restoreProjectHistory(preview.token)
    const restored = await client.readKernelBackup()
    expect(restored.novels).toHaveLength(1)
    expect(restored.novels[0]).toMatchObject({ id: backup.novels[0].id, title: backup.novels[0].title })
    expect(restored.reconstructionWorkspaces).toHaveLength(1)
    expect(restored.reconstructionWorkspaces[0]).toMatchObject({ novelId: backup.novels[0].id })
    expect((await kernel.read()).backup).toEqual(restored)
    const snapshotsAfterRestore = await client.listProjectSnapshots()
    expect(snapshotsAfterRestore.length).toBeGreaterThan(snapshotsBeforeRestore.length)
    expect((await client.readProjectLibrary()).revision).not.toBe(before.revision)
  }, 20000)

  it('unbinds deleted knowledge in open inspiration sessions before subsequent edits are saved', async () => {
    const backup = await fixture()
    const novel = backup.novels[0]
    const settingsDraft = JSON.stringify({ genre: novel.genre, subGenre: novel.subGenre, tags: novel.tags,
      targetWordCountMin: novel.targetWordCountMin, targetWordCountMax: novel.targetWordCountMax,
      writingStyle: novel.writingStyle, settings: novel.settings })
    const questions = ['主角的目标是什么？', '他会遇到什么阻力？', '故事从哪里开始？']
    backup.inspirationSessions = [{ id: 'idea', title: '灵感', updatedAt: backup.exportedAt,
      messages: [{ role: 'assistant', content: '继续聊聊主角。', questions }], knowledgeIds: ['library'], draft: '继续构思', webSearch: false, settingsDraft }]
    const { kernel } = await existing(backup)
    const { useKnowledgeStore } = await import('@/stores/knowledge')
    const { useInspirationSessionsStore } = await import('@/stores/inspirationSessions')
    const knowledge = useKnowledgeStore(), inspiration = useInspirationSessionsStore()
    await knowledge.initStore(); await inspiration.initialize()
    expect(inspiration.sessions[0].settingsDraft).toBe(settingsDraft)
    expect(inspiration.sessions[0].messages[0].questions).toEqual(questions)
    await knowledge.deleteKB('library')
    expect(inspiration.sessions[0].knowledgeIds).toEqual([])
    const edited = JSON.parse(settingsDraft)
    edited.settings.protagonist.name = '作者修改后的主角'
    inspiration.upsert({ ...inspiration.sessions[0], draft: '删除资料后继续构思', settingsDraft: JSON.stringify(edited) })
    await inspiration.flushPendingSaves()
    expect((await kernel.read()).backup.inspirationSessions[0]).toMatchObject({ knowledgeIds: [], draft: '删除资料后继续构思', settingsDraft: JSON.stringify(edited),
      messages: [{ role: 'assistant', content: '继续聊聊主角。', questions }] })
  }, 20000)
})
