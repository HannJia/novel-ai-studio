import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, knowledgeCandidate, relationshipCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import { acceptCandidateChange } from './reconstructionReview'
import { applyCandidateChangeToCanon } from './reconstructionCanon'
import { characterStateEvidenceIssue, formatCharacterStateContext, getCharacterStateHistory, getCharacterStateProjection, getCharacterStateSnapshot, getPropositionCatalog } from './reconstructionCharacterState'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { captureEntityRevision } from './entityProvenance'
import { buildReviewContext, buildWritingContext, buildChapterFactCard } from './context'
import { buildReviewContextVersion } from './reconstructionReviewVersion'
import { buildWritingAdvicePrompt } from './writingAdvisor'
import type { CanonMutationRecord } from '@/types/reconstruction'

beforeEach(() => setActivePinia(createPinia()))

function acceptLinkedKnowledge(novel: ReturnType<typeof characterStateFixture>['novel'], candidate: ReturnType<typeof knowledgeCandidate>, now: string, records: CanonMutationRecord[]) {
  const chapterIndex = novel.chapters.find(chapter => chapter.id === candidate.chapterId)?.chapterIndex
  if (chapterIndex === undefined) throw new Error('候选章节不存在')
  const fact = JSON.parse(candidate.proposedValue).fact as string
  const target = getPropositionCatalog(novel, records, chapterIndex).find(entry => entry.proposition.text === fact)
  if (!target) throw new Error('没有可供作者明确引用的既有命题')
  return applyCandidateChangeToCanon(novel, candidate, now, records, {
    action: 'link', confirmed: true, targetId: target.proposition.id, targetSignature: target.signature,
  }).record
}

