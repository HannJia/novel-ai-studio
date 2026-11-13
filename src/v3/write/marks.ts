// 在当前正文中定位审校发现与候选的原文范围，供稿纸标记和页边批注使用。
// 规则：版本不一致的记录不显示为当前批注；先用记录的偏移（引文必须逐字相同），
// 偏移无效时在正文中找引文，多处出现时取离记录偏移最近的唯一一处，仍无法确定则不锚定。
import type { CandidateChange, ReviewFinding } from '@/types/reconstruction'
import type { ChapterRevision } from '@/types/novel'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { EditorMark } from '../editor/PlainTextEditor.vue'

export interface Anchor { start: number; end: number }

export function locateQuote(content: string, quote: string | undefined, start?: number, end?: number): Anchor | null {
  const validRange = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start! >= 0 && end! >= start! && end! <= content.length
  if (validRange && (!quote || content.slice(start, end) === quote)) {
    return quote || end! > start! ? { start: start!, end: end! } : null
  }
  if (!quote) return null
  const hits: number[] = []
  for (let i = content.indexOf(quote); i >= 0; i = content.indexOf(quote, i + 1)) hits.push(i)
  if (!hits.length) return null
  if (hits.length === 1) return { start: hits[0], end: hits[0] + quote.length }
  if (!Number.isSafeInteger(start)) return null
  const dist = hits.map(h => Math.abs(h - start!))
  const best = Math.min(...dist)
  if (dist.filter(d => d === best).length > 1) return null
  const at = hits[dist.indexOf(best)]
  return { start: at, end: at + quote.length }
}

export const SEVERITY_MARK: Record<ReviewFinding['severity'], string> = { blocker: 'mk-block', warning: 'mk-warn', suggestion: 'mk-hint' }

export interface AnchoredFinding { finding: ReviewFinding; anchor: Anchor | null }

/** 当前正文版本下的发现（含已处理的，用于显示 mk-ok / mk-off），按原文位置排序；未能锚定的排在最后。 */
export function anchorFindings(content: string, findings: ReviewFinding[]): AnchoredFinding[] {
  const version = buildAnalysisSourceVersionId(content)
  return findings
    .filter(f => f.status !== 'stale' && f.sourceVersionId === version)
    .map(finding => ({ finding, anchor: locateQuote(content, finding.quotedText || finding.evidence.find(item => item.sourceType === 'chapter'
      && item.sourceId === finding.chapterId && (!item.sourceVersionId || item.sourceVersionId === version))?.quote, finding.startOffset, finding.endOffset) }))
    .sort((a, b) => (a.anchor?.start ?? Infinity) - (b.anchor?.start ?? Infinity))
}

export function findingMarks(items: AnchoredFinding[]): EditorMark[] {
  return items.flatMap(({ finding: f, anchor }) => {
    if (!anchor) return []
    const done = f.status === 'accepted' ? 'mk-ok' : f.status === 'rejected' || f.status === 'intentional' ? 'mk-off' : ''
    return [{ id: 'f:' + f.id, start: anchor.start, end: anchor.end, cls: done || (f.type === 'foreshadowing' ? 'mk-fs' : SEVERITY_MARK[f.severity]), title: f.title }]
  })
}

export function candidateAnchor(content: string, candidate: CandidateChange): Anchor | null {
  const version = buildAnalysisSourceVersionId(content)
  if (!['proposed', 'deferred'].includes(candidate.status) || (candidate.sourceVersionId && candidate.sourceVersionId !== version)) return null
  for (const evidence of candidate.evidence) {
    if (evidence.sourceType !== 'chapter' || evidence.sourceId !== candidate.chapterId || !evidence.quote
      || (evidence.sourceVersionId && evidence.sourceVersionId !== version)) continue
    const anchor = locateQuote(content, evidence.quote, evidence.startOffset, evidence.endOffset)
    if (anchor) return anchor
  }
  return null
}

/** 精确截出变动范围，浮签与案头共用；预览本身不改变正文，也不代表可以采纳。 */
export function revisionPreview(revision: ChapterRevision, content: string, contextVersion: string) {
  const before = revision.baseContent, after = revision.proposedContent
  let start = 0, end = before.length, proposedEnd = after.length
  while (start < end && start < proposedEnd && before[start] === after[start]) start++
  // UTF-16 定位保持不变，但预览边界不能拆开代理对。
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--
  while (end > start && proposedEnd > start && before[end - 1] === after[proposedEnd - 1]) { end--; proposedEnd-- }
  if (end < before.length && /[\uDC00-\uDFFF]/.test(before[end])) { end++; proposedEnd++ }
  return { start, end, before: before.slice(start, end), after: after.slice(start, proposedEnd),
    current: revision.status === 'pending' && before === content && (!revision.selection || revision.selection.contextVersion === contextVersion) }
}
