import type { CandidateChange, EvidenceRef } from '@/types/reconstruction'
import type { Chapter, Novel } from '@/types/novel'
import { assertEventCausalityPayload } from './eventCausalityValidation'

export interface ChapterAnalysisCandidatePayload {
  events?: Array<Record<string, any>>
  characters?: Array<Record<string, any>>
  globalPlans?: Array<Record<string, any>>
  eventCausalityChanges?: Array<Record<string, unknown>>
  timeAdvanceDays?: number
  knowledgeChanges?: Array<Record<string, any>>
  relationshipChanges?: Array<Record<string, any>>
}

export function isCompleteChapterAnalysis(value: ChapterAnalysisCandidatePayload | null): value is ChapterAnalysisCandidatePayload {
  return !!value && [value.events, value.characters, value.knowledgeChanges, value.relationshipChanges]
    .every(items => Array.isArray(items) && items.every(item => !!item && typeof item === 'object' && !Array.isArray(item)))
    && isEventCausalityExtraction(value.eventCausalityChanges)
}

/** Optional for older responses; malformed provided arrays must never reach candidate construction. */
export function isEventCausalityExtraction(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  for (const row of value) {
    try { assertEventCausalityPayload(row) } catch { return false }
    const evidence = (row as Record<string, unknown>).evidence
    if (evidence !== undefined && typeof evidence !== 'string') return false
  }
  return true
}

export function buildAnalysisSourceVersionId(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return 'content:' + (hash >>> 0).toString(16) + ':' + content.length
}

function evidenceFor(
  chapter: Chapter,
  sourceVersionId: string,
  quote: unknown,
  id: string,
): EvidenceRef[] {
  const text = String(quote || '').trim()
  if (!text || !chapter.content.includes(text)) return []
  const startOffset = chapter.content.indexOf(text)
  if (startOffset !== chapter.content.lastIndexOf(text)) return []
  return [{
    id,
    sourceType: 'chapter',
    sourceId: chapter.id,
    sourceVersionId,
    quote: text,
    startOffset,
    endOffset: startOffset + text.length,
    label: '第 ' + (chapter.chapterIndex + 1) + ' 章正文证据',
  }]
}

function makeCandidate(input: {
  novel: Novel
  chapter: Chapter
  id: string
  sourceVersionId: string
  type: CandidateChange['type']
  proposedValue: string
  evidenceQuote?: unknown
  targetId?: string
}): CandidateChange {
  const now = new Date().toISOString()
  const evidence = evidenceFor(input.chapter, input.sourceVersionId, input.evidenceQuote, input.id + ':evidence')
  if ((input.type === 'knowledge' || input.type === 'relationship') && evidence.some(item =>
    input.chapter.content.indexOf(item.quote!) !== input.chapter.content.lastIndexOf(item.quote!))) evidence.length = 0
  return {
    id: input.id,
    novelId: input.novel.id,
    chapterId: input.chapter.id,
    type: input.type,
    targetId: input.targetId,
    sourceVersionId: input.sourceVersionId,
    proposedValue: input.proposedValue,
    evidence,
    status: 'proposed',
    source: 'ai',
    confidence: evidence.length ? 'confirmed' : 'uncertain',
    createdAt: now,
    updatedAt: now,
  }
}

