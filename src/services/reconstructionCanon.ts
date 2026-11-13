import type { Character, EventLogEntry, Novel, StoryArc } from '@/types/novel'
import type { CandidateChange, CanonMutationRecord, CharacterStateChange } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { createCharacterStateChange } from './reconstructionCharacterState'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
import { assertRepeatedCharacterMemoryDecision } from './characterMemoryIdentity'
import { appendEntityRevision, captureEntityRevision, projectCanonicalEntities } from './entityProvenance'
import type { EntityKind, EntitySource } from '@/types/entityProvenance'
import { recordStoryTime } from './storyTime'
import { queueDataPanelAutomation } from './dataPanelTransactions'

export class CanonMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonMutationError'
  }
}

export interface CanonMutationResult {
  record: CanonMutationRecord
  changed: boolean
}

type CandidateValue = Record<string, any>
type Entity = Character | EventLogEntry | StoryArc
interface AppliedChange {
  changed: boolean
  summary: string
  entity?: { kind: EntityKind; target: Entity; before?: Entity; fields?: string[] }
}
const cloneEntity = <T extends Entity>(entity: T): T => JSON.parse(JSON.stringify(entity))

const eventTypes: EventLogEntry['type'][] = ['主线', '支线', '伏笔', '转折', '战斗', '其他']
const eventStatuses: NonNullable<EventLogEntry['status']>[] = ['planted', 'developing', 'resolved', 'abandoned']
const characterStatuses: Character['status'][] = ['活跃', '退场', '死亡', '失踪']

function parseCandidateValue(candidate: CandidateChange): CandidateValue {
  try {
    const value = JSON.parse(candidate.proposedValue)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as CandidateValue
  } catch {
    throw new CanonMutationError('候选变化的数据格式无效，无法写入故事 Canon')
  }
}

function normalizeName(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, '').toLocaleLowerCase()
}

function authorEditedField(candidate: CandidateChange, key: string): boolean {
  if (candidate.status !== 'edited' || !candidate.originalProposedValue) return false
  try {
    return JSON.stringify(JSON.parse(candidate.originalProposedValue)?.[key]) !== JSON.stringify(JSON.parse(candidate.proposedValue)?.[key])
  } catch { return false }
}

function chapterForCandidate(novel: Novel, candidate: CandidateChange) {
  if (!candidate.chapterId) return undefined
  const chapter = novel.chapters.find(item => item.id === candidate.chapterId)
  if (!chapter) throw new CanonMutationError('候选关联的章节已不存在')
  return chapter
}

export function verifyEvidence(novel: Novel, candidate: CandidateChange): void {
  if (!candidate.evidence.length) throw new CanonMutationError('候选变化必须包含至少一条正文证据')
  const chapter = chapterForCandidate(novel, candidate)
  if (!chapter) throw new CanonMutationError('候选变化必须关联来源章节')

  const currentVersionId = buildAnalysisSourceVersionId(chapter.content)
  if (!candidate.sourceVersionId || candidate.evidence.some(item => !item.sourceVersionId)) {
    throw new CanonMutationError('候选变化必须包含完整的正文证据版本，请重新运行章节分析')
  }
  if (candidate.sourceVersionId !== currentVersionId) {
    throw new CanonMutationError('正文已经变化，这条候选已失效，请重新运行章节分析')
  }

  for (const evidence of candidate.evidence) {
    if ((evidence.startOffset !== undefined || evidence.endOffset !== undefined)
      && (!Number.isSafeInteger(evidence.startOffset) || !Number.isSafeInteger(evidence.endOffset)
        || evidence.startOffset! < 0 || evidence.endOffset! - evidence.startOffset! !== evidence.quote?.length)) {
      throw new CanonMutationError('候选证据位置无效，请重新运行章节分析')
    }
    if (evidence.sourceType !== 'chapter' || evidence.sourceId !== chapter.id
      || !evidence.quote?.trim() || !chapter.content.includes(evidence.quote)
      || (evidence.startOffset !== undefined && chapter.content.slice(evidence.startOffset, evidence.endOffset) !== evidence.quote)) {
      throw new CanonMutationError('候选证据已经不在当前正文中，请重新运行章节分析')
    }
    if (evidence.sourceVersionId && evidence.sourceVersionId !== currentVersionId) {
      throw new CanonMutationError('候选证据对应的正文版本已经过期')
    }
    if (evidence.startOffset === undefined && chapter.content.indexOf(evidence.quote) !== chapter.content.lastIndexOf(evidence.quote)) {
      throw new CanonMutationError('候选引文在正文中重复出现，请补充上下文或明确证据位置')
    }
  }
}

