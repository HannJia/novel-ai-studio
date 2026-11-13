import type { CreationDraft, ScenePlan } from '@/types/reconstruction'
import type { ScenePlanningRecovery, SceneRecoveryEdit } from '@/types/planningRecovery'
import { assertScenePlanningRecovery } from './planningRecoveryValidation'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function sceneRecovery(draft?: CreationDraft): ScenePlanningRecovery {
  return draft?.sceneRecovery || { editors: [], options: [], revisions: [], attempts: [], selections: [] }
}
export function isSceneRecoveryEdit(edit: { kind: string }): edit is SceneRecoveryEdit {
  return ['scene-editor', 'scene-discard-editor', 'scene-revision', 'scene-attempt', 'scene-selection'].includes(edit.kind)
}
export function canFlushSceneRecovery(edit: SceneRecoveryEdit): boolean {
  return edit.kind !== 'scene-attempt' || !['queued', 'running'].includes(edit.value.status)
}
export function sceneContentSignature(scenes: ScenePlan[]): string {
  return JSON.stringify(scenes.map(scene => [scene.title, scene.purpose, scene.viewpointCharacterId || '',
    scene.locationId || '', scene.conflict || '', scene.requiredActions, scene.informationChanges, scene.outputState]))
}

/** Append-only versions and monotonic checkpoints; no formal scene array is touched. */
export function applySceneRecovery(draft: CreationDraft, edit: SceneRecoveryEdit): CreationDraft {
  const state = copy(sceneRecovery(draft))
  if (edit.kind === 'scene-editor') {
    const prior = state.editors.find(row => row.id === edit.value.id)
    if (prior && prior.chapterPlanId !== edit.value.chapterPlanId) throw new Error('场景编辑草稿不能跨章节改写')
    if (prior && prior.sequence > edit.value.sequence) return draft
    if (prior && prior.sequence === edit.value.sequence && !same(prior, edit.value)) throw new Error('场景草稿同一版本内容冲突，输入仍保留')
    state.editors = [...state.editors.filter(row => row.id !== edit.value.id), copy(edit.value)]
  } else if (edit.kind === 'scene-discard-editor') {
    const prior = state.editors.find(row => row.id === edit.id)
    if (prior && JSON.stringify(prior) !== edit.expected) throw new Error('恢复草稿已有新输入，未删除')
    state.editors = state.editors.filter(row => row.id !== edit.id)
  } else if (edit.kind === 'scene-attempt') {
    const prior = state.attempts.find(row => row.id === edit.value.id)
    if (prior) {
      for (const key of ['chapterPlanId', 'parentAttemptId', 'mode', 'baseline', 'modelId', 'modelSettings', 'messages', 'input', 'createdAt'] as const) {
        if (!same(prior[key], edit.value[key])) throw new Error('不能改写场景请求的原始输入')
      }
      if (prior.sequence > edit.value.sequence) return draft
      if (prior.sequence === edit.value.sequence && !same(prior, edit.value)) throw new Error('场景请求检查点版本冲突')
      if (!edit.value.output.startsWith(prior.output)) throw new Error('不能删除已保存的场景部分输出')
      if (!['queued', 'running'].includes(prior.status) && ['queued', 'running'].includes(edit.value.status)) throw new Error('中断请求只能显式新建重试，不能自动恢复运行')
    }
    state.attempts = prior ? state.attempts.map(row => row.id === edit.value.id ? copy(edit.value) : row) : [...state.attempts, copy(edit.value)]
  } else if (edit.kind === 'scene-revision') {
    if (edit.revision.optionId !== edit.option.id || edit.revision.chapterPlanId !== edit.option.chapterPlanId
      || edit.option.revisionId !== edit.revision.id) throw new Error('场景方案与版本身份不匹配')
    const existing = state.revisions.find(row => row.id === edit.revision.id)
    if (existing) {
      if (!same(existing, edit.revision)) throw new Error('场景历史版本不可改写')
      return draft // A retried durable write must not reset a newer head or selection.
    }
    const prior = state.options.find(row => row.id === edit.option.id)
    if (!prior && edit.expectedRevisionId) throw new Error('原场景方案不存在，输入仍保留')
    if (prior && (prior.chapterPlanId !== edit.option.chapterPlanId || prior.createdAt !== edit.option.createdAt)) throw new Error('场景方案身份不可改写')
    state.revisions.push(copy(edit.revision))
    // A concurrent save becomes a retained branch, never a replacement of the newer head.
    if (!prior || prior.revisionId === edit.expectedRevisionId) state.options = [...state.options.filter(row => row.id !== edit.option.id), copy(edit.option)]
  } else {
    state.selections = [...state.selections.filter(row => row.chapterPlanId !== edit.value.chapterPlanId), copy(edit.value)]
  }
  assertScenePlanningRecovery(state)
  return { ...draft, sceneRecovery: state }
}
