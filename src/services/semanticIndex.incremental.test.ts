import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { queryPersistedSemanticEvidence, syncSemanticIndexForNovel, SemanticSourceChangedError } from './semanticIndex'
import { embeddingSourceId } from './embeddings'
import { createChapterSourceBinding } from './derivedSources'
import { createStoryMemoryBinding } from './storyMemory'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import { createEntrySummarySource } from './knowledgeSources'
import type { Novel } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import { execute, queryAll, runTransaction } from './database'
import { augmentWritingContextWithVectorMemory, buildWritingContext } from './context'

const memory = new Map<string, string>()
const now = '2026-01-01T00:00:00.000Z'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
  return {
    id: 'incremental-memory-book', title: '增量索引测试', genre: '', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [],
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
    outline: '', synopsis: '', volumes: [], characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [], storyArcs: [],
    chapterPlans: [], storyStateProposals: [], dataPanels: [], dataPanelChanges: [],
    chapters: Array.from({ length: 500 }, (_, index) => {
      const content = `沈砚追查第 ${index + 1} 条线索。`.repeat(80)
      const summary = `第 ${index + 1} 阶段调查`
      const chapter = {
        id: `incremental-chapter-${index}`, volumeIndex: Math.floor(index / 50), chapterIndex: index,
        title: `第 ${index + 1} 章`, content, summary,
        wordCount: 1600, status: 'finalized' as const, createdAt: now, updatedAt: now,
      }
      return { ...chapter, summarySource: createChapterSourceBinding(chapter, summary, 'ai', now) }
    }),
    status: 'writing', createdAt: now, updatedAt: now,
  }
}

