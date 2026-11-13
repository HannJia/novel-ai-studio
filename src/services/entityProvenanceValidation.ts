import type { Novel } from '@/types/novel'
import { assertStoredRelationshipDimensions } from './characterMemoryValidation'
import type { CanonMutationRecord } from '@/types/reconstruction'
import type { EntityKind, EntityRevision } from '@/types/entityProvenance'
import {
  ARC_CANON_FIELDS,
  ARC_NODE_CANON_FIELDS,
  CHARACTER_CANON_FIELDS,
  EVENT_CANON_FIELDS,
} from '../types/entityProvenance'

const fail = (path: string): never => { throw new Error('备份实体来源无效：' + path) }
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path)
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in Object.getOwnPropertyDescriptor(result, key)!)) fail(path + '.' + key)
  }
  return result
}
const text = (value: unknown, path: string, nonempty = false): void => {
  if (typeof value !== 'string' || value.length > 5_000_000 || (nonempty && !value.trim())) fail(path)
}
const array = (value: unknown, path: string, max = 100_000): unknown[] => {
  if (!Array.isArray(value) || value.length > max) fail(path)
  return value as unknown[]
}
const integer = (value: unknown, path: string, min = 0): void => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail(path)
}

function fieldValue(kind: EntityKind, field: string, value: unknown, path: string): void {
  if (value === undefined) return
  if (field === '$exists') { if (typeof value !== 'boolean') fail(path); return }
  if (['firstAppearChapter', 'chapterIndex', 'hintCount', 'targetChapter', 'actualChapter', 'importance', 'lastProgressChapterIndex', 'resolvedChapterIndex'].includes(field)) {
    integer(value, path, field === 'chapterIndex' ? -1 : 0)
    if (field === 'importance' && ((value as number) < 1 || (value as number) > 5)) fail(path)
    return
  }
  if (['aliases', 'events', 'characters', 'relatedArcIds', 'characterIds', 'dependencyArcIds', 'turningPointEventIds', 'prerequisiteNodeIds', 'consequenceEventIds'].includes(field)) {
    array(value, path, 20_000).forEach(item => text(item, path)); return
  }
  if (field === 'relationships') {
    assertStoredRelationshipDimensions(value)
    array(value, path, 20_000).forEach(item => {
      const relation = object(item, path)
      for (const key of ['targetId', 'targetName', 'relation']) text(relation[key], path + '.' + key)
    }); return
  }
  text(value, path)
  const choices = field === 'status' ? kind === 'character' ? ['活跃', '退场', '死亡', '失踪', '待核对']
    : kind === 'event' ? ['planted', 'developing', 'resolved', 'abandoned', 'unverified']
      : kind === 'arc' ? ['active', 'paused', 'completed', 'abandoned', 'unverified']
        : ['pending', 'completed', 'abandoned', 'unverified']
    : field === 'type' ? kind === 'arc' ? ['main', 'sub', 'character', 'relationship', 'mystery', 'world']
      : ['主线', '支线', '伏笔', '转折', '战斗', '其他']
      : field === 'scope' ? ['chapter', 'volume', 'global'] : undefined
  if (choices && !choices.includes(value as string)) fail(path)
}

