import { describe, expect, it } from 'vitest'
import type { KnowledgeSummaryCoverage } from '@/types/knowledge'
import {
  buildKnowledgeSummaryChunks,
  coverageMatchesSources,
  createKnowledgeSummaryCoverage,
  isKnowledgeSummaryCoverage,
} from './knowledgeSummaryCoverage'

function entry(overrides: Partial<{
  entryId: string
  sourceVersionId: string
  title: string
  category: string
  tags: string[]
  content: string
}> = {}) {
  return {
    entryId: 'entry-1',
    sourceVersionId: 'version-1',
    title: '标题',
    category: '世界观',
    tags: ['tag'],
    content: '正文',
    ...overrides,
  }
}

describe('knowledge summary coverage', () => {
  it('covers long UTF-16 text without splitting surrogate pairs or losing the tail', () => {
    const prefix = '甲'.repeat(11)
    const source = `${prefix}😀乙`.repeat(3) + '\n尾部文字\n'
    const chunks = buildKnowledgeSummaryChunks([entry({ content: source })], 12)

    expect(chunks.map(chunk => chunk.text).join('')).toBe(source)
    expect(chunks.map(chunk => chunk.text).join('')).toContain('尾部文字')
    expect(chunks.map(chunk => chunk.text).join('')).toMatch(/尾部文字\n$/)
    expect(chunks.every(chunk => chunk.text.length === chunk.end - chunk.start)).toBe(true)
    expect(chunks.every((chunk, index) => index === 0 || chunks[index - 1].end === chunk.start)).toBe(true)
    expect(chunks.every(chunk => {
      const first = chunk.text.charCodeAt(0)
      const last = chunk.text.charCodeAt(chunk.text.length - 1)
      return !(first >= 0xDC00 && first <= 0xDFFF) && !(last >= 0xD800 && last <= 0xDBFF)
    })).toBe(true)
    expect(chunks.every(chunk => chunk.contentLength === source.length)).toBe(true)
  })

  it('handles boundaries, empty content, metadata, and validation failures', () => {
    const exact = buildKnowledgeSummaryChunks([entry({ content: 'abcd' })], 2)
    expect(exact.map(chunk => [chunk.start, chunk.end, chunk.text])).toEqual([
      [0, 2, 'ab'], [2, 4, 'cd'],
    ])

    const empty = buildKnowledgeSummaryChunks([entry({ content: '', tags: [] })], 2)
    expect(empty).toEqual([expect.objectContaining({ start: 0, end: 0, text: '', title: '标题', tags: [] })])
    expect(() => buildKnowledgeSummaryChunks([entry({ content: 'x' })], 1)).toThrow()
    expect(() => buildKnowledgeSummaryChunks([entry(), entry({ entryId: 'entry-1', sourceVersionId: 'version-2' })])).toThrow()
    expect(() => buildKnowledgeSummaryChunks([entry(), entry({ entryId: 'entry-2' })])).toThrow()
    expect(() => buildKnowledgeSummaryChunks([entry({ entryId: '  ' })])).toThrow()
    expect(() => buildKnowledgeSummaryChunks([entry({ content: 3 as unknown as string })])).toThrow()
  })

  it('creates coverage with complete source ranges and metrics', () => {
    const chunks = buildKnowledgeSummaryChunks([
      entry({ content: 'abcdef' }),
      entry({ entryId: 'entry-2', sourceVersionId: 'version-2', content: '', title: '空条目' }),
    ], 3)
    const coverage = createKnowledgeSummaryCoverage(chunks, {
      requestCount: 3,
      inputTokens: 120,
      outputTokens: 40,
      usageEstimated: true,
    })

    expect(coverage).toEqual({
      version: 1,
      strategy: 'full-source-hierarchical',
      sources: [
        { entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 6, ranges: [{ start: 0, end: 3 }, { start: 3, end: 6 }] },
        { entryId: 'entry-2', sourceVersionId: 'version-2', contentLength: 0, ranges: [{ start: 0, end: 0 }] },
      ],
      leafCount: 3,
      requestCount: 3,
      inputTokens: 120,
      outputTokens: 40,
      usageEstimated: true,
    })
    expect(isKnowledgeSummaryCoverage(coverage)).toBe(true)
    expect(coverageMatchesSources(coverage, [
      { entryId: 'entry-2', sourceVersionId: 'version-2', contentLength: 0 },
      { entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 6 },
    ])).toBe(true)
    expect(coverageMatchesSources(coverage, [
      { entryId: 'entry-1', sourceVersionId: 'version-other', contentLength: 6 },
      { entryId: 'entry-2', sourceVersionId: 'version-2', contentLength: 0 },
    ])).toBe(false)
    expect(() => createKnowledgeSummaryCoverage(chunks, {
      requestCount: 2,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
    })).toThrow()
  })

  it('rejects coverage without any source while allowing an all-empty source entry', () => {
    expect(buildKnowledgeSummaryChunks([])).toEqual([])
    expect(() => createKnowledgeSummaryCoverage([], {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
    })).toThrow()
    expect(isKnowledgeSummaryCoverage({
      version: 1,
      strategy: 'full-source-hierarchical',
      sources: [],
      leafCount: 0,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
    })).toBe(false)

    const chunks = buildKnowledgeSummaryChunks([entry({ content: '' })])
    const coverage = createKnowledgeSummaryCoverage(chunks, {
      requestCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
    })
    expect(coverage.sources).toEqual([expect.objectContaining({ contentLength: 0, ranges: [{ start: 0, end: 0 }] })])
    expect(isKnowledgeSummaryCoverage(coverage)).toBe(true)
  })

  it('rejects gaps, overlaps, duplicate chunks, malformed shapes, and invalid statistics', () => {
    const chunks = buildKnowledgeSummaryChunks([entry({ content: 'abcdef' })], 3)
    const withRange = (range: { start: number; end: number }) => chunks.map((chunk, index) => index === 0
      ? { ...chunk, ...range, text: 'abc'.slice(0, range.end - range.start) }
      : chunk)

    expect(() => createKnowledgeSummaryCoverage(withRange({ start: 1, end: 3 }), {
      requestCount: 2, inputTokens: 0, outputTokens: 0, usageEstimated: false,
    })).toThrow()
    expect(() => createKnowledgeSummaryCoverage(withRange({ start: 0, end: 4 }), {
      requestCount: 2, inputTokens: 0, outputTokens: 0, usageEstimated: false,
    })).toThrow()
    expect(() => createKnowledgeSummaryCoverage([chunks[0], chunks[0]], {
      requestCount: 2, inputTokens: 0, outputTokens: 0, usageEstimated: false,
    })).toThrow()

    const base = createKnowledgeSummaryCoverage(chunks, {
      requestCount: 2, inputTokens: 0, outputTokens: 0, usageEstimated: false,
    })
    const malformed = [
      { ...base, strategy: 'other' },
      { ...base, leafCount: 3 },
      { ...base, requestCount: 1 },
      { ...base, inputTokens: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, usageEstimated: 'false' },
      { ...base, extra: true },
      { ...base, sources: [{ ...base.sources[0], ranges: [{ start: 0, end: 2 }, { start: 3, end: 6 }] }] },
      { ...base, sources: [{ ...base.sources[0], ranges: [{ start: 0, end: 4 }, { start: 3, end: 6 }] }] },
      { ...base, sources: [{ ...base.sources[0], ranges: [{ start: 0, end: 6 }, { start: 0, end: 0 }] }] },
      { ...base, sources: [{ ...base.sources[0], entryId: '' }] },
      { ...base, sources: [{ ...base.sources[0], ranges: [] }] },
    ]
    for (const value of malformed) expect(isKnowledgeSummaryCoverage(value)).toBe(false)
  })

  it('requires source identity and version to match exactly', () => {
    const coverage = createKnowledgeSummaryCoverage(buildKnowledgeSummaryChunks([
      entry({ content: 'one' }),
    ], 2), { requestCount: 2, inputTokens: 1, outputTokens: 1, usageEstimated: false })

    expect(coverageMatchesSources(coverage, [{ entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 3 }])).toBe(true)
    expect(coverageMatchesSources(coverage, [{ entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 4 }])).toBe(false)
    expect(coverageMatchesSources(coverage, [{ entryId: 'entry-1', sourceVersionId: 'version-2', contentLength: 3 }])).toBe(false)
    expect(coverageMatchesSources(coverage, [
      { entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 3 },
      { entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 3 },
    ])).toBe(false)
  })

  it('does not accept a coverage with duplicate source identity or version', () => {
    const source = { entryId: 'entry-1', sourceVersionId: 'version-1', contentLength: 1, ranges: [{ start: 0, end: 1 }] }
    const base: KnowledgeSummaryCoverage = {
      version: 1,
      strategy: 'full-source-hierarchical',
      sources: [source],
      leafCount: 1,
      requestCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
    }
    expect(isKnowledgeSummaryCoverage({ ...base, sources: [source, { ...source, entryId: 'entry-2' }], leafCount: 2 })).toBe(false)
    expect(isKnowledgeSummaryCoverage({ ...base, sources: [source, { ...source, sourceVersionId: 'version-2' }], leafCount: 2 })).toBe(false)
  })
})
