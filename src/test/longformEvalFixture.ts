/**
 * Synthetic multi-volume corpus for the pre-registered long-form memory evaluation
 * (docs/reconstruction-v2-longform-eval-plan.md). No user manuscript or external text.
 * Every Canon fact enters through the product candidate → author acceptance → Canon path.
 */
import type { Chapter, Character, Novel } from '@/types/novel'
import type { CandidateChange, CanonMutationRecord } from '@/types/reconstruction'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from '@/services/reconstructionCandidates'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import { getPropositionCatalog } from '@/services/reconstructionCharacterState'
import { commitEventCausality, eventCausalityDraftFromCandidate } from '@/services/eventCausalityTransactions'
import { captureEventCausalityBaseline } from '@/services/eventCausality'
import type { StoryAggregate } from '@/services/storyAggregate'

export type LongformScale = 'default' | 'large'
export const LONGFORM_LAYOUT: Record<LongformScale, { volumes: number; chaptersPerVolume: number; fillerParagraphs: number }> = {
  default: { volumes: 3, chaptersPerVolume: 16, fillerParagraphs: 40 },
  large: { volumes: 4, chaptersPerVolume: 50, fillerParagraphs: 140 },
}
export const LONGFORM_NOVEL_ID = 'longform-eval-novel'
const BASE_TIME = Date.parse('2026-11-01T00:00:00.000Z')

export const CAST = {
  shenYan: 'lf-shen-yan', guTinglan: 'lf-gu-tinglan', guXingzhou: 'lf-gu-xingzhou', baiLu: 'lf-bai-lu', liuZhao: 'lf-liu-zhao', shenBoheng: 'lf-shen-boheng',
} as const

type PlantKind = 'knowledge' | 'relationship' | 'event' | 'causality' | 'text'
export interface PlantSpec {
  key: string
  kind: PlantKind
  volume?: number
  position?: number
  sameChapterAs?: string
  sentence: string
  /** Distinctive text whose appearance before its chapter is a future-information leak. */
  needles: string[]
  payload?: Record<string, unknown>
}

