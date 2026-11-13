import type { Chapter, Novel } from '@/types/novel'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import type { CanonMutationRecord, CreationDraft } from '@/types/reconstruction'
import type { KnowledgeBase } from '@/types/knowledge'
import { projectChapterReview } from './chapterReviewProjection'

export type ReviewKnowledgeRevisions = KnowledgeBase[]

/** Identity is derived from the same bounded prompts and local checks used for review. */
export function buildReviewContextVersion(novel: Novel, chapter: Chapter, knowledge: ReviewKnowledgeRevisions = [], creationDraft?: CreationDraft, canonMutations: CanonMutationRecord[] = [], storyMemories: StoryMemoryRecord[] = []): string {
  return projectChapterReview(novel, chapter, { knowledge, creationDraft, canonMutations, storyMemories }).contextVersion
}

export { buildChapterReviewSignature, buildChapterReviewSourceVersion } from './chapterReviewIdentity'
