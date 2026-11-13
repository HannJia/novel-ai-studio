import { describe, expect, it } from 'vitest'
import {
  acceptCandidateChange,
  canFinalizeChapter,
  createEvidenceRef,
  hasBlockingFindings,
  isFindingBlocking,
  isReviewCurrent,
  markCandidateStaleIfSourceChanged,
  markFindingStaleIfSourceChanged,
  resolveFinding,
} from './reconstructionReview'
import type { CandidateChange, ChapterReview, ReviewFinding } from '@/types/reconstruction'

describe('reconstruction review boundary', () => {
  const now = '2026-10-26T00:00:00.000Z'

  it('creates evidence with exact offsets from the source version', () => {
    const evidence = createEvidenceRef({
      id: 'evidence-1',
      sourceType: 'chapter',
      sourceId: 'chapter-1',
      sourceVersionId: 'version-1',
      content: '雾城的钟声在午夜响起。',
      quote: '午夜响起',
    })

    expect(evidence.startOffset).toBe(6)
    expect(evidence.endOffset).toBe(10)
    expect(() => createEvidenceRef({
      id: 'evidence-2',
      sourceType: 'chapter',
      sourceId: 'chapter-1',
      content: '没有这句话。',
      quote: '不存在',
    })).toThrow('证据片段不在当前正文中')
  })

  it('blocks finalization only for unresolved blocking findings', () => {
    const finding: ReviewFinding = {
      id: 'finding-1',
      type: 'timeline',
      severity: 'blocker',
      title: '时间线冲突',
      explanation: '角色在同一时间出现在两个地点。',
      chapterId: 'chapter-1',
      sourceVersionId: 'version-1',
      evidence: [],
      blocksFinalization: true,
      status: 'open',
    }

    expect(isFindingBlocking(finding)).toBe(true)
    expect(hasBlockingFindings([finding])).toBe(true)
    expect(isFindingBlocking(resolveFinding(finding, 'intentional', '这是有意设计的反转。'))).toBe(false)
    expect(markFindingStaleIfSourceChanged({ ...finding, authorNote: '作者保留的说明' }, 'new').authorNote).toBe('作者保留的说明')
  })

  it('requires the current completed review before finalization', () => {
    const review: ChapterReview = {
      id: 'review-1',
      chapterId: 'chapter-1',
      sourceVersionId: 'version-1',
      startedAt: now,
      completedAt: now,
      deterministicChecksPassed: true,
      semanticChecksPassed: true,
      findings: [],
      candidateChanges: [],
      status: 'ready_to_finalize',
    }

    expect(isReviewCurrent(review, 'version-1')).toBe(true)
    expect(canFinalizeChapter(review, 'version-1')).toBe(true)
    expect(canFinalizeChapter(review, 'version-2')).toBe(false)
  })

  it('never accepts a candidate without evidence and marks old candidates stale', () => {
    const candidate: CandidateChange = {
      id: 'candidate-1',
      type: 'fact',
      proposedValue: '主角获得黑色徽章',
      evidence: [{ id: 'evidence-1', sourceType: 'chapter', sourceId: 'chapter-1', sourceVersionId: 'version-1' }],
      status: 'proposed',
      sourceVersionId: 'version-1',
      createdAt: now,
      updatedAt: now,
    }

    expect(acceptCandidateChange(candidate, now, '主角从封存室获得黑色徽章').status).toBe('edited')
    expect(markCandidateStaleIfSourceChanged(candidate, 'version-2').status).toBe('stale')
    expect(markCandidateStaleIfSourceChanged({ ...candidate, authorNote: '等待核对后文' }, 'version-2').authorNote).toBe('等待核对后文')
    expect(() => acceptCandidateChange({ ...candidate, evidence: [] }, now)).toThrow('至少一条证据')
  })
})
