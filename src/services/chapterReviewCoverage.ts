import { contentReviewVerdict } from './contentReview'

export const REVIEW_CHUNK_SIZE = 3200
export const MAX_REVIEW_CHUNKS = 8
const OVERLAP = 160

export interface ReviewChunk {
  text: string
  start: number
  end: number
  index: number
  total: number
}

// Coverage records completed inspections, not whether the prose has no issues.
export interface ReviewCoverage {
  totalChunks: number
  completedChunks: number
  coveredCharacters: number
  totalCharacters: number
  globalStatus: 'pending' | 'complete' | 'failed' | 'not-needed'
  status: 'running' | 'complete' | 'failed'
  failedChunk?: number
  error?: string
}

export interface StoredReviewCoverage extends ReviewCoverage {
  signature: string
}

export class ChapterReviewCoverageError extends Error {
  constructor(message: string, public readonly coverage: ReviewCoverage) {
    super(message)
    this.name = 'ChapterReviewCoverageError'
  }
}

function atLowSurrogate(text: string, position: number): boolean {
  const current = text.charCodeAt(position)
  const previous = text.charCodeAt(position - 1)
  return current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
}

export function splitReviewChunks(text: string): ReviewChunk[] {
  if (!text.trim()) throw new Error('正文为空，无法审查')
  if (text.length > MAX_REVIEW_CHUNKS * REVIEW_CHUNK_SIZE) {
    throw new Error(`正文过长，请先拆章；一次最多审查 ${MAX_REVIEW_CHUNKS} 段，不会只审开头`)
  }
  const chunks: ReviewChunk[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + REVIEW_CHUNK_SIZE, text.length)
    if (atLowSurrogate(text, end)) end--
    chunks.push({ text: text.slice(start, end), start, end, index: chunks.length, total: 0 })
    if (chunks.length > MAX_REVIEW_CHUNKS) {
      throw new Error(`正文需要超过 ${MAX_REVIEW_CHUNKS} 段审查，请先拆章；未发送部分审查请求`)
    }
    if (end === text.length) break
    start = end - OVERLAP
    if (atLowSurrogate(text, start)) start--
  }
  return chunks.map(chunk => ({ ...chunk, total: chunks.length }))
}

export function reviewCoverageLabel(coverage: ReviewCoverage): string {
  const stage = coverage.globalStatus === 'not-needed' ? '单段全文'
    : `全章摘要关系复核${({ pending: '待完成', complete: '已完成', failed: '失败', 'not-needed': '' })[coverage.globalStatus]}`
  return `原文 ${coverage.completedChunks}/${coverage.totalChunks} 段（${coverage.coveredCharacters}/${coverage.totalCharacters} 字符）· ${stage}${coverage.status === 'failed' ? ' · 未完成' : ''}`
}

export async function requestChapterReviewWithCoverage(
  source: string,
  review: (part: ReviewChunk, kind: 'chunk' | 'global', facts?: string) => Promise<string>,
  onProgress?: (coverage: ReviewCoverage) => void,
): Promise<string> {
  const coverage: ReviewCoverage = {
    totalChunks: Math.max(1, Math.ceil(source.length / (REVIEW_CHUNK_SIZE - OVERLAP))),
    completedChunks: 0, coveredCharacters: 0, totalCharacters: source.length,
    globalStatus: 'pending', status: 'running',
  }
  const emit = () => onProgress?.({ ...coverage })
  let runningGlobal = false
  try {
    const chunks = splitReviewChunks(source)
    coverage.totalChunks = chunks.length
    coverage.globalStatus = chunks.length > 1 ? 'pending' : 'not-needed'
    emit()
    const reports: string[] = []
    const summaries: string[] = []
    for (const chunk of chunks) {
      coverage.failedChunk = chunk.index + 1
      const report = await review(chunk, 'chunk')
      if (contentReviewVerdict(report) === 'unknown') throw new Error(`第 ${chunk.index + 1} 段审查结论无法识别`)
      if (chunks.length > 1) {
        const summary = report.replace(/\r/g, '').match(/^##\s+本段事实摘要\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/m)?.[1]?.trim()
        if (!summary || summary.length > 600) throw new Error(`第 ${chunk.index + 1} 段缺少有效的事实摘要（需 1–600 字符），全章关系复核未完成`)
        summaries.push(`【第 ${chunk.index + 1} 段，原文字符 ${chunk.start + 1}–${chunk.end}】\n${summary}`)
      }
      reports.push(report)
      coverage.completedChunks++
      coverage.coveredCharacters = chunk.end
      delete coverage.failedChunk
      emit()
    }
    if (chunks.length > 1) {
      runningGlobal = true
      const global = await review({ text: '', start: 0, end: source.length, index: 0, total: chunks.length }, 'global', summaries.join('\n\n'))
      if (contentReviewVerdict(global) === 'unknown') throw new Error('全章事实摘要关系复核结论无法识别')
      reports.push(global)
      coverage.globalStatus = 'complete'
    }
    coverage.status = 'complete'
    emit()
    const scope = `覆盖范围：${reviewCoverageLabel(coverage)}。${chunks.length > 1 ? '分段检查原文，并基于各段事实摘要核对全章关系；摘要不能代替原文细节。' : ''}`
    if (chunks.length === 1) return `${scope}\n\n${reports[0]}`
    const needsChanges = reports.some(report => contentReviewVerdict(report) !== 'passed')
    const required = reports.reduce((total, report) => total + Number(report.match(/必改数量[：:]\s*(\d+)/)?.[1] || 0), 0)
    return `# 全章审查汇总\n\n${scope}\n\n## 结论\n总体判断：${needsChanges ? '必须修改' : '可通过'}\n必改数量：${required}\n\n` + reports.map((report, index) =>
      `---\n\n# ${index < chunks.length ? `第 ${index + 1}/${chunks.length} 段原文检查` : '全章事实摘要关系复核'}\n\n${report}`,
    ).join('\n\n')
  } catch (error) {
    coverage.status = 'failed'
    if (runningGlobal) coverage.globalStatus = 'failed'
    coverage.error = error instanceof Error ? error.message : String(error)
    emit()
    throw new ChapterReviewCoverageError(coverage.error, { ...coverage })
  }
}
