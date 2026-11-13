import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, relationshipCandidate, stateTestTime } from '@/test/characterStateFixture'
import { acceptCandidateChange } from './reconstructionReview'
import { applyCandidateChangeToCanon } from './reconstructionCanon'
import { buildChapterFactCard, buildReviewContext, buildWritingContext } from './context'
import { buildSemanticRecords, queryPersistedSemanticEvidence, syncSemanticIndexForNovel } from './semanticIndex'
import type { Character } from '@/types/novel'
beforeEach(() => { setActivePinia(createPinia()) })
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const { novel } = characterStateFixture()
  novel.characters[0].relationships = [{ targetId: 'person-1', targetName: '苏禾', relation: '信任', dimension: 'trust' } as unknown as Character['relationships'][number]]
  const records = [0, 1].map(index => applyCandidateChangeToCanon(novel, acceptCandidateChange(relationshipCandidate(novel, index), stateTestTime), stateTestTime).record)
  return { novel, records }
}
describe('one relationship state across AI inputs and retrieval', () => {
  it('uses the prior chapter relationship in writer, reviewer, fact card and indexed character text', () => {
    const { novel, records } = setup(), chapter = novel.chapters[2]
    const context = buildWritingContext(novel, chapter, 20000, undefined, records)
    const review = buildReviewContext(novel, chapter, chapter.content, 20000, undefined, undefined, records)
    const card = buildChapterFactCard(novel, chapter, context)
    for (const text of [context.outlineContext, review.characters, card]) {
      expect(text).toContain('苏禾(怀疑)')
      expect(text).not.toContain('苏禾(宿敌)')
    }
    const character = buildSemanticRecords(novel, [], 2, [], records).find(row => row.sourceId === 'person-0')!
    expect(character.content).toContain('苏禾｜信任:怀疑（正文已确认）')
    expect(character.content).not.toContain('宿敌')
    expect(character.metadata!.relationshipSources).toMatchObject([{ chapterId: novel.chapters[1].id }])
    const earlier = buildReviewContext(novel, novel.chapters[1], '', 20000, undefined, undefined, records)
    expect(earlier.characters).toContain('苏禾(信任)')
    expect(earlier.characters).not.toContain('苏禾(怀疑)')
  })
  it('clears stale character relations from all current inputs without falling back to author defaults', () => {
    const { novel, records } = setup(), chapter = novel.chapters[2]
    const before = buildWritingContext(novel, chapter, 20000, undefined, records)
    novel.chapters[1].content = novel.chapters[1].content.replace('怀疑', '依赖')
    const after = buildWritingContext(novel, chapter, 20000, undefined, records)
    expect(after).not.toBe(before)
    const review = buildReviewContext(novel, chapter, '', 20000, undefined, undefined, records)
    expect(review.characters).not.toMatch(/苏禾\((怀疑|宿敌|信任)\)/)
    expect(after.structuredState).toContain('待重新审核')
    const character = buildSemanticRecords(novel, [], 2, [], records).find(row => row.sourceId === 'person-0')!
    expect(character.content).not.toContain('苏禾:')
  })
  it('rejects outdated cached relationship vectors and reads current Canon before ranking', async () => {
    const memory = new Map<string, string>()
    vi.stubGlobal('window', { electronAPI: undefined })
    vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) })
    const { novel, records } = setup()
    let current = records.slice(0, 1)
    const source = () => ({ novel, knowledgeBases: [], canonMutations: current })
    await syncSemanticIndexForNovel(source)
    current = records
    const result = await queryPersistedSemanticEvidence(source, '林澈苏禾关系', 8, undefined, 'character', 2)
    const character = result.find(row => row.sourceId === 'person-0')!
    expect(character.content).toContain('苏禾｜信任:怀疑')
    expect(character.content).not.toContain('苏禾｜信任:信任')
    expect(character.retrieval).toMatchObject({ method: 'local', indexed: false })
  })

  it('keeps an explicitly unclassified author relationship visible as labeled context', () => {
    const { novel, records } = setup()
    novel.characters[0].relationships = [{ targetId: 'person-1', targetName: '苏禾', relation: '宿敌', dimension: 'unclassified' }]
    const chapter = novel.chapters[2]
    const writing = buildWritingContext(novel, chapter, 20000, undefined, records)
    const review = buildReviewContext(novel, chapter, chapter.content, 20000, undefined, undefined, records)
    const character = buildSemanticRecords(novel, [], 2, [], records).find(row => row.sourceId === 'person-0')!
    expect(review.characters).toContain('苏禾(宿敌)')
    expect(writing.semanticEvidence).toContain('待分类:宿敌（作者基础设定）')
    expect(character.content).toContain('待分类:宿敌（作者基础设定）')
  })
})
