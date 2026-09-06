import type { ChapterPlan, PlanningVersion, Volume } from '@/types/novel'

export interface PlanningDiff {
  field: string
  before: string
  after: string
}

const VERSION_LIMIT = 12

export function createPlanningSnapshot(value: ChapterPlan | Volume): string {
  if ('horizon' in value) {
    return JSON.stringify({
      horizon: value.horizon,
      title: value.title,
      objective: value.objective,
      summary: value.summary,
      beats: value.beats,
      targetChapterStart: value.targetChapterStart,
      targetChapterEnd: value.targetChapterEnd,
      relatedArcIds: value.relatedArcIds,
      relatedEventIds: value.relatedEventIds,
      status: value.status,
    })
  }
  return JSON.stringify({
    volumeIndex: value.volumeIndex,
    title: value.title,
    theme: value.theme,
    summary: value.summary,
    keyTurningPoints: value.keyTurningPoints,
    characterChanges: value.characterChanges,
    estimatedChapters: value.estimatedChapters,
    estimatedWordCount: value.estimatedWordCount,
  })
}

export function appendPlanningVersion(
  versions: PlanningVersion[] | undefined,
  snapshot: string,
  label: string,
  savedAt = new Date().toISOString(),
): PlanningVersion[] {
  const previous = versions || []
  if (previous[previous.length - 1]?.snapshot === snapshot) return previous
  return [...previous, {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || '编辑前版本',
    savedAt,
    snapshot,
  }].slice(-VERSION_LIMIT)
}

function parseSnapshot(snapshot: string): Record<string, unknown> {
  try {
    const value = JSON.parse(snapshot)
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function comparePlanningVersions(before: PlanningVersion | undefined, current: ChapterPlan | Volume): PlanningDiff[] {
  if (!before) return []
  const previous = parseSnapshot(before.snapshot)
  const next = parseSnapshot(createPlanningSnapshot(current))
  const labels: Record<string, string> = {
    title: '标题', objective: '阶段目标', summary: '剧情概要', beats: '写作节拍',
    targetChapterStart: '开始章节', targetChapterEnd: '结束章节', horizon: '计划层级',
    theme: '主题', keyTurningPoints: '关键转折点', characterChanges: '角色变化',
    estimatedChapters: '预估章节', estimatedWordCount: '预估字数', status: '状态',
  }
  return Object.keys({ ...previous, ...next })
    .filter(key => key !== 'relatedArcIds' && key !== 'relatedEventIds' && JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .map(key => ({
      field: labels[key] || key,
      before: formatDiffValue(previous[key]),
      after: formatDiffValue(next[key]),
    }))
}

function formatDiffValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('、')
  if (value === undefined || value === null || value === '') return '未填写'
  return String(value)
}

export function createLocalChapterPlanRefresh(plan: ChapterPlan, chapterIndex: number): Partial<ChapterPlan> {
  const nextChapter = Math.max(chapterIndex, plan.targetChapterStart)
  return {
    title: `第 ${nextChapter + 1} 章：${plan.title.replace(/^第\s*\d+\s*章[：:]?\s*/, '').slice(0, 80)}`,
    objective: plan.objective,
    summary: `承接「${plan.title}」：${plan.summary}`.slice(0, 1200),
    targetChapterStart: nextChapter,
    targetChapterEnd: nextChapter,
    horizon: 'next',
    status: 'planned',
  }
}
