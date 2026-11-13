import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture, stateTestTime as now } from '@/test/characterStateFixture'
import type { Character, EventLogEntry } from '@/types/novel'
import { applyEntityDefinitionEdit, type EntityDefinitionEdit } from './entityDefinitionEditing'

beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const novel = JSON.parse(JSON.stringify(characterStateFixture().novel)) as ReturnType<typeof characterStateFixture>['novel']
  let sequence = 0
  const apply = (edit: EntityDefinitionEdit) => applyEntityDefinitionEdit(novel, edit, now, () => 'edit-' + ++sequence)
  const update = (target: Character | EventLogEntry, kind: 'character' | 'event', updates: Partial<Character> | Partial<EventLogEntry>) => apply({ action: 'update', kind, entityId: target.id, expectedEntity: JSON.stringify(target), updates })
  return { novel, apply, update }
}

describe('author definition editing', () => {
  it('creates explicit author definitions and invalidates only written chapters, retaining locks and reports', () => {
    const { novel, apply } = fixture()
    novel.chapters[0].status = 'finalized'; novel.chapters[0].contentReview = '旧报告'
    novel.chapters[1].status = 'locked'; novel.chapters[1].contentReviewSignature = 'old'
    novel.chapters[2].content = ''; novel.chapters[2].status = 'draft'
    const result = apply({ action: 'create', kind: 'character', data: { name: ' **白  舟** ' } })
    expect(result.entity).toMatchObject({ name: '白 舟', status: '活跃', relationships: [] })
    expect(result.entity?.provenance?.revisions[0].source).toEqual({ kind: 'author' })
    expect(result.reviewChapterIds).toEqual(novel.chapters.slice(0, 2).map(chapter => chapter.id))
    expect(novel.chapters[0]).toMatchObject({ status: 'writing', contentReview: '旧报告', contentReviewSignature: '' })
    expect(novel.chapters[1]).toMatchObject({ status: 'locked', contentReviewSignature: '' })
    expect(novel.chapters[2].status).toBe('draft')
  })

  it('rejects normalized duplicate names without silently merging author data', () => {
    const { novel, apply } = fixture(), before = JSON.stringify(novel)
    expect(() => apply({ action: 'create', kind: 'character', data: { name: '**林澈**', identity: '无意覆盖' } })).toThrow('同名')
    expect(JSON.stringify(novel)).toBe(before)
  })

  it.each([{ id: 'forged' }, { provenance: { revisions: [] } }, { firstAppearChapter: -1 }, { status: 'unknown' }, { aliases: [7] }])('rejects invalid or internal character fields: %j', data => {
    const { novel, apply } = fixture(), before = JSON.stringify(novel)
    expect(() => apply({ action: 'create', kind: 'character', data: { name: '独立角色', ...data } as Partial<Character> })).toThrow()
    expect(JSON.stringify(novel)).toBe(before)
  })

  it('updates the supplied relationship by ID and refuses self or absent targets', () => {
    const { novel, update } = fixture(), [left, right] = novel.characters
    const result = update(left, 'character', { relationships: [{ targetId: right.id, targetName: '过时称呼', relation: '同伴' }] })
    expect((result.entity as Character).relationships).toEqual([{ targetId: right.id, targetName: right.name, relation: '同伴' }])
    const current = novel.characters[0], before = JSON.stringify(novel)
    for (const targetId of [left.id, 'missing']) expect(() => update(current, 'character', { relationships: [{ targetId, targetName: right.name, relation: '同伴' }] })).toThrow()
    expect(JSON.stringify(novel)).toBe(before)
  })

  it('changes only display fields for avatar edits and does not reaffirm canonical facts', () => {
    const { novel, update } = fixture(), character = novel.characters[0]
    character.relationships = [{ targetId: novel.characters[1].id, targetName: '过去的称呼', relation: '同伴' }]
    novel.chapters[0].status = 'finalized'; novel.chapters[0].contentReviewSignature = 'current'
    const result = update(character, 'character', { avatarId: 'ink-scholar-f' })
    expect(result.reviewChapterIds).toEqual([])
    expect(result.entity?.provenance).toBeUndefined()
    expect((result.entity as Character).relationships[0].targetName).toBe('过去的称呼')
    expect(novel.chapters[0]).toMatchObject({ status: 'finalized', contentReviewSignature: 'current' })
  })

  it('rejects old update/delete snapshots before changing any live definition', () => {
    const { novel, apply, update } = fixture(), character = novel.characters[0], expectedEntity = JSON.stringify(character)
    update(character, 'character', { identity: '新身份' })
    const before = JSON.stringify(novel)
    expect(() => apply({ action: 'delete', kind: 'character', entityId: character.id, expectedEntity })).toThrow('编辑期间发生变化')
    expect(() => apply({ action: 'update', kind: 'character', entityId: character.id, expectedEntity, updates: { identity: '旧表单' } })).toThrow('编辑期间发生变化')
    expect(JSON.stringify(novel)).toBe(before)
  })

  it('blocks current relation and event-role references, but does not infer references from prose', () => {
    const { novel, apply } = fixture(), [left, right] = novel.characters
    const deletion: EntityDefinitionEdit = { action: 'delete', kind: 'character', entityId: right.id, expectedEntity: JSON.stringify(right) }
    left.relationships.push({ targetId: right.id, targetName: right.name, relation: '同伴' })
    expect(() => apply(deletion)).toThrow('引用')
    left.relationships = []
    const event = apply({ action: 'create', kind: 'event', data: { chapterIndex: 0, title: '相见', description: '遇见苏禾', characters: [right.name], type: '主线' } }).entity as EventLogEntry
    expect(() => apply(deletion)).toThrow('引用')
    event.characters = []
    apply(deletion)
    expect(novel.characters.some(character => character.id === right.id)).toBe(false)
    expect(novel.chapters[0].content).toContain(right.name)
  })

  it('keeps approved outline events author sourced and validates event tracking fields and duplicate definitions', () => {
    const { novel, apply, update } = fixture()
    const data: Omit<EventLogEntry, 'id' | 'timestamp'> = { title: '全书伏笔', description: '保留悬念', chapterIndex: -1, characters: [], type: '伏笔', scope: 'global', source: 'ai' }
    const event = apply({ action: 'create', kind: 'event', data }).entity as EventLogEntry
    expect(event.source).toBe('user'); expect(event.provenance?.revisions[0].source.kind).toBe('author')
    expect(() => apply({ action: 'create', kind: 'event', data })).toThrow('同名')
    for (const updates of [{ hintCount: -1 }, { hintCount: 1.5 }, { scope: 'invalid' }, { relatedArcIds: ['missing'] }, { importance: 6 }]) {
      expect(() => update(event, 'event', updates as Partial<EventLogEntry>)).toThrow()
    }
    update(event, 'event', { lastProgressChapterIndex: 0, resolvedChapterIndex: 0 })
    update(novel.eventLog[0], 'event', { resolvedChapterIndex: undefined })
    expect(novel.eventLog[0].resolvedChapterIndex).toBeUndefined()
    const deletion: EntityDefinitionEdit = { action: 'delete', kind: 'event', entityId: event.id, expectedEntity: JSON.stringify(novel.eventLog[0]) }
    novel.chapterPlans = [{ id: 'plan', horizon: 'next', title: '回收', objective: '', summary: '', beats: [], targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [event.id], status: 'planned', source: 'user', createdAt: now, updatedAt: now }]
    expect(() => apply(deletion)).toThrow('章节计划')
    novel.chapterPlans[0].relatedEventIds = []
    apply(deletion); expect(novel.eventLog).toEqual([])
  })
})
