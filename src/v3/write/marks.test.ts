import { describe, expect, it } from 'vitest'
import { anchorFindings, candidateAnchor, findingMarks, locateQuote, revisionPreview } from './marks'
import type { CandidateChange } from '@/types/reconstruction'
import type { ChapterRevision } from '@/types/novel'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { ReviewFinding } from '@/types/reconstruction'

const text = '他推门进来。灯还亮着。\n他推门进来。屋里没人。'

describe('locateQuote', () => {
  it('uses recorded offsets when the quote matches exactly', () => {
    expect(locateQuote(text, '他推门进来。', 12, 18)).toEqual({ start: 12, end: 18 })
  })
  it('falls back to the nearest unique occurrence when offsets drift', () => {
    expect(locateQuote(text, '他推门进来。', 10, 16)).toEqual({ start: 12, end: 18 })
    expect(locateQuote(text, '灯还亮着', 99, 120)).toEqual({ start: 6, end: 10 })
  })
  it('refuses to anchor an ambiguous or missing quote', () => {
    expect(locateQuote(text, '他推门进来。')).toBeNull()
    expect(locateQuote(text, '不存在的话')).toBeNull()
  })
  it('keeps a bare range without quote but drops empty ones', () => {
    expect(locateQuote(text, undefined, 0, 3)).toEqual({ start: 0, end: 3 })
    expect(locateQuote(text, undefined, 3, 3)).toBeNull()
  })
})

describe('anchorFindings', () => {
  const base = (over: Partial<ReviewFinding>): ReviewFinding => ({ id: 'x', type: 'continuity', severity: 'blocker', title: 't', explanation: '', chapterId: 'c',
    evidence: [], blocksFinalization: true, status: 'open', sourceVersionId: buildAnalysisSourceVersionId(text), ...over })

  it('hides findings from another text version and stale ones', () => {
    const items = anchorFindings(text, [base({ id: 'a', quotedText: '屋里没人' }), base({ id: 'b', sourceVersionId: 'old', quotedText: '屋里没人' }), base({ id: 'c', status: 'stale' })])
    expect(items.map(i => i.finding.id)).toEqual(['a'])
  })
  it('maps statuses and severities to mark classes', () => {
    const items = anchorFindings(text, [base({ id: 'a', quotedText: '屋里没人' }), base({ id: 'b', quotedText: '灯还亮着', severity: 'warning', status: 'accepted' })])
    expect(findingMarks(items).map(m => [m.id, m.cls])).toEqual([['f:b', 'mk-ok'], ['f:a', 'mk-block']])
  })
  it('将当前章节证据定位为伏笔标记，不借用其他章节引文', () => {
    const evidence = { id: 'e1', sourceType: 'chapter' as const, sourceId: 'c', quote: '屋里没人' }
    const items = anchorFindings(text, [base({ id: 'a', type: 'foreshadowing', evidence: [evidence] }),
      base({ id: 'b', evidence: [{ ...evidence, sourceId: 'another' }] })])
    expect(findingMarks(items)).toEqual([expect.objectContaining({ id: 'f:a', cls: 'mk-fs', start: text.indexOf('屋里没人') })])
  })
})

describe('候选页边定位', () => {
  const candidate = (over: Partial<CandidateChange> = {}): CandidateChange => ({ id: 'cand', novelId: 'n', chapterId: 'c', type: 'fact',
    proposedValue: '{}', status: 'proposed', createdAt: '', updatedAt: '', sourceVersionId: buildAnalysisSourceVersionId(text),
    evidence: [{ id: 'e1', sourceType: 'chapter', sourceId: 'c', sourceVersionId: buildAnalysisSourceVersionId(text), quote: '屋里没人', startOffset: 1, endOffset: 5 }], ...over })
  it('偏移漂移时使用经过校验的当前正文引文', () => {
    expect(candidateAnchor(text, candidate())).toEqual({ start: text.indexOf('屋里没人'), end: text.indexOf('屋里没人') + 4 })
  })
  it('拒绝旧版本、已决定记录、其他章节与含糊证据', () => {
    expect(candidateAnchor(text, candidate({ sourceVersionId: 'old' }))).toBeNull()
    expect(candidateAnchor(text, candidate({ status: 'accepted' }))).toBeNull()
    expect(candidateAnchor(text, candidate({ evidence: [{ id: 'e1', sourceType: 'chapter', sourceId: 'other', quote: '屋里没人' }] }))).toBeNull()
    expect(candidateAnchor(text, candidate({ evidence: [{ id: 'e1', sourceType: 'chapter', sourceId: 'c', quote: '屋里没人', sourceVersionId: 'old' }] }))).toBeNull()
    expect(candidateAnchor(text, candidate({ evidence: [{ id: 'e1', sourceType: 'chapter', sourceId: 'c', quote: '他推门进来。' }] }))).toBeNull()
  })
})

describe('正文修订浮签预览', () => {
  const revision = (baseContent: string, proposedContent: string, extra: Partial<ChapterRevision> = {}): ChapterRevision => ({ id: 'r', novelId: 'n', chapterId: 'c',
    baseContent, proposedContent, diff: '', source: 'ai', reason: '', status: 'pending', createdAt: '', updatedAt: '', ...extra })
  it('只显示准确的替换范围，不混入未改正文', () => {
    expect(revisionPreview(revision('前文。旧句。后文。', '前文。新句。后文。'), '前文。旧句。后文。', 'ctx'))
      .toEqual({ start: 3, end: 4, before: '旧', after: '新', current: true })
  })
  it('支持插入、删除，并保持 UTF-16 代理对完整', () => {
    expect(revisionPreview(revision('开头。结尾。', '开头。新增。结尾。'), '开头。结尾。', 'ctx')).toMatchObject({ start: 3, end: 3, before: '', after: '新增。' })
    expect(revisionPreview(revision('开头。删掉。', '开头。'), '开头。删掉。', 'ctx')).toMatchObject({ before: '删掉。', after: '' })
    expect(revisionPreview(revision('甲\uD83D\uDE00乙', '甲\uD83D\uDE03乙'), '甲\uD83D\uDE00乙', 'ctx')).toMatchObject({ start: 1, end: 3, before: '\uD83D\uDE00', after: '\uD83D\uDE03' })
  })
  it('正文或上下文改变后只可参考，不能作为当前浮签', () => {
    const pending = revision('旧正文', '新正文', { selection: { mode: 'rewrite', startOffset: 0, endOffset: 3, contextVersion: 'ctx' } })
    expect(revisionPreview(pending, '旧正文', 'ctx').current).toBe(true)
    expect(revisionPreview(pending, '已编辑', 'ctx').current).toBe(false)
    expect(revisionPreview(pending, '旧正文', 'changed').current).toBe(false)
    expect(revisionPreview({ ...pending, status: 'stale' }, '旧正文', 'ctx').current).toBe(false)
  })
})
