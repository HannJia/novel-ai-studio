import type { EvidenceRef, ReviewFinding, ReviewFindingType, ReviewSeverity } from '@/types/reconstruction'
import type { StoryAggregate } from './storyAggregate'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { isFindingBlocking } from './reconstructionReview'

export interface ContinuityFindingInput {
  id: string
  level: 'warning' | 'info'
  title: string
  detail: string
  evidence: string
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16)
}

function evidenceRef(chapterId: string, sourceVersionId: string, content: string, quote: string, suffix: string): EvidenceRef[] {
  const clean = quote.trim()
  if (clean.length < 4) return []
  const startOffset = content.indexOf(clean)
  if (startOffset < 0 || startOffset !== content.lastIndexOf(clean)) return []
  return [{
    id: 'evidence:' + hash(chapterId + ':' + suffix + ':' + clean),
    sourceType: 'chapter',
    sourceId: chapterId,
    sourceVersionId,
    quote: clean,
    startOffset,
    endOffset: startOffset + clean.length,
    label: '本章正文证据',
  }]
}

function extractQuote(text: string): string {
  return text.match(/[「“”]([^」“”]{4,200})[」“”]/)?.[1]?.trim() || ''
}

function findingType(text: string): ReviewFindingType {
  if (/知情|误信|错误信念|知道|记得|认知|得知/.test(text)) return 'knowledge'
  if (/时间|日期|天数|先后/.test(text)) return 'timeline'
  if (/人物|角色|称呼|性格|动机/.test(text)) return 'character'
  if (/伏笔/.test(text)) return 'foreshadowing'
  if (/悬念|剧情线|主线|事件/.test(text)) return 'plot'
  if (/视角|语气|文风|表达/.test(text)) return 'style'
  if (/节奏|拖沓|推进/.test(text)) return 'pacing'
  return 'continuity'
}

function makeFinding(input: {
  id: string
  chapterId: string
  sourceVersionId: string
  content: string
  severity: ReviewSeverity
  title: string
  explanation: string
  suggestedFix?: string
  quote?: string
  type?: ReviewFindingType
}): ReviewFinding {
  const quote = input.quote || extractQuote(input.explanation)
  return {
    id: input.id,
    type: input.type || findingType(input.title + input.explanation),
    severity: input.severity,
    title: input.title,
    explanation: input.explanation,
    chapterId: input.chapterId,
    sourceVersionId: input.sourceVersionId,
    quotedText: quote || undefined,
    suggestedFix: input.suggestedFix,
    evidence: evidenceRef(input.chapterId, input.sourceVersionId, input.content, quote, input.id),
    blocksFinalization: input.severity === 'blocker',
    status: 'open',
  }
}

export function buildContinuityFindings(input: {
  chapterId: string
  sourceVersionId: string
  content: string
  alerts: ContinuityFindingInput[]
}): ReviewFinding[] {
  return input.alerts.map(alert => makeFinding({
    id: 'continuity:' + alert.id,
    chapterId: input.chapterId,
    sourceVersionId: input.sourceVersionId,
    content: input.content,
    severity: alert.level === 'warning' ? 'blocker' : 'suggestion',
    title: alert.title,
    explanation: alert.detail,
    quote: alert.evidence,
    type: 'continuity',
  }))
}

