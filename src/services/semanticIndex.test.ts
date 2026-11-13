import { describe, expect, it } from 'vitest'
import { buildSemanticRecords, retrieveSemanticEvidence, splitMemoryText } from './semanticIndex'
import { createChapterSourceBinding } from './derivedSources'
import type { Chapter, Novel } from '@/types/novel'

function memoryNovel(): Novel {
  return {
    id: 'novel-memory',
    title: '记忆测试',
    genre: '',
    subGenre: '',
    genreLabel: '',
    subGenreLabel: '',
    tags: [],
    targetWordCountMin: 10,
    targetWordCountMax: 20,
    currentWordCount: 0,
    writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
    settings: {
      protagonist: { name: '沈砚', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [],
      worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] },
      structure: { foreshadowingDensity: '' },
      otherSettings: '',
    },
    outline: '',
    synopsis: '',
    volumes: [],
    chapters: [],
    characters: [],
    chatHistory: [],
    knowledgeBaseIds: [],
    eventLog: [{
      id: 'event-1', chapterIndex: 2, title: '赤月剑失窃', description: '赤月剑在王府密库失踪',
      characters: ['沈砚'], type: '主线', status: 'developing', storyTime: '春祭之夜', location: '王府密库',
      targetChapter: 8, importance: 5, timestamp: '2026-01-01',
    }],
    storyArcs: [{
      id: 'arc-1', title: '寻回赤月剑', description: '追查赤月剑失窃案', type: 'main', importance: 5,
      status: 'active', reactivateAt: '', characterIds: [], nodes: [], createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }],
    dataPanels: [],
    dataPanelChanges: [],
    status: 'writing',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }
}

describe('项目语义记忆', () => {
  it('对长正文进行带重叠的稳定分块', () => {
    const text = `${'甲'.repeat(500)}。${'乙'.repeat(500)}。${'丙'.repeat(500)}。`
    const chunks = splitMemoryText(text, 600, 80)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every(chunk => chunk.length <= 600)).toBe(true)
    expect(chunks.join('')).toContain('乙')
  })

  it('为故事弧线和时间线事件建立统一记录', () => {
    const records = buildSemanticRecords(memoryNovel())
    expect(records.some(record => record.sourceType === 'story_arc')).toBe(true)
    expect(records.some(record => record.sourceType === 'event' && record.content.includes('王府密库'))).toBe(true)
  })

  it('混合检索优先返回精确命中的弧线或事件', () => {
    const results = retrieveSemanticEvidence('赤月剑在哪里失窃', buildSemanticRecords(memoryNovel()), 3, 0)
    expect(results[0].content).toContain('赤月剑')
    expect(results.some(result => result.citation.includes('事件') || result.citation.includes('弧线'))).toBe(true)
  })

  it('在 300 章长书稿下保持可检索并完成稳定分块', () => {
    const novel = memoryNovel()
    const paragraph = '沈砚沿着王府密库留下的剑痕追查赤月剑，每一步都核对时间、地点和证词。'.repeat(30)
    novel.chapters = Array.from({ length: 300 }, (_, index) => {
      const content = `${paragraph}\n第 ${index + 1} 章线索编号 ${index}。`
      const summary = `追查赤月剑的第 ${index + 1} 阶段`
      const chapter = {
        id: `chapter-${index}`, volumeIndex: Math.floor(index / 30), chapterIndex: index, title: `第 ${index + 1} 章`,
        content, summary, wordCount: paragraph.length, status: 'finalized' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      }
      return { ...chapter, summarySource: createChapterSourceBinding(chapter, summary, 'ai', '2026-01-01') }
    })
    const started = Date.now()
    const records = buildSemanticRecords(novel)
    const results = retrieveSemanticEvidence('赤月剑 王府密库', records, 8, 0)
    expect(records.length).toBeGreaterThan(600)
    expect(results).toHaveLength(8)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('召回排除过期和未确认摘要，重新确认后恢复', () => {
    const novel = memoryNovel()
    const staleSummary = '过期摘要中的独有线索：黑曜密钥藏在旧塔。'
    const unverifiedSummary = '未确认摘要中的独有线索：白鹭印记位于南门。'
    const stale = {
      id: 'stale-summary', volumeIndex: 0, chapterIndex: 0, title: '过期摘要', content: '沈砚检查药铺的账册。', summary: staleSummary,
      wordCount: 12, status: 'finalized' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01',
      summarySource: createChapterSourceBinding({ id: 'stale-summary', content: '沈砚检查旧塔的账册。' }, staleSummary, 'ai', '2026-01-01'),
    }
    const unverified: Chapter = {
      id: 'unverified-summary', volumeIndex: 0, chapterIndex: 1, title: '未确认摘要', content: '沈砚检查南门的账册。', summary: unverifiedSummary,
      wordCount: 12, status: 'finalized' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }
    novel.chapters = [stale, unverified]

    const rejected = buildSemanticRecords(novel)
    expect(rejected.some(record => record.content.includes(staleSummary))).toBe(false)
    expect(rejected.some(record => record.content.includes(unverifiedSummary))).toBe(false)

    stale.summarySource = createChapterSourceBinding(stale, stale.summary, 'author', '2026-01-01')
    unverified.summarySource = createChapterSourceBinding(unverified, unverified.summary, 'author', '2026-01-01')
    const confirmed = buildSemanticRecords(novel)
    expect(confirmed.filter(record => record.content.includes(staleSummary) || record.content.includes(unverifiedSummary))).toHaveLength(2)
  })
})
