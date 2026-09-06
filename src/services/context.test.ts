import { describe, expect, it } from 'vitest'
import { buildReviewContext, buildWritingContext, selectRelevantCharacters } from './context'
import type { Novel } from '@/types/novel'

function createNovel(characterNames: string[]): Novel {
  return {
    id: 'novel-1',
    title: '测试小说',
    genre: 'fantasy',
    subGenre: 'xianxia',
    genreLabel: '玄幻',
    subGenreLabel: '仙侠',
    tags: [],
    targetWordCountMin: 100,
    targetWordCountMax: 200,
    currentWordCount: 0,
    writingStyle: {
      narrativePov: '',
      toneStyle: '',
      descriptionDensity: '',
      dialogueStyle: '',
      combatStyle: '',
      pacingControl: '',
      emotionExpression: '',
    },
    settings: {
      protagonist: {
        name: '林青',
        gender: '',
        age: '',
        background: '',
        personality: [],
        initialPower: '',
        cheatDescription: '',
        romanceTendency: '',
      },
      supportingCharacters: [],
      worldBuilding: { worldType: '', worldScale: '', socialStructure: '', techLevel: '', specialRules: '' },
      powerSystem: { systemName: '', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] },
      structure: { foreshadowingDensity: '' },
      otherSettings: '',
    },
    outline: '总大纲'.repeat(1000),
    synopsis: '',
    volumes: [
      {
        id: 'volume-1',
        volumeIndex: 0,
        title: '秘境卷',
        theme: '探索秘境',
        summary: '林青将在秘境卷中找到失落传承。',
        keyTurningPoints: '',
        characterChanges: '',
        estimatedChapters: 20,
        estimatedWordCount: 5,
      },
    ],
    chapters: [
      {
        id: 'chapter-1',
        volumeIndex: 0,
        chapterIndex: 0,
        title: '第一章',
        content: '',
        summary: '',
        wordCount: 0,
        status: 'draft',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
    characters: characterNames.map((name, index) => ({
      id: `char-${index}`,
      name,
      aliases: [],
      identity: '修士',
      personality: '',
      powerLevel: '',
      faction: '',
      status: '活跃',
      firstAppearChapter: index,
      description: '',
      relationships: [],
      events: [],
      avatarColor: '#fff',
    })),
    chatHistory: [],
    knowledgeBaseIds: [],
    eventLog: [],
    dataPanels: [],
    dataPanelChanges: [],
    chapterPlans: [{
      id: 'plan-1',
      horizon: 'next',
      title: '进入秘境',
      objective: '林青与苏瑶进入秘境',
      summary: '二人穿过入口并确认首个目标。',
      beats: ['进入秘境'],
      targetChapterStart: 0,
      targetChapterEnd: 0,
      relatedArcIds: [],
      relatedEventIds: [],
      status: 'planned',
      source: 'user',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }],
    status: 'writing',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }
}

describe('写作上下文', () => {
  it('相关角色筛选保留主角和本章命中角色', () => {
    const novel = createNovel(['林青', '苏瑶', '赵甲', '赵乙', '赵丙', '赵丁'])
    const chars = selectRelevantCharacters(novel, '苏瑶在秘境中遇险', 2)
    expect(chars.map(c => c.name)).toContain('林青')
    expect(chars.map(c => c.name)).toContain('苏瑶')
  })

  it('构建上下文时按预算截断总大纲', () => {
    const novel = createNovel(['林青'])
    const ctx = buildWritingContext(novel, novel.chapters[0], 2000)
    expect(ctx.outlineContext.length).toBeLessThan(2000)
    expect(ctx.chapterGuidance).toContain('林青与苏瑶进入秘境')
  })

  it('角色内容变化但数量不变时缓存会失效', () => {
    const novel = createNovel(['林青'])
    let ctx = buildWritingContext(novel, novel.chapters[0], 8000)
    expect(ctx.outlineContext).toContain('修士')
    novel.characters[0].identity = '剑修'
    ctx = buildWritingContext(novel, novel.chapters[0], 8000)
    expect(ctx.outlineContext).toContain('剑修')
  })

  it('写作上下文包含当前卷级摘要', () => {
    const novel = createNovel(['林青'])
    const ctx = buildWritingContext(novel, novel.chapters[0], 8000)
    expect(ctx.outlineContext).toContain('当前卷级摘要')
    expect(ctx.outlineContext).toContain('失落传承')
  })

  it('写作上下文注入活跃弧线和临近时间线', () => {
    const novel = createNovel(['林青'])
    novel.storyArcs = [{
      id: 'arc-1',
      title: '赤月复仇线',
      description: '查明赤月城旧案真相',
      type: 'main',
      importance: 5,
      status: 'active',
      reactivateAt: '',
      characterIds: ['char-0'],
      nodes: [{
        id: 'node-1',
        title: '找到城主密信',
        description: '密信指向幕后主使',
        targetChapter: 2,
        status: 'pending',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }]
    novel.eventLog = [{
      id: 'event-1',
      chapterIndex: -1,
      title: '收到匿名信',
      description: '匿名信约林青三日后在赤月城见面',
      characters: ['林青'],
      type: '伏笔',
      scope: 'global',
      status: 'planted',
      hintCount: 1,
      targetChapter: 2,
      importance: 4,
      timestamp: '2026-01-01',
    }, {
      id: 'event-2',
      chapterIndex: 0,
      title: '进入赤月城',
      description: '林青抵达赤月城并开始调查旧案',
      characters: ['林青'],
      type: '主线',
      status: 'developing',
      targetChapter: 1,
      importance: 4,
      timestamp: '2026-01-01',
    }]

    const ctx = buildWritingContext(novel, novel.chapters[0], 8000)
    expect(ctx.outlineContext).toContain('当前故事弧线')
    expect(ctx.outlineContext).toContain('找到城主密信')
    expect(ctx.outlineContext).toContain('故事时间线')
    expect(ctx.outlineContext).toContain('进入赤月城')
    expect(ctx.outlineContext).toContain('【全书规划')
    expect(ctx.outlineContext).toContain('收到匿名信')
    const timelineSection = ctx.outlineContext.split('【故事时间线')[1]?.split('【相关角色库')[0] || ''
    expect(timelineSection).not.toContain('收到匿名信')
  })

  it('审查上下文按预算裁剪正文并复用相关角色', () => {
    const novel = createNovel(['林青', '苏瑶'])
    const reviewCtx = buildReviewContext(novel, novel.chapters[0], '正文'.repeat(3000), 2000)
    expect(reviewCtx.chapterContent.length).toBeLessThanOrEqual(1000)
    expect(reviewCtx.characters).toContain('林青')
  })
})