describe('语义索引增量同步', () => {
  it('drops persisted stale knowledge summaries while keeping current raw evidence and later reconfirmations', async () => {
    const novel = largeNovel()
    novel.id = 'knowledge-summary-source'; novel.chapters = []; novel.knowledgeBaseIds = ['summary-kb']
    const base: KnowledgeBase = { id: 'summary-kb', name: '渡口资料', description: '', createdAt: now, entries: [
      { id: 'ferry', title: '渡船规则', category: '世界观', content: '白鹿镇渡船初七停航。', summary: '旧摘要独有标记：西岸木匠。', tags: [], createdAt: now, updatedAt: now },
    ] }
    const entry = base.entries[0]
    entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'author', now)
    const read = () => ({ novel, knowledgeBases: [base] })
    await syncSemanticIndexForNovel(read)
    const initial = await queryPersistedSemanticEvidence(read, '旧摘要独有标记西岸木匠', 8, undefined, 'knowledge')
    expect(initial.some(item => item.metadata?.chunkType === 'summary')).toBe(true)
    entry.content = '白鹿镇渡船初九停航。'
    const edited = await queryPersistedSemanticEvidence(read, '旧摘要独有标记初九停航', 8, undefined, 'knowledge')
    expect(edited.some(item => item.content.includes('初九停航'))).toBe(true)
    expect(edited.some(item => item.metadata?.chunkType === 'summary' || item.content.includes('西岸木匠'))).toBe(false)
    entry.summary = '新摘要：东岸木匠负责修船。'
    entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'author', now)
    const confirmed = await queryPersistedSemanticEvidence(read, '东岸木匠负责修船', 8, undefined, 'knowledge')
    expect(confirmed.some(item => item.content.includes('东岸木匠'))).toBe(true)
    expect(confirmed.some(item => item.content.includes('西岸木匠'))).toBe(false)
    base.entries = []
    expect(await queryPersistedSemanticEvidence(read, '渡船', 8, undefined, 'knowledge')).toEqual([])
  })

  it('filters future and current chapter evidence before ranking persisted recall', async () => {
    const novel = largeNovel()
    novel.id = 'chapter-bound-retrieval'
    novel.chapters = novel.chapters.slice(0, 3)
    novel.chapters[0].content = '沈砚收到一封书信，但尚未拆开。'
    novel.chapters[1].content = '沈砚在本章读信，发现城主仍然在世。'
    novel.chapters[2].content = '沈砚收到书信。书信揭露最终幕后主使。'
    await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }))
    const records = await queryPersistedSemanticEvidence(() => ({ novel, knowledgeBases: [] }), '沈砚书信幕后主使', 8, undefined, 'chapter', 1)
    expect(records.length).toBeGreaterThan(0)
    expect(records.every(record => record.metadata?.chapterIndex === 0)).toBe(true)
    expect(records.map(record => record.content).join('')).not.toContain('幕后主使')
    expect(await queryPersistedSemanticEvidence(() => ({ novel, knowledgeBases: [] }), '沈砚书信', 8, undefined, 'chapter', 0)).toEqual([])
  })

  it('rebuilds vectors after changing endpoint with the same model, and never queries incompatible vectors', async () => {
    const novel = largeNovel()
    novel.id = 'embedding-endpoint-change'
    novel.chapters = novel.chapters.slice(0, 2)
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const inputs = JSON.parse(String(init.body)).input as string[]
      return new Response(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const firstConfig = { enabled: true, baseUrl: 'https://vectors-a.example.test', apiKey: '', modelName: 'same-vector-model', batchSize: 16 }
    const secondConfig = { ...firstConfig, baseUrl: 'https://vectors-b.example.test/v1/' }
    const first = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }), firstConfig)
    expect(first.provider).toBe('remote')
    expect(first.embeddedCount).toBe(first.recordCount)
    fetchMock.mockClear()
    const compatible = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }), { ...firstConfig, baseUrl: 'https://vectors-a.example.test/v1/' })
    expect(compatible.embeddedCount).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    const fallback = await queryPersistedSemanticEvidence(() => ({ novel, knowledgeBases: [] }), '调查', 8, secondConfig)
    expect(fallback.length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
    const rebuilt = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }), secondConfig)
    expect(rebuilt.embeddedCount).toBe(rebuilt.recordCount)
    expect(fetchMock).toHaveBeenCalled()
    const evidence = await queryPersistedSemanticEvidence(() => ({ novel, knowledgeBases: [] }), '调查', 8, secondConfig)
    expect(evidence.length).toBeGreaterThan(0)
    expect(evidence[0].retrieval).toEqual({ method: 'remote', indexed: true })
    expect(embeddingSourceId('https://user:synthetic@example.test/v1/?query=ignored#fragment')).not.toContain('synthetic')
  })

  it('二次同步不重算未变化记录，只处理单章修改和删除', async () => {
    const novel = largeNovel()
    const first = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }))
    expect(first.embeddedCount).toBe(first.recordCount)

    const unchangedStarted = Date.now()
    const unchanged = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }))
    expect(unchanged.embeddedCount).toBe(0)
    expect(unchanged.updatedCount).toBe(0)
    expect(unchanged.unchangedCount).toBe(unchanged.recordCount)
    expect(Date.now() - unchangedStarted).toBeLessThan(1_500)

    novel.chapters[200].summary = '调查出现关键转折'
    novel.chapters[200].summarySource = createChapterSourceBinding(novel.chapters[200], novel.chapters[200].summary, 'author', now)
    const changed = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }))
    expect(changed.embeddedCount).toBe(1)
    expect(changed.updatedCount).toBe(1)

    novel.chapters.pop()
    const removed = await syncSemanticIndexForNovel(() => ({ novel, knowledgeBases: [] }))
    expect(removed.removedCount).toBeGreaterThan(0)
    expect(removed.embeddedCount).toBe(0)
  }, 15_000)
})

function currentBook(id: string): Novel {
  const novel = largeNovel()
  novel.id = id
  novel.chapters = novel.chapters.slice(0, 2)
  novel.chapters[0].summary = ''
  novel.chapters[0].summarySource = undefined
  novel.chapters[0].content = '铜盒藏在旧钟楼，蓝色封蜡刻着鹤纹。'
  novel.chapters[1].summary = ''
  novel.chapters[1].summarySource = undefined
  novel.chapters[1].content = '沈砚沿街寻找铜盒。'
  return novel
}

