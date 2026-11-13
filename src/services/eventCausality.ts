import type { Novel, EventLogEntry } from '@/types/novel'
import type { CanonMutationRecord } from '@/types/reconstruction'
import type { EventCausalityBinding, EventCausalityDraft, EventCausalityRevision } from '@/types/eventCausality'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { projectCanonicalEntities } from './entityProvenance'
import { sourceNovel } from './effectiveStory'
import { EVENT_CANON_FIELDS } from '@/types/entityProvenance'

import { assertEventCausalityRevision, eventCausalityLabels } from './eventCausalityValidation'
export { assertEventCausalityRevision, eventCausalityLabels } from './eventCausalityValidation'
const strict = (r: EventCausalityRevision) => r.relation === 'causes' || r.relation === 'enables'
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v))
function chapters(novel: Novel) { return [...novel.chapters].sort((a,b) => a.chapterIndex - b.chapterIndex) }
function order(novel: Novel, index: number) { return chapters(novel).filter(c => c.chapterIndex <= index).map(c => c.id) }
interface ProjectionCache { events: Map<number, EventLogEntry[]>; invalidEvents: Map<number, Set<string>>; versions: Map<string, string> }
function version(novel: Novel, chapterId: string, cache?: ProjectionCache): string {
  const stored = cache?.versions.get(chapterId)
  if (stored) return stored
  const chapter = novel.chapters.find(c => c.id === chapterId)
  if (!chapter) throw new Error('来源章节已删除。')
  const value = buildAnalysisSourceVersionId(chapter.content)
  cache?.versions.set(chapterId,value)
  return value
}
function binding(novel: Novel, eventId: string, boundary: number, cache?: ProjectionCache): EventCausalityBinding {
  let events = cache?.events.get(boundary), invalid = cache?.invalidEvents.get(boundary)
  if (!events) {
    const projection = projectCanonicalEntities(sourceNovel(novel), boundary + 1)
    events = projection.events
    invalid = new Set(projection.issues.filter(issue => issue.entityType === 'event').map(issue => issue.entityId))
    cache?.events.set(boundary,events); cache?.invalidEvents.set(boundary,invalid)
  }
  const event = events.find(e => e.id === eventId)
  if (!event || invalid?.has(eventId) || !event.title?.trim() || !Number.isSafeInteger(event.chapterIndex) || event.chapterIndex < 0 || event.chapterIndex > boundary
    || event.status === 'unverified' || event.status === 'abandoned') throw new Error('事件端点尚未发生、来源失效或已经删除。')
  const matches = novel.chapters.filter(c => c.chapterIndex === event.chapterIndex)
  if (matches.length !== 1 || !matches[0].content.trim()) throw new Error('事件端点缺少唯一有效的发生章节。')
  const chapter = matches[0]
  const snapshot = { id:event.id, ...Object.fromEntries(EVENT_CANON_FIELDS.map(field => [field,event[field as keyof typeof event]])) }
  return { eventId, chapterId: chapter.id, chapterIndex: chapter.chapterIndex, sourceVersionId: version(novel,chapter.id,cache), eventSnapshot: JSON.stringify(snapshot) }
}

