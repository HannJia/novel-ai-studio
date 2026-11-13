import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Novel } from '@/types/novel'
import type { CandidateChange, ChapterReview, ReviewFinding } from '@/types/reconstruction'
import { createEmptyCreationDraft } from '@/types/reconstruction'
import { characterStateFixture, knowledgeCandidate } from '@/test/characterStateFixture'
import type { StoryAggregate } from './storyAggregate'
import { captureChapterDeletionBaseline, deleteChaptersWithImpact } from './chapterDeletionTransactions'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion } from './reconstructionReviewVersion'
import { canFinalizeChapter } from './reconstructionReview'
import { getCharacterStateSnapshot } from './reconstructionCharacterState'
import { acceptStoryChange } from './storyDecisions'
import { appendEntityRevision, captureEntityRevision } from './entityProvenance'
import { withCurrentStoryEntities } from './effectiveStory'
import { createStoryMemoryBinding, getStoryMemoryStatus } from './storyMemory'

const now = '2026-10-31T09:00:00.000Z'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
let sequence = 0
const id = () => 'deletion-test-' + ++sequence

function fixture(): StoryAggregate {
  const { novel } = characterStateFixture()
  return { novel: copy(novel), workspace: { candidates: [], canonMutations: [], chapterReviews: [], reviewFindings: [], aiRuns: [] } }
}
function remove(aggregate: StoryAggregate, chapterId?: string) {
  return deleteChaptersWithImpact(aggregate, chapterId, captureChapterDeletionBaseline(aggregate.novel, chapterId), now, id)
}
function review(aggregate: StoryAggregate, index: number): ChapterReview {
  const chapter = aggregate.novel.chapters[index]
  const context = buildReviewContextVersion(aggregate.novel, chapter, [], aggregate.workspace.creationDraft,
    aggregate.workspace.canonMutations, aggregate.workspace.storyMemories)
  chapter.contentReview = '【审核通过】合成报告。'
  chapter.contentReviewSignature = buildChapterReviewSignature(chapter.content, context)
  chapter.status = 'finalized'
  const result: ChapterReview = { id: 'review-' + chapter.id, chapterId: chapter.id, startedAt: now, completedAt: now,
    sourceVersionId: buildChapterReviewSourceVersion(chapter.content, context), deterministicChecksPassed: true,
    semanticChecksPassed: true, status: 'approved', findings: [], candidateChanges: [] }
  aggregate.workspace.chapterReviews!.push(result)
  return result
}