const remoteConfig = { enabled: true, baseUrl: 'https://memory.example.test', apiKey: '', modelName: 'memory-test', batchSize: 64 }
function embeddingResponse(init: RequestInit) {
  const inputs = JSON.parse(String(init.body)).input as string[]
  return new Response(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), { status: 200 })
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('当前来源与持久化记忆一致性', () => {
  it('filters stale and future manuscript memories from a persisted index and uses newly confirmed ones', async () => {
    const novel = currentBook('persisted-story-memory')
    const scope = { kind: 'book' as const, throughChapterId: novel.chapters[0].id }
    const makeMemory = (summary: string): StoryMemoryRecord => ({ id: 'memory', novelId: novel.id, title: '铜盒回顾', scope, summary, history: [],
      source: createStoryMemoryBinding(novel, scope, summary, 'author', now) })
    let memories = [makeMemory('旧铜盒回顾：蓝色封蜡。')]
    const source = () => ({ novel, knowledgeBases: [], storyMemories: memories })
    await syncSemanticIndexForNovel(source)
    expect((await queryPersistedSemanticEvidence(source, '铜盒回顾', 5, undefined, 'story_memory', 1))[0]?.content).toContain('旧铜盒')
    expect(await queryPersistedSemanticEvidence(source, '铜盒回顾', 5, undefined, 'story_memory', 0)).toEqual([])
    novel.chapters[0].content = '新铜盒藏在南门，红色封蜡。'
    expect(await queryPersistedSemanticEvidence(source, '铜盒回顾', 5, undefined, 'story_memory', 1)).toEqual([])
    memories = [makeMemory('新铜盒回顾：红色封蜡。')]
    const fresh = await queryPersistedSemanticEvidence(source, '铜盒回顾', 5, undefined, 'story_memory', 1)
    expect(fresh[0]?.content).toContain('新铜盒')
    expect(fresh[0]?.retrieval?.indexed).toBe(false)
    expect(queryAll<{ content: string }>('SELECT content FROM semantic_index WHERE novel_id = ? AND source_type = ?', [novel.id, 'story_memory'])[0].content).toContain('旧铜盒')
  })

  it('queries current content without an index and never requires remote embedding of the manuscript', async () => {
    const novel = currentBook('fresh-no-index')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const evidence = await queryPersistedSemanticEvidence(() => ({ novel, knowledgeBases: [] }), '铜盒旧钟楼', 5, remoteConfig)
    expect(evidence.some(item => item.content.includes('蓝色封蜡'))).toBe(true)
    expect(evidence.every(item => item.retrieval?.method === 'local' && !item.retrieval.indexed)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not return changed or deleted chapters from an old index, even with unchanged timestamps', async () => {
    const novel = currentBook('fresh-manuscript')
    const source = () => ({ novel, knowledgeBases: [] })
    await syncSemanticIndexForNovel(source)
    novel.chapters[0].content = '铜盒藏在南门茶铺，红色封蜡刻着鹿纹。'
    const edited = await queryPersistedSemanticEvidence(source, '铜盒封蜡', 5)
    expect(edited.map(item => item.content).join('')).not.toContain('旧钟楼')
    expect(edited.some(item => item.content.includes('南门茶铺') && !item.retrieval?.indexed)).toBe(true)
    novel.chapters.splice(0, 1)
    const deleted = await queryPersistedSemanticEvidence(source, '铜盒封蜡', 5)
    expect(deleted.every(item => item.sourceId !== 'incremental-chapter-0')).toBe(true)
    const stored = queryAll<{ content: string }>('SELECT content FROM semantic_index WHERE novel_id = ?', [novel.id])
    expect(stored.some(item => item.content.includes('旧钟楼'))).toBe(true)
  })

  it('uses current entity text, bindings and chapter boundaries before ranking', async () => {
    const novel = currentBook('fresh-entities')
    novel.characters = [{ id: 'hero', name: '林澈', identity: '旧任守卫', aliases: [], personality: '', powerLevel: '', faction: '', status: '活跃', firstAppearChapter: 0, description: '', relationships: [], events: [], avatarColor: '' }]
    novel.eventLog = [{ id: 'box-event', chapterIndex: 0, title: '铜盒', description: '旧证词说铜盒在塔顶', characters: [], type: '主线', timestamp: 'unchanged' }]
    let knowledgeBases: KnowledgeBase[] = [{ id: 'kb', name: '铜盒资料', description: '', createdAt: '', entries: [{ id: 'clue', title: '铜盒封蜡', category: '道具', content: '旧铜盒需要银钥匙', summary: '', tags: [], createdAt: '', updatedAt: '' }] }]
    novel.knowledgeBaseIds = ['kb']
    const source = () => ({ novel, knowledgeBases })
    await syncSemanticIndexForNovel(source)
    expect((await syncSemanticIndexForNovel(source)).updatedCount).toBe(0)
    novel.characters[0].identity = '现任书吏'
    novel.eventLog[0].description = '新证词说铜盒在码头'
    const changed = await queryPersistedSemanticEvidence(source, '林澈铜盒', 20)
    expect(changed.map(item => item.content).join('')).not.toContain('旧任守卫')
    expect(changed.map(item => item.content).join('')).not.toContain('塔顶')
    expect(changed.some(item => item.content.includes('现任书吏'))).toBe(true)
    knowledgeBases = [{ ...knowledgeBases[0], entries: [{ ...knowledgeBases[0].entries[0], content: '新铜盒需要金钥匙' }] }]
    const replaced = await queryPersistedSemanticEvidence(source, '铜盒钥匙', 20, undefined, 'knowledge')
    expect(replaced.map(item => item.content).join('')).toContain('金钥匙')
    expect(replaced.map(item => item.content).join('')).not.toContain('银钥匙')
    novel.knowledgeBaseIds = []
    expect(await queryPersistedSemanticEvidence(source, '铜盒', 20, undefined, 'knowledge')).toEqual([])
    novel.eventLog[0].chapterIndex = 2
    novel.chapters[0].chapterIndex = 2
    const bounded = await queryPersistedSemanticEvidence(source, '铜盒', 20, undefined, undefined, 1)
    expect(bounded.every(item => item.sourceType !== 'event' && item.sourceType !== 'chapter')).toBe(true)
  })

  it('rechecks live sources after the remote query, using local ranking for newly edited text', async () => {
    let novel = currentBook('fresh-query-race')
    let knowledgeBases: KnowledgeBase[] = []
    const source = () => ({ novel, knowledgeBases })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => embeddingResponse(init)))
    await syncSemanticIndexForNovel(source, remoteConfig)
    const entered = deferred(); const release = deferred()
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => { entered.resolve(); await release.promise; return embeddingResponse(init) })
    vi.stubGlobal('fetch', fetchMock)
    const pending = queryPersistedSemanticEvidence(source, '铜盒', 5, remoteConfig)
    await entered.promise
    novel = structuredClone(novel)
    novel.chapters[0].content = '铜盒已经移到药铺。'
    novel.chapters.splice(1, 1)
    release.resolve()
    const evidence = await pending
    expect(evidence).toHaveLength(1)
    expect(evidence[0].content).toBe('铜盒已经移到药铺。')
    expect(evidence[0].retrieval).toEqual({ method: 'local', indexed: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a source belonging to another book after a remote query', async () => {
    let novel = currentBook('fresh-project-switch')
    const source = () => ({ novel, knowledgeBases: [] })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => embeddingResponse(init)))
    await syncSemanticIndexForNovel(source, remoteConfig)
    const entered = deferred(); const release = deferred()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { entered.resolve(); await release.promise; return embeddingResponse(init) }))
    const pending = queryPersistedSemanticEvidence(source, '铜盒', 5, remoteConfig)
    const rejected = expect(pending).rejects.toBeInstanceOf(SemanticSourceChangedError)
    await entered.promise
    novel = currentBook('another-book')
    release.resolve()
    await rejected
  })

  it('discards stale synchronization and serializes the following synchronization against the latest source', async () => {
    const novel = currentBook('fresh-sync-race')
    const source = () => ({ novel, knowledgeBases: [] })
    await syncSemanticIndexForNovel(source)
    const entered = deferred(); const release = deferred()
    let requests = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (++requests === 1) { entered.resolve(); await release.promise }
      return embeddingResponse(init)
    }))
    const first = syncSemanticIndexForNovel(source, remoteConfig, false)
    const rejected = expect(first).rejects.toBeInstanceOf(SemanticSourceChangedError)
    await entered.promise
    novel.chapters[0].content = '铜盒转移到南门药铺。'
    const second = syncSemanticIndexForNovel(source, remoteConfig, false)
    release.resolve()
    await rejected
    expect((await second).provider).toBe('remote')
    const rows = queryAll<{ content: string }>('SELECT content FROM semantic_index WHERE novel_id = ?', [novel.id])
    expect(rows.some(item => item.content.includes('南门药铺'))).toBe(true)
    expect(rows.some(item => item.content.includes('旧钟楼'))).toBe(false)
    expect(requests).toBe(2)
  })

  it('restores the old index on write failure and still retrieves current content', async () => {
    const novel = currentBook('fresh-sync-write-failure')
    const source = () => ({ novel, knowledgeBases: [] })
    await syncSemanticIndexForNovel(source)
    novel.chapters[0].content = '铜盒交给了掌柜。'
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('synthetic disk failure') })
    await expect(syncSemanticIndexForNovel(source)).rejects.toThrow('synthetic disk failure')
    write.mockRestore()
    const stored = queryAll<{ content: string }>('SELECT content FROM semantic_index WHERE novel_id = ?', [novel.id])
    expect(stored.some(item => item.content.includes('旧钟楼'))).toBe(true)
    expect((await queryPersistedSemanticEvidence(source, '铜盒', 5)).some(item => item.content.includes('掌柜'))).toBe(true)
    expect((await syncSemanticIndexForNovel(source)).updatedCount).toBe(1)
  })

  it('does not trust malformed metadata, vector strings or rows with the wrong source identity', async () => {
    const novel = currentBook('fresh-corrupt-cache')
    const source = () => ({ novel, knowledgeBases: [] })
    await syncSemanticIndexForNovel(source)
    await runTransaction(() => execute('UPDATE semantic_index SET content = ?, metadata = ?, embedding = ? WHERE novel_id = ?', ['假铜盒缓存证词', 'null', '[null]', novel.id]))
    const results = await queryPersistedSemanticEvidence(source, '铜盒', 5, remoteConfig)
    expect(results.map(item => item.content).join('')).not.toContain('假铜盒')
    expect(results.every(item => item.retrieval?.method === 'local' && !item.retrieval.indexed)).toBe(true)
    expect((await syncSemanticIndexForNovel(source)).updatedCount).toBe(2)
  })

  it('falls back to current local evidence when a remote query fails', async () => {
    const novel = currentBook('fresh-query-failure')
    const source = () => ({ novel, knowledgeBases: [] })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => embeddingResponse(init)))
    await syncSemanticIndexForNovel(source, remoteConfig)
    const fetchMock = vi.fn().mockRejectedValue(new Error('synthetic offline'))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const results = await queryPersistedSemanticEvidence(source, '铜盒', 5, remoteConfig)
    expect(results.some(item => item.content.includes('旧钟楼'))).toBe(true)
    expect(results.every(item => item.retrieval?.method === 'local')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})


