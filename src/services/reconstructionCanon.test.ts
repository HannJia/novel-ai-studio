import { describe, expect, it } from 'vitest'
import type { Chapter, Character, Novel } from '@/types/novel'
import type { CandidateChange } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { applyCandidateChangeToCanon, CanonMutationError } from './reconstructionCanon'
import { createStoryClock } from './storyTime'
import { appendEntityRevision, captureEntityRevision, projectCanonicalEntities } from './entityProvenance'
import { acceptCandidateChange } from './reconstructionReview'
import { buildEditedCandidateValue } from './candidateEditing'

const now = '2026-10-26T00:00:00.000Z'

function makeNovel(content = '林澈从封存室取走黑色徽章。'): Novel {
  const chapter = makeChapter('chapter-1', 0, content, '封存室')
  return makeNovelWithChapters([chapter])
}

function makeChapter(id: string, chapterIndex: number, content: string, title = `第 ${chapterIndex + 1} 章`): Chapter {
  return {
    id,
    chapterIndex,
    title,
    content,
    status: 'writing',
    wordCount: content.length,
  } as Chapter
}

function makeNovelWithChapters(chapters: Chapter[]): Novel {
  return {
    id: 'novel-1',
    chapters,
    characters: [],
    eventLog: [],
    storyArcs: [],
    dataPanels: [],
    dataPanelChanges: [],
  } as unknown as Novel
}

function makeCandidate(
  novel: Novel,
  value: Record<string, unknown>,
  type: CandidateChange['type'] = 'fact',
  options: { chapterId?: string; id?: string; quote?: string } = {},
): CandidateChange {
  const chapter = novel.chapters.find(item => item.id === options.chapterId) || novel.chapters[0]
  const sourceVersionId = buildAnalysisSourceVersionId(chapter.content)
  return {
    id: options.id || 'candidate-1',
    novelId: novel.id,
    chapterId: chapter.id,
    type,
    sourceVersionId,
    proposedValue: JSON.stringify(value),
    evidence: [{
      id: 'evidence-1',
      sourceType: 'chapter',
      sourceId: chapter.id,
      sourceVersionId,
      quote: options.quote || chapter.content,
    }],
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
  }
}

