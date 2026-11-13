import { createProjectBackup, type ProjectWorkspaceSnapshot } from '@/services/projectBackup'
import type { Novel, ChapterRevision } from '@/types/novel'
import type { KnowledgeBase } from '@/stores/knowledge'
import type { InspirationSession } from '@/services/inspirationSessions'
import { createEmptyCreationDraft } from '@/types/reconstruction'

export function emptyProjectWorkspace(novelId: string): ProjectWorkspaceSnapshot {
  return { novelId, candidates: [], reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations: [] }
}

export function plannedProjectWorkspace(novel: Novel): ProjectWorkspaceSnapshot {
  const creationDraft = createEmptyCreationDraft({ id: novel.id + ':draft', now: novel.updatedAt })
  creationDraft.contract.title = '作者确认的作品契约'
  creationDraft.skeletons = [{ id: novel.id + ':skeleton', title: '故事方向', premise: '开端', logline: '主线', promise: '解谜', ending: '揭晓',
    beats: [], approval: 'approved', updatedAt: novel.updatedAt }]
  creationDraft.selectedSkeletonId = creationDraft.skeletons[0].id
  creationDraft.volumes = [{ id: novel.id + ':volume', title: '第一卷', objective: '寻找线索', conflict: '阻力', openingState: '未知', endingState: '发现线索',
    chapterPlanIds: [novel.id + ':plan'], plotlineIds: [], approval: 'approved' }]
  creationDraft.chapterPlans = [{ id: novel.id + ':plan', volumeId: creationDraft.volumes[0].id, number: 0, title: '开场', objective: '得到线索', conflict: '追兵',
    openingState: '逃亡', endingState: '藏身', requiredEvents: [], prohibitedReveals: ['谜底'], characterChangeNotes: [], foreshadowingIds: [],
    scenePlanIds: [novel.id + ':scene'], status: 'planned', approval: 'approved' }]
  creationDraft.scenePlans = [{ id: novel.id + ':scene', chapterPlanId: creationDraft.chapterPlans[0].id, order: 1, title: '雨夜', purpose: '获得钥匙',
    requiredActions: ['追逐'], informationChanges: ['得知暗号'], outputState: '到达藏身处', status: 'planned', approval: 'approved' }]
  return { ...emptyProjectWorkspace(novel.id), creationDraft,
    aiRuns: [{ id: novel.id + ':run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 2,
      tokenBudget: 10000, usedTokens: 340, status: 'needs_author', checkpoint: 'chapter-1:review-needs-author', createdAt: novel.createdAt, updatedAt: novel.updatedAt }] }
}

/** Test-only helper: these fixtures intentionally start with empty V2 state. */
export function createTestProjectBackup(novels: Novel[], knowledgeBases: KnowledgeBase[], chapterRevisions: ChapterRevision[] = [],
  inspirationSessions: InspirationSession[] = [], reconstructionWorkspaces = novels.map(novel => emptyProjectWorkspace(novel.id))) {
  return createProjectBackup({ novels, knowledgeBases, chapterRevisions, inspirationSessions, reconstructionWorkspaces })
}
