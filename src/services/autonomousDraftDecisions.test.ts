import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture } from '@/test/characterStateFixture'
import { emptyProjectWorkspace } from '@/test/projectBackupFixture'
import type { AiChapterDraft } from '@/types/reconstruction'
import { createAiRun } from './reconstructionAiRun'
import { buildChapterReviewSourceVersion, buildReviewContextVersion } from './reconstructionReviewVersion'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { decideAutonomousDraft } from './autonomousDraftDecisions'
import { countNovelWords } from '@/utils/format'

beforeEach(() => setActivePinia(createPinia()))
const now = '2026-10-28T00:00:00.000Z'
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function fixture() {
  const { novel } = characterStateFixture()
  const chapter = novel.chapters[0]; chapter.content = ''; chapter.wordCount = 0; chapter.status = 'draft'
  const workspace = emptyProjectWorkspace(novel.id)
  const run = { ...createAiRun({ id: 'run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 2, tokenBudget: 10000, now }), status: 'completed' as const }
  const draft: AiChapterDraft = { id: 'draft-0', chapterId: chapter.id, chapterIndex: 0, baseContent: '', content: '作者核对后的候选正文。',
    contextVersion: buildReviewContextVersion(novel, { ...chapter, content: '作者核对后的候选正文。' }), status: 'pending', stage: 'generated', createdAt: now, updatedAt: now, history: [] }
  workspace.aiRuns = [{ ...run, chapterDrafts: [draft] }]
  return { aggregate: { novel, workspace }, draft, chapter }
}
describe('author decisions on autonomous drafts', () => {
  it.each(['review', 'finding', 'candidate', 'chapter'] as const)('rejects a mismatched %s before changing the formal chapter', (kind) => {
    const { aggregate, draft, chapter } = fixture()
    const bodyVersion = buildAnalysisSourceVersionId(draft.content)
    draft.stage = 'analyzed'; draft.report = '审核通过'
    draft.review = { id: 'review', chapterId: chapter.id, sourceVersionId: buildChapterReviewSourceVersion(draft.content, draft.contextVersion),
      startedAt: now, status: 'ready_to_finalize', deterministicChecksPassed: true, semanticChecksPassed: true,
      findings: [{ id: 'finding', chapterId: chapter.id, sourceVersionId: bodyVersion, type: 'style', severity: 'suggestion', title: '措辞',
        explanation: '建议', evidence: [], blocksFinalization: false, status: 'open' }],
      candidateChanges: [{ id: 'candidate', chapterId: chapter.id, novelId: aggregate.novel.id, sourceVersionId: bodyVersion, type: 'fact',
        proposedValue: '{}', status: 'proposed', evidence: [], createdAt: now, updatedAt: now }] }
    if (kind === 'review') draft.review.sourceVersionId = 'old-review'
    if (kind === 'finding') draft.review.findings[0].sourceVersionId = 'old-body'
    if (kind === 'candidate') draft.review.candidateChanges[0].sourceVersionId = 'old-body'
    if (kind === 'chapter') draft.review.chapterId = 'other-chapter'
    const before = copy(aggregate)
    expect(() => decideAutonomousDraft(aggregate, 'run', copy(draft), 'accept', undefined, [], now)).toThrow('不属于当前正文')
    expect(aggregate).toEqual(before)
    expect(chapter.content).toBe('')
  })
  it('publishes only after an explicit acceptance and preserves the old chapter version without adding Canon', () => {
    const { aggregate, draft, chapter } = fixture()
    const later = aggregate.novel.chapters[1]
    later.status = 'finalized'; later.contentReviewSignature = 'previous-review'
    const accepted = decideAutonomousDraft(aggregate, 'run', copy(draft), 'accept', undefined, [], now)
    expect(chapter.content).toBe(draft.content)
    expect(accepted.status).toBe('accepted')
    expect(JSON.parse(chapter.versions!.slice(-1)[0].snapshot).content).toBe('')
    expect(aggregate.workspace.canonMutations).toEqual([])
    expect(chapter.status).toBe('writing')
    expect(later.status).toBe('writing'); expect(later.contentReviewSignature).toBe('')
    expect(aggregate.workspace.impactReports).toHaveLength(1)
    expect(aggregate.workspace.impactReports![0]).toMatchObject({ reviewPolicy: 'changed-inputs',
      changes: [{ target: { kind: 'chapter', id: chapter.id }, action: 'update', fields: ['content'] }] })
    expect(aggregate.workspace.impactReports![0].reviewChapterIds).toContain(later.id)
  })
  it('keeps an earlier chapter review when accepting a later draft changes no earlier input', () => {
    const { aggregate, draft } = fixture()
    const [earlier, chapter, later] = aggregate.novel.chapters
    earlier.content = '前章已经结束。'; earlier.status = 'reviewed'; earlier.contentReviewSignature = 'earlier-current'
    later.status = 'finalized'; later.contentReviewSignature = 'later-old'
    draft.chapterId = chapter.id; draft.chapterIndex = chapter.chapterIndex; draft.baseContent = chapter.content
    draft.contextVersion = buildReviewContextVersion(aggregate.novel, { ...chapter, content: draft.content })
    decideAutonomousDraft(aggregate, 'run', copy(draft), 'accept', undefined, [], now)
    expect(earlier.status).toBe('reviewed'); expect(earlier.contentReviewSignature).toBe('earlier-current')
    expect(later.status).toBe('writing'); expect(later.contentReviewSignature).toBe('')
    expect(aggregate.workspace.impactReports![0].reviewChapterIds).not.toContain(earlier.id)
  })
  it('preserves the existing manuscript review and history when the accepted draft has identical text', () => {
    const { aggregate, draft, chapter } = fixture()
    chapter.content = draft.content; draft.baseContent = chapter.content
    chapter.wordCount = countNovelWords(chapter.content)
    chapter.status = 'reviewed'; chapter.contentReview = '当前正文的作者审核'; chapter.contentReviewSignature = 'current-review'
    draft.contextVersion = buildReviewContextVersion(aggregate.novel, chapter)
    const before = copy(chapter)
    decideAutonomousDraft(aggregate, 'run', copy(draft), 'accept', undefined, [], now)
    expect(chapter).toEqual(before)
    expect(draft.status).toBe('accepted')
    expect(aggregate.workspace.impactReports || []).toEqual([])
  })
  it('keeps the formal chapter unchanged when editing or rejecting a candidate', () => {
    const { aggregate, draft, chapter } = fixture()
    draft.generationFinishReason = 'length'
    decideAutonomousDraft(aggregate, 'run', copy(draft), 'edit', '作者编辑的候选稿。', [], now)
    expect(chapter.content).toBe('')
    expect(draft.generationFinishReason).toBeUndefined()
    expect(draft.history).toHaveLength(1)
    expect(draft.contextVersion).toBe(buildReviewContextVersion(aggregate.novel, { ...chapter, content: draft.content }))
    expect(aggregate.workspace.aiRuns[0]).toMatchObject({ status: 'paused', checkpoint: 'chapter-0:started' })
    decideAutonomousDraft(aggregate, 'run', copy(draft), 'reject', undefined, [], now)
    expect(draft.status).toBe('rejected')
    expect(chapter.content).toBe('')
    expect(aggregate.workspace.impactReports || []).toEqual([])
  })
  it('rejects old forms and changed writing context', () => {
    const { aggregate, draft } = fixture(), old = copy(draft)
    draft.content = '另一次保存的稿件'
    expect(() => decideAutonomousDraft(aggregate, 'run', old, 'accept', undefined, [], now)).toThrow('已经变化')
    aggregate.novel.outline = '新的结局'
    expect(() => decideAutonomousDraft(aggregate, 'run', copy(draft), 'accept', undefined, [], now)).toThrow('写作依据')
  })
  it('requires accepting drafts in narrative order', () => {
    const { aggregate, draft } = fixture()
    const second = aggregate.novel.chapters[1]; second.content = ''
    const later = { ...draft, id: 'draft-1', chapterId: second.id, chapterIndex: 1 }
    aggregate.workspace.aiRuns[0].chapterDrafts!.push(later)
    expect(() => decideAutonomousDraft(aggregate, 'run', copy(later), 'accept', undefined, [], now)).toThrow('按章节顺序')
  })
})
