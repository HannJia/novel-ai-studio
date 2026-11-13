import type { Chapter, Novel } from '@/types/novel'
import type { CandidateChange, ChapterReview, ReviewFinding } from '@/types/reconstruction'
import type { StoryImpactReport } from '@/types/storyImpact'
import { deriveChapterWorkflow, type ChapterWorkflow } from './chapterWorkflow'
import { resolveChapterLengthPolicy } from '@/services/chapterLength'
import { projectStoryTime } from '@/services/storyTime'
import { buildChapterReviewSourceVersion } from '@/services/chapterReviewIdentity'
import { normalizeStoredReviewCoverage } from '@/services/chapterReviewAcceptance'
import { candidatePreview } from './candidatePreview'

export interface ReviewCenterInput {
  novel: Novel
  findings: ReviewFinding[]
  candidates: CandidateChange[]
  reviews: ChapterReview[]
  impactReports: StoryImpactReport[]
  contextVersion: (chapter: Chapter) => string
}

export type ReviewCenterStatus = 'empty' | 'needs_review' | 'reviewing' | 'needs_revision' | 'ready' | 'finalized'
/** 全书状态方格的着色类别。`stale` 只表示“曾审校、现已失效”，从未审校的章是 `drafting`。 */
export type ReviewHeat = 'idea' | 'outlined' | 'drafting' | 'reviewing' | 'revision' | 'ready' | 'stale' | 'final'

export interface ReviewCenterRow {
  chapter: Chapter
  workflow: ChapterWorkflow
  status: ReviewCenterStatus
  heat: ReviewHeat
  /** 曾有已完成的审校，但当前正文、上下文或设定已使它不再有效。从未审校的章不算。 */
  reviewStale: boolean
  openFindings: ReviewFinding[]
  blockers: ReviewFinding[]
  pendingCandidates: CandidateChange[]
  /** 只统计与当前正文、当前审核依据一致的覆盖；旧正文遗留的 100% 不显示为当前。 */
  coveragePercent: number
  invalidationReason: string
  latestReviewAt: string
}

export type ReviewQueueLevel = 'blocker' | 'warning' | 'suggestion' | 'candidate' | 'review'

export interface ReviewQueueItem {
  id: string
  chapterId: string
  chapterIndex: number
  kind: 'finding' | 'candidate' | 'review'
  level: ReviewQueueLevel
  /** 问题类型的中文名，如“知情冲突”“故事变化”“重审”。 */
  category: string
  title: string
  detail: string
}

export interface ReviewCenterSnapshot {
  rows: ReviewCenterRow[]
  queue: ReviewQueueItem[]
  totals: { chapters: number; reviewed: number; needsReview: number; stale: number; blockers: number; pendingDecisions: number }
}

export const findingTypeLabel: Record<ReviewFinding['type'], string> = {
  continuity: '连续性', character: '角色一致性', timeline: '时间线', plot: '情节', foreshadowing: '伏笔', knowledge: '知情冲突',
  world_rule: '设定冲突', style: '叙事质量', pacing: '节奏', format: '格式',
}
export const candidateTypeLabel: Record<CandidateChange['type'], string> = {
  fact: '事实', state: '状态', relationship: '关系', timeline: '时间', plotline: '情节线', foreshadowing: '伏笔', knowledge: '知情', event_causality: '因果',
}
const LEVEL_RANK: Record<ReviewQueueLevel, number> = { blocker: 0, warning: 1, suggestion: 2, candidate: 3, review: 4 }

function latestReview(reviews: ChapterReview[], chapterId: string): ChapterReview | undefined {
  return reviews.filter(review => review.chapterId === chapterId).sort((left, right) =>
    (right.completedAt || right.startedAt).localeCompare(left.completedAt || left.startedAt))[0]
}

function hasPlan(novel: Novel, chapter: Chapter): boolean {
  return Boolean(novel.chapterPlans?.some(plan => plan.targetChapterStart <= chapter.chapterIndex && plan.targetChapterEnd >= chapter.chapterIndex)
    || chapter.sceneNotes?.length)
}

function invalidationReason(row: { chapter: Chapter; workflow: ChapterWorkflow; latest?: ChapterReview; expectedVersion: string; impacts: StoryImpactReport[]; reviewedBefore: boolean }): string {
  const { chapter, workflow, latest, expectedVersion, impacts, reviewedBefore } = row
  if (!chapter.content.trim()) return '暂无正文'
  const coverage = normalizeStoredReviewCoverage(chapter.contentReviewCoverage)
  if (coverage?.status === 'failed') return '上次分段审校未完成'
  if (latest && latest.sourceVersionId !== expectedVersion) return '正文或审核上下文已变化'
  // An impact report invalidates the review until the chapter has been
  // reviewed against the current context again. Keep historical reports for
  // traceability, but do not keep surfacing their old reason after a current
  // review has been durably accepted. A chapter that was never reviewed has no
  // review to invalidate, so it is simply not reviewed yet.
  if (reviewedBefore && impacts.some(report => report.reviewChapterIds.includes(chapter.id)) && !workflow.reviewCurrent) {
    return '剧情设定变更使本章审核失效'
  }
  if (chapter.contentReviewSignature && !workflow.reviewCurrent) return '审核签名与当前正文不一致'
  return workflow.reviewCurrent ? '' : latest ? '审核结果需要重新确认' : '尚未完成本章审校'
}

