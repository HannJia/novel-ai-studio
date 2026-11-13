import type { CandidateChange, CanonMutationRecord, ChapterReview, ReviewFinding } from '@/types/reconstruction'
import type { StoryAggregate } from './storyAggregate'
import { acceptCandidateChange, canFinalizeChapter, isFindingBlocking, resolveFinding } from './reconstructionReview'
import { applyCandidateChangeToCanon } from './reconstructionCanon'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
import { assertRepeatedCharacterMemoryDecision } from './characterMemoryIdentity'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildReviewContextVersion, buildChapterReviewSourceVersion, type ReviewKnowledgeRevisions } from './reconstructionReviewVersion'
import { inspectChapterLength, resolveChapterLengthPolicy } from './chapterLength'
import { getApprovedPlanning } from './reconstructionPlanning'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'
import { retainCompletedCandidateSource } from './chapterReviewInvalidationRequests'
import type { StoryImpactChange, StoryImpactKind } from '@/types/storyImpact'

export interface StoryDecisionOptions<T> {
  characterMemoryDecision?: CharacterMemoryAuthorDecision
  expectedRecord: T
  expectedSourceVersionId: string
  authorNote?: string
}
export type FindingDecisionStatus = 'accepted' | 'intentional' | 'deferred'

export function storyDecisionSourceVersion(aggregate: StoryAggregate, chapterId: string, knowledge: ReviewKnowledgeRevisions): string {
  const chapter = aggregate.novel.chapters.find(chapter => chapter.id === chapterId)
  if (!chapter) throw new Error('来源章节已不存在。')
  return buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(aggregate.novel, chapter, knowledge,
    aggregate.workspace.creationDraft, aggregate.workspace.canonMutations, aggregate.workspace.storyMemories))
}

function assertDecision<T extends CandidateChange | ReviewFinding>(aggregate: StoryAggregate, record: T,
  knowledge: ReviewKnowledgeRevisions, options?: StoryDecisionOptions<T>): string {
  const chapter = aggregate.novel.chapters.find(chapter => chapter.id === record.chapterId)
  if (!chapter) throw new Error('来源章节已不存在。')
  if (chapter.status === 'locked') throw new Error('章节已锁定，请先解锁再处理审核。')
  if ('novelId' in record && record.novelId && record.novelId !== aggregate.novel.id) throw new Error('该记录不属于当前作品。')
  const version = storyDecisionSourceVersion(aggregate, chapter.id, knowledge)
  if (options && JSON.stringify(record) !== JSON.stringify(options.expectedRecord)) throw new Error('候选或审核问题已经变化，本次决定未保存，请重新核对。')
  if (options && version !== options.expectedSourceVersionId) throw new Error('正文或审核依据已经变化，本次决定未保存，请重新审核。')
  if (!record.sourceVersionId || record.sourceVersionId !== buildAnalysisSourceVersionId(chapter.content)) {
    throw new Error('来源正文版本缺失或已经变化，请重新审核或分析。')
  }
  return version
}

function assertPendingCandidate(aggregate: StoryAggregate, candidate: CandidateChange) {
  if (aggregate.workspace.canonMutations.some(record => record.candidateId === candidate.id)) throw new Error('该候选已入库，请通过正式设定编辑处理后续变化。')
  if (candidate.status !== 'proposed' && candidate.status !== 'deferred') throw new Error('该候选已处理或已失效，请重新核对。')
}

function refreshDecisionSnapshot(aggregate: StoryAggregate, chapterId: string, version: string, now: string) {
  const chapter = aggregate.novel.chapters.find(chapter => chapter.id === chapterId)!
  const contentVersion = buildAnalysisSourceVersionId(chapter.content)
  for (const review of aggregate.workspace.chapterReviews || []) {
    if (review.chapterId !== chapterId || review.sourceVersionId !== version || review.status === 'approved') continue
    review.findings = aggregate.workspace.reviewFindings.filter(finding => finding.chapterId === chapterId)
    review.candidateChanges = aggregate.workspace.candidates.filter(candidate => candidate.chapterId === chapterId
      && (!candidate.sourceVersionId || candidate.sourceVersionId === contentVersion))
    review.status = review.deterministicChecksPassed && review.semanticChecksPassed === true && !review.findings.some(isFindingBlocking)
      ? 'ready_to_finalize' : 'needs_revision'
    review.completedAt = now
  }
}