export function parseReviewFindings(input: {
  chapterId: string
  sourceVersionId: string
  content: string
  report: string
}): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  let severity: ReviewSeverity | undefined
  let itemLines: string[] = []
  let ignoreSection = false
  let itemIndent: number | undefined
  const detailLabel = /^(?:原文证据|证据|问题原因|原因|问题说明|修改建议|建议修复|修复建议)\s*[：:]/
  const plainDetail = (line: string) => line.trim().replace(/^[-*+]\s+/, '').replace(/\*\*|__/g, '')

  const flush = () => {
    if (!severity || !itemLines.length) return
    const explanation = itemLines.join('\n').trim()
    if (!explanation) return
    const heading = explanation.match(/^\s*\[([^\]]+)\]\s*/)?.[1]
    const title = heading || explanation.split(/[：:\n]/)[0].trim().slice(0, 80) || '审查问题'
    const details = itemLines.map(plainDetail)
    const quoteLine = details.find(line => /^(?:原文证据|证据)\s*[：:]/.test(line))
    const fixIndex = details.findIndex(line => /^(?:修改建议|建议修复|修复建议)\s*[：:]/.test(line))
    const fixLines: string[] = []
    if (fixIndex >= 0) {
      fixLines.push(details[fixIndex].replace(/^[^：:]+[：:]\s*/, ''))
      for (const line of details.slice(fixIndex + 1)) {
        if (detailLabel.test(line)) break
        fixLines.push(line)
      }
    }
    findings.push(makeFinding({
      id: 'report:' + hash(input.chapterId + ':' + input.sourceVersionId + ':' + explanation),
      chapterId: input.chapterId,
      sourceVersionId: input.sourceVersionId,
      content: input.content,
      severity,
      title,
      explanation,
      quote: extractQuote(quoteLine || explanation),
      suggestedFix: fixLines.join('\n').trim() || undefined,
    }))
    itemLines = []
  }

  for (const line of input.report.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s*(.+)$/)?.[1] || ''
    if (heading) {
      flush()
      if (/必改|必须修改|阻塞|严重/.test(heading)) severity = 'blocker'
      else if (/建议|可选|优化/.test(heading)) severity = 'suggestion'
      else severity = undefined
      ignoreSection = false
      itemIndent = undefined
      continue
    }
    if (severity && !itemLines.length && /^(?:无|暂无|没有)(?:问题|发现(?:任何)?(?:严重|必改|阻塞)?问题|必改项|严重问题|阻塞问题)?(?:[。.!！]|$)/.test(plainDetail(line))) {
      ignoreSection = true
      continue
    }
    const item = line.match(/^(\s*)(?:\d+[.、)）]|[-*+])\s*(.+)$/)
    // A passing explanation after "无。" is not an issue. A later explicit
    // [type] finding still overrides that declaration and must remain visible.
    if (ignoreSection && !(item && /^\s*\[[^\]]+\]/.test(item[2]))) continue
    if (item) ignoreSection = false
    if (item) {
      const indent = item[1].replace(/\t/g, '    ').length
      // Nested list entries and labelled fields belong to the current finding.
      // Some providers omit indentation on field bullets, so also inspect labels.
      if (itemLines.length && (detailLabel.test(plainDetail(item[2]))
        || (itemIndent !== undefined && indent > itemIndent))) {
        itemLines.push(line.trim())
        continue
      }
      flush()
      if (severity) {
        itemLines = [item[2]]
        itemIndent = indent
      }
      continue
    }
    if (severity && line.trim()) itemLines.push(line)
  }
  flush()
  return findings
}

export function mergeReviewFindings(...groups: ReviewFinding[][]): ReviewFinding[] {
  const result: ReviewFinding[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const finding of group) {
      if (seen.has(finding.id)) continue
      seen.add(finding.id)
      result.push(finding)
    }
  }
  return result
}

// Keep words and punctuation: identity matching must not rely on a generic
// title like [时间线], which can refer to several different problems.
function normalizedFindingLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()
    .replace(/^(?:\d+[.、)）]\s*|[-*+]\s+)/, '').replace(/\*\*|__/g, '').trim()).filter(Boolean)
}

export function reviewFindingFingerprint(finding: ReviewFinding): string {
  return JSON.stringify([finding.chapterId, finding.sourceVersionId, finding.severity,
    normalizedFindingLines(finding.explanation)[0]])
}

export type FindingsReconciliationResult = 'reconciled' | 'unchanged' | 'unverified'

/** Runs inside the workspace transaction; never upgrades a review's validity.
 * Missing provenance, changed bodies and incomplete parses require a fresh
 * review instead of guessing which author decisions to move.
 */