function current(novel: Novel, r: EventCausalityRevision, cache?: ProjectionCache): boolean {
  try {
    assertEventCausalityRevision(r)
    const c = novel.chapters.find(c => c.id === r.effectiveChapterId), e = r.evidence
    if (!c || c.chapterIndex !== r.effectiveChapterIndex || JSON.stringify(order(novel,c.chapterIndex)) !== JSON.stringify(r.chapterOrder)
      || version(novel,c.id,cache) !== e.sourceVersionId || c.content.slice(e.startOffset,e.endOffset) !== e.quote
      || c.content.indexOf(e.quote) !== e.startOffset || c.content.lastIndexOf(e.quote) !== e.startOffset) return false
    return r.endpoints.every(b => JSON.stringify(binding(novel,b.eventId,r.effectiveChapterIndex,cache)) === JSON.stringify(b))
  } catch { return false }
}
export interface ProjectedEventCausality { revision: EventCausalityRevision; recordId: string; candidateId: string }
export interface EventCausalityProjection { edges: ProjectedEventCausality[]; inactive: Array<{ edgeId: string; recordId: string; reason: string }> }
/** Exclusive boundary. Append order is authoritative; an invalid latest decision never revives an old fact. */
export function projectEventCausality(novel: Novel, records: CanonMutationRecord[], beforeChapterIndex = Infinity): EventCausalityProjection {
  novel = sourceNovel(novel)
  const cache: ProjectionCache = { events:new Map(),invalidEvents:new Map(),versions:new Map() }
  const latest = new Map<string, CanonMutationRecord>()
  for (const record of records) {
    if (record.novelId !== novel.id || record.type !== 'event_causality') continue
    const r = record.eventCausality
    let validShape = false
    try { assertEventCausalityRevision(r); validShape = record.targetId === r.edgeId && record.chapterId === r.effectiveChapterId } catch { /* Invalid latest records mask their target lineage. */ }
    if (r && validShape && r.effectiveChapterIndex >= beforeChapterIndex) continue
    const edgeId = record.targetId || r?.edgeId
    if (edgeId) latest.set(edgeId,record)
  }
  const result: EventCausalityProjection = { edges: [], inactive: [] }
  for (const [edgeId,record] of latest) {
    const r = record.eventCausality
    if (!r || r.edgeId !== edgeId || record.chapterId !== r.effectiveChapterId || !current(novel,r,cache) || r.action === 'revoke') {
      result.inactive.push({ edgeId, recordId:record.id, reason:r?.action === 'revoke' ? '作者已撤销' : '来源、顺序或端点失效' }); continue
    }
    result.edges.push({ revision:copy(r), recordId:record.id, candidateId:record.candidateId })
  }
  const cycle = (edge: EventCausalityRevision) => reachable(result.edges.filter(e => e.revision.edgeId !== edge.edgeId && strict(e.revision)).map(e => e.revision), edge.toEventId, edge.fromEventId)
  const rejected = new Set(result.edges.filter(e => strict(e.revision) && cycle(e.revision)).map(e => e.revision.edgeId))
  result.edges = result.edges.filter(e => { if (!rejected.has(e.revision.edgeId)) return true; result.inactive.push({ edgeId:e.revision.edgeId,recordId:e.recordId,reason:'导致/使能形成因果环' }); return false })
  return result
}
function reachable(edges: EventCausalityRevision[], from: string, to: string): boolean {
  const visited = new Set<string>(), pending = [from]
  while (pending.length) { const node = pending.pop()!; if (node === to) return true; if (visited.has(node)) continue; visited.add(node); for (const e of edges) if (e.fromEventId === node) pending.push(e.toEventId) }
  return false
}
export function createEventCausalityRevision(novel: Novel, records: CanonMutationRecord[], draft: EventCausalityDraft): EventCausalityRevision {
  novel = sourceNovel(novel)
  const c = novel.chapters.find(c => c.id === draft.chapterId)
  if (!c || c.status === 'locked') throw new Error('来源章节不存在或已锁定。')
  const r: EventCausalityRevision = { edgeId:draft.edgeId, fromEventId:draft.fromEventId, toEventId:draft.toEventId,
    relation:draft.relation, explanation:draft.explanation.trim(), action:draft.action, effectiveChapterId:c.id, effectiveChapterIndex:c.chapterIndex,
    chapterOrder:order(novel,c.chapterIndex), authorDecision:'confirmed', evidence:{ chapterId:c.id, chapterIndex:c.chapterIndex, sourceVersionId:buildAnalysisSourceVersionId(c.content),
      quote:draft.quote, startOffset:draft.startOffset, endOffset:draft.startOffset + draft.quote.length },
    endpoints:draft.action === 'revoke'
      ? copy(records.filter(r => r.type === 'event_causality' && r.targetId === draft.edgeId).slice(-1)[0]?.eventCausality?.endpoints || []) as EventCausalityRevision['endpoints']
      : [binding(novel,draft.fromEventId,c.chapterIndex),binding(novel,draft.toEventId,c.chapterIndex)] }
  assertEventCausalityRevision(r)
  if (c.content.slice(r.evidence.startOffset,r.evidence.endOffset) !== draft.quote || !draft.quote.trim()
    || c.content.indexOf(draft.quote) !== draft.startOffset || c.content.lastIndexOf(draft.quote) !== draft.startOffset
    || (draft.action !== 'revoke' && !current(novel,r))) throw new Error('证据必须是来源正文中唯一、位置准确的原句。')
  const all = projectEventCausality(novel,records,c.chapterIndex + 1).edges.map(e => e.revision).filter(e => e.edgeId !== r.edgeId)
  if (r.action === 'confirm' && all.some(e => e.fromEventId === r.fromEventId && e.toEventId === r.toEventId && e.relation === r.relation)) throw new Error('相同方向和类型的边已确认，请编辑原边。')
  if (r.action === 'confirm' && strict(r) && reachable(all.filter(strict),r.toEventId,r.fromEventId)) throw new Error('导致/使能边不能形成因果环。')
  if (r.action === 'confirm' && strict(r)) {
    const futureBoundaries = new Set(records.filter(record => record.type === 'event_causality' && record.eventCausality
      && record.eventCausality.effectiveChapterIndex > c.chapterIndex).map(record => record.eventCausality!.effectiveChapterIndex))
    for (const boundary of futureBoundaries) {
      const later = projectEventCausality(novel,records,boundary+1).edges.map(e => e.revision).filter(e => e.edgeId !== r.edgeId)
      if (reachable(later.filter(strict),r.toEventId,r.fromEventId)) throw new Error('此决定会在后续章节形成导致/使能因果环。')
    }
  }
  return r
}
/** Captured on open, checked inside the aggregate queue. */
export function captureEventCausalityBaseline(novel: Novel, records: CanonMutationRecord[]): string {
  novel = sourceNovel(novel)
  return JSON.stringify({ novelId:novel.id, chapters:chapters(novel).map(c => [c.id,c.chapterIndex,c.status,buildAnalysisSourceVersionId(c.content)]), events:novel.eventLog, records:records.filter(r => r.type === 'event_causality') })
}

