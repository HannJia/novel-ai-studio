import type { Character, EventLogEntry, Novel } from '@/types/novel'
import { CHARACTER_CANON_FIELDS, EVENT_CANON_FIELDS } from '@/types/entityProvenance'
import { assertRelationshipDimension } from './characterMemoryIdentity'
import { assertStoredRelationshipDimensions } from './characterMemoryValidation'
import { appendEntityRevision, captureEntityRevision } from './entityProvenance'
import { validateEntityRevision } from './entityProvenanceValidation'
import { registerChapterReviewInvalidation } from './chapterReviewInvalidationRequests'

export type EntityDefinitionEdit =
  | { action: 'create'; kind: 'character'; data: Partial<Character> }
  | { action: 'create'; kind: 'event'; data: Omit<EventLogEntry, 'id' | 'timestamp'> }
  | { action: 'update'; kind: 'character' | 'event'; entityId: string; expectedEntity: string; updates: Partial<Character> | Partial<EventLogEntry> }
  | { action: 'delete'; kind: 'character' | 'event'; entityId: string; expectedEntity: string }

export interface EntityDefinitionResult { entity?: Character | EventLogEntry; reviewChapterIds: string[] }
function fail(message: string): never { throw new Error(message) }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const cleanText = (value: string) => value.split('*').join('').trim()
const cleanName = (value: string) => cleanText(value).replace(/^[《》「」『』“”‘’"'\s]+|[《》「」『』“”‘’"'\s]+$/g, '').replace(/\s+/g, ' ').trim()
const nameKey = (value: string) => cleanName(value).toLowerCase()
const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9']

function checkKeys(value: object, allowed: readonly string[]) {
  if (!value || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    fail('不允许通过设定表单修改来源、内部编号或未支持的字段。')
  }
}

function validateCharacter(novel: Novel, character: Character, normalizeFields: readonly string[]) {
  for (const key of ['name', 'identity', 'personality', 'powerLevel', 'faction', 'description', 'avatarColor'] as const) {
    if (typeof character[key] !== 'string') fail('人物字段格式无效：' + key)
  }
  if (normalizeFields.includes('name')) character.name = cleanName(character.name)
  if (!character.name) fail('请填写角色姓名。')
  if (novel.characters.some(other => other.id !== character.id && nameKey(other.name) === nameKey(character.name))) fail('已存在同名角色，请编辑原角色，或使用可区分的姓名。')
  if (character.avatarId !== undefined && typeof character.avatarId !== 'string') fail('角色头像编号格式无效。')
  if (!Array.isArray(character.relationships)) fail('基础关系格式无效。')
  const relationships = character.relationships.map(relation => {
    if (!relation || typeof relation.relation !== 'string' || !relation.relation.trim() || typeof relation.targetId !== 'string') fail('基础关系必须填写有效角色与关系。')
    const target = novel.characters.find(other => other.id === relation.targetId)
    if (!target || target.id === character.id) fail('基础关系必须指向有效的其他角色并填写关系。')
    return { targetId: target.id, targetName: target.name, relation: cleanText(relation.relation),
      ...(relation.dimension === undefined ? {} : { dimension: assertRelationshipDimension(relation.dimension) }) }
  })
  assertStoredRelationshipDimensions(relationships)
  if (relationships.some(relation => !relation.relation)) fail('请填写有效的基础关系。')
  if (normalizeFields.includes('relationships')) character.relationships = relationships
  for (const key of ['aliases', 'events'] as const) if (!Array.isArray(character[key]) || character[key].some(value => typeof value !== 'string')) fail('人物列表字段格式无效：' + key)
  if (!Number.isSafeInteger(character.firstAppearChapter) || character.firstAppearChapter < 0) fail('首次出场章节必须是有效章节编号。')
  if (!['活跃', '退场', '死亡', '失踪', '待核对'].includes(character.status)) fail('角色状态无效。')
}

function validateEvent(novel: Novel, event: EventLogEntry) {
  if (typeof event.title !== 'string' || !event.title.trim() || typeof event.description !== 'string') fail('请填写有效的事件标题和描述。')
  event.title = event.title.trim()
  if (!Number.isSafeInteger(event.chapterIndex) || event.chapterIndex < -1 || !Array.isArray(event.characters) || event.characters.some(value => typeof value !== 'string')) fail('事件章节或相关角色格式无效。')
  if (!['主线', '支线', '伏笔', '转折', '战斗', '其他'].includes(event.type)) fail('事件类型无效。')
  if (novel.eventLog.some(other => other.id !== event.id && other.chapterIndex === event.chapterIndex && other.type === event.type && other.title.trim() === event.title)) fail('同章已存在同名同类事件，请编辑原事件。')
  if (event.relatedArcIds !== undefined && (!Array.isArray(event.relatedArcIds) || event.relatedArcIds.some(id => !novel.storyArcs?.some(arc => arc.id === id)))) fail('关联剧情线已不存在，请重新选择。')
}

function assertCanDelete(novel: Novel, kind: 'character' | 'event', entity: Character | EventLogEntry) {
  if (kind === 'character') {
    const character = entity as Character
    const names = new Set([character.id, character.name, ...character.aliases].map(nameKey))
    if (novel.characters.some(other => other.id !== character.id && other.relationships.some(relation => relation.targetId === character.id))
      || novel.storyArcs?.some(arc => arc.characterIds.includes(character.id))
      || novel.eventLog.some(event => event.characters.some(name => names.has(nameKey(name))))) {
      fail('人物仍被基础关系、剧情线或事件引用，请先解除关联。')
    }
  } else if (novel.storyArcs?.some(arc => arc.turningPointEventIds?.includes(entity.id) || arc.nodes.some(node => node.consequenceEventIds?.includes(entity.id)))
    || novel.chapterPlans?.some(plan => plan.relatedEventIds.includes(entity.id))) {
    fail('事件仍被剧情线、里程碑或章节计划引用，请先解除关联。')
  }
}

/** Only mutates a private transaction draft; callers publish after durable commit. */
export function applyEntityDefinitionEdit(novel: Novel, edit: EntityDefinitionEdit, now: string, makeId: () => string): EntityDefinitionResult {
  const fields: readonly string[] = edit.kind === 'character' ? CHARACTER_CANON_FIELDS : EVENT_CANON_FIELDS
  const displayFields = edit.kind === 'character' ? ['avatarId', 'avatarColor'] : []
  let before: Character | EventLogEntry | undefined, target: Character | EventLogEntry
  let canonical = true
  if (edit.action === 'create') {
    checkKeys(edit.data, [...fields, ...displayFields, ...(edit.kind === 'event' ? ['source'] : [])])
    const id = makeId()
    if (!id || novel.characters.some(item => item.id === id) || novel.eventLog.some(item => item.id === id)) fail('设定编号重复，请重试。')
    if (edit.kind === 'character') {
      target = { id, name: '', aliases: [], identity: '', personality: '', powerLevel: '', faction: '', status: '活跃',
        firstAppearChapter: 0, description: '', relationships: [], events: [], avatarColor: colors[novel.characters.length % colors.length], ...copy(edit.data) }
      if (!target.avatarColor) target.avatarColor = colors[novel.characters.length % colors.length]
    } else {
      if (edit.data.source !== undefined && !['user', 'ai'].includes(edit.data.source)) fail('事件来源无效。')
      target = { importance: 3, ...copy(edit.data), id, source: 'user', timestamp: now, updatedAt: now }
    }
  } else {
    const current = edit.kind === 'character' ? novel.characters.find(item => item.id === edit.entityId) : novel.eventLog.find(item => item.id === edit.entityId)
    if (!current) fail('设定对象已删除，请重新打开列表。')
    if (JSON.stringify(current) !== edit.expectedEntity) fail('设定在编辑期间发生变化，请重新打开并核对后保存。')
    before = copy(current); target = copy(current)
    if (edit.action === 'delete') {
      assertCanDelete(novel, edit.kind, target)
      if (edit.kind === 'character') novel.characters = novel.characters.filter(item => item.id !== target.id)
      else novel.eventLog = novel.eventLog.filter(item => item.id !== target.id)
    } else {
      checkKeys(edit.updates, [...fields, ...displayFields])
      // Undefined is an explicit clear operation and must survive input capture.
      for (const [field, value] of Object.entries(edit.updates)) Object.assign(target, { [field]: value === undefined ? undefined : copy(value) })
      canonical = Object.keys(edit.updates).some(field => fields.includes(field))
    }
  }
  if (edit.action !== 'delete') {
    if (edit.kind === 'character') validateCharacter(novel, target as Character, edit.action === 'create' ? fields : Object.keys(edit.updates))
    else validateEvent(novel, target as EventLogEntry)
    // Validate the full resulting definition using the shared field schema, including enums and optional fields.
    const validation = captureEntityRevision(edit.kind, undefined, target, { kind: 'author' }, now, 'validation')
    validateEntityRevision(validation, '作者设定')
    if (canonical) {
      const revision = captureEntityRevision(edit.kind, before, target, { kind: 'author' }, now, 'author-entity:' + makeId(),
        edit.action === 'update' ? ['$exists', ...Object.keys(edit.updates).filter(field => fields.includes(field))] : undefined)
      validateEntityRevision(revision, '作者设定历史')
      appendEntityRevision(target, revision)
    }
    if (edit.kind === 'event') (target as EventLogEntry).updatedAt = now
    if (edit.kind === 'character') {
      const index = novel.characters.findIndex(item => item.id === target.id)
      if (index < 0) novel.characters.push(target as Character)
      else novel.characters[index] = target as Character
    } else {
      const index = novel.eventLog.findIndex(item => item.id === target.id)
      if (index < 0) novel.eventLog.push(target as EventLogEntry)
      else novel.eventLog[index] = target as EventLogEntry
    }
  }
  const reviewChapterIds = canonical ? registerChapterReviewInvalidation(novel, novel.chapters.map(chapter => chapter.id)) : []
  novel.updatedAt = now
  return { ...(edit.action === 'delete' ? {} : { entity: target }), reviewChapterIds }
}
