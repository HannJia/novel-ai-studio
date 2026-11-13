import { applyEntityDefinitionEdit } from './entityDefinitionEditing'
import { describe, expect, it } from 'vitest'
import { parseProjectBackup } from './projectBackup'
import { createTestProjectBackup as createProjectBackup } from '@/test/projectBackupFixture'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { createChapterSourceBinding } from './derivedSources'

function validBook() {
  setActivePinia(createPinia())
  const store = useNovelStore()
  return store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
}

describe('项目备份格式', () => {
  it('round trips archived chapters with their original manuscript and revision history', () => {
    const book = validBook(), chapter = useNovelStore().addChapter(book.id, { content: '删除前的合成正文。', summary: '原章总结。' })!
    book.archivedChapters = [{ ...chapter, archivedAt: book.updatedAt }]
    book.chapters = []; book.currentWordCount = 0
    const backup = createProjectBackup([book], [], [{ id: 'archived-revision', novelId: book.id, chapterId: chapter.id,
      baseContent: chapter.content, proposedContent: '未接受的改稿', diff: '', source: 'user', reason: '', status: 'rejected',
      createdAt: book.createdAt, updatedAt: book.updatedAt }])
    expect(parseProjectBackup(JSON.stringify(backup))).toEqual(backup)
  })

  it.each(['active-alias', 'archive-alias', 'bad-time', 'bad-body', 'wrong-summary', 'active-marker'] as const)(
    'rejects malformed archived chapters before import: %s', problem => {
      const book = validBook(), chapter = useNovelStore().addChapter(book.id, { content: '合成正文。', summary: '合成总结。' })!
      book.archivedChapters = [{ ...chapter, archivedAt: book.updatedAt }]
      book.chapters = []; book.currentWordCount = 0
      const backup = createProjectBackup([book], [])
      const stored = backup.novels[0], archived = stored.archivedChapters![0]
      if (problem === 'active-alias') stored.chapters = [chapter]
      if (problem === 'archive-alias') stored.archivedChapters!.push({ ...archived })
      if (problem === 'bad-time') archived.archivedAt = 'not-a-date'
      if (problem === 'bad-body') (archived as unknown as Record<string, unknown>).content = 12
      if (problem === 'wrong-summary') archived.summarySource!.chapterId = 'other-chapter'
      if (problem === 'active-marker') { stored.chapters = [archived]; stored.archivedChapters = [] }
      expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow('备份数据不完整或无效')
    })

  it('preserves stale chapter-summary provenance and historical bindings without trusting them again', () => {
    const book = validBook(), store = useNovelStore()
    const chapter = store.addChapter(book.id, { content: '正文第一版。', summary: '总结第一版。' })!
    store.updateChapter(book.id, chapter.id, { content: '正文第二版。' })
    const backup = createProjectBackup([store.getNovel(book.id)!], [])
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.novels[0].chapters[0].summarySource).toEqual(chapter.summarySource)
    expect(parsed.novels[0].chapters[0].versions).toEqual(chapter.versions)
  })

  it.each(['empty-value', 'other-chapter', 'bad-origin', 'bad-date', 'history-owner'] as const)(
    'rejects malformed or cross-chapter summary sources: %s', problem => {
      const book = validBook(), store = useNovelStore()
      const chapter = store.addChapter(book.id, { content: '正文。', summary: '总结。' })!
      const backup = createProjectBackup([store.getNovel(book.id)!], [])
      const item = backup.novels[0].chapters[0]
      if (problem === 'history-owner') {
        item.versions = [{ id: 'history', label: '旧版', savedAt: book.createdAt, snapshot: JSON.stringify({
          title: '历史标题', content: chapter.content, summary: chapter.summary, status: 'draft',
          summarySource: createChapterSourceBinding({ id: 'other', content: chapter.content }, chapter.summary, 'author', book.createdAt),
        }) }]
      } else {
        const source = item.summarySource! as unknown as Record<string, unknown>
        if (problem === 'empty-value') source.derivedValue = '  '
        if (problem === 'other-chapter') source.chapterId = 'other'
        if (problem === 'bad-origin') source.origin = 'unknown'
        if (problem === 'bad-date') source.createdAt = 'not-a-date'
      }
      expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow('summarySource')
    })

  it('round trips optional manual avatar IDs and keeps legacy characters valid', () => {
    const book = validBook()
    const store = useNovelStore()
    applyEntityDefinitionEdit(book, { action: 'create', kind: 'character', data: { name: '林晚', identity: '学者', avatarId: 'ink-scholar-f' } }, book.createdAt, () => 'test-scholar')
    applyEntityDefinitionEdit(book, { action: 'create', kind: 'character', data: { name: '沈舟', identity: '剑客' } }, book.createdAt, () => 'test-warrior')
    const parsed = parseProjectBackup(JSON.stringify(createProjectBackup([store.getNovel(book.id)!], [])))
    expect(parsed.novels[0].characters[0].avatarId).toBe('ink-scholar-f')
    expect(parsed.novels[0].characters[1].avatarId).toBeUndefined()
  })

  it('round trips an optional manual cover ID, keeps books without one valid, and rejects a non-text cover', () => {
    const covered = validBook()
    const store = useNovelStore()
    store.setCover(covered.id, 'moon-1')
    const plain = store.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
      settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
    const backup = createProjectBackup([store.getNovel(covered.id)!, store.getNovel(plain.id)!], [])
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.novels.find(n => n.id === covered.id)!.coverId).toBe('moon-1')
    expect(parsed.novels.find(n => n.id === plain.id)!.coverId).toBeUndefined()
    store.setCover(covered.id, '')
    expect(store.getNovel(covered.id)!.coverId).toBeUndefined()
    const corrupt = JSON.parse(JSON.stringify(backup))
    corrupt.novels[0].coverId = 12
    expect(() => parseProjectBackup(JSON.stringify(corrupt))).toThrow('coverId')
  })

  it('preserves book length settings and validates their order during backup import', () => {
    const book = validBook()
    book.chapterLengthPolicy = { minWords: 3000, targetWords: 3500, maxWords: 4000 }
    const backup = createProjectBackup([book], [])
    expect(parseProjectBackup(JSON.stringify(backup)).novels[0].chapterLengthPolicy).toEqual(book.chapterLengthPolicy)
    backup.novels[0].chapterLengthPolicy!.minWords = 5000
    expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow('chapterLengthPolicy')
  })
  it('preserves and validates equipment and structured pending memory', () => {
    const book = validBook()
    book.dataPanels = [{ id: 'sword', name: '铁剑', category: '装备', equipmentState: 'stored',
      fields: [{ id: 'bonus', name: '攻击加成', value: '10', unit: '', note: '', modifier: { attribute: '攻击力', operation: 'flat' } }],
      relatedKeywords: [], createdAt: book.createdAt, updatedAt: book.updatedAt }]
    book.dataPanelChanges = [{ id: 'create', itemId: 'new:ring', fieldId: '__create__', itemName: '戒指', fieldName: '新增对象',
      oldValue: '未记录', newValue: '戒指', reason: '获得戒指', chapterIndex: 0, status: 'pending', createdAt: book.createdAt,
      mutation: { kind: 'create', item: { name: '戒指', category: '装备', fields: [], relatedKeywords: [], equipmentState: 'stored' } } }]
    const backup = createProjectBackup([book], [])
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.novels[0].dataPanels).toEqual(book.dataPanels)
    expect(parsed.novels[0].dataPanelChanges).toEqual(book.dataPanelChanges)
    const corrupt = JSON.parse(JSON.stringify(backup))
    corrupt.novels[0].dataPanelChanges[0].mutation.kind = 'unknown'
    expect(() => parseProjectBackup(JSON.stringify(corrupt))).toThrow('mutation')
    corrupt.novels[0].dataPanelChanges = []
    corrupt.novels[0].dataPanels[0].fields[0].modifier.operation = 'eval'
    expect(() => parseProjectBackup(JSON.stringify(corrupt))).toThrow('operation')
  })

  it('preserves separate inspiration archives and validates their nested fields', () => {
    const book = validBook()
    book.inspirationHistory = [{ id: 'idea', role: 'assistant', content: '存档内容', timestamp: book.createdAt,
      search: { protocol: 'responses', status: 'searched', sources: [{ title: '来源', url: 'https://example.org' }] } }]
    const backup = createProjectBackup([book], [])
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.novels[0].inspirationHistory).toEqual(book.inspirationHistory)
    expect(parsed.novels[0].chatHistory).toHaveLength(0)
    parsed.novels[0].inspirationHistory![0].search!.sources = '错误类型' as any
    expect(() => parseProjectBackup(JSON.stringify(parsed))).toThrow('inspirationHistory')
    backup.novels[0].inspirationHistory!.push({ ...book.inspirationHistory[0] })
    expect(() => parseProjectBackup(JSON.stringify(backup))).toThrow('重复 ID')
  })

  it('可以深拷贝项目数据并成功解析', () => {
    const novels = [{ ...validBook(), id: 'novel-1', title: '测试书' }]
    const knowledgeBases = [{ id: 'kb-1', entries: [], name: '设定库', description: '', createdAt: new Date().toISOString() }]
    const backup = createProjectBackup(novels, knowledgeBases)
    const parsed = parseProjectBackup(JSON.stringify(backup))
    expect(parsed.format).toBe('ai-novel-writer-backup')
    expect(parsed.novels[0].id).toBe('novel-1')
    expect(parsed.knowledgeBases[0].id).toBe('kb-1')
    novels[0].title = '修改后'
    expect(parsed.novels[0].title).toBe('测试书')
  })

  it('拒绝格式或必需数组不正确的文件', () => {
    expect(() => parseProjectBackup('{}')).toThrow('不是有效的墨笺项目备份文件')
    expect(() => parseProjectBackup(JSON.stringify({ format: 'ai-novel-writer-backup', version: 2, novels: [{ id: 'x' }], knowledgeBases: [] }))).toThrow('备份数据不完整')
    expect(() => parseProjectBackup(JSON.stringify({ format: 'ai-novel-writer-backup', version: 1, novels: [], knowledgeBases: [] }))).toThrow('旧版备份缺少 V2')
  })

  it('rejects nested corruption, duplicate IDs, dangling knowledge references and prototype keys', () => {
    const original = createProjectBackup([validBook()], [])
    const malformed = JSON.parse(JSON.stringify(original))
    malformed.novels[0].settings.protagonist.personality = '不是数组'
    expect(() => parseProjectBackup(JSON.stringify(malformed))).toThrow('personality')
    expect(() => parseProjectBackup(JSON.stringify({ ...original, novels: [original.novels[0], original.novels[0]] }))).toThrow('重复 ID')
    original.novels[0].knowledgeBaseIds = ['missing-kb']
    expect(() => parseProjectBackup(JSON.stringify(original))).toThrow('引用不存在')
    expect(() => parseProjectBackup('{"format":"ai-novel-writer-backup","version":2,"novels":[],"knowledgeBases":[],"__proto__":{}}')).toThrow('__proto__')
  })
})
