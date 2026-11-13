import type { StoryAggregate } from './storyAggregate'
import type { Novel } from '@/types/novel'
import type { StoryImpactChange, StoryImpactRef } from '@/types/storyImpact'
import type { StoryImpactSnapshot } from './storyImpactAnalysis'
import { CHARACTER_CANON_FIELDS, EVENT_CANON_FIELDS } from '@/types/entityProvenance'
import { applyEntityDefinitionEdit, type EntityDefinitionEdit } from './entityDefinitionEditing'
import { applyStoryArcEdit, type StoryArcEdit } from './storyArcEditing'
import { captureStoryImpact, buildStoryImpactReport } from './storyImpactAnalysis'
import { appendPlanningVersion, createPlanningSnapshot } from './planningVersions'
import { invalidateSceneApprovals, syncCreationDraftPlanning } from './reconstructionCreation'
import { registerChapterReviewInvalidation } from './chapterReviewInvalidationRequests'
import { projectStoryTimeTimeline, projectStoryTimeOrigin } from './storyTime'

const key = (kind: StoryImpactRef['kind'], id: string) => JSON.stringify([kind, id])
const fieldsFor = (edit: EntityDefinitionEdit): string[] => edit.action !== 'update' ? ['$exists']
  : Object.keys(edit.updates).filter(field => (edit.kind === 'character' ? CHARACTER_CANON_FIELDS : EVENT_CANON_FIELDS).some(item => item === field))

export type StoryContextField = 'title' | 'outline' | 'synopsis' | 'volumes' | 'writingStyle' | 'settings' | 'chapterLengthPolicy' | 'storyClock'
export interface StoryContextEdit {
  updates: Partial<Pick<Novel, 'title' | 'outline' | 'synopsis' | 'volumes' | 'writingStyle' | 'settings' | 'chapterLengthPolicy' | 'storyClock'>>
  fields: StoryContextField[]
  expectedBaseline?: string
}

export function captureStoryContextBaseline(novel: Novel): string {
  return JSON.stringify({
    title: novel.title,
    outline: novel.outline,
    synopsis: novel.synopsis,
    volumes: novel.volumes,
    writingStyle: novel.writingStyle,
    settings: novel.settings,
    chapterLengthPolicy: novel.chapterLengthPolicy,
    storyTime: { origin: projectStoryTimeOrigin(novel), chapters: projectStoryTimeTimeline(novel, Infinity) },
    targetWordCountMin: novel.targetWordCountMin,
    targetWordCountMax: novel.targetWordCountMax,
    knowledgeBaseIds: novel.knowledgeBaseIds,
    chapterPlanConfirmed: novel.chapterPlanConfirmed,
  })
}

function invalidateVolumePlanning(aggregate: StoryAggregate, volumeIds: string[], now: string) {
  aggregate.novel.chapterPlanConfirmed = false
  if (aggregate.workspace.creationDraft) {
    const previous = aggregate.workspace.creationDraft
    const next = syncCreationDraftPlanning(previous, aggregate.novel, now)
    const affectedVolumes = new Set(volumeIds.map(id => 'volume:' + id))
    const affectedPlans = new Set([...previous.chapterPlans, ...next.chapterPlans]
      .filter(plan => plan.volumeId && affectedVolumes.has(plan.volumeId)).map(plan => plan.id))
    aggregate.workspace.creationDraft = { ...next,
      volumes: next.volumes.map(volume => affectedVolumes.has(volume.id) ? { ...volume, approval: 'draft' } : volume),
      chapterPlans: next.chapterPlans.map(plan => affectedPlans.has(plan.id) ? { ...plan, approval: 'draft' } : plan),
      scenePlans: invalidateSceneApprovals(next.scenePlans, affectedPlans),
      approval: { ...next.approval, 'volume-outline': 'draft',
        ...(affectedPlans.size ? { 'chapter-outline': 'draft', 'scene-outline': 'draft' } as const : {}) },
    }
  }
}

export function invalidateWrittenChapterReviews(aggregate: StoryAggregate, excludedChapterIds: string[] = []): string[] {
  const excluded = new Set(excludedChapterIds)
  return registerChapterReviewInvalidation(aggregate.novel, aggregate.novel.chapters.filter(chapter => !excluded.has(chapter.id)).map(chapter => chapter.id))
}

export function appendStoryImpactReport(aggregate: StoryAggregate, before: StoryImpactSnapshot, changes: StoryImpactChange[],
  reviewChapterIds: string[], now: string, id: () => string, after = captureStoryImpact(aggregate.novel, aggregate.workspace),
  reviewPolicy: 'all-written' | 'changed-inputs' = 'all-written') {
  const report = buildStoryImpactReport(before, after, changes, reviewChapterIds, now, 'impact:' + id(), reviewPolicy)
  ;(aggregate.workspace.impactReports ||= []).push(report)
  return report
}

