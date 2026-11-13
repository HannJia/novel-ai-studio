import { describe, expect, it } from 'vitest'
import { legacyReviewFindingsFixture } from '@/test/legacyReviewFindingsFixture'
import type { StoryAggregate } from './storyAggregate'
import { parseReviewFindings, reconcileLegacyChapterFindings, reviewFindingFingerprint } from './reconstructionFindings'

const now = '2026-10-31T08:00:00.000Z'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function fixture() {
  const data = legacyReviewFindingsFixture('chapter', '林澈未拆开信封，钥匙仍在陈伯手中。')
  const aggregate: StoryAggregate = {
    novel: { id: 'novel', chapters: [{ id: data.chapterId, content: data.content, contentReview: data.report, status: 'writing' }] } as StoryAggregate['novel'],
    workspace: { candidates: [], canonMutations: [], reviewFindings: copy(data.old), chapterReviews: [{
      id: 'review', chapterId: data.chapterId, sourceVersionId: data.sourceVersionId + '|context:obsolete-context',
      startedAt: now, deterministicChecksPassed: true, semanticChecksPassed: false, status: 'needs_revision',
      findings: copy(data.old), candidateChanges: [],
    }] },
  }
  return { ...data, aggregate }
}

describe('legacy review finding reconciliation', () => {
  it('rebuilds 20 fragments as 8 issues, preserves parent decisions and archives both preimages', () => {
    const { aggregate, old, report } = fixture()
    const review = aggregate.workspace.chapterReviews![0]
    // A previously saved review can have a different author decision snapshot.
    review.findings[0].authorNote = '旧审核快照说明'
    const before = copy(aggregate)
    expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('reconciled')
    expect(aggregate.novel).toEqual(before.novel)
    expect(aggregate.workspace.reviewFindings).toHaveLength(8)
    expect(aggregate.workspace.reviewFindings[0]).toMatchObject({ status: 'deferred', suggestedFix: '处理第1项。' })
    expect(aggregate.workspace.reviewFindings[0].authorNote).toContain('父项待核对')
    expect(aggregate.workspace.reviewFindings[0].authorNote).toContain('请复核')
    expect(aggregate.workspace.reviewFindings[1]).toMatchObject({ status: 'intentional', authorNote: '有意保留归属悬念' })
    expect(aggregate.workspace.reviewFindings.filter(row => row.severity === 'blocker')).toHaveLength(2)
    expect(review).toMatchObject({ sourceVersionId: before.workspace.chapterReviews![0].sourceVersionId,
      status: 'needs_revision', semanticChecksPassed: false })
    expect(review.findingReconciliations![0]).toMatchObject({ report, workspaceFindings: old,
      reviewFindings: before.workspace.chapterReviews![0].findings })
    const migrated = copy(aggregate)
    expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('unchanged')
    expect(aggregate).toEqual(migrated)
  })

  it('keeps unrelated continuity findings, chapters and old review history unchanged', () => {
    const { aggregate, old } = fixture()
    const continuity = { ...old[0], id: 'continuity:local', authorNote: '本地检查' }
    const other = { ...old[0], id: 'report:other', chapterId: 'other' }
    aggregate.workspace.reviewFindings.push(continuity, other)
    aggregate.workspace.chapterReviews![0].findings.push(copy(continuity))
    const history = { ...copy(aggregate.workspace.chapterReviews![0]), id: 'history', sourceVersionId: 'old-body' }
    aggregate.workspace.chapterReviews!.push(history)
    expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('reconciled')
    expect(aggregate.workspace.reviewFindings).toContainEqual(continuity)
    expect(aggregate.workspace.reviewFindings).toContainEqual(other)
    expect(aggregate.workspace.chapterReviews![1]).toEqual(history)
  })

  it.each(['changed-body', 'missing-source', 'missing-review', 'foreign-report', 'unparsed-fragment', 'running', 'locked'])(
    'does not destructively guess a migration for %s', change => {
      const { aggregate } = fixture()
      const chapter = aggregate.novel.chapters[0]
      if (change === 'changed-body') chapter.content += '新正文'
      if (change === 'missing-source') delete aggregate.workspace.reviewFindings[0].sourceVersionId
      if (change === 'missing-review') aggregate.workspace.chapterReviews = []
      if (change === 'foreign-report') chapter.contentReview = '## 必改问题\n1. [事件] 完全不同的问题'
      if (change === 'unparsed-fragment') aggregate.workspace.reviewFindings[0].explanation = '丢失的真实问题'
      if (change === 'running') aggregate.workspace.chapterReviews![0].status = 'running'
      if (change === 'locked') chapter.status = 'locked'
      const before = copy(aggregate)
      expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).not.toBe('reconciled')
      expect(aggregate).toEqual(before)
    })

  it('keeps ambiguous parents open instead of borrowing accepted child decisions', () => {
    const { aggregate, old } = fixture()
    aggregate.workspace.reviewFindings.push({ ...old[0], id: 'report:duplicate', status: 'accepted', authorNote: '冲突说明' })
    aggregate.workspace.chapterReviews![0].findings = copy(aggregate.workspace.reviewFindings)
    expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('reconciled')
    expect(aggregate.workspace.reviewFindings[0]).toMatchObject({ status: 'open' })
    expect(aggregate.workspace.reviewFindings[0].authorNote).toContain('请复核')
    expect(aggregate.workspace.chapterReviews![0].findingReconciliations![0].workspaceFindings).toHaveLength(21)
  })

  it.each(['open', 'accepted', 'rejected', 'intentional', 'deferred', 'stale'] as const)(
    'preserves a unique parent %s decision when child fields have no explicit conflicting decisions', status => {
      const { aggregate } = fixture()
      aggregate.workspace.reviewFindings[0].status = status
      aggregate.workspace.reviewFindings[1].status = 'open'
      delete aggregate.workspace.reviewFindings[1].authorNote
      expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('reconciled')
      expect(aggregate.workspace.reviewFindings[0]).toMatchObject({ status, authorNote: '父项待核对' })
      expect(aggregate.workspace.chapterReviews![0].findingReconciliations![0].workspaceFindings[1])
        .toMatchObject({ status: 'open' })
    })

  it.each(['accepted', 'intentional'] as const)('does not silently resolve an explicit deferred child under a %s parent', status => {
    const { aggregate } = fixture()
    aggregate.workspace.reviewFindings[0].status = status
    aggregate.workspace.reviewFindings[1].status = 'deferred'
    aggregate.workspace.reviewFindings[1].authorNote = '证据来源还需核对，暂缓定稿'
    const before = copy(aggregate.workspace.reviewFindings)
    expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('reconciled')
    expect(aggregate.workspace.reviewFindings[0]).toMatchObject({ status: 'deferred', blocksFinalization: true })
    expect(aggregate.workspace.reviewFindings[0].authorNote).toContain('请复核')
    expect(aggregate.workspace.chapterReviews![0].findingReconciliations![0].workspaceFindings).toEqual(before)
  })

  it('reopens an accepted parent when a child carries a different author note even with the same status', () => {
    const { aggregate } = fixture()
    aggregate.workspace.reviewFindings[0].status = 'accepted'
    expect(reconcileLegacyChapterFindings(aggregate, 'chapter', now)).toBe('reconciled')
    expect(aggregate.workspace.reviewFindings[0]).toMatchObject({ status: 'open', blocksFinalization: true })
    expect(aggregate.workspace.reviewFindings[0].authorNote).toContain('父项待核对')
    expect(aggregate.workspace.reviewFindings[0].authorNote).toContain('请复核')
  })

  it('uses the full parent line and source rather than generic titles for fingerprints', () => {
    const { old } = fixture()
    expect(reviewFindingFingerprint(old[0])).not.toBe(reviewFindingFingerprint({ ...old[0], explanation: '[知情] 不同的未知事实' }))
    expect(reviewFindingFingerprint(old[0])).not.toBe(reviewFindingFingerprint({ ...old[0], sourceVersionId: 'changed' }))
    expect(reviewFindingFingerprint(old[0])).toBe(reviewFindingFingerprint({ ...old[0], explanation: '**' + old[0].explanation + '**\n- 修改建议：补齐' }))
  })

  it('does not rewrite already grouped findings or reset their decisions', () => {
    const data = fixture()
    const parsed = parseReviewFindings(data)
    parsed[0].status = 'accepted'
    data.aggregate.workspace.reviewFindings = parsed
    const before = copy(data.aggregate)
    expect(reconcileLegacyChapterFindings(data.aggregate, 'chapter', now)).toBe('unchanged')
    expect(data.aggregate).toEqual(before)
  })
})
