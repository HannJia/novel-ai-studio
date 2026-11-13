import type { Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { StoryImpactRef } from '@/types/storyImpact'

export function storyImpactLocation(novel: Novel, target: StoryImpactRef, workspace?: Pick<ReconstructionWorkspaceSnapshot, 'creationDraft' | 'storyMemories'>) {
  const params = { novelId: novel.id }
  const planning = (tab: string, query: Record<string, string> = {}) => ({ name: 'WorkspacePlanning', params, query: { tab, ...query } })
  switch (target.kind) {
    case 'novel': return target.id === novel.id ? planning('volumes') : undefined
    case 'volume': return novel.volumes.some(row => row.id === target.id) ? planning('volumes', { volume: target.id }) : undefined
    case 'chapter': return novel.chapters.some(row => row.id === target.id) ? { name: 'WorkspaceEditor', params: { ...params, chapterId: target.id } } : undefined
    case 'character': return novel.characters.some(row => row.id === target.id) ? { name: 'WorkspaceCharacters', params, query: { character: target.id } } : undefined
    case 'event': return novel.eventLog.some(row => row.id === target.id) ? planning('timeline', { event: target.id }) : undefined
    case 'arc': return novel.storyArcs?.some(row => row.id === target.id) ? planning('arcs', { arc: target.id }) : undefined
    case 'node': {
      const arc = novel.storyArcs?.find(row => row.nodes.some(node => node.id === target.id))
      return arc ? planning('arcs', { arc: arc.id }) : undefined
    }
    case 'plan': {
      if (workspace?.creationDraft?.chapterPlans.some(row => row.id === target.id)) return planning('scenes', { plan: target.id })
      return novel.chapterPlans?.some(row => row.id === target.id) ? planning('plans', { plan: target.id }) : undefined
    }
    case 'scene': return workspace?.creationDraft?.scenePlans.some(row => row.id === target.id) ? planning('scenes') : undefined
    case 'memory': return workspace?.storyMemories?.some(row => row.id === target.id) ? planning('memory') : undefined
  }
}
