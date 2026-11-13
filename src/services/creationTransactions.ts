import type { Novel } from '@/types/novel'
import type { CreationDraft, PlotSkeleton, StoryContract, SkeletonSourceSelection } from '@/types/reconstruction'
import { captureSkeletonBaselines, mixSkeletonRevisions, saveSkeletonRevision, skeletonContentSignature } from './creationDraft'
import { recoverPartialSkeletons } from './plotSkeletonResponse'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import type { StoryAggregate } from './storyAggregate'
import type { StoryImpactChange } from '@/types/storyImpact'
import { buildCreationOutlineImport } from './creationOutlineImport'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, captureStoryContextBaseline, editDefinitionsWithImpact, editNovelContextWithImpact,
  editVolumeCollectionWithImpact, invalidateWrittenChapterReviews } from './storyImpactTransactions'
import { buildPlotSkeletonFromOutline, buildConfirmedSkeletonConstraint, confirmCreationSkeleton, confirmStoryContract, createCreationDraftFromNovel,
  reviseCreationSkeleton, reviseStoryContract, syncCreationDraftFromOutline, syncCreationDraftPlanning } from './reconstructionCreation'

export type CreationEdit =
  | { action: 'initialize' }
  | { action: 'contract'; contract: StoryContract; confirm: boolean }
  | { action: 'skeleton'; selectedId: string; skeleton?: PlotSkeleton; authorComplete?: boolean }
  | { action: 'new-skeleton' }
  | { action: 'mix-skeleton'; sources: SkeletonSourceSelection[] }
  | { action: 'restore-skeleton'; revisionId: string }
  | { action: 'recover-skeleton-output'; attemptId: string }
  | { action: 'confirm-skeleton' }
  | { action: 'skeleton-candidates'; candidates: PlotSkeleton[]; attemptId?: string }
  | { action: 'outline-candidate'; content: string; source: 'author' | 'model'; importSkeleton?: boolean; complete?: boolean }
  | { action: 'accept-outline'; content: string }

function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'updatedAt' && key !== 'cardConfirmations').map(([key, item]) => [key, semantic(item)]))
  return value
}

export function creationDirectionSignature(draft: CreationDraft): string {
  return JSON.stringify(semantic([draft.contract, draft.approval.contract, draft.approval.skeleton,
    draft.skeletons.find(item => item.id === draft.selectedSkeletonId) ? skeletonContentSignature(draft.skeletons.find(item => item.id === draft.selectedSkeletonId)!) : undefined]))
}

/** Pending directions do not affect manuscript reviews; withdrawing a confirmed one does. */
function confirmedCreationDirectionSignature(draft?: CreationDraft): string {
  const contract = draft?.contract.approval === 'approved' && draft.approval.contract === 'approved' ? draft.contract : undefined
  const skeleton = contract && draft?.approval.skeleton === 'approved'
    ? draft.skeletons.find(item => item.id === draft.selectedSkeletonId && item.approval === 'approved') : undefined
  return JSON.stringify(semantic([contract, skeleton ? skeletonContentSignature(skeleton) : undefined]))
}

/** Capture at form-open/request time, not when a delayed result is about to save. */
export function captureCreationBaseline(novel: Novel, draft?: CreationDraft): string {
  // Checkpoints do not rebase an open form or a paid request. Candidate content does.
  const editing = draft ? { ...draft, editorDrafts: undefined, skeletonAttempts: undefined, skeletonHistory: undefined, editingSkeletonId: undefined, sceneRecovery: undefined } : undefined
  return JSON.stringify([captureStoryContextBaseline(novel), editing, novel.characters, novel.eventLog, novel.chapterPlans])
}