export function validateEntityRevision(value: unknown, path = 'entityChanges'): asserts value is EntityRevision {
  const row = object(value, path)
  text(row.id, path + '.id', true); text(row.entityId, path + '.entityId', true)
  if (!['character', 'event', 'arc', 'arc_node'].includes(row.entityType as string)) fail(path + '.entityType')
  const kind = row.entityType as EntityKind
  text(row.appliedAt, path + '.appliedAt', true)
  const date = row.appliedAt as string
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== date.slice(0, 10)) fail(path + '.appliedAt')
  const source = object(row.source, path + '.source')
  if (source.kind === 'chapter') {
    text(source.chapterId, path + '.chapterId', true); text(source.sourceVersionId, path + '.sourceVersionId', true)
    integer(source.chapterIndex, path + '.chapterIndex')
    const evidence = array(source.evidence, path + '.evidence', 64)
    if (!evidence.length) fail(path + '.evidence')
    evidence.forEach(item => {
      const quote = object(item, path + '.evidence')
      text(quote.quote, path + '.quote', true)
      if (quote.startOffset !== undefined || quote.endOffset !== undefined) {
        integer(quote.startOffset, path + '.startOffset'); integer(quote.endOffset, path + '.endOffset')
        if ((quote.endOffset as number) - (quote.startOffset as number) !== (quote.quote as string).length) fail(path + '.endOffset')
      }
    })
  } else if (source.kind !== 'author') fail(path + '.source.kind')
  const allowed: readonly string[] = kind === 'character' ? CHARACTER_CANON_FIELDS
    : kind === 'event' ? EVENT_CANON_FIELDS
      : kind === 'arc' ? ARC_CANON_FIELDS : ARC_NODE_CANON_FIELDS
  const fields = new Set<string>()
  const changes = array(row.changes, path + '.changes', 40)
  if (!changes.length) fail(path + '.changes')
  changes.forEach(value => {
    const change = object(value, path + '.changes')
    const field = change.field as string
    if ((field !== '$exists' && !allowed.includes(field)) || fields.has(field)) fail(path + '.field')
    fields.add(field)
    fieldValue(kind, field, change.before, path + '.before.' + field)
    fieldValue(kind, field, change.after, path + '.after.' + field)
  })
  if (row.baseline !== undefined) {
    const baselineFields = new Set<string>()
    array(row.baseline, path + '.baseline', 40).forEach(value => {
      const change = object(value, path + '.baseline')
      const field = change.field as string
      if ((field !== '$exists' && !allowed.includes(field)) || baselineFields.has(field) || change.before === undefined) fail(path + '.baseline.field')
      baselineFields.add(field)
      fieldValue(kind, field, change.before, path + '.baseline.before.' + field)
      if (change.after !== undefined && (field !== '$exists' || change.after !== true || change.before !== true)) fail(path + '.baseline.after')
    })
  }
}

function checkForeignReferences(revision: EntityRevision, owner: string, novels: Novel[], path: string) {
  if (revision.source.kind === 'chapter') {
    const id = revision.source.chapterId
    if (novels.some(novel => novel.id !== owner && novel.chapters.some(chapter => chapter.id === id))) fail(path + '.source.chapterId（属于其他作品）')
  }
  for (const change of [...revision.changes, ...(revision.baseline || [])]) {
    const referenceKind = change.field === 'relationships' ? 'character'
      : change.field === 'characterIds' ? 'character'
        : change.field === 'dependencyArcIds' ? 'arc'
          : change.field === 'turningPointEventIds' || change.field === 'consequenceEventIds' ? 'event'
            : change.field === 'prerequisiteNodeIds' ? 'arc_node' : undefined
    if (!referenceKind) continue
    for (const value of [change.before, change.after]) {
      if (!Array.isArray(value)) continue
      for (const relation of value) {
        const targetId = referenceKind === 'character' && change.field === 'relationships'
          ? typeof relation === 'object' && relation !== null ? (relation as { targetId?: unknown }).targetId : undefined
          : relation
        if (typeof targetId !== 'string') continue
        const foreign = novels.some(novel => novel.id !== owner && (
          referenceKind === 'character' ? novel.characters.some(character => character.id === targetId)
            : referenceKind === 'event' ? novel.eventLog.some(event => event.id === targetId)
              : referenceKind === 'arc' ? (novel.storyArcs || []).some(arc => arc.id === targetId)
                : (novel.storyArcs || []).some(arc => arc.nodes.some(node => node.id === targetId))
        ))
        if (foreign) fail(path + '.' + change.field + '（属于其他作品）')
      }
    }
  }
}

