import { describe, expect, it } from 'vitest'
import type { KBEntry, KnowledgeBase, KnowledgeSummarySource } from '@/types/knowledge'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { testKnowledgeCoverage } from '@/test/knowledgeCoverageFixture'
import {
  baseSourceVersion,
  createBaseSummarySource,
  createEntrySummarySource,
  entrySourceVersion,
  getBaseSummaryStatus,
  getCurrentBaseSummary,
  getCurrentEntrySummary,
  getEntrySummaryStatus,
} from './knowledgeSources'

const now = '2026-10-27T00:00:00.000Z'

function entry(overrides: Partial<KBEntry> = {}): KBEntry {
  return {
    id: 'entry-1',
    category: '世界观',
    title: '封存室',
    content: '封存室位于旧塔底层。',
    summary: '',
    tags: ['旧塔'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function base(entries: KBEntry[] = [entry()], overrides: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'kb-1',
    name: '世界设定',
    description: '基础设定',
    entries,
    createdAt: now,
    ...overrides,
  }
}

describe('knowledge summary sources', () => {
  it('requires full current-source coverage for AI and does not trust an old unrecorded AI summary', () => {
    const item = entry({ summary: '摘要' })
    const coverage = testKnowledgeCoverage('kb-1', [item])
    expect(() => createEntrySummarySource('kb-1', item, item.summary, 'ai', now)).toThrow('完整覆盖记录')
    const valid = createEntrySummarySource('kb-1', item, item.summary, 'ai', now, coverage)
    const noCoverage = { ...valid, coverage: undefined }
    expect(getEntrySummaryStatus('kb-1', { ...item, summarySource: noCoverage })).toBe('unverified')
    const changed = { ...item, content: '改变后的正文' }
    expect(() => createEntrySummarySource('kb-1', changed, item.summary, 'ai', now, coverage)).toThrow('完整覆盖记录')
    const whole = base([item, entry({ id: 'entry-2' })])
    expect(() => createBaseSummarySource(whole, '整库摘要', 'ai', now, coverage)).toThrow('完整覆盖记录')
    const author = createEntrySummarySource('kb-1', item, '作者核对新摘要', 'author', now, coverage)
    expect(author.coverage).toBeUndefined()
    coverage.sources[0].ranges[0].end--
    expect(valid.coverage?.sources[0].ranges[0].end).toBe(item.content.length)
  })

  it('copies the original knowledge types and uses raw entry fields for the version', () => {
    const source = entry({ content: 'A😀B', tags: ['一', '二'] })
    const expected = buildAnalysisSourceVersionId(JSON.stringify({
      knowledgeBaseId: 'kb-1',
      id: source.id,
      title: source.title,
      category: source.category,
      content: source.content,
      tags: source.tags,
    }))

    expect(entrySourceVersion('kb-1', source)).toBe(expected)
    expect(entrySourceVersion('kb-1', { ...source, content: 'A😃B' })).not.toBe(entrySourceVersion('kb-1', source))
    expect(entrySourceVersion('kb-1', { ...source, content: 'A B' })).not.toBe(entrySourceVersion('kb-1', source))
    expect(entrySourceVersion('kb-1', { ...source, title: '封存间' })).not.toBe(entrySourceVersion('kb-1', source))
    expect(entrySourceVersion('kb-1', { ...source, tags: ['旧塔', '钥匙'] })).not.toBe(entrySourceVersion('kb-1', source))
  })

  it('creates entry and base sources while preserving the exact summary text', () => {
    const sourceEntry = entry()
    const summary = '  摘要保留原样。\n'
    const entrySource = createEntrySummarySource('kb-1', sourceEntry, summary, 'author', now)
    expect(entrySource).toEqual({
      kind: 'entry',
      knowledgeBaseId: 'kb-1',
      entryId: sourceEntry.id,
      sourceVersionId: entrySourceVersion('kb-1', sourceEntry),
      derivedValue: summary,
      origin: 'author',
      createdAt: now,
    })

    const summarizedEntry = { ...sourceEntry, summary, summarySource: entrySource }
    const sourceBase = base([summarizedEntry])
    const baseSummary = '整库摘要。'
    const coverage = testKnowledgeCoverage(sourceBase.id, sourceBase.entries)
    const baseSource = createBaseSummarySource(sourceBase, baseSummary, 'ai', now, coverage)
    expect(baseSource).toEqual({
      kind: 'base',
      knowledgeBaseId: sourceBase.id,
      sourceVersionId: baseSourceVersion(sourceBase),
      derivedValue: baseSummary,
      origin: 'ai',
      createdAt: now,
      coverage,
    })
  })

  it('requires nonempty bodies and rejects blank summaries, invalid origins, and invalid dates', () => {
    expect(() => createEntrySummarySource('', entry(), '摘要', 'ai', now)).toThrow('knowledgeBaseId不能为空')
    expect(() => createEntrySummarySource('kb-1', entry({ id: '   ' }), '摘要', 'ai', now)).toThrow('条目来源绑定')
    expect(() => createEntrySummarySource('kb-1', entry({ content: ' \n' }), '摘要', 'ai', now)).toThrow('条目来源绑定')
    expect(() => createEntrySummarySource('kb-1', entry(), ' \n', 'ai', now)).toThrow('摘要不能为空')
    expect(() => createEntrySummarySource('kb-1', entry(), '摘要', 'system' as 'ai', now)).toThrow('origin 无效')
    expect(() => createEntrySummarySource('kb-1', entry(), '摘要', 'ai', '2026-02-30T00:00:00Z')).toThrow('createdAt 必须是有效日期')
    expect(() => createEntrySummarySource('kb-1', entry(), '摘要', 'ai', '2026-10-27')).toThrow('createdAt 必须是有效日期')
    expect(() => createBaseSummarySource(base([]), '摘要', 'ai', now)).toThrow('至少一条正文非空')
    expect(() => createBaseSummarySource(base(), '   ', 'ai', now)).toThrow('摘要不能为空')
  })

  it('marks an entry current only for its exact source, then detects source and value changes', () => {
    const original = entry({ content: '原文包含 Unicode 😀 和换行。\n' })
    const summary = '原始摘要\n'
    const source = createEntrySummarySource('kb-1', original, summary, 'ai', now, testKnowledgeCoverage('kb-1', [original]))
    const current = { ...original, summary, summarySource: source }

    expect(getEntrySummaryStatus('kb-1', current)).toBe('current')
    expect(getCurrentEntrySummary('kb-1', current)).toBe(summary)
    expect(getEntrySummaryStatus('kb-1', { ...current, content: '原文改写了。\n' })).toBe('stale')
    expect(getEntrySummaryStatus('kb-1', { ...current, content: original.content })).toBe('current')
    expect(getEntrySummaryStatus('kb-1', { ...current, content: '   ' })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...current, tags: ['正常', 1] as unknown as string[] })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...current, summary: '原始摘要' })).toBe('stale')
    expect(getEntrySummaryStatus('kb-1', { ...current, summarySource: { ...source, derivedValue: '原始摘要' } })).toBe('stale')
    expect(getEntrySummaryStatus('kb-1', { ...current, summarySource: { ...source, knowledgeBaseId: 'other-kb' } })).toBe('stale')
    expect(getEntrySummaryStatus('other-kb', current)).toBe('stale')
  })

  it('does not auto-promote a summary with no source and ignores history without a source', () => {
    const oldSummary = '历史摘要。'
    const candidate = entry({
      summary: oldSummary,
      summaryHistory: [{ id: 'history-1', summary: oldSummary, savedAt: now }],
    })

    expect(getEntrySummaryStatus('kb-1', candidate)).toBe('unverified')
    expect(getCurrentEntrySummary('kb-1', candidate)).toBe('')
    expect(getBaseSummaryStatus(base([candidate], {
      summary: '旧整库摘要。',
      summaryHistory: [{ id: 'history-2', summary: '旧整库摘要。', savedAt: now }],
    }))).toBe('unverified')
  })

  it('marks a base current and invalidates it on entry add, delete, content, or confirmed summary changes', () => {
    const first = entry({ summary: '条目摘要。' })
    first.summarySource = createEntrySummarySource('kb-1', first, first.summary, 'ai', now, testKnowledgeCoverage('kb-1', [first]))
    const original = base([first])
    const summary = '整库摘要。'
    const source = createBaseSummarySource(original, summary, 'ai', now, testKnowledgeCoverage(original.id, original.entries))
    const current = { ...original, summary, summarySource: source }

    expect(getBaseSummaryStatus(current)).toBe('current')
    expect(getCurrentBaseSummary(current)).toBe(summary)
    expect(getBaseSummaryStatus({ ...current, entries: [...current.entries, entry({ id: 'entry-2' })] })).toBe('stale')
    expect(getBaseSummaryStatus({ ...current, entries: [] })).toBe('unverified')
    expect(getBaseSummaryStatus({ ...current, entries: [{ ...first, content: '   ' }] })).toBe('unverified')
    expect(getBaseSummaryStatus({ ...current, entries: [{ ...first, content: '内容改了。' }] })).toBe('stale')

    const changedSummary = '条目摘要改了。'
    const confirmedChanged = entry({ ...first, summary: changedSummary })
    confirmedChanged.summarySource = createEntrySummarySource('kb-1', confirmedChanged, changedSummary, 'author', now)
    expect(getBaseSummaryStatus({ ...current, entries: [confirmedChanged] })).toBe('stale')
  })

  it('rejects malformed and cross-target sources without letting them become current', () => {
    const sourceEntry = entry({ summary: '摘要。' })
    const source = createEntrySummarySource('kb-1', sourceEntry, sourceEntry.summary, 'ai', now, testKnowledgeCoverage('kb-1', [sourceEntry]))
    const malformed = { ...source, createdAt: 'not-a-date' } as KnowledgeSummarySource

    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: malformed })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, createdAt: '2026-02-30T00:00:00Z' } })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, knowledgeBaseId: '   ' } })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, entryId: '   ' } })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, origin: 'system' } as unknown as KnowledgeSummarySource })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, kind: 'base' } as KnowledgeSummarySource })).toBe('unverified')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, entryId: 'other-entry' } })).toBe('stale')
    expect(getEntrySummaryStatus('kb-1', { ...sourceEntry, summarySource: { ...source, sourceVersionId: '' } })).toBe('unverified')

    const summarizedBase = base([sourceEntry], { summary: '整库摘要。' })
    const baseSource = createBaseSummarySource(summarizedBase, summarizedBase.summary!, 'ai', now, testKnowledgeCoverage(summarizedBase.id, summarizedBase.entries))
    expect(getBaseSummaryStatus({ ...summarizedBase, summarySource: { ...baseSource, entryId: 'unexpected' } })).toBe('unverified')
    expect(getBaseSummaryStatus({ ...summarizedBase, summarySource: { ...baseSource, createdAt: '2026-02-30T00:00:00Z' } })).toBe('unverified')
    expect(getBaseSummaryStatus({ ...summarizedBase, summarySource: { ...baseSource, knowledgeBaseId: 'other-kb' } })).toBe('stale')
    expect(getBaseSummaryStatus({ ...summarizedBase, entries: [{ ...sourceEntry, id: 'entry-1' }, { ...sourceEntry, id: 'entry-1' }] })).toBe('unverified')
    expect(getBaseSummaryStatus({ ...summarizedBase, entries: [{ ...sourceEntry, tags: ['ok', 1] as unknown as string[] }] })).toBe('unverified')
  })
})
