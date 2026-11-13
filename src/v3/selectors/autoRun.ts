// 自动写作运行中心的只读派生：章节流水线阶段、预算、停止条件。不修改任何 Store。
// 阶段来自任务里保存的候选稿和检查点，不再按章节状态猜测。
import type { Chapter, Novel } from '@/types/novel'
import type { AiRun, AiRunRequest } from '@/types/reconstruction'
import { resolveChapterLengthPolicy } from '@/services/chapterLength'

export type PipelineStepId = 'outline' | 'writing' | 'review' | 'revision' | 'author'
export type PipelineStepState = 'done' | 'current' | 'waiting' | ''
export type PipelineStage = 'queued' | 'writing' | 'reviewing' | 'waiting_author' | 'accepted' | 'rejected' | 'blocked' | 'existing' | 'outside'

export const PIPELINE_STEPS: Array<{ id: PipelineStepId; label: string }> = [
  { id: 'outline', label: '章纲' }, { id: 'writing', label: '生成' }, { id: 'review', label: '审校' },
  { id: 'revision', label: '修订候选' }, { id: 'author', label: '等你确认' },
]

export interface PipelineRow {
  chapter: Chapter
  stage: PipelineStage
  stageLabel: string
  steps: PipelineStepState[]
  draftWords: number | null
  /** 本章审校后提示条数；没有结构化审核记录时为 null。 */
  findingCount: number | null
  /** 本章是否在任务范围内；范围外只展示，不显示任务阶段。 */
  inRun: boolean
  note: string
}

const CHECKPOINT = /^chapter-(\d+):(started|completed|reviewed|checkpoint|review-needs-author|needs-author)$/

export function checkpointOf(run: AiRun | undefined): { chapterIndex: number; phase: string } | null {
  const match = run?.checkpoint?.match(CHECKPOINT)
  return match ? { chapterIndex: Number(match[1]), phase: match[2] } : null
}

function hasPlan(novel: Novel, chapter: Chapter) {
  return Boolean(novel.chapterPlans?.some(plan => plan.targetChapterStart <= chapter.chapterIndex && plan.targetChapterEnd >= chapter.chapterIndex))
    || Boolean(chapter.sceneNotes?.length)
}

export function derivePipeline(novel: Novel, run: AiRun | undefined, limit = 8): PipelineRow[] {
  const chapters = [...novel.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)
  const start = run?.chapterStart ?? 0
  const end = run?.chapterEnd ?? Math.min(chapters.length - 1, 5)
  const point = checkpointOf(run)
  const rows = chapters.filter(chapter => chapter.chapterIndex >= start && chapter.chapterIndex <= end).slice(0, limit)
  return rows.map((chapter): PipelineRow => {
    const draft = run?.chapterDrafts?.find(row => row.chapterId === chapter.id)
    const planned = hasPlan(novel, chapter)
    const outline: PipelineStepState = planned ? 'done' : ''
    const blank: PipelineRow = { chapter, stage: 'queued', stageLabel: '排队', steps: [outline, '', '', '', ''], draftWords: null, findingCount: null, inRun: true, note: planned ? '' : '尚无章纲' }
    if (!run) {
      // 没有任务时只展示章节自身：已有正文的章不会被自动任务覆盖。
      return chapter.content.trim()
        ? { ...blank, stage: 'existing', stageLabel: '已有正文', steps: [outline, '', '', '', ''], inRun: false, note: '自动任务不会覆盖已有正文' }
        : { ...blank, inRun: false }
    }
    if (draft) {
      const words = draft.content.replace(/\s+/g, '').length
      const findings = draft.review?.findings.length ?? null
      if (draft.status === 'accepted') return { ...blank, stage: 'accepted', stageLabel: '已写入正文', steps: ['done', 'done', 'done', 'done', 'done'], draftWords: words, findingCount: findings, note: '' }
      if (draft.status === 'rejected') return { ...blank, stage: 'rejected', stageLabel: '已拒绝', steps: ['done', 'done', 'done', 'done', ''], draftWords: words, findingCount: findings, note: '候选稿已被作者拒绝' }
      if (draft.stage === 'generated') return { ...blank, stage: 'reviewing', stageLabel: '待审校', steps: ['done', 'done', 'current', '', ''], draftWords: words, findingCount: null, note: '' }
      const blocked = point?.chapterIndex === chapter.chapterIndex && point.phase === 'review-needs-author'
      // 未被阻塞时不再加阶段标签：“候选稿 · N 字”和“等你确认”已经说明了状态。
      return { ...blank, stage: 'waiting_author', stageLabel: blocked ? '审校待处理' : '', steps: ['done', 'done', 'done', 'done', 'waiting'], draftWords: words, findingCount: findings,
        note: draft.analysisError ? '故事变化提取未完成' : '' }
    }
    if (chapter.content.trim()) return { ...blank, stage: 'existing', stageLabel: '已有正文', steps: [outline, '', '', '', ''], note: '自动任务不会覆盖已有正文' }
    const active = run.status === 'running' && point?.chapterIndex === chapter.chapterIndex && point.phase === 'started'
    if (active) return { ...blank, stage: 'writing', stageLabel: '生成中', steps: [outline, 'current', '', '', ''] }
    if (!planned && chapter.chapterIndex > (point?.chapterIndex ?? start)) return { ...blank, stage: 'blocked', stageLabel: '需先确认章纲' }
    return blank
  })
}

