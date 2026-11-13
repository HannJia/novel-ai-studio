import { contentReviewVerdict } from './contentReview'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { REVIEW_CHUNK_SIZE, REVIEW_CHUNK_OVERLAP, splitReviewChunks, readReviewChunkFacts, isReviewCheckpoint, copyReviewCheckpoint, type ReviewCheckpoint, type ReviewChunk } from './chapterReviewCheckpoint'
export { REVIEW_CHUNK_SIZE, MAX_REVIEW_CHUNKS, splitReviewChunks } from './chapterReviewCheckpoint'
export type { ReviewCheckpoint, ReviewChunk } from './chapterReviewCheckpoint'

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
  checkpoint?: ReviewCheckpoint
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

export function reviewCoverageLabel(coverage: ReviewCoverage): string {
  const stage = coverage.globalStatus === 'not-needed' ? '单段全文'
    : `全章摘要关系复核${({ pending: '待完成', complete: '已完成', failed: '失败', 'not-needed': '' })[coverage.globalStatus]}`
  return `原文 ${coverage.completedChunks}/${coverage.totalChunks} 段（${coverage.coveredCharacters}/${coverage.totalCharacters} 字符）· ${stage}${coverage.status === 'failed' ? ' · 未完成' : ''}`
}

export async function requestChapterReviewWithCoverage(
  source: string,
  review: (part: ReviewChunk, kind: 'chunk' | 'global', facts?: string) => Promise<string>,
  onProgress?: (coverage: ReviewCoverage) => void,
  recovery?: { binding: string; checkpoint?: ReviewCheckpoint; onCheckpoint: (coverage: ReviewCoverage) => Promise<void> },
): Promise<string> {
  const coverage: ReviewCoverage = {
    totalChunks: Math.max(1, Math.ceil(source.length / (REVIEW_CHUNK_SIZE - REVIEW_CHUNK_OVERLAP))),
    completedChunks: 0, coveredCharacters: 0, totalCharacters: source.length,
    globalStatus: 'pending', status: 'running',
  }
  const snapshot = (): ReviewCoverage => ({ ...coverage, ...(coverage.checkpoint ? { checkpoint: copyReviewCheckpoint(coverage.checkpoint) } : {}) })
  const emit = () => onProgress?.(snapshot())
  const persist = async () => {
    if (coverage.completedChunks === coverage.totalChunks && ['complete', 'not-needed'].includes(coverage.globalStatus)) coverage.status = 'complete'
    if (recovery) await recovery.onCheckpoint(snapshot())
  }
  let runningGlobal = false
  try {
    const chunks = splitReviewChunks(source)
    coverage.totalChunks = chunks.length
    coverage.globalStatus = chunks.length > 1 ? 'pending' : 'not-needed'
    if (recovery) {
      const previous = recovery.checkpoint, sourceVersionId = buildAnalysisSourceVersionId(source)
      if (previous !== undefined && !isReviewCheckpoint(previous)) throw new Error('分段审核断点损坏，不能继续使用')
      if (previous?.binding === recovery.binding && previous.sourceVersionId === sourceVersionId) {
        if (!isReviewCheckpoint(previous, source)) throw new Error('分段审核断点与正文范围不一致')
        coverage.checkpoint = copyReviewCheckpoint(previous)
      } else coverage.checkpoint = { version: 1, binding: recovery.binding, sourceVersionId, totalCharacters: source.length, totalChunks: chunks.length, chunks: [] }
      coverage.completedChunks = coverage.checkpoint.chunks.length
      coverage.coveredCharacters = coverage.checkpoint.chunks.slice(-1)[0]?.end || 0
      if (coverage.checkpoint.globalReport) coverage.globalStatus = 'complete'
      // A retained result from a failed write must be durable before another paid request.
      if (coverage.completedChunks) await persist()
    }
    emit()
    const reports: string[] = []
    const summaries: string[] = []
    for (const chunk of chunks) {
      const cached = coverage.checkpoint?.chunks[chunk.index]
      if (!cached) coverage.failedChunk = chunk.index + 1
      const report = cached?.report ?? await review(chunk, 'chunk')
      if (contentReviewVerdict(report) === 'unknown') throw new Error(`第 ${chunk.index + 1} 段审查结论无法识别`)
      if (chunks.length > 1) {
        const summary = readReviewChunkFacts(report)
        if (!summary) throw new Error(`第 ${chunk.index + 1} 段缺少有效的事实摘要（需 1–600 字符），全章关系复核未完成`)
        summaries.push(`【第 ${chunk.index + 1} 段，原文字符 ${chunk.start + 1}–${chunk.end}】\n${summary}`)
      }
      reports.push(report)
      if (!cached) {
        coverage.checkpoint?.chunks.push({ index: chunk.index, start: chunk.start, end: chunk.end, report })
        coverage.completedChunks++
        coverage.coveredCharacters = chunk.end
        delete coverage.failedChunk
        await persist()
        emit()
      }
    }
    if (chunks.length > 1) {
      runningGlobal = true
      const global = coverage.checkpoint?.globalReport ?? await review({ text: '', start: 0, end: source.length, index: 0, total: chunks.length }, 'global', summaries.join('\n\n'))
      if (contentReviewVerdict(global) === 'unknown') throw new Error('全章事实摘要关系复核结论无法识别')
      reports.push(global)
      coverage.globalStatus = 'complete'
      if (coverage.checkpoint && !coverage.checkpoint.globalReport) {
        coverage.checkpoint.globalReport = global
        await persist()
      }
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
    coverage.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000)
    emit()
    throw new ChapterReviewCoverageError(coverage.error, snapshot())
  }
}
