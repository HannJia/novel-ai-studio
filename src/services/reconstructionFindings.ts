import type { EvidenceRef, ReviewFinding, ReviewFindingType, ReviewSeverity } from '@/types/reconstruction'

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
