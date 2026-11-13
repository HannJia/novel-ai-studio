import { describe, expect, it } from 'vitest'
import type { Novel } from '@/types/novel'
import { buildReconstructionContextPack, formatReconstructionContextPack } from './reconstructionContext'
import { createChapterSourceBinding } from './derivedSources'

const now = '2026-10-26T00:00:00.000Z'

function makeNovel(): Novel {
  return {
    id: 'novel-1', title: '雾城回响', genre: 'fantasy', subGenre: 'urban-fantasy', genreLabel: '玄幻', subGenreLabel: '东方玄幻',
    tags: ['复仇'], targetWordCountMin: 80, targetWordCountMax: 120, currentWordCount: 4000,
    writingStyle: { narrativePov: 'third-limited', toneStyle: 'dark', descriptionDensity: 'balanced', dialogueStyle: 'crisp', combatStyle: 'strategic', pacingControl: 'normal', emotionExpression: 'nuanced' },
    writingMode: 'manual', settings: {
      protagonist: { name: '林澈', gender: '男', age: '17', background: '边城学徒', personality: ['谨慎'], initialPower: '初阶', cheatDescription: '能听见旧物回声', romanceTendency: '单线' },
      supportingCharacters: [], worldBuilding: { worldType: '灵能都市', worldScale: '一城', socialStructure: '学院与家族', techLevel: '现代', specialRules: '夜间禁行；能力必须付出代价。' },
      powerSystem: { systemName: '回响术', levelHierarchy: '一至九阶', combatStyleDesc: '策略', auxiliarySystems: '' },
      coreConflict: { mainConflict: '追查父亲失踪', mainVillain: '监察院', factionConflicts: '', coreSuspense: '真相会改变他的身份' },
      romance: { romanceType: '单女主', developmentPace: '慢热', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '适中', levelUpPace: '稳步', patterns: ['复仇'] },
      structure: { foreshadowingDensity: '中等' }, otherSettings: '',
    },
    outline: '林澈追查父亲失踪。', synopsis: '', volumes: [{ id: 'volume-1', volumeIndex: 0, title: '入城篇', theme: '进入学院', summary: '建立主线', keyTurningPoints: '第一次转折', characterChanges: '开始反抗', estimatedChapters: 20, estimatedWordCount: 20 }],
    chapters: [
      {
        id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '旧门', content: '林澈在旧门前发现父亲留下的记号。', summary: '林澈在旧门前发现父亲留下的记号。',
        summarySource: createChapterSourceBinding({ id: 'chapter-1', content: '林澈在旧门前发现父亲留下的记号。' }, '林澈在旧门前发现父亲留下的记号。', 'ai', now),
        wordCount: 20, status: 'completed', createdAt: now, updatedAt: now, sceneNotes: [], versions: [],
      },
      {
        id: 'chapter-2', volumeIndex: 0, chapterIndex: 1, title: '夜行', content: '林澈进入学院。', summary: '林澈进入学院并发现新的线索。',
        summarySource: createChapterSourceBinding({ id: 'chapter-2', content: '林澈进入学院。' }, '林澈进入学院并发现新的线索。', 'ai', now),
        wordCount: 20, status: 'draft', createdAt: now, updatedAt: now, sceneNotes: [], versions: [],
      },
    ],
    characters: [
      { id: 'character-1', name: '林澈', aliases: [], identity: '学徒', personality: '谨慎', powerLevel: '初阶', faction: '', status: '活跃', firstAppearChapter: 0, description: '', relationships: [], events: [], avatarColor: '' },
      { id: 'character-2', name: '已故角色', aliases: [], identity: '父亲', personality: '', powerLevel: '', faction: '', status: '死亡', firstAppearChapter: 0, description: '', relationships: [], events: [], avatarColor: '' },
    ],
    chatHistory: [], knowledgeBaseIds: [], eventLog: [
      { id: 'event-old', chapterIndex: 0, title: '旧记号', description: '发现父亲留下的记号。', characters: ['林澈'], type: '主线', status: 'developing', timestamp: now },
      { id: 'event-foreshadow', chapterIndex: 0, title: '黑门伏笔', description: '黑门与父亲失踪有关。', characters: ['林澈'], type: '伏笔', status: 'planted', timestamp: now },
      { id: 'event-future', chapterIndex: 3, title: '未来事件', description: '未来才会发生。', characters: [], type: '主线', status: 'planted', timestamp: now },
    ],
    storyArcs: [{ id: 'arc-1', title: '父亲失踪线', description: '追查真相', type: 'main', importance: 5, status: 'active', reactivateAt: '', characterIds: ['character-1'], nodes: [], createdAt: now, updatedAt: now }],
    chapterPlans: [{ id: 'plan-1', horizon: 'next', title: '进入学院', objective: '找到第一条线索', summary: '与守门人交涉', beats: ['进入学院'], targetChapterStart: 1, targetChapterEnd: 1, relatedArcIds: ['arc-1'], relatedEventIds: ['event-foreshadow'], status: 'planned', source: 'ai', createdAt: now, updatedAt: now }],
    dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: now, updatedAt: now,
  } as unknown as Novel
}

describe('reconstruction context pack', () => {
  it('keeps structured story state bounded to the current chapter', () => {
    const novel = makeNovel()
    const pack = buildReconstructionContextPack(novel, novel.chapters[1], { targetType: 'review', targetId: 'chapter-2' })

    expect(pack.targetType).toBe('review')
    expect(pack.hardRules.join(' ')).toContain('夜间禁行')
    expect(pack.currentPlan.join(' ')).toContain('进入学院')
    expect(pack.relevantPlotlineIds).toContain('arc-1')
    expect(pack.relevantForeshadowingIds).toContain('event-foreshadow')
    expect(pack.relevantEventIds).not.toContain('event-future')
    expect(pack.evidence.map(item => item.sourceId)).toContain('chapter-1')
  })

  it('formats IDs and rules as a compact auditable block', () => {
    const pack = buildReconstructionContextPack(makeNovel(), undefined, { authorInstruction: '只依据证据判断' })
    const text = formatReconstructionContextPack(pack)
    expect(text).toContain('硬规则')
    expect(text).toContain('相关剧情线 ID')
    expect(text).toContain('作者指令：只依据证据判断')
  })
})