describe('reconstruction Canon mutation', () => {
  it('applies edited aliases, status and explicit clearing to an existing character with provenance', () => {
    const novel = makeNovel()
    applyCandidateChangeToCanon(novel, makeCandidate(novel, { kind: 'character', name: '林澈', identity: '调查员', aliases: ['阿澈'], status: '活跃' }), now)
    const proposal = { ...makeCandidate(novel, { kind: 'character', name: '林澈', identity: '调查员', aliases: ['阿澈'], status: '活跃' }, 'fact', { id: 'edited-character' }), status: 'proposed' as const }
    const value = buildEditedCandidateValue(proposal, { identity: '', aliases: '', status: '失踪' })
    const result = applyCandidateChangeToCanon(novel, acceptCandidateChange(proposal, now, value), now)
    expect(novel.characters[0]).toMatchObject({ identity: '', aliases: [], status: '失踪' })
    expect(result.record.entityChanges?.[0].changes.map(change => change.field)).toEqual(expect.arrayContaining(['identity', 'aliases', 'status']))
    expect(projectCanonicalEntities(novel, 1).characters[0]).toMatchObject({ identity: '', aliases: [], status: '失踪' })
    // A later incomplete AI extraction is not an author request to erase an established field.
    novel.characters[0].identity = '保留身份'
    applyCandidateChangeToCanon(novel, makeCandidate(novel, { kind: 'character', name: '林澈', identity: '' }, 'fact', { id: 'incomplete' }), now)
    expect(novel.characters[0].identity).toBe('保留身份')
  })

  it('applies event status and empty editable values when confirming an existing event', () => {
    const novel = makeNovel()
    const payload = { title: '黑色徽章', description: '待说明', characters: ['林澈'], eventType: '伏笔', status: 'planted' }
    applyCandidateChangeToCanon(novel, makeCandidate(novel, payload, 'foreshadowing'), now)
    const proposal = { ...makeCandidate(novel, payload, 'foreshadowing', { id: 'edited-event' }), status: 'proposed' as const }
    const value = buildEditedCandidateValue(proposal, { description: '', characters: '', status: 'resolved' })
    const result = applyCandidateChangeToCanon(novel, acceptCandidateChange(proposal, now, value), now)
    expect(novel.eventLog).toHaveLength(1)
    expect(novel.eventLog[0]).toMatchObject({ description: '', characters: [], status: 'resolved' })
    expect(result.record.entityChanges?.[0].changes.map(change => change.field)).toContain('status')
  })

  it.each(['Infinity', 'NaN'])('refuses non-finite edited timeline days %s before changing the clock', elapsedDays => {
    const novel = makeNovel()
    novel.storyClock = createStoryClock(novel.id, now, 0)
    expect(() => applyCandidateChangeToCanon(novel, makeCandidate(novel, { elapsedDays }, 'timeline'), now)).toThrow('明确填写经过天数')
    expect(novel.storyClock?.currentDay).toBe(0)
    expect(novel.chapters[0].storyDaysElapsed).toBeUndefined()
  })

  it('refuses negative edited timeline days before changing the clock', () => {
    const novel = makeNovel()
    novel.storyClock = createStoryClock(novel.id, now, 0)
    expect(() => applyCandidateChangeToCanon(novel, makeCandidate(novel, { elapsedDays: '-1' }, 'timeline'), now)).toThrow('非负数字')
    expect(novel.storyClock?.currentDay).toBe(0)
    expect(novel.chapters[0].storyDaysElapsed).toBeUndefined()
  })

  it('accepts zero elapsed days after an author confirms the story origin', () => {
    const novel = makeNovel()
    novel.storyClock = createStoryClock(novel.id, now, 0)
    const result = applyCandidateChangeToCanon(novel, makeCandidate(novel, { elapsedDays: '0' }, 'timeline'), now)

    expect(result.changed).toBe(true)
    expect(novel.storyClock?.currentDay).toBe(0)
    expect(novel.chapters[0].storyDaysElapsed).toBe(0)
    expect(novel.chapters[0].storyDay).toBe(0)
  })

  it('writes an accepted character candidate and returns an auditable mutation record', () => {
    const novel = makeNovel()
    const result = applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      kind: 'character', name: '守门人', identity: '封存室守卫', evidence: '守门人',
    }), now)

    expect(novel.characters).toHaveLength(1)
    expect(novel.characters[0]).toMatchObject({ name: '守门人', identity: '封存室守卫' })
    expect(result.changed).toBe(true)
    expect(result.record.candidateId).toBe('candidate-1')
  })

  it('writes an event candidate and is idempotent for a duplicate event', () => {
    const novel = makeNovel()
    const candidate = makeCandidate(novel, {
      title: '获得黑色徽章', description: '主角获得了关键物件', eventType: '主线', characters: ['林澈'],
    })

    expect(applyCandidateChangeToCanon(novel, candidate, now).changed).toBe(true)
    expect(applyCandidateChangeToCanon(novel, candidate, now).changed).toBe(false)
    expect(novel.eventLog).toHaveLength(1)
  })

  it('keeps an earlier character boundary visible when a later accepted candidate was applied first', () => {
    const novel = makeNovelWithChapters([
      makeChapter('chapter-early', 0, '林澈在早章现身。'),
      makeChapter('chapter-late', 2, '林澈在晚章拔剑。'),
    ])
    const records = [] as ReturnType<typeof applyCandidateChangeToCanon>['record'][]

    const late = applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      kind: 'character', name: '林澈', identity: '晚章身份', personality: '晚章性格',
    }, 'fact', { chapterId: 'chapter-late', id: 'character-late' }), now, records).record
    records.push(late)

    const early = applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      kind: 'character', name: '林澈', identity: '早章身份',
    }, 'fact', { chapterId: 'chapter-early', id: 'character-early' }), '2026-10-27T00:00:00.000Z', records).record
    records.push(early)

    const earlyChanges = early.entityChanges?.[0].changes.map(change => change.field) || []
    expect(earlyChanges).toEqual(expect.arrayContaining(['$exists', 'name']))
    expect(projectCanonicalEntities(novel, 2).characters).toHaveLength(1)
    expect(projectCanonicalEntities(novel, 2).characters[0]).toMatchObject({ name: '林澈', identity: '早章身份' })
    expect(projectCanonicalEntities(novel, 2).characters[0].personality).toBe('')
    expect(projectCanonicalEntities(novel, 0).characters).toHaveLength(0)
    expect(novel.characters[0].provenance?.revisions).toEqual(records.flatMap(record => record.entityChanges || []))
  })

  it('keeps event identity chapter-scoped while accepting an earlier same-title candidate after a later one', () => {
    const novel = makeNovelWithChapters([
      makeChapter('chapter-early', 0, '早章发生夺钥。'),
      makeChapter('chapter-late', 2, '晚章再次夺钥。'),
    ])
    const records = [] as ReturnType<typeof applyCandidateChangeToCanon>['record'][]

    const late = applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      title: '夺钥', description: '晚章的夺钥事件', eventType: '主线',
    }, 'fact', { chapterId: 'chapter-late', id: 'event-late' }), now, records).record
    records.push(late)

    const early = applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      title: '夺钥', description: '早章的夺钥事件', eventType: '主线',
    }, 'fact', { chapterId: 'chapter-early', id: 'event-early' }), '2026-10-27T00:00:00.000Z', records).record
    records.push(early)

    expect(novel.eventLog).toHaveLength(2)
    expect(early.entityChanges?.[0].changes.map(change => change.field)).toEqual(expect.arrayContaining(['$exists', 'title']))
    expect(projectCanonicalEntities(novel, 2).events.map(event => event.title)).toEqual(['夺钥'])
    expect(projectCanonicalEntities(novel, 2).events[0].description).toBe('早章的夺钥事件')
    expect(projectCanonicalEntities(novel, 0).events).toHaveLength(0)
    expect(novel.eventLog.flatMap(event => event.provenance?.revisions || [])).toEqual(records.flatMap(record => record.entityChanges || []))
  })

  it('does not rebind an author-defined global identity to a chapter source', () => {
    const novel = makeNovelWithChapters([
      makeChapter('chapter-early', 0, '早章提到林澈。'),
      makeChapter('chapter-late', 2, '晚章再次提到林澈。'),
    ])
    const authorCharacter = {
      id: 'author-character',
      name: '林澈',
      aliases: [],
      identity: '作者指定身份',
      personality: '',
      powerLevel: '',
      faction: '',
      status: '活跃',
      firstAppearChapter: 0,
      description: '',
      relationships: [],
      events: [],
      avatarColor: '#000000',
    } as Character
    appendEntityRevision(authorCharacter, captureEntityRevision('character', undefined, authorCharacter, { kind: 'author' }, now, 'author-character'))
    novel.characters = [authorCharacter]

    applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      kind: 'character', name: '林澈', identity: '晚章补充身份',
    }, 'fact', { chapterId: 'chapter-late', id: 'character-late' }), now)
    const early = applyCandidateChangeToCanon(novel, makeCandidate(novel, {
      kind: 'character', name: '林澈', identity: '早章补充身份',
    }, 'fact', { chapterId: 'chapter-early', id: 'character-early' }), '2026-10-27T00:00:00.000Z')

    expect(early.record.entityChanges?.[0].changes.map(change => change.field)).not.toEqual(expect.arrayContaining(['$exists', 'name']))
    expect(projectCanonicalEntities(novel, 0).characters[0].identity).toBe('作者指定身份')
  })

  it('updates the story clock only after an accepted timeline candidate', () => {
    const novel = makeNovel()
    novel.storyClock = createStoryClock(novel.id, now, 0)
    const candidate = makeCandidate(novel, { elapsedDays: 2 }, 'timeline')
    const result = applyCandidateChangeToCanon(novel, candidate, now)

    expect(result.changed).toBe(true)
    expect(novel.storyClock).toMatchObject({ currentDay: 2, label: '第 3 天', lastChapterIndex: 0 })
    expect(novel.chapters[0].storyDaysElapsed).toBe(2)
    expect(novel.chapters[0].storyDay).toBe(2)
  })

  it('rejects a candidate when the chapter changed after analysis', () => {
    const novel = makeNovel()
    const candidate = makeCandidate(novel, { title: '获得黑色徽章', eventType: '主线' })
    novel.chapters[0].content += ' 后来他将徽章藏了起来。'

    expect(() => applyCandidateChangeToCanon(novel, candidate, now)).toThrow(CanonMutationError)
    expect(novel.eventLog).toHaveLength(0)
  })
})