function eventType(value: unknown, fallback: EventLogEntry['type'] = '其他'): EventLogEntry['type'] {
  const candidate = String(value || '') as EventLogEntry['type']
  return eventTypes.includes(candidate) ? candidate : fallback
}

function eventStatus(value: unknown, fallback: NonNullable<EventLogEntry['status']> = 'developing') {
  const candidate = String(value || '') as NonNullable<EventLogEntry['status']>
  return eventStatuses.includes(candidate) ? candidate : fallback
}

function addCanonicalCharacter(novel: Novel, candidate: CandidateChange, value: CandidateValue): AppliedChange {
  const name = String(value.name || '').trim()
  if (!name) throw new CanonMutationError('角色候选缺少角色名')
  if (!novel.characters) novel.characters = []
  const existing = novel.characters.find(character => normalizeName(character.name) === normalizeName(name))
  const fields: Partial<Character> = {
    identity: String(value.identity || '').trim(),
    personality: String(value.personality || '').trim(),
    powerLevel: String(value.powerLevel || '').trim(),
    faction: String(value.faction || '').trim(),
    description: String(value.description || '').trim(),
  }
  if (Array.isArray(value.aliases)) fields.aliases = value.aliases.map(String)
  if (characterStatuses.includes(value.status)) fields.status = value.status

  if (existing) {
    const before = cloneEntity(existing)
    const chapter = chapterForCandidate(novel, candidate)!
    const needsIdentity = !projectCanonicalEntities(novel, chapter.chapterIndex + 1).characters.some(character => character.id === existing.id)
    let changed = false
    const appliedFields = Object.keys(fields).filter(key => {
      const fieldValue = fields[key as keyof Character]
      return (Array.isArray(fieldValue) ? fieldValue.length > 0 : Boolean(fieldValue)) || authorEditedField(candidate, key)
    })
    for (const key of appliedFields) {
      const fieldValue = fields[key as keyof Character]
      if (JSON.stringify(existing[key as keyof Character]) !== JSON.stringify(fieldValue)) {
        ;(existing as any)[key] = fieldValue
        changed = true
      }
    }
    return { changed, summary: '更新角色「' + existing.name + '」',
      entity: { kind: 'character', target: existing, before, fields: [...(needsIdentity ? ['$exists', 'name'] : []), ...appliedFields] } }
  }

  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']
  const created: Character = {
    id: 'canon:' + candidate.id,
    name,
    aliases: Array.isArray(value.aliases) ? value.aliases.map(String) : [],
    identity: fields.identity || '',
    personality: fields.personality || '',
    powerLevel: fields.powerLevel || '',
    faction: fields.faction || '',
    status: characterStatuses.includes(value.status) ? value.status : '活跃',
    firstAppearChapter: chapterForCandidate(novel, candidate)!.chapterIndex,
    description: fields.description || '',
    relationships: [],
    events: [],
    avatarColor: colors[novel.characters.length % colors.length],
  }
  novel.characters.push(created)
  return { changed: true, summary: '新增角色「' + name + '」', entity: { kind: 'character', target: created } }
}

function addCanonicalEvent(
  novel: Novel,
  candidate: CandidateChange,
  value: CandidateValue,
  now: string,
  forcedType?: EventLogEntry['type'],
): AppliedChange {
  if (!novel.eventLog) novel.eventLog = []
  const title = String(value.title || '').trim()
  if (!title) throw new CanonMutationError('事件候选缺少事件标题')
  const chapter = chapterForCandidate(novel, candidate)
  const chapterIndex = chapter!.chapterIndex
  const type = forcedType || eventType(value.eventType || value.type)
  const existing = novel.eventLog.find(event =>
    event.chapterIndex === chapterIndex && event.type === type && normalizeName(event.title) === normalizeName(title),
  )
  if (existing) {
    const before = cloneEntity(existing)
    const needsIdentity = !projectCanonicalEntities(novel, chapterIndex + 1).events.some(event => event.id === existing.id)
    const fields = [...(needsIdentity ? ['$exists', 'title'] : []), 'type', 'chapterIndex']
    if (typeof value.description === 'string') { existing.description = value.description.trim(); fields.push('description') }
    if (Array.isArray(value.characters)) { existing.characters = value.characters.map(String); fields.push('characters') }
    if (eventStatuses.includes(value.status)) { existing.status = value.status; fields.push('status') }
    existing.updatedAt = now
    return { changed: existing.description !== before.description || existing.status !== before.status || JSON.stringify(existing.characters) !== JSON.stringify(before.characters),
      summary: '核对事件「' + title + '」', entity: { kind: 'event', target: existing, before, fields } }
  }

  const created: EventLogEntry = {
    id: 'canon:' + candidate.id,
    chapterIndex,
    title,
    description: String(value.description || '').trim(),
    characters: Array.isArray(value.characters) ? value.characters.map(String) : [],
    type,
    scope: value.scope === 'global' || value.scope === 'volume' || value.scope === 'chapter' ? value.scope : type === '伏笔' ? 'global' : 'chapter',
    status: eventStatus(value.status, type === '伏笔' ? 'planted' : 'developing'),
    hintCount: Number.isFinite(Number(value.hintCount)) ? Number(value.hintCount) : type === '伏笔' ? 1 : undefined,
    storyTime: value.storyTime ? String(value.storyTime) : undefined,
    location: value.location ? String(value.location) : undefined,
    targetChapter: Number.isFinite(Number(value.targetChapter)) ? Number(value.targetChapter) : undefined,
    importance: [1, 2, 3, 4, 5].includes(Number(value.importance)) ? Number(value.importance) as 1 | 2 | 3 | 4 | 5 : 3,
    source: 'ai',
    relatedArcIds: Array.isArray(value.relatedArcIds) ? value.relatedArcIds.map(String) : [],
    evidence: candidate.evidence.find(item => item.quote)?.quote,
    lastProgressChapterIndex: chapterIndex,
    timestamp: now,
    updatedAt: now,
  }
  novel.eventLog.push(created)
  return { changed: true, summary: '新增事件「' + title + '」', entity: { kind: 'event', target: created } }
}

