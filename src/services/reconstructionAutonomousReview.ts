import { callAI, type AiRequestLifecycle, type ChatCompletionResult } from '@/services/ai'
import { withCurrentStoryEntities } from './effectiveStory'
import { buildChapterAnalysisPrompt } from '@/services/prompts'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates, isCompleteChapterAnalysis, type ChapterAnalysisCandidatePayload } from '@/services/reconstructionCandidates'
import type { CandidateChange, CanonMutationRecord, ChapterReview, ReviewFinding } from '@/types/reconstruction'
import { formatCharacterAnalysisReferences, formatCharacterStateContext } from './reconstructionCharacterState'
import { hasBlockingFindings } from '@/services/reconstructionReview'
import type { Chapter, Novel } from '@/types/novel'
import { buildChapterReviewResult, type ChapterReviewInput } from './chapterReviewInput'
import { buildLocalConsistencyReviewBlock } from './chapterLocalReview'
import { parseAiJsonObject } from '@/utils/aiJson'
import type { ModelConfig } from '@/stores/config'
import { buildChapterReviewSourceVersion } from './reconstructionReviewVersion'
import { formatEventCausalityAnalysisReferences } from './eventCausality'

export interface AutonomousStructuredReview {
  review: ChapterReview
  findings: ReviewFinding[]
  candidates: CandidateChange[]
}

export interface AutonomousCandidateExtraction {
  candidates: CandidateChange[]
  usedTokens?: number
  error?: string
}

function formatAnalysisPanels(novel: Novel, chapterIndex: number): string {
  novel = withCurrentStoryEntities(novel, chapterIndex)
  return (novel.dataPanels || []).slice(0, 40).map(item => {
    const fields = (item.fields || []).slice(0, 20).map(field => `${field.name}=${field.value}`).join('；')
    return `- ${item.name}${fields ? `：${fields}` : ''}`
  }).join('\n')
}

function formatActiveGlobalPlans(novel: Novel, beforeChapterIndex: number): string {
  novel = withCurrentStoryEntities(novel, beforeChapterIndex)
  return (novel.eventLog || [])
    .filter(event => event.type === '伏笔' && (event.status === 'planted' || event.status === 'developing'))
    .slice(-40)
    .map(event => `- ID(${event.id})：${event.title}（${event.status}）`)
    .join('\n')
}

function analysisTokenCount(result: ChatCompletionResult, content: string): number {
  return result.usage?.total_tokens || Math.max(1, Math.ceil(content.length / 4))
}

export function buildAutonomousChapterReview(input: {
  chapter: Chapter
  report: string
  candidates?: CandidateChange[]
  contextVersion: string
  candidateExtractionError?: string
  startedAt?: string
  reviewInput?: ChapterReviewInput
}): AutonomousStructuredReview {
  const sourceVersionId = buildAnalysisSourceVersionId(input.chapter.content)
  const candidates = (input.candidates || []).filter(candidate =>
    candidate.chapterId === input.chapter.id && candidate.sourceVersionId === sourceVersionId,
  )
  const now = new Date().toISOString()
  const { review } = buildChapterReviewResult(input.reviewInput || {
    chapterId: input.chapter.id, content: input.chapter.content,
    sourceVersionId: buildChapterReviewSourceVersion(input.chapter.content, input.contextVersion),
    localBlock: buildLocalConsistencyReviewBlock(input.chapter.content), alerts: [],
  }, input.report, [], candidates, now)
  const extractionFinding: ReviewFinding | undefined = input.candidateExtractionError ? {
    id: 'finding:autonomous-memory:' + input.chapter.id + ':' + sourceVersionId,
    type: 'knowledge',
    severity: 'blocker',
    title: '长期故事记忆提取失败',
    explanation: input.candidateExtractionError,
    chapterId: input.chapter.id,
    sourceVersionId,
    evidence: [],
    blocksFinalization: true,
    status: 'open',
    suggestedFix: '重新运行故事变化提取，确认事件、人物状态、剧情线和时间推进已完成核对。',
  } : undefined
  const allFindings = extractionFinding ? [...review.findings, extractionFinding] : review.findings
  const status: ChapterReview['status'] = review.deterministicChecksPassed
    && review.semanticChecksPassed
    && !hasBlockingFindings(allFindings)
    ? 'ready_to_finalize'
    : 'needs_revision'
  return {
    findings: allFindings,
    candidates,
    review: {
      ...review,
      id: 'review:autonomous:' + input.chapter.id + ':' + buildChapterReviewSourceVersion(input.chapter.content, input.contextVersion),
      chapterId: input.chapter.id,
      sourceVersionId: buildChapterReviewSourceVersion(input.chapter.content, input.contextVersion),
      startedAt: input.startedAt || now,
      completedAt: now,
      findings: allFindings.slice(),
      candidateChanges: candidates.slice(),
      status,
    },
  }
}

export async function extractAutonomousChapterCandidates(input: {
  novel: Novel
  chapter: Chapter
  canonMutations?: CanonMutationRecord[]
  model: ModelConfig
  signal?: AbortSignal
  requestLifecycle?: AiRequestLifecycle
}): Promise<AutonomousCandidateExtraction> {
  const result = await callAI({
    model: input.model,
    skillTask: 'analysis',
    taskName: '提取第' + (input.chapter.chapterIndex + 1) + '章故事变化候选',
    messages: buildChapterAnalysisPrompt(
      input.chapter.content,
      formatAnalysisPanels(input.novel, input.chapter.chapterIndex),
      formatActiveGlobalPlans(input.novel, input.chapter.chapterIndex),
      formatCharacterAnalysisReferences(input.novel, input.chapter.chapterIndex),
      formatCharacterStateContext(input.novel, input.canonMutations || [], input.chapter.chapterIndex),
      formatEventCausalityAnalysisReferences(input.novel, input.chapter.chapterIndex),
    ),
    signal: input.signal,
    noAutomaticRetry: true,
    requestLifecycle: input.requestLifecycle,
  })
  const parsed = parseAiJsonObject<ChapterAnalysisCandidatePayload>(result.content)
  if ((result.finishReason && result.finishReason !== 'stop')
    || !isCompleteChapterAnalysis(parsed)) {
    return {
      candidates: [],
      usedTokens: analysisTokenCount(result, result.content),
      error: '故事变化提取返回的数据不完整或因果条目格式无效，未能建立本章长期记忆候选。',
    }
  }
  const sourceVersionId = buildAnalysisSourceVersionId(input.chapter.content)
  return {
    candidates: buildChapterAnalysisCandidates(input.novel, input.chapter, sourceVersionId, {
      events: parsed.events,
      characters: parsed.characters,
      globalPlans: parsed.globalPlans,
      eventCausalityChanges: parsed.eventCausalityChanges,
      timeAdvanceDays: parsed.timeAdvanceDays,
      knowledgeChanges: parsed.knowledgeChanges,
      relationshipChanges: parsed.relationshipChanges,
    }),
    usedTokens: analysisTokenCount(result, result.content),
  }
}