/** Fixed sentences; each is unique in the whole book. */
export const PLANTS: PlantSpec[] = [
  { key: 'k1a', kind: 'knowledge', volume: 0, position: 0.1, sentence: '沈砚一直认定父亲沈伯衡十年前已经葬身洪水，从未怀疑过这件事。',
    needles: ['葬身洪水'], payload: { characterId: CAST.shenYan, characterName: '沈砚', fact: '沈伯衡仍然在世', subjectId: CAST.shenBoheng, scope: '沈伯衡生死', state: 'false_belief', belief: '父亲十年前已葬身洪水' } },
  { key: 'k1b', kind: 'knowledge', volume: 1, position: 0.25, sentence: '沈砚在旧码头认出父亲独有的笔迹，开始怀疑父亲其实还活着。',
    needles: ['认出父亲独有的笔迹'], payload: { characterId: CAST.shenYan, characterName: '沈砚', fact: '沈伯衡仍然在世', subjectId: CAST.shenBoheng, scope: '沈伯衡生死', state: 'suspects', learnedFrom: '旧码头的笔迹' } },
  { key: 'k1c', kind: 'knowledge', volume: 2, position: 0.1, sentence: '白鹭把一封亲笔信交给沈砚，信里清楚写明沈伯衡仍然在世。',
    needles: ['白鹭把一封亲笔信交给沈砚', '白鹭转交的父亲亲笔信'], payload: { characterId: CAST.shenYan, characterName: '沈砚', fact: '沈伯衡仍然在世', subjectId: CAST.shenBoheng, scope: '沈伯衡生死', state: 'knows', learnedFrom: '白鹭转交的父亲亲笔信' } },
  { key: 'k2a', kind: 'knowledge', volume: 0, position: 0.5, sentence: '白鹭完全不知道顾听澜是镇海司的密探，只当他是寻常茶商。',
    needles: ['只当他是寻常茶商'], payload: { characterId: CAST.baiLu, characterName: '白鹭', fact: '顾听澜是镇海司密探', subjectId: CAST.guTinglan, scope: '顾听澜身份', state: 'does_not_know' } },
  { key: 'k2b', kind: 'knowledge', volume: 1, position: 0.5, sentence: '沈砚看见顾听澜袖口的镇海司暗纹，怀疑他是镇海司密探。',
    needles: ['袖口的镇海司暗纹'], payload: { characterId: CAST.shenYan, characterName: '沈砚', fact: '顾听澜是镇海司密探', subjectId: CAST.guTinglan, scope: '顾听澜身份', state: 'suspects', learnedFrom: '袖口暗纹' } },
  { key: 'r1a', kind: 'relationship', volume: 0, position: 0.15, sentence: '沈砚对顾听澜始终心存戒备，从不让他靠近账房一步。',
    needles: ['从不让他靠近账房一步'], payload: { characterId: CAST.shenYan, characterName: '沈砚', targetCharacterId: CAST.guTinglan, targetCharacterName: '顾听澜', relation: '戒备', dimension: 'trust', description: '不让顾听澜靠近账房' } },
  { key: 'r1b', kind: 'relationship', volume: 0, position: 0.55, sentence: '顾听澜暗中替沈砚挡下三次追杀，沈砚对此一无所知。',
    needles: ['暗中替沈砚挡下三次追杀'], payload: { characterId: CAST.guTinglan, characterName: '顾听澜', targetCharacterId: CAST.shenYan, targetCharacterName: '沈砚', relation: '暗中护持', dimension: 'allegiance', description: '替沈砚挡下追杀' } },
  { key: 'r1c', kind: 'relationship', volume: 1, position: 0.4, sentence: '经过雨夜同舟，沈砚终于把账房钥匙交给了顾听澜。',
    needles: ['雨夜同舟'], payload: { characterId: CAST.shenYan, characterName: '沈砚', targetCharacterId: CAST.guTinglan, targetCharacterName: '顾听澜', relation: '信任', dimension: 'trust', description: '交出账房钥匙' } },
  { key: 'n1', kind: 'text', volume: 0, position: 0.3, sentence: '茶楼伙计只说顾先生来过，没有说清是哪一位顾先生。', needles: [] },
  { key: 'f1', kind: 'event', volume: 0, position: 0.2, sentence: '祠堂失火那夜，供桌上那把刻着鹤纹的铜钥匙不翼而飞。',
    needles: ['刻着鹤纹的铜钥匙不翼而飞', '鹤纹铜钥匙失踪'], payload: { title: '鹤纹铜钥匙失踪', description: '祠堂失火当夜供桌上的铜钥匙消失', type: '伏笔', characters: [] } },
  { key: 'f1p', kind: 'text', volume: 2, position: 0.75, sentence: '沈砚在柳昭书房的暗格里摸到一把冰凉的鹤纹钥匙。', needles: ['柳昭书房的暗格'] },
  { key: 'f2', kind: 'event', volume: 0, position: 0.35, sentence: '老艄公说潮音石只会在最低的退潮时发出鸣响。',
    needles: ['潮音石只会在最低的退潮时', '潮音石鸣响之说'], payload: { title: '潮音石鸣响之说', description: '老艄公讲述潮音石的规律', type: '伏笔', characters: [] } },
  { key: 'f2p', kind: 'text', volume: 2, position: 0.85, sentence: '潮音石低低鸣响的那一刻，沉船的桅杆露出了水面。', needles: ['沉船的桅杆露出了水面'] },
  { key: 'f3', kind: 'event', volume: 0, position: 0.4, sentence: '白鹭腕上那道月牙形旧疤，是幼年被铁链锁住时留下的。',
    needles: ['月牙形旧疤', '白鹭腕上旧疤来历'], payload: { title: '白鹭腕上旧疤来历', description: '白鹭幼年被锁留下的旧伤', type: '伏笔', characters: ['白鹭'] } },
  { key: 'f3p', kind: 'text', volume: 2, position: 0.9, sentence: '白鹭看见那副旧镣铐，下意识地用袖子遮住了手腕。', needles: ['下意识地用袖子遮住了手腕'] },
  { key: 'e1', kind: 'event', volume: 0, position: 0.65, sentence: '南城盐仓夜半失火，三千石官盐尽数焚毁。',
    needles: ['三千石官盐尽数焚毁', '南城盐仓失火'], payload: { title: '南城盐仓失火', description: '官盐焚毁', type: '主线', characters: [] } },
  { key: 'e2', kind: 'event', volume: 0, position: 0.8, sentence: '官盐短缺之后，城中盐价在半月内翻了三倍。',
    needles: ['盐价在半月内翻了三倍', '城中盐价暴涨'], payload: { title: '城中盐价暴涨', description: '盐价翻三倍', type: '主线', characters: [] } },
  { key: 'c12', kind: 'causality', sameChapterAs: 'e2', sentence: '正因盐仓那场大火，市面上再也买不到平价官盐。',
    needles: ['再也买不到平价官盐'], payload: { fromKey: 'e1', toKey: 'e2', relation: 'causes', explanation: '盐仓焚毁导致官盐短缺、盐价上涨' } },
  { key: 'e3', kind: 'event', volume: 1, position: 0.6, sentence: '买不起盐的渔户聚集起来，把府衙大门围了整整三天。',
    needles: ['把府衙大门围了整整三天', '渔户围堵府衙'], payload: { title: '渔户围堵府衙', description: '渔户聚众围府衙', type: '主线', characters: [] } },
  { key: 'c23', kind: 'causality', sameChapterAs: 'e3', sentence: '渔户们说，盐价逼得他们只能去府衙讨个说法。',
    needles: ['盐价逼得他们只能去府衙讨个说法'], payload: { fromKey: 'e2', toKey: 'e3', relation: 'motivates', explanation: '盐价暴涨促使渔户围堵府衙' } },
  { key: 'e4', kind: 'event', volume: 2, position: 0.4, sentence: '朝廷以激起民变为由，下旨将知府即日罢官。',
    needles: ['下旨将知府即日罢官', '知府罢官'], payload: { title: '知府罢官', description: '知府因民变被罢免', type: '主线', characters: [] } },
  { key: 'c34', kind: 'causality', sameChapterAs: 'e4', sentence: '圣旨写明，正是渔户围府一事断送了知府的官职。',
    needles: ['渔户围府一事断送了知府的官职'], payload: { fromKey: 'e3', toKey: 'e4', relation: 'causes', explanation: '围堵府衙导致知府被罢官' } },
  { key: 'd1', kind: 'event', volume: 1, position: 0.1, sentence: '大风那晚，东码头的缆绳被齐齐扯断。',
    needles: ['东码头的缆绳被齐齐扯断', '东码头断缆'], payload: { title: '东码头断缆', description: '缆绳断裂', type: '支线', characters: [] } },
  { key: 'd2', kind: 'event', volume: 1, position: 0.2, sentence: '失去缆绳的货船顺流漂出，搁浅在白沙滩上。',
    needles: ['搁浅在白沙滩上', '货船搁浅'], payload: { title: '货船搁浅', description: '货船搁浅白沙滩', type: '支线', characters: [] } },
  { key: 'cd12', kind: 'causality', sameChapterAs: 'd2', sentence: '船工都说，若不是缆绳断了，货船绝不会漂走。',
    needles: ['若不是缆绳断了'], payload: { fromKey: 'd1', toKey: 'd2', relation: 'causes', explanation: '断缆导致货船漂走搁浅' } },
  { key: 'd3', kind: 'event', volume: 1, position: 0.3, sentence: '借着清理搁浅货船的名义，官府开仓清点了全部存货。',
    needles: ['开仓清点了全部存货', '官仓清点'], payload: { title: '官仓清点', description: '官府清点存货', type: '支线', characters: [] } },
  { key: 'cd23', kind: 'causality', sameChapterAs: 'd3', sentence: '搁浅一事给了官府开仓清点的正当理由。',
    needles: ['搁浅一事给了官府开仓清点的正当理由'], payload: { fromKey: 'd2', toKey: 'd3', relation: 'enables', explanation: '搁浅使官府得以开仓清点' } },
  { key: 'cloop', kind: 'causality', sameChapterAs: 'd3', sentence: '有人造谣说是官仓清点才弄断了码头缆绳。',
    needles: [], payload: { fromKey: 'd3', toKey: 'd1', relation: 'causes', explanation: '（循环尝试）清点导致断缆' } },
]
/** Free chapters reserved for contradiction cases (review false-positive / false-negative bank). */
export const REVIEW_CASE_POSITIONS = [
  { key: 'v1', volume: 1, position: 0.15 }, { key: 'v2', volume: 1, position: 0.35 }, { key: 'v3', volume: 1, position: 0.7 },
  { key: 'v4', volume: 1, position: 0.9 }, { key: 'v5', volume: 2, position: 0.55 }, { key: 'v6', volume: 2, position: 0.65 },
]
/** Equal-length, opposite-meaning rewrite of k1b (E1). Length equality is asserted at build time. */
export const K1B_REWRITE = '沈砚在旧码头细看过那些笔迹，确信它们和父亲毫无半点关系。'