export function deriveReviewCenter(input: ReviewCenterInput): ReviewCenterSnapshot {
  const rows = input.novel.chapters.slice().sort((left, right) => left.chapterIndex - right.chapterIndex).map(chapter => {
    const contextVersion = input.contextVersion(chapter)
    const expectedVersion = buildChapterReviewSourceVersion(chapter.content, contextVersion)
    const chapterFindings = input.findings.filter(finding => finding.chapterId === chapter.id)
    const chapterCandidates = input.candidates.filter(candidate => candidate.chapterId === chapter.id)
    const latest = latestReview(input.reviews, chapter.id)
    const workflow = deriveChapterWorkflow({
      chapter,
      content: chapter.content,
      contextVersion,
      lengthPolicy: resolveChapterLengthPolicy(input.novel.chapterLengthPolicy),
      hasPlan: hasPlan(input.novel, chapter),
      storyTimeKnown: projectStoryTime(input.novel, chapter).known,
      latestReview: latest,
      findings: chapterFindings,
      candidates: chapterCandidates,
      hasPendingRevision: false,
    })
    const openFindings = workflow.openFindings
    const blockers = workflow.blockers
    const pendingCandidates = workflow.pendingCandidates
    // workflow.coverage 已按当前正文签名和长度过滤；不要改用未过滤的已存覆盖，
    // 否则旧正文留下的 100% 会让修改后的章节显示为已覆盖。
    const coverage = workflow.coverage
    const coveragePercent = coverage ? Math.round(coverage.covered / Math.max(1, coverage.chars) * 100) : 0
    const status: ReviewCenterStatus = !chapter.content.trim() ? 'empty'
      : workflow.status === 'finalized' ? 'finalized'
        : workflow.status === 'needs_revision' || blockers.length ? 'needs_revision'
          : workflow.reviewCurrent && workflow.status === 'ready_to_finalize' ? 'ready'
            : normalizeStoredReviewCoverage(chapter.contentReviewCoverage)?.status === 'running' ? 'reviewing' : 'needs_review'
    // 曾审校：存在已结束的审校记录，或本章仍留着审核签名。进行中的审校和部分覆盖不算。
    const reviewedBefore = Boolean(latest && latest.status !== 'running') || Boolean(chapter.contentReviewSignature)
    const reviewStale = Boolean(chapter.content.trim()) && reviewedBefore && !workflow.reviewCurrent
    const heat: ReviewHeat = status === 'empty' ? (workflow.status === 'outlined' ? 'outlined' : 'idea')
      : reviewStale ? 'stale'
        : status === 'finalized' ? 'final'
          : status === 'needs_revision' ? 'revision'
            : status === 'ready' ? 'ready'
              : status === 'reviewing' ? 'reviewing' : 'drafting'
    return {
      chapter, workflow, status, heat, reviewStale, openFindings, blockers, pendingCandidates, coveragePercent,
      invalidationReason: invalidationReason({ chapter, workflow, latest, expectedVersion, impacts: input.impactReports, reviewedBefore }),
      latestReviewAt: latest?.completedAt || latest?.startedAt || '',
    }
  })

  const queue: ReviewQueueItem[] = []
  for (const row of rows) {
    const chapterIndex = row.chapter.chapterIndex
    for (const finding of row.openFindings) {
      queue.push({ id: 'finding:' + finding.id, chapterId: row.chapter.id, chapterIndex, kind: 'finding',
        level: finding.severity === 'blocker' ? 'blocker' : finding.severity === 'warning' ? 'warning' : 'suggestion',
        category: findingTypeLabel[finding.type] ?? '审校', title: finding.title, detail: finding.explanation })
    }
    for (const candidate of row.pendingCandidates) {
      const preview = candidatePreview(candidate, input.novel.characters, input.novel.eventLog)
      queue.push({ id: 'candidate:' + candidate.id, chapterId: row.chapter.id, chapterIndex, kind: 'candidate', level: 'candidate',
        category: candidateTypeLabel[candidate.type] ?? '故事变化', title: '故事变化候选待确认', detail: preview.detail || preview.title })
    }
    if (row.status === 'needs_review') {
      queue.push({ id: 'review:' + row.chapter.id, chapterId: row.chapter.id, chapterIndex, kind: 'review', level: 'review', category: '重审',
        title: row.reviewStale ? '审核已失效，需要重新审校' : '本章尚未审校', detail: row.invalidationReason })
    }
  }
  // 阻塞优先，其次警告、建议、候选、重审；同级按章序，保持原有先后。
  queue.sort((left, right) => LEVEL_RANK[left.level] - LEVEL_RANK[right.level] || left.chapterIndex - right.chapterIndex)
  return {
    rows,
    queue,
    totals: {
      chapters: rows.length,
      reviewed: rows.filter(row => row.workflow.reviewCurrent).length,
      needsReview: rows.filter(row => row.status === 'needs_review').length,
      stale: rows.filter(row => row.reviewStale).length,
      blockers: rows.reduce((sum, row) => sum + row.blockers.length, 0),
      pendingDecisions: rows.reduce((sum, row) => sum + row.pendingCandidates.length + row.openFindings.length, 0),
    },
  }
}
