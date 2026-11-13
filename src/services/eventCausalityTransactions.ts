import type { StoryAggregate } from './storyAggregate'
import type { CanonMutationRecord, CandidateChange } from '@/types/reconstruction'
import type { EventCausalityEdit, EventCausalityDraft } from '@/types/eventCausality'
import { captureEventCausalityBaseline, createEventCausalityRevision, eventCausalityLabels } from './eventCausality'
import { captureStoryImpact } from './storyImpactAnalysis'
import { appendStoryImpactReport, invalidateWrittenChapterReviews } from './storyImpactTransactions'
import { assertEventCausalityPayload } from './eventCausalityValidation'
import type { Novel } from '@/types/novel'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

/** Model fields are allowlisted proposal data. No model JSON flag authorizes Canon writes. */
export function eventCausalityDraftFromCandidate(candidate: CandidateChange, editedValue = candidate.proposedValue): EventCausalityDraft {
  if (candidate.type !== 'event_causality' || !candidate.chapterId || !candidate.sourceVersionId?.trim()) throw new Error('因果候选缺少类型、来源章节或正文版本。')
  const value: unknown = JSON.parse(editedValue)
  assertEventCausalityPayload(value)
  const evidence = candidate.evidence[0]
  if (!evidence || evidence.sourceType !== 'chapter' || evidence.sourceId !== candidate.chapterId || evidence.sourceVersionId !== candidate.sourceVersionId) throw new Error('因果候选缺少绑定的章节证据。')
  if (typeof evidence.quote !== 'string' || !evidence.quote.trim() || !Number.isSafeInteger(evidence.startOffset)
    || evidence.startOffset! < 0 || !Number.isSafeInteger(evidence.endOffset)
    || evidence.endOffset! - evidence.startOffset! !== evidence.quote.length) throw new Error('因果候选缺少准确、完整的证据位置。')
  return { edgeId:'event-causality:' + candidate.id, fromEventId:value.fromEventId, toEventId:value.toEventId,
    relation:value.relation, explanation:value.explanation, chapterId:candidate.chapterId,
    quote:evidence.quote, startOffset:evidence.startOffset!, action:'confirm' }
}

export function eventCausalityCandidateHasCurrentEvidence(novel: Novel, candidate: CandidateChange): boolean {
  try {
    const value = eventCausalityDraftFromCandidate(candidate)
    const chapter = novel.chapters.find(c => c.id === value.chapterId)
    return !!chapter && (!candidate.novelId || candidate.novelId === novel.id)
      && candidate.sourceVersionId === buildAnalysisSourceVersionId(chapter.content)
      && chapter.content.indexOf(value.quote) === value.startOffset && chapter.content.lastIndexOf(value.quote) === value.startOffset
      && chapter.content.slice(value.startOffset,value.startOffset+value.quote.length) === value.quote
  } catch { return false }
}

