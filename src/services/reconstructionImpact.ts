import { getCurrentChapterSummary } from '@/services/derivedSources'
import type { CandidateChange } from '@/types/reconstruction'
import type { Novel } from '@/types/novel'

export type ReconstructionImpactSeverity = 'high' | 'medium' | 'low'

export interface ReconstructionImpactItem {
  chapterId: string
  chapterIndex: number
  title: string
  severity: ReconstructionImpactSeverity
  reasons: string[]
  evidence: string[]
}

export interface ReconstructionImpactReport {
  candidateId: string
  sourceChapterId?: string
  affectedChapterIds: string[]
  items: ReconstructionImpactItem[]
  hasFutureImpact: boolean
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProposedValue(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function collectText(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.length >= 2) result.push(text)
  } else if (Array.isArray(value)) {
    for (const item of value) collectText(item, result)
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectText(item, result)
  }
  return result
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function chapterText(chapter: Novel['chapters'][number]): string {
  return [chapter.title, getCurrentChapterSummary(chapter), chapter.content].filter(Boolean).join('\n')
}

function addImpact(
  impacts: Map<string, ReconstructionImpactItem>,
  chapter: Novel['chapters'][number],
  severity: ReconstructionImpactSeverity,
  reason: string,
  evidence?: string,
) {
  const current = impacts.get(chapter.id)
  if (!current) {
    impacts.set(chapter.id, {
      chapterId: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      severity,
      reasons: [reason],
      evidence: evidence ? [evidence] : [],
    })
    return
  }
  const severityRank: Record<ReconstructionImpactSeverity, number> = { low: 1, medium: 2, high: 3 }
  if (severityRank[severity] > severityRank[current.severity]) current.severity = severity
  if (!current.reasons.includes(reason)) current.reasons.push(reason)
  if (evidence && !current.evidence.includes(evidence)) current.evidence.push(evidence)
}

function chaptersAtIndexes(novel: Novel, indexes: number[]): Novel['chapters'][number][] {
  const wanted = new Set(indexes.filter(index => Number.isInteger(index) && index >= 0))
  return novel.chapters.filter(chapter => wanted.has(chapter.chapterIndex))
}

function chapterIndexForSource(novel: Novel, candidate: CandidateChange): number {
  const sourceChapter = novel.chapters.find(chapter => chapter.id === candidate.chapterId)
  return sourceChapter?.chapterIndex ?? -1
}

export function analyzeCandidateImpact(novel: Novel, candidate: CandidateChange): ReconstructionImpactReport {
  const impacts = new Map<string, ReconstructionImpactItem>()
  const sourceChapterIndex = chapterIndexForSource(novel, candidate)
  const proposed = parseProposedValue(candidate.proposedValue)
  const textTokens = unique([
    ...collectText(proposed),
    ...(proposed ? [] : [candidate.proposedValue]),
  ]).flatMap(text => text.split(/[\s\n，。！？、；：,.!?;:《》“”‘’（）()【】\[\]-]+/).filter(token => token.length >= 2))
  const tokens = unique(textTokens).slice(0, 12)

  const sourceChapter = novel.chapters.find(chapter => chapter.id === candidate.chapterId)
  if (sourceChapter) addImpact(impacts, sourceChapter, 'low', '候选变化来自本章正文')

  if (candidate.type === 'timeline' && sourceChapterIndex >= 0) {
    for (const chapter of novel.chapters.filter(item => item.chapterIndex > sourceChapterIndex).slice(0, 60)) {
      addImpact(impacts, chapter, 'high', '时间线变化可能影响后续章节的时间、倒计时或状态推进')
    }
  }

  const targetEvent = candidate.targetId ? novel.eventLog.find(event => event.id === candidate.targetId) : undefined
  if (targetEvent) {
    chaptersAtIndexes(novel, [targetEvent.chapterIndex, targetEvent.targetChapter ?? -1]).forEach(chapter => {
      addImpact(impacts, chapter, 'high', '候选变化直接关联已有故事事件', targetEvent.title)
    })
  }

  const targetArc = candidate.targetId ? (novel.storyArcs || []).find(arc => arc.id === candidate.targetId) : undefined
  if (targetArc) {
    const indexes = [
      ...targetArc.nodes.map(node => node.actualChapter ?? node.targetChapter),
      ...(novel.chapterPlans || []).filter(plan => plan.relatedArcIds.includes(targetArc.id))
        .flatMap(plan => [plan.targetChapterStart, plan.targetChapterEnd]),
    ]
    chaptersAtIndexes(novel, indexes).forEach(chapter => {
      addImpact(impacts, chapter, 'high', '候选变化直接关联剧情线节点或章节计划', targetArc.title)
    })
  }

  for (const chapter of novel.chapters) {
    const text = chapterText(chapter)
    const matched = tokens.filter(token => text.includes(token)).slice(0, 3)
    if (!matched.length) continue
    const severity: ReconstructionImpactSeverity = chapter.chapterIndex > sourceChapterIndex ? 'medium' : 'low'
    addImpact(impacts, chapter, severity, '正文或章节摘要包含候选变化中的相关实体', matched.join('、'))
  }

  if (candidate.type === 'foreshadowing') {
    const title = String(proposed?.title || proposed?.name || '').trim()
    for (const event of novel.eventLog.filter(item => item.type === '伏笔' && (title ? item.title.includes(title) || title.includes(item.title) : true))) {
      chaptersAtIndexes(novel, [event.chapterIndex, event.targetChapter ?? -1]).forEach(chapter => {
        addImpact(impacts, chapter, 'high', '伏笔状态变化可能影响铺垫或回收位置', event.title)
      })
    }
  }

  const items = Array.from(impacts.values())
    .sort((left, right) => left.chapterIndex - right.chapterIndex || left.severity.localeCompare(right.severity))
  const futureItems = items.filter(item => item.chapterIndex > sourceChapterIndex)
  const affectedChapterIds = items.map(item => item.chapterId)
  const summary = futureItems.length
    ? '发现 ' + futureItems.length + ' 个后续章节可能受影响，建议作者确认 Canon 前优先回查。'
    : items.length
      ? '已定位本章相关影响，暂未发现明确的后续章节引用。'
      : '暂未发现可定位的受影响章节。'

  return {
    candidateId: candidate.id,
    sourceChapterId: candidate.chapterId,
    affectedChapterIds,
    items,
    hasFutureImpact: futureItems.length > 0,
    summary,
  }
}