export function editNovelContextWithImpact(aggregate: StoryAggregate, edit: StoryContextEdit, now: string, id: () => string) {
  const { novel } = aggregate
  if (Object.prototype.hasOwnProperty.call(edit.updates, 'storyClock')) throw new Error('故事时间必须通过起点或章节时间确认入口修改。')
  if (edit.expectedBaseline && edit.expectedBaseline !== captureStoryContextBaseline(novel)) {
    throw new Error('作品总纲或分卷规划已经变化，请刷新后再保存。')
  }
  const before = captureStoryImpact(novel, aggregate.workspace)
  const updates = JSON.parse(JSON.stringify(edit.updates)) as StoryContextEdit['updates']
  if (updates.volumes) updates.volumes = updates.volumes.map(volume => ({ ...volume, versions: volume.versions || [] }))
  const fields = edit.fields.filter(field => Object.prototype.hasOwnProperty.call(updates, field)
    && JSON.stringify(novel[field]) !== JSON.stringify(updates[field]))
  if (!fields.length) return false
  Object.assign(novel, updates, { updatedAt: now })
  const after = captureStoryImpact(novel, aggregate.workspace)
  const target = after.refs.get(key('novel', novel.id)) || before.refs.get(key('novel', novel.id))
  if (!target) throw new Error('找不到作品设定影响对象，未保存。')
  const reviewChapterIds = invalidateWrittenChapterReviews(aggregate)
  appendStoryImpactReport(aggregate, before, [{ target, action: 'update', fields }], reviewChapterIds, now, id, after)
  return true
}

export function editVolumeWithImpact(aggregate: StoryAggregate, volumeId: string, expectedVolume: string | undefined,
  updates: Partial<Novel['volumes'][number]>, now: string, id: () => string) {
  const current = aggregate.novel.volumes.find(volume => volume.id === volumeId)
  if (!current || expectedVolume !== undefined && JSON.stringify(current) !== expectedVolume) {
    throw new Error('分卷规划已经变化或删除，请刷新后再保存。')
  }
  const allowed = ['title', 'theme', 'summary', 'keyTurningPoints', 'characterChanges', 'estimatedChapters', 'estimatedWordCount'] as const
  if (Object.keys(updates).some(field => !allowed.some(key => key === field))) throw new Error('分卷编辑不能修改编号、排序或历史记录。')
  const next = { ...current, ...JSON.parse(JSON.stringify(updates)) } as Novel['volumes'][number]
  const fields = allowed.filter(field => current[field] !== next[field])
  if (!fields.length) return false
  const before = captureStoryImpact(aggregate.novel, aggregate.workspace)
  next.versions = appendPlanningVersion(current.versions, createPlanningSnapshot(current), '编辑前版本', now)
  Object.assign(current, next)
  aggregate.novel.updatedAt = now
  invalidateVolumePlanning(aggregate, [volumeId], now)
  const after = captureStoryImpact(aggregate.novel, aggregate.workspace)
  const target = after.refs.get(key('volume', volumeId)) || before.refs.get(key('volume', volumeId))
  if (!target) throw new Error('找不到分卷影响对象，未保存。')
  appendStoryImpactReport(aggregate, before, [{ target, action: 'update', fields }],
    invalidateWrittenChapterReviews(aggregate), now, id, after)
  return true
}

