import type { AiRun } from '@/types/reconstruction'
import type { StoryMemoryTaskDraft } from './storyMemoryTask'
import type { Novel } from '@/types/novel'
import type { StoryMemoryScope } from '@/types/storyMemory'
import type { KnowledgeSummaryPlan } from './knowledgeSummary'
import { buildKnowledgeSummaryChunks } from './knowledgeSummaryCoverage'
import { resolveStoryMemorySource } from './storyMemory'

/** Scope summaries are derived from complete manuscript text, never future plans. */
export function planStoryMemorySummary(novel: Novel, scope: StoryMemoryScope, level: KnowledgeSummaryPlan['level'] = 'brief'): KnowledgeSummaryPlan {
  const source = resolveStoryMemorySource(novel, scope)
  const chunks = buildKnowledgeSummaryChunks(source.chapters.map(chapter => ({
    entryId: chapter.chapterId, sourceVersionId: chapter.sourceVersionId, title: '第' + (chapter.chapterIndex + 1) + '章 ' + chapter.title,
    category: '已写正文', tags: ['正文区间 ' + chapter.startOffset + '–' + chapter.endOffset], content: chapter.content,
  })))
  let count = chunks.length, plannedRequests = count
  while (count > 1) {
    plannedRequests += Math.floor(count / 4) + (count % 4 > 1 ? 1 : 0)
    count = Math.ceil(count / 4)
  }
  return { knowledgeBaseId: novel.id, sourceVersionId: source.versionId, title: novel.title + ' · ' + source.label,
    description: '仅回顾给定已写正文。区分客观发生、角色认知和未实现的打算；保留因果、人物变化、悬而未决的线索与原文来源。不补写未来情节，不将角色猜测写成事实。',
    level, chunks, plannedRequests }
}

/** Author-only persistence: no model lookup, graph planning, or paid request. */
export function createAuthorStoryMemoryRun(novelId: string, draft: StoryMemoryTaskDraft): AiRun {
  const createdAt = new Date().toISOString()
  return { id: crypto.randomUUID(), mode: 'assist', taskType: 'memory_update', targetId: novelId, status: 'queued', tokenBudget: draft.tokenBudget ?? 500000, requestLimit: draft.requestLimit ?? 64, usedTokens: 0, requests: [], createdAt, updatedAt: createdAt,
    memoryTask: { version: 1, scope: JSON.parse(JSON.stringify(draft.scope)), sourceVersionId: draft.sourceVersionId, openBaseline: draft.openBaseline, titleDraft: draft.title, bodyDraft: draft.body, level: draft.level, modelSignature: '', promptSignature: '', stage: 'draft', graph: [], finalNodeId: '', requests: [], reservedTokens: 0, currentInputTokens: 0, currentOutputTokens: 0, historicalInputTokens: 0, historicalOutputTokens: 0, usageEstimated: false, updatedAt: createdAt } }
}
