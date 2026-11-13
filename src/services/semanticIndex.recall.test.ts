import { beforeAll, describe, expect, it } from 'vitest'
import { buildSemanticRecords, formatEvidence, retrieveSemanticEvidence } from './semanticIndex'
import { createChapterSourceBinding } from './derivedSources'
import type { Chapter, Novel } from '@/types/novel'

const CHAPTER_COUNT = 200
const NOVEL_ID = 'semantic-recall-million-character-novel'

type RecallCase = {
  chapterIndex: number
  fact: string
  query: string
}

const recallCases: RecallCase[] = [
  {
    chapterIndex: 3,
    fact: '青铜潮汐表明北港灯塔的备用钥匙藏在旧钟楼第三层的铜匣中。',
    query: '北港灯塔备用钥匙 旧钟楼 铜匣',
  },
  {
    chapterIndex: 21,
    fact: '鹤鸣药圃的账册确认，白芷商队把雪线花种寄存在南井石龛。',
    query: '鹤鸣药圃 白芷商队 雪线花种 南井石龛',
  },
  {
    chapterIndex: 48,
    fact: '临河渡口的暗号不是旧歌谣，而是三短一长的木鱼声。',
    query: '临河渡口 暗号 三短一长 木鱼声',
  },
  {
    chapterIndex: 76,
    fact: '银沙盐场的真正契约人名为乌檀，印章藏在晒盐棚的第七根横梁。',
    query: '银沙盐场 契约人 乌檀 第七根横梁',
  },
  {
    chapterIndex: 100,
    fact: '云脊驿站的失踪马匹并未北逃，它们被转移到落星谷的青石马厩。',
    query: '云脊驿站 失踪马匹 落星谷 青石马厩',
  },
  {
    chapterIndex: 127,
    fact: '赤炉工坊留下的真相是，断裂的鸣火针被铸进了城门铜兽的左眼。',
    query: '赤炉工坊 鸣火针 城门铜兽 左眼',
  },
  {
    chapterIndex: 157,
    fact: '暮鼓寺的旧地图标出一条密道，入口位于第三尊石莲的背面。',
    query: '暮鼓寺 旧地图 密道 第三尊石莲',
  },
  {
    chapterIndex: 181,
    fact: '归潮船队的最后一封电报写明，沉船坐标记录在青鹭湾的风向簿。',
    query: '归潮船队 沉船坐标 青鹭湾 风向簿',
  },
]

const tailFact = '尾部事实：琥珀观测站的原始样本被封存在无刻度的黑陶瓶里。'
const tailQuery = '琥珀观测站 原始样本 黑陶瓶'

const dailyScenes = [
  '清晨有人在廊下筛米，木筛碰到石台发出细碎的沙沙声，伙房把今日的粥火调得很慢。',
  '午后账房核对盐、灯油和麻绳的余量，送货人把湿斗笠挂在门边，等风把水汽吹干。',
  '傍晚邻街的孩子追着纸鸢跑过巷口，杂货铺收起竹篮，门框上的旧漆又掉了一小片。',
  '雨天车夫给车轴添油，旅店把晒不干的被褥移到灶边，楼上有人反复修补一只布袋。',
  '集市开门前，卖豆腐的人先擦净案板，卖果脯的人清点木夹，街角的钟慢了半刻。',
  '夜里巡更换过两次火把，河面漂来芦苇的气味，守门人把当天的闲话写进值夜簿。',
  '午饭后众人把杯盏送回井台，裁缝量好冬衣的袖长，窗纸透进一层灰白的日光。',
  '风停的时候，院里的晾衣绳垂得很低，学徒搬动柴捆，厨房为晚饭切碎葱姜。',
  '车站的告示被重新贴平，茶摊给熟客续了一壶热水，远处的磨坊响起规律的石轮声。',
  '月亮升起前，药童把空药瓶排成一列，木匠检查门闩，邻居讨论下旬是否会有霜。',
  '晴日里大家晾晒谷物，麻雀在墙头抢落下的米粒，管事把借出的梯子记在册尾。',
  '寒潮来时，店家把炭盆移近柜台，船工缝紧帆角，学堂里传出一阵又一阵的读书声。',
]

