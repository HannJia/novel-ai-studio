import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { CreateWizardForm } from '@/types/novel'

const require = createRequire(import.meta.url)
const { createProjectKernel } = require('../../app-main/projectKernel.cjs')
const { validateBackup } = require('../../app-main/projectKernelRpc.cjs')
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe.each(['sql', 'kernel'] as const)('initial story creation (%s)', backend => {
  let pinia: ReturnType<typeof createPinia>
  let root: string | undefined
  let failure = false
  let kernel: { commit: (request: unknown) => Promise<unknown>; read: () => Promise<any> } | undefined
  let novels: ReturnType<(typeof import('@/stores/novel'))['useNovelStore']>
  let workspace: ReturnType<(typeof import('@/stores/reconstructionWorkspace'))['useReconstructionWorkspaceStore']>
  let repository: typeof import('./storyAggregate')
  let existingId: string

  beforeEach(async () => {
    vi.resetModules()
    pinia = createPinia(); setActivePinia(pinia)
    root = undefined; failure = false; kernel = undefined
    const dbWrite = vi.fn(async () => { if (failure) throw new Error('测试磁盘失败') })
    vi.stubGlobal('window', { addEventListener: () => {}, localStorage: undefined,
      electronAPI: { dbRead: vi.fn().mockResolvedValue(null), dbWrite } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    const { characterStateFixture } = await import('@/test/characterStateFixture')
    const { createTestProjectBackup, plannedProjectWorkspace } = await import('@/test/projectBackupFixture')
    const fixture = characterStateFixture()
    const existing = copy(fixture.novel)
    existingId = existing.id
    const backup = createTestProjectBackup([existing], [], [], [], [plannedProjectWorkspace(existing)])
    if (backend === 'kernel') {
      root = await mkdtemp(path.join(os.tmpdir(), 'mojian-story-creation-'))
      kernel = await createProjectKernel({ root, validateBackup, fault: async () => {} })
      await kernel!.commit({ baseRevision: null, backup })
      window.electronAPI!.projectRequest = async (request: any) => {
        if (failure && request.method === 'commit') return { ok: false, error: { code: 'PROJECT_BUSY', message: '测试磁盘失败' } }
        try { return { ok: true, value: copy(await (request.method === 'read' ? kernel!.read() : kernel!.commit(request))) } }
        catch (error) { return { ok: false, error: { code: 'PROJECT_INVALID', message: (error as Error).message } } }
      }
      await (await import('./projectKernelClient')).initializeProjectKernel()
    } else {
      await (await import('./db/project')).replaceProjectInDb(backup)
    }
    const novelStore = await import('@/stores/novel')
    const workspaceStore = await import('@/stores/reconstructionWorkspace')
    novels = novelStore.useNovelStore(); workspace = workspaceStore.useReconstructionWorkspaceStore()
    await novels.initStore()
    repository = await import('./storyAggregate')
  })

  afterEach(async () => {
    disposePinia(pinia)
    vi.unstubAllGlobals()
    if (root) {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('mojian-story-creation-')) throw new Error('Unexpected test root')
      await rm(root, { recursive: true, force: true })
    }
  })

  function form(): CreateWizardForm {
    return { genre: 'urban', subGenre: 'business', tags: ['经商'], targetWordCountMin: 80, targetWordCountMax: 100,
      writingMode: 'manual', knowledgeEnabled: false, knowledgeBaseIds: [], writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() }
  }

  it('rolls back without publishing, retries the same aggregate, reloads it, and preserves other novels', async () => {
    const { prepareStoryCreation } = await import('./storyCreation')
    const input = form(), history = [{ role: 'user' as const, content: '一座雾中的渡口' }]
    const entry = { method: 'inspiration' as const, idea: '一座雾中的渡口', includeDiscussion: true, savedAt: '2026-10-31T00:00:00.000Z' }
    const prepared = prepareStoryCreation({ ...input, creationInput: entry }, history, 'inspiration', '2026-10-31T00:00:00.000Z', 'new-story')
    input.settings.protagonist.name = '后来修改'
    history[0].content = '后来修改'
    expect(prepared.novel.settings.protagonist.name).toBe('')
    expect(prepared.novel.inspirationHistory?.[0].content).toBe('一座雾中的渡口')
    const before = await repository.readStoryAggregate(existingId)
    failure = true
    await expect(workspace.persistInitialCreation(prepared.novel, prepared.workspace)).rejects.toThrow('测试磁盘失败')
    expect(novels.getNovel(prepared.novel.id)).toBeUndefined()
    expect((await repository.readStoryAggregate(prepared.novel.id)).novel).toBeNull()
    expect((await repository.readStoryAggregate(existingId)).novel).toEqual(before.novel)
    expect((await repository.readStoryAggregate(existingId)).workspace).toEqual(before.workspace)

    failure = false
    await workspace.persistInitialCreation(prepared.novel, prepared.workspace)
    expect(novels.getNovel(prepared.novel.id)).toBeUndefined()
    const saved = await repository.readStoryAggregate(prepared.novel.id)
    expect(saved.novel).toMatchObject({ id: 'new-story', writingMode: 'manual', inspirationHistory: [{ content: '一座雾中的渡口' }] })
    expect(saved.workspace.creationDraft?.entry).toBe('idea')
    expect(saved.workspace.creationDraft?.initialInput).toEqual(entry)
    expect((await repository.readStoryAggregate(existingId)).novel?.id).toBe(existingId)
    expect((await repository.readStoryAggregate(existingId)).workspace).toEqual(before.workspace)

    novels.publishCreatedNovel(prepared.novel)
    workspace.publishCreatedWorkspace(prepared.novel.id, prepared.workspace)
    expect(novels.getNovel(prepared.novel.id)?.id).toBe('new-story')
    expect(workspace.getCreationDraft(prepared.novel.id)?.entry).toBe('idea')
    const refreshed = await repository.readStoryAggregate(prepared.novel.id)
    expect(refreshed.workspace.creationDraft?.contract.title).toBe('未命名小说')
  })

  it('commits imported-outline and blank inputs as immutable creation sources without approvals', async () => {
    const { prepareStoryCreation } = await import('./storyCreation')
    const savedAt = '2026-11-01T08:00:00.000Z'
    const outline = { source: 'file' as const, fileName: '雾港大纲.md', format: 'md' as const, fileBytes: 42,
      originalText: '## 第一卷\n渡口失火', text: '## 第一卷\n渡口失火（作者整理）', capturedAt: '2026-11-01T07:59:00.000Z', savedAt }
    const imported = prepareStoryCreation({ ...form(), creationInput: { method: 'outline', outline, savedAt } }, [], 'outline', savedAt, 'outline-story')
    await workspace.persistInitialCreation(imported.novel, imported.workspace)
    const saved = (await repository.readStoryAggregate('outline-story')).workspace.creationDraft!
    expect(saved).toMatchObject({ entry: 'import', initialInput: { method: 'outline', outline: { text: outline.text, originalText: outline.originalText } } })
    expect(saved.approval.contract).not.toBe('approved')
    expect(saved.outlineCandidate).toBeUndefined()
    expect((await repository.readStoryAggregate('outline-story')).novel?.outline).toBe('')

    const blank = prepareStoryCreation({ ...form(), creationInput: { method: 'blank', savedAt } }, [], 'blank', savedAt, 'blank-story')
    expect(blank.novel).toMatchObject({ genre: '', tags: [], targetWordCountMin: 0 })
    await workspace.persistInitialCreation(blank.novel, blank.workspace)
    expect((await repository.readStoryAggregate('blank-story')).workspace.creationDraft).toMatchObject({ entry: 'blank', initialInput: { method: 'blank' } })

    expect(() => prepareStoryCreation({ ...form(), creationInput: { method: 'blank', savedAt } }, [], 'outline', savedAt)).toThrow('不一致')
    expect(() => prepareStoryCreation(form(), [], 'outline', savedAt)).toThrow('先保存大纲')
    expect(() => prepareStoryCreation({ ...form(), creationInput: { method: 'outline', savedAt, outline: { ...outline, savedAt: 'not-a-date' } } }, [], 'outline', savedAt)).toThrow()
  })

  it('blocks creation while project transfer is locked without writing', async () => {
    const { prepareStoryCreation } = await import('./storyCreation')
    const { projectTransferBusy } = await import('./appLifecycle')
    const prepared = prepareStoryCreation(form(), [], 'custom', '2026-10-31T00:00:00.000Z', 'locked-story')
    projectTransferBusy.value = true
    await expect(workspace.persistInitialCreation(prepared.novel, prepared.workspace)).rejects.toThrow('恢复、同步')
    projectTransferBusy.value = false
    expect((await repository.readStoryAggregate(prepared.novel.id)).novel).toBeNull()
  })
})