export const phaseLabel: Record<AiRunRequest['phase'], string> = { writing: '生成', review: '审校', analysis: '故事变化' }

export interface LedgerRow { key: string; label: string; tokens: number; reserved: boolean }

/** 按“章 · 阶段”汇总请求账本；预留尚未结算的请求单独标注。 */
export function deriveLedger(run: AiRun | undefined): LedgerRow[] {
  const rows = new Map<string, LedgerRow>()
  for (const request of run?.requests || []) {
    if (request.status === 'not_sent') continue
    const key = request.chapterIndex + ':' + request.phase + (request.status === 'pending' ? ':pending' : '')
    const row = rows.get(key) || { key, label: `${request.chapterIndex + 1} · ${phaseLabel[request.phase]}`, tokens: 0, reserved: false }
    row.tokens += request.status === 'pending' ? request.reservedTokens : request.inputTokens + request.outputTokens
    if (request.status === 'pending') row.reserved = true
    rows.set(key, row)
  }
  return [...rows.values()]
}

export interface BudgetView {
  cap: number | undefined
  settled: number
  reserved: number
  remaining: number | undefined
  settledPercent: number
  reservedPercent: number
  requests: number
  requestLimit: number | undefined
}

export function deriveBudget(run: AiRun | undefined): BudgetView {
  const cap = run?.tokenBudget
  const reserved = (run?.requests || []).filter(request => request.status === 'pending').reduce((sum, request) => sum + request.reservedTokens, 0)
  // The persisted total already includes every pending request's reservation.
  const settled = Math.max(0, (run?.usedTokens || 0) - reserved)
  const percent = (value: number) => cap ? Math.min(100, Math.round(value / cap * 1000) / 10) : 0
  return {
    cap, settled, reserved,
    remaining: cap === undefined ? undefined : Math.max(0, cap - settled - reserved),
    settledPercent: percent(settled), reservedPercent: Math.min(percent(reserved), 100 - percent(settled)),
    requests: run?.requests?.length || 0, requestLimit: run?.requestLimit,
  }
}

export function stopConditions(run: AiRun | undefined): string[] {
  return [
    '出现作者待处理问题',
    run?.tokenBudget || run?.requestLimit ? '预算或请求额度用尽' : '预算或请求额度用尽（开始任务时设定）',
    run?.checkpointEvery ? `每 ${run.checkpointEvery} 章设检查点` : '未设检查点，连续执行',
    '范围结束',
  ]
}

export function lengthRange(novel: Novel): string {
  const policy = resolveChapterLengthPolicy(novel.chapterLengthPolicy)
  return `${policy.minWords.toLocaleString()} – ${policy.maxWords.toLocaleString()} 字（目标 ${policy.targetWords.toLocaleString()}）`
}
