import type { ChapterSelectionRevision } from '@/types/novel'
import { captureSelectionSnapshot, buildSelectionRevision } from './selectionRevision'

/** Bind a whole-chapter candidate to the smallest changed range. This retains
 * the existing persisted manuscript/context checks without relabeling long,
 * unchanged prose as an AI replacement. Chapter-length acceptance is separate. */
export function chapterDraftSelection(source: { novelId: string; chapterId: string; baseContent: string; contextVersion: string }, proposedContent: string): ChapterSelectionRevision {
  const base = source.baseContent
  let start = 0
  while (start < base.length && start < proposedContent.length && base[start] === proposedContent[start]) start++
  // Keep UTF-16 surrogate pairs whole at both boundaries.
  if (start > 0 && /[\uD800-\uDBFF]/.test(base[start - 1])) start--
  let end = base.length, proposedEnd = proposedContent.length
  while (end > start && proposedEnd > start && base[end - 1] === proposedContent[proposedEnd - 1]) { end--; proposedEnd-- }
  if (end < base.length && /[\uDC00-\uDFFF]/.test(base[end])) { end++; proposedEnd++ }
  // Deletion/whitespace-only replacements need a neighboring stable character
  // because the shared selection protocol requires nonempty replacement text.
  if (!proposedContent.slice(start, proposedEnd).trim() || (end > start && !base.slice(start, end).trim())) {
    start = 0; end = base.length; proposedEnd = proposedContent.length
  }
  const selection: ChapterSelectionRevision = { mode: start === end ? 'continue' : 'rewrite', startOffset: start, endOffset: end, contextVersion: source.contextVersion }
  const snapshot = captureSelectionSnapshot({ ...source, ...selection })
  const rebuilt = buildSelectionRevision(snapshot, proposedContent.slice(start, proposedEnd), {
    novelId: source.novelId, chapterId: source.chapterId, content: base, contextVersion: source.contextVersion,
  })
  if (rebuilt !== proposedContent) throw new Error('候选范围无法安全保存，请保留候选并核对。')
  return selection
}
