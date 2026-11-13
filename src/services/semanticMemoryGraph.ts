export type SemanticGraphEdgeType = 'event_causes' | 'event_enables' | 'event_blocks' | 'event_motivates' | 'event_cause_trace' | 'character_state' | 'character_relationship' | 'proposition_reference' | 'proposition_identity' | 'arc_character' | 'arc_dependency' | 'arc_turning_point' | 'arc_node' | 'node_prerequisite' | 'node_consequence' | 'plan_arc' | 'plan_event' | 'event_arc' | 'evidence_source' | 'chapter_coverage'
export interface SemanticGraphLocation {
  recordId?: string; sourceType: string; sourceId: string; title: string
  chapterId?: string; chapterIndex?: number; startOffset?: number; endOffset?: number; nodeId?: string; cognitiveNote?: string
}
export interface SemanticGraphPathHop {
  from: string; to: string; type: SemanticGraphEdgeType; label: string; sourceId?: string
  sourceRecordId?: string; chapterIndex?: number; fromLocation?: SemanticGraphLocation
  toLocation?: SemanticGraphLocation; sourceLocation?: SemanticGraphLocation; quote?: string
}
export interface SemanticGraphEdge extends SemanticGraphPathHop {}
export interface SemanticGraphNode { id: string; recordId?: string; location: SemanticGraphLocation; chapterIndex?: number }
type GraphRecord = { id: string; sourceType: string; sourceId: string; title?: string; content?: string; metadata?: Record<string, unknown> }
export interface SemanticMemoryGraph {
  nodes: Map<string, SemanticGraphNode>; recordsById: Map<string, GraphRecord>
  adjacency: Map<string, SemanticGraphEdge[]>; beforeChapterIndex?: number
}
export interface SemanticGraphExpansion { recordId: string; graphDistance: number; path: SemanticGraphPathHop[] }
export const SEMANTIC_GRAPH_MAX_DEPTH = 4
export const SEMANTIC_GRAPH_MAX_CANDIDATES = 64
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const key = (type: string, id: string) => JSON.stringify([type, id])
const ids = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x))].sort(compare) : []
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined
const objects = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
const cognitionLabels: Record<string, string> = { knows: '已知', suspects: '怀疑', false_belief: '错误信念', does_not_know: '明确不知情' }
const visible = (i: number | undefined, b?: number) => b === undefined || i === undefined || (i >= 0 && i < b)
function chapter(r: GraphRecord) { const m = r.metadata || {}; return num(m.chapterIndex ?? m.throughChapterIndex ?? m.targetChapterStart ?? m.firstAppearChapter) }
function location(r: GraphRecord): SemanticGraphLocation {
  const m = r.metadata || {}
  return { recordId: r.id, sourceType: r.sourceType, sourceId: r.sourceId, title: r.title || r.sourceId,
    chapterId: r.sourceType === 'chapter' ? r.sourceId : typeof m.sourceChapterId === 'string' ? m.sourceChapterId : undefined,
    chapterIndex: chapter(r), startOffset: num(m.startOffset), endOffset: num(m.endOffset),
    cognitiveNote: typeof m.cognitiveNote === 'string' ? m.cognitiveNote : m.stateKind === 'knowledge'
      ? '角色认知：' + (cognitionLabels[String(m.knowledgeState)] || '未知') + '（不代表客观事实）' : undefined }
}
const edgeKey = (e: SemanticGraphEdge) => JSON.stringify([e.to, e.type, e.sourceRecordId, e.sourceId, e.quote])
export function buildSemanticMemoryGraph(records: GraphRecord[], beforeChapterIndex?: number): SemanticMemoryGraph {
  const ordered = [...records].filter(r => visible(chapter(r), beforeChapterIndex)).sort((a,b) => compare(a.id,b.id))
  const graph: SemanticMemoryGraph = { nodes: new Map(), recordsById: new Map(), adjacency: new Map(), beforeChapterIndex }
  const groups = new Map<string, GraphRecord[]>(), entities = new Map<string,string>()
  const nodeTargets = new Map<string, string[]>()
  const propositions = new Map<string, string>()
  const add = (r: GraphRecord, from: string, to: string | undefined, type: SemanticGraphEdgeType, label: string, index = chapter(r), quote?: string) => {
    const a = graph.nodes.get(from), b = to ? graph.nodes.get(to) : undefined
    // Explicit references cannot manufacture traversable ghost nodes.
    if (!a || !b || from === to || !visible(index, beforeChapterIndex)) return
    const edge: SemanticGraphEdge = { from, to: b.id, type, label, sourceId: r.sourceId, sourceRecordId: r.id,
      chapterIndex: index, fromLocation: a.location, toLocation: b.location, sourceLocation: location(r), quote }
    const edges = graph.adjacency.get(from) || []
    if (!edges.some(e => edgeKey(e) === edgeKey(edge))) edges.push(edge)
    graph.adjacency.set(from,edges)
  }
  for (const r of ordered) {
    graph.recordsById.set(r.id,r); graph.nodes.set(r.id,{ id:r.id, recordId:r.id, location:location(r), chapterIndex:chapter(r) })
    if (r.metadata?.stateKind === 'proposition' && typeof r.metadata.factId === 'string') propositions.set(r.metadata.factId, r.id)
    const entityId = r.sourceType === 'knowledge' ? JSON.stringify([r.metadata?.kbId, r.sourceId]) : r.sourceId
    const k = key(r.sourceType,entityId), group = groups.get(k) || []; group.push(r); groups.set(k,group)
  }
  // A chapter entity is distinct from all its summary/raw chunks.
  for (const [k, group] of groups) {
    if (group.length === 1 && !['chapter','knowledge'].includes(group[0].sourceType)) { entities.set(k,group[0].id); continue }
    const id = 'entity:' + k, first = group[0]
    entities.set(k,id); graph.nodes.set(id,{ id, location:{ ...location(first), recordId:undefined, startOffset:undefined, endOffset:undefined, title:'来源覆盖：' + first.sourceId }, chapterIndex:chapter(first) })
    for (const r of group) {
      add(r,r.id,id,'chapter_coverage','片段 → 所属来源（非因果）')
      add(r,id,r.id,'chapter_coverage',r.metadata?.chunkType === 'summary' ? '来源 → 摘要覆盖（非原文）' : '来源 → 原文分块覆盖（非因果）')
    }
  }
  const target = (type: string, id: unknown) => typeof id === 'string' ? entities.get(key(type,id)) : undefined
  for (const r of ordered) if (r.sourceType === 'story_arc') for (const n of objects(r.metadata?.nodes).sort((a,b) => compare(String(a.id),String(b.id)))) {
    const index = num(n.actualChapter ?? n.targetChapter)
    if (typeof n.id !== 'string' || !visible(index,beforeChapterIndex) || ['abandoned','unverified'].includes(String(n.status))) continue
    const id = key('arc_node',r.sourceId + ':' + n.id)
    graph.nodes.set(id,{ id, chapterIndex:index, location:{ sourceType:'story_arc', sourceId:r.sourceId, nodeId:n.id, title:String(n.title || n.id), chapterIndex:index } })
    nodeTargets.set(n.id, [...(nodeTargets.get(n.id) || []), id])
  }
  for (const r of ordered) {
    const m = r.metadata || {}
    const links = (values: unknown, type: string, edge: SemanticGraphEdgeType, label: string, from = r.id, index = chapter(r)) => {
      for (const id of ids(values)) add(r,from,target(type,id),edge,label,index)
    }
    if (m.stateKind === 'event_causality') {
      const types: Record<string, SemanticGraphEdgeType> = { causes:'event_causes', enables:'event_enables', blocks:'event_blocks', motivates:'event_motivates' }
      const type = types[String(m.relation)], from = target('event',m.fromEventId), to = target('event',m.toEventId)
      const quote = String(objects(m.evidence)[0]?.quote || '')
      if (type && from && to && quote) {
        add(r,from,to,type,'作者确认事实因果｜' + String(m.relationLabel),chapter(r),quote)
        add(r,r.id,from,'evidence_source','因果决定 → 来源事件（归属，非反向因果）',chapter(r),quote)
        add(r,r.id,to,type,'因果决定 → 目标事件｜' + String(m.relationLabel),chapter(r),quote)
        // Lets "why did X happen" walk upstream. The edge reads result → cause; the stored direction is unchanged.
        add(r,to,from,'event_cause_trace','由结果追溯已确认原因｜' + String(m.relationLabel) + '（方向仍为原因 → 结果，非反向因果）',chapter(r),quote)
        add(r,to,r.id,'event_cause_trace','结果事件 → 其已确认的因果决定（追溯出处）',chapter(r),quote)
      }
    }
    if (m.stateKind === 'knowledge' || m.stateKind === 'relationship') {
      const owner = target('character',m.characterId)
      if (owner) add(r,owner,r.id,'character_state','人物 → 认知/关系状态（非客观事实断言）')
      if (m.stateKind === 'relationship') add(r,r.id,target('character',m.targetCharacterId),'character_relationship','单向关系｜' + String(m.dimensionLabel || '未分类历史') + '：' + String(m.relation || ''))
      else if (typeof m.factId === 'string') {
        const proposition = propositions.get(m.factId)
        add(r,r.id,proposition,'proposition_reference','人物认知 → 原命题身份（非事实断言）')
        if (proposition) add(r,proposition,r.id,'proposition_reference','命题身份 → 人物认知（需保留态度与冲突）')
      }
    }
    if (m.stateKind === 'proposition') {
      add(r,target('character',m.subjectId) || '',r.id,'proposition_reference','明确主体 → 命题身份（非事实断言）')
      add(r,r.id,target('character',m.objectId),'proposition_reference','命题身份 → 明确对象（非因果）')
    }
    if (m.stateKind === 'proposition_decision' && m.decisionActive === true) {
      const decision = m.propositionDecision as Record<string, unknown> | undefined
      if (decision && typeof decision.targetId === 'string') {
        for (const id of ids(decision.fromIds)) {
          const from = propositions.get(id)
          if (from) {
            add(r,from,r.id,'proposition_identity','原命题 → 作者等价决定（保留原身份及认知）')
            add(r,r.id,from,'proposition_identity','作者等价决定 → 原命题（身份追溯，非反向因果）')
          }
        }
        add(r,r.id,propositions.get(decision.targetId),'proposition_identity','作者等价决定 → 选定命题（非因果；仅从决定来源起生效）')
        const selected = propositions.get(decision.targetId)
        if (selected) add(r,selected,r.id,'proposition_identity','选定命题 → 作者等价决定（身份追溯，非因果）')
      }
    }
    if (m.stateKind === 'evidence') {
      if (typeof m.ownerRecordId === 'string') {
        add(r,m.ownerRecordId,r.id,'evidence_source','记录 → 已校验证据')
        add(r,r.id,m.ownerRecordId,'evidence_source','证据 → 所属记录（来源归属，非反向因果）')
      }
      // Match offsets against original body chunks, including cross-chunk evidence.
      for (const ref of objects(m.evidence)) {
        const start = num(ref.startOffset), end = num(ref.endOffset), quote = String(ref.quote || '')
        if (start === undefined || end === undefined || end <= start || !quote) continue
        for (const c of groups.get(key('chapter',String(ref.sourceId))) || []) {
          const cm = c.metadata || {}, cs = num(cm.startOffset), ce = num(cm.endOffset)
          if (cm.chunkType !== 'content' || !ref.sourceVersionId || ref.sourceVersionId !== cm.sourceVersionId
            || cs === undefined || ce === undefined || cs >= end || ce <= start) continue
          const a = Math.max(start,cs), b = Math.min(end,ce)
          if (c.content?.slice(a-cs,b-cs) !== quote.slice(a-start,b-start)) continue
          add(r,r.id,c.id,'evidence_source','证据 → 对应原文分块',chapter(c),quote)
          add(r,c.id,r.id,'chapter_coverage','原文分块 → 精确覆盖的证据引用（非因果）',chapter(c),quote)
        }
      }
    }
    if (r.sourceType === 'story_arc' && !m.stateKind) {
      links(m.characterIds,'character','arc_character','计划弧线 → 关联人物（非因果）')
      links(m.dependencyArcIds,'story_arc','arc_dependency','计划弧线 → 前置依赖（非事实因果）')
      links(m.turningPointEventIds,'event','arc_turning_point','计划弧线 → 转折事件引用')
      for (const n of objects(m.nodes)) {
        const id = key('arc_node',r.sourceId + ':' + n.id), index = num(n.actualChapter ?? n.targetChapter)
        if (!graph.nodes.has(id)) continue
        add(r,r.id,id,'arc_node','弧线 → 里程碑计划',index)
        for (const prerequisite of ids(n.prerequisiteNodeIds)) {
          const local = key('arc_node',r.sourceId + ':' + prerequisite), candidates = nodeTargets.get(prerequisite) || []
          const resolved = graph.nodes.has(local) ? local : candidates.length === 1 ? candidates[0] : undefined
          add(r,id,resolved,'node_prerequisite','里程碑 → 前置节点（计划依赖）',index)
        }
        links(n.consequenceEventIds,'event','node_consequence','里程碑 → 后续事件引用（计划，非已证因果）',id,index)
        for (const evidenceId of ids(n.evidenceRecordIds)) {
          const evidenceRecord = graph.recordsById.get(evidenceId)
          if (!evidenceRecord || evidenceRecord.metadata?.stateKind !== 'evidence') continue
          add(evidenceRecord,id,evidenceId,'evidence_source','里程碑 → 确认来源',index)
          add(evidenceRecord,evidenceId,id,'evidence_source','证据 → 所属里程碑（来源归属，非反向因果）',index)
        }
      }
    }
    if (r.sourceType === 'chapter_plan' && !m.stateKind) {
      links(m.relatedArcIds,'story_arc','plan_arc','章节计划 → 关联弧线')
      links(m.relatedEventIds,'event','plan_event','章节计划 → 关联事件')
    }
    if (r.sourceType === 'event' && !m.stateKind) links(m.relatedArcIds,'story_arc','event_arc','事件 → 关联弧线（非因果）')
    if (r.sourceType === 'story_memory') links(m.chapterIds,'chapter','chapter_coverage','回顾 → 来源章节覆盖（非因果）')
  }
  for (const edges of graph.adjacency.values()) edges.sort((a,b) => Number(!a.quote) - Number(!b.quote) || Number(a.type === 'chapter_coverage') - Number(b.type === 'chapter_coverage') || compare(edgeKey(a),edgeKey(b)))
  return graph
}
export function expandSemanticMemoryGraph(graph: SemanticMemoryGraph, seedRecordIds: string[], maxDepth = SEMANTIC_GRAPH_MAX_DEPTH, maxCandidates = SEMANTIC_GRAPH_MAX_CANDIDATES): SemanticGraphExpansion[] {
  const depth = Math.min(SEMANTIC_GRAPH_MAX_DEPTH,Math.max(0,Math.floor(maxDepth) || 0)), limit = Math.min(SEMANTIC_GRAPH_MAX_CANDIDATES,Math.max(0,Math.floor(maxCandidates) || 0))
  const seeds = [...new Set(seedRecordIds)].filter(id => graph.nodes.has(id)).sort(compare).slice(0,12)
  const visited = new Set(seeds), result: SemanticGraphExpansion[] = [], queue = seeds.map(id => ({ id,distance:0,path:[] as SemanticGraphPathHop[] }))
  let cursor = 0, examined = 0
  while (cursor < queue.length && result.length < limit && examined < 1024) {
    const current = queue[cursor++]
    if (current.distance >= depth) continue
    for (const edge of graph.adjacency.get(current.id) || []) {
      if (++examined > 1024) break
      const node = graph.nodes.get(edge.to)
      if (!node || !graph.nodes.has(edge.from) || !visible(node.chapterIndex,graph.beforeChapterIndex) || !visible(edge.chapterIndex,graph.beforeChapterIndex) || !graph.recordsById.has(edge.sourceRecordId || '') || visited.has(edge.to)) continue
      if (visited.size >= 256) break
      visited.add(edge.to)
      const path = [...current.path,edge]
      if (node.recordId) result.push({ recordId:node.recordId, graphDistance:current.distance+1,path })
      queue.push({ id:edge.to,distance:current.distance+1,path })
      if (result.length >= limit) break
    }
  }
  return result
}
export function formatSemanticGraphHop(hop: SemanticGraphPathHop, concise = false): string {
  const name = (loc: SemanticGraphLocation | undefined, fallback: string) => loc ? loc.title + ' [' + loc.sourceType + (concise ? '' : ':' + loc.sourceId) + (loc.chapterIndex === undefined ? '' : ' 第' + (loc.chapterIndex + 1) + '章') + (loc.startOffset === undefined ? '' : ' @' + loc.startOffset + '–' + loc.endOffset) + ']' + (loc.cognitiveNote ? '（' + loc.cognitiveNote + '）' : '') : fallback
  return name(hop.fromLocation,hop.from) + ' —' + hop.label + ' [' + hop.type + ']→ ' + name(hop.toLocation,hop.to) + '；依据：' + name(hop.sourceLocation,hop.sourceRecordId || hop.sourceId || '未知来源')
}