const fillerScenes = [
  '码头的挑夫把湿麻袋堆在檐下，账房先生一边拨算盘一边抱怨今年的潮气太重。',
  '巷口的豆腐铺照旧天不亮就开门，石磨转了一圈又一圈，热气从门缝里冒出来。',
  '学堂的先生让孩子们背诵旧诗，窗外的槐树落了一地细碎的白花。',
  '集市上有人叫卖新晒的海带，也有卖糖人的老人守着铜锅慢慢熬糖。',
  '午后起了薄雾，渡船在河心停了片刻，船娘唱着听不清词的小调。',
  '药铺伙计把晒干的陈皮收进瓷罐，掌柜在柜台后面核对着药方。',
  '城墙根下的老兵在补一张旧渔网，网眼里还挂着去年的水草。',
  '茶摊换了新的竹棚，几个脚夫坐着歇脚，谈论着今年的粮价。',
  '傍晚的钟声从城北传来，客栈的灯笼一盏接一盏地点亮。',
  '裁缝铺赶制冬衣，学徒把剪下的碎布扎成一捆，留着做鞋垫。',
  '雨停之后，街面的石板泛着光，卖伞的人收起了摊子。',
  '铁匠铺里炉火正旺，锤声叮当，火星溅到了门槛上。',
  '河边的洗衣妇用木槌敲打衣裳，水面一圈圈荡开涟漪。',
  '书肆掌柜把新到的话本摆上架子，几个书生凑在一起翻看。',
  '更夫敲过二更，巷子里只剩下几声狗叫和远处的潮声。',
  '早市散后，菜贩把剩下的青菜送给了隔壁的孤寡老人。',
]

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
function filler(chapterIndex: number, paragraphs: number): string[] {
  return Array.from({ length: paragraphs }, (_, index) => '第' + (chapterIndex + 1) + '章日常' + (index + 1) + '：' + fillerScenes[(chapterIndex * 5 + index) % fillerScenes.length])
}
function character(id: string, name: string, aliases: string[] = []): Character {
  return { id, name, aliases, identity: '', personality: '', powerLevel: '', faction: '', description: '', status: '活跃',
    firstAppearChapter: 0, relationships: [], events: [], avatarColor: '#888888' }
}

