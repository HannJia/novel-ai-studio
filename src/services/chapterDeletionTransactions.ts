import type { Chapter, Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { StoryImpactChange } from '@/types/storyImpact'
import type { StoryAggregate } from './storyAggregate'
import { buildReviewContextVersion, type ReviewKnowledgeRevisions } from './reconstructionReviewVersion'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport } from './storyImpactTransactions'
import { withCurrentStoryEntities } from './effectiveStory'
import { invalidateStoryTimeSources } from './storyTime'

/** Opaque opening/request snapshot. IDs, never display positions, select the deletion. */
export interface ChapterDeletionBaseline {
  readonly novelId: string
  readonly chapterId?: string
  readonly novel: string
  readonly workspace: string
}

export function captureChapterDeletionBaseline(novel: Novel, chapterId?: string, workspace = ''): ChapterDeletionBaseline {
  return Object.freeze({ novelId: novel.id, chapterId, novel: JSON.stringify(novel), workspace })
}

export function assertChapterDeletionBaseline(novel: Novel, chapterId: string | undefined, baseline: ChapterDeletionBaseline) {
  if (baseline.novelId !== novel.id || baseline.chapterId !== chapterId || baseline.novel !== JSON.stringify(novel)) {
    throw new Error('章节、顺序或故事依据已经变化，请重新打开删除确认。')
  }
}

/**
 * Numeric links are not stable identities. A deletion does not authorize moving a
 * planned event, resetting elapsed time, or re-confirming chapter-derived facts.
 * Source-bound history may stay only when the existing projection excludes it.
 */
function assertNumericLinks(novel: Novel, workspace: ReconstructionWorkspaceSnapshot, next: Novel, removed: Chapter[]) {
  const first = Math.min(...removed.map(chapter => chapter.chapterIndex))
  const issues: string[] = []
  const check = (index: number | undefined, path: string) => {
    if (index !== undefined && index >= first) issues.push(path)
  }
  const effective = withCurrentStoryEntities(next)
  for (const character of effective.characters) check(character.firstAppearChapter, `人物「${character.name}」.firstAppearChapter`)
  for (const event of effective.eventLog) for (const field of ['chapterIndex', 'targetChapter', 'lastProgressChapterIndex', 'resolvedChapterIndex'] as const) {
    check(event[field], `事件「${event.title}」.${field}`)
  }
  for (const arc of effective.storyArcs || []) for (const node of arc.nodes) {
    check(node.targetChapter, `里程碑「${node.title}」.targetChapter`)
    check(node.actualChapter, `里程碑「${node.title}」.actualChapter`)
  }
  for (const plan of novel.chapterPlans || []) {
    check(plan.targetChapterEnd, `章节计划「${plan.title}」.targetChapterStart/End`)
  }
  for (const plan of workspace.creationDraft?.chapterPlans || []) {
    check((plan.endNumber ?? plan.number) - 1, `场景章纲「${plan.title}」.number/endNumber`)
  }
  check(novel.storyClock?.lastChapterIndex, '故事时间.lastChapterIndex')
  // New chapters default this mirror to zero. Meaningful values still feed the
  // V3 story-time form directly, so require author review before reindexing.
  for (const chapter of novel.chapters) if (chapter.chapterIndex >= first
    && (chapter.storyDay !== undefined || (chapter.storyDaysElapsed !== undefined && chapter.storyDaysElapsed !== 0))) {
    issues.push(`章节「${chapter.title}」.storyDay/storyDaysElapsed`)
  }
  // Source-bound time records are invalidated below. Numeric form associations
  // above must be reviewed before the chapter order changes.
  for (const item of novel.dataPanels || []) {
    check(item.lastMentionChapterIndex, `数据「${item.name}」.lastMentionChapterIndex`)
    for (const field of item.fields) for (const rule of field.automationRules || []) {
      check(rule.lastEvaluatedChapterIndex, `数据规则「${item.name}/${field.name}/${rule.id}」.lastEvaluatedChapterIndex`)
      check(rule.pendingChapterIndex, `数据规则「${item.name}/${field.name}/${rule.id}」.pendingChapterIndex`)
    }
  }
  for (const change of novel.dataPanelChanges || []) {
    // Accepted data still projects its stored value without checking its source.
    // Until that projection supports deletion, do not silently retain it as fact.
    if (change.status === 'accepted' || change.sourceBinding?.kind === 'author' || !change.sourceBinding) {
      check(change.chapterIndex, `数据决定「${change.id}」.chapterIndex（需来源投影）`)
    }
  }
  for (const proposal of novel.storyStateProposals || []) if (!proposal.chapterSource) {
    check(proposal.chapterIndex, `故事提案「${proposal.id}」.chapterIndex（无稳定来源）`)
  }
  for (const run of workspace.aiRuns || []) if (['queued', 'running', 'paused', 'needs_author'].includes(run.status)) {
    if (run.chapterEnd !== undefined) check(run.chapterEnd, `任务「${run.id}」.chapterStart/End`)
    else if (!run.targetId || removed.some(chapter => chapter.id === run.targetId)) issues.push(`任务「${run.id}」.targetId`)
  }
  if (issues.length) throw new Error('删除会改变尚未可靠映射的章节数字关联，未保存；请先核对：' + issues.slice(0, 8).join('；')
    + (issues.length > 8 ? `；另有 ${issues.length - 8} 项` : ''))
}

