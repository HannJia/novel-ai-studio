import { describe, expect, it } from 'vitest'
import type { Character, Chapter, Novel } from '@/types/novel'
import type { CanonMutationRecord, CharacterRelationshipState, EvidenceRef } from '@/types/reconstruction'
import { captureEntityRevision } from './entityProvenance'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { withCurrentStoryEntities } from './effectiveStory'
import { getRelationshipProjection } from './relationshipProjection'

const now = '2026-10-30T00:00:00.000Z'

function character(id: string, name = id, firstAppearChapter = 0, relationships: Character['relationships'] = []): Character {
  return {
    id, name, aliases: [], identity: '', personality: '', powerLevel: '', faction: '', status: '活跃',
    firstAppearChapter, description: '', relationships, events: [], avatarColor: '',
  }
}

function chapter(id: string, chapterIndex: number, content: string): Chapter {
  return {
    id, chapterIndex, content, title: id, volumeIndex: 0, summary: '', wordCount: content.length,
    status: 'completed', createdAt: now, updatedAt: now,
  }
}

function novel(characters: Character[], chapters: Chapter[] = []): Novel {
  return {
    id: 'novel-1', title: '测试', genre: '', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [],
    targetWordCountMin: 1, targetWordCountMax: 1, currentWordCount: 0,
    writingStyle: {} as Novel['writingStyle'], settings: {} as Novel['settings'], outline: '', synopsis: '',
    volumes: [], chapters, characters, chatHistory: [], knowledgeBaseIds: [], eventLog: [], storyArcs: [],
    dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: now, updatedAt: now,
  }
}

function evidenceFor(sourceChapter: Chapter, quote = sourceChapter.content): EvidenceRef {
  const startOffset = sourceChapter.content.indexOf(quote)
  return {
    id: 'evidence-' + sourceChapter.id,
    sourceType: 'chapter',
    sourceId: sourceChapter.id,
    sourceVersionId: buildAnalysisSourceVersionId(sourceChapter.content),
    quote,
    startOffset,
    endOffset: startOffset + quote.length,
  }
}

function relationshipRecord(
  sourceNovel: Novel,
  chapterId: string,
  characterId: string,
  targetCharacterId: string,
  relation: string,
  appliedAt = now,
  description = '',
): CanonMutationRecord {
  const sourceChapter = sourceNovel.chapters.find(item => item.id === chapterId)!
  const evidence = [evidenceFor(sourceChapter)]
  const after: CharacterRelationshipState = {
    id: 'state-' + chapterId + '-' + appliedAt,
    characterId,
    targetCharacterId,
    relation,
    description,
    sinceChapter: sourceChapter.chapterIndex,
    evidence,
  }
  return {
    id: 'record-' + chapterId + '-' + appliedAt,
    candidateId: 'candidate-' + chapterId + '-' + appliedAt,
    novelId: sourceNovel.id,
    chapterId,
    type: 'relationship',
    summary: relation,
    appliedAt,
    characterState: { kind: 'relationship', after },
  }
}