export interface LongformFixture {
  scale: LongformScale
  novel: Novel
  records: CanonMutationRecord[]
  candidates: CandidateChange[]
  /** plant key → chapter index */
  chapterOf: Record<string, number>
  /** plant key → Canon event id (event plants only) */
  eventIdOf: Record<string, string>
  /** plant key → Canon record id (knowledge / relationship / causality) */
  recordIdOf: Record<string, string>
  reviewCaseChapters: Record<string, number>
  linked: boolean
  totalCharacters: number
  /** Errors the fixture expected (e.g. the M2 cycle). Unexpected errors throw. */
  expectedRejections: Record<string, string>
}

function placePlants(scale: LongformScale) {
  const layout = LONGFORM_LAYOUT[scale]
  const total = layout.volumes * layout.chaptersPerVolume
  const occupied = new Set<number>(), chapterOf: Record<string, number> = {}
  const place = (volume: number, position: number) => {
    let index = volume * layout.chaptersPerVolume + Math.floor(position * layout.chaptersPerVolume)
    const end = (volume + 1) * layout.chaptersPerVolume
    while (occupied.has(index) && index < end - 1) index++
    if (occupied.has(index)) throw new Error('长篇评估语料：第 ' + (volume + 1) + ' 卷没有空余章节')
    occupied.add(index)
    return index
  }
  // Last chapter stays free for end-of-book queries.
  occupied.add(total - 1)
  for (const plant of PLANTS) if (!plant.sameChapterAs) chapterOf[plant.key] = place(plant.volume!, plant.position!)
  for (const plant of PLANTS) if (plant.sameChapterAs) chapterOf[plant.key] = chapterOf[plant.sameChapterAs]
  const reviewCaseChapters: Record<string, number> = {}
  for (const item of REVIEW_CASE_POSITIONS) reviewCaseChapters[item.key] = place(item.volume, item.position)
  const order = (a: string, b: string) => { if (!(chapterOf[a] < chapterOf[b])) throw new Error('长篇评估语料顺序无效：' + a + ' 应早于 ' + b) }
  for (const [a, b] of [['k1a', 'k1b'], ['k1b', 'k1c'], ['k2a', 'k2b'], ['r1a', 'r1b'], ['r1b', 'r1c'], ['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['d1', 'd2'], ['d2', 'd3'], ['f1', 'f1p'], ['f2', 'f2p'], ['f3', 'f3p']]) order(a, b)
  return { layout, total, chapterOf, reviewCaseChapters }
}

function buildNovel(scale: LongformScale): { novel: Novel; chapterOf: Record<string, number>; reviewCaseChapters: Record<string, number> } {
  const { layout, total, chapterOf, reviewCaseChapters } = placePlants(scale)
  if (K1B_REWRITE.length !== PLANTS.find(plant => plant.key === 'k1b')!.sentence.length) throw new Error('E1 等长改写句长度不一致')
  const chapters: Chapter[] = Array.from({ length: total }, (_, index) => {
    const paragraphs = filler(index, layout.fillerParagraphs)
    const planted = PLANTS.filter(plant => chapterOf[plant.key] === index)
    // Deterministic placement: plants are spread between filler paragraphs in declaration order.
    planted.forEach((plant, offset) => paragraphs.splice(Math.min(paragraphs.length, 3 + offset * 4), 0, plant.sentence))
    const content = paragraphs.join('\n')
    const time = new Date(BASE_TIME).toISOString()
    return { id: 'lf-chapter-' + index, volumeIndex: Math.floor(index / layout.chaptersPerVolume), chapterIndex: index,
      title: '第' + (index + 1) + '章 港城杂记', content, summary: '', wordCount: content.length, status: 'writing', createdAt: time, updatedAt: time }
  })
  for (const plant of PLANTS) {
    const chapter = chapters[chapterOf[plant.key]]
    if (chapter.content.indexOf(plant.sentence) !== chapter.content.lastIndexOf(plant.sentence)) throw new Error('植入句在章节内重复：' + plant.key)
    const book = chapters.map(item => item.content).join('\n')
    if (book.indexOf(plant.sentence) !== book.lastIndexOf(plant.sentence)) throw new Error('植入句在全书重复：' + plant.key)
  }
  const time = new Date(BASE_TIME).toISOString()
  const novel: Novel = {
    id: LONGFORM_NOVEL_ID, title: '雾港旧案（长篇评估合成稿）', genre: 'mystery', subGenre: 'historical', genreLabel: '悬疑', subGenreLabel: '古代',
    tags: ['长篇评估'], targetWordCountMin: 10, targetWordCountMax: 100, currentWordCount: chapters.reduce((sum, item) => sum + item.wordCount, 0),
    writingStyle: { narrativePov: '第三人称', toneStyle: '平实', descriptionDensity: '中', dialogueStyle: '自然', combatStyle: '克制', pacingControl: '稳定', emotionExpression: '细腻' },
    writingMode: 'manual',
    settings: {
      protagonist: { name: '沈砚', gender: '男', age: '二十二', background: '港城账房学徒', personality: ['谨慎'], initialPower: '无', cheatDescription: '', romanceTendency: '' },
      supportingCharacters: [],
      worldBuilding: { worldType: '架空古代港城', worldScale: '一城', socialStructure: '州府', techLevel: '古代', specialRules: '' },
      powerSystem: { systemName: '无', levelHierarchy: '', combatStyleDesc: '', auxiliarySystems: '' },
      coreConflict: { mainConflict: '追查父亲旧案', mainVillain: '', factionConflicts: '', coreSuspense: '' },
      romance: { romanceType: '', developmentPace: '', toneChanges: '', emotionalConflict: '' },
      payoff: { faceSlapFrequency: '', levelUpPace: '', patterns: [] },
      structure: { foreshadowingDensity: '中' },
      otherSettings: '',
    },
    outline: '', synopsis: '', volumes: [], chapters,
    characters: [character(CAST.shenYan, '沈砚'), character(CAST.guTinglan, '顾听澜', ['顾先生']), character(CAST.guXingzhou, '顾行舟', ['顾先生']),
      character(CAST.baiLu, '白鹭'), character(CAST.liuZhao, '柳昭'), character(CAST.shenBoheng, '沈伯衡')],
    chatHistory: [], inspirationHistory: [], knowledgeBaseIds: [], eventLog: [], storyArcs: [], chapterPlans: [], storyStateProposals: [],
    dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: time, updatedAt: time,
  }
  return { novel, chapterOf, reviewCaseChapters }
}

/**
 * Builds the corpus and confirms every planted fact through the product path.
 * linked=true confirms later K1 stages as author "link to existing proposition" decisions.
 */
export function buildLongformFixture(scale: LongformScale = 'default', options: { linked?: boolean } = {}): LongformFixture {
  const linked = options.linked !== false
  const { novel, chapterOf, reviewCaseChapters } = buildNovel(scale)
  const records: CanonMutationRecord[] = []
  // One live aggregate: transactions may replace workspace.candidates with a new array.
  const aggregate = { novel, workspace: { candidates: [] as CandidateChange[], reviewFindings: [], chapterReviews: [], aiRuns: [],
    canonMutations: records, impactReports: [] } } as unknown as StoryAggregate
  const eventIdOf: Record<string, string> = {}, recordIdOf: Record<string, string> = {}, expectedRejections: Record<string, string> = {}
  let tick = 0
  const nextTime = () => new Date(BASE_TIME + (++tick) * 1000).toISOString()
  const ordered = [...PLANTS].sort((a, b) => chapterOf[a.key] - chapterOf[b.key])
  // Pass 1: events, knowledge and relationships in story order.
  for (const plant of ordered) {
    if (!['event', 'knowledge', 'relationship'].includes(plant.kind)) continue
    const chapter = novel.chapters[chapterOf[plant.key]]
    const version = buildAnalysisSourceVersionId(chapter.content)
    const payload = plant.kind === 'event' ? { events: [{ ...plant.payload, evidence: plant.sentence }] }
      : plant.kind === 'knowledge' ? { knowledgeChanges: [{ ...plant.payload, evidence: plant.sentence }] }
        : { relationshipChanges: [{ ...plant.payload, evidence: plant.sentence }] }
    const [candidate] = buildChapterAnalysisCandidates(novel, chapter, version, payload)
    if (!candidate?.evidence.length) throw new Error('植入事实没有生成带证据的候选：' + plant.key)
    const now = nextTime()
    let decision: CharacterMemoryAuthorDecision | undefined
    if (linked && (plant.key === 'k1b' || plant.key === 'k1c')) {
      const first = records.find(record => record.id === recordIdOf.k1a)!.characterState!.after as { factId: string }
      const catalog = getPropositionCatalog(novel, records, chapter.chapterIndex, 'through')
      const target = catalog.find(entry => entry.proposition.id === first.factId)
      if (!target) throw new Error('评估夹具找不到 K1 第一阶段命题')
      decision = { action: 'link', confirmed: true, targetId: target.proposition.id, targetSignature: target.signature }
    }
    const accepted = acceptCandidateChange(candidate, now)
    const { record } = applyCandidateChangeToCanon(novel, accepted, now, records, decision)
    aggregate.workspace.candidates.push(accepted); records.push(record)
    if (plant.kind === 'event') eventIdOf[plant.key] = record.targetId!
    else recordIdOf[plant.key] = record.id
  }
  // Pass 2: causality edges through the dedicated author-decision transaction.
  for (const plant of ordered) {
    if (plant.kind !== 'causality') continue
    const chapter = novel.chapters[chapterOf[plant.key]]
    const version = buildAnalysisSourceVersionId(chapter.content)
    const { fromKey, toKey, relation, explanation } = plant.payload as { fromKey: string; toKey: string; relation: string; explanation: string }
    const [candidate] = buildChapterAnalysisCandidates(novel, chapter, version, { eventCausalityChanges: [{
      fromEventId: eventIdOf[fromKey], toEventId: eventIdOf[toKey], relation, explanation, evidence: plant.sentence }] })
    const proposal: CandidateChange = { ...candidate, id: candidate.id + ':' + plant.key }
    aggregate.workspace.candidates.push(proposal)
    const draft = eventCausalityDraftFromCandidate(proposal)
    try {
      const record = commitEventCausality(aggregate, { draft, openBaseline: captureEventCausalityBaseline(novel, records), candidateId: proposal.id,
        expectedCandidate: JSON.stringify(proposal) }, nextTime(), () => 'lf-' + plant.key + '-' + tick)
      recordIdOf[plant.key] = record.id
    } catch (error) {
      if (plant.key !== 'cloop') throw error
      expectedRejections[plant.key] = error instanceof Error ? error.message : String(error)
    }
  }
  const totalCharacters = novel.chapters.reduce((sum, chapter) => sum + chapter.content.length, 0)
  const candidates = aggregate.workspace.candidates
  return { scale, novel, records, candidates, chapterOf, eventIdOf, recordIdOf, reviewCaseChapters, linked, totalCharacters, expectedRejections }
}

export function cloneLongformFixture(fixture: LongformFixture): LongformFixture {
  return { ...clone(fixture), novel: clone(fixture.novel) }
}
