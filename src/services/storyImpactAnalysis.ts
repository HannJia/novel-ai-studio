import { projectEventCausality, eventCausalityLabels } from './eventCausality'
import type { Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { StoryImpactChange, StoryImpactItem, StoryImpactRef, StoryImpactReport } from '@/types/storyImpact'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { assertStoryImpactReport } from './storyImpactValidation'
import { dataPanelReferenceInput } from './dataPanel'
import { dataPanelProvenanceInput } from './dataPanelReference'
import { projectStoryTimeTimeline, projectStoryTimeOrigin } from './storyTime'

const key = (ref: Pick<StoryImpactRef, 'kind' | 'id'>) => JSON.stringify([ref.kind, ref.id])
type Edge = { to: string; relation: string; kind: 'dependency' | 'association' }
export interface StoryImpactSnapshot {
  novelId: string
  version: string
  refs: Map<string, StoryImpactRef>
  edges: Map<string, Edge[]>
  terms: Map<string, string[]>
  chapters: Array<{ ref: StoryImpactRef; content: string }>
}

/** Capture explicit references only. Text matches are collected separately. */
export function captureStoryImpact(novel: Novel, workspace: ReconstructionWorkspaceSnapshot): StoryImpactSnapshot {
  const refs = new Map<string, StoryImpactRef>(), edges = new Map<string, Edge[]>(), terms = new Map<string, string[]>()
  const ref = (kind: StoryImpactRef['kind'], id: string, label: string, parentId?: string) => {
    const value: StoryImpactRef = { kind, id, label: label.trim() || '未命名', ...(parentId ? { parentId } : {}) }
    refs.set(key(value), value); return value
  }
  const edge = (from: string, to: string, relation: string, kind: Edge['kind'] = 'dependency') => {
    if (from === to || !refs.has(from) || !refs.has(to)) return
    const list = edges.get(from) || []
    if (!list.some(item => item.to === to && item.relation === relation && item.kind === kind)) list.push({ to, relation, kind })
    edges.set(from, list)
  }
  const k = (kind: StoryImpactRef['kind'], id: string) => key({ kind, id })
  const novelRef = ref('novel', novel.id, novel.title)
  const chapters = novel.chapters.map(chapter => ({ ref: ref('chapter', chapter.id, '第 ' + (chapter.chapterIndex + 1) + ' 章 ' + chapter.title), content: chapter.content, volumeIndex: chapter.volumeIndex }))
  for (const volume of novel.volumes || []) {
    const target = ref('volume', volume.id, volume.title)
    edge(key(novelRef), key(target), '作品包含分卷', 'association')
    for (const chapter of chapters) if (chapter.volumeIndex === volume.volumeIndex) edge(key(target), key(chapter.ref), '分卷规划覆盖章节')
  }
  for (const chapter of chapters) edge(key(novelRef), key(chapter.ref), '作品设定影响章节审核')
  const chapterAt = (from: string, index: number | undefined, reason: string) => {
    if (index === undefined || index < 0) return
    for (const chapter of novel.chapters) if (chapter.chapterIndex === index) edge(from, k('chapter', chapter.id), reason)
  }
  const chapterRange = (from: string, start: number, end: number, reason: string) => {
    for (const chapter of novel.chapters) if (chapter.chapterIndex >= start && chapter.chapterIndex <= end) edge(from, k('chapter', chapter.id), reason)
  }
  const names = new Map<string, Set<string>>()
  for (const character of novel.characters) {
    const target = ref('character', character.id, character.name)
    const labels = [...new Set([character.name, ...character.aliases].map(s => s.trim()).filter(Boolean))]
    terms.set(key(target), labels)
    for (const name of labels) { const ids = names.get(name) || new Set<string>(); ids.add(character.id); names.set(name, ids) }
  }
  for (const event of novel.eventLog || []) { const target = ref('event', event.id, event.title); terms.set(key(target), [event.title.trim()].filter(Boolean)) }
  for (const arc of novel.storyArcs || []) {
    ref('arc', arc.id, arc.title)
    for (const node of arc.nodes) ref('node', node.id, node.title, arc.id)
  }
  for (const plan of novel.chapterPlans || []) if (plan.status !== 'archived') ref('plan', plan.id, plan.title)
  const draft = workspace.creationDraft
  for (const plan of draft?.chapterPlans || []) if (plan.approval !== 'rejected' && plan.status !== 'archived') ref('plan', plan.id, plan.title)
  for (const scene of draft?.scenePlans || []) if (scene.approval !== 'rejected') ref('scene', scene.id, scene.title, scene.chapterPlanId)
  for (const memory of workspace.storyMemories || []) ref('memory', memory.id, memory.title)

  for (const character of novel.characters) for (const relationship of character.relationships) {
    edge(k('character', relationship.targetId), k('character', character.id), '人物关系指向此人', 'association')
    edge(k('character', character.id), k('character', relationship.targetId), '此人维护了这条人物关系', 'association')
  }
  for (const event of novel.eventLog || []) {
    const target = k('event', event.id)
    for (const value of event.characters) {
      const direct = novel.characters.find(character => character.id === value)
      const named = names.get(value.trim())
      // A named participant is an explicit field, but ambiguous aliases cannot
      // establish an identity. Prose/name clues never extend the graph.
      const id = direct?.id || (named?.size === 1 ? [...named][0] : undefined)
      if (id) {
        const relation = direct ? '事件参与人物编号' : '事件参与人物姓名／别称（唯一匹配）'
        edge(k('character', id), target, relation, 'association')
        edge(target, k('character', id), '人物参与此事件', 'association')
      }
    }
    for (const arc of event.relatedArcIds || []) {
      edge(k('arc', arc), target, '事件关联剧情线', 'association'); edge(target, k('arc', arc), '剧情线关联事件', 'association')
    }
    chapterAt(target, event.chapterIndex, '事件发生章节')
    chapterAt(target, event.targetChapter, '事件计划章节')
    chapterAt(target, event.lastProgressChapterIndex, '事件最近推进章节')
    chapterAt(target, event.resolvedChapterIndex, '事件实际回收章节')
  }
  for (const arc of novel.storyArcs || []) {
    const target = k('arc', arc.id)
    for (const id of arc.characterIds) edge(k('character', id), target, '剧情线参与人物', 'association')
    for (const id of arc.dependencyArcIds || []) edge(k('arc', id), target, '前置剧情线')
    for (const id of arc.turningPointEventIds || []) {
      edge(k('event', id), target, '人物成长转折事件')
      edge(target, k('event', id), '剧情线以此事件作为人物转折', 'association')
    }
    for (const node of arc.nodes) {
      const nodeKey = k('node', node.id)
      edge(target, nodeKey, '剧情线包含的里程碑'); edge(nodeKey, target, '里程碑所属剧情线', 'association')
      for (const id of node.prerequisiteNodeIds || []) edge(k('node', id), nodeKey, '前置里程碑')
      for (const id of node.consequenceEventIds || []) {
        edge(nodeKey, k('event', id), '里程碑后续事件'); edge(k('event', id), nodeKey, '里程碑引用事件', 'association')
      }
      chapterAt(nodeKey, node.targetChapter, '里程碑计划章节'); chapterAt(nodeKey, node.actualChapter, '里程碑实际章节')
    }
  }
  for (const plan of novel.chapterPlans || []) if (plan.status !== 'archived') {
    const target = k('plan', plan.id)
    for (const id of plan.relatedArcIds) edge(k('arc', id), target, '章节计划关联剧情线', 'association')
    for (const id of plan.relatedEventIds) edge(k('event', id), target, '章节计划关联事件', 'association')
    chapterRange(target, plan.targetChapterStart, plan.targetChapterEnd, '章节计划覆盖范围')
    edge(target, k('plan', 'chapter-plan:' + plan.id), '对应的场景规划章纲', 'association')
  }
  for (const plan of draft?.chapterPlans || []) if (plan.approval !== 'rejected' && plan.status !== 'archived') {
    const target = k('plan', plan.id)
    for (const id of plan.foreshadowingIds) edge(k('event', id), target, '章纲关联伏笔', 'association')
    chapterRange(target, plan.number - 1, (plan.endNumber ?? plan.number) - 1, '场景规划章纲覆盖范围')
  }
  for (const scene of draft?.scenePlans || []) if (scene.approval !== 'rejected') {
    const target = k('scene', scene.id), plan = k('plan', scene.chapterPlanId)
    if (scene.viewpointCharacterId) edge(k('character', scene.viewpointCharacterId), target, '场景视角人物', 'association')
    edge(target, plan, '场景所属章纲', 'association'); edge(plan, target, '章纲包含的场景')
  }
  for (const memory of workspace.storyMemories || []) {
    const target = k('memory', memory.id), scope = memory.scope
    if (scope.kind === 'scene') edge(k('chapter', scope.chapterId), target, '场景回顾来源章节')
    else {
      const through = novel.chapters.find(chapter => chapter.id === scope.throughChapterId)
      const volume = scope.kind === 'volume' ? novel.volumes.find(volume => volume.id === scope.volumeId) : undefined
      if (through) for (const chapter of novel.chapters) {
        if (chapter.chapterIndex <= through.chapterIndex && (scope.kind === 'book' || volume && chapter.volumeIndex === volume.volumeIndex)) {
          edge(k('chapter', chapter.id), target, '分层回顾覆盖章节（需核对）')
        }
      }
    }
  }
  for (const { revision:r } of projectEventCausality(novel, workspace.canonMutations).edges) {
    edge(k('event',r.fromEventId), k('event',r.toEventId), '作者确认因果：' + eventCausalityLabels[r.relation])
    edge(k('chapter',r.evidence.chapterId), k('event',r.fromEventId), '因果证据来源', 'association')
  }
  const version = buildAnalysisSourceVersionId(JSON.stringify([novel.id, novel.title, novel.outline, novel.synopsis, novel.volumes,
    novel.writingStyle, novel.settings, novel.chapterLengthPolicy,
    novel.chapters.map(chapter => [chapter.id, chapter.chapterIndex, chapter.volumeIndex, chapter.content]),
    projectStoryTimeOrigin(novel), projectStoryTimeTimeline(novel, Infinity),
    dataPanelReferenceInput(novel.dataPanels || []), dataPanelProvenanceInput(novel), novel.characters, novel.eventLog, novel.storyArcs, novel.chapterPlans,
    draft?.contract, draft?.skeletons,
    draft?.selectedSkeletonId, draft?.approval, draft?.outlineCandidate, draft?.chapterPlans, draft?.scenePlans, workspace.storyMemories, workspace.canonMutations.filter(record => record.type === 'event_causality')]))
  return { novelId: novel.id, version, refs, edges, terms, chapters }
}

export function buildStoryImpactReport(before: StoryImpactSnapshot, after: StoryImpactSnapshot, changes: StoryImpactChange[],
  reviewChapterIds: string[], now: string, id: string, reviewPolicy: StoryImpactReport['reviewPolicy'] = 'all-written'): StoryImpactReport {
  if (before.novelId !== after.novelId) throw new Error('不能跨作品分析设定影响。')
  const roots = new Set(changes.map(change => key(change.target))), affected = new Map<string, StoryImpactItem>()
  for (const [snapshot, phase] of [[before, 'before'], [after, 'after']] as const) {
    const depths = new Map([...roots].map(id => [id, 0])), queue = [...roots]
    for (let index = 0; index < queue.length; index++) {
      const from = queue[index]
      for (const edge of snapshot.edges.get(from) || []) {
        const depth = depths.get(from)! + 1
        if (edge.kind === 'dependency' && !depths.has(edge.to)) { depths.set(edge.to, depth); queue.push(edge.to) }
        if (roots.has(edge.to)) continue
        const item = affected.get(edge.to) || { target: after.refs.get(edge.to) || snapshot.refs.get(edge.to)!, depth: Infinity, reasons: [] }
        item.depth = Math.min(item.depth, depth)
        item.reasons.push({ from: snapshot.refs.get(from)!, relation: edge.relation, phase, kind: edge.kind })
        affected.set(edge.to, item)
      }
    }
  }
  const mentions = new Map<string, { chapter: StoryImpactRef; terms: string[] }>()
  const labels = [...new Set([...roots].flatMap(id => [...before.terms.get(id) || [], ...after.terms.get(id) || []]))]
  // Scan only the edited entities' names/titles, never expand by every discovered
  // object. A short common name can be noisy; the UI labels all matches as clues.
  for (const snapshot of [before, after]) for (const chapter of snapshot.chapters) {
    const matched = labels.filter(label => chapter.content.includes(label))
    if (!matched.length) continue
    const previous = mentions.get(chapter.ref.id)
    mentions.set(chapter.ref.id, { chapter: chapter.ref, terms: [...new Set([...(previous?.terms || []), ...matched])] })
  }
  const report: StoryImpactReport = { id, novelId: before.novelId, version: 1, createdAt: now, beforeVersion: before.version, afterVersion: after.version,
    changes, affected: [...affected.values()].sort((a, b) => a.depth - b.depth || key(a.target).localeCompare(key(b.target))),
    mentions: [...mentions.values()], reviewPolicy, reviewChapterIds: [...new Set(reviewChapterIds)] }
  assertStoryImpactReport(report, before.novelId)
  return report
}
