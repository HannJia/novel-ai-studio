import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from '@/services/reconstructionCandidates'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import { createChapterSourceBinding } from '@/services/derivedSources'
import { projectStoryTime, recordStoryTime } from '@/services/storyTime'
import { buildChapterReviewSignature, buildChapterReviewSourceVersion, buildReviewContextVersion } from '@/services/reconstructionReviewVersion'
import type { AiRun, ChapterReview } from '@/types/reconstruction'
import type { Chapter } from '@/types/novel'
import { seedV3DenseVisualState } from './v3DenseVisualWorkflow'

export type V3DeepVisualState = 'auto-running' | 'auto-checkpoint' | 'gate-modal' | 'canon-modal'

const SYNTHETIC_NOW = '2026-11-11T00:00:00.000Z'
const RESUME_TIME = '2026-11-13T00:00:00.000Z'
const REVIEW_REPORT = '## 结论\n总体判断：可通过\n必改数量：0\n## 必改问题\n无\n## 建议修改\n无'

function createRun(novelId: string, status: AiRun['status'], checkpoint: string): AiRun {
  const request = {
    id: 'v3-deep-request-0', chapterIndex: 0, phase: 'writing' as const, modelId: 'synthetic-deep-visual',
    status: 'completed' as const, reservedTokens: 1200, inputTokens: 220, outputTokens: 180,
    usageSource: 'reported' as const, startedAt: SYNTHETIC_NOW, completedAt: SYNTHETIC_NOW,
  }
  return {
    id: 'v3-deep-autonomous-run', mode: 'autonomous', taskType: 'draft', targetId: novelId,
    chapterStart: 0, chapterEnd: 3, tokenBudget: 12000, checkpointEvery: 1, usedTokens: 400,
    requestLimit: 20, requests: [request], chapterDrafts: [], status, checkpoint,
    createdAt: SYNTHETIC_NOW, updatedAt: SYNTHETIC_NOW,
  }
}

function prepareShortChapter(novelId: string): { novelId: string; chapterId: string; chapter: Chapter } {
  const novels = useNovelStore()
  const novel = novels.getNovel(novelId)
  if (!novel) throw new Error('深层视觉夹具找不到作品。')
  const chapter = novel.chapters[0]
  if (!chapter) throw new Error('深层视觉夹具找不到章节。')
  const content = chapter.content.slice(0, 1800)
  Object.assign(chapter, { content, wordCount: content.length, summary: '沈砚在旧盐仓核对账目，留下尚待确认的线索。', storyDay: 0, storyDaysElapsed: 0, updatedAt: RESUME_TIME })
  novel.updatedAt = RESUME_TIME
  novel.chapterLengthPolicy = { minWords: 100, targetWords: 1500, maxWords: 2400 }
  novel.currentWordCount = novel.chapters.reduce((total, item) => total + item.content.length, 0)
  return { novelId, chapterId: chapter.id, chapter }
}

