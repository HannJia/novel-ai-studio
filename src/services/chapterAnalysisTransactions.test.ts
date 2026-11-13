import { describe, expect, it } from 'vitest'
import type { Chapter, Novel } from '@/types/novel'
import type { CandidateChange, CanonMutationRecord } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { captureChapterAnalysisBaseline, chapterAnalysisCandidateIdentity, commitChapterAnalysis } from './chapterAnalysisTransactions'
import type { StoryAggregate } from './storyAggregate'

const now = '2026-11-09T00:00:00.000Z'

function makeNovel(content = '林澈拿到了钥匙。'): Novel {
  const chapter: Chapter = {
    id: 'chapter-1', volumeIndex: -1, chapterIndex: 0, title: '雾中渡口', content,
    summary: '', wordCount: content.length, status: 'completed', createdAt: now, updatedAt: now,
  }
  return {
    id: 'novel-1', title: '接口验收', genre: 'mystery', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [],
    targetWordCountMin: 1, targetWordCountMax: 2, currentWordCount: content.length,
    writingStyle: {} as Novel['writingStyle'], settings: { protagonist: { name: '林澈' } } as Novel['settings'],
    outline: '', synopsis: '', volumes: [], chapters: [chapter], characters: [], chatHistory: [], knowledgeBaseIds: [],
    eventLog: [], storyArcs: [], dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: now, updatedAt: now,
  } as Novel
}

function makeCandidate(novel: Novel, overrides: Partial<CandidateChange> = {}): CandidateChange {
  const chapter = novel.chapters[0]
  const sourceVersionId = buildAnalysisSourceVersionId(chapter.content)
  return {
    id: 'candidate-original', novelId: novel.id, chapterId: chapter.id, type: 'fact', sourceVersionId,
    proposedValue: JSON.stringify({ title: '取得钥匙', description: '主角获得关键物件', characters: ['林澈'], eventType: '主线' }),
    evidence: [{ id: 'evidence-original', sourceType: 'chapter', sourceId: chapter.id, sourceVersionId,
      quote: '林澈拿到了钥匙。' }], status: 'accepted', source: 'ai', confidence: 'confirmed', createdAt: now, updatedAt: now,
    ...overrides,
  }
}

function aggregate(novel: Novel, candidates: CandidateChange[] = [], canonMutations: CanonMutationRecord[] = []): StoryAggregate {
  return { novel, workspace: { candidates, reviewFindings: [], chapterReviews: [], aiRuns: [], canonMutations } }
}

function submission(aggregate: StoryAggregate, candidates: CandidateChange[]) {
  const chapter = aggregate.novel.chapters[0]
  return {
    chapterId: chapter.id,
    sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    baseline: captureChapterAnalysisBaseline(aggregate.novel, chapter, aggregate.workspace.canonMutations),
    candidates,
    dataProposals: [],
  }
}

describe('chapter analysis candidate history', () => {
  it('uses a stable identity when a retry changes candidate and evidence IDs', () => {
    const novel = makeNovel()
    const original = makeCandidate(novel)
    const retry = makeCandidate(novel, {
      id: 'candidate-retry',
      status: 'proposed',
      proposedValue: JSON.stringify({ eventType: '主线', characters: ['林澈'], description: '主角获得关键物件', title: '取得钥匙' }),
      evidence: [{ id: 'evidence-retry', label: '模型重新标注', sourceType: 'chapter', sourceId: 'chapter-1',
        sourceVersionId: original.sourceVersionId, quote: '林澈拿到了钥匙。' }],
    })
    expect(chapterAnalysisCandidateIdentity(original)).toBe(chapterAnalysisCandidateIdentity(retry))

    const result = commitChapterAnalysis(aggregate(novel, [original]), submission(aggregate(novel, [original]), [retry]), now, () => 'unused')
    expect(result).toEqual({ changed: false, candidates: 0, dataChanges: 0 })
  })

  it('ignores evidence ordering when the same proposition is reanalysed', () => {
    const novel = makeNovel()
    const original = makeCandidate(novel, {
      evidence: [
        { id: 'evidence-a', sourceType: 'chapter', sourceId: 'chapter-1', sourceVersionId: buildAnalysisSourceVersionId(novel.chapters[0].content), quote: '林澈拿到了钥匙。' },
        { id: 'evidence-b', sourceType: 'chapter', sourceId: 'chapter-1', sourceVersionId: buildAnalysisSourceVersionId(novel.chapters[0].content), quote: '拿到了钥匙。' },
      ],
    })
    const retry = makeCandidate(novel, {
      id: 'candidate-reordered', status: 'proposed',
      evidence: [
        { id: 'evidence-new-b', sourceType: 'chapter', sourceId: 'chapter-1', sourceVersionId: original.sourceVersionId, quote: '拿到了钥匙。' },
        { id: 'evidence-new-a', sourceType: 'chapter', sourceId: 'chapter-1', sourceVersionId: original.sourceVersionId, quote: '林澈拿到了钥匙。' },
      ],
    })
    const current = aggregate(novel, [original])
    expect(chapterAnalysisCandidateIdentity(original)).toBe(chapterAnalysisCandidateIdentity(retry))
    expect(commitChapterAnalysis(current, submission(current, [retry]), now, () => 'unused')).toEqual({ changed: false, candidates: 0, dataChanges: 0 })
  })

  it('keeps a rejected decision from reappearing after the same manuscript is reanalysed', () => {
    const novel = makeNovel()
    const rejected = makeCandidate(novel, { status: 'rejected' })
    const current = aggregate(novel, [rejected])
    const retry = makeCandidate(novel, { id: 'candidate-after-rejection', status: 'proposed' })

    const result = commitChapterAnalysis(current, submission(current, [retry]), now, () => 'unused')
    expect(result.changed).toBe(false)
    expect(current.workspace.candidates).toEqual([rejected])
  })

  it('allows the same proposition to be reconsidered when the source manuscript version changes', () => {
    const novel = makeNovel()
    const original = makeCandidate(novel)
    const current = aggregate(novel, [original])
    novel.chapters[0].content += '随后他走进渡口。'
    novel.chapters[0].wordCount = novel.chapters[0].content.length
    const retry = makeCandidate(novel, {
      id: 'candidate-new-version', status: 'proposed',
      evidence: [{ id: 'evidence-new-version', sourceType: 'chapter', sourceId: 'chapter-1',
        sourceVersionId: buildAnalysisSourceVersionId(novel.chapters[0].content), quote: '林澈拿到了钥匙。' }],
      sourceVersionId: buildAnalysisSourceVersionId(novel.chapters[0].content),
    })

    const result = commitChapterAnalysis(current, submission(current, [retry]), now, () => 'unused')
    expect(result).toMatchObject({ changed: true, candidates: 1, dataChanges: 0 })
    expect(current.workspace.candidates.map(candidate => candidate.id)).toEqual(['candidate-original', 'candidate-new-version'])
  })
})
