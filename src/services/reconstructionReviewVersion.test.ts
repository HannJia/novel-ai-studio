import { applyEntityDefinitionEdit } from './entityDefinitionEditing'
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import type { Character, EventLogEntry } from '@/types/novel'
import { buildChapterReviewSourceVersion, buildReviewContextVersion } from './reconstructionReviewVersion'
import { createChapterSourceBinding } from './derivedSources'

function fixture() {
  setActivePinia(createPinia())
  const store = useNovelStore()
  const novel = store.addNovel({ genre: 'urban', subGenre: 'business', tags: [], targetWordCountMin: 80,
    targetWordCountMax: 100, writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings() })
  const previous = store.addChapter(novel.id, { title: '前章', content: '已有正文', volumeIndex: 0 })!
  const chapter = store.addChapter(novel.id, { title: '当前章', content: '当前正文', volumeIndex: 0 })!
  const version = () => buildChapterReviewSourceVersion(chapter.content, buildReviewContextVersion(novel, chapter))
  return { novel, previous, chapter, store, version }
}

describe('shared chapter review version', () => {
  it('uses only confirmed current summaries and invalidates review after confirmation', () => {
    const { previous, version } = fixture()
    const unbound = version()
    previous.summary = '守卫已经离开。'
    expect(version()).toBe(unbound)
    previous.summarySource = createChapterSourceBinding(previous, previous.summary, 'author', '2026-10-27')
    expect(version()).not.toBe(unbound)
    previous.summary = '未经重新确认的修改。'
    expect(version()).toBe(unbound)
    previous.summarySource = createChapterSourceBinding(previous, previous.summary, 'author', '2026-10-27')
    const confirmed = version()
    previous.content += '作者改稿。'
    const stale = version()
    expect(stale).not.toBe(confirmed)
    previous.summary = '旧总结不参与当前审核版本。'
    expect(version()).toBe(stale)
  })
  it('invalidates a review after same-length preceding text, settings, or character status changes', () => {
    const { novel, previous, version } = fixture()
    const initial = version()
    previous.content = '前文改稿'
    expect(version()).not.toBe(initial)
    const beforeSettings = version()
    novel.settings.worldBuilding.specialRules = '禁止夜间出城'
    expect(version()).not.toBe(beforeSettings)
    const character = applyEntityDefinitionEdit(novel, { action: 'create', kind: 'character', data: { name: '守门人', identity: '守卫' } }, novel.createdAt, () => 'test-guard').entity!
    const beforeStatus = version()
    character.status = '死亡'
    expect(version()).not.toBe(beforeStatus)
  })

  it('ignores current chapter save timestamps and review outputs', () => {
    const { novel, chapter, version } = fixture()
    const initial = version()
    chapter.contentReview = '审核通过'
    chapter.updatedAt = '2026-10-27T12:00:00.000Z'
    novel.updatedAt = chapter.updatedAt
    chapter.status = 'reviewed'
    expect(version()).toBe(initial)
  })

  it('tracks character and event changes only when they change the bounded review input', () => {
    const { novel, chapter } = fixture()
    const character = applyEntityDefinitionEdit(novel, { action: 'create', kind: 'character', data: { name: '守门人', firstAppearChapter: 0 } }, novel.createdAt, () => 'review-character').entity as Character
    let initial = buildReviewContextVersion(novel, chapter)
    applyEntityDefinitionEdit(novel, { action: 'update', kind: 'character', entityId: character.id,
      expectedEntity: JSON.stringify(character), updates: { firstAppearChapter: 1 } }, novel.createdAt, () => 'review-character-update')
    expect(buildReviewContextVersion(novel, chapter)).toBe(initial)
    const currentCharacter = novel.characters.find(item => item.id === character.id)!
    applyEntityDefinitionEdit(novel, { action: 'update', kind: 'character', entityId: character.id,
      expectedEntity: JSON.stringify(currentCharacter), updates: { firstAppearChapter: 2 } }, novel.createdAt, () => 'review-character-later')
    expect(buildReviewContextVersion(novel, chapter)).not.toBe(initial)

    const event = applyEntityDefinitionEdit(novel, { action: 'create', kind: 'event', data: {
      title: '回收线索', description: '追查来源', chapterIndex: -1, characters: [character.id], type: '伏笔',
      scope: 'global', status: 'developing', hintCount: 1,
    } }, novel.createdAt, () => 'review-event').entity as EventLogEntry
    initial = buildReviewContextVersion(novel, chapter)
    applyEntityDefinitionEdit(novel, { action: 'update', kind: 'event', entityId: event.id,
      expectedEntity: JSON.stringify(event), updates: { hintCount: 2 } }, novel.createdAt, () => 'review-event-hint')
    expect(buildReviewContextVersion(novel, chapter)).not.toBe(initial)

    initial = buildReviewContextVersion(novel, chapter)
    const currentEvent = novel.eventLog.find(item => item.id === event.id)!
    applyEntityDefinitionEdit(novel, { action: 'update', kind: 'event', entityId: event.id,
      expectedEntity: JSON.stringify(currentEvent), updates: { lastProgressChapterIndex: chapter.chapterIndex } }, novel.createdAt, () => 'review-event-progress')
    expect(buildReviewContextVersion(novel, chapter)).toBe(initial)
  })

  it('tracks prior chapter labels used in the review summary', () => {
    const { previous, version } = fixture()
    const initial = version()
    previous.title = '新标题'
    expect(version()).not.toBe(initial)
  })

  it('includes bound knowledge revisions and excludes unrelated knowledge', () => {
    const { novel, chapter } = fixture()
    novel.knowledgeBaseIds = ['bound']
    const knowledge = ['bound', 'other'].map(id => ({ id, name: id, description: '', createdAt: novel.createdAt,
      entries: [{ id: id + '-rule', title: '规则', category: '世界观', content: '原始规则', summary: '', tags: [],
        createdAt: novel.createdAt, updatedAt: novel.createdAt }] }))
    const initial = buildReviewContextVersion(novel, chapter, knowledge)
    knowledge[1].entries[0].content = '其他规则'
    expect(buildReviewContextVersion(novel, chapter, knowledge)).toBe(initial)
    knowledge[0].entries[0].content = '本书新规'
    expect(buildReviewContextVersion(novel, chapter, knowledge)).not.toBe(initial)
  })
})
