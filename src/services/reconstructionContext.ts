import { formatArcDesign } from './storyArcEditing'
import { getCurrentChapterSummary } from '@/services/derivedSources'
import { withCurrentStoryEntities } from './effectiveStory'
import type { Chapter, Novel } from '@/types/novel'
import type { CanonMutationRecord, ContextPack, CreationDraft, EvidenceRef } from '@/types/reconstruction'
import { formatApprovedPlanning, getApprovedPlanning } from './reconstructionPlanning'
import { formatCharacterStateContext } from './reconstructionCharacterState'

export interface ReconstructionContextOptions {
  targetType?: ContextPack['targetType']
  targetId?: string
  authorInstruction?: string
  tokenBudget?: number
  creationDraft?: CreationDraft
  canonMutations?: CanonMutationRecord[]
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function limit(values: string[], count: number): string[] {
  return unique(values).slice(0, count)
}

function chapterLabel(chapter: Chapter): string {
  return '第' + (chapter.chapterIndex + 1) + '章 ' + chapter.title
}

function buildEvidence(chapters: Chapter[], chapterIndex: number, limitCount: number): EvidenceRef[] {
  return chapters
    .filter(chapter => chapter.chapterIndex < chapterIndex && getCurrentChapterSummary(chapter))
    .sort((a, b) => b.chapterIndex - a.chapterIndex)
    .slice(0, limitCount)
    .map(chapter => ({
      id: 'context-evidence:' + chapter.id,
      sourceType: 'chapter' as const,
      sourceId: chapter.id,
      sourceVersionId: chapter.summarySource!.sourceVersionId,
      label: chapterLabel(chapter),
    }))
}

export function buildReconstructionContextPack(
  novel: Novel,
  chapter?: Chapter,
  options: ReconstructionContextOptions = {},
): ContextPack {
  const chapterIndex = chapter?.chapterIndex ?? Number.MAX_SAFE_INTEGER
  novel = withCurrentStoryEntities(novel, chapterIndex)
  const planning = getApprovedPlanning(options.creationDraft, chapterIndex, novel)
  const chapterText = [chapter?.title, chapter ? getCurrentChapterSummary(chapter) : '', chapter?.content?.slice(0, 1200)].filter(Boolean).join('\n')
  const protagonist = novel.settings?.protagonist?.name || ''
  const relevantCharacters = (novel.characters || [])
    .filter(character => character.status !== '死亡' || chapterText.includes(character.name))
    .filter(character => !chapterText || character.name === protagonist || chapterText.includes(character.name) || character.firstAppearChapter <= 1)
  const currentVolume = chapter ? novel.volumes?.find(volume => volume.volumeIndex === chapter.volumeIndex) : undefined
  const currentPlans = (novel.chapterPlans || [])
    .filter(plan => plan.targetChapterStart <= chapterIndex && plan.targetChapterEnd >= chapterIndex)
  const recentEvents = (novel.eventLog || [])
    .filter(event => event.chapterIndex < chapterIndex && event.status !== 'abandoned')
    .sort((a, b) => (b.updatedAt || b.timestamp).localeCompare(a.updatedAt || a.timestamp))
    .slice(0, 10)
  const activeArcs = (novel.storyArcs || []).filter(arc => arc.status === 'active' || arc.status === 'paused')
  const openForeshadowing = (novel.eventLog || [])
    .filter(event => event.type === '伏笔' && event.chapterIndex < chapterIndex && event.status !== 'resolved' && event.status !== 'abandoned' && event.status !== 'unverified')
  const hardRules = [
    ...(planning?.contract.worldRules || []).map(rule => '作者确认的世界规则：' + rule),
    ...(planning?.contract.forbiddenTopics || []).map(rule => '禁用内容：' + rule),
    !planning && novel.settings?.worldBuilding?.specialRules ? '世界规则：' + novel.settings.worldBuilding.specialRules : '',
    planning?.contract.centralConflict ? '主线冲突：' + planning.contract.centralConflict
      : novel.settings?.coreConflict?.mainConflict ? '主线冲突：' + novel.settings.coreConflict.mainConflict : '',
    '已确认的角色状态、事件顺序、时间线和伏笔状态必须以 Canon 为准。',
    '没有正文证据或作者确认的推断只能作为候选，不能当作既定事实。',
  ].filter(Boolean)
  const currentPlan = [
    formatApprovedPlanning(options.creationDraft, chapterIndex, novel),
    currentVolume ? '当前卷：' + currentVolume.title + '；目标：' + (currentVolume.summary || '未填写') + '；转折：' + (currentVolume.keyTurningPoints || '未填写') : '',
    ...(!options.creationDraft ? currentPlans.map(plan => '章节计划：' + plan.title + '；目标：' + plan.objective + '；' + (plan.summary || '')) : []),
    ...activeArcs.slice(0, 8).map(arc => '剧情线：' + arc.title + '（' + arc.status + '）' + (arc.description ? '；' + arc.description : '') + '；' + formatArcDesign(arc)
      + [...arc.nodes].sort((left, right) => Math.abs(left.targetChapter - chapterIndex) - Math.abs(right.targetChapter - chapterIndex)).slice(0, 6)
        .map(node => '；里程碑「' + node.title + '」：' + node.status + '，预计第' + (node.targetChapter + 1) + '章'
        + (node.status === 'completed' && node.actualChapter !== undefined ? '，确认发生于第' + (node.actualChapter + 1) + '章' : '')
        + (node.prerequisiteNodeIds?.length ? '，前置节点 ID：' + node.prerequisiteNodeIds.join('、') : '')).join('')),
  ].filter(Boolean)
  const protagonistId = relevantCharacters.find(character => character.name === protagonist)?.id || ''
  const relevantEntityIds = limit([protagonistId, ...relevantCharacters.map(character => character.id)], 16)
  return {
    id: 'context-pack:' + novel.id + ':' + (options.targetType || 'chapter') + ':' + (options.targetId || chapter?.id || 'book'),
    targetType: options.targetType || 'chapter',
    targetId: options.targetId || chapter?.id,
    hardRules: limit(hardRules, 12),
    currentPlan: limit(currentPlan, 24),
    relevantEntityIds: limit(relevantEntityIds, 16),
    relevantEventIds: limit(recentEvents.map(event => event.id), 12),
    relevantPlotlineIds: limit(activeArcs.map(arc => arc.id), 10),
    relevantForeshadowingIds: limit(openForeshadowing.map(event => event.id), 10),
    evidence: buildEvidence(novel.chapters || [], chapterIndex, 8),
    authorInstruction: options.authorInstruction,
    tokenBudget: options.tokenBudget,
    characterState: formatCharacterStateContext(novel, options.canonMutations || [], chapterIndex),
  }
}

export function formatReconstructionContextPack(pack: ContextPack): string {
  return [
    'Pack ID：' + pack.id,
    pack.characterState || '',
    pack.hardRules.length ? '硬规则：\n' + pack.hardRules.map(rule => '- ' + rule).join('\n') : '',
    pack.currentPlan.length ? '当前计划：\n' + pack.currentPlan.map(item => '- ' + item).join('\n') : '',
    pack.relevantEntityIds.length ? '相关实体 ID：' + pack.relevantEntityIds.join('、') : '',
    pack.relevantEventIds.length ? '相关事件 ID：' + pack.relevantEventIds.join('、') : '',
    pack.relevantPlotlineIds.length ? '相关剧情线 ID：' + pack.relevantPlotlineIds.join('、') : '',
    pack.relevantForeshadowingIds.length ? '未回收伏笔 ID：' + pack.relevantForeshadowingIds.join('、') : '',
    pack.evidence.length ? '证据来源：' + pack.evidence.map(item => item.label || item.sourceId).join('、') : '',
    pack.authorInstruction ? '作者指令：' + pack.authorInstruction : '',
  ].filter(Boolean).join('\n\n')
}
