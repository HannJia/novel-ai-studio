import { useNovelStore } from '@/stores/novel'
import type { Novel } from '@/types/novel'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from '@/services/reconstructionCandidates'

export const stateTestTime = '2026-10-27T05:00:00.000Z'
export function characterStateFixture() {
  const store = useNovelStore()
  const novel = store.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 50, targetWordCountMax: 100,
    settings: store.defaultSettings(), writingStyle: store.defaultWritingStyle() })
  novel.settings.protagonist.name = '林澈'
  novel.characters = ['林澈', '苏禾'].map((name, index) => ({ id: 'person-' + index, name, aliases: [], identity: '', personality: '',
    powerLevel: '', faction: '', description: '', status: '活跃' as const, firstAppearChapter: 0, relationships: [], events: [], avatarColor: '' }))
  for (const [index, content] of ['林澈以为城主已经死了。林澈仍然信任苏禾。', '苏禾向林澈出示书信，城主仍然在世。林澈开始怀疑苏禾。', '林澈在雨中等待。'].entries()) {
    store.addChapter(novel.id, { title: '线索' + index, content })
  }
  return { novel, store }
}
export function knowledgeCandidate(novel: Novel, chapterIndex: number, overrides: Record<string, unknown> = {}) {
  const chapter = novel.chapters[chapterIndex]
  return buildChapterAnalysisCandidates(novel, chapter, buildAnalysisSourceVersionId(chapter.content), { knowledgeChanges: [{
    characterId: 'person-0', characterName: '林澈', fact: '城主仍然在世',
    state: chapterIndex === 0 ? 'false_belief' : 'knows', belief: '城主已经死了',
    learnedFrom: chapterIndex === 0 ? '' : '苏禾出示的书信',
    evidence: chapterIndex === 0 ? '林澈以为城主已经死了。' : '苏禾向林澈出示书信，城主仍然在世。', ...overrides,
  }] })[0]
}
export function relationshipCandidate(novel: Novel, chapterIndex: number, overrides: Record<string, unknown> = {}) {
  const chapter = novel.chapters[chapterIndex]
  return buildChapterAnalysisCandidates(novel, chapter, buildAnalysisSourceVersionId(chapter.content), { relationshipChanges: [{
    characterId: 'person-0', targetCharacterId: 'person-1', relation: chapterIndex === 0 ? '信任' : '怀疑',
    dimension: 'trust',
    evidence: chapterIndex === 0 ? '林澈仍然信任苏禾。' : '林澈开始怀疑苏禾。', ...overrides,
  }] })[0]
}
