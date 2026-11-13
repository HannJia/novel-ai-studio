import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAutonomousChapterReview, extractAutonomousChapterCandidates } from './reconstructionAutonomousReview'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from './reconstructionCandidates'
import { callAI } from './ai'
import type { Chapter, Novel } from '@/types/novel'
import type { ModelConfig } from '@/stores/config'
import type { AiRequestLifecycle } from './ai'

vi.mock('./ai', () => ({ callAI: vi.fn() }))
const chapter = { id: 'chapter-1', volumeIndex: 0, chapterIndex: 0, title: '第一章', content: '林澈取走黑色徽章。',
  summary: '', wordCount: 10, status: 'writing', createdAt: '2026-10-27T05:00:00.000Z', updatedAt: '2026-10-27T05:00:00.000Z' } as Chapter
const novel = { id: 'novel-1', chapters: [chapter], characters: [], chapterPlans: [], dataPanels: [], dataPanelChanges: [],
  storyArcs: [], eventLog: [] } as unknown as Novel
const model = { id: 'test', modelName: 'test' } as ModelConfig
const passed = '## 审核结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无'

beforeEach(() => vi.clearAllMocks())

describe('autonomous structured review', () => {
  it('retains only the current chapter version candidates and distinguishes review outcomes', () => {
    const candidates = buildChapterAnalysisCandidates(novel, chapter, buildAnalysisSourceVersionId(chapter.content), {
      events: [{ title: '得到徽章', evidence: '取走黑色徽章' }],
    })
    const result = buildAutonomousChapterReview({ chapter, contextVersion: 'context-1', report: passed, candidates: [
      ...candidates,
      { ...candidates[0], id: 'old', sourceVersionId: 'old-content' },
      { ...candidates[0], id: 'foreign', chapterId: 'chapter-2' },
    ] })
    expect(result.review.status).toBe('ready_to_finalize')
    expect(result.candidates).toEqual(candidates)
    const failed = buildAutonomousChapterReview({ chapter, contextVersion: 'context-1', report: '总体判断：必须修改\n## 必改问题\n1. [时间线] 先后矛盾' })
    expect(failed.review.status).toBe('needs_revision')
    expect(failed.findings[0]).toMatchObject({ severity: 'blocker', type: 'timeline' })
  })

  it('blocks finalization when story-memory extraction is incomplete even if prose passes', () => {
    const result = buildAutonomousChapterReview({ chapter, contextVersion: 'context-1', report: passed, candidateExtractionError: '结构化输出不完整' })
    expect(result.review.status).toBe('needs_revision')
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'knowledge', severity: 'blocker', status: 'open', blocksFinalization: true }),
    ]))
  })

  it('extracts evidence-backed candidates without applying them to Canon', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ events: [{ title: '得到徽章', evidence: '取走黑色徽章' }], characters: [], knowledgeChanges: [], relationshipChanges: [] }),
      finishReason: 'stop', usage: { total_tokens: 23 } } as never)
    const result = await extractAutonomousChapterCandidates({ novel, chapter, model })
    expect(result).toMatchObject({ usedTokens: 23 })
    expect(result.error).toBeUndefined()
    expect(result.candidates[0]).toMatchObject({ status: 'proposed', sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
      evidence: [expect.objectContaining({ quote: '取走黑色徽章' })] })
    expect(novel.eventLog).toEqual([])
  })

  it('forwards the request lifecycle to candidate extraction', async () => {
    const lifecycle: AiRequestLifecycle = {
      beforeRequest: vi.fn(async () => undefined),
      afterRequest: vi.fn(async () => undefined),
    }
    vi.mocked(callAI).mockResolvedValue({
      content: JSON.stringify({ events: [], characters: [], knowledgeChanges: [], relationshipChanges: [] }),
      finishReason: 'stop',
    } as never)

    await extractAutonomousChapterCandidates({ novel, chapter, model, requestLifecycle: lifecycle })

    expect(vi.mocked(callAI).mock.calls[0][0].requestLifecycle).toBe(lifecycle)
  })

  it.each(['not json', '{"events":[]}', '{"events":[],"characters":[]}', '{"events":[],"characters":[],"knowledgeChanges":{},"relationshipChanges":[]}'])('reports malformed extraction as a failure: %s', async content => {
    vi.mocked(callAI).mockResolvedValue({ content, usage: { total_tokens: 10 } } as never)
    expect(await extractAutonomousChapterCandidates({ novel, chapter, model })).toMatchObject({ candidates: [], usedTokens: 10, error: expect.any(String) })
  })

  it('accepts a valid empty extraction but rejects truncated output', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '{"events":[],"characters":[],"knowledgeChanges":[],"relationshipChanges":[]}', finishReason: 'stop' } as never)
    expect((await extractAutonomousChapterCandidates({ novel, chapter, model })).error).toBeUndefined()
    vi.mocked(callAI).mockResolvedValue({ content: '{"events":[],"characters":[]}', finishReason: 'length' } as never)
    expect((await extractAutonomousChapterCandidates({ novel, chapter, model })).error).toBeTruthy()
  })

  it('returns knowledge and directional relationship candidates awaiting author approval', async () => {
    const text = '林澈知道徽章已经失窃，开始怀疑苏禾。'
    vi.mocked(callAI).mockResolvedValue({ finishReason: 'stop', content: JSON.stringify({ events: [], characters: [],
      knowledgeChanges: [{ characterName: '林澈', fact: '徽章已经失窃', state: 'knows', evidence: '林澈知道徽章已经失窃' }],
      relationshipChanges: [{ characterName: '林澈', targetCharacterName: '苏禾', relation: '怀疑', evidence: text }],
    }) } as never)
    const result = await extractAutonomousChapterCandidates({ novel, chapter: { ...chapter, content: text }, model })
    expect(result.candidates.map(candidate => [candidate.type, candidate.status])).toEqual([['knowledge', 'proposed'], ['relationship', 'proposed']])
    expect(result.candidates.every(candidate => candidate.evidence.length === 1)).toBe(true)
    expect(vi.mocked(callAI).mock.calls[0][0].messages[1].content).toContain('A 信任 B 不表示 B 信任 A')
  })
})