export function buildChapterAnalysisCandidates(
  novel: Novel,
  chapter: Chapter,
  sourceVersionId: string,
  payload: ChapterAnalysisCandidatePayload,
): CandidateChange[] {
  if (!isEventCausalityExtraction(payload.eventCausalityChanges)) throw new Error('事件因果提取格式无效，未保存本次分析。')
  const candidates: CandidateChange[] = []

  // 候选变化属于某一次正文分析。把正文版本放进 ID，避免同一章节改稿后
  // 新分析被旧候选的 ID 去重逻辑吞掉，也方便追踪候选来自哪一版正文。
  const candidateId = (kind: string, index: number | string) =>
    chapter.id + ':analysis:' + sourceVersionId + ':' + kind + ':' + index

  for (const [index, event] of (payload.events || []).entries()) {
    const type = event.type === '伏笔' ? 'foreshadowing' : 'fact'
    candidates.push(makeCandidate({
      id: candidateId('event', index),
      novel,
      chapter,
      sourceVersionId,
      type,
      proposedValue: JSON.stringify({
        title: event.title || '未命名事件',
        description: event.description || '',
        characters: Array.isArray(event.characters) ? event.characters : [],
        eventType: event.type || '其他',
        status: event.status,
      }),
      evidenceQuote: event.evidence,
    }))
  }

  for (const [index, character] of (payload.characters || []).entries()) {
    if (!character.name) continue
    candidates.push(makeCandidate({
      id: candidateId('character', index),
      novel,
      chapter,
      sourceVersionId,
      type: 'fact',
      proposedValue: JSON.stringify({
        kind: 'character',
        name: character.name,
        identity: character.identity || '',
        personality: character.personality || '',
        powerLevel: character.powerLevel || '',
        faction: character.faction || '',
        description: character.description || '',
        firstAppearChapter: chapter.chapterIndex,
      }),
      evidenceQuote: character.evidence || character.description,
    }))
  }

  for (const [index, update] of (payload.globalPlans || []).entries()) {
    if (!update.id || !['developing', 'resolved'].includes(update.status)) continue
    candidates.push(makeCandidate({
      id: candidateId('plotline', index),
      novel,
      chapter,
      sourceVersionId,
      type: 'plotline',
      targetId: String(update.id),
      proposedValue: JSON.stringify({ status: update.status, note: update.note || '' }),
      evidenceQuote: update.evidence,
    }))
  }

  for (const knowledge of payload.knowledgeChanges || []) {
    const proposedValue = JSON.stringify({ characterId: knowledge.characterId, characterName: knowledge.characterName,
      factId: knowledge.factId, fact: knowledge.fact, subjectId: knowledge.subjectId, objectId: knowledge.objectId, scope: knowledge.scope,
      state: knowledge.state, belief: knowledge.belief, learnedFrom: knowledge.learnedFrom })
    candidates.push(makeCandidate({
      id: candidateId('knowledge', buildAnalysisSourceVersionId(proposedValue + String(knowledge.evidence || ''))), novel, chapter, sourceVersionId, type: 'knowledge',
      targetId: knowledge.characterId,
      proposedValue,
      evidenceQuote: knowledge.evidence,
    }))
  }
  for (const relation of payload.relationshipChanges || []) {
    const proposedValue = JSON.stringify({ characterId: relation.characterId, characterName: relation.characterName,
      targetCharacterId: relation.targetCharacterId, targetCharacterName: relation.targetCharacterName,
      relation: relation.relation, dimension: relation.dimension, description: relation.description })
    candidates.push(makeCandidate({
      id: candidateId('relationship', buildAnalysisSourceVersionId(proposedValue + String(relation.evidence || ''))), novel, chapter, sourceVersionId, type: 'relationship',
      targetId: relation.characterId,
      proposedValue,
      evidenceQuote: relation.evidence,
    }))
  }

  for (const [index, edge] of (payload.eventCausalityChanges || []).entries()) {
    const proposedValue = JSON.stringify({ fromEventId:edge.fromEventId, toEventId:edge.toEventId, relation:edge.relation, explanation:edge.explanation })
    const candidate = makeCandidate({ id:candidateId('event_causality',index), novel, chapter, sourceVersionId, type:'event_causality', proposedValue, evidenceQuote:edge.evidence })
    candidate.confidence = candidate.evidence.length ? 'probable' : 'uncertain'
    candidates.push(candidate)
  }
  const elapsedDays = Math.max(0, Number(payload.timeAdvanceDays) || 0)
  if (elapsedDays > 0 && chapter.storyDay === undefined) {
    candidates.push(makeCandidate({
      id: candidateId('timeline', 0),
      novel,
      chapter,
      sourceVersionId,
      type: 'timeline',
      proposedValue: JSON.stringify({ elapsedDays, chapterIndex: chapter.chapterIndex }),
      evidenceQuote: chapter.content.slice(0, Math.min(chapter.content.length, 120)),
    }))
  }

  return candidates
}
