import { MAX_REVIEW_CHUNKS } from './chapterReviewCoverage'
import type { StoredReviewCoverage } from './chapterReviewCoverage'
import { copyReviewCheckpoint, isReviewCheckpoint } from './chapterReviewCheckpoint'

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function isValidStatus(value: unknown): value is 'running' | 'complete' | 'failed' {
  return value === 'running' || value === 'complete' || value === 'failed'
}

function isValidGlobalStatus(value: unknown): value is 'pending' | 'complete' | 'failed' | 'not-needed' {
  return value === 'pending' || value === 'complete' || value === 'failed' || value === 'not-needed'
}

export function normalizeStoredReviewCoverage(value: unknown): StoredReviewCoverage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const obj = value as Record<string, unknown>

  if (typeof obj.signature !== 'string' || !obj.signature.trim() || obj.signature.length > 500) {
    return undefined
  }

  if (!isFiniteInteger(obj.totalChunks) || obj.totalChunks < 1 || obj.totalChunks > MAX_REVIEW_CHUNKS) {
    return undefined
  }

  if (!isFiniteInteger(obj.completedChunks) || obj.completedChunks < 0 || obj.completedChunks > obj.totalChunks) {
    return undefined
  }

  if (!isFiniteInteger(obj.totalCharacters) || obj.totalCharacters <= 0 || obj.totalCharacters > 5000000) {
    return undefined
  }

  if (!isFiniteInteger(obj.coveredCharacters) || obj.coveredCharacters < 0 || obj.coveredCharacters > obj.totalCharacters) {
    return undefined
  }

  if (!isValidGlobalStatus(obj.globalStatus)) return undefined
  if (!isValidStatus(obj.status)) return undefined

  const isSingleChunk = obj.totalChunks === 1
  const isMultiChunk = obj.totalChunks > 1

  if (isMultiChunk && obj.globalStatus === 'not-needed') return undefined

  if (isSingleChunk && obj.globalStatus !== 'not-needed') {
    if (obj.status !== 'failed' || obj.completedChunks !== 0) return undefined
    if (obj.globalStatus !== 'pending' && obj.globalStatus !== 'failed') return undefined
  }

  if (obj.failedChunk !== undefined) {
    if (!isFiniteInteger(obj.failedChunk) || obj.failedChunk < 1 || obj.failedChunk > obj.totalChunks) {
      return undefined
    }
  }

  if (obj.error !== undefined) {
    if (typeof obj.error !== 'string' || obj.error.length > 2000) {
      return undefined
    }
  }

  let checkpoint: StoredReviewCoverage['checkpoint']
  if (obj.checkpoint !== undefined) {
    if (!isReviewCheckpoint(obj.checkpoint)) return undefined
    checkpoint = obj.checkpoint
    if (checkpoint.totalCharacters !== obj.totalCharacters
      || checkpoint.totalChunks !== obj.totalChunks
      || checkpoint.chunks.length !== obj.completedChunks
      || (checkpoint.chunks[checkpoint.chunks.length - 1]?.end || 0) !== obj.coveredCharacters
      || (obj.globalStatus === 'complete' && checkpoint.globalReport === undefined)) return undefined
  }

  if (obj.status === 'complete' && (obj.completedChunks !== obj.totalChunks
    || obj.coveredCharacters !== obj.totalCharacters
    || (isMultiChunk && obj.globalStatus !== 'complete')
    || obj.failedChunk !== undefined || obj.error !== undefined)) return undefined

  return {
    signature: obj.signature,
    totalChunks: obj.totalChunks,
    completedChunks: obj.completedChunks,
    coveredCharacters: obj.coveredCharacters,
    totalCharacters: obj.totalCharacters,
    globalStatus: obj.globalStatus,
    status: obj.status,
    ...(obj.failedChunk !== undefined && { failedChunk: obj.failedChunk }),
    ...(obj.error !== undefined && { error: obj.error }),
    ...(checkpoint !== undefined && { checkpoint: copyReviewCheckpoint(checkpoint) }),
  }
}

export function isReviewCoverageComplete(
  value: unknown,
  expectedSignature: string,
  source: string,
): boolean {
  const coverage = normalizeStoredReviewCoverage(value)
  if (!coverage) return false

  if (coverage.signature !== expectedSignature) return false
  if (coverage.totalCharacters !== source.length) return false
  if (coverage.checkpoint !== undefined && !isReviewCheckpoint(coverage.checkpoint, source)) return false

  if (coverage.status !== 'complete') return false
  if (coverage.completedChunks !== coverage.totalChunks) return false
  if (coverage.coveredCharacters !== coverage.totalCharacters) return false

  if (coverage.totalChunks === 1) {
    if (coverage.globalStatus !== 'not-needed') return false
  } else {
    if (coverage.globalStatus !== 'complete') return false
  }

  if (coverage.failedChunk !== undefined) return false
  if (coverage.error !== undefined) return false

  return true
}
