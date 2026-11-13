import { describe, expect, it } from 'vitest'
import { buildChapterFactCard, buildReviewContext, buildWritingContext, selectRelevantCharacters } from './context'
import { createChapterSourceBinding } from './derivedSources'
import { createStoryMemoryBinding } from './storyMemory'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import { buildSemanticRecords } from './semanticIndex'
import type { Chapter, Novel } from '@/types/novel'
import { buildLongformFixture } from '@/test/longformEvalFixture'

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
  it('preserves confirmed memory and causality in a late chapter with many unknown times', () => {
    const fixture = buildLongformFixture('large')
    fixture.novel.outline = '早期总纲与风格背景。'.repeat(1000)
    const chapter = fixture.novel.chapters[fixture.novel.chapters.length - 1]
    const context = buildWritingContext(fixture.novel, chapter, 8000, undefined, fixture.records, [], [])
    for (const fact of ['白鹭转交的父亲亲笔信', '明确不知情', '镇海司', '信任', '南城盐仓失火', '渔户围堵府衙']) {
      expect(context.outlineContext).toContain(fact)
    }
    expect(context.outlineContext.length).toBeLessThanOrEqual(8000)
    expect(context.outlineContext.match(/时间来源未知/g)?.length || 0).toBeLessThanOrEqual(4)
    expect(context.outlineContext).toContain('不得从全局最新时钟补值')
  })
  it('事实卡和检索记忆区分基础值与装备后的生效值', () => {
    const novel = createNovel(['林青'])
    novel.dataPanels = [
      { id: 'hero', name: '林青', category: '角色', fields: [{ id: 'attack', name: '攻击力', value: '20', unit: '', note: '' }],
        relatedKeywords: ['林青'], createdAt: novel.createdAt, updatedAt: novel.updatedAt },
      { id: 'sword', name: '铁剑', category: '装备', ownerItemId: 'hero', equipmentState: 'equipped',
        fields: [{ id: 'bonus', name: '攻击加成', value: '10', unit: '', note: '', modifier: { attribute: '攻击力', operation: 'flat' } }],
        relatedKeywords: [], createdAt: novel.createdAt, updatedAt: novel.updatedAt },
    ]
    expect(buildChapterFactCard(novel, novel.chapters[0])).toContain('生效值 30')
    expect(buildSemanticRecords(novel).find(record => record.sourceId === 'hero')?.content).toContain('基础 20')
    expect(buildSemanticRecords(novel).find(record => record.sourceId === 'hero')?.content).toContain('生效值 30')
    novel.dataPanels[1].equipmentState = 'stored'
    expect(buildChapterFactCard(novel, novel.chapters[0])).not.toContain('生效值 30')
  })

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

  it('写作上下文将卷大纲明确标为预期规划', () => {
    const novel = createNovel(['林青'])
    const ctx = buildWritingContext(novel, novel.chapters[0], 8000)
    expect(ctx.outlineContext).toContain('当前卷规划（预期走向，不能作为已发生事实）')
    expect(ctx.outlineContext).toContain('失落传承')
    expect(ctx.structuredState).toContain('硬规则')
    expect(ctx.outlineContext).toContain('V2 结构化故事状态')
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

  it('审查上下文保留提供的完整正文，由审核服务分段并记录覆盖范围', () => {
    const novel = createNovel(['林青', '苏瑶'])
    const reviewCtx = buildReviewContext(novel, novel.chapters[0], '正文'.repeat(3000), 2000)
    expect(reviewCtx.chapterContent).toBe('正文'.repeat(3000))
    expect(reviewCtx.characters).toContain('林青')
  })

  it('长书上下文保留最近阶段而不是最早阶段，并提示未兑现期待', () => {
    const novel = createNovel(['林青'])
    const first = novel.chapters[0]
    novel.chapters = Array.from({ length: 160 }, (_, index) => {
      const content = `第${index + 1}章正文：林青记录阶段${index + 1}的线索。`
      const summary = `阶段${index + 1}的经历`
      const chapter = {
        ...first, id: `chapter-${index}`, chapterIndex: index,
        title: `第${index + 1}章`, content, summary, wordCount: content.length,
      }
      return { ...chapter, summarySource: createChapterSourceBinding(chapter, summary, 'ai', novel.createdAt) }
    })
    novel.eventLog = [{
      id: 'promise', chapterIndex: 70, title: '密信之谜', description: '找到密信的主人',
      characters: [], type: '伏笔', status: 'planted', timestamp: novel.createdAt,
    }]
    const scope = { kind: 'book' as const, throughChapterId: novel.chapters[129].id }
    const summary = '阶段130的经历'
    const memory: StoryMemoryRecord = { id: 'earlier-memory', novelId: novel.id, title: '较早阶段回顾', scope, summary,
      source: createStoryMemoryBinding(novel, scope, summary, 'author', '2026-10-28T00:00:00.000Z'), history: [] }
    const context = buildWritingContext(novel, novel.chapters[159], 8000, undefined, [], [memory])
    expect(context.previousSummary).toContain('阶段130的经历')
    expect(context.previousSummary).not.toContain('阶段1的经历')
    expect(context.previousSummary).toContain('阶段159的经历')
    expect(context.outlineContext).toContain('尚未兑现的读者期待')
    expect(context.outlineContext).toContain('密信之谜')
  })

  it('上下文排除过期和未确认摘要，重新确认后恢复', () => {
    const novel = createNovel(['林青'])
    novel.id = 'summary-validation-context'
    const base = novel.chapters[0]
    const oldContent = '林青在旧钟楼找到铜盒。'
    const stale = {
      ...base,
      id: 'chapter-stale',
      chapterIndex: 0,
      title: '过期来源',
      content: '林青在药铺找到铜盒。',
      summary: '过期摘要只应在重新确认后出现',
      summarySource: createChapterSourceBinding({ id: 'chapter-stale', content: oldContent }, '过期摘要只应在重新确认后出现', 'ai', novel.createdAt),
    }
    const unverified: Chapter = {
      ...base,
      id: 'chapter-unverified',
      chapterIndex: 1,
      title: '未确认来源',
      content: '林青在南门听见铜盒的回声。',
      summary: '未确认摘要只应在重新确认后出现',
      summarySource: undefined,
    }
    const current = { ...base, id: 'chapter-current', chapterIndex: 2, title: '当前章节', content: '', summary: '', summarySource: undefined }
    novel.chapters = [stale, unverified, current]

    const rejected = buildWritingContext(novel, current, 8000)
    expect(rejected.previousSummary).not.toContain('过期摘要只应在重新确认后出现')
    expect(rejected.previousSummary).not.toContain('未确认摘要只应在重新确认后出现')

    stale.summarySource = createChapterSourceBinding(stale, stale.summary, 'author', novel.createdAt)
    unverified.summarySource = createChapterSourceBinding(unverified, unverified.summary, 'author', novel.createdAt)
    const confirmed = buildWritingContext(novel, current, 8000)
    expect(confirmed.previousSummary).toContain('过期摘要只应在重新确认后出现')
    expect(confirmed.previousSummary).toContain('未确认摘要只应在重新确认后出现')
  })
})


