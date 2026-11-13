import { describe, expect, it } from 'vitest'
import { chapterDraftSelection } from './chapterDraftGeneration'
import { validateSelectionRevision } from './selectionRevisionMetadata'
import type { ChapterRevision } from '@/types/novel'

describe('chapter draft source binding', () => {
  it.each([
    ['', '新章。'], ['开端。', '开端。结尾。'], ['甲'.repeat(15000), '甲'.repeat(15000) + '结尾。'],
    ['五月三日到达。', '五月四日到达。'], ['甲😀乙', '甲😎乙'], ['甲😀乙', '甲乙'], ['甲。\n\n', '甲。\n结尾。'],
  ])('roundtrips a candidate using the existing source guard (%#)', (baseContent, proposedContent) => {
    const source = { novelId: 'synthetic-book', chapterId: 'synthetic-chapter', baseContent, contextVersion: 'synthetic-context' }
    const selection = chapterDraftSelection(source, proposedContent)
    const revision: ChapterRevision = { ...source, proposedContent, selection, id: 'candidate', diff: '', source: 'ai', reason: '', status: 'pending', createdAt: '2026-10-31', updatedAt: '2026-10-31' }
    expect(() => validateSelectionRevision(revision)).not.toThrow()
  })

  it('reports unsupported replacement size explicitly rather than weakening the persisted guard', () => {
    expect(() => chapterDraftSelection({ novelId: 'book', chapterId: 'chapter', baseContent: '甲'.repeat(13000), contextVersion: 'context' }, '乙'.repeat(13000))).toThrow('选区不能超过')
  })
})