/** Stable endpoint IDs supplied to extraction; fresh model-generated event names are never IDs. */
export function formatEventCausalityAnalysisReferences(novel: Novel, chapterIndex: number): string {
  novel = sourceNovel(novel)
  const cache: ProjectionCache = { events:new Map(),invalidEvents:new Map(),versions:new Map() }
  const events = projectCanonicalEntities(novel,chapterIndex+1).events
    .filter(event => event.chapterIndex >= 0 && event.chapterIndex <= chapterIndex)
    .sort((a,b) => b.chapterIndex-a.chapterIndex || a.id.localeCompare(b.id))
  const lines: string[] = []
  for (const event of events) {
    try { binding(novel,event.id,chapterIndex,cache) } catch { continue }
    if (lines.length >= 120) break
    lines.push('ID(' + event.id + ')：' + event.title + '；发生于第' + (event.chapterIndex+1) + '章')
  }
  return lines.length ? lines.join('\n') + '\n仅可引用以上ID；未列出的端点不得编造ID，未确认的新事件应先作为events候选。' : '暂无可引用的有效事件ID；eventCausalityChanges应填[]，先提取events候选。'
}
export function formatEventCausalityContext(novel: Novel, records: CanonMutationRecord[], beforeChapterIndex: number, budget = 5000): string {
  const edges = projectEventCausality(novel,records,beforeChapterIndex).edges.sort((a,b) => b.revision.effectiveChapterIndex - a.revision.effectiveChapterIndex || a.revision.edgeId.localeCompare(b.revision.edgeId))
  if (!edges.length) return ''
  const lines = ['【作者确认的事件因果｜方向：来源事件 → 目标事件】', '导致=产生结果；使能=提供必要条件；阻碍=妨碍目标；动机=促使行动。计划依赖、共现和未确认猜测不构成事实因果；禁止反推。']
  let included = 0
  for (const {revision:r} of edges) {
    const title = (id: string) => JSON.parse(r.endpoints.find(b => b.eventId === id)!.eventSnapshot).title
    const line = title(r.fromEventId) + ' [' + r.fromEventId + '] —' + eventCausalityLabels[r.relation] + '→ ' + title(r.toEventId) + ' [' + r.toEventId + ']：' + r.explanation + '；出处：第' + (r.evidence.chapterIndex+1) + '章 [' + r.evidence.chapterId + '] @' + r.evidence.startOffset + '–' + r.evidence.endOffset + ' ' + r.evidence.sourceVersionId + '「' + r.evidence.quote + '」'
    if (lines.join('\n').length + line.length + 80 > budget) continue
    lines.push(line); included++
  }
  if (included < edges.length) lines.push('预算省略 ' + (edges.length-included) + ' 条；未展示不代表不存在。')
  return lines.join('\n')
}
