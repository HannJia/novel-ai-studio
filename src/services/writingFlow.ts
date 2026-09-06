import type { Novel } from '@/types/novel'

type WritingFlowStage = 'outline' | 'volumes' | 'chapter_plan' | 'draft' | 'review' | 'complete'

export interface WritingFlowProgress {
  stage: WritingFlowStage
  targetChapterIndex: number
  outlineReady: boolean
  volumesReady: boolean
  chapterPlanReady: boolean
  draftReady: boolean
  chapterComplete: boolean
  issues: string[]
}

export function getWritingFlowProgress(novel: Novel, targetChapterIndex = 0): WritingFlowProgress {
  const outlineReady = Boolean(novel.outline.trim())
  const volumesReady = novel.volumes.length > 0
  const chapterPlanReady = (novel.chapterPlans || []).some(plan =>
    plan.horizon === 'next'
    && plan.status !== 'archived'
    && plan.targetChapterStart <= targetChapterIndex
    && plan.targetChapterEnd >= targetChapterIndex,
  )
  const chapter = novel.chapters.find(item => item.chapterIndex === targetChapterIndex)
  const draftReady = Boolean(chapter?.content.trim())
  const chapterComplete = Boolean(chapter && ['completed', 'reviewed', 'finalized', 'locked'].includes(chapter.status))

  const issues: string[] = []
  if (!outlineReady) issues.push('缺少全书大纲')
  if (!volumesReady) issues.push('缺少分卷规划')
  if (!chapterPlanReady) issues.push(`缺少第 ${targetChapterIndex + 1} 章的下一章计划`)
  if (!draftReady) issues.push(`第 ${targetChapterIndex + 1} 章还没有正文`)

  const stage: WritingFlowStage = !outlineReady
    ? 'outline'
    : !volumesReady
      ? 'volumes'
      : !chapterPlanReady
        ? 'chapter_plan'
        : !draftReady
          ? 'draft'
          : !chapterComplete
            ? 'review'
            : 'complete'

  return { stage, targetChapterIndex, outlineReady, volumesReady, chapterPlanReady, draftReady, chapterComplete, issues }
}
