import type { Chapter, ChapterPlan } from '@/types/novel'
import type { KnowledgeBase } from '@/types/knowledge'
import type { StoryAggregate } from './storyAggregate'
import type { WritingAdviceSuggestion } from './writingAdvisor'
import { writingAdviceSourceVersion } from './writingAdviceSource'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { applyChapterPlanEdit, type ChapterPlanInput } from './storyPlanTransactions'
import { buildChapterReviewSignature, buildReviewContextVersion } from './reconstructionReviewVersion'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'

export interface SaveWritingSuggestionInput {
  action: 'plan' | 'note'
  chapterId: string
  sourceVersion: string
  suggestion: WritingAdviceSuggestion
}

export function saveWritingSuggestion(aggregate: StoryAggregate, input: SaveWritingSuggestionInput,
  now: string, knowledge: KnowledgeBase[]): { changed: boolean; id: string } {
  const { novel, workspace } = aggregate, suggestion = input.suggestion
  const chapter = novel.chapters.find(item => item.id === input.chapterId)
  if (!chapter || chapter.status === 'locked') throw new Error('来源章节不存在或已锁定。')
  if (!suggestion.title.trim() || !suggestion.approach.trim()) throw new Error('写作建议缺少名称或内容。')
  const id = 'advice-' + input.action + ':' + buildAnalysisSourceVersionId(JSON.stringify([novel.id, chapter.id, input.sourceVersion, suggestion]))
  const note = { title: suggestion.title.trim(), content: [suggestion.approach, suggestion.nextBeat ? '下一拍：' + suggestion.nextBeat : '',
    suggestion.risk ? '注意：' + suggestion.risk : ''].filter(Boolean).join('\n').trim() }
  const plan: ChapterPlanInput = { horizon: 'next', title: suggestion.title.trim(), objective: (suggestion.storyEffect || suggestion.approach).trim(),
    summary: suggestion.approach.trim(), beats: suggestion.nextBeat.trim() ? [suggestion.nextBeat.trim()] : [],
    targetChapterStart: chapter.chapterIndex + 1, targetChapterEnd: chapter.chapterIndex + 1,
    relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'ai' }
  const existing = input.action === 'plan' ? novel.chapterPlans?.find(item => item.id === id) : chapter.sceneNotes?.find(item => item.id === id)
  if (existing) {
    const same = input.action === 'note' ? existing.title === note.title && 'content' in existing && existing.content === note.content
      : ['title', 'objective', 'summary', 'beats', 'targetChapterStart', 'targetChapterEnd'].every(key =>
        JSON.stringify((existing as ChapterPlan)[key as keyof ChapterPlan]) === JSON.stringify(plan[key as keyof ChapterPlanInput]))
    if (!same) throw new Error('这份建议已保存且内容被修改，未覆盖作者修改。')
    return { changed: false, id }
  }
  if (input.sourceVersion !== writingAdviceSourceVersion(novel, chapter, chapter.content, workspace.creationDraft,
    workspace.canonMutations, workspace.storyMemories, knowledge)) throw new Error('写作建议所依据的正文或资料已变化，请重新分析并核对。')
  if (input.action === 'plan') {
    applyChapterPlanEdit(aggregate, { action: 'create', data: plan }, now, () => id, knowledge)
  } else {
    const before = captureStoryImpact(novel, workspace)
    const signature = (item: Chapter) => buildChapterReviewSignature(item.content, buildReviewContextVersion(novel, item,
      knowledge, workspace.creationDraft, workspace.canonMutations, workspace.storyMemories))
    const inputs = new Map(novel.chapters.map(item => [item.id, signature(item)]))
    chapter.sceneNotes = [...(chapter.sceneNotes || []), { id, ...note, source: 'ai', createdAt: now, updatedAt: now }]
    chapter.updatedAt = now; novel.updatedAt = now
    const unchanged = novel.chapters.filter(item => inputs.get(item.id) === signature(item)).map(item => item.id)
    appendStoryImpactReport(aggregate, before, [{ target: { kind: 'chapter', id: chapter.id, label: chapter.title || '未命名章节' },
      action: 'update', fields: ['sceneNotes'] }], invalidateWrittenChapterReviews(aggregate, unchanged), now, () => id, undefined, 'changed-inputs')
  }
  return { changed: true, id }
}