/** Operates only on the transaction's private aggregate. Publish all parts after durable commit. */
export function applyCreationEdit(aggregate: StoryAggregate, edit: CreationEdit, expected: string, now: string, id: () => string): boolean {
  const { novel, workspace } = aggregate
  if (captureCreationBaseline(novel, workspace.creationDraft) !== expected) {
    throw new Error('作品契约、规划或相关设定已经变化，本次结果未保存，请重新核对后再操作。')
  }
  const before = captureStoryImpact(novel, workspace)
  const initialDraft = workspace.creationDraft
  const initialNovel = JSON.stringify(novel)
  const reportStart = workspace.impactReports?.length || 0
  let draft = initialDraft || createCreationDraftFromNovel(novel, now)
  const priorDirection = confirmedCreationDirectionSignature(initialDraft)
  const changes: StoryImpactChange[] = []
  const target = { kind: 'novel' as const, id: novel.id, label: novel.title }
  let fields: string[] = []
  let bindImportedOutline = false

  if (edit.action === 'initialize') {
    if (!initialDraft && novel.outline.trim()) draft = syncCreationDraftFromOutline(draft, novel, novel.outline, now)
    draft = captureSkeletonBaselines(draft, now, id)
    fields = ['creationDraft']
  } else if (edit.action === 'contract') {
    draft = edit.confirm ? confirmStoryContract(draft, edit.contract, now) : reviseStoryContract(draft, edit.contract, now)
    if (edit.confirm) editNovelContextWithImpact(aggregate, { updates: { title: draft.contract.title.trim() }, fields: ['title'] }, now, id)
    fields = ['creationDraft.contract']
  } else if (edit.action === 'skeleton') {
    draft = captureSkeletonBaselines(draft, now, id)
    const skeleton = edit.skeleton && { ...edit.skeleton, complete: edit.authorComplete ? true : edit.skeleton.complete }
    draft = reviseCreationSkeleton(draft, edit.selectedId, skeleton, now, id)
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'new-skeleton') {
    draft = saveSkeletonRevision(draft, { id: id(), title: '', premise: '', logline: '', promise: '', ending: '', beats: [], approval: 'draft', complete: true, updatedAt: now }, 'author', now, id)
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'mix-skeleton') {
    draft = captureSkeletonBaselines(draft, now, id)
    const mixed = mixSkeletonRevisions(draft, edit.sources, now, id)
    draft = saveSkeletonRevision(draft, mixed, 'mixed', now, id, { sources: edit.sources })
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'restore-skeleton') {
    const version = draft.skeletonHistory?.find(item => item.id === edit.revisionId)
    if (!version) throw new Error('骨架版本不存在')
    draft = saveSkeletonRevision(draft, { ...version.snapshot, id: id(), approval: 'draft' }, 'restored', now, id, { parentRevisionId: version.id })
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'recover-skeleton-output') {
    const attempt = draft.skeletonAttempts?.find(item => item.id === edit.attemptId)
    if (!attempt?.output.trim()) throw new Error('没有可恢复的骨架输出')
    let candidates = recoverPartialSkeletons(novel, attempt.output, now)
    if (!candidates.length) candidates = [{ id: id(), title: '待补齐的恢复方案', premise: attempt.output, logline: '', promise: '', ending: '', beats: [], approval: 'draft', complete: false, updatedAt: now }]
    const ids: string[] = []
    for (const candidate of candidates) {
      const saved = { ...candidate, id: id() }; ids.push(saved.id)
      draft = saveSkeletonRevision(draft, saved, 'restored', now, id, { attemptId: attempt.id })
    }
    draft.skeletonAttempts = draft.skeletonAttempts!.map(item => item.id === attempt.id ? { ...item, candidateIds: [...item.candidateIds, ...ids] } : item)
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'confirm-skeleton') {
    draft = captureSkeletonBaselines(draft, now, id)
    const confirmed = confirmCreationSkeleton(draft, now)
    if (confirmed !== draft) {
      bindImportedOutline = confirmed.outlineCandidate?.source === 'author'
        && (confirmed.outlineCandidate.skeletonId === confirmed.selectedSkeletonId
          || !initialDraft?.selectedSkeletonId && !confirmed.outlineCandidate.skeletonId)
      draft = saveSkeletonRevision(confirmed, confirmed.skeletons.find(item => item.id === confirmed.selectedSkeletonId)!, 'confirmed', now, id)
    }
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'skeleton-candidates') {
    if (draft.contract.approval !== 'approved' || draft.approval.contract !== 'approved') throw new Error('请先确认作品契约')
    if (!edit.candidates.length || edit.candidates.some(candidate => candidate.approval !== 'draft')) throw new Error('故事骨架候选无效')
    const attempt = edit.attemptId ? draft.skeletonAttempts?.find(item => item.id === edit.attemptId) : undefined
    if (edit.attemptId && (!attempt || attempt.baseline !== expected)) throw new Error('骨架请求来源已变化')
    if (attempt?.candidateIds.length) return false
    for (const candidate of edit.candidates) {
      if (draft.skeletons.some(item => item.id === candidate.id)) throw new Error('新候选编号与已有骨架重复')
      draft = saveSkeletonRevision(draft, candidate, 'model', now, id, { attemptId: edit.attemptId })
    }
    if (attempt) draft.skeletonAttempts = draft.skeletonAttempts!.map(item => item.id === attempt.id ? { ...item, candidateIds: edit.candidates.map(candidate => candidate.id) } : item)
    fields = ['creationDraft.skeletons']
  } else if (edit.action === 'outline-candidate') {
    const content = edit.content.trim()
    if (!content) throw new Error('请填写有效的大纲内容')
    if (draft.contract.approval !== 'approved' || draft.approval.contract !== 'approved') throw new Error('请先确认作品契约')
    if (edit.source === 'model') buildConfirmedSkeletonConstraint(draft)
    if (edit.importSkeleton) draft = saveSkeletonRevision(draft, { ...buildPlotSkeletonFromOutline(novel, content, now), id: id() }, 'import', now, id)
    draft = { ...draft, outlineCandidate: { content, source: edit.source, complete: edit.complete ?? true,
      skeletonId: edit.importSkeleton ? draft.editingSkeletonId : draft.selectedSkeletonId, contextBaseline: captureStoryContextBaseline(novel),
      directionSignature: creationDirectionSignature(draft), updatedAt: now }, updatedAt: now }
    fields = ['creationDraft.outlineCandidate']
  } else {
    buildConfirmedSkeletonConstraint(draft)
    const content = edit.content.trim(), candidate = draft.outlineCandidate
    const accepted = draft.acceptedOutline
    if (!candidate && accepted) {
      if (accepted.contentSignature === buildAnalysisSourceVersionId(content) && accepted.directionSignature === creationDirectionSignature(draft) && content === novel.outline.trim()) return false
      throw new Error('正式故事方向或大纲已变化，请先核对并保存大纲候选，再确认规划')
    }
    if (candidate?.complete === false) throw new Error('大纲候选未完整生成，请先补齐并保存作者修改')
    if (!content || content !== (candidate?.content ?? novel.outline).trim()) throw new Error('待确认的大纲已经变化，请先保存作者修改')
    if (candidate && (candidate.contextBaseline !== captureStoryContextBaseline(novel)
      || candidate.directionSignature !== creationDirectionSignature(draft))) throw new Error('大纲候选的来源设定或故事方向已经变化，请重新生成或编辑核对后保存')
    if (candidate?.skeletonId && candidate.skeletonId !== draft.selectedSkeletonId) throw new Error('请先确认这份大纲对应的故事骨架，或核对当前方向后重新保存大纲')
    const imported = buildCreationOutlineImport(novel, content)
    workspace.creationDraft = draft
    editNovelContextWithImpact(aggregate, { updates: { title: draft.contract.title.trim(), outline: content }, fields: ['title', 'outline'] }, now, id)
    if (imported.definitions.length) editDefinitionsWithImpact(aggregate, imported.definitions, now, id)
    if (imported.volumes.length) editVolumeCollectionWithImpact(aggregate, imported.volumes, JSON.stringify(novel.volumes), now, id)
    draft = syncCreationDraftPlanning(workspace.creationDraft!, novel, now)
    draft.acceptedOutline = { contentSignature: buildAnalysisSourceVersionId(content), directionSignature: creationDirectionSignature(draft), confirmedAt: now }
    delete draft.outlineCandidate
    if (novel.status !== 'writing') { novel.status = 'writing'; fields.push('status') }
    fields.push('creationDraft.outlineCandidate')
  }

  if (JSON.stringify(semantic(initialDraft)) === JSON.stringify(semantic(draft))
    && JSON.stringify(initialDraft?.contract.cardConfirmations) === JSON.stringify(draft.contract.cardConfirmations)
    && initialNovel === JSON.stringify(novel)) return false
  workspace.creationDraft = draft
  const reports = (workspace.impactReports || []).splice(reportStart)
  changes.push(...reports.flatMap(report => report.changes))
  const reviewIds = new Set(reports.flatMap(report => report.reviewChapterIds))
  if (priorDirection !== confirmedCreationDirectionSignature(draft)) {
    novel.chapterPlanConfirmed = false
    for (const chapter of invalidateWrittenChapterReviews(aggregate)) reviewIds.add(chapter)
  }
  if (bindImportedOutline && draft.outlineCandidate) draft.outlineCandidate = { ...draft.outlineCandidate,
    directionSignature: creationDirectionSignature(draft), contextBaseline: captureStoryContextBaseline(novel) }
  if (fields.length) changes.push({ target, action: initialDraft ? 'update' : 'create', fields })
  novel.updatedAt = now
  appendStoryImpactReport(aggregate, before, changes, [...reviewIds], now, id)
  return true
}
