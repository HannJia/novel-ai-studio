import type { Novel } from '@/types/novel'
import { projectCanonicalEntities } from './entityProvenance'
import { projectDataPanelReferences } from './dataPanelReference'
import { projectStoryTime, projectStoryTimeTimeline } from './storyTime'

const projectionOrigins = new WeakMap<Novel, Novel>()
export function sourceNovel(novel: Novel): Novel {
  const origin = projectionOrigins.get(novel)
  return origin ? { ...novel, characters: origin.characters, eventLog: origin.eventLog, storyArcs: origin.storyArcs, dataPanels: origin.dataPanels } : novel
}

/** Read-only story view. Never save this projection back to the manuscript. */
export function withCurrentStoryEntities(novel: Novel, beforeChapterIndex?: number): Novel {
  const source = sourceNovel(novel)
  const projected = projectCanonicalEntities(source, beforeChapterIndex)
  const result = { ...novel, characters: projected.characters, eventLog: projected.events, storyArcs: projected.arcs,
    dataPanels: projectDataPanelReferences(source, beforeChapterIndex).items }
  projectionOrigins.set(result, source)
  return result
}

export function formatEntitySourceWarnings(novel: Novel, beforeChapterIndex?: number): string {
  const issues = projectCanonicalEntities(sourceNovel(novel), beforeChapterIndex).issues
  const dataIssues = projectDataPanelReferences(sourceNovel(novel), beforeChapterIndex).issues
  if (!issues.length && !dataIssues.length) return ''
  const labels = [...new Set([...issues.map(issue => issue.label + '：' + issue.reason), ...dataIssues])].slice(0, 12)
  return '【需要作者核对的设定来源】以下资料的相关字段已排除，不能推断旧值仍成立：\n' + labels.map(label => '- ' + label).join('\n')
}

/** Time is projected by chapter boundary just like entities and data panels. */
export function effectiveStoryTime(novel: Novel, chapterId: string) {
  const chapter = novel.chapters.find(item => item.id === chapterId)
  return chapter ? projectStoryTime(novel, chapter) : { known: false, reason: '章节不存在。' }
}

export function effectivePriorStoryTimes(novel: Novel, beforeChapterIndex: number) {
  return projectStoryTimeTimeline(novel, beforeChapterIndex)
}