describe('向量补充与写作上下文版本', () => {
  it('refuses an already stale context before making a remote query', async () => {
    const novel = currentBook('fresh-context-before-request')
    const chapter = novel.chapters[1]
    const context = buildWritingContext(novel, chapter)
    novel.chapters[0].content = '铜盒已经转移到药铺。'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(augmentWritingContextWithVectorMemory(novel, chapter, context, remoteConfig)).rejects.toBeInstanceOf(SemanticSourceChangedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not append fresh recall to a base context that changed while the vector query ran', async () => {
    const novel = currentBook('fresh-context-query-race')
    const source = () => ({ novel, knowledgeBases: [] })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => embeddingResponse(init)))
    await syncSemanticIndexForNovel(source, remoteConfig)
    const chapter = novel.chapters[1]
    const context = buildWritingContext(novel, chapter)
    const entered = deferred(); const release = deferred()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { entered.resolve(); await release.promise; return embeddingResponse(init) }))
    const pending = augmentWritingContextWithVectorMemory(novel, chapter, context, remoteConfig)
    const rejected = expect(pending).rejects.toBeInstanceOf(SemanticSourceChangedError)
    await entered.promise
    novel.chapters[0].content = '铜盒已经转移到药铺。'
    release.resolve()
    await rejected
    const fresh = buildWritingContext(novel, chapter)
    expect(fresh.lastParagraph).toContain('药铺')
    expect(fresh.outlineContext).not.toContain('旧钟楼')
  })
})
