import type { Chapter, EventLogEntry, Novel, StoryArc, Volume } from '@/types/novel'
import type { CandidateChange, CanonMutationRecord } from '@/types/reconstruction'
import { buildLongformFixture } from './longformEvalFixture'

export const V3_DENSE_VISUAL_CHAPTER_COUNT = 64
export const V3_DENSE_VISUAL_STALE_CHAPTERS = [15, 35, 55] as const
const FIXTURE_TIME = '2026-11-11T00:00:00.000Z'

export interface V3DenseVisualFixture {
  novel: Novel
  candidates: CandidateChange[]
  records: CanonMutationRecord[]
  staleChapterIds: string[]
}

function buildVolumes(): Volume[] {
  const titles = [
    ['潮生旧案', '雾港初查，账册与失踪的铜钥匙指向同一场旧火。'],
    ['暗纹来客', '追查扩大到盐仓与镇海司，盟友之间仍各有隐瞒。'],
    ['潮音回响', '旧案线索逐步汇合，白鹭的身世与沉船传闻浮出水面。'],
    ['城门将开', '作者尚未确认终局走向，本卷只保留规划中的收束节点。'],
  ]
  return titles.map(([title, summary], volumeIndex) => ({
    id: 'v3-dense-volume-' + volumeIndex,
    volumeIndex,
    title,
    theme: ['线索初现', '信任试探', '旧事回响', '待定收束'][volumeIndex],
    summary,
    keyTurningPoints: '从当前证据推进，不把计划节点标作已发生。',
    characterChanges: '沈砚逐步调整对同伴的判断。',
    estimatedChapters: 16,
    estimatedWordCount: 8,
  }))
}

function buildArcs(): StoryArc[] {
  const definitions = [
    { id: 'salt-case', title: '盐仓旧案', type: 'main' as const, characters: ['lf-shen-yan', 'lf-gu-tinglan'], targets: [9, 24, 46] },
    { id: 'white-heron', title: '白鹭身世', type: 'character' as const, characters: ['lf-bai-lu'], targets: [22, 39, 58] },
    { id: 'tide-stone', title: '潮音石传闻', type: 'mystery' as const, characters: ['lf-shen-yan', 'lf-liu-zhao'], targets: [31, 45, 61] },
    { id: 'ledger-trust', title: '账房与暗纹', type: 'relationship' as const, characters: ['lf-shen-yan', 'lf-gu-tinglan'], targets: [14, 33, 53] },
  ]
  return definitions.map(definition => ({
    id: 'v3-dense-arc-' + definition.id,
    title: definition.title,
    description: '围绕合成评估正文持续展开的规划线。',
    type: definition.type,
    importance: 4,
    status: 'active',
    reactivateAt: '',
    characterIds: definition.characters,
    goal: '沿章节证据逐步推进，保留尚未解决的问题。',
    conflict: '线索不完整，人物掌握的信息并不相同。',
    expectedResolution: '待后续章节与作者确认。',
    nodes: definition.targets.map((targetChapter, index) => ({
      id: 'v3-dense-node-' + definition.id + '-' + index,
      title: ['发现线索', '关系转折', '阶段收束'][index],
      description: '计划节点，尚无正文依据。',
      targetChapter,
      status: 'pending' as const,
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    })),
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }))
}

function buildForeshadowings(): EventLogEntry[] {
  const definitions = [
    { id: 'brass-key', title: '鹤纹铜钥匙', chapterIndex: 4, lastProgressChapterIndex: 18, targetChapter: 42, status: 'developing' as const },
    { id: 'tide-stone', title: '潮音石鸣响', chapterIndex: 8, lastProgressChapterIndex: 29, targetChapter: 51, status: 'developing' as const },
    { id: 'white-heron-scar', title: '白鹭腕上的旧疤', chapterIndex: 12, lastProgressChapterIndex: 43, targetChapter: 58, status: 'developing' as const },
    { id: 'burned-ledger', title: '盐仓火场的残账', chapterIndex: 17, lastProgressChapterIndex: 37, targetChapter: 49, status: 'developing' as const },
    { id: 'ship-bell', title: '沉船里的铜铃', chapterIndex: 25, lastProgressChapterIndex: 38, targetChapter: 55, status: 'developing' as const },
    { id: 'old-seal', title: '旧印泥上的双纹', chapterIndex: 32, lastProgressChapterIndex: 48, targetChapter: 60, status: 'developing' as const },
    { id: 'resolved-rope', title: '东码头断缆之谜', chapterIndex: 3, lastProgressChapterIndex: 11, targetChapter: 20, resolvedChapterIndex: 20, status: 'resolved' as const },
  ]
  return definitions.map(item => ({
    ...item,
    description: '按正文记录埋设、最近推进和计划回收位置。',
    type: '伏笔' as const,
    characters: [],
    hintCount: item.status === 'resolved' ? 3 : 2,
    source: 'user' as const,
    timestamp: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }))
}

function buildAdditionalChapters(start: number, end: number): Chapter[] {
  return Array.from({ length: end - start }, (_, offset) => {
    const chapterIndex = start + offset
    const chapterNumber = chapterIndex + 1
    const content = [
      '第' + chapterNumber + '章，沈砚沿着南城石阶走到旧盐仓，把昨夜记下的账目重新核了一遍。',
      '门口的守灯人没有回答他的询问，只把一盏收进纸罩的灯放到窗边。',
      '顾听澜停在廊下等候，袖口暗纹被雨水浸得发深，两人暂时没有提起那封信。',
      '远处潮声渐低，码头上的船工各自收拾绳索，新的线索仍留在未拆封的木匣里。',
    ].join('\n')
    return {
      id: 'lf-chapter-' + chapterIndex,
      volumeIndex: 3,
      chapterIndex,
      title: '第' + chapterNumber + '章 城门前的潮声',
      content,
      summary: '沈砚核对盐仓账目，并将尚未确认的线索留待后续调查。',
      wordCount: content.length,
      status: 'writing',
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
    }
  })
}

/** Enriches a product-path long-form fixture for isolated dense-state screenshots. */
export function buildV3DenseVisualFixture(novelId = 'v3-dense-visual-novel'): V3DenseVisualFixture {
  const base = buildLongformFixture('default')
  const novel = base.novel
  novel.id = novelId
  novel.title = '雾港旧案 · 深层页面合成验收'
  novel.volumes = buildVolumes()
  novel.chapters = [...novel.chapters, ...buildAdditionalChapters(novel.chapters.length, V3_DENSE_VISUAL_CHAPTER_COUNT)]
  novel.storyArcs = buildArcs()
  novel.eventLog = [...novel.eventLog, ...buildForeshadowings()]
  novel.currentWordCount = novel.chapters.reduce((total, chapter) => total + chapter.wordCount, 0)
  for (const chapterIndex of V3_DENSE_VISUAL_STALE_CHAPTERS) {
    const chapter = novel.chapters[chapterIndex]
    chapter.contentReview = '旧正文版本的合成审校记录。'
    chapter.contentReviewSignature = 'stale-visual-signature-' + chapter.id
  }
  return {
    novel,
    candidates: base.candidates.map(candidate => ({ ...candidate, novelId })),
    records: base.records.map(record => ({ ...record, novelId })),
    staleChapterIds: V3_DENSE_VISUAL_STALE_CHAPTERS.map(index => novel.chapters[index].id),
  }
}
