import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReconstructionWorkspaceStore } from './reconstructionWorkspace'
import { characterStateFixture, knowledgeCandidate, relationshipCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { loadReconstructionWorkspace, saveReconstructionWorkspace } from '@/services/db/reconstruction'
import { getCharacterStateSnapshot } from '@/services/reconstructionCharacterState'
import { clearNovelRows } from '@/services/db/novels'
import { initDb, runTransaction } from '@/services/database'

const diskWrite = vi.fn().mockResolvedValue(undefined)
beforeEach(async () => {
  setActivePinia(createPinia())
  diskWrite.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', { electronAPI: { dbRead: vi.fn().mockResolvedValue(null), dbWrite: diskWrite } })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  // These transactions now also persist the novel, so each test needs a fresh
  // synthetic shelf rather than reusing entity IDs from the previous test.
  await initDb()
  await runTransaction(clearNovelRows)
})

describe('atomic character-state acceptance', () => {
  it('saves scanned relations atomically as candidates, retries failed storage, and never publishes a Canon decision', async () => {
    const { novel, store: novels } = characterStateFixture(), store = useReconstructionWorkspaceStore()
    await novels.saveNovelNow(novel.id)
    const candidate = relationshipCandidate(novel, 0), chapter = novel.chapters[0]
    const save = () => store.saveRelationshipCandidates(novel.id, chapter.id, buildAnalysisSourceVersionId(chapter.content), JSON.stringify(novel.characters), [candidate])
    diskWrite.mockRejectedValueOnce(new Error('模拟磁盘写入失败'))
    await expect(save()).rejects.toThrow('模拟磁盘')
    expect(store.getCandidates(novel.id)).toEqual([])
    expect((await loadReconstructionWorkspace(novel.id)).candidates).toEqual([])
    expect(await save()).toBe(1)
    expect(await save()).toBe(0)
    store.clearNovel(novel.id)
    await store.hydrateFromPersistence(novel.id)
    expect(store.getCandidates(novel.id)).toHaveLength(1)
    expect(store.getCandidates(novel.id)[0].status).toBe('proposed')
    expect(store.getCanonMutations(novel.id)).toEqual([])
    expect(novel.characters[0].relationships).toEqual([])
  })
  it('refuses a scan saved after equal-length source or character edits', async () => {
    const { novel } = characterStateFixture(), store = useReconstructionWorkspaceStore()
    const candidate = relationshipCandidate(novel, 0), chapter = novel.chapters[0], baseline = JSON.stringify(novel.characters)
    const source = buildAnalysisSourceVersionId(chapter.content)
    chapter.content = chapter.content.replace('信任', '怀疑')
    await expect(store.saveRelationshipCandidates(novel.id, chapter.id, source, baseline, [candidate])).rejects.toThrow('已变化')
    chapter.content = chapter.content.replace('怀疑', '信任'); novel.characters[0].name = '林青'
    await expect(store.saveRelationshipCandidates(novel.id, chapter.id, source, baseline, [candidate])).rejects.toThrow('已变化')
    expect(store.getCandidates(novel.id)).toEqual([])
  })
  it('persists the author decision and full evidence history and restores them together', async () => {
    const { novel } = characterStateFixture(), store = useReconstructionWorkspaceStore()
    const candidate = knowledgeCandidate(novel, 0)
    store.addCandidateChanges(novel.id, [candidate])
    await store.persistToDatabase(novel.id)
    await store.acceptCharacterStateCandidate(novel, candidate.id, now)
    store.clearNovel(novel.id)
    await store.hydrateFromPersistence(novel.id)
    expect(store.getCandidates(novel.id)[0].status).toBe('accepted')
    const state = getCharacterStateSnapshot(novel, store.getCanonMutations(novel.id), 1)
    expect(state.knowledge[0]).toMatchObject({ state: 'false_belief', belief: '城主已经死了', evidence: candidate.evidence })
  })

  it('restores the database and keeps the in-memory candidate pending when writing fails', async () => {
    const { novel } = characterStateFixture(), store = useReconstructionWorkspaceStore()
    const candidate = knowledgeCandidate(novel, 0)
    store.addCandidateChanges(novel.id, [candidate])
    await store.persistToDatabase(novel.id)
    diskWrite.mockRejectedValueOnce(new Error('模拟磁盘写入失败'))
    await expect(store.acceptCharacterStateCandidate(novel, candidate.id, now)).rejects.toThrow('模拟磁盘')
    expect(store.getCandidates(novel.id)[0].status).toBe('proposed')
    expect(store.getCanonMutations(novel.id)).toEqual([])
    const stored = await loadReconstructionWorkspace(novel.id)
    expect(stored.candidates[0].status).toBe('proposed')
    expect(stored.canonMutations).toEqual([])
    await store.acceptCharacterStateCandidate(novel, candidate.id, now)
    expect(store.getCanonMutations(novel.id)).toHaveLength(1)
  })

  it('serializes duplicate confirmations and ordinary saves without losing the accepted state', async () => {
    const { novel } = characterStateFixture(), store = useReconstructionWorkspaceStore()
    const candidate = knowledgeCandidate(novel, 0)
    store.addCandidateChanges(novel.id, [candidate])
    await Promise.all([store.acceptCharacterStateCandidate(novel, candidate.id, now), store.persistToDatabase(novel.id),
      store.acceptCharacterStateCandidate(novel, candidate.id, now)])
    const stored = await loadReconstructionWorkspace(novel.id)
    expect(stored.candidates[0].status).toBe('accepted')
    expect(stored.canonMutations).toHaveLength(1)
  })

  it('retains same-wording propositions as separate histories across database round trips', async () => {
    const { novel } = characterStateFixture(), store = useReconstructionWorkspaceStore()
    const first = knowledgeCandidate(novel, 0), second = knowledgeCandidate(novel, 1)
    store.addCandidateChanges(novel.id, [first, second])
    await store.acceptCharacterStateCandidate(novel, first.id, now)
    await store.acceptCharacterStateCandidate(novel, second.id, now)
    const stored = await loadReconstructionWorkspace(novel.id)
    expect(stored.canonMutations[1].characterState?.before).toBeUndefined()
    expect(getCharacterStateSnapshot(novel, stored.canonMutations, 1).knowledge[0].state).toBe('false_belief')
    const states = getCharacterStateSnapshot(novel, stored.canonMutations, 2).knowledge
    expect(states).toHaveLength(2)
    expect(states).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: 'false_belief', belief: '城主已经死了' }),
      expect.objectContaining({ state: 'knows' }),
    ]))
    expect(states.every(state => !!state.conflictGroupId)).toBe(true)
    await saveReconstructionWorkspace(novel.id, stored)
    const restored = getCharacterStateSnapshot(novel, (await loadReconstructionWorkspace(novel.id)).canonMutations, 2).knowledge
    expect(restored.map(state => state.state).sort()).toEqual(['false_belief', 'knows'])
  })
})