export function reconcileLegacyChapterFindings(aggregate: StoryAggregate, chapterId: string, now: string): FindingsReconciliationResult {
  const chapter = aggregate.novel.chapters.find(row => row.id === chapterId)
  if (!chapter?.contentReview?.trim() || chapter.status === 'locked') return 'unchanged'
  const sourceVersionId = buildAnalysisSourceVersionId(chapter.content)
  const chapterFindings = aggregate.workspace.reviewFindings.filter(row => row.chapterId === chapterId)
  const old = chapterFindings.filter(row => row.id.startsWith('report:'))
  if (!old.length) return 'unchanged'
  if (old.some(row => row.sourceVersionId !== sourceVersionId)) return 'unverified'
  const parsed = parseReviewFindings({ chapterId, sourceVersionId, content: chapter.content, report: chapter.contentReview })
  if (!parsed.length) return 'unverified'
  if (old.length === parsed.length && old.every(row => parsed.some(next => next.id === row.id))) return 'unchanged'

  const sameReportRows = (rows: ReviewFinding[]) => {
    const reports = rows.filter(row => row.id.startsWith('report:'))
    return reports.length === old.length && reports.every(row => old.some(item => item.id === row.id
      && item.sourceVersionId === row.sourceVersionId && item.explanation === row.explanation))
  }
  const reviews = (aggregate.workspace.chapterReviews || []).filter(review => review.chapterId === chapterId
    && (review.sourceVersionId === sourceVersionId || review.sourceVersionId.startsWith(sourceVersionId + '|context:'))
    && review.status !== 'running' && review.status !== 'failed' && sameReportRows(review.findings))
  // A matching review owns the archive. No synthetic approval/version is created.
  if (reviews.length !== 1) return 'unverified'
  const review = reviews[0]
  const parts = parsed.map(row => normalizedFindingLines(row.explanation))
  const belongsTo = (row: ReviewFinding, index: number) => {
    if (row.severity !== parsed[index].severity) return false
    const lines = normalizedFindingLines(row.explanation)
    return lines.length > 0 && parts[index].some((_, start) =>
      lines.every((line, offset) => parts[index][start + offset] === line))
  }
  // Account for every old fragment and require an old parent for every new issue.
  if (old.some(row => !parsed.some((_, index) => belongsTo(row, index)))
    || parsed.some(row => !old.some(item => reviewFindingFingerprint(item) === reviewFindingFingerprint(row)))) return 'unverified'
  const fingerprints = parsed.map(reviewFindingFingerprint)
  const rebuilt = parsed.map((row, index) => {
    const fingerprint = reviewFindingFingerprint(row)
    const parents = old.filter(item => reviewFindingFingerprint(item) === fingerprint)
    // Ambiguous roots stay open. Conflicting notes/decisions remain archived.
    const parent = parents.length === 1 && fingerprints.filter(value => value === fingerprint).length === 1 ? parents[0] : undefined
    const children = old.filter(item => belongsTo(item, index) && reviewFindingFingerprint(item) !== fingerprint)
    const conflicts = children.filter(item => item.status === 'deferred'
      || (item.status !== 'open' && item.status !== parent?.status)
      || (!!item.authorNote?.trim() && item.authorNote.trim() !== parent?.authorNote?.trim()))
    if (conflicts.length) {
      return { ...row, status: conflicts.some(item => item.status === 'deferred') || parent?.status === 'deferred' ? 'deferred' as const : 'open' as const,
        authorNote: [parent?.authorNote, '旧子字段存在不同处理状态或说明，原记录已保留在审核历史，请复核。'].filter(Boolean).join('\n') }
    }
    return parent ? { ...row, status: parent.status, authorNote: parent.authorNote } : row
  })
  if (new Set(rebuilt.map(row => row.id)).size !== rebuilt.length
    || rebuilt.some(row => aggregate.workspace.reviewFindings.some(other => other.chapterId !== chapterId && other.id === row.id))) return 'unverified'
  const archive = JSON.parse(JSON.stringify({
    id: 'finding-reconciliation:' + hash(chapterId + ':' + sourceVersionId + ':' + chapter.contentReview + ':' + JSON.stringify([old, review.findings, review.status])),
    parserVersion: 'grouped-details-v1', reconciledAt: now, report: chapter.contentReview,
    reviewStatus: review.status,
    workspaceFindings: chapterFindings, reviewFindings: review.findings,
  }))
  review.findingReconciliations = [...(review.findingReconciliations || []), archive]
  const oldIds = new Set(old.map(row => row.id))
  aggregate.workspace.reviewFindings = [...aggregate.workspace.reviewFindings.filter(row => !oldIds.has(row.id)), ...rebuilt]
  review.findings = [...review.findings.filter(row => !oldIds.has(row.id)), ...rebuilt]
  if (review.findings.some(isFindingBlocking) && ['ready_to_finalize', 'approved'].includes(review.status)) review.status = 'needs_revision'
  return 'reconciled'
}
