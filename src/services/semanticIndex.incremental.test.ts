import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { queryPersistedSemanticEvidence, syncSemanticIndexForNovel } from './semanticIndex'
import { embeddingSourceId } from './embeddings'
import type { Novel } from '@/types/novel'

const memory = new Map<string, string>()
afterEach(() => vi.unstubAllGlobals())

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
    chapters: Array.from({ length: 500 }, (_, index) => ({
      id: `incremental-chapter-${index}`, volumeIndex: Math.floor(index / 50), chapterIndex: index,
      title: `第 ${index + 1} 章`, content: `沈砚追查第 ${index + 1} 条线索。`.repeat(80), summary: `第 ${index + 1} 阶段调查`,
      wordCount: 1600, status: 'finalized' as const, createdAt: now, updatedAt: now,
    })),
    status: 'writing', createdAt: now, updatedAt: now,
  }
}

describe('语义索引增量同步', () => {
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
    const first = await syncSemanticIndexForNovel(novel, [], firstConfig)
    expect(first.provider).toBe('remote')
    expect(first.embeddedCount).toBe(first.recordCount)
    fetchMock.mockClear()
    const compatible = await syncSemanticIndexForNovel(novel, [], { ...firstConfig, baseUrl: 'https://vectors-a.example.test/v1/' })
    expect(compatible.embeddedCount).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    const fallback = await queryPersistedSemanticEvidence(novel.id, '调查', 8, secondConfig)
    expect(fallback.length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
    const rebuilt = await syncSemanticIndexForNovel(novel, [], secondConfig)
    expect(rebuilt.embeddedCount).toBe(rebuilt.recordCount)
    expect(fetchMock).toHaveBeenCalled()
    const evidence = await queryPersistedSemanticEvidence(novel.id, '调查', 8, secondConfig)
    expect(evidence.length).toBeGreaterThan(0)
    expect((evidence[0].metadata?._embedding as { endpointId?: string })?.endpointId).toBe('https://vectors-b.example.test/v1/embeddings')
    expect(embeddingSourceId('https://user:synthetic@example.test/v1/?query=ignored#fragment')).not.toContain('synthetic')
  })

  it('二次同步不重算未变化记录，只处理单章修改和删除', async () => {
    const novel = largeNovel()
    const first = await syncSemanticIndexForNovel(novel)
    expect(first.embeddedCount).toBe(first.recordCount)

    const unchangedStarted = Date.now()
    const unchanged = await syncSemanticIndexForNovel(novel)
    expect(unchanged.embeddedCount).toBe(0)
    expect(unchanged.updatedCount).toBe(0)
    expect(unchanged.unchangedCount).toBe(unchanged.recordCount)
    expect(Date.now() - unchangedStarted).toBeLessThan(1_500)

    novel.chapters[200].summary = '调查出现关键转折'
    const changed = await syncSemanticIndexForNovel(novel)
    expect(changed.embeddedCount).toBe(1)
    expect(changed.updatedCount).toBe(1)

    novel.chapters.pop()
    const removed = await syncSemanticIndexForNovel(novel)
    expect(removed.removedCount).toBeGreaterThan(0)
    expect(removed.embeddedCount).toBe(0)
  }, 15_000)
})