function applyTimeline(novel: Novel, candidate: CandidateChange, value: CandidateValue, now: string): { changed: boolean; summary: string } {
  const chapter = chapterForCandidate(novel, candidate)
  if (!chapter) throw new CanonMutationError('时间线候选必须绑定具体章节正文。')
  const hasValue = (key: string) => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null
    && value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim() !== '')
  const numeric = (key: string) => hasValue(key) && ['number', 'string'].includes(typeof value[key]) ? Number(value[key]) : NaN
  const startDay = numeric('startDay'), endDay = numeric('endDay'), elapsedDays = numeric('elapsedDays')
  const absolute = Object.prototype.hasOwnProperty.call(value, 'startDay') || Object.prototype.hasOwnProperty.call(value, 'endDay')
  if (absolute && (!Number.isFinite(startDay) || !Number.isFinite(endDay))) throw new CanonMutationError('绝对时间候选必须明确填写有效的开始日和结束日。')
  if (!absolute && !Number.isFinite(elapsedDays)) throw new CanonMutationError('相对时间候选必须明确填写经过天数，包括 0 天。')
  if (value.label !== undefined && typeof value.label !== 'string') throw new CanonMutationError('故事时间标签必须是文字。')
  const label = value.label as string | undefined
  try {
    const result = absolute
      ? recordStoryTime(novel, { chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content, mode: 'absolute', startDay, endDay, label, source: 'canon' }, now, () => 'canon-time:' + candidate.id)
      : recordStoryTime(novel, { chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content, mode: 'relative', elapsedDays, label, source: 'canon' }, now, () => 'canon-time:' + candidate.id)
    if (result.changed) {
      let sequence = 0
      queueDataPanelAutomation(novel, chapter.chapterIndex, chapter.content, now, () => `canon-time-data:${candidate.id}:${++sequence}`)
    }
    return { changed: result.changed, summary: result.changed ? `故事时间推进至 ${result.projection.endDay} 日` : '故事时间候选已经应用' }
  } catch (error) {
    throw new CanonMutationError(error instanceof Error ? error.message : '时间线候选无效')
  }
}

function applyPlotline(novel: Novel, candidate: CandidateChange, value: CandidateValue, now: string): AppliedChange {
  if (!candidate.targetId) throw new CanonMutationError('剧情线候选缺少目标 ID')
  const rawStatus = String(value.status || '')
  const event = novel.eventLog?.find(item => item.id === candidate.targetId)
  if (event && eventStatuses.includes(rawStatus as NonNullable<EventLogEntry['status']>)) {
    const before = cloneEntity(event)
    const next = rawStatus as NonNullable<EventLogEntry['status']>
    const changed = event.status !== next
    event.status = next
    event.updatedAt = now
    return { changed, summary: '更新事件「' + event.title + '」状态为 ' + next, entity: { kind: 'event', target: event, before, fields: ['status'] } }
  }
  const arc = novel.storyArcs?.find(item => item.id === candidate.targetId)
  if (arc) {
    const before = cloneEntity(arc)
    const next = rawStatus === 'resolved' ? 'completed' : rawStatus === 'developing' ? 'active' : rawStatus
    if (!['active', 'paused', 'completed', 'abandoned'].includes(next)) throw new CanonMutationError('剧情线状态无效')
    const changed = arc.status !== next
    arc.status = next as typeof arc.status
    arc.updatedAt = now
    return { changed, summary: '更新剧情线「' + arc.title + '」状态为 ' + next, entity: { kind: 'arc', target: arc, before, fields: ['status'] } }
  }
  throw new CanonMutationError('找不到候选变化对应的事件或剧情线')
}

