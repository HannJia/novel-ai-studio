import { beforeAll, describe, expect, it } from 'vitest'
import { loadAllNovelsFromDb, saveNovelToDb } from '@/services/db/novels'
import type { DataPanelChange, Novel } from '@/types/novel'
import { getLastTransactionStats } from '@/services/database'

const memory = new Map<string, string>()

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', { value: { electronAPI: undefined }, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value) },
      removeItem: (key: string) => { memory.delete(key) },
    },
    configurable: true,
  })
})

function largeNovel(): Novel {
  const now = '2026-01-01T00:00:00.000Z'
  const changes = Array.from({ length: 5_000 }, (_, index): DataPanelChange => ({
    id: `change-${index}`, itemId: 'panel-1', fieldId: 'field-1', itemName: '资源库存', fieldName: '灵石',
    oldValue: String(index), newValue: String(index + 1), reason: `第 ${index % 300 + 1} 章正文依据`, confidence: 'clear',
    chapterIndex: index % 300, status: index % 3 === 0 ? 'pending' : index % 3 === 1 ? 'accepted' : 'rejected', createdAt: now,
  }))
  return {
    id: 'large-book', title: '大书稿数据库测试', genre: '', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [],
    targetWordCountMin: 100, targetWordCountMax: 200, currentWordCount: 0,
    writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
    settings: {
      protagonist: { name: '', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [], worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] }, structure: { foreshadowingDensity: '' }, otherSettings: '',
    },
    outline: '测试大纲', synopsis: '', volumes: [], chapters: [], characters: [], chatHistory: [], knowledgeBaseIds: [],
    eventLog: [], storyArcs: [], chapterPlans: [], storyStateProposals: [],
    dataPanels: [{ id: 'panel-1', category: '资源', name: '资源库存', relatedKeywords: ['灵石'], fields: [{ id: 'field-1', name: '灵石', value: '5000', unit: '枚', note: '', type: 'number' }], createdAt: now, updatedAt: now }],
    dataPanelChanges: changes, status: 'writing', createdAt: now, updatedAt: now,
  }
}