function impactChangeForAcceptedCandidate(aggregate: StoryAggregate, candidate: CandidateChange, record: CanonMutationRecord,
  before: ReturnType<typeof captureStoryImpact>): StoryImpactChange | undefined {
  let kind: StoryImpactKind | undefined
  let id = record.targetId
  let action: StoryImpactChange['action'] = 'confirm'
  let fields: string[] = []
  if (record.entityChanges?.length) {
    const revision = record.entityChanges[0]
    kind = revision.entityType === 'arc_node' ? 'node' : revision.entityType
    id = revision.entityId
    action = before.refs.has(JSON.stringify([kind, id])) ? 'update' : 'create'
    fields = revision.changes.map(change => change.field)
  } else if (record.characterState) {
    kind = 'character'
    id = record.characterState.after.characterId
    fields = [record.characterState.kind === 'knowledge' ? 'knowledge' : 'relationship']
  } else if (candidate.type === 'timeline') {
    kind = 'chapter'
    id = record.chapterId
    fields = ['storyTime']
  } else if (candidate.type === 'state') {
    kind = 'character'
    const value = JSON.parse(candidate.proposedValue) as { characterId?: string }
    id = value.characterId || candidate.targetId
    fields = ['status']
  }
  if (!kind || !id || !fields.length) return undefined
  const after = captureStoryImpact(aggregate.novel, aggregate.workspace)
  const target = after.refs.get(JSON.stringify([kind, id])) || before.refs.get(JSON.stringify([kind, id]))
  if (!target) return undefined
  return { target, action, fields: [...new Set(fields)] }
}

export function acceptStoryChange(aggregate: StoryAggregate, candidateId: string, now: string,
  knowledge: ReviewKnowledgeRevisions = [], editedValue?: string, options?: StoryDecisionOptions<CandidateChange>): CanonMutationRecord {
  const existing = aggregate.workspace.canonMutations.find(record => record.candidateId === candidateId)
  const candidate = aggregate.workspace.candidates.find(candidate => candidate.id === candidateId)
  if (!candidate?.chapterId) throw new Error('找不到候选的来源章节。')
  if (existing) {
    assertRepeatedCharacterMemoryDecision(existing, options?.characterMemoryDecision)
    const intended = editedValue ?? options?.expectedRecord.proposedValue ?? candidate.proposedValue
    if (intended !== candidate.proposedValue || (options && options.expectedRecord.sourceVersionId !== candidate.sourceVersionId)
      || (options?.authorNote?.trim() && options.authorNote.trim() !== candidate.authorNote)) {
      throw new Error('该候选已经以其他内容或作者说明入库，请重新核对。')
    }
    return existing
  }
  assertPendingCandidate(aggregate, candidate)
  const version = assertDecision(aggregate, candidate, knowledge, options)
  retainCompletedCandidateSource(aggregate.novel, candidate.chapterId)
  const accepted = acceptCandidateChange(candidate, now, editedValue)
  if (options?.authorNote?.trim()) accepted.authorNote = options.authorNote.trim()
  const beforeImpact = captureStoryImpact(aggregate.novel, aggregate.workspace)
  const mutation = applyCandidateChangeToCanon(aggregate.novel, accepted, now, aggregate.workspace.canonMutations, options?.characterMemoryDecision)
  const { record } = mutation
  aggregate.workspace.candidates = aggregate.workspace.candidates.map(candidate => candidate.id === candidateId ? accepted : candidate)
  aggregate.workspace.canonMutations.push(record)
  aggregate.novel.updatedAt = now
  refreshDecisionSnapshot(aggregate, candidate.chapterId, version, now)
  if (mutation.changed) {
    const change = impactChangeForAcceptedCandidate(aggregate, accepted, record, beforeImpact)
    if (change) {
      // The coordinator still invalidates a changed source review. Only its
      // completed analysis can survive an own-candidate decision on the same body.
      const reviewChapterIds = invalidateWrittenChapterReviews(aggregate, [candidate.chapterId])
      appendStoryImpactReport(aggregate, beforeImpact, [change], reviewChapterIds, now, () => candidateId)
    }
  }
  return record
}

