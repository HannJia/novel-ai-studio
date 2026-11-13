import { validateStoryArcGraph } from './storyArcValidation'
export { validateStoryArcGraph } from './storyArcValidation'
import type { Novel, StoryArc, StoryArcNode } from '@/types/novel'
import { ARC_CANON_FIELDS, ARC_NODE_CANON_FIELDS, type EntitySource } from '@/types/entityProvenance'
import { appendEntityRevision, captureEntityRevision, projectCanonicalEntities } from './entityProvenance'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { resolveReviewEvidence } from './reviewEvidence'
import { registerChapterReviewInvalidation } from './chapterReviewInvalidationRequests'

export type ArcDefinition = Pick<StoryArc, typeof ARC_CANON_FIELDS[number]>
export type NodeDefinition = Pick<StoryArcNode, 'title' | 'description' | 'targetChapter' | 'prerequisiteNodeIds' | 'consequenceEventIds'>
export type StoryArcEdit =
  | { action: 'create'; definition: ArcDefinition; nodes?: NodeDefinition[]; planningSourceVersion?: string }
  | { action: 'update'; arcId: string; expectedArc: string; definition: ArcDefinition }
  | { action: 'delete'; arcId: string; expectedArc: string }
  | { action: 'add_node'; arcId: string; expectedArc: string; definition: NodeDefinition }
  | { action: 'update_node'; arcId: string; nodeId: string; expectedArc: string; definition: NodeDefinition }
  | { action: 'delete_node'; arcId: string; nodeId: string; expectedArc: string }
  | { action: 'node_status'; arcId: string; nodeId: string; expectedArc: string; status: 'pending' | 'completed' | 'abandoned'; source?: Extract<EntitySource, { kind: 'chapter' }> }

export interface ArcEditImpact { arcIds: string[]; nodeIds: string[]; chapterIds: string[]; reasons: Record<string, string[]>; reviewChapterIds: string[] }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const fail = (message: string): never => { throw new Error(message) }
export function arcPlanningSourceVersion(novel: Novel): string {
  return buildAnalysisSourceVersionId(JSON.stringify([novel.title, novel.outline, novel.settings,
    novel.characters.map(character => [character.id, character.name, character.aliases])]))
}

export function analyzeStoryArcImpact(novel: Novel, arcId: string, nodeId?: string): ArcEditImpact {
  const arcs = novel.storyArcs || []
  const affectedArcs = new Set([arcId]), affectedNodes = new Set(nodeId ? [nodeId] : arcs.find(arc => arc.id === arcId)?.nodes.map(node => node.id) || [])
  let changed = true
  while (changed) {
    changed = false
    for (const arc of arcs) {
      if (!affectedArcs.has(arc.id) && (arc.dependencyArcIds || []).some(id => affectedArcs.has(id))) { affectedArcs.add(arc.id); changed = true }
      for (const node of arc.nodes) {
        if (affectedArcs.has(arc.id) || (node.prerequisiteNodeIds || []).some(id => affectedNodes.has(id))) {
          if (!affectedNodes.has(node.id)) { affectedNodes.add(node.id); changed = true }
          if (!affectedArcs.has(arc.id)) { affectedArcs.add(arc.id); changed = true }
        }
      }
    }
  }
  const reasons: Record<string, string[]> = {}
  const add = (index: number | undefined, reason: string) => {
    for (const chapter of novel.chapters.filter(chapter => chapter.chapterIndex === index)) {
      const items = reasons[chapter.id] ||= []
      if (!items.includes(reason)) items.push(reason)
    }
  }
  for (const arc of arcs) if (affectedArcs.has(arc.id)) for (const node of arc.nodes) {
    add(node.targetChapter, '里程碑计划：' + node.title); add(node.actualChapter, '里程碑来源：' + node.title)
  }
  for (const plan of novel.chapterPlans || []) if (plan.relatedArcIds.some(id => affectedArcs.has(id))) {
    for (const chapter of novel.chapters) if (chapter.chapterIndex >= plan.targetChapterStart && chapter.chapterIndex <= plan.targetChapterEnd) add(chapter.chapterIndex, '章节计划：' + plan.title)
  }
  for (const event of novel.eventLog) if (event.relatedArcIds?.some(id => affectedArcs.has(id))
    || arcs.some(arc => affectedArcs.has(arc.id) && (arc.turningPointEventIds?.includes(event.id) || arc.nodes.some(node => affectedNodes.has(node.id) && node.consequenceEventIds?.includes(event.id))))) {
    add(event.chapterIndex, '相关事件：' + event.title); add(event.targetChapter, '事件计划：' + event.title)
  }
  // A preview only describes graph reachability. The transaction result fills
  // reviewChapterIds after comparing the actual before/after review inputs.
  return { arcIds: [...affectedArcs], nodeIds: [...affectedNodes], chapterIds: Object.keys(reasons), reasons, reviewChapterIds: [] }
}

