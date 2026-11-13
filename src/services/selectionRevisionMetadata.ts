import type { ChapterRevision } from '../types/novel'
import { captureSelectionSnapshot, buildSelectionRevision } from './selectionRevision'

export function selectionReplacement(revision: Pick<ChapterRevision, 'baseContent' | 'proposedContent' | 'selection'>): string {
  const selection = revision.selection
  if (!selection) throw new Error('该修订不是选区候选。')
  const start = selection.mode === 'continue' ? selection.endOffset : selection.startOffset
  const suffixLength = revision.baseContent.length - selection.endOffset
  return revision.proposedContent.slice(start, revision.proposedContent.length - suffixLength)
}

/** Shared by the editor, SQL adapter and isolated main-process validator. */
export function validateSelectionRevision(revision: ChapterRevision): void {
  if (revision.selection === undefined) return
  const snapshot = captureSelectionSnapshot({ novelId: revision.novelId, chapterId: revision.chapterId,
    baseContent: revision.baseContent, mode: revision.selection.mode, startOffset: revision.selection.startOffset,
    endOffset: revision.selection.endOffset, contextVersion: revision.selection.contextVersion })
  const proposed = buildSelectionRevision(snapshot, selectionReplacement(revision), { novelId: revision.novelId,
    chapterId: revision.chapterId, content: revision.baseContent, contextVersion: revision.selection.contextVersion })
  if (proposed !== revision.proposedContent || proposed === revision.baseContent) throw new Error('选区候选修改了选区以外的正文，或未产生变化。')
}