describe('chapter deletion domain boundary', () => {
  beforeEach(() => { setActivePinia(createPinia()); sequence = 0 })

  it('deletes by stable ID, compacts chronological order and records actual changed review inputs', () => {
    const aggregate = fixture(), { novel, workspace } = aggregate
    const [first, middle, last] = novel.chapters
    const firstReview = review(aggregate, 0), lastReview = review(aggregate, 2)
    const firstSnapshot = copy(first), lastSource = lastReview.sourceVersionId
    novel.chapters.reverse() // physical array position is not chapter identity/order
    expect(remove(aggregate, middle.id)).toBe(true)
    expect(novel.chapters.map(row => [row.id, row.chapterIndex])).toEqual([[first.id, 0], [last.id, 1]])
    expect(novel.currentWordCount).toBe(first.wordCount + last.wordCount)
    expect(first).toEqual(firstSnapshot)
    expect(last).toMatchObject({ status: 'writing', contentReviewSignature: '', reviewRewriteBlockedSignature: '' })
    expect(last.contentReviewCoverage).toBeUndefined()
    expect(workspace.chapterReviews).toEqual([firstReview, lastReview])
    const current = buildChapterReviewSourceVersion(last.content, buildReviewContextVersion(novel, last))
    expect(current).not.toBe(lastSource)
    expect(canFinalizeChapter(lastReview, current)).toBe(false)
    expect(workspace.impactReports).toHaveLength(1)
    expect(workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs', reviewChapterIds: [last.id],
      changes: [{ target: { kind: 'chapter', id: middle.id }, action: 'delete', fields: ['$exists', 'content'] },
        { target: { kind: 'chapter', id: last.id }, action: 'update', fields: ['chapterIndex'] }] })
    expect(workspace.impactReports![0].beforeVersion).not.toBe(workspace.impactReports![0].afterVersion)
  })

  it('preserves Canon, accepted decisions, evidence and memories while removing their effective source', () => {
    const aggregate = fixture(), { novel, workspace } = aggregate
    const removed = novel.chapters[1]
    const candidate = knowledgeCandidate(novel, 1)
    workspace.candidates.push(candidate)
    acceptStoryChange(aggregate, candidate.id, now)
    const scope = { kind: 'book' as const, throughChapterId: removed.id }
    workspace.storyMemories = [{ id: 'memory', novelId: novel.id, title: '合成旧回顾', scope, summary: '城主仍然在世。',
      source: createStoryMemoryBinding(novel, scope, '城主仍然在世。', 'author', now), history: [] }]
    const finding: ReviewFinding = { id: 'intentional', chapterId: removed.id, sourceVersionId: buildAnalysisSourceVersionId(removed.content),
      type: 'plot', severity: 'warning', title: '合成问题', explanation: '保留伏笔', evidence: candidate.evidence,
      blocksFinalization: false, status: 'intentional', authorNote: '作者有意设计，不得删除决定。' }
    workspace.reviewFindings.push(finding)
    review(aggregate, 1).findings.push(copy(finding))
    const history = copy({ canon: workspace.canonMutations, decisions: workspace.reviewFindings,
      reviews: workspace.chapterReviews, memories: workspace.storyMemories, accepted: workspace.candidates })
    expect(remove(aggregate, removed.id)).toBe(true)
    expect(workspace.canonMutations).toEqual(history.canon)
    expect(workspace.reviewFindings).toEqual(history.decisions)
    expect(workspace.chapterReviews).toEqual(history.reviews)
    expect(workspace.candidates).toEqual(history.accepted)
    expect(workspace.storyMemories).toEqual(history.memories)
    expect(getCharacterStateSnapshot(novel, workspace.canonMutations, 100).knowledge).toEqual([])
    expect(getCharacterStateSnapshot(novel, workspace.canonMutations, 100).invalid[0].issue).toBe('来源章节已删除')
    expect(getStoryMemoryStatus(novel, workspace.storyMemories![0])).not.toBe('current')
  })

  it('retains chapter-backed entity history and excludes a deleted source from Canon projection', () => {
    const aggregate = fixture(), { novel } = aggregate, chapter = novel.chapters[1]
    const event: Novel['eventLog'][number] = { id: 'source-event', title: '书信', description: '城主仍然在世', chapterIndex: 1,
      type: '主线', characters: [], source: 'ai', status: 'developing', timestamp: now }
    appendEntityRevision(event, captureEntityRevision('event', undefined, event, { kind: 'chapter', chapterId: chapter.id,
      chapterIndex: 1, sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
      evidence: [{ quote: '苏禾向林澈出示书信，城主仍然在世。' }] }, now, 'event-provenance'))
    novel.eventLog.push(event)
    const original = copy(event)
    expect(withCurrentStoryEntities(novel).eventLog).toHaveLength(1)
    expect(remove(aggregate, chapter.id)).toBe(true)
    expect(novel.eventLog).toEqual([original])
    expect(withCurrentStoryEntities(novel).eventLog).toEqual([])
  })

  it('keeps pending source evidence but makes deleted or renumbered candidates stale', () => {
    const aggregate = fixture(), { novel, workspace } = aggregate
    const removed = novel.chapters[1], moved = novel.chapters[2]
    const make = (chapterId: string, status: CandidateChange['status']): CandidateChange => ({ id: id(), chapterId, novelId: novel.id,
      type: 'fact', proposedValue: '合成候选', status, createdAt: now, updatedAt: now,
      evidence: [{ id: id(), sourceType: 'chapter', sourceId: chapterId, quote: '合成引文' }] })
    workspace.candidates.push(make(removed.id, 'proposed'), make(moved.id, 'deferred'), make(removed.id, 'rejected'))
    const oldEvidence = copy(workspace.candidates.map(row => row.evidence))
    remove(aggregate, removed.id)
    expect(workspace.candidates.map(row => row.status)).toEqual(['stale', 'stale', 'rejected'])
    expect(workspace.candidates.map(row => row.evidence)).toEqual(oldEvidence)
  })

  it('clears an unreferenced book once and leaves all history collections intact', () => {
    const aggregate = fixture()
    aggregate.novel.characters = []
    const baseline = captureChapterDeletionBaseline(aggregate.novel)
    expect(deleteChaptersWithImpact(aggregate, undefined, baseline, now, id)).toBe(true)
    expect(aggregate.novel.chapters).toEqual([])
    expect(aggregate.novel.currentWordCount).toBe(0)
    expect(deleteChaptersWithImpact(aggregate, undefined, baseline, now, id)).toBe(false)
    expect(aggregate.workspace.impactReports).toHaveLength(1)
    expect(aggregate.workspace.impactReports![0].changes).toHaveLength(3)
  })

  it.each(['target', 'reordered'] as const)('refuses a locked %s chapter without any draft mutation', kind => {
    const aggregate = fixture()
    aggregate.novel.chapters[kind === 'target' ? 1 : 2].status = 'locked'
    const before = copy(aggregate)
    expect(() => remove(aggregate, aggregate.novel.chapters[1].id)).toThrow('锁定')
    expect(aggregate).toEqual(before)
  })

  it.each(['id', 'index'] as const)('rejects ambiguous stable chapter %s values before mutation', kind => {
    const aggregate = fixture()
    if (kind === 'id') aggregate.novel.chapters[2].id = aggregate.novel.chapters[1].id
    else aggregate.novel.chapters[2].chapterIndex = 1
    const before = copy(aggregate)
    expect(() => remove(aggregate, aggregate.novel.chapters[1].id)).toThrow('ID 或顺序无效')
    expect(aggregate).toEqual(before)
  })

  const ambiguous: Array<[string, (aggregate: StoryAggregate) => void]> = [
    ['firstAppearChapter', ({ novel }) => { novel.characters[0].firstAppearChapter = 2 }],
    ['chapterIndex', ({ novel }) => { novel.eventLog.push({ id: 'event', chapterIndex: 1, title: '作者事件', description: '', characters: [], type: '主线', timestamp: now, source: 'user' }) }],
    ['targetChapterStart/End', ({ novel }) => { novel.chapterPlans = [{ id: 'plan', title: '待写目标', objective: '', summary: '', beats: [], horizon: 'next',
      targetChapterStart: 2, targetChapterEnd: 3, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user', createdAt: now, updatedAt: now }] }],
    ['number/endNumber', ({ workspace }) => { workspace.creationDraft = createEmptyCreationDraft({ id: 'creation', now }); workspace.creationDraft.chapterPlans = [{
      id: 'v2-plan', number: 2, title: '章纲', objective: '', conflict: '', openingState: '', endingState: '', requiredEvents: [],
      prohibitedReveals: [], characterChangeNotes: [], scenePlanIds: [], foreshadowingIds: [], status: 'planned', approval: 'approved',
    }] }],
    ['targetChapter', ({ novel }) => { novel.storyArcs = [{ id: 'arc', title: '主线', description: '', type: 'main', importance: 1, status: 'active', reactivateAt: '', characterIds: [],
      nodes: [{ id: 'node', title: '里程碑', description: '', targetChapter: 2, status: 'pending', createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }] }],
    ['lastChapterIndex', ({ novel }) => { novel.storyClock = { currentDay: 3, label: '第 4 天', lastChapterIndex: 2, updatedAt: now } }],
    ['storyDay/storyDaysElapsed', ({ novel }) => { novel.chapters[1].storyDaysElapsed = 2 }],
    ['lastMentionChapterIndex', ({ novel }) => { novel.dataPanels = [{ id: 'panel', name: '资源', category: '资源', fields: [], relatedKeywords: [], lastMentionChapterIndex: 2, createdAt: now, updatedAt: now }] }],
    ['pendingChapterIndex', ({ novel }) => { novel.dataPanels = [{ id: 'panel', name: '资源', category: '资源', fields: [{ id: 'field', name: '数量', value: '1', unit: '', note: '',
      automationRules: [{ id: 'rule', trigger: 'per_chapter', amount: 1, interval: 1, enabled: true, pendingChapterIndex: 1 }] }], relatedKeywords: [], createdAt: now, updatedAt: now }] }],
    ['需来源投影', ({ novel }) => { novel.dataPanelChanges = [{ id: 'data-decision', itemId: 'panel', fieldId: 'field', itemName: '资源', fieldName: '数量', oldValue: '0', newValue: '1',
      reason: '合成依据', chapterIndex: 1, status: 'accepted', createdAt: now }] }],
    ['无稳定来源', ({ novel }) => { novel.storyStateProposals = [{ id: 'proposal', targetId: 'plan', targetTitle: '计划', targetType: 'chapter_plan', field: 'status', oldValue: 'active',
      newValue: 'completed', reason: '', evidence: '', chapterIndex: 1, status: 'pending', source: 'ai', createdAt: now, updatedAt: now }] }],
    ['chapterStart/End', ({ workspace }) => { workspace.aiRuns = [{ id: 'run', mode: 'autonomous', taskType: 'draft', status: 'paused', chapterStart: 0, chapterEnd: 2, createdAt: now, updatedAt: now }] }],
  ]
  it.each(ambiguous)('refuses unresolved numeric association %s without changing story meaning', (label, configure) => {
    const aggregate = fixture(); configure(aggregate)
    const before = copy(aggregate)
    expect(() => remove(aggregate, aggregate.novel.chapters[1].id)).toThrow(label)
    expect(aggregate).toEqual(before)
  })

  it('binds operation scope and refuses changed context, reorder, inserted chapters and lock state', () => {
    for (const update of [
      (novel: Novel) => { novel.chapters[1].content += '改稿' },
      (novel: Novel) => { novel.chapters.reverse() },
      (novel: Novel) => { novel.chapters.push({ ...novel.chapters[2], id: 'new', chapterIndex: 3 }) },
      (novel: Novel) => { novel.chapters[1].status = 'locked' },
      (novel: Novel) => { novel.outline = '新大纲' },
    ]) {
      const aggregate = fixture(), target = aggregate.novel.chapters[1].id
      const baseline = captureChapterDeletionBaseline(aggregate.novel, target)
      update(aggregate.novel)
      const before = copy(aggregate)
      expect(() => deleteChaptersWithImpact(aggregate, target, baseline, now, id)).toThrow('变化')
      expect(aggregate).toEqual(before)
    }
    const aggregate = fixture(), baseline = captureChapterDeletionBaseline(aggregate.novel, aggregate.novel.chapters[1].id)
    expect(() => deleteChaptersWithImpact(aggregate, undefined, baseline, now, id)).toThrow('变化')
  })
})
