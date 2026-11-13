import type { Chapter } from '@/types/novel'
import type { EvidenceRef, ReviewFinding } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

export function resolveReviewEvidence(chapters: Array<Pick<Chapter, 'id' | 'content'>>, evidence: EvidenceRef) {
  if (evidence.sourceType !== 'chapter') throw new Error('这条依据来自设定或大纲，不能定位到章节正文。')
  const chapter = chapters.find(chapter => chapter.id === evidence.sourceId)
  if (!chapter) throw new Error('证据来源章节已不存在。')
  if (!evidence.sourceVersionId) throw new Error('证据缺少正文版本，请重新审核或分析。')
  if (evidence.sourceVersionId !== buildAnalysisSourceVersionId(chapter.content)) throw new Error('证据对应的正文已经变化，请重新审核或分析。')
  const quote = evidence.quote
  if (!quote?.trim()) throw new Error('这条依据没有正文引文，无法准确定位。')
  let startOffset = evidence.startOffset, endOffset = evidence.endOffset
  if (startOffset !== undefined || endOffset !== undefined) {
    if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) || startOffset! < 0
      || endOffset! <= startOffset! || endOffset! > chapter.content.length) throw new Error('证据位置无效，请重新审核或分析。')
    if (chapter.content.slice(startOffset, endOffset) !== quote) throw new Error('证据引文与记录位置不一致，请重新审核或分析。')
  } else {
    startOffset = chapter.content.indexOf(quote)
    if (startOffset < 0) throw new Error('当前正文中找不到证据引文。')
    if (startOffset !== chapter.content.lastIndexOf(quote)) throw new Error('引文在正文中出现多次，无法确定位置，请提供更完整的证据。')
    endOffset = startOffset + quote.length
  }
  return { chapterId: chapter.id, sourceVersionId: evidence.sourceVersionId, quote, startOffset: startOffset!, endOffset: endOffset! }
}

export function findingEvidence(finding: ReviewFinding): EvidenceRef[] {
  const evidence = finding.evidence.slice()
  if (finding.quotedText && !evidence.some(item => item.sourceType === 'chapter' && item.sourceId === finding.chapterId
    && item.sourceVersionId === finding.sourceVersionId && item.quote === finding.quotedText
    && (finding.startOffset === undefined || item.startOffset === finding.startOffset)
    && (finding.endOffset === undefined || item.endOffset === finding.endOffset))) {
    evidence.push({ id: finding.id + ':quote', sourceType: 'chapter', sourceId: finding.chapterId,
      sourceVersionId: finding.sourceVersionId, quote: finding.quotedText, startOffset: finding.startOffset, endOffset: finding.endOffset })
  }
  const seen = new Set<string>()
  return evidence.filter(item => {
    const key = JSON.stringify([item.sourceType, item.sourceId, item.sourceVersionId, item.quote, item.startOffset, item.endOffset])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}
