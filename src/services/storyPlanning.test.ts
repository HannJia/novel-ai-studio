import { describe, expect, it } from 'vitest'
import type { Chapter, Novel } from '@/types/novel'
import {
  formatChapterPlanContext, normalizeChapterPlanDrafts, normalizeStoryArcDrafts, normalizeStoryStateProposalDrafts,
} from '@/services/storyPlanning'

function createNovel(): Novel {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    id: 'novel-1', title: '测试小说', genre: '科幻', subGenre: '星际', genreLabel: '科幻', subGenreLabel: '星际',
    tags: [], targetWordCountMin: 80, targetWordCountMax: 120, currentWordCount: 0,
    writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
    settings: {
      protagonist: { name: '', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [], worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] }, structure: { foreshadowingDensity: '' }, otherSettings: '',
    },
    outline: '总纲', synopsis: '', volumes: [], characters: [], chatHistory: [], knowledgeBaseIds: [], dataPanels: [], dataPanelChanges: [],
    chapters: [{ id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '第一章', content: '', summary: '', wordCount: 0, status: 'completed', createdAt: now, updatedAt: now }],
    eventLog: [{ id: 'event-1', chapterIndex: 0, title: '失踪案', description: '', characters: [], type: '主线', status: 'developing', targetChapter: 4, timestamp: now }],
    storyArcs: [{ id: 'arc-1', title: '追查失踪案', description: '', type: 'main', importance: 5, status: 'active', reactivateAt: '', characterIds: [], nodes: [{ id: 'node-1', title: '发现线索', description: '', targetChapter: 2, status: 'pending', createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }],
    chapterPlans: [], storyStateProposals: [], status: 'writing', createdAt: now, updatedAt: now,
  }
}

describe('chapter planning', () => {
  it('normalizes AI story arc drafts and clamps milestone chapter numbers', () => {
    const arcs = normalizeStoryArcDrafts([{
      title: '主线追查', description: '调查异常来源', type: 'main', importance: 8,
      characterNames: ['林岚'],
      nodes: [
        { title: '发现线索', description: '首次定位', targetChapter: 0 },
        { title: '真相揭露', description: '完成调查', targetChapter: 18 },
      ],
    }, {
      title: '', nodes: [],
    }])

    expect(arcs).toHaveLength(1)
    expect(arcs[0].type).toBe('main')
    expect(arcs[0].importance).toBe(5)
    expect(arcs[0].nodes.map(node => node.targetChapter)).toEqual([1, 18])
  })

  it('normalizes AI plans to zero-based chapters and known relations', () => {
    const novel = createNovel()
    const plans = normalizeChapterPlanDrafts(novel, [{
      horizon: 'next', title: '追踪航标', objective: '找到来源', summary: '推进调查', beats: ['收到信号'],
      targetChapterStart: 5, targetChapterEnd: 7, relatedArcIds: ['arc-1', 'fake'], relatedEventIds: ['event-1'],
    }])
    expect(plans).toHaveLength(1)
    expect(plans[0].targetChapterStart).toBe(1)
    expect(plans[0].targetChapterEnd).toBe(1)
    expect(plans[0].relatedArcIds).toEqual(['arc-1'])
    expect(plans[0].source).toBe('ai')
  })

  it('validates state targets and converts proposed chapter numbers', () => {
    const novel = createNovel()
    const chapter = novel.chapters[0] as Chapter
    const proposals = normalizeStoryStateProposalDrafts(novel, chapter, [
      { targetType: 'arc_node', targetId: 'node-1', parentId: 'arc-1', field: 'status', newValue: 'completed', evidence: '正文已发现线索' },
      { targetType: 'event', targetId: 'event-1', field: 'targetChapter', newValue: 8, reason: '需要后移' },
      { targetType: 'event', targetId: 'missing', field: 'status', newValue: 'resolved' },
    ])
    expect(proposals).toHaveLength(2)
    expect(proposals[0].oldValue).toBe('pending')
    expect(proposals[1].newValue).toBe('7')
  })

  it('formats next, near and far plans for the writing fact card', () => {
    const novel = createNovel()
    const now = novel.createdAt
    novel.chapterPlans = [
      { id: 'p1', horizon: 'next', title: '下一章', objective: '找到信号源', summary: '进入残骸', beats: ['解码'], targetChapterStart: 1, targetChapterEnd: 1, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'user', createdAt: now, updatedAt: now },
      { id: 'p2', horizon: 'near', title: '近期', objective: '确认阴谋', summary: '连续调查', beats: [], targetChapterStart: 2, targetChapterEnd: 5, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'ai', createdAt: now, updatedAt: now },
      { id: 'p3', horizon: 'far', title: '远期', objective: '阻止协议', summary: '最终收束', beats: [], targetChapterStart: 20, targetChapterEnd: 30, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'ai', createdAt: now, updatedAt: now },
    ]
    const text = formatChapterPlanContext(novel, 1)
    expect(text).toContain('[下一章 / 第2章]')
    expect(text).toContain('[近期 / 第3-6章]')
    expect(text).toContain('[远期 / 第21-31章]')
  })
})