function record(kind: 'arc' | 'arc_node', target: StoryArc | StoryArcNode, before: StoryArc | StoryArcNode | undefined, now: string, id: () => string, source: EntitySource = { kind: 'author' }, fields?: readonly string[]) {
  const revision = captureEntityRevision(kind, before, target, source, now, 'arc-revision:' + id(), fields)
  if (revision.changes.length) appendEntityRevision(target, revision)
}
function definition<T>(value: T, fields: readonly string[]): T {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !fields.includes(key))) fail('表单包含不可修改的编号、状态或来源字段。')
  return copy(value)
}

/** Applies only to the transaction's private draft. A failed validation never publishes it. */
export function applyStoryArcEdit(novel: Novel, edit: StoryArcEdit, now: string, id: () => string): ArcEditImpact {
  let arc: StoryArc
  if (edit.action === 'create') {
    if (edit.planningSourceVersion && edit.planningSourceVersion !== arcPlanningSourceVersion(novel)) fail('大纲或角色已变化，请重新提取剧情线建议。')
    const value = definition(edit.definition, ARC_CANON_FIELDS)
    if (!['active', 'paused', 'abandoned'].includes(value.status)) fail('新剧情线必须从计划状态开始。')
    arc = { ...value, id: id(), nodes: [], createdAt: now, updatedAt: now }
    for (const input of edit.nodes || []) {
      const node = { ...definition(input, ARC_NODE_CANON_FIELDS.filter(field => !['status', 'actualChapter'].includes(field))), id: id(), status: 'pending' as const, createdAt: now, updatedAt: now }
      record('arc_node', node, undefined, now, id); arc.nodes.push(node)
    }
    record('arc', arc, undefined, now, id)
    ;(novel.storyArcs ||= []).push(arc)
  } else {
    arc = novel.storyArcs?.find(arc => arc.id === edit.arcId) || fail('剧情线已删除，请重新打开。')
    if (JSON.stringify(arc) !== edit.expectedArc) fail('剧情线或节点在编辑期间发生变化，请重新打开核对。')
  }
  const impactBefore = analyzeStoryArcImpact(novel, arc.id, 'nodeId' in edit ? edit.nodeId : undefined)
  if (edit.action === 'update') {
    const before = copy(arc), value = definition(edit.definition, ARC_CANON_FIELDS)
    if (!['active', 'paused', 'completed', 'abandoned'].includes(value.status)) fail('请选择明确的剧情线状态。')
    Object.assign(arc, value)
    // Explicit author saving retains the arc as an author planning decision,
    // even when its chapter-born existence has expired. Node evidence is separate.
    record('arc', arc, before, now, id, { kind: 'author' }, ['$exists', ...Object.keys(value)])
  } else if (edit.action === 'delete') {
    if (arc.provenance?.revisions.some(rev => rev.source.kind === 'chapter') || arc.nodes.some(node => node.provenance?.revisions.some(rev => rev.source.kind === 'chapter'))) fail('这条剧情线已有正文来源，请保留历史并将状态设为已放弃。')
    const removed = new Set(arc.nodes.map(node => node.id))
    if (novel.eventLog.some(event => event.relatedArcIds?.includes(arc.id)) || novel.chapterPlans?.some(plan => plan.relatedArcIds.includes(arc.id))
      || novel.storyArcs?.some(other => other.id !== arc.id && (other.dependencyArcIds?.includes(arc.id) || other.nodes.some(node => node.prerequisiteNodeIds?.some(id => removed.has(id)))))) fail('仍有剧情线、节点、事件或章节计划引用此弧线，请先解除引用。')
    novel.storyArcs = novel.storyArcs!.filter(item => item.id !== arc.id)
  } else if (edit.action === 'add_node') {
    const node: StoryArcNode = { ...definition(edit.definition, ARC_NODE_CANON_FIELDS.filter(field => !['status', 'actualChapter'].includes(field))), id: id(), status: 'pending', createdAt: now, updatedAt: now }
    record('arc_node', node, undefined, now, id); arc.nodes.push(node)
  } else if ('nodeId' in edit) {
    const node = arc.nodes.find(node => node.id === edit.nodeId) || fail('里程碑已删除，请重新打开。')
    const before = copy(node)
    if (edit.action === 'delete_node') {
      if (node.provenance?.revisions.some(rev => rev.source.kind === 'chapter')) fail('该里程碑已有正文来源，请保留历史并标记放弃。')
      if (novel.storyArcs?.some(other => other.nodes.some(item => item.prerequisiteNodeIds?.includes(node.id)))) fail('其他里程碑依赖此节点，请先解除引用。')
      arc.nodes = arc.nodes.filter(item => item.id !== node.id)
    } else if (edit.action === 'update_node') {
      const value = definition(edit.definition, ARC_NODE_CANON_FIELDS.filter(field => !['status', 'actualChapter'].includes(field)))
      const completionChanged = (['title', 'description', 'prerequisiteNodeIds', 'consequenceEventIds'] as const).some(field =>
        Object.prototype.hasOwnProperty.call(value, field)
        && JSON.stringify(before[field] ?? (field.endsWith('Ids') ? [] : '')) !== JSON.stringify(value[field] ?? (field.endsWith('Ids') ? [] : '')))
      Object.assign(node, value)
      const fields = Object.keys(value)
      if (completionChanged && (node.status === 'completed' || node.status === 'unverified')) {
        node.status = 'pending'; delete node.actualChapter; fields.push('status', 'actualChapter')
      }
      record('arc_node', node, before, now, id, { kind: 'author' }, fields)
    } else if (edit.action === 'node_status') {
      if (edit.status === 'completed') {
        const source = copy(edit.source || fail('确认完成必须选择实际章节并提供原文证据。'))
        const chapter = novel.chapters.find(chapter => chapter.id === source.chapterId) || fail('来源章节不存在。')
        if (source.chapterIndex !== chapter.chapterIndex || !source.evidence.length) fail('来源章节或证据不完整。')
        source.evidence = source.evidence.map(evidence => {
          const located = resolveReviewEvidence(novel.chapters, { id: id(), sourceType: 'chapter', sourceId: source.chapterId, sourceVersionId: source.sourceVersionId, ...evidence })
          return { quote: located.quote, startOffset: located.startOffset, endOffset: located.endOffset }
        })
        const current = projectCanonicalEntities(novel, chapter.chapterIndex + 1).arcs.flatMap(arc => arc.nodes)
        if (node.prerequisiteNodeIds?.some(parent => !current.some(item => item.id === parent && item.status === 'completed' && item.actualChapter !== undefined && item.actualChapter <= chapter.chapterIndex))) fail('前置里程碑尚未在本章或更早章节确认完成。')
        node.status = 'completed'; node.actualChapter = chapter.chapterIndex
        record('arc_node', node, before, now, id, source, ['status', 'actualChapter'])
      } else {
        node.status = edit.status; delete node.actualChapter
        record('arc_node', node, before, now, id, { kind: 'author' }, ['status', 'actualChapter'])
      }
    }
    node.updatedAt = now
  }
  arc.updatedAt = now
  arc.nodes.sort((left, right) => left.targetChapter - right.targetChapter || left.createdAt.localeCompare(right.createdAt))
  validateStoryArcGraph(novel)
  const after = analyzeStoryArcImpact(novel, arc.id)
  const impact = { ...after, chapterIds: [...new Set([...impactBefore.chapterIds, ...after.chapterIds])],
    reasons: Object.fromEntries([...new Set([...Object.keys(impactBefore.reasons), ...Object.keys(after.reasons)])].map(id => [id, [...new Set([...(impactBefore.reasons[id] || []), ...(after.reasons[id] || [])])]])) }
  const reviewChapterIds = registerChapterReviewInvalidation(novel, novel.chapters.map(chapter => chapter.id))
  novel.updatedAt = now
  return { ...impact, reviewChapterIds }
}

export function formatArcDesign(arc: StoryArc): string {
  const fields: Array<[string, string | undefined]> = [['目标', arc.goal], ['冲突', arc.conflict], ['预期收束', arc.expectedResolution],
    ['初始状态', arc.initialState], ['渴望', arc.desire], ['恐惧', arc.fear], ['错误信念', arc.falseBelief], ['预期成长', arc.finalState]]
  return ['剧情规划（预期，不能作为已发生事实）', ...fields.filter(([, value]) => value?.trim()).map(([label, value]) => label + '：' + value),
    arc.dependencyArcIds?.length ? '前置剧情线 ID：' + arc.dependencyArcIds.join('、') : '',
    arc.turningPointEventIds?.length ? '转折事件 ID：' + arc.turningPointEventIds.join('、') : '',
  ].filter(Boolean).join('；')
}