export function rejectStoryChange(aggregate: StoryAggregate, candidateId: string, now: string, knowledge: ReviewKnowledgeRevisions = [],
  options?: StoryDecisionOptions<CandidateChange>): void {
  decidePendingStoryChange(aggregate, candidateId, 'rejected', now, knowledge, options)
}

export function deferStoryChange(aggregate: StoryAggregate, candidateId: string, now: string, knowledge: ReviewKnowledgeRevisions = [],
  options?: StoryDecisionOptions<CandidateChange>): void {
  decidePendingStoryChange(aggregate, candidateId, 'deferred', now, knowledge, options)
}

function decidePendingStoryChange(aggregate: StoryAggregate, candidateId: string, status: 'rejected' | 'deferred', now: string,
  knowledge: ReviewKnowledgeRevisions, options?: StoryDecisionOptions<CandidateChange>): void {
  const candidate = aggregate.workspace.candidates.find(candidate => candidate.id === candidateId)
  if (!candidate?.chapterId) throw new Error('找不到候选的来源章节。')
  assertPendingCandidate(aggregate, candidate)
  const version = assertDecision(aggregate, candidate, knowledge, options)
  Object.assign(candidate, { status, authorNote: options?.authorNote?.trim() || candidate.authorNote
    || (status === 'deferred' ? '作者延后处理，定稿前仍需确认或忽略。' : '作者忽略此候选变化'), updatedAt: now })
  refreshDecisionSnapshot(aggregate, candidate.chapterId, version, now)
}

export function resolveStoryFinding(aggregate: StoryAggregate, findingId: string, status: FindingDecisionStatus,
  now: string, knowledge: ReviewKnowledgeRevisions = [], options?: StoryDecisionOptions<ReviewFinding>): void {
  const finding = aggregate.workspace.reviewFindings.find(finding => finding.id === findingId)
  if (!finding) throw new Error('审核问题已不存在。')
  if (finding.status !== 'open' && finding.status !== 'deferred') throw new Error('该审核问题已处理或已失效，请重新审核。')
  const version = assertDecision(aggregate, finding, knowledge, options)
  const note = options?.authorNote?.trim() || finding.authorNote || (status === 'intentional' ? '作者确认这是有意设计。'
    : status === 'deferred' ? '作者延后处理；阻塞问题仍需在定稿前解决。' : '作者已处理该问题。')
  Object.assign(finding, resolveFinding(finding, status, note))
  refreshDecisionSnapshot(aggregate, finding.chapterId, version, now)
}

