import { describe, it, expect } from 'vitest'
import { normalizeStoredReviewCoverage, isReviewCoverageComplete } from './chapterReviewAcceptance'

const validComplete = {
  signature: 'abc123',
  totalChunks: 3,
  completedChunks: 3,
  coveredCharacters: 8000,
  totalCharacters: 8000,
  globalStatus: 'complete' as const,
  status: 'complete' as const,
}

describe('normalizeStoredReviewCoverage', () => {
  it('accepts valid complete coverage', () => {
    expect(normalizeStoredReviewCoverage(validComplete)).toEqual(validComplete)
  })

  it('accepts valid single-chunk not-needed', () => {
    const single = { ...validComplete, totalChunks: 1, completedChunks: 1, globalStatus: 'not-needed' as const }
    expect(normalizeStoredReviewCoverage(single)).toEqual(single)
  })

  it('accepts failed single-chunk with completed=0 and not-needed/pending/failed globalStatus', () => {
    const base = { ...validComplete, totalChunks: 1, completedChunks: 0, status: 'failed' as const, failedChunk: 1, error: 'timeout' }
    expect(normalizeStoredReviewCoverage({ ...base, globalStatus: 'not-needed' })).toMatchObject({ status: 'failed', completedChunks: 0 })
    expect(normalizeStoredReviewCoverage({ ...base, globalStatus: 'pending' })).toMatchObject({ status: 'failed', completedChunks: 0 })
    expect(normalizeStoredReviewCoverage({ ...base, globalStatus: 'failed' })).toMatchObject({ status: 'failed', completedChunks: 0 })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['array', []],
  ])('rejects non-object: %s', (_, value) => {
    expect(normalizeStoredReviewCoverage(value)).toBeUndefined()
  })

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['too long', 'x'.repeat(501)],
    ['number', 123],
    ['null', null],
  ])('rejects invalid signature: %s', (_, signature) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, signature })).toBeUndefined()
  })

  it.each([
    ['string', '3'],
    ['null', null],
    ['boolean', true],
    ['float', 3.5],
    ['zero', 0],
    ['negative', -1],
    ['too large', 9],
  ])('rejects invalid totalChunks: %s', (_, totalChunks) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, totalChunks })).toBeUndefined()
  })

  it.each([
    ['string', '2'],
    ['null', null],
    ['float', 2.5],
    ['negative', -1],
    ['exceeds total', 4],
  ])('rejects invalid completedChunks: %s', (_, completedChunks) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, completedChunks })).toBeUndefined()
  })

  it.each([
    ['string', '8000'],
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['too large', 5000001],
  ])('rejects invalid totalCharacters: %s', (_, totalCharacters) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, totalCharacters })).toBeUndefined()
  })

  it.each([
    ['string', '7000'],
    ['null', null],
    ['negative', -1],
    ['exceeds total', 8001],
  ])('rejects invalid coveredCharacters: %s', (_, coveredCharacters) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, coveredCharacters })).toBeUndefined()
  })

  it('rejects multichunk with not-needed globalStatus', () => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, globalStatus: 'not-needed' })).toBeUndefined()
  })

  it('rejects single-chunk complete with non-not-needed globalStatus', () => {
    const single = { ...validComplete, totalChunks: 1, completedChunks: 1 }
    expect(normalizeStoredReviewCoverage({ ...single, globalStatus: 'complete' })).toBeUndefined()
    expect(normalizeStoredReviewCoverage({ ...single, globalStatus: 'pending' })).toBeUndefined()
  })

  it.each([
    ['string', '1'],
    ['null', null],
    ['zero', 0],
    ['exceeds total', 4],
  ])('rejects invalid optional failedChunk: %s', (_, failedChunk) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, status: 'failed', failedChunk })).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['too long', 'x'.repeat(2001)],
  ])('rejects invalid optional error: %s', (_, error) => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, status: 'failed', error })).toBeUndefined()
  })

  it('omits undefined optional fields in output', () => {
    const result = normalizeStoredReviewCoverage(validComplete)
    expect(result).not.toHaveProperty('failedChunk')
    expect(result).not.toHaveProperty('error')
  })

  it('does not mutate input', () => {
    const input = { ...validComplete, extra: 'removed' }
    const result = normalizeStoredReviewCoverage(input)
    expect(input).toHaveProperty('extra')
    expect(result).not.toHaveProperty('extra')
  })
})

