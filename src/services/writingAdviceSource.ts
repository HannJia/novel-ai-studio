import type { Chapter, Novel } from '@/types/novel'
import type { CanonMutationRecord, CreationDraft } from '@/types/reconstruction'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import type { KnowledgeBase } from '@/types/knowledge'
import { getCurrentChapterSummary } from './derivedSources'
import { getApprovedPlanning } from './reconstructionPlanning'
import { getCharacterStateHistory } from './reconstructionCharacterState'
import { storyMemorySignature } from './storyMemory'

export function writingAdviceContentSignature(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return text.length + ':' + (hash >>> 0)
}

/** Used both by the advisor cache and the author-confirmed save transaction. */
export function writingAdviceReferenceVersion(novel: Novel, chapter: Chapter, draft?: CreationDraft,
  canon: CanonMutationRecord[] = [], memories: StoryMemoryRecord[] = [], knowledge: KnowledgeBase[] = []): string {
  return writingAdviceContentSignature(JSON.stringify({
    novel: [novel.id, novel.title, novel.genre, novel.subGenre, novel.settings, novel.writingStyle, novel.outline, novel.chapterLengthPolicy],
    chapter: [chapter.id, chapter.title, chapter.chapterIndex, chapter.volumeIndex, chapter.sceneNotes],
    volumes: novel.volumes.map(({ versions: _versions, ...volume }) => volume),
    previous: novel.chapters.filter(item => item.chapterIndex < chapter.chapterIndex)
      .map(item => [item.id, item.title, getCurrentChapterSummary(item), writingAdviceContentSignature(item.content)]),
    characters: novel.characters,
    plans: novel.chapterPlans?.map(({ versions: _versions, ...plan }) => plan),
    planning: getApprovedPlanning(draft, chapter.chapterIndex, novel),
    characterState: getCharacterStateHistory(novel, canon, chapter.chapterIndex),
    storyMemory: storyMemorySignature(novel, memories, chapter.chapterIndex),
    events: novel.eventLog, arcs: novel.storyArcs,
    panels: novel.dataPanels.map(({ versions: _versions, ...panel }) => panel),
    knowledge: knowledge.filter(base => novel.knowledgeBaseIds.includes(base.id)),
    knowledgeIds: novel.knowledgeBaseIds,
  }))
}

export function writingAdviceSourceVersion(novel: Novel, chapter: Chapter, content: string, draft?: CreationDraft,
  canon: CanonMutationRecord[] = [], memories: StoryMemoryRecord[] = [], knowledge: KnowledgeBase[] = []): string {
  return writingAdviceReferenceVersion(novel, chapter, draft, canon, memories, knowledge) + ':' + writingAdviceContentSignature(content)
}