function validateEntityHistory(kind: EntityKind, entity: { id: string; provenance?: unknown }, novel: Novel, novels: Novel[], path: string): void {
  if (entity.provenance === undefined) return
  const provenance = object(entity.provenance, path)
  const ids = new Set<string>()
  for (const row of array(provenance.revisions, path + '.revisions')) {
    validateEntityRevision(row, path)
    if (row.entityType !== kind || row.entityId !== entity.id || ids.has(row.id)) fail(path + '.owner')
    if (row.baseline && ids.size > 0) fail(path + '.baseline（只能记录首次变更前的值）')
    ids.add(row.id)
    checkForeignReferences(row, novel.id, novels, path)
  }
}

export function validateEntityHistories(novels: Novel[]): void {
  for (const novel of novels) for (const proposal of novel.storyStateProposals || []) {
    if (proposal.chapterSource === undefined) continue
    const path = 'storyStateProposals.' + proposal.id + '.chapterSource'
    const revision = { id: proposal.id, entityType: 'event' as const, entityId: proposal.targetId,
      source: proposal.chapterSource, appliedAt: proposal.createdAt, changes: [{ field: '$exists', after: true }] }
    validateEntityRevision(revision, path)
    if (revision.source.kind !== 'chapter' || revision.source.chapterIndex !== proposal.chapterIndex) fail(path)
    checkForeignReferences(revision, novel.id, novels, path)
  }
  for (const novel of novels) {
    for (const [kind, entities] of [['character', novel.characters], ['event', novel.eventLog]] as const) {
      for (const entity of entities) validateEntityHistory(kind, entity, novel, novels, 'provenance.' + kind + '.' + entity.id)
    }
    for (const arc of novel.storyArcs || []) {
      validateEntityHistory('arc', arc, novel, novels, 'provenance.arc.' + arc.id)
      for (const node of arc.nodes) validateEntityHistory('arc_node', node, novel, novels, 'provenance.arc_node.' + node.id)
    }
  }
}

export function validateCanonEntityChanges(record: CanonMutationRecord, novels: Novel[], path: string): void {
  if (record.entityChanges === undefined) return
  const ids = new Set<string>()
  for (const row of array(record.entityChanges, path + '.entityChanges', 40)) {
    validateEntityRevision(row, path + '.entityChanges')
    if (row.entityId !== record.targetId || ids.has(row.id)) fail(path + '.entityChanges.owner')
    const allowedTypes = row.entityType === 'character' ? ['fact', 'state']
      : row.entityType === 'arc' || row.entityType === 'arc_node' ? ['plotline']
        : ['fact', 'foreshadowing', 'plotline']
    if (!allowedTypes.includes(record.type)) fail(path + '.entityChanges.type')
    ids.add(row.id)
    if (row.source.kind !== 'chapter' || row.source.chapterId !== record.chapterId) fail(path + '.entityChanges.source')
    if (row.appliedAt !== record.appliedAt) fail(path + '.entityChanges.appliedAt')
    checkForeignReferences(row, record.novelId, novels, path)
    const targets = novels.filter(novel => novel.id !== record.novelId).flatMap(novel => row.entityType === 'character' ? novel.characters.map(item => item.id)
      : row.entityType === 'event' ? novel.eventLog.map(item => item.id)
        : row.entityType === 'arc' ? (novel.storyArcs || []).map(item => item.id)
          : (novel.storyArcs || []).flatMap(item => item.nodes.map(node => node.id)))
    if (targets.includes(row.entityId)) fail(path + '.entityChanges.entityId')
    const owner = novels.find(novel => novel.id === record.novelId)
    const entity = row.entityType === 'character' ? owner?.characters.find(item => item.id === row.entityId)
      : row.entityType === 'event' ? owner?.eventLog.find(item => item.id === row.entityId)
        : row.entityType === 'arc' ? owner?.storyArcs?.find(item => item.id === row.entityId)
          : owner?.storyArcs?.flatMap(item => item.nodes).find(item => item.id === row.entityId)
    if (entity) {
      const embedded = entity.provenance?.revisions.find(item => item.id === row.id)
      const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
      if (!embedded || JSON.stringify(canonical(embedded)) !== JSON.stringify(canonical(row))) fail(path + '.entityChanges（与实体历史不一致）')
    }
  }
}
