import { storyMemorySourceFingerprint } from './aiRunRequestValidation'
import type { StoryAggregate } from './storyAggregate'
import type { StoryMemoryRecord, StoryMemoryScope } from '@/types/storyMemory'
import type { KnowledgeSummaryCoverage } from '@/types/knowledge'
import { assertStoryMemoryRecord, createStoryMemoryBinding, resolveStoryMemorySource, storyMemorySignature } from './storyMemory'
import { validateReconstructionAiRun } from './reconstructionBackupValidation'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'

export interface SaveStoryMemoryInput {
  id: string
  title: string
  scope: StoryMemoryScope
  summary: string
  expectedSourceVersionId: string
  expectedRecord: string | null
  origin?: 'author' | 'ai'
  coverage?: KnowledgeSummaryCoverage
  taskRunId?: string
  expectedTaskUpdatedAt?: string
}

/** Apply only to a private aggregate, inside its persistence queue. */
export function confirmStoryMemory(aggregate: StoryAggregate, input: SaveStoryMemoryInput, now: string): StoryMemoryRecord {
  const records = aggregate.workspace.storyMemories || []
  const previous = records.find(record => record.id === input.id)
  const task = input.taskRunId ? (aggregate.workspace.aiRuns || []).find(run => run.id === input.taskRunId && run.taskType === 'memory_update') : undefined
  if (input.taskRunId && (!task?.memoryTask || task.memoryTask.stage !== 'awaiting_author' || task.memoryTask.updatedAt !== input.expectedTaskUpdatedAt || !task.memoryTask.candidate || task.memoryTask.candidate.sourceVersionId !== input.expectedSourceVersionId)) throw new Error('故事记忆候选任务已变化或尚未完成，请重新打开后核对。')
  if (input.origin === 'ai' && input.coverage?.leafEvidence && !task) throw new Error('增量摘要缺少对应任务证据')
  if (task) {
    validateReconstructionAiRun(task)
    const currentSource = resolveStoryMemorySource(aggregate.novel, input.scope)
    for (const node of task.memoryTask!.graph.filter(node => node.kind === 'leaf')) {
      const range = node.sourceRanges[0], fingerprint = node.sourceFingerprints[0]
      const chapter = currentSource.chapters.find(row => row.chapterId === range.entryId)
      if (!chapter || chapter.sourceVersionId !== range.sourceVersionId || chapter.content.length !== range.contentLength || storyMemorySourceFingerprint(chapter.content.slice(range.start, range.end)) !== fingerprint.digest) throw new Error('复用分段与当前正文不一致，未写入正式记忆')
    }
    if (JSON.stringify(task.memoryTask!.scope) !== JSON.stringify(input.scope) || task.memoryTask!.openBaseline !== (input.expectedRecord || 'null')) throw new Error('候选打开基线或范围已变化')
    if (input.origin === 'ai' && (task.memoryTask!.candidate!.summary.trim() !== input.summary.trim() || task.memoryTask!.candidate!.title.trim() !== input.title.trim() || JSON.stringify(task.memoryTask!.candidate!.coverage) !== JSON.stringify(input.coverage))) throw new Error('候选与覆盖证据不一致')
  }
  if ((previous ? JSON.stringify(previous) : null) !== input.expectedRecord) throw new Error('这份故事回顾已被修改，请重新载入后核对。')
  if (resolveStoryMemorySource(aggregate.novel, input.scope).versionId !== input.expectedSourceVersionId) throw new Error('来源正文或章节范围已变化，请重新载入当前来源后核对。')
  const source = createStoryMemoryBinding(aggregate.novel, input.scope, input.summary, input.origin || 'author', now, input.coverage)
  if (previous && previous.title === input.title && previous.summary === input.summary
    && JSON.stringify(previous.scope) === JSON.stringify(input.scope)
    && JSON.stringify({ ...previous.source, confirmedAt: undefined }) === JSON.stringify({ ...source, confirmedAt: undefined })) {
    if (task) { task.status = 'completed'; task.memoryTask!.stage = 'committed'; task.memoryTask!.updatedAt = now; task.updatedAt = now }
    return previous
  }
  const before = captureStoryImpact(aggregate.novel, aggregate.workspace)
  const inputs = new Map(aggregate.novel.chapters.filter(chapter => chapter.content.trim())
    .map(chapter => [chapter.id, storyMemorySignature(aggregate.novel, records, chapter.chapterIndex)]))
  const history = previous ? [...previous.history, {
    id: crypto.randomUUID(), title: previous.title, summary: previous.summary, scope: previous.scope, source: previous.source, replacedAt: now,
  }].slice(-20) : []
  const result: StoryMemoryRecord = JSON.parse(JSON.stringify({
    id: input.id, novelId: aggregate.novel.id, title: input.title, scope: input.scope, summary: input.summary, source, history,
  }))
  assertStoryMemoryRecord(result, aggregate.novel.id)
  aggregate.workspace.storyMemories = previous ? records.map(record => record.id === result.id ? result : record) : [...records, result]
  if (task) { task.status = 'completed'; task.memoryTask!.stage = 'committed'; task.memoryTask!.updatedAt = now; task.updatedAt = now }
  const changedIds = new Set(aggregate.novel.chapters.filter(chapter => inputs.has(chapter.id)
    && inputs.get(chapter.id) !== storyMemorySignature(aggregate.novel, aggregate.workspace.storyMemories!, chapter.chapterIndex)).map(chapter => chapter.id))
  const reviewChapterIds = changedIds.size ? invalidateWrittenChapterReviews(aggregate,
    aggregate.novel.chapters.filter(chapter => !changedIds.has(chapter.id)).map(chapter => chapter.id)) : []
  aggregate.novel.updatedAt = now
  appendStoryImpactReport(aggregate, before, [{ target: { kind: 'memory', id: result.id, label: result.title },
    action: previous ? 'update' : 'create', fields: previous ? ['title', 'scope', 'summary', 'source'] : ['$exists'] }],
    reviewChapterIds, now, () => crypto.randomUUID(), undefined, 'changed-inputs')
  return result
}
