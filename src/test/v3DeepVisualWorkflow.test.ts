import { createPinia, setActivePinia } from 'pinia'
import { expect, it } from 'vitest'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { buildReviewContextVersion } from '@/services/reconstructionReviewVersion'
import { projectStoryTime } from '@/services/storyTime'
import { deriveChapterWorkflow } from '@/v3/selectors/chapterWorkflow'
import { resumeTarget } from '@/v3/selectors/shelf'
import { buildV3DenseVisualFixture } from './v3DenseVisualFixture'
import { applyV3DeepVisualState } from './v3DeepVisualWorkflow'

it('captures the adapted Canon state with current time, summary, review, accepted history and a pending decision', async () => {
  setActivePinia(createPinia())
  const novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
  const novel = novels.addNovel({ genre: 'urban', subGenre: 'mystery', tags: [], targetWordCountMin: 10,
    targetWordCountMax: 100, writingStyle: novels.defaultWritingStyle(), settings: novels.defaultSettings() })
  Object.assign(novel, buildV3DenseVisualFixture(novel.id).novel)
  const chapter = novel.chapters[0]
  chapter.updatedAt = '2026-11-13T00:00:00.000Z'
  novel.updatedAt = chapter.updatedAt
  expect(resumeTarget([novel])?.chapter?.id).toBe(chapter.id)
  novel.chapterLengthPolicy = { minWords: 100, targetWords: 1500, maxWords: 2400 }
  for (let pass = 0; pass < 2; pass++) {
    await applyV3DeepVisualState(novel.id, 'gate-modal')
    expect(projectStoryTime(novel, chapter).known).toBe(false)
    await applyV3DeepVisualState(novel.id, 'canon-modal')
    const storyTime = projectStoryTime(novel, chapter)
    const contextVersion = buildReviewContextVersion(novel, chapter, [], workspace.getCreationDraft(novel.id),
      workspace.getCanonMutations(novel.id), workspace.getStoryMemories(novel.id))
    const workflow = deriveChapterWorkflow({ chapter, content: chapter.content, contextVersion,
      lengthPolicy: novel.chapterLengthPolicy, storyTimeKnown: storyTime.known, hasPlan: false,
      latestReview: workspace.getLatestChapterReview(novel.id, chapter.id), findings: [],
      candidates: workspace.getCandidates(novel.id), hasPendingRevision: false })
    expect(workflow.primary).toBe('finalize')
    for (const key of ['time', 'summary', 'review', 'length', 'saved']) {
      expect(workflow.gate.find(item => item.key === key)?.state, key).toBe('ok')
    }
    expect(workflow.pendingCandidates).toHaveLength(1)
    expect(workspace.getCanonMutations(novel.id).filter(record => record.chapterId === chapter.id)).toHaveLength(1)
    expect(novel.eventLog.filter(event => event.title === '码头挑夫整理麻袋')).toHaveLength(1)
  }
})