export function finalizeStoryChapter(aggregate: StoryAggregate, chapterId: string, expectedVersion: string, now: string,
  knowledge: ReviewKnowledgeRevisions = []): ChapterReview {
  const { novel, workspace } = aggregate
  const beforeImpact = captureStoryImpact(novel, workspace)
  const impactRoots: Array<{ kind: 'plan' | 'scene'; id: string; action: 'create' | 'confirm'; fields: string[] }> = []
  const chapter = novel.chapters.find(chapter => chapter.id === chapterId)
  if (!chapter || chapter.status === 'locked') throw new Error('章节不存在或已锁定。')
  const currentVersion = storyDecisionSourceVersion(aggregate, chapterId, knowledge)
  if (currentVersion !== expectedVersion) throw new Error('正文或审核依据已经变化，请重新审核后定稿。')
  const review = (workspace.chapterReviews || []).find(review => review.chapterId === chapterId && review.sourceVersionId === currentVersion)
  if (!review) throw new Error('当前正文缺少有效的结构化审核记录。')
  const findings = new Map<string, ReviewFinding>(review.findings.map(finding => [finding.id, finding]))
  for (const finding of workspace.reviewFindings.filter(finding => finding.chapterId === chapterId)) findings.set(finding.id, finding)
  if (!canFinalizeChapter({ ...review, findings: [...findings.values()] }, currentVersion)) throw new Error('章节审核尚未通过，或仍有阻塞问题未处理。')
  if (inspectChapterLength(chapter.content, resolveChapterLengthPolicy(novel.chapterLengthPolicy)).status !== 'within') throw new Error('章节篇幅尚未达标，不能定稿。')
  const contentVersion = buildAnalysisSourceVersionId(chapter.content)
  const candidates = workspace.candidates.filter(candidate => candidate.chapterId === chapterId
    && (!candidate.sourceVersionId || candidate.sourceVersionId === contentVersion))
  if (candidates.some(candidate => candidate.status === 'proposed' || candidate.status === 'deferred')) throw new Error('还有故事变化候选待处理，不能定稿。')
  if (candidates.some(candidate => ['accepted', 'edited'].includes(candidate.status)
    && !workspace.canonMutations.some(record => record.candidateId === candidate.id))) throw new Error('存在已确认但未成功入库的候选，请先完成入库。')
  Object.assign(review, { findings: [...findings.values()], candidateChanges: candidates, status: 'approved', completedAt: now })
  chapter.status = 'finalized'
  chapter.updatedAt = now
  novel.updatedAt = now

  const rangeFinalized = (start: number, end: number) => {
    const covered = novel.chapters.filter(chapter => chapter.chapterIndex >= start && chapter.chapterIndex <= end)
    return covered.length === end - start + 1 && covered.every(chapter => ['finalized', 'locked'].includes(chapter.status))
  }
  for (const plan of novel.chapterPlans || []) {
    if (plan.horizon === 'next' && ['planned', 'active', 'awaiting_review'].includes(plan.status)
      && rangeFinalized(plan.targetChapterStart, plan.targetChapterEnd)) {
      Object.assign(plan, { status: 'completed', updatedAt: now })
      impactRoots.push({ kind: 'plan', id: plan.id, action: 'confirm', fields: ['status'] })
    }
  }
  const approvedPlans = getApprovedPlanning(workspace.creationDraft, chapter.chapterIndex, novel)?.chapters || []
  for (const plan of workspace.creationDraft?.chapterPlans || []) {
    const approved = approvedPlans.find(item => item.id === plan.id)
    if (!approved || plan.number < 1 || !rangeFinalized(plan.number - 1, (plan.endNumber ?? plan.number) - 1)) continue
    plan.status = 'completed'
    impactRoots.push({ kind: 'plan', id: plan.id, action: 'confirm', fields: ['status'] })
    for (const scene of workspace.creationDraft?.scenePlans || []) {
      if (approved.scenes.some(item => item.id === scene.id)) {
        scene.status = 'completed'
        impactRoots.push({ kind: 'scene', id: scene.id, action: 'confirm', fields: ['status'] })
      }
    }
  }
  const nextIndex = chapter.chapterIndex + 1
  novel.chapterPlans ||= []
  if (!novel.chapterPlans.some(plan => plan.horizon === 'next' && plan.targetChapterStart <= nextIndex && plan.targetChapterEnd >= nextIndex)) {
    const near = novel.chapterPlans.find(plan => plan.horizon === 'near' && ['planned', 'active'].includes(plan.status) && plan.targetChapterEnd >= nextIndex)
    const nextPlan = { id: 'next-plan:' + buildAnalysisSourceVersionId(novel.id + ':' + chapter.id), horizon: 'next' as const, status: 'planned' as const,
      title: '第 ' + (nextIndex + 1) + ' 章计划', objective: near?.objective || '承接上一章结果，推动当前剧情目标继续发展',
      summary: near ? '从近期规划「' + near.title + '」中补齐下一章：' + near.summary : '请在写作前补充本章冲突、推进节拍与收束条件。',
      beats: near?.beats?.slice(0, 3) || [], targetChapterStart: nextIndex, targetChapterEnd: nextIndex,
      relatedArcIds: near?.relatedArcIds || [], relatedEventIds: near?.relatedEventIds || [], source: 'user' as const, versions: [], createdAt: now, updatedAt: now }
    novel.chapterPlans.push(nextPlan)
    impactRoots.push({ kind: 'plan', id: nextPlan.id, action: 'create', fields: ['$exists'] })
  }
  if (impactRoots.length) {
    const after = captureStoryImpact(novel, workspace)
    const changes = impactRoots.map(root => ({ ...root, target: after.refs.get(JSON.stringify([root.kind, root.id])) || beforeImpact.refs.get(JSON.stringify([root.kind, root.id])) }))
      .filter((change): change is typeof change & { target: NonNullable<typeof change.target> } => Boolean(change.target))
      .map(({ target, action, fields }) => ({ target, action, fields }))
    if (changes.length) appendStoryImpactReport(aggregate, beforeImpact, changes, [], now, () => 'finalize:' + chapter.id, after)
  }
  return review
}