function applyCharacterState(novel: Novel, candidate: CandidateChange, value: CandidateValue): AppliedChange {
  const id = String(value.characterId || candidate.targetId || '')
  const character = novel.characters?.find(item => item.id === id || normalizeName(item.name) === normalizeName(id))
  if (!character) throw new CanonMutationError('找不到候选变化对应的角色')
  const before = cloneEntity(character)
  const next = value.status as Character['status']
  if (!characterStatuses.includes(next)) throw new CanonMutationError('角色状态无效')
  const changed = character.status !== next
  character.status = next
  return { changed, summary: '更新角色「' + character.name + '」状态为 ' + next, entity: { kind: 'character', target: character, before, fields: ['status'] } }
}

export function applyCandidateChangeToCanon(novel: Novel, candidate: CandidateChange, now: string, records: CanonMutationRecord[] = [], authorDecision?: CharacterMemoryAuthorDecision): CanonMutationResult {
  if (candidate.type === 'event_causality') throw new CanonMutationError('事件因果必须在专属面板核对打开基线、方向和证据后确认。')
  if (candidate.novelId && candidate.novelId !== novel.id) throw new CanonMutationError('候选不属于当前小说')
  if (candidate.status !== 'accepted' && candidate.status !== 'edited') {
    throw new CanonMutationError('只有作者确认后的候选才能写入 Canon')
  }
  const existing = records.find(record => record.novelId === novel.id && record.candidateId === candidate.id)
  if (existing) {
    assertRepeatedCharacterMemoryDecision(existing, authorDecision)
    return { changed: false, record: existing }
  }
  verifyEvidence(novel, candidate)
  const value = parseCandidateValue(candidate)
  let result: AppliedChange
  let characterState: CharacterStateChange | undefined

  if (candidate.type === 'knowledge' || candidate.type === 'relationship') {
    if (!candidate.sourceVersionId || candidate.evidence.some(item => item.sourceVersionId !== candidate.sourceVersionId)) {
      throw new CanonMutationError('知情与关系变化必须包含完整的正文证据版本')
    }
    const state = createCharacterStateChange(novel, candidate, value, records, { authorDecision, confirmedAt: now })
    characterState = state.change
    result = { changed: true, summary: state.summary }
  } else if (candidate.type === 'timeline') result = applyTimeline(novel, candidate, value, now)
  else if (candidate.type === 'plotline') result = applyPlotline(novel, candidate, value, now)
  else if (candidate.type === 'state') result = applyCharacterState(novel, candidate, value)
  else if (candidate.type === 'foreshadowing') result = addCanonicalEvent(novel, candidate, value, now, '伏笔')
  else if (candidate.type === 'fact' && value.kind === 'character') result = addCanonicalCharacter(novel, candidate, value)
  else if (candidate.type === 'fact') result = addCanonicalEvent(novel, candidate, value, now)
  else throw new CanonMutationError('暂不支持将 ' + candidate.type + ' 候选写入 Canon')

  const chapter = chapterForCandidate(novel, candidate)!
  const source: EntitySource = { kind: 'chapter', chapterId: chapter.id, chapterIndex: chapter.chapterIndex,
    sourceVersionId: buildAnalysisSourceVersionId(chapter.content), evidence: candidate.evidence.map(item => ({ quote: item.quote!,
      startOffset: item.startOffset ?? chapter.content.indexOf(item.quote!),
      endOffset: item.endOffset ?? (item.startOffset ?? chapter.content.indexOf(item.quote!)) + item.quote!.length })) }
  const entityChanges = result.entity && (!result.entity.fields || result.entity.fields.length) ? [captureEntityRevision(result.entity.kind, result.entity.before, result.entity.target,
    source, now, 'entity-revision:' + candidate.id, result.entity.fields)] : undefined
  if (result.entity && entityChanges) appendEntityRevision(result.entity.target, entityChanges[0])
  return {
    changed: result.changed,
    record: {
      id: 'canon-mutation:' + candidate.id,
      candidateId: candidate.id,
      novelId: novel.id,
      chapterId: candidate.chapterId,
      type: candidate.type,
      targetId: result.entity?.target.id || candidate.targetId,
      summary: result.summary,
      appliedAt: now,
      characterState,
      entityChanges,
    },
  }
}
