import { describe, expect, it } from 'vitest'
import type { Novel, Volume } from '@/types/novel'
import { getWritingFlowProgress } from '@/services/writingFlow'

function novelFixture(): Novel {
  return {
    id: 'book-1', title: '流程测试书', genre: 'fantasy', subGenre: 'xuanhuan', genreLabel: '幻想', subGenreLabel: '玄幻', tags: [],
    targetWordCountMin: 20, targetWordCountMax: 30, currentWordCount: 0,
    writingStyle: { narrativePov: '', toneStyle: '', descriptionDensity: '', dialogueStyle: '', combatStyle: '', pacingControl: '', emotionExpression: '' },
    settings: {
      protagonist: { name: '', gender: '', age: '', background: '', personality: [], initialPower: '', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [], worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] }, structure: { foreshadowingDensity: '' }, otherSettings: '',
    },
    outline: '', synopsis: '', volumes: [], chapters: [], characters: [], chatHistory: [], knowledgeBaseIds: [], eventLog: [],
    storyArcs: [], chapterPlans: [], storyStateProposals: [], dataPanels: [], dataPanelChanges: [], status: 'creating',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('writing flow service', () => {
  it('tracks outline -> volume -> chapter plan -> draft -> complete', () => {
    const novel = novelFixture()
    expect(getWritingFlowProgress(novel).stage).toBe('outline')

    novel.outline = '主角离开故乡，寻找失踪的星图。'
    expect(getWritingFlowProgress(novel).stage).toBe('volumes')

    novel.volumes = [{
      id: 'v1', volumeIndex: 0, title: '启程', theme: '选择', summary: '发现星图线索', keyTurningPoints: '故乡遇袭',
      characterChanges: '主角决定主动追查', estimatedChapters: 20, estimatedWordCount: 5,
    } satisfies Volume]
    expect(getWritingFlowProgress(novel).stage).toBe('chapter_plan')

    novel.chapterPlans = [{
      id: 'p1', horizon: 'next', title: '夜访旧塔', objective: '取得第一枚坐标', summary: '主角潜入旧塔', beats: ['进入', '受阻', '取得坐标'],
      targetChapterStart: 0, targetChapterEnd: 0, relatedArcIds: [], relatedEventIds: [], status: 'planned', source: 'ai',
      createdAt: novel.createdAt, updatedAt: novel.updatedAt,
    }]
    expect(getWritingFlowProgress(novel).stage).toBe('draft')

    novel.chapters = [{ id: 'c1', volumeIndex: 0, chapterIndex: 0, title: '旧塔', content: '主角取得了坐标。', summary: '', wordCount: 9, status: 'writing', createdAt: novel.createdAt, updatedAt: novel.updatedAt }]
    expect(getWritingFlowProgress(novel).stage).toBe('review')

    novel.chapters[0].status = 'completed'
    const completed = getWritingFlowProgress(novel)
    expect(completed.stage).toBe('complete')
    expect(completed.issues).toEqual([])
  })
})