/** Mutate only a private aggregate; the caller saves and then publishes it. */
export function deleteChaptersWithImpact(aggregate: StoryAggregate, chapterId: string | undefined,
  baseline: ChapterDeletionBaseline, now: string, id: () => string, knowledge: ReviewKnowledgeRevisions = []): boolean {
  const { novel, workspace } = aggregate
  const removed = novel.chapters.filter(chapter => chapterId === undefined || chapter.id === chapterId)
  if (!removed.length) return false
  assertChapterDeletionBaseline(novel, chapterId, baseline)
  const ids = new Set<string>(), indices = new Set<number>()
  for (const chapter of novel.chapters) {
    if (!chapter.id.trim() || ids.has(chapter.id) || !Number.isSafeInteger(chapter.chapterIndex)
      || chapter.chapterIndex < 0 || indices.has(chapter.chapterIndex)) throw new Error('章节稳定 ID 或顺序无效，未删除。')
    ids.add(chapter.id); indices.add(chapter.chapterIndex)
  }
  const deleted = new Set(removed.map(chapter => chapter.id))
  const remaining = novel.chapters.filter(chapter => !deleted.has(chapter.id)).sort((a, b) => a.chapterIndex - b.chapterIndex)
  if (removed.some(chapter => chapter.status === 'locked')
    || remaining.some((chapter, index) => chapter.status === 'locked' && chapter.chapterIndex !== index)) {
    throw new Error('删除会移除或重排已锁定章节，请先解锁。')
  }
  const next = { ...novel, chapters: remaining.map((chapter, chapterIndex) => ({ ...chapter, chapterIndex })) }
  assertNumericLinks(novel, workspace, next, removed)
  const context = (book: Novel, chapter: Chapter) => buildReviewContextVersion(book, chapter, knowledge,
    workspace.creationDraft, workspace.canonMutations, workspace.storyMemories)
  const changed = new Set(next.chapters.filter(chapter => context(novel, remaining.find(row => row.id === chapter.id)!)
    !== context(next, chapter)).map(chapter => chapter.id))
  // A custom cross-chapter evidence link absent from the shared context signature
  // cannot be invalidated safely by merely clearing the chapter's display flag.
  for (const review of workspace.chapterReviews || []) if (!deleted.has(review.chapterId) && !changed.has(review.chapterId)
    && review.findings.some(finding => finding.evidence.some(evidence => evidence.sourceType === 'chapter' && deleted.has(evidence.sourceId)))) {
    throw new Error('审核包含未纳入统一输入的跨章证据，无法安全失效，请先重新核对审核来源。')
  }
  const before = captureStoryImpact(novel, workspace)
  novel.archivedChapters = [...(novel.archivedChapters || []), ...removed.map(chapter => ({
    ...JSON.parse(JSON.stringify(chapter)), archivedAt: now,
  }))].sort((a, b) => a.archivedAt.localeCompare(b.archivedAt) || a.id.localeCompare(b.id))
  const changes: StoryImpactChange[] = removed.map(chapter => ({
    target: { kind: 'chapter', id: chapter.id, label: `第 ${chapter.chapterIndex + 1} 章 ${chapter.title || '未命名'}` },
    action: 'delete', fields: ['$exists', 'content'],
  }))
  for (const [index, chapter] of remaining.entries()) if (chapter.chapterIndex !== index) {
    changes.push({ target: { kind: 'chapter', id: chapter.id, label: chapter.title || '未命名' }, action: 'update', fields: ['chapterIndex'] })
    chapter.chapterIndex = index
    chapter.updatedAt = now
  }
  novel.chapters = remaining
  invalidateStoryTimeSources(novel)
  novel.currentWordCount = remaining.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  novel.updatedAt = now
  for (const chapter of remaining) if (changed.has(chapter.id)) {
    chapter.contentReviewSignature = ''
    chapter.contentReviewCoverage = undefined
    chapter.reviewRewriteBlockedSignature = ''
    if (['completed', 'reviewed', 'finalized'].includes(chapter.status)) chapter.status = chapter.content.trim() ? 'writing' : 'draft'
    chapter.updatedAt = now
  }
  for (const candidate of workspace.candidates) if ((deleted.has(candidate.chapterId || '') || changed.has(candidate.chapterId || '')
    || candidate.evidence.some(evidence => evidence.sourceType === 'chapter' && deleted.has(evidence.sourceId)))
    && (candidate.status === 'proposed' || candidate.status === 'deferred')) {
    candidate.status = 'stale'
    candidate.updatedAt = now
  }
  // Review rows, findings, author notes, Canon mutations and memories retain their
  // original IDs/versions/decisions. Missing or reordered sources are historical,
  // never rebound to the chapter which happens to inherit the old display number.
  appendStoryImpactReport(aggregate, before, changes, [...changed], now, id, undefined, 'changed-inputs')
  return true
}