describe('isReviewCoverageComplete', () => {
  const source = 'x'.repeat(8000)

  it('counts raw source characters including spaces and requires the current signature for same-length edits', () => {
    const text = '甲 \n乙'
    const record = { ...validComplete, totalChunks: 1, completedChunks: 1, coveredCharacters: text.length, totalCharacters: text.length, globalStatus: 'not-needed' }
    expect(isReviewCoverageComplete(record, 'abc123', text)).toBe(true)
    expect(isReviewCoverageComplete(record, 'new-content-signature', '丙 \n丁')).toBe(false)
    expect(isReviewCoverageComplete(record, 'abc123', '甲乙')).toBe(false)
  })

  it.each([
    { coveredCharacters: 7000 }, { completedChunks: 2 }, { globalStatus: 'pending' }, { failedChunk: 1 }, { error: '' },
  ])('ignores an internally inconsistent persisted complete record: %j', patch => {
    expect(normalizeStoredReviewCoverage({ ...validComplete, ...patch })).toBeUndefined()
  })

  it('returns true for valid complete multichunk coverage', () => {
    expect(isReviewCoverageComplete(validComplete, 'abc123', source)).toBe(true)
  })

  it('returns true for valid complete single-chunk coverage', () => {
    const single = { ...validComplete, totalChunks: 1, completedChunks: 1, globalStatus: 'not-needed' as const }
    expect(isReviewCoverageComplete(single, 'abc123', source)).toBe(true)
  })

  it('returns false when signature mismatch', () => {
    expect(isReviewCoverageComplete(validComplete, 'wrong', source)).toBe(false)
  })

  it('returns false when totalCharacters mismatch', () => {
    expect(isReviewCoverageComplete(validComplete, 'abc123', 'x'.repeat(9000))).toBe(false)
  })

  it('returns false when status not complete', () => {
    expect(isReviewCoverageComplete({ ...validComplete, status: 'running' }, 'abc123', source)).toBe(false)
  })

  it('returns false when completedChunks < totalChunks', () => {
    expect(isReviewCoverageComplete({ ...validComplete, completedChunks: 2 }, 'abc123', source)).toBe(false)
  })

  it('returns false when coveredCharacters < totalCharacters', () => {
    expect(isReviewCoverageComplete({ ...validComplete, coveredCharacters: 7000 }, 'abc123', source)).toBe(false)
  })

  it('returns false when multichunk globalStatus not complete', () => {
    expect(isReviewCoverageComplete({ ...validComplete, globalStatus: 'pending' }, 'abc123', source)).toBe(false)
  })

  it('returns false when single-chunk globalStatus not not-needed', () => {
    const single = { ...validComplete, totalChunks: 1, completedChunks: 1, globalStatus: 'complete' as const }
    expect(isReviewCoverageComplete(single, 'abc123', source)).toBe(false)
  })

  it('returns false when failedChunk present', () => {
    expect(isReviewCoverageComplete({ ...validComplete, failedChunk: 1 }, 'abc123', source)).toBe(false)
  })

  it('returns false when error present', () => {
    expect(isReviewCoverageComplete({ ...validComplete, error: 'oops' }, 'abc123', source)).toBe(false)
  })

  it('returns false for invalid coverage', () => {
    expect(isReviewCoverageComplete({ ...validComplete, totalChunks: '3' }, 'abc123', source)).toBe(false)
    expect(isReviewCoverageComplete(null, 'abc123', source)).toBe(false)
  })
})