/** Called ONLY inside transactStory, which wraps actual-review-input invalidation and durable SQL/kernel commit. */
export function commitEventCausality(aggregate: StoryAggregate, input: EventCausalityEdit, now: string, id: () => string): CanonMutationRecord {
  const { novel, workspace } = aggregate
  if (!input.openBaseline || input.openBaseline !== captureEventCausalityBaseline(novel,workspace.canonMutations)) throw new Error('正文、事件或因果决定已变化，请保留输入并重新打开核对。')
  const draft = input.draft
  const previous = workspace.canonMutations.filter(r => r.type === 'event_causality' && r.targetId === draft.edgeId).slice(-1)[0]
  const chapter = novel.chapters.find(c => c.id === draft.chapterId)
  if (!chapter) throw new Error('来源章节不存在。')
  if (previous?.eventCausality && chapter.chapterIndex < previous.eventCausality.effectiveChapterIndex) throw new Error('修改或撤销不能倒写到上一次决定之前。')
  if (draft.action === 'revoke' && (!previous || previous.eventCausality?.action === 'revoke')) throw new Error('没有可撤销的已确认决定。')
  const candidate = input.candidateId ? workspace.candidates.find(c => c.id === input.candidateId) : undefined
  if (input.candidateId && (!candidate || candidate.type !== 'event_causality' || !['proposed','deferred'].includes(candidate.status)
    || (candidate.novelId !== undefined && candidate.novelId !== novel.id)
    || JSON.stringify(candidate) !== input.expectedCandidate || workspace.canonMutations.some(r => r.candidateId === candidate.id))) throw new Error('候选已变化或已处理，请重新核对。')
  const revision = createEventCausalityRevision(novel,workspace.canonMutations,draft)
  if (candidate && (candidate.chapterId !== draft.chapterId || candidate.sourceVersionId !== revision.evidence.sourceVersionId
    || !candidate.evidence.some(e => e.sourceType === 'chapter' && e.sourceId === draft.chapterId && e.sourceVersionId === revision.evidence.sourceVersionId
      && e.quote === draft.quote && e.startOffset === draft.startOffset && e.endOffset === revision.evidence.endOffset))) throw new Error('候选正文证据已陈旧或不一致。')
  if (previous?.eventCausality && JSON.stringify(previous.eventCausality) === JSON.stringify(revision)) throw new Error('这条边已经确认，未重复保存。')
  const before = captureStoryImpact(novel,workspace)
  const decisionId = id(), candidateId = candidate?.id || 'author-event-causality:' + decisionId
  const value = JSON.stringify({ fromEventId:draft.fromEventId,toEventId:draft.toEventId,relation:draft.relation,explanation:revision.explanation })
  const accepted: CandidateChange = { ...(candidate || { id:candidateId,novelId:novel.id,createdAt:now }), chapterId:draft.chapterId,
    type:'event_causality',targetId:draft.edgeId,sourceVersionId:revision.evidence.sourceVersionId,proposedValue:value,
    ...(candidate && candidate.proposedValue !== value ? { originalProposedValue:candidate.originalProposedValue || candidate.proposedValue } : {}),
    evidence:[{ id:'causal-evidence:' + decisionId,sourceType:'chapter',sourceId:draft.chapterId,sourceVersionId:revision.evidence.sourceVersionId,
      quote:draft.quote,startOffset:draft.startOffset,endOffset:revision.evidence.endOffset }],
    status:candidate && (candidate.originalProposedValue !== undefined || candidate.proposedValue !== value) ? 'edited' : 'accepted',source:candidate?.source || 'author',updatedAt:now }
  if (input.authorNote !== undefined) accepted.authorNote = input.authorNote.trim()
  const record: CanonMutationRecord = { id:'canon-mutation:' + decisionId,candidateId,novelId:novel.id,chapterId:draft.chapterId,type:'event_causality',
    targetId:draft.edgeId,summary:(draft.action === 'revoke' ? '撤销' : '确认') + '事件因果：' + draft.fromEventId + ' → ' + draft.toEventId + '（' + eventCausalityLabels[draft.relation] + '）', appliedAt:now,eventCausality:revision }
  if (candidate) workspace.candidates = workspace.candidates.map(c => c.id === candidate.id ? accepted : c)
  else workspace.candidates.push(accepted)
  workspace.canonMutations.push(record)
  novel.updatedAt = now
  // The aggregate coordinator narrows this registration and the report to actual changed review inputs.
  const reviewIds = invalidateWrittenChapterReviews(aggregate,novel.chapters.filter(c => c.chapterIndex <= revision.effectiveChapterIndex).map(c => c.id))
  appendStoryImpactReport(aggregate,before,[{ target:{ kind:'event',id:draft.fromEventId,label:draft.fromEventId },action:'update',fields:['eventCausality'] },
    { target:{ kind:'event',id:draft.toEventId,label:draft.toEventId },action:'update',fields:['eventCausality'] }],reviewIds,now,() => decisionId,undefined,'changed-inputs')
  return record
}

/** Save author edits/deferral/rejection as a proposal only; no evidence is invented and no Canon is produced. */
export function saveEventCausalityProposal(aggregate: StoryAggregate, input: EventCausalityEdit,
  action: 'save' | 'defer' | 'reject', now: string): CandidateChange {
  const { novel, workspace } = aggregate
  if (!input.openBaseline || input.openBaseline !== captureEventCausalityBaseline(novel,workspace.canonMutations)) throw new Error('来源或正式决定已变化，作者输入已保留，请重新核对。')
  const previous = workspace.candidates.find(c => c.id === input.candidateId)
  if (!previous || previous.type !== 'event_causality' || !['proposed','deferred'].includes(previous.status)
    || JSON.stringify(previous) !== input.expectedCandidate || (previous.novelId && previous.novelId !== novel.id)
    || workspace.canonMutations.some(r => r.candidateId === previous.id)) throw new Error('候选已变化或处理，未覆盖作者记录。')
  const payload = { fromEventId:input.draft.fromEventId,toEventId:input.draft.toEventId,relation:input.draft.relation,explanation:input.draft.explanation.trim() }
  assertEventCausalityPayload(payload)
  const proposedValue = JSON.stringify(payload)
  const result: CandidateChange = { ...previous, proposedValue,
    ...(proposedValue !== previous.proposedValue ? { originalProposedValue:previous.originalProposedValue || previous.proposedValue } : {}),
    authorNote:input.authorNote?.trim() ?? previous.authorNote,
    status:action === 'reject' ? 'rejected' : action === 'defer' ? 'deferred' : previous.status,
    updatedAt:now }
  result.confidence = eventCausalityCandidateHasCurrentEvidence(novel,result) ? 'probable' : 'uncertain'
  workspace.candidates = workspace.candidates.map(c => c.id === result.id ? result : c)
  return result
}
