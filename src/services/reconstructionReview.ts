import type {
  CandidateChange,
  ChapterReview,
  EvidenceRef,
  ReviewFinding,
} from '@/types/reconstruction'

export interface EvidenceInput {
  id: string
  sourceType: EvidenceRef['sourceType']
  sourceId: string
  sourceVersionId?: string
  content: string
  quote: string
  label?: string
}

export function createEvidenceRef(input: EvidenceInput): EvidenceRef {
  if (!input.quote.trim()) throw new Error('证据片段不能为空')
  const startOffset = input.content.indexOf(input.quote)
  if (startOffset < 0) throw new Error('证据片段不在当前正文中')

  return {
    id: input.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceVersionId: input.sourceVersionId,
    quote: input.quote,
    startOffset,
    endOffset: startOffset + input.quote.length,
    label: input.label,
  }
}

export function isFindingBlocking(finding: ReviewFinding): boolean {
  return finding.blocksFinalization && (finding.status === 'open' || finding.status === 'deferred')
}

export function hasBlockingFindings(findings: ReviewFinding[]): boolean {
  return findings.some(isFindingBlocking)
}

export function isReviewCurrent(review: ChapterReview, sourceVersionId: string): boolean {
  return review.sourceVersionId === sourceVersionId && review.status !== 'failed' && review.status !== 'running'
}

export function canFinalizeChapter(review: ChapterReview, sourceVersionId: string): boolean {
  return isReviewCurrent(review, sourceVersionId)
    && review.deterministicChecksPassed
    && review.semanticChecksPassed === true
    && (review.status === 'ready_to_finalize' || review.status === 'approved')
    && !hasBlockingFindings(review.findings)
}

export function markFindingStaleIfSourceChanged(
  finding: ReviewFinding,
  currentSourceVersionId: string,
): ReviewFinding {
  if (!finding.sourceVersionId || finding.sourceVersionId === currentSourceVersionId) return finding
  return { ...finding, status: 'stale' }
}

export function markCandidateStaleIfSourceChanged(
  candidate: CandidateChange,
  currentSourceVersionId: string,
): CandidateChange {
  if (!candidate.sourceVersionId || candidate.sourceVersionId === currentSourceVersionId) return candidate
  return { ...candidate, status: 'stale' }
}

export function acceptCandidateChange(
  candidate: CandidateChange,
  now: string,
  editedValue?: string,
): CandidateChange {
  if (candidate.status !== 'proposed' && candidate.status !== 'deferred') throw new Error('只有待处理或延后的候选可以确认')
  if (!candidate.evidence.length) throw new Error('候选变化必须包含至少一条证据')
  if (editedValue !== undefined && !editedValue.trim()) throw new Error('修改后的候选不能为空')

  return {
    ...candidate,
    proposedValue: editedValue ?? candidate.proposedValue,
    originalProposedValue: editedValue !== undefined ? candidate.originalProposedValue ?? candidate.proposedValue : candidate.originalProposedValue,
    status: editedValue !== undefined ? 'edited' : 'accepted',
    updatedAt: now,
  }
}

export function resolveFinding(
  finding: ReviewFinding,
  status: ReviewFinding['status'],
  authorNote?: string,
): ReviewFinding {
  if (status === 'open') throw new Error('处理审核问题时不能恢复为 open，请重新运行审核')
  return { ...finding, status, authorNote }
}
