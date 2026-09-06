import { beforeAll, describe, expect, it } from 'vitest'
import { syncSemanticIndexForNovel } from './semanticIndex'
import type { Novel } from '@/types/novel'

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
