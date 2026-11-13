import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import { appendEntityRevision, captureEntityRevision } from './entityProvenance'
import { withCurrentStoryEntities, formatEntitySourceWarnings } from './effectiveStory'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildWritingContext, buildReviewContext, selectRelevantCharacters } from './context'
import { buildSemanticRecords } from './semanticIndex'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { scanContinuity } from './continuity'
import { applyCandidateChangeToCanon } from './reconstructionCanon'

beforeEach(() => setActivePinia(createPinia()))
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function fixture() {
  const { novel } = characterStateFixture()
  const character = novel.characters[0]
  character.identity = '普通旅人'; character.personality = '谨慎'; character.faction = '北城'
  appendEntityRevision(character, captureEntityRevision('character', undefined, character, { kind: 'author' }, now, 'baseline'))
  const before = copy(character), chapter = novel.chapters[1]
  character.identity = '秘密调查员'; character.status = '死亡'
  appendEntityRevision(character, captureEntityRevision('character', before, character, { kind: 'chapter',
    chapterId: chapter.id, chapterIndex: chapter.chapterIndex, sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    evidence: [{ quote: chapter.content, startOffset: 0, endOffset: chapter.content.length }] }, now, 'chapter-change', ['identity', 'status']))
  return { novel, character, chapter }
}
function entityText(novel: ReturnType<typeof fixture>['novel'], boundary: number) {
  return buildSemanticRecords(novel, [], boundary).filter(record => record.sourceType === 'character').map(record => record.content).join('\n')
}

describe('entity history in AI contexts', () => {
  it('uses the earlier identity in writing, review and retrieval without leaking later status', () => {
    const { novel, chapter } = fixture()
    expect(entityText(novel, 1)).toContain('普通旅人')
    expect(entityText(novel, 1)).not.toContain('秘密调查员')
    expect(entityText(novel, 2)).toContain('秘密调查员')
    const writing = buildWritingContext(novel, chapter)
    expect(writing.outlineContext).toContain('普通旅人')
    expect(JSON.stringify(buildReviewContext(novel, chapter, chapter.content))).not.toContain('秘密调查员')
    expect(scanContinuity(novel, chapter, '林澈走进城门。').some(item => item.title.includes('状态冲突'))).toBe(false)
    expect(scanContinuity(novel, novel.chapters[2], '林澈走进城门。').some(item => item.title.includes('状态冲突'))).toBe(true)
    expect(formatEntitySourceWarnings(novel, 1)).toBe('')
  })
  it('invalidates a field after a source edit but preserves unrelated identity details and cache correctness', () => {
    const { novel, chapter } = fixture(), later = novel.chapters[2]
    const signature = buildReviewContextVersion(novel, later)
    buildWritingContext(novel, later)
    chapter.content += '作者改写了这一段。'
    const projected = withCurrentStoryEntities(novel, 2)
    expect(projected.characters[0]).toMatchObject({ identity: '', personality: '谨慎', faction: '北城', status: '待核对' })
    expect(selectRelevantCharacters(projected, '林澈')).toContainEqual(expect.objectContaining({ name: '林澈' }))
    expect(buildReviewContextVersion(novel, later)).not.toBe(signature)
    expect(entityText(novel, 2)).not.toContain('秘密调查员')
    const writing = buildWritingContext(novel, later)
    expect(writing.outlineContext).toContain('谨慎')
    expect(writing.outlineContext).not.toContain('普通旅人')
    expect(writing.structuredState).toContain('需要作者核对')
  })
  it('can widen a nested chapter view without permanently losing future-created entities', () => {
    const { novel, chapter } = fixture()
    const version = buildAnalysisSourceVersionId(chapter.content)
    applyCandidateChangeToCanon(novel, { id: 'new-person', novelId: novel.id, chapterId: chapter.id, type: 'fact',
      proposedValue: JSON.stringify({ kind: 'character', name: '城门守卫', identity: '禁军' }), sourceVersionId: version,
      evidence: [{ id: 'q', sourceType: 'chapter', sourceId: chapter.id, sourceVersionId: version, quote: chapter.content }],
      status: 'accepted', createdAt: now, updatedAt: now }, now)
    const early = withCurrentStoryEntities(novel, 1)
    expect(early.characters.some(item => item.name === '城门守卫')).toBe(false)
    expect(withCurrentStoryEntities(early, 2).characters.some(item => item.name === '城门守卫')).toBe(true)
    expect(withCurrentStoryEntities(withCurrentStoryEntities(novel, 2), 1)).toEqual(early)
    expect(novel.characters[0].identity).toBe('秘密调查员')
  })
})