function settings(): Novel['settings'] {
  return {
    protagonist: { name: '沈砚', gender: '男', age: '二十', background: '普通旅人', personality: ['谨慎'], initialPower: '初阶', cheatDescription: '', romanceTendency: '' },
    supportingCharacters: [],
    worldBuilding: { worldType: '架空城邦', worldScale: '多城', socialStructure: '行会制', techLevel: '冷兵器', specialRules: '' },
    powerSystem: { systemName: '无', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
    coreConflict: { mainConflict: '寻找失散的线索', mainVillain: '', factionConflicts: '', coreSuspense: '' },
    romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
    payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] },
    structure: { foreshadowingDensity: '中' },
    otherSettings: '',
  }
}

function dailyInterference(chapterIndex: number): string {
  return Array.from({ length: 110 }, (_, paragraphIndex) => {
    const scene = dailyScenes[(chapterIndex * 3 + paragraphIndex) % dailyScenes.length]
    return `日常记录${chapterIndex + 1}-${paragraphIndex + 1}：${scene}`
  }).join('\n')
}

function chapterFor(index: number): Chapter {
  const recallCase = recallCases.find(item => item.chapterIndex === index)
  const fact = recallCase ? `\n事实锚点：${recallCase.fact}` : ''
  const tail = index === CHAPTER_COUNT - 1
    ? `${'无刻度的陶片被一件件擦净，守夜人没有在这段记录里留下任何标点'.repeat(18)}${tailFact}`
    : ''
  const content = `${dailyInterference(index)}${fact}${tail}`
  const chapter: Chapter = {
    id: `recall-chapter-${index}`,
    volumeIndex: Math.floor(index / 20),
    chapterIndex: index,
    title: `长篇日常篇章 ${index + 1}`,
    content,
    summary: `第${index + 1}章记录旅途中的生活安排与环境变化。`,
    wordCount: content.length,
    status: 'finalized',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return { ...chapter, summarySource: createChapterSourceBinding(chapter, chapter.summary, 'ai', '2026-01-01T00:00:00.000Z') }
}

function largeNovel(): Novel {
  return {
    id: NOVEL_ID,
    title: '百万字符语义召回验收书',
    genre: 'fantasy',
    subGenre: 'journey',
    genreLabel: '幻想',
    subGenreLabel: '旅途',
    tags: ['长篇', '日常'],
    targetWordCountMin: 100,
    targetWordCountMax: 200,
    currentWordCount: 0,
    writingStyle: {
      narrativePov: '第三人称',
      toneStyle: '平实',
      descriptionDensity: '中',
      dialogueStyle: '自然',
      combatStyle: '克制',
      pacingControl: '稳定',
      emotionExpression: '细腻',
    },
    settings: settings(),
    outline: '',
    synopsis: '',
    volumes: [],
    chapters: Array.from({ length: CHAPTER_COUNT }, (_, index) => chapterFor(index)),
    characters: [],
    chatHistory: [],
    knowledgeBaseIds: [],
    eventLog: [],
    storyArcs: [],
    chapterPlans: [],
    storyStateProposals: [],
    dataPanels: [],
    dataPanelChanges: [],
    status: 'writing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function cloneNovel(novel: Novel): Novel {
  return JSON.parse(JSON.stringify(novel)) as Novel
}

describe('百万字符本地语义召回验收', () => {
  let novel: Novel
  let records: ReturnType<typeof buildSemanticRecords>
  let totalCharacters = 0

  beforeAll(() => {
    novel = largeNovel()
    totalCharacters = novel.chapters.reduce((total, chapter) => total + chapter.content.length, 0)
    records = buildSemanticRecords(novel)
    expect(records).toHaveLength(1801)
    console.info(`semantic recall fixture: ${novel.chapters.length} chapters, ${totalCharacters} content characters, ${records.length} semantic records`)
  }, 30_000)

  it('在至少一百万字符、两百章且含日常干扰的语料中，八个远近事实都进入各自 top5', () => {
    expect(novel.chapters).toHaveLength(CHAPTER_COUNT)
    expect(totalCharacters).toBeGreaterThanOrEqual(1_000_000)
    expect(new Set(dailyScenes.map(scene => scene.slice(0, 10))).size).toBeGreaterThanOrEqual(8)

    for (const recallCase of recallCases) {
      const expectedSourceId = `recall-chapter-${recallCase.chapterIndex}`
      const evidence = retrieveSemanticEvidence(recallCase.query, records, 5, 0)
      expect(evidence.slice(0, 5).map(item => item.sourceId), recallCase.query).toContain(expectedSourceId)
      expect(evidence.some(item => item.sourceId === expectedSourceId && item.content.includes(recallCase.fact)), recallCase.query).toBe(true)
    }
  }, 30_000)

  it('beforeChapterIndex 排除当前章和未来章节的正文事实', () => {
    const cutoff = 100
    const beforeRecords = buildSemanticRecords(novel, [], cutoff)
    expect(beforeRecords
      .filter(record => record.sourceType === 'chapter')
      .every(record => typeof record.metadata?.chapterIndex === 'number' && record.metadata.chapterIndex < cutoff))
      .toBe(true)

    const currentCase = recallCases.find(item => item.chapterIndex === cutoff)!
    const futureCase = recallCases.find(item => item.chapterIndex > cutoff)!
    for (const recallCase of [currentCase, futureCase]) {
      const evidence = retrieveSemanticEvidence(recallCase.query, beforeRecords, 5, 0)
      expect(evidence.slice(0, 5).map(item => item.sourceId), recallCase.query).not.toContain(`recall-chapter-${recallCase.chapterIndex}`)
    }
  }, 30_000)

  it('正文修改或删除后重建记录不会返回旧事实', () => {
    const modifiedCase = recallCases[2]
    const modifiedNovel = cloneNovel(novel)
    const modifiedChapter = modifiedNovel.chapters[modifiedCase.chapterIndex]
    modifiedChapter.content = modifiedChapter.content.replace(modifiedCase.fact, '事实锚点：临河渡口的木桨已经换成普通的白桦木。')
    const modifiedRecords = buildSemanticRecords(modifiedNovel)
    const afterModification = retrieveSemanticEvidence(modifiedCase.query, modifiedRecords, 5, 0)
    expect(modifiedRecords.some(record => record.sourceId === modifiedChapter.id && record.content.includes(modifiedCase.fact))).toBe(false)
    expect(afterModification.every(record => !record.content.includes(modifiedCase.fact))).toBe(true)

    const deletedCase = recallCases[6]
    const deletedNovel = cloneNovel(novel)
    const deletedChapterId = `recall-chapter-${deletedCase.chapterIndex}`
    deletedNovel.chapters = deletedNovel.chapters.filter(chapter => chapter.id !== deletedChapterId)
    const deletedRecords = buildSemanticRecords(deletedNovel)
    const afterDeletion = retrieveSemanticEvidence(deletedCase.query, deletedRecords, 5, 0)
    expect(deletedRecords.some(record => record.sourceId === deletedChapterId)).toBe(false)
    expect(afterDeletion.some(record => record.sourceId === deletedChapterId)).toBe(false)
    expect(afterDeletion.every(record => !record.content.includes(deletedCase.fact))).toBe(true)
  }, 30_000)

  it('chunk 尾部的命中事实必须保留在 formatEvidence 的引用摘要中', () => {
    const tailSourceId = `recall-chapter-${CHAPTER_COUNT - 1}`
    const evidence = retrieveSemanticEvidence(tailQuery, records, 5, 0)
    const tailHit = evidence.slice(0, 5).find(item => item.sourceId === tailSourceId && item.content.includes(tailFact))
    expect(tailHit, tailQuery).toBeDefined()
    expect(tailHit!.content.indexOf(tailFact)).toBeGreaterThan(260)
    expect(formatEvidence([tailHit!], 1800, tailQuery)).toContain(tailFact)
  }, 30_000)
})