describe('getRelationshipProjection', () => {
  it('resolves explicit IDs and unique names, rejects bad IDs and ambiguity, and keeps directed author edges', () => {
    const people = [
      character('a', '甲', 0, [
        { targetId: 'b', targetName: '旧乙名', relation: '同事' },
        { targetId: 'missing', targetName: '乙', relation: '错误 ID' },
        { targetId: '', targetName: '乙', relation: '协作' },
        { targetId: 'a', targetName: '甲', relation: '自关系' },
      ]),
      character('b', '乙', 0, [
        { targetId: 'a', targetName: '甲', relation: '警惕' },
        { targetId: '', targetName: '甲', relation: '同向另一条' },
      ]),
    ]
    const result = getRelationshipProjection(novel(people), [])
    expect(result.invalid).toEqual([])
    expect(result.edges.map(edge => [edge.source.id, edge.target.id, edge.relation])).toEqual([
      ['a', 'b', '同事'], ['a', 'b', '协作'], ['b', 'a', '警惕'], ['b', 'a', '同向另一条'],
    ])
  })

  it('uses first appearance and canonical provenance at before and through boundaries without mutating input', () => {
    const characters = [
      character('a', '甲', 0, [{ targetId: 'b', targetName: '乙', relation: '同伴' }]),
      character('b', '乙', 1),
    ]
    const source = novel(characters, [chapter('c0', 0, '第一章'), chapter('c1', 1, '第二章')])
    const before = JSON.parse(JSON.stringify(source))
    expect(getRelationshipProjection(source, [], 1, 'before').edges).toEqual([])
    expect(getRelationshipProjection(source, [], 1, 'through').edges.map(edge => edge.target.id)).toEqual(['b'])
    expect(source).toEqual(before)
  })

  it('applies earlier and later chapter changes by direction, preserving reverse direction and replacing all base edges', () => {
    const source = novel([
      character('a', '甲', 0, [
        { targetId: 'b', targetName: '乙', relation: '作者关系一' },
        { targetId: 'b', targetName: '乙', relation: '作者关系二' },
        { targetId: 'c', targetName: '丙', relation: '另一对象' },
      ]),
      character('b', '乙', 0, [{ targetId: 'a', targetName: '甲', relation: '反向作者关系' }]),
      character('c', '丙'),
    ], [chapter('c0', 0, '甲在第一章确认。'), chapter('c1', 1, '甲在第二章改变。')])
    const first = relationshipRecord(source, 'c0', 'a', 'b', '第一章关系', now, '第一章描述')
    const later = relationshipRecord(source, 'c1', 'a', 'b', '第二章关系', '2026-10-30T00:01:00.000Z', '第二章描述')
    const beforeSecondChapter = getRelationshipProjection(source, [later, first], 1, 'before')
    expect(beforeSecondChapter.edges.map(edge => edge.relation)).toContain('第一章关系')
    const result = getRelationshipProjection(source, [later, first], 1)
    expect(result.edges.map(edge => [edge.source.id, edge.target.id, edge.relation, edge.origin])).toEqual(expect.arrayContaining([
      ['a', 'c', '另一对象', 'author'],
      ['b', 'a', '反向作者关系', 'author'],
      ['a', 'b', '第二章关系', 'chapter'],
    ]))
    expect(result.edges).toHaveLength(3)
    const chapterEdge = result.edges.find(edge => edge.origin === 'chapter')!
    expect(chapterEdge).toMatchObject({ description: '第二章描述', chapterId: 'c1' })
    expect(chapterEdge.evidence[0]).not.toBe(later.characterState!.after.evidence[0])
    expect(source.characters[0].relationships).toHaveLength(3)
  })

  it('uses the latest invalid change to hide the direction and reports it without falling back', () => {
    const sourceChapter = chapter('c0', 0, '甲信任乙。')
    const source = novel([
      character('a', '甲', 0, [{ targetId: 'b', targetName: '乙', relation: '作者旧关系' }]),
      character('b', '乙'),
    ], [sourceChapter])
    const old = relationshipRecord(source, 'c0', 'a', 'b', '章节旧关系', now)
    const latest = relationshipRecord(source, 'c0', 'a', 'b', '章节新关系', '2026-10-30T00:01:00.000Z')
    sourceChapter.content = '甲怀疑乙。' // same length, so this exercises version invalidation rather than chapter deletion.
    const result = getRelationshipProjection(source, [old, latest])
    expect(result.edges).toEqual([])
    expect(result.invalid).toHaveLength(1)
    expect(result.invalid[0].record).toBe(latest)
    expect(result.invalid[0].issue).toContain('来源正文')
  })

  it('reports a relationship whose source role is unavailable at its source chapter and hides its author edge', () => {
    const sourceChapter = chapter('c1', 1, '甲在此章出现关系。')
    const trackedSource = character('a', '甲', 0, [{ targetId: 'b', targetName: '乙', relation: '作者关系' }])
    trackedSource.provenance = {
      revisions: [captureEntityRevision(
        'character', undefined, trackedSource,
        { kind: 'chapter', chapterId: 'c1', chapterIndex: 1, sourceVersionId: buildAnalysisSourceVersionId(sourceChapter.content), evidence: [{ quote: '不存在的引文' }] },
        now, 'character-create',
      )],
    }
    const source = novel([
      trackedSource,
      character('b', '乙', 0),
    ], [sourceChapter])
    const record = relationshipRecord(source, 'c1', 'a', 'b', '章节关系')
    const result = getRelationshipProjection(source, [record])
    expect(result.edges).toEqual([])
    expect(result.invalid).toMatchObject([{ record, issue: '关联角色来源失效或在该章尚未出现' }])
  })

  it('works from a projected novel, shows author relationships with no chapters, and uses the last chapter for state', () => {
    const noChapters = novel([character('a', '甲', 0, [{ targetId: 'b', targetName: '乙', relation: '作者关系' }]), character('b', '乙')])
    expect(getRelationshipProjection(noChapters, []).edges[0]).toMatchObject({ origin: 'author', relation: '作者关系' })

    const source = novel([
      character('a', '甲', 0, [{ targetId: 'b', targetName: '乙', relation: '作者关系' }]),
      character('b', '乙'),
    ], [chapter('c0', 0, '甲信任乙。'), chapter('c1', 1, '甲怀疑乙。')])
    const later = relationshipRecord(source, 'c1', 'a', 'b', '章节最终关系')
    const projected = withCurrentStoryEntities(source, 2)
    const result = getRelationshipProjection(projected, [later])
    expect(result.edges).toMatchObject([{ source: { id: 'a' }, target: { id: 'b' }, relation: '章节最终关系', origin: 'chapter' }])
    expect(source.characters[0].relationships[0].relation).toBe('作者关系')
  })

  it('drops deleted targets and ambiguous name-only relationships', () => {
    const source = novel([
      character('a', '甲', 0, [
        { targetId: 'deleted', targetName: '乙', relation: '目标已删' },
        { targetId: '', targetName: '乙', relation: '同名不确定' },
      ]),
      character('b1', '乙'),
      character('b2', '乙'),
    ])
    const result = getRelationshipProjection(source, [])
    expect(result.edges).toEqual([])
  })
})
