import { contentReviewVerdict } from './contentReview'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

export const REVIEW_CHUNK_SIZE = 3200
export const MAX_REVIEW_CHUNKS = 8
export const REVIEW_CHUNK_OVERLAP = 160

export interface ReviewChunk { text: string; start: number; end: number; index: number; total: number }
export interface ReviewCheckpoint {
  version: 1
  binding: string
  sourceVersionId: string
  totalCharacters: number
  totalChunks: number
  chunks: Array<{ index: number; start: number; end: number; report: string }>
  globalReport?: string
}

function atLowSurrogate(text: string, position: number): boolean {
  const current = text.charCodeAt(position), previous = text.charCodeAt(position - 1)
  return current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff
}

export function splitReviewChunks(text: string): ReviewChunk[] {
  if (!text.trim()) throw new Error('正文为空，无法审查')
  if (text.length > MAX_REVIEW_CHUNKS * REVIEW_CHUNK_SIZE) throw new Error(`正文过长，请先拆章；一次最多审查 ${MAX_REVIEW_CHUNKS} 段，不会只审开头`)
  const chunks: ReviewChunk[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + REVIEW_CHUNK_SIZE, text.length)
    if (atLowSurrogate(text, end)) end--
    chunks.push({ text: text.slice(start, end), start, end, index: chunks.length, total: 0 })
    if (chunks.length > MAX_REVIEW_CHUNKS) throw new Error(`正文需要超过 ${MAX_REVIEW_CHUNKS} 段审查，请先拆章；未发送部分审查请求`)
    if (end === text.length) break
    start = end - REVIEW_CHUNK_OVERLAP
    if (atLowSurrogate(text, start)) start--
  }
  return chunks.map(chunk => ({ ...chunk, total: chunks.length }))
}

export function readReviewChunkFacts(report: string): string | undefined {
  const facts = report.replace(/\r/g, '').match(/^##\s+本段事实摘要\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/m)?.[1]?.trim()
  return facts && facts.length <= 600 ? facts : undefined
}

function validReport(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200_000 && contentReviewVerdict(value) !== 'unknown'
}

/** Historical checkpoints remain valid data; reuse additionally requires current source and binding. */
export function isReviewCheckpoint(value: unknown, source?: string): value is ReviewCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as ReviewCheckpoint
  if (row.version !== 1 || typeof row.binding !== 'string' || !row.binding.trim() || row.binding.length > 500
    || typeof row.sourceVersionId !== 'string' || !row.sourceVersionId.trim() || row.sourceVersionId.length > 500
    || !Number.isSafeInteger(row.totalCharacters) || row.totalCharacters < 1 || row.totalCharacters > MAX_REVIEW_CHUNKS * REVIEW_CHUNK_SIZE
    || !Number.isSafeInteger(row.totalChunks) || row.totalChunks < 1 || row.totalChunks > MAX_REVIEW_CHUNKS
    || !Array.isArray(row.chunks) || row.chunks.length > row.totalChunks) return false
  let previousEnd = 0
  for (let index = 0; index < row.chunks.length; index++) {
    const chunk = row.chunks[index]
    if (!chunk || chunk.index !== index || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end)
      || chunk.start < 0 || chunk.end <= chunk.start || chunk.end > row.totalCharacters || chunk.end - chunk.start > REVIEW_CHUNK_SIZE
      || (index === 0 ? chunk.start !== 0 : ![REVIEW_CHUNK_OVERLAP, REVIEW_CHUNK_OVERLAP + 1].includes(previousEnd - chunk.start))
      || (index < row.totalChunks - 1 ? chunk.end >= row.totalCharacters || chunk.end - chunk.start < REVIEW_CHUNK_SIZE - 1 : chunk.end !== row.totalCharacters)
      || !validReport(chunk.report) || row.totalChunks > 1 && !readReviewChunkFacts(chunk.report)) return false
    previousEnd = chunk.end
  }
  if (row.globalReport !== undefined && (row.totalChunks === 1 || row.chunks.length !== row.totalChunks || !validReport(row.globalReport))) return false
  if (source !== undefined) {
    if (row.sourceVersionId !== buildAnalysisSourceVersionId(source) || row.totalCharacters !== source.length) return false
    let plan: ReviewChunk[]
    try { plan = splitReviewChunks(source) } catch { return false }
    if (plan.length !== row.totalChunks || row.chunks.some((chunk, index) => chunk.start !== plan[index].start || chunk.end !== plan[index].end)) return false
  }
  return true
}

export function copyReviewCheckpoint(value: ReviewCheckpoint): ReviewCheckpoint {
  return { ...value, chunks: value.chunks.map(chunk => ({ ...chunk })) }
}
