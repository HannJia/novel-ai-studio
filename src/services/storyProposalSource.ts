import type { Chapter, Novel, StoryStateProposal } from '@/types/novel'
import type { EntitySource } from '@/types/entityProvenance'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

export function bindStoryProposalSource(chapter: Chapter, quote: string): Extract<EntitySource, { kind: 'chapter' }> | undefined {
  const start = chapter.content.indexOf(quote)
  if (!quote.trim() || start < 0 || start !== chapter.content.lastIndexOf(quote)) return undefined
  return { kind: 'chapter', chapterId: chapter.id, chapterIndex: chapter.chapterIndex,
    sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    evidence: [{ quote, startOffset: start, endOffset: start + quote.length }] }
}

export function storyProposalSourceIsCurrent(novel: Novel, proposal: StoryStateProposal): boolean {
  if (proposal.source === 'user') return true
  const source = proposal.chapterSource
  if (!source || source.kind !== 'chapter' || source.chapterIndex !== proposal.chapterIndex) return false
  const chapter = novel.chapters.find(item => item.id === source.chapterId && item.chapterIndex === source.chapterIndex)
  if (!chapter || buildAnalysisSourceVersionId(chapter.content) !== source.sourceVersionId || source.evidence.length !== 1) return false
  const evidence = source.evidence[0]
  return evidence.quote === proposal.evidence && !!evidence.quote.trim()
    && Number.isSafeInteger(evidence.startOffset) && Number.isSafeInteger(evidence.endOffset)
    && evidence.startOffset! >= 0 && evidence.endOffset! - evidence.startOffset! === evidence.quote.length
    && chapter.content.slice(evidence.startOffset, evidence.endOffset) === evidence.quote
}
