import type { Chapter, Novel } from '@/types/novel'
import type { AiChapterDraft, AiRun } from '@/types/reconstruction'
import { countNovelWords } from '@/utils/format'

function chapterLabel(chapterIndex: number): string {
  return `第${chapterIndex + 1}章`
}

function findMatchingChapter(novel: Novel, draft: AiChapterDraft): Chapter {
  const chapter = novel.chapters.find(item => item.id === draft.chapterId)
  if (!chapter) {
    throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}对应的章节已删除，无法构造工作视图。`)
  }

  if (chapter.chapterIndex !== draft.chapterIndex) {
    throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}的章节索引已变化，当前章节已重排，请先处理章节结构。`)
  }

  const chapterAtIndex = novel.chapters.find(item => item.chapterIndex === draft.chapterIndex)
  if (!chapterAtIndex || chapterAtIndex.id !== draft.chapterId) {
    throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}的章节 ID 与索引不匹配，请先处理章节结构。`)
  }

  return chapter
}

/**
 * Build an isolated, read-only view used while an autonomous run is being processed.
 * Pending text is deliberately projected into this view only; it is never written to
 * the canonical novel by this function.
 */
export function buildAutonomousDraftNovel(novel: Novel, run: AiRun, throughChapterIndex: number): Novel {
  if (!Number.isInteger(throughChapterIndex) || throughChapterIndex < 0) {
    throw new Error('自动草稿工作视图的目标章节索引无效。')
  }

  const drafts = (run.chapterDrafts ?? []).filter(draft => draft.chapterIndex <= throughChapterIndex)
  const overlays = new Map<string, AiChapterDraft>()

  for (const draft of drafts) {
    const chapter = findMatchingChapter(novel, draft)

    if (draft.status === 'rejected' && draft.chapterIndex < throughChapterIndex) {
      throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}已拒绝，请先处理前章后再继续。`)
    }

    if (draft.status === 'accepted') {
      if (chapter.content !== draft.content) {
        throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}已接受，但正式正文与草稿正文不一致。`)
      }
      continue
    }

    if (draft.status !== 'pending') continue

    if (chapter.status === 'locked') {
      throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}无法构造工作视图：正式章节已锁定。`)
    }
    if (chapter.content !== draft.baseContent) {
      throw new Error(`自动草稿${chapterLabel(draft.chapterIndex)}无法构造工作视图：正式正文已变化，请重新生成或处理该草稿。`)
    }

    overlays.set(draft.chapterId, draft)
  }

  const chapters = novel.chapters.map(chapter => {
    const draft = overlays.get(chapter.id)
    if (!draft) return { ...chapter }

    return {
      ...chapter,
      content: draft.content,
      wordCount: countNovelWords(draft.content),
      status: 'writing' as const,
      summary: '',
      summarySource: undefined,
    }
  })

  return { ...novel, chapters }
}

/** Edit a pending autonomous draft without mutating its previous revision. */
export function editAutonomousDraft(draft: AiChapterDraft, content: string, contextVersion: string, now: string): AiChapterDraft {
  if (draft.status !== 'pending') throw new Error('只有 pending 状态的自动草稿可以编辑。')
  if (!content.trim()) throw new Error('自动草稿正文不能为空。')

  const sameRevision = draft.content === content && draft.contextVersion === contextVersion
  const existingHistory = draft.history.map(item => ({ ...item }))
  const history = (sameRevision
    ? existingHistory
    : [...existingHistory, { content: draft.content, updatedAt: draft.updatedAt }]
  ).slice(-20)

  return {
    ...draft,
    content,
    contextVersion,
    stage: 'generated',
    generationFinishReason: undefined,
    report: undefined,
    reviewCoverage: undefined,
    review: undefined,
    analysisError: undefined,
    updatedAt: now,
    history,
  }
}
