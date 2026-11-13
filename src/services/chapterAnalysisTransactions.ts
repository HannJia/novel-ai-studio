import type { Chapter, DataPanelChange, Novel } from '@/types/novel'
import type { CandidateChange, CanonMutationRecord } from '@/types/reconstruction'
import type { StoryAggregate } from './storyAggregate'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { formatCharacterAnalysisReferences, formatCharacterStateContext } from './reconstructionCharacterState'
import { verifyEvidence } from './reconstructionCanon'
import { markCandidateStaleIfSourceChanged } from './reconstructionReview'
import { withCurrentStoryEntities } from './effectiveStory'
import { bindDataPanelProposalSource } from './dataPanelProposalSource'

export type AnalysisDataProposal = Omit<DataPanelChange, 'id' | 'createdAt' | 'status'>
export interface ChapterAnalysisSubmission {
  chapterId: string
  sourceVersionId: string
  baseline: string
  candidates: CandidateChange[]
  dataProposals: AnalysisDataProposal[]
}

export function formatChapterAnalysisPlans(novel: Novel, chapterIndex: number): string {
  return (withCurrentStoryEntities(novel, chapterIndex).eventLog || [])
    .filter(event => event.type === '伏笔' && (event.status === 'planted' || event.status === 'developing'))
    .map(event => '- ID(' + event.id + '): 「' + event.title + '」- 当前状态：' + (event.status === 'planted' ? '已埋下' : '推进中'))
    .join('\n')
}

export function captureChapterAnalysisBaseline(novel: Novel, chapter: Chapter, canon: CanonMutationRecord[] = []): string {
  return JSON.stringify([novel.id, chapter.id, chapter.chapterIndex, chapter.title, chapter.content, chapter.storyDay,
    novel.settings.protagonist.name, novel.dataPanels, novel.eventLog, novel.storyClock,
    formatCharacterAnalysisReferences(novel, chapter.chapterIndex), formatCharacterStateContext(novel, canon, chapter.chapterIndex),
    formatChapterAnalysisPlans(novel, chapter.chapterIndex)])
}

function normalizeCandidateIdentityValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeCandidateIdentityValue)
    return normalized.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))
      ? normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : normalized
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeCandidateIdentityValue(item)]))
  }
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  return value
}

function candidateIdentityValue(candidate: CandidateChange): unknown {
  try { return normalizeCandidateIdentityValue(JSON.parse(candidate.proposedValue)) }
  catch { return normalizeCandidateIdentityValue(candidate.proposedValue) }
}

/**
 * Candidate IDs are tied to a model response's ordering and evidence IDs. The
 * durable identity used for an analysis retry must survive those changes while
 * remaining bound to the same manuscript version. This lets a Canon update
 * change the analysis baseline without re-adding the same author decision.
 */
export function chapterAnalysisCandidateIdentity(candidate: CandidateChange): string {
  return JSON.stringify([
    candidate.novelId,
    candidate.chapterId,
    candidate.type,
    candidate.sourceVersionId,
    candidate.targetId,
    candidateIdentityValue(candidate),
    candidate.evidence
      .map(({ id: _id, label: _label, ...evidence }) => normalizeCandidateIdentityValue(evidence))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  ])
}

/** One AI response becomes pending records only; it never edits formal story facts. */
export function commitChapterAnalysis(aggregate: StoryAggregate, input: ChapterAnalysisSubmission, now: string, id: () => string) {
  const { novel, workspace } = aggregate
  const chapter = novel.chapters.find(item => item.id === input.chapterId)
  if (!chapter || chapter.status === 'locked') throw new Error('分析来源章节不存在或已锁定。')
  if (input.sourceVersionId !== buildAnalysisSourceVersionId(chapter.content)
    || input.baseline !== captureChapterAnalysisBaseline(novel, chapter, workspace.canonMutations)) throw new Error('分析所依据的正文或故事资料已变化，请核对后重新分析。')
  const current = new Map(workspace.candidates.map(candidate => [candidate.id, candidate]))
  const identities = new Set(workspace.candidates
    .filter(candidate => candidate.status !== 'proposed' && candidate.status !== 'stale')
    .map(chapterAnalysisCandidateIdentity))
  const additions: CandidateChange[] = []
  for (const candidate of input.candidates) {
    if (candidate.novelId !== novel.id || candidate.chapterId !== chapter.id || candidate.sourceVersionId !== input.sourceVersionId
      || candidate.status !== 'proposed') throw new Error('故事候选不属于本次章节分析。')
    if (candidate.evidence.length) verifyEvidence(novel, candidate)
    else if (candidate.confidence === 'confirmed') throw new Error('已核实候选缺少正文证据。')
    const previous = current.get(candidate.id), identity = chapterAnalysisCandidateIdentity(candidate)
    if (previous) {
      if (chapterAnalysisCandidateIdentity(previous) !== identity) throw new Error('故事候选编号已有不同内容，未覆盖作者记录。')
      continue
    }
    if (identities.has(identity)) continue
    current.set(candidate.id, candidate); additions.push(candidate)
    identities.add(identity)
  }
  const data = [...(novel.dataPanelChanges || [])], newData: DataPanelChange[] = []
  for (const proposal of input.dataProposals) {
    if (proposal.chapterIndex !== chapter.chapterIndex || !proposal.reason.trim()
      || !chapter.content.replace(/\s/g, '').includes(proposal.reason.replace(/\s/g, ''))) throw new Error('数据提案缺少当前章节的原文依据。')
    const sourceBinding = bindDataPanelProposalSource(novel, chapter, proposal, 'chapter')
    const duplicate = data.some(item => JSON.stringify(item.sourceBinding) === JSON.stringify(sourceBinding) && (proposal.mutation?.kind === 'create' && item.mutation?.kind === 'create'
      ? item.itemName === proposal.itemName && (item.status === 'pending' || item.chapterIndex === proposal.chapterIndex)
      : item.itemId === proposal.itemId && item.fieldId === proposal.fieldId && item.chapterIndex === proposal.chapterIndex))
    if (duplicate) continue
    const change: DataPanelChange = { ...JSON.parse(JSON.stringify(proposal)), sourceBinding, id: id(), createdAt: now, status: 'pending', confidence: proposal.confidence || 'clear' }
    data.unshift(change); newData.push(change)
  }
  let stale = 0
  const candidates = workspace.candidates.map(candidate => {
    if (candidate.chapterId !== chapter.id || !candidate.sourceVersionId || candidate.sourceVersionId === input.sourceVersionId
      || !['proposed', 'deferred'].includes(candidate.status)) return candidate
    stale++; return markCandidateStaleIfSourceChanged(candidate, input.sourceVersionId)
  })
  if (stale || additions.length) workspace.candidates = [...candidates, ...additions]
  if (newData.length) { novel.dataPanelChanges = data; novel.updatedAt = now }
  return { changed: Boolean(stale || additions.length || newData.length), candidates: additions.length, dataChanges: newData.length }
}