describe('当前写作上下文缓存', () => {
  function cachedBook(id: string) {
    const novel = createNovel(['林青'])
    novel.id = id
    novel.outline = '铜盒线索追查'
    novel.chapters[0].content = '林青把铜盒藏进旧钟楼。'
    novel.chapters.push({ ...novel.chapters[0], id: id + '-current', chapterIndex: 1, title: '林青追查铜盒', content: '', summary: '' })
    return { novel, chapter: novel.chapters[1] }
  }

  it('invalidates equal-length outline edits without relying on updatedAt', () => {
    const { novel, chapter } = cachedBook('cache-outline-content')
    novel.outline = '铜盒藏在东岸'
    const before = buildWritingContext(novel, chapter, 32000)
    expect(before.outlineContext).toContain('铜盒藏在东岸')
    expect(buildWritingContext(novel, chapter, 32000)).toBe(before)
    novel.outline = '铜盒藏在西岸'
    const after = buildWritingContext(novel, chapter, 32000)
    expect(after.outlineContext).toContain('铜盒藏在西岸')
    expect(after.outlineContext).not.toContain('铜盒藏在东岸')
  })

  it('invalidates character descriptions and relationship text with unchanged counts', () => {
    const { novel, chapter } = cachedBook('cache-character-content')
    const hero = novel.characters[0]
    novel.characters.push({ ...hero, id: 'guard', name: '守卫', relationships: [] })
    hero.relationships = [{ targetId: 'guard', targetName: '守卫', relation: '结义兄弟' }]
    hero.description = '铜盒上刻着旧纹章'
    const before = buildWritingContext(novel, chapter, 32000)
    expect(before.outlineContext).toContain('结义兄弟')
    hero.relationships[0].relation = '杀父仇人'
    hero.description = '铜盒上刻着新纹章'
    const after = buildWritingContext(novel, chapter, 32000)
    expect(after.outlineContext).toContain('杀父仇人')
    expect(after.outlineContext).not.toContain('结义兄弟')
    expect(after.semanticEvidence).not.toContain('旧纹章')
    expect(after.semanticEvidence).toContain('新纹章')
  })

  it('invalidates event descriptions and current planning without timestamp changes', () => {
    const { novel, chapter } = cachedBook('cache-event-content')
    novel.eventLog = [{ id: 'cache-event', chapterIndex: 0, title: '铜盒证词', description: '旧证词提到南门', characters: ['林青'], type: '主线', status: 'resolved', timestamp: 'same' }]
    novel.chapterPlans![0].targetChapterStart = 1
    novel.chapterPlans![0].targetChapterEnd = 1
    novel.chapterPlans![0].objective = '去南门查访'
    const before = buildWritingContext(novel, chapter, 32000)
    expect(before.outlineContext).toContain('旧证词提到南门')
    expect(before.chapterGuidance).toContain('去南门查访')
    novel.eventLog[0].description = '新证词提到北门'
    novel.chapterPlans![0].objective = '去北门查访'
    const after = buildWritingContext(novel, chapter, 32000)
    expect(after.outlineContext).toContain('新证词提到北门')
    expect(after.outlineContext).not.toContain('旧证词提到南门')
    expect(after.chapterGuidance).toContain('去北门查访')
    expect(after.chapterGuidance).not.toContain('去南门查访')
  })

  it('replaces prior-chapter excerpts and invalidates world rules and clock changes', () => {
    const { novel, chapter } = cachedBook('cache-source-content')
    novel.settings.worldBuilding.specialRules = '城内禁用火术'
    const before = buildWritingContext(novel, chapter, 32000)
    expect(before.structuredState).toContain('城内禁用火术')
    novel.chapters[0].content = '林青把铜盒藏进新钟楼。'
    novel.settings.worldBuilding.specialRules = '城内禁用水术'
    const after = buildWritingContext(novel, chapter, 32000)
    expect(after.lastParagraph).toContain('新钟楼')
    expect(after.semanticEvidence).not.toContain('旧钟楼')
    expect(after.structuredState).toContain('城内禁用水术')
    expect(after.structuredState).not.toContain('城内禁用火术')
  })
})
