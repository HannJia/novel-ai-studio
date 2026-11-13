import { describe, expect, it } from 'vitest'
import { deriveDeskReview } from './reviewDesk'

const coverage = { signature: 'current', totalChunks: 1, completedChunks: 1, coveredCharacters: 10,
  totalCharacters: 10, globalStatus: 'not-needed', status: 'complete' }
const input = { signature: 'current', characters: 10, coverage, reviewCurrent: true, running: false, hasPreviousReview: true }

describe('writing desk review validity', () => {
  it('does not show an unreviewed chapter as valid', () => {
    expect(deriveDeskReview({ ...input, coverage: undefined, reviewCurrent: false, hasPreviousReview: false }))
      .toMatchObject({ label: '尚未审校', valid: false, completed: 0 })
  })
  it('rejects old full coverage after an equal-length edit or a context change', () => {
    expect(deriveDeskReview({ ...input, signature: 'changed', reviewCurrent: false }))
      .toMatchObject({ label: '已失效', valid: false, completed: 0 })
  })
  it('requires the committed structured review in addition to completed segments', () => {
    expect(deriveDeskReview({ ...input, reviewCurrent: false })).toMatchObject({ label: '未完成', valid: false })
    expect(deriveDeskReview(input)).toMatchObject({ label: '有效', valid: true, completed: 1 })
  })
  it('shows current progress without claiming a finished review', () => {
    expect(deriveDeskReview({ ...input, reviewCurrent: false, running: true,
      coverage: { ...coverage, totalChunks: 3, completedChunks: 1, coveredCharacters: 4, globalStatus: 'pending', status: 'running' } }))
      .toMatchObject({ label: '审校中', valid: false, total: 3, completed: 1 })
  })
})