describe('large novel SQLite persistence', () => {
  it('round-trips equipment ownership, modifiers and pending creations through SQLite', async () => {
    const novel = largeNovel()
    novel.id = 'equipment-roundtrip'
    novel.dataPanels = [
      { id: 'hero-db', name: '林澈', category: '角色', fields: [{ id: 'attack-db', name: '攻击力', value: '20', unit: '', note: '', type: 'number' }],
        relatedKeywords: [], createdAt: novel.createdAt, updatedAt: novel.updatedAt },
      { id: 'sword-db', name: '铁剑', category: '装备', ownerItemId: 'hero-db', equipmentState: 'equipped',
        fields: [{ id: 'bonus-db', name: '攻击加成', value: '10', unit: '', note: '', type: 'number', modifier: { attribute: '攻击力', operation: 'flat' } }],
        relatedKeywords: [], createdAt: novel.createdAt, updatedAt: novel.updatedAt },
    ]
    novel.dataPanelChanges = [{ id: 'proposal-db', itemId: 'new:ring', fieldId: '__create__', itemName: '戒指', fieldName: '新增对象',
      oldValue: '未记录', newValue: '戒指', reason: '获得戒指', confidence: 'clear', chapterIndex: 0, status: 'pending', createdAt: novel.createdAt,
      mutation: { kind: 'create', item: { name: '戒指', category: '装备', fields: [], relatedKeywords: [], ownerItemName: '林澈', equipmentState: 'stored' } } }]
    await saveNovelToDb(novel)
    const loaded = (await loadAllNovelsFromDb()).find(book => book.id === novel.id)!
    expect(loaded.dataPanels[1]).toMatchObject(novel.dataPanels[1])
    expect(loaded.dataPanelChanges).toEqual(novel.dataPanelChanges)
  })

  it('saves and reloads 5,000 history rows within the regression budget', async () => {
    const novel = largeNovel()
    novel.writingMode = 'manual'
    novel.chatWebSearchEnabled = true
    novel.chatHistory = [{ id: 'search-message', role: 'assistant', content: '联网资料', timestamp: novel.createdAt,
      search: { protocol: 'anthropic', status: 'searched', sources: [{ url: 'https://example.org/source', title: '历史来源' }] } }]
    novel.inspirationHistory = [{ id: 'idea-original', role: 'user', content: '创建前讨论', timestamp: novel.createdAt }]
    const started = Date.now()
    await saveNovelToDb(novel)
    const loaded = await loadAllNovelsFromDb()
    expect(loaded.find(item => item.id === novel.id)?.dataPanelChanges).toHaveLength(5_000)
    expect(loaded.find(item => item.id === novel.id)?.writingMode).toBe('manual')
    expect(loaded.find(item => item.id === novel.id)?.chatWebSearchEnabled).toBe(true)
    expect(loaded.find(item => item.id === novel.id)?.chatHistory).toEqual([{ ...novel.chatHistory[0], failed: false }])
    expect(loaded.find(item => item.id === novel.id)?.inspirationHistory).toEqual(novel.inspirationHistory)
    novel.chatHistory = []
    await saveNovelToDb(novel)
    const cleared = (await loadAllNovelsFromDb()).find(item => item.id === novel.id)!
    expect(cleared.chatHistory).toHaveLength(0)
    expect(cleared.inspirationHistory).toEqual(novel.inspirationHistory)
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 10_000)

  it('benchmarks a million-character manuscript with version snapshots and a one-chapter edit', async () => {
    const novel = largeNovel()
    const content = '山风吹过城门，少年握紧信封，沿着石阶向前走。'.repeat(100).slice(0, 2000)
    novel.chapters = Array.from({ length: 500 }, (_, index) => ({
      id: `chapter-${index}`, volumeIndex: 0, chapterIndex: index, title: `章节${index}`, content,
      summary: '摘要', wordCount: content.length, status: 'writing' as const, createdAt: novel.createdAt, updatedAt: novel.updatedAt,
      versions: Array.from({ length: 3 }, (_, version) => ({ id: `v-${index}-${version}`, label: '历史正文', savedAt: novel.createdAt,
        snapshot: JSON.stringify({ title: `章节${index}`, content: `${content}${version}`, summary: '摘要', status: 'writing' }) })),
    }))
    novel.currentWordCount = 1_000_000
    const start = performance.now()
    await saveNovelToDb(novel)
    const initialMs = performance.now() - start
    novel.chapters[250].content += '信已送到。'
    novel.chapters[250].wordCount += 5
    novel.currentWordCount += 5
    const updateStart = performance.now()
    await saveNovelToDb(novel)
    const updateMs = performance.now() - updateStart
    const metrics = getLastTransactionStats()
    const writtenRows = metrics.rowsWritten
    const loadStart = performance.now()
    const loaded = (await loadAllNovelsFromDb()).find(book => book.id === novel.id)!
    const loadMs = performance.now() - loadStart
    expect(loaded.chapters[250].content).toBe(novel.chapters[250].content)
    expect(loaded.chapters[1].versions).toHaveLength(3)
    expect(loaded.dataPanelChanges).toHaveLength(5000)
    expect(writtenRows).toBe(2) // One chapter plus its book-level word count.
    console.info('MANUSCRIPT_BENCHMARK', JSON.stringify({ characters: 1_000_000, chapters: 500, versions: 1500, history: 5000,
      initialMs: Math.round(initialMs), updateMs: Math.round(updateMs), loadMs: Math.round(loadMs), writtenRows,
      sqlMs: Math.round(metrics.sqlMs), persistMs: Math.round(metrics.persistMs), bytes: metrics.bytes }))
    expect(updateMs).toBeLessThan(10_000)
  }, 30_000)
})