function prepareCurrentReview(novelId: string, chapter: Chapter): void {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const novel = novels.getNovel(novelId)
  if (!novel) throw new Error('深层视觉夹具找不到作品。')
  const previousTime = projectStoryTime(novel, chapter)
  recordStoryTime(novel, { chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content,
    mode: 'absolute', startDay: 0, endDay: 0, source: 'author',
    ...(previousTime.recordId ? { replace: true, expectedRecordId: previousTime.recordId } : {}),
  }, SYNTHETIC_NOW, () => 'v3-deep-time-' + (novel.storyClock?.confirmationSequence || 0))
  chapter.summary = '码头挑夫整理麻袋，豆腐铺照常开门，港城日常尚未引出新的调查。'
  chapter.summarySource = createChapterSourceBinding(chapter, chapter.summary, 'author', SYNTHETIC_NOW)
  // V2 semantics: accepting individual candidates writes Canon; finalization only audits them.
  // Exercise both a real accepted record and a remaining proposal in the adapted prototype state.
  const quotes = chapter.content.split('\n').filter(Boolean)
  const changes = buildChapterAnalysisCandidates(novel, chapter, buildAnalysisSourceVersionId(chapter.content), { events: [
    { title: '码头挑夫整理麻袋', type: '其他', description: quotes[0], evidence: quotes[0], characters: [] },
    { title: '豆腐铺照常开门', type: '其他', description: quotes[1], evidence: quotes[1], characters: [] },
  ] })
  const accepted = acceptCandidateChange(changes[0], SYNTHETIC_NOW)
  if (!workspace.hasCanonMutation(novelId, accepted.id)) {
    const { record } = applyCandidateChangeToCanon(novel, accepted, SYNTHETIC_NOW, workspace.getCanonMutations(novelId))
    workspace.recordCanonMutation(novelId, record)
  }
  workspace.replaceCandidates(novelId, [
    ...workspace.getCandidates(novelId).filter(candidate => !changes.some(change => change.id === candidate.id)),
    accepted, changes[1],
  ])
  const context = buildReviewContextVersion(novel, chapter, [], workspace.getCreationDraft(novelId),
    workspace.getCanonMutations(novelId), workspace.getStoryMemories(novelId))
  const signature = buildChapterReviewSignature(chapter.content, context)
  const sourceVersionId = buildChapterReviewSourceVersion(chapter.content, context)
  const bodyVersion = buildAnalysisSourceVersionId(chapter.content)
  const review: ChapterReview = {
    id: 'v3-deep-review', chapterId: chapter.id, sourceVersionId, startedAt: SYNTHETIC_NOW,
    completedAt: SYNTHETIC_NOW, deterministicChecksPassed: true, semanticChecksPassed: true,
    findings: [], candidateChanges: [], status: 'ready_to_finalize',
  }
  Object.assign(chapter, {
    status: 'completed', contentReview: REVIEW_REPORT, contentReviewSignature: signature,
    contentReviewCoverage: { signature, totalChunks: 1, completedChunks: 1, coveredCharacters: chapter.content.length,
      totalCharacters: chapter.content.length, globalStatus: 'not-needed', status: 'complete' },
    reviewRewriteBlockedSignature: bodyVersion,
  })
  workspace.replaceChapterFindings(novelId, chapter.id, [])
  workspace.replaceChapterReview(novelId, review)
}

export async function seedV3DeepVisualState() {
  const base = await seedV3DenseVisualState()
  const prepared = prepareShortChapter(base.novelId)
  const workspace = useReconstructionWorkspaceStore()
  workspace.replaceAiRun(base.novelId, createRun(base.novelId, 'running', 'chapter-0:started'))
  return { ...base, chapterId: prepared.chapterId }
}

export async function applyV3DeepVisualState(novelId: string, state: V3DeepVisualState) {
  const novels = useNovelStore()
  const workspace = useReconstructionWorkspaceStore()
  const novel = novels.getNovel(novelId)
  const chapter = novel?.chapters[0]
  if (!novel || !chapter) throw new Error('深层视觉夹具状态切换失败。')

  if (state === 'auto-running') {
    workspace.replaceAiRun(novelId, createRun(novelId, 'running', 'chapter-0:started'))
  } else if (state === 'auto-checkpoint') {
    workspace.replaceAiRun(novelId, createRun(novelId, 'needs_author', 'chapter-0:checkpoint'))
  } else if (state === 'gate-modal') {
    novel.storyClock = undefined
    Object.assign(chapter, { status: 'writing', storyDay: undefined, storyDaysElapsed: undefined, contentReview: '', contentReviewSignature: '', contentReviewCoverage: undefined })
    workspace.replaceChapterFindings(novelId, chapter.id, [])
    workspace.replaceChapterReview(novelId, { id: 'v3-deep-review', chapterId: chapter.id, sourceVersionId: '', startedAt: SYNTHETIC_NOW,
      deterministicChecksPassed: false, findings: [], candidateChanges: [], status: 'failed' })
    workspace.replaceAiRun(novelId, createRun(novelId, 'completed', 'chapter-0:completed'))
  } else {
    prepareCurrentReview(novelId, chapter)
    workspace.replaceAiRun(novelId, createRun(novelId, 'completed', 'chapter-0:completed'))
  }

  return { state, novelId, chapterId: chapter.id, modelRequests: 0 }
}
