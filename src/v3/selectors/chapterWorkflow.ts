// 写作台生命周期与定稿检查。只读派生，不改数据。
// 门槛与 commitChapterCompletion / finalizeStoryChapter 一致：这里只用于展示和决定主按钮，
// 真正的校验仍在事务里执行，界面显示“可定稿”不代表跳过事务校验。
import type { Chapter } from '@/types/novel'
import type { CandidateChange, ChapterReview, ChapterWorkflowStatus, ReviewFinding } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion } from '@/services/chapterReviewIdentity'
import { isReviewCoverageComplete, normalizeStoredReviewCoverage } from '@/services/chapterReviewAcceptance'
import { isFindingBlocking } from '@/services/reconstructionReview'
import { inspectChapterLength, type ChapterLengthInspection, type ChapterLengthPolicy } from '@/services/chapterLength'
import { getChapterSummaryStatus } from '@/services/derivedSources'

export interface ChapterWorkflowInput {
  chapter: Chapter
  /** 编辑器中的正文，可能尚未保存 */
  content: string
  contextVersion: string
  lengthPolicy: ChapterLengthPolicy
  /** 本章是否有章纲（ChapterPlanV2 或旧章节计划） */
  hasPlan: boolean
  storyTimeKnown: boolean
  latestReview?: ChapterReview
  findings: ReviewFinding[]
  candidates: CandidateChange[]
  hasPendingRevision: boolean
  reviewRunning?: boolean
}

export type GateState = 'ok' | 'todo' | 'block'
export interface GateItem { key: string; label: string; state: GateState; detail: string }

export interface ChapterWorkflow {
  status: ChapterWorkflowStatus
  locked: boolean
  saved: boolean
  length: ChapterLengthInspection
  reviewCurrent: boolean
  coverage: { completed: number; total: number; covered: number; chars: number } | null
  blockers: ReviewFinding[]
  openFindings: ReviewFinding[]
  pendingCandidates: CandidateChange[]
  gate: GateItem[]
  /** 主按钮：完成本章 / 定稿 / 无 */
  primary: 'complete' | 'finalize' | null
}

export const WORKFLOW_STEPS: Array<{ status: ChapterWorkflowStatus; label: string }> = [
  { status: 'idea', label: '构思' }, { status: 'outlined', label: '章纲' }, { status: 'drafting', label: '起草' },
  { status: 'reviewing', label: '审校' }, { status: 'needs_revision', label: '待修订' },
  { status: 'ready_to_finalize', label: '可定稿' }, { status: 'finalized', label: '定稿' },
]

export function deriveChapterWorkflow(input: ChapterWorkflowInput): ChapterWorkflow {
  const { chapter, content } = input
  const locked = chapter.status === 'locked'
  const saved = content === chapter.content
  const version = buildAnalysisSourceVersionId(content)
  const signature = buildChapterReviewSignature(content, input.contextVersion)
  const reviewVersion = buildChapterReviewSourceVersion(content, input.contextVersion)
  const length = inspectChapterLength(content, input.lengthPolicy)

  const current = input.findings.filter(f => f.sourceVersionId === version && f.status !== 'stale')
  const blockers = current.filter(isFindingBlocking)
  const openFindings = current.filter(f => f.status === 'open' || f.status === 'deferred')
  const pendingCandidates = input.candidates.filter(c => (!c.sourceVersionId || c.sourceVersionId === version)
    && (c.status === 'proposed' || c.status === 'deferred'))

  const review = input.latestReview?.sourceVersionId === reviewVersion ? input.latestReview : undefined
  const coverageComplete = saved && chapter.contentReviewSignature === signature
    && isReviewCoverageComplete(chapter.contentReviewCoverage, signature, content)
  const reviewCurrent = !!review && coverageComplete
  const stored = normalizeStoredReviewCoverage(chapter.contentReviewCoverage)
  const coverage = stored && stored.signature === signature && stored.totalCharacters === content.length
    ? { completed: stored.completedChunks, total: stored.totalChunks, covered: stored.coveredCharacters, chars: stored.totalCharacters } : null
  const reviewPassed = reviewCurrent && review!.deterministicChecksPassed && review!.semanticChecksPassed === true
    && (review!.status === 'ready_to_finalize' || review!.status === 'approved') && !blockers.length

  let status: ChapterWorkflowStatus
  if (chapter.status === 'finalized' || locked) status = 'finalized'
  else if (!content.trim()) status = input.hasPlan ? 'outlined' : 'idea'
  else if (input.reviewRunning) status = 'reviewing'
  else if (reviewCurrent && (blockers.length || review!.status === 'needs_revision' || review!.status === 'failed')) status = 'needs_revision'
  else if (reviewPassed) status = 'ready_to_finalize'
  else if (coverage && !reviewCurrent) status = 'reviewing'
  else status = 'drafting'

  const summary = saved ? getChapterSummaryStatus(chapter) : 'stale'
  const gate: GateItem[] = [
    { key: 'saved', label: '正文已保存', state: saved ? 'ok' : 'todo', detail: saved ? '已保存' : '有未保存的修改' },
    { key: 'length', label: '篇幅', state: length.status === 'within' ? 'ok' : 'block',
      detail: length.status === 'within' ? `${length.words} 字，在范围内` : length.status === 'short' ? `还差 ${length.deficit} 字` : `超出 ${length.excess} 字` },
    { key: 'time', label: '故事时间', state: input.storyTimeKnown ? 'ok' : 'todo', detail: input.storyTimeKnown ? '已确认' : '完成前需确认本章经过的天数' },
    { key: 'review', label: '全章审校', state: reviewPassed ? 'ok' : reviewCurrent ? 'block' : 'todo',
      detail: reviewPassed ? '当前正文已审校通过' : reviewCurrent ? '审校未通过' : coverage ? `已覆盖 ${coverage.completed}/${coverage.total} 段` : '当前正文尚未审校' },
    { key: 'blockers', label: '阻塞问题', state: blockers.length ? 'block' : 'ok', detail: blockers.length ? `${blockers.length} 条待处理` : '无' },
    { key: 'summary', label: '章节总结', state: summary === 'current' ? 'ok' : 'todo', detail: summary === 'current' ? '已是当前版本' : '完成本章时生成' },
    { key: 'candidates', label: '故事变化候选', state: pendingCandidates.length ? 'block' : 'ok',
      detail: pendingCandidates.length ? `${pendingCandidates.length} 条待接受或拒绝` : '无待处理' },
    { key: 'revision', label: '待确认修订', state: input.hasPendingRevision ? 'block' : 'ok', detail: input.hasPendingRevision ? '先采纳或放弃浮签' : '无' },
  ]

  let primary: ChapterWorkflow['primary'] = null
  if (status !== 'finalized' && !locked) primary = chapter.status === 'completed' && saved ? 'finalize' : 'complete'

  return { status, locked, saved, length, reviewCurrent, coverage, blockers, openFindings, pendingCandidates, gate, primary }
}

/** 目录树的状态点颜色 */
export function chapterDot(chapter: Pick<Chapter, 'status' | 'content'>): 'done' | 'lock' | 'work' | 'ok' | 'empty' {
  if (chapter.status === 'locked') return 'lock'
  if (chapter.status === 'finalized') return 'done'
  if (chapter.status === 'completed' || chapter.status === 'reviewed') return 'ok'
  return chapter.content.trim() ? 'work' : 'empty'
}