describe('chapter-bound character knowledge and relationships', () => {
  it('keeps beliefs separate from facts and restores the state before a later revelation', () => {
    const { novel } = characterStateFixture()
    const first = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    const later = acceptLinkedKnowledge(novel, acceptCandidateChange(knowledgeCandidate(novel, 1), now), now, [first])
    const records = [later, first]
    expect(getCharacterStateSnapshot(novel, records, 0).knowledge).toEqual([])
    expect(getCharacterStateSnapshot(novel, records, 1).knowledge[0]).toMatchObject({ state: 'false_belief', belief: '城主已经死了' })
    expect(getCharacterStateSnapshot(novel, records, 2).knowledge[0]).toMatchObject({ state: 'knows', belief: undefined, learnedFrom: '苏禾出示的书信' })
    expect(later.characterState?.before).toMatchObject({ state: 'false_belief' })
    expect(formatCharacterStateContext(novel, records, 0)).not.toContain('苏禾出示的书信')
    expect(formatCharacterStateContext(novel, records, 1)).toContain('仅从引文处生效，不可提前')
    expect(novel.eventLog).toEqual([])
  })

  it.each(['knows', 'suspects', 'does_not_know', 'false_belief'])('retains the approved epistemic state %s', state => {
    const { novel } = characterStateFixture()
    const record = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0, { state }), now), now).record
    expect(getCharacterStateSnapshot(novel, [record], 1).knowledge[0].state).toBe(state)
  })

  it('requires author approval, a real character, and an explicit false belief', () => {
    const { novel } = characterStateFixture()
    expect(() => applyCandidateChangeToCanon(novel, knowledgeCandidate(novel, 0), now)).toThrow('作者确认')
    for (const overrides of [{ characterId: 'missing' }, { characterName: '苏禾' }, { state: 'invented' }, { belief: '' }]) {
      expect(() => applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0, overrides), now), now)).toThrow()
    }
    novel.characters[1].aliases = ['林澈']
    expect(() => applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0, { characterId: '' }), now), now)).toThrow('歧义')
  })

  it('requires exact source quotes and versions and rejects forged evidence offsets', () => {
    const { novel } = characterStateFixture()
    const candidate = acceptCandidateChange(knowledgeCandidate(novel, 0), now)
    for (const evidence of [[], [{ ...candidate.evidence[0], quote: '' }], [{ ...candidate.evidence[0], sourceId: 'missing' }],
      [{ ...candidate.evidence[0], startOffset: 9 }], [{ ...candidate.evidence[0], sourceVersionId: undefined }]]) {
      expect(() => applyCandidateChangeToCanon(novel, { ...candidate, evidence }, now)).toThrow()
    }
    novel.chapters[0].content += '正文修改。'
    expect(() => applyCandidateChangeToCanon(novel, candidate, now)).toThrow('正文已经变化')
  })

  it('invalidates revised, deleted and reordered evidence without resurrecting an older state', () => {
    const { novel } = characterStateFixture()
    const first = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    const later = acceptLinkedKnowledge(novel, acceptCandidateChange(knowledgeCandidate(novel, 1), now), now, [first])
    novel.chapters[1].content += '正文修改。'
    const state = getCharacterStateSnapshot(novel, [first, later], 2)
    expect(state.knowledge).toEqual([])
    expect(state.invalid[0].issue).toContain('来源正文')
    expect(getCharacterStateHistory(novel, [first, later], 2)).toHaveLength(2)
    expect(getCharacterStateSnapshot(novel, [first, later], 1).knowledge[0].state).toBe('false_belief')
    novel.chapters[1].chapterIndex = 5
    expect(characterStateEvidenceIssue(novel, later)).toContain('顺序')
    novel.chapters.splice(1, 1)
    expect(characterStateEvidenceIssue(novel, later)).toContain('删除')
  })

  it('matches the separate public projections and rebuilds after same-object source and role changes', () => {
    const { novel } = characterStateFixture()
    const record = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    const records = [record]
    const compare = () => {
      const combined = getCharacterStateProjection(novel, records, 1, 'through')
      expect(combined.history).toEqual(getCharacterStateHistory(novel, records, 1, 'through'))
      expect(combined.catalog).toEqual(getPropositionCatalog(novel, records, 1, 'through'))
      expect(combined.snapshot).toEqual(getCharacterStateSnapshot(novel, records, 1, 'through'))
      return combined
    }

    expect(compare().snapshot.knowledge).toHaveLength(1)
    novel.chapters[0].content += '正文修改。'
    expect(compare().snapshot.invalid[0].issue).toContain('来源正文')

    novel.chapters[0].content = novel.chapters[0].content.replace('正文修改。', '')
    novel.chapters[0].chapterIndex = 5
    expect(compare().history[0].issue).toContain('顺序')

    novel.chapters.splice(0, 1)
    expect(compare().history[0].issue).toContain('删除')

    const replacement = characterStateFixture()
    const replacementRecord = applyCandidateChangeToCanon(replacement.novel, acceptCandidateChange(knowledgeCandidate(replacement.novel, 0), now), now).record
    const tracked = replacement.novel.characters[0]
    tracked.provenance = { revisions: [captureEntityRevision('character', undefined, tracked, {
      kind: 'chapter', chapterId: replacement.novel.chapters[0].id, chapterIndex: 0,
      sourceVersionId: buildAnalysisSourceVersionId(replacement.novel.chapters[0].content), evidence: [{ quote: '不存在的引文' }],
    }, now, 'invalid-character-source')] }
    const invalidRole = getCharacterStateProjection(replacement.novel, [replacementRecord], 1, 'through')
    expect(invalidRole.history[0].issue).toContain('角色来源失效')
    expect(invalidRole.snapshot.knowledge).toEqual([])
  })

  it('records relationship direction and history without overwriting timeless character fields', () => {
    const { novel } = characterStateFixture()
    const first = applyCandidateChangeToCanon(novel, acceptCandidateChange(relationshipCandidate(novel, 0), now), now).record
    const later = applyCandidateChangeToCanon(novel, acceptCandidateChange(relationshipCandidate(novel, 1), now), now, [first]).record
    expect(getCharacterStateSnapshot(novel, [later, first], 1).relationships).toMatchObject([{ characterId: 'person-0', targetCharacterId: 'person-1', relation: '信任' }])
    expect(getCharacterStateSnapshot(novel, [later, first], 2).relationships).toMatchObject([{ relation: '怀疑' }])
    expect(later.characterState?.before).toMatchObject({ relation: '信任' })
    expect(novel.characters.flatMap(character => character.relationships)).toEqual([])
    expect(() => applyCandidateChangeToCanon(novel, acceptCandidateChange(relationshipCandidate(novel, 0, { targetCharacterId: 'person-0' }), now), now)).toThrow('同一角色')
  })

  it('applies the same candidate once and isolates novels', () => {
    const { novel } = characterStateFixture()
    const candidate = acceptCandidateChange(knowledgeCandidate(novel, 0), now)
    const first = applyCandidateChangeToCanon(novel, candidate, now).record
    expect(applyCandidateChangeToCanon(novel, candidate, now, [first]).changed).toBe(false)
    expect(getCharacterStateSnapshot(novel, [{ ...first, novelId: 'another-book' }], 1).knowledge).toEqual([])
    expect(() => applyCandidateChangeToCanon({ ...novel, id: 'other-book' }, candidate, now)).toThrow('不属于')
  })

  it('keeps conflicting same-wording states separate when later evidence is confirmed first', () => {
    const { novel } = characterStateFixture()
    novel.chapters[0].content = '林澈不知道城主的下落。苏禾出示书信，林澈得知城主仍然在世。'
    const later = { ...knowledgeCandidate(novel, 0, { state: 'knows', evidence: '苏禾出示书信，林澈得知城主仍然在世。' }), id: 'later-scene' }
    const earlier = { ...knowledgeCandidate(novel, 0, { state: 'does_not_know', evidence: '林澈不知道城主的下落。' }), id: 'earlier-scene' }
    const afterRecord = applyCandidateChangeToCanon(novel, acceptCandidateChange(later, now), now).record
    const beforeRecord = applyCandidateChangeToCanon(novel, acceptCandidateChange(earlier, now), '2026-10-27T05:01:00.000Z', [afterRecord]).record
    const snapshot = getCharacterStateSnapshot(novel, [afterRecord, beforeRecord], 1)
    expect(snapshot.knowledge.map(state => state.state).sort()).toEqual(['does_not_know', 'knows'])
    expect(snapshot.knowledge.every(state => !!state.conflictGroupId)).toBe(true)
    expect(beforeRecord.characterState?.before).toBeUndefined()
  })

  it('keeps stale evidence visible in history while accepting new evidence as a separate proposition', () => {
    const { novel } = characterStateFixture()
    novel.chapters[0].content = '雨在街上落下。林澈以为城主已经死了。'
    const original = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    novel.chapters[0].content = '林澈已经知道城主在世。'
    const replacement = knowledgeCandidate(novel, 0, { state: 'knows', evidence: novel.chapters[0].content })
    const record = applyCandidateChangeToCanon(novel, acceptCandidateChange(replacement, now), '2026-10-27T05:02:00.000Z', [original]).record
    const snapshot = getCharacterStateSnapshot(novel, [original, record], 1)
    expect(snapshot.invalid).toMatchObject([{ record: original, issue: expect.stringContaining('变化') }])
    expect(snapshot.knowledge).toMatchObject([{ state: 'knows', evidence: [{ quote: '林澈已经知道城主在世。' }] }])
    expect(getCharacterStateHistory(novel, [original, record], 1)[1].issue).toContain('变化')
  })

  it('feeds author-approved state into writing, review, advice and cache signatures', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[1]
    const empty = buildWritingContext(novel, chapter)
    const version = buildReviewContextVersion(novel, chapter)
    const record = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now).record
    const records: CanonMutationRecord[] = [record]
    const context = buildWritingContext(novel, chapter, undefined, undefined, records)
    expect(context).not.toBe(empty)
    expect(context.structuredState).toContain('错误信念')
    expect(buildChapterFactCard(novel, chapter, context)).toContain('不代表客观事实')
    expect(buildReviewContext(novel, chapter, chapter.content, undefined, undefined, undefined, records).structuredState).toContain('城主已经死了')
    expect(buildWritingAdvicePrompt(novel, chapter, '', 'scene', context)[1].content).toContain('按章节还原的人物状态与约束')
    expect(buildReviewContextVersion(novel, chapter, [], undefined, records)).not.toBe(version)
    novel.chapters[0].content += '改稿。'
    expect(buildWritingContext(novel, chapter, undefined, undefined, records).structuredState).toContain('待重新审核')
  })

  it('does not recall future manuscript evidence while reviewing an earlier chapter', () => {
    const { novel } = characterStateFixture()
    novel.chapters[0].title = '苏禾与书信'
    const early = buildWritingContext(novel, novel.chapters[0])
    expect(early.semanticEvidence).not.toContain('城主仍然在世')
    expect(early.semanticEvidence).not.toContain('书信')
    const later = buildWritingContext(novel, novel.chapters[2])
    novel.chapters[1].content = novel.chapters[1].content.replace('城主仍然在世', '城主已经失踪')
    expect(buildWritingContext(novel, novel.chapters[2])).not.toBe(later)
  })

  it('refuses ambiguous repeated quotes rather than assigning the first occurrence', () => {
    const { novel } = characterStateFixture()
    novel.chapters[0].content += '林澈以为城主已经死了。'
    const candidate = knowledgeCandidate(novel, 0)
    expect(candidate.evidence).toEqual([])
    expect(() => acceptCandidateChange(candidate, now)).toThrow('证据')
  })

  it('distinguishes corrected analysis of the same manuscript from the earlier candidate', () => {
    const { novel } = characterStateFixture()
    const old = knowledgeCandidate(novel, 0, { state: 'knows' })
    const corrected = knowledgeCandidate(novel, 0, { state: 'false_belief' })
    expect(old.sourceVersionId).toBe(corrected.sourceVersionId)
    expect(old.id).not.toBe(corrected.id)
    expect(knowledgeCandidate(novel, 0).id).toBe(corrected.id)
  })
})
