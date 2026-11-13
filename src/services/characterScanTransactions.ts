import type { Novel } from '@/types/novel'
import type { CandidateChange } from '@/types/reconstruction'
import type { StoryAggregate } from './storyAggregate'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { verifyEvidence } from './reconstructionCanon'
import { markCandidateStaleIfSourceChanged } from './reconstructionReview'

/** Keep the scan's prompt selection and its commit baseline together. */
export function characterScanChapters(novel: Novel) {
  return novel.chapters.filter(chapter => chapter.content.length > 100).slice(0, 5)
}

export function captureCharacterScanBaseline(novel: Novel): string {
  return JSON.stringify([novel.id, novel.characters, characterScanChapters(novel)
    .map(chapter => [chapter.id, chapter.chapterIndex, chapter.title, chapter.content])])
}

/** Save proposals only; formal characters and Canon still require author decisions. */
export function saveCharacterScan(aggregate: StoryAggregate, baseline: string, candidates: CandidateChange[]): { added: number; changed: boolean } {
  const { novel, workspace } = aggregate
  if (baseline !== captureCharacterScanBaseline(novel)) throw new Error('扫描所依据的正文或角色资料已变化，请重新扫描并核对。')
  const sourceIds = new Set(characterScanChapters(novel).map(chapter => chapter.id))
  const existing = new Map(workspace.candidates.map(candidate => [candidate.id, candidate]))
  const identity = (candidate: CandidateChange) => JSON.stringify([candidate.novelId, candidate.chapterId, candidate.type,
    candidate.sourceVersionId, candidate.proposedValue, candidate.evidence])
  const additions: CandidateChange[] = []
  for (const candidate of candidates) {
    let value: { kind?: string } | null
    try { value = JSON.parse(candidate.proposedValue) } catch { throw new Error('角色候选格式无效。') }
    if (candidate.novelId !== novel.id || !candidate.chapterId || !sourceIds.has(candidate.chapterId)
      || candidate.type !== 'fact' || candidate.status !== 'proposed' || value?.kind !== 'character') throw new Error('角色候选不属于本次扫描。')
    verifyEvidence(novel, candidate)
    const chapter = novel.chapters.find(item => item.id === candidate.chapterId)!
    if (candidate.evidence.some(evidence => typeof evidence.quote !== 'string' || !chapter.content.slice(0, 1000).includes(evidence.quote)
      || chapter.content.indexOf(evidence.quote) !== chapter.content.lastIndexOf(evidence.quote))) throw new Error('角色候选的引文不在本次扫描范围或无法唯一定位。')
    const previous = existing.get(candidate.id)
    if (previous) {
      if (identity(previous) !== identity(candidate)) throw new Error('角色候选编号已被其他内容使用，未覆盖原记录。')
      continue
    }
    existing.set(candidate.id, candidate); additions.push(candidate)
  }
  let staleCount = 0
  const versions = new Map(characterScanChapters(novel).map(chapter => [chapter.id, buildAnalysisSourceVersionId(chapter.content)]))
  const updated = workspace.candidates.map(candidate => {
    const source = versions.get(candidate.chapterId || '')
    if (!source || !candidate.sourceVersionId || source === candidate.sourceVersionId
      || !['proposed', 'deferred'].includes(candidate.status)) return candidate
    staleCount++
    return markCandidateStaleIfSourceChanged(candidate, source)
  })
  if (additions.length || staleCount) workspace.candidates = [...updated, ...additions]
  return { added: additions.length, changed: Boolean(additions.length || staleCount) }
}
