import { describe, expect, it } from 'vitest'
import type { Chapter } from '@/types/novel'
import type { ChapterSourceBinding } from '@/types/derivedSources'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import {
  createChapterSourceBinding,
  getChapterSummaryStatus,
  getCurrentChapterSummary,
  inspectChapterSource,
} from './derivedSources'

const now = '2026-10-27T00:00:00.000Z'

function chapter(content = '林澈走进封存室。'): Pick<Chapter, 'id' | 'content'> {
  return { id: 'chapter-1', content }
}

function bindingFor(content = chapter().content, derivedValue = '林澈进入封存室。'): ChapterSourceBinding {
  return createChapterSourceBinding(chapter(content), derivedValue, 'ai', now)
}

describe('derived chapter source validation', () => {
  it('creates a binding from the complete body and preserves the derived value exactly', () => {
    const source = chapter('  林澈走进封存室。\n')
    const derivedValue = '  摘要保留原样。 \n'
    const result = createChapterSourceBinding(source, derivedValue, 'author', now)

    expect(result).toEqual({
      chapterId: source.id,
      sourceVersionId: buildAnalysisSourceVersionId(source.content),
      derivedValue,
      createdAt: now,
      origin: 'author',
    })
  })

  it.each([
    ['empty chapter id', { id: '   ', content: '正文' }],
    ['empty chapter content', { id: 'chapter-1', content: '\n \t' }],
  ])('rejects %s', (_, invalidChapter) => {
    expect(() => createChapterSourceBinding(invalidChapter, '摘要', 'ai', now)).toThrow()
  })

  it.each([
    ['empty derived value', '  \n'],
    ['invalid origin', 'system'],
    ['invalid date', 'not-a-date'],
  ])('rejects %s', (_, invalidValue) => {
    if (_ === 'empty derived value') {
      expect(() => createChapterSourceBinding(chapter(), invalidValue, 'ai', now)).toThrow()
    } else if (_ === 'invalid origin') {
      expect(() => createChapterSourceBinding(chapter(), '摘要', invalidValue as 'ai', now)).toThrow()
    } else {
      expect(() => createChapterSourceBinding(chapter(), '摘要', 'ai', invalidValue)).toThrow()
    }
  })

  it('returns current only for one matching source, unchanged complete content, and exact value', () => {
    const source = chapter('第一段。\n第二段。')
    const binding = bindingFor(source.content, '第一段摘要。')
    const chapters = Object.freeze([Object.freeze(source)])

    expect(inspectChapterSource(chapters, binding, '第一段摘要。')).toBe('current')
    expect(source).toEqual({ id: 'chapter-1', content: '第一段。\n第二段。' })
  })

  it('keeps a valid binding current when another chapter is an empty draft', () => {
    const source = chapter('完整正文。')
    const binding = bindingFor(source.content, '完整摘要。')

    expect(inspectChapterSource([
      source,
      { id: 'chapter-draft', content: '' },
    ], binding, binding.derivedValue)).toBe('current')
  })

  it('fails closed for no binding and malformed structures', () => {
    const source = chapter()
    const binding = bindingFor()

    expect(inspectChapterSource([source], undefined, binding.derivedValue)).toBe('unverified')
    expect(inspectChapterSource([source, { id: '', content: '' }], binding, binding.derivedValue)).toBe('unverified')
    expect(inspectChapterSource([{ id: 'chapter-1', content: '' }], binding, binding.derivedValue)).toBe('unverified')
    expect(inspectChapterSource([source], { ...binding, origin: 'system' } as unknown as ChapterSourceBinding, binding.derivedValue)).toBe('unverified')
    expect(inspectChapterSource([source], { ...binding, createdAt: 'invalid' }, binding.derivedValue)).toBe('unverified')
    expect(inspectChapterSource([source], { ...binding, sourceVersionId: '' }, binding.derivedValue)).toBe('unverified')
  })

  it('reports a missing or ambiguous source without selecting a chapter implicitly', () => {
    const binding = bindingFor()
    expect(inspectChapterSource([{ id: 'other', content: chapter().content }], binding, binding.derivedValue)).toBe('source_missing')
    expect(inspectChapterSource([
      chapter(),
      { id: 'chapter-1', content: '另一份同名来源。' },
    ], binding, binding.derivedValue)).toBe('source_missing')
  })

  it('detects same length body edits, including Unicode and whitespace changes', () => {
    const original = chapter('A😀B')
    const binding = bindingFor(original.content)

    expect(inspectChapterSource([chapter('A😃B')], binding, binding.derivedValue)).toBe('content_changed')
    expect(inspectChapterSource([chapter('A😀 B')], binding, binding.derivedValue)).toBe('content_changed')
    expect(inspectChapterSource([chapter('A😀B')], binding, binding.derivedValue)).toBe('current')
  })

  it('detects exact derived value changes, including whitespace', () => {
    const binding = bindingFor('正文', '摘要\n')
    const source = chapter('正文')

    expect(inspectChapterSource([source], binding, '摘要')).toBe('value_changed')
    expect(inspectChapterSource([source], binding, '摘要\n')).toBe('current')
  })

  it('returns current again after the exact original body is restored', () => {
    const original = '原文包含 Unicode 😀 和换行。\n'
    const binding = bindingFor(original, '原始摘要')
    expect(inspectChapterSource([chapter('原文被改写了。\n')], binding, binding.derivedValue)).toBe('content_changed')
    expect(inspectChapterSource([chapter(original)], binding, binding.derivedValue)).toBe('current')
  })

  it('maps summary validity without auto-binding old summaries', () => {
    const source = { ...chapter(), summary: '林澈进入封存室。' }
    const binding = createChapterSourceBinding(source, source.summary, 'ai', now)

    expect(getCurrentChapterSummary({ ...source, summarySource: binding })).toBe(source.summary)
    expect(getChapterSummaryStatus({ ...source, summarySource: binding })).toBe('current')

    expect(getCurrentChapterSummary(source)).toBe('')
    expect(getChapterSummaryStatus(source)).toBe('unverified')
    expect(Object.prototype.hasOwnProperty.call(source, 'summarySource')).toBe(false)
  })

  it('returns empty for empty summaries and stale for invalid existing sources', () => {
    const source = chapter()
    expect(getCurrentChapterSummary({ ...source, summary: '   ' })).toBe('')
    expect(getChapterSummaryStatus({ ...source, summary: '' })).toBe('empty')
    expect(getChapterSummaryStatus({ ...source, summary: '摘要', summarySource: undefined })).toBe('unverified')
    expect(getChapterSummaryStatus({
      ...source,
      summary: '摘要',
      summarySource: { ...bindingFor(), derivedValue: '其他摘要' },
    })).toBe('stale')
    expect(getChapterSummaryStatus({
      ...source,
      summary: '摘要',
      summarySource: { ...bindingFor(), sourceVersionId: 'missing-source-version' },
    })).toBe('stale')
  })
})

