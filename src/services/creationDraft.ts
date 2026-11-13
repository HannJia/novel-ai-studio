import type { CreationDraft, CreationEditorDraft, PlotSkeleton, SkeletonGenerationAttempt, SkeletonRevision, SkeletonSourceSelection } from '@/types/reconstruction'
import type { SceneRecoveryEdit } from '@/types/planningRecovery'
import { applySceneRecovery, isSceneRecoveryEdit } from './planningRecovery'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
export function skeletonContentSignature(value: PlotSkeleton): string {
  return JSON.stringify([value.title, value.premise, value.logline, value.promise, value.ending,
    value.beats.map(({ id: _id, ...beat }) => beat), value.complete !== false])
}
export function skeletonCompletionIssues(value: PlotSkeleton): string[] {
  const issues: string[] = []
  if (!value.title.trim() || !value.premise.trim() || !value.ending.trim()) issues.push('请补齐方案名称、故事前提和结局方向')
  if (!value.logline.trim() || !value.promise.trim()) issues.push('请补齐一句话主线和读者承诺，未定内容也需明确标记')
  if (!value.beats.length || value.beats.some(beat => !beat.title.trim() || !beat.description.trim())) issues.push('请至少填写一个完整关键节点，并补齐每个节点的名称和内容')
  if (value.complete === false) issues.push('这是未完整生成的候选，请核对补齐并明确保存作者版本')
  return issues
}
/** The initial snapshots preserve legacy candidates before the first new edit. */
export function ensureSkeletonHistory(draft: CreationDraft, now: string, id: () => string): CreationDraft {
  const next = copy(draft)
  next.skeletonHistory ||= []
  for (const skeleton of next.skeletons) {
    if (skeleton.revisionId) continue
    skeleton.revisionId = id()
    next.skeletonHistory.push({ id: skeleton.revisionId, skeletonId: skeleton.id, kind: 'legacy', snapshot: copy(skeleton), sources: [], createdAt: now })
  }
  return next
}
export function saveSkeletonRevision(draft: CreationDraft, skeleton: PlotSkeleton, kind: SkeletonRevision['kind'], now: string, id: () => string,
  source: { parentRevisionId?: string; attemptId?: string; sources?: SkeletonSourceSelection[] } = {}): CreationDraft {
  const next = ensureSkeletonHistory(draft, now, id)
  const old = next.skeletons.find(item => item.id === skeleton.id)
  const saved = copy({ ...skeleton, revisionId: id(), updatedAt: now })
  next.skeletonHistory!.push({ id: saved.revisionId!, skeletonId: saved.id, kind, snapshot: copy(saved),
    parentRevisionId: source.parentRevisionId || old?.revisionId, attemptId: source.attemptId,
    sources: copy(source.sources || []), createdAt: now })
  next.skeletons = [...next.skeletons.filter(item => item.id !== saved.id), saved]
  next.editingSkeletonId = saved.id
  next.updatedAt = now
  return next
}

export function mixSkeletonRevisions(draft: CreationDraft, sources: SkeletonSourceSelection[], now: string, id: () => string): PlotSkeleton {
  const result: PlotSkeleton = { id: id(), title: '', premise: '', logline: '', promise: '', ending: '', beats: [], approval: 'draft', complete: true, updatedAt: now }
  const selectedFields = new Set<string>()
  for (const source of sources) {
    const revision = draft.skeletonHistory?.find(item => item.id === source.revisionId)
    if (!revision) throw new Error('混合来源版本不存在，请重新选择')
    if (revision.snapshot.complete === false) result.complete = false
    if (source.field === 'beat') {
      const beat = revision.snapshot.beats.find(item => item.id === source.beatId)
      if (!beat || !source.targetBeatId || result.beats.some(item => item.id === source.targetBeatId)) throw new Error('混合节点来源或目标编号无效')
      result.beats.push({ ...copy(beat), id: source.targetBeatId })
    } else {
      if (selectedFields.has(source.field)) throw new Error('每个骨架字段只能选取一个版本')
      selectedFields.add(source.field)
      result[source.field] = revision.snapshot[source.field]
    }
  }
  if (selectedFields.size !== 5) throw new Error('请为五个骨架字段分别选择来源')
  return result
}

export type CreationRecoveryEdit =
  | SceneRecoveryEdit
  | { kind: 'editor'; value: CreationEditorDraft }
  | { kind: 'discard-editor'; id: string; expected: string }
  | { kind: 'attempt'; value: SkeletonGenerationAttempt }

/** Recovery writes cannot change formal direction, candidates, Canon or manuscript. */
export function applyCreationRecovery(draft: CreationDraft, edit: CreationRecoveryEdit): CreationDraft {
  if (isSceneRecoveryEdit(edit)) return applySceneRecovery(draft, edit)
  const next = copy(draft)
  if (edit.kind === 'editor') {
    next.editorDrafts = [...(next.editorDrafts || []).filter(item => item.id !== edit.value.id), copy(edit.value)]
  } else if (edit.kind === 'discard-editor') {
    const old = next.editorDrafts?.find(item => item.id === edit.id)
    if (old && JSON.stringify(old) !== edit.expected) throw new Error('作者草稿已更新，未移除新输入')
    next.editorDrafts = next.editorDrafts?.filter(item => item.id !== edit.id)
  } else {
    const prior = next.skeletonAttempts?.find(item => item.id === edit.value.id)
    if (prior) {
      for (const key of ['baseline', 'modelId', 'modelSettings', 'messages', 'createdAt', 'parentAttemptId', 'mode'] as const) {
        if (JSON.stringify(prior[key]) !== JSON.stringify(edit.value[key])) throw new Error('不能改写骨架请求的原始来源')
      }
      if (!edit.value.output.startsWith(prior.output)) throw new Error('不能删除已落盘的骨架部分输出')
      if (!['queued', 'running'].includes(prior.status) && ['queued', 'running'].includes(edit.value.status)) throw new Error('已结束请求不能重新记为运行中；重试必须建立新请求')
      if (prior.candidateIds.some(id => !edit.value.candidateIds.includes(id))) throw new Error('不能删除已保存候选的请求来源')
    }
    next.skeletonAttempts = prior ? next.skeletonAttempts!.map(item => item.id === edit.value.id ? copy(edit.value) : item)
      : [...(next.skeletonAttempts || []), copy(edit.value)]
  }
  // Recovery metadata deliberately does not advance the editing baseline.
  return next
}
