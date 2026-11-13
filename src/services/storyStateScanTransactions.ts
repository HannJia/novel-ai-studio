import type { StoryStateProposal } from '@/types/novel'
import type { StoryAggregate } from './storyAggregate'
import { captureStoryStateScanBaseline, hasChapterEvidence, normalizeStoryPromiseDrafts, normalizeStoryStateProposalDrafts,
  type StoryStateProposalDraft } from './storyPlanning'
import { storyProposalSourceIsCurrent } from './storyProposalSource'
import { withCurrentStoryEntities } from './effectiveStory'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

export interface StoryStateScanSubmission {
  chapterId: string
  baseline: string
  proposals: StoryStateProposalDraft[]
}

const proposalKey = (proposal: StoryStateProposalDraft) => JSON.stringify([proposal.targetType, proposal.targetId,
  proposal.parentId, proposal.field, proposal.oldValue, proposal.newValue, proposal.reason, proposal.evidence,
  proposal.chapterIndex, proposal.chapterSource, proposal.eventDraft, proposal.source])

export function commitStoryStateScan({ novel }: StoryAggregate, input: StoryStateScanSubmission, now: string): number {
  const chapter = novel.chapters.find(item => item.id === input.chapterId)
  if (!chapter || !['completed', 'reviewed', 'finalized', 'locked'].includes(chapter.status)
    || captureStoryStateScanBaseline(novel, chapter) !== input.baseline) throw new Error('状态扫描的正文或规划依据已变化，请核对后重新扫描。')
  const current = withCurrentStoryEntities(novel, chapter.chapterIndex + 1)
  const proposals = [...(novel.storyStateProposals || [])]
  const identities = new Set(proposals.map(proposalKey))
  let count = 0
  for (const draft of input.proposals) {
    const identity = proposalKey(draft)
    const proposal: StoryStateProposal = { ...draft, id: chapter.id + ':state-scan:' + buildAnalysisSourceVersionId(identity),
      createdAt: now, updatedAt: now, status: 'pending' }
    if (draft.source !== 'ai' || draft.chapterSource?.chapterId !== chapter.id
      || !hasChapterEvidence(chapter.content, draft.evidence) || !storyProposalSourceIsCurrent(novel, proposal)) throw new Error('状态提案缺少当前章节的唯一原文证据。')
    if (identities.has(identity)) continue
    const normalized = draft.field === 'create' && draft.eventDraft
      ? normalizeStoryPromiseDrafts({ ...current, storyStateProposals: [] }, chapter, [{ ...draft.eventDraft,
        targetChapter: draft.eventDraft.targetChapter === undefined ? undefined : draft.eventDraft.targetChapter + 1 }])[0]
      : normalizeStoryStateProposalDrafts(current, chapter, [{ ...draft,
        newValue: draft.field === 'targetChapter' ? Number(draft.newValue) + 1 : draft.newValue }])[0]
    if (!normalized || proposalKey(normalized) !== identity) throw new Error('状态提案的目标、内容或来源不符合当前规划。')
    if (proposals.some(item => item.id === proposal.id)) throw new Error('状态提案编号发生冲突，未覆盖已有记录。')
    proposals.unshift(proposal); identities.add(identity); count++
  }
  if (count) { novel.storyStateProposals = proposals; novel.updatedAt = now }
  return count
}
