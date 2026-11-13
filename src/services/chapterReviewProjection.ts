import type { Chapter, Novel } from '@/types/novel'
import type { CanonMutationRecord, CreationDraft } from '@/types/reconstruction'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import type { KnowledgeBase } from '@/types/knowledge'
import { buildReviewContext, type ReviewContext } from './context'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildLocalConsistencyReviewBlock } from './chapterLocalReview'
import { scanContinuity } from './continuity'
import { orderKnowledgeSources } from './knowledgeSelection'
import { splitReviewChunks } from './chapterReviewCheckpoint'
import { materializeReviewContexts } from './reviewContextPlan'

export interface ChapterReviewSources {
  knowledge?: KnowledgeBase[]
  creationDraft?: CreationDraft
  canonMutations?: CanonMutationRecord[]
  storyMemories?: StoryMemoryRecord[]
}

/** Synchronous, explicit inputs shared by prompts, persisted identities and invalidation. */
export function projectChapterReview(novel: Novel, chapter: Chapter, sources: ChapterReviewSources = {}) {
  const knowledge = orderKnowledgeSources(sources.knowledge || [])
  const build = (text: string) => buildReviewContext(novel, chapter, text, undefined, undefined,
    sources.creationDraft, sources.canonMutations, sources.storyMemories, knowledge)
  const localBlock = buildLocalConsistencyReviewBlock(chapter.content)
  const alerts = scanContinuity(novel, chapter, chapter.content)
  // Empty/oversized chapters still need an editing baseline; no request is allowed for them.
  let reviewable = true
  try { splitReviewChunks(chapter.content) } catch { reviewable = false }
  const parts = reviewable ? materializeReviewContexts(chapter.content, build) : []
  const contexts = new Map<string, ReviewContext>(parts.map(row => [row.part.text, row.context]))
  const baseline = reviewable ? undefined : { content: buildAnalysisSourceVersionId(chapter.content), context: build('') }
  const contextVersion = buildAnalysisSourceVersionId(JSON.stringify({ chapter: [chapter.id, chapter.chapterIndex],
    parts, baseline, localBlock, alerts }))
  return { contextVersion, localBlock, alerts, buildContext: (text: string): ReviewContext => {
    const context = contexts.get(text)
    if (!context) throw new Error('审核分段不属于当前正文，不能发送未绑定的审核输入')
    // Callers may add request details without mutating the captured identity.
    return JSON.parse(JSON.stringify(context)) as ReviewContext
  } }
}
