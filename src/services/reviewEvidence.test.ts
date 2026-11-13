import { describe, expect, it } from 'vitest'
import type { EvidenceRef, ReviewFinding } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { findingEvidence, resolveReviewEvidence } from './reviewEvidence'
import { parseReviewFindings } from './reconstructionFindings'

const chapter = { id: 'chapter', content: '雨夜。🔑林澈拿到钥匙。林澈离开。' }
const evidence: EvidenceRef = { id: 'quote', sourceType: 'chapter', sourceId: chapter.id,
  sourceVersionId: buildAnalysisSourceVersionId(chapter.content), quote: '🔑林澈拿到钥匙。' }
describe('review evidence location', () => {
  it('returns exact UTF16 offsets in the actual chapter, including emoji', () => {
    const target = resolveReviewEvidence([chapter], evidence)
    expect(target).toMatchObject({ startOffset: 3, endOffset: 12, chapterId: chapter.id })
    expect(chapter.content.slice(target.startOffset, target.endOffset)).toBe(evidence.quote)
  })
  it.each([
    { sourceType: 'outline' }, { sourceId: 'missing' }, { sourceVersionId: undefined }, { sourceVersionId: 'old' },
    { quote: '' }, { quote: '不存在' }, { startOffset: 3 }, { endOffset: 13 }, { startOffset: -1, endOffset: 13 },
    { startOffset: 3.1, endOffset: 13 }, { startOffset: 13, endOffset: 3 }, { startOffset: 3, endOffset: 999 },
    { startOffset: 0, endOffset: 10 },
  ])('refuses an unsafe location %j', patch => {
    expect(() => resolveReviewEvidence([chapter], { ...evidence, ...patch } as EvidenceRef)).toThrow()
  })
  it('does not guess the first of repeated quotes; explicit exact locations are allowed', () => {
    expect(() => resolveReviewEvidence([chapter], { ...evidence, quote: '林澈' })).toThrow('多次')
    const startOffset = chapter.content.lastIndexOf('林澈')
    expect(resolveReviewEvidence([chapter], { ...evidence, quote: '林澈', startOffset, endOffset: startOffset + 2 }).startOffset).toBe(startOffset)
  })
  it('refuses old evidence even if its quote remains at the same position', () => {
    expect(() => resolveReviewEvidence([{ ...chapter, content: chapter.content + '新段落。' }], evidence)).toThrow('已经变化')
  })
  it('combines existing and fallback finding evidence without manufacturing provenance or duplicates', () => {
    const finding: ReviewFinding = { id: 'finding', chapterId: chapter.id, sourceVersionId: evidence.sourceVersionId,
      title: '核对', explanation: '核对日期', type: 'timeline', severity: 'blocker', status: 'open', blocksFinalization: true,
      quotedText: evidence.quote, evidence: [evidence, { ...evidence, id: 'duplicate' }] }
    expect(findingEvidence(finding)).toEqual([evidence])
    expect(findingEvidence({ ...finding, evidence: [], sourceVersionId: undefined })[0].sourceVersionId).toBeUndefined()
    expect(findingEvidence({ ...finding, evidence: [], quotedText: undefined })).toEqual([])
  })
  it('does not create artificial first-match offsets while parsing a repeated quotation', () => {
    const content = '林澈进入城门。林澈进入城门。'
    const findings = parseReviewFindings({ chapterId: chapter.id, sourceVersionId: buildAnalysisSourceVersionId(content), content,
      report: '## 必改\n1. [时间线] 请核对“林澈进入城门”。' })
    expect(findings).toHaveLength(1)
    expect(findings[0].evidence).toEqual([])
    expect(() => resolveReviewEvidence([{ ...chapter, content }], findingEvidence(findings[0])[0])).toThrow('多次')
  })
})