export function editVolumeCollectionWithImpact(aggregate: StoryAggregate, volumes: Novel['volumes'], expectedBaseline: string,
  now: string, id: () => string) {
  if (JSON.stringify(aggregate.novel.volumes) !== expectedBaseline) throw new Error('分卷规划已经变化，请刷新后重试。')
  const previousVolumes = aggregate.novel.volumes
  const previousById = new Map(previousVolumes.map(volume => [volume.id, volume]))
  const nextVolumes: Novel['volumes'] = JSON.parse(JSON.stringify(volumes))
  const ids = new Set<string>()
  for (const [index, volume] of nextVolumes.entries()) {
    if (!volume.id?.trim() || ids.has(volume.id)) throw new Error('分卷编号为空或重复，未保存。')
    ids.add(volume.id)
    volume.volumeIndex = index
    const old = previousById.get(volume.id)
    volume.versions = old ? (createPlanningSnapshot(old) === createPlanningSnapshot(volume)
      ? old.versions || [] : appendPlanningVersion(old.versions, createPlanningSnapshot(old), '编辑前版本', now)) : volume.versions || []
  }
  const fieldsForVolume = (volume: Novel['volumes'][number], old: Novel['volumes'][number]) => {
    const next = JSON.parse(createPlanningSnapshot(volume)), previous = JSON.parse(createPlanningSnapshot(old))
    return Object.keys(next).filter(field => next[field] !== previous[field])
  }
  const changes: StoryImpactChange[] = []
  for (const volume of nextVolumes) {
    const old = previousById.get(volume.id), fields = old ? fieldsForVolume(volume, old) : ['$exists']
    if (fields.length) changes.push({ target: { kind: 'volume', id: volume.id, label: volume.title || '未命名' }, action: old ? 'update' : 'create', fields })
  }
  for (const old of previousVolumes) if (!ids.has(old.id)) changes.push({ target: { kind: 'volume', id: old.id, label: old.title || '未命名' }, action: 'delete', fields: ['$exists'] })
  if (!changes.length) return false
  const oldByIndex = new Map(previousVolumes.map(volume => [volume.volumeIndex, volume.id]))
  const newIndex = new Map(nextVolumes.map(volume => [volume.id, volume.volumeIndex]))
  const assignments = aggregate.novel.chapters.map(chapter => {
    const oldId = oldByIndex.get(chapter.volumeIndex)
    const volumeIndex = oldId ? newIndex.get(oldId) ?? -1 : chapter.volumeIndex
    if (chapter.status === 'locked' && volumeIndex !== chapter.volumeIndex) throw new Error('分卷调整会改变已锁定章节的归属，请先解锁章节。')
    return { chapter, volumeIndex }
  })
  const before = captureStoryImpact(aggregate.novel, aggregate.workspace)
  aggregate.novel.volumes = nextVolumes
  for (const { chapter, volumeIndex } of assignments) if (chapter.volumeIndex !== volumeIndex) {
    chapter.volumeIndex = volumeIndex
    chapter.updatedAt = now
  }
  aggregate.novel.updatedAt = now
  invalidateVolumePlanning(aggregate, changes.map(change => change.target.id), now)
  const after = captureStoryImpact(aggregate.novel, aggregate.workspace)
  appendStoryImpactReport(aggregate, before, changes, invalidateWrittenChapterReviews(aggregate), now, id, after)
  return true
}

/** The report is part of the same private aggregate as the edit, never a later save. */
export function editDefinitionsWithImpact(aggregate: StoryAggregate, edits: EntityDefinitionEdit[], now: string, id: () => string) {
  const { novel, workspace } = aggregate
  const before = edits.some(edit => fieldsFor(edit).length) ? captureStoryImpact(novel, workspace) : undefined
  const changes: StoryImpactChange[] = []
  const results = edits.map(edit => {
    if (edit.action === 'delete' && edit.kind === 'character' && workspace.creationDraft?.scenePlans.some(scene => scene.approval !== 'rejected' && scene.viewpointCharacterId === edit.entityId)) {
      throw new Error('场景设计仍引用此人物作为视角，请先解除关联。')
    }
    const old = edit.action === 'create' ? undefined : (edit.kind === 'character' ? novel.characters : novel.eventLog).find(item => item.id === edit.entityId)
    const oldLabel = old && ('name' in old ? old.name : old.title)
    const result = applyEntityDefinitionEdit(novel, edit, now, id)
    const fields = fieldsFor(edit)
    if (fields.length) {
      const entity = result.entity || old!
      changes.push({ target: { kind: edit.kind, id: entity.id, label: result.entity ? ('name' in entity ? entity.name : entity.title) : oldLabel! }, action: edit.action, fields })
    }
    return result
  })
  if (before && changes.length) {
    appendStoryImpactReport(aggregate, before, changes, results.flatMap(result => result.reviewChapterIds), now, id)
  }
  return results
}

export function editStoryArcWithImpact(aggregate: StoryAggregate, edit: StoryArcEdit, now: string, id: () => string) {
  const { novel, workspace } = aggregate
  const before = captureStoryImpact(novel, workspace)
  const result = applyStoryArcEdit(novel, edit, now, id)
  const after = captureStoryImpact(novel, workspace)
  let target: StoryImpactRef | undefined
  if (edit.action === 'create') target = [...after.refs.values()].find(ref => ref.kind === 'arc' && !before.refs.has(key(ref.kind, ref.id)))
  else if (edit.action === 'add_node') target = [...after.refs.values()].find(ref => ref.kind === 'node' && ref.parentId === edit.arcId && !before.refs.has(key(ref.kind, ref.id)))
  else {
    const targetKey = 'nodeId' in edit ? key('node', edit.nodeId) : key('arc', edit.arcId)
    target = after.refs.get(targetKey) || before.refs.get(targetKey)
  }
  if (!target) throw new Error('找不到本次修改的剧情对象，未保存。')
  const action = edit.action === 'create' || edit.action === 'add_node' ? 'create'
    : edit.action === 'delete' || edit.action === 'delete_node' ? 'delete' : edit.action === 'node_status' ? 'confirm' : 'update'
  const fields = 'definition' in edit ? Object.keys(edit.definition) : edit.action === 'node_status' ? ['status', 'actualChapter'] : ['$exists']
  appendStoryImpactReport(aggregate, before, [{ target, action, fields }], result.reviewChapterIds, now, id, after)
  return result
}
