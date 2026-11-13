import type { ReviewContext } from './context'
import { splitReviewChunks, type ReviewChunk } from './chapterReviewCheckpoint'
import { countNovelWords } from '@/utils/format'

export interface ReviewContextPart {
  kind: 'chunk' | 'global'
  part: ReviewChunk
  context: ReviewContext
}

/** The exact bounded context passed to each original-text or global review request. */
export function materializeReviewContexts(source: string, buildContext: (text: string) => ReviewContext): ReviewContextPart[] {
  const chunks = splitReviewChunks(source), chapterWordCount = countNovelWords(source)
  const make = (part: ReviewChunk, kind: ReviewContextPart['kind']): ReviewContextPart => ({ kind, part,
    context: { ...buildContext(part.text), chapterContent: part.text, chapterWordCount } })
  const result = chunks.map(part => make(part, 'chunk'))
  if (chunks.length > 1) result.push(make({ text: '', start: 0, end: source.length, index: 0, total: chunks.length }, 'global'))
  return result
}
