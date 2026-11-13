import { assertEventCausalityHistory } from '../eventCausalityValidation'
import { execute, initDb, queryAll, runTransaction } from '@/services/database'
import type { AiRun, CandidateChange, CanonMutationRecord, ChapterReview, CreationDraft, ReviewFinding, ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { StoryImpactReport } from '@/types/storyImpact'
export type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import { usesProjectKernel } from '../projectKernelClient'
import { loadKernelWorkspace, saveKernelWorkspace, emptyKernelWorkspace, changeKernelWorkspace } from '../projectKernelRepository'
import type { EditorDraft, EditorDraftCommand } from '@/types/editorRecovery'
import { applyEditorDraftCommand } from '../editorRecovery'
import { assertEditorDraft, assertEditorDrafts } from '../editorRecoveryValidation'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import { assertStoryMemoryRecord } from '../storyMemory'
import { assertStoryImpactReport } from '../storyImpactValidation'

interface ValueRow { value: string }

function parseValue<T>(value: string): T {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid record')
    return parsed as T
  } catch { throw new Error('创作工作区记录损坏，已停止读取以避免丢失规划或审核历史。') }
}

export async function loadReconstructionWorkspace(novelId: string): Promise<ReconstructionWorkspaceSnapshot> {
  if (usesProjectKernel()) return loadKernelWorkspace(novelId)
  await initDb()
  return readReconstructionWorkspaceRows(novelId)
}

/** Synchronous reader for a caller-owned project transaction. */
export function readReconstructionWorkspaceRows(novelId: string): ReconstructionWorkspaceSnapshot {
  const editorDrafts = readEditorDraftRows(novelId)
  const storyMemories = queryAll<ValueRow>('SELECT value FROM reconstruction_story_memories WHERE novel_id = ? ORDER BY rowid ASC', [novelId])
    .map(row => { const memory = parseValue<StoryMemoryRecord>(row.value); assertStoryMemoryRecord(memory, novelId); return memory })
  const impactReports = queryAll<ValueRow>('SELECT value FROM reconstruction_impact_reports WHERE novel_id = ? ORDER BY rowid ASC', [novelId])
    .map(row => { const report = parseValue<StoryImpactReport>(row.value); assertStoryImpactReport(report, novelId); return report })
  const draft = queryAll<ValueRow>('SELECT value FROM reconstruction_creation_drafts WHERE novel_id = ? ORDER BY rowid DESC', [novelId])[0]
  const candidates = queryAll<ValueRow>('SELECT value FROM reconstruction_candidates WHERE novel_id = ? ORDER BY rowid ASC', [novelId])
    .map(row => parseValue<CandidateChange>(row.value)).filter((value): value is CandidateChange => !!value)
  const reviewFindings = queryAll<ValueRow>('SELECT value FROM reconstruction_review_findings WHERE novel_id = ? ORDER BY rowid ASC', [novelId])
    .map(row => parseValue<ReviewFinding>(row.value)).filter((value): value is ReviewFinding => !!value)
  const chapterReviews = queryAll<ValueRow>('SELECT value FROM reconstruction_chapter_reviews WHERE novel_id = ? ORDER BY updated_at ASC', [novelId])
    .map(row => parseValue<ChapterReview>(row.value)).filter((value): value is ChapterReview => !!value)
  const aiRuns = queryAll<ValueRow>('SELECT value FROM reconstruction_ai_runs WHERE novel_id = ? ORDER BY created_at ASC, id ASC', [novelId])
    .map(row => parseValue<AiRun>(row.value)).filter((value): value is AiRun => !!value)
  const canonMutations = queryAll<ValueRow>('SELECT value FROM reconstruction_canon_mutations WHERE novel_id = ? ORDER BY rowid ASC', [novelId])
    .map(row => parseValue<CanonMutationRecord>(row.value)).filter((value): value is CanonMutationRecord => !!value)
  assertEventCausalityHistory(canonMutations, candidates, novelId)
  return {
    editorDrafts,
    storyMemories,
    ...(impactReports.length ? { impactReports } : {}),
    creationDraft: draft ? parseValue<CreationDraft>(draft.value) : undefined,
    candidates,
    reviewFindings,
    chapterReviews,
    aiRuns,
    canonMutations,
  }
}

export async function saveReconstructionWorkspace(novelId: string, snapshot: ReconstructionWorkspaceSnapshot): Promise<void> {
  if (usesProjectKernel()) return saveKernelWorkspace(novelId, snapshot)
  await initDb()
  await runTransaction(() => writeReconstructionWorkspaceRows(novelId, snapshot), { restoreOnWriteFailure: true })
}

/** Synchronous row writer, called only inside the owning transaction. */
export function writeReconstructionWorkspaceRows(novelId: string, snapshot: ReconstructionWorkspaceSnapshot): void {
    assertEditorDrafts(snapshot.editorDrafts || [], novelId)
    execute('DELETE FROM reconstruction_editor_drafts WHERE novel_id = ?', [novelId])
    for (const draft of snapshot.editorDrafts || []) writeEditorDraftRow(draft)
    assertEventCausalityHistory(snapshot.canonMutations, snapshot.candidates, novelId)
    execute('DELETE FROM reconstruction_story_memories WHERE novel_id = ?', [novelId])
    for (const memory of snapshot.storyMemories || []) {
      assertStoryMemoryRecord(memory, novelId)
      execute('INSERT INTO reconstruction_story_memories (id, novel_id, value) VALUES (?, ?, ?)', [memory.id, novelId, JSON.stringify(memory)])
    }
    execute('DELETE FROM reconstruction_impact_reports WHERE novel_id = ?', [novelId])
    for (const report of snapshot.impactReports || []) {
      assertStoryImpactReport(report, novelId)
      execute('INSERT INTO reconstruction_impact_reports (id, novel_id, created_at, value) VALUES (?, ?, ?, ?)', [
        report.id, novelId, report.createdAt, JSON.stringify(report),
      ])
    }
    execute('DELETE FROM reconstruction_creation_drafts WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_candidates WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_review_findings WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_chapter_reviews WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_ai_runs WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_canon_mutations WHERE novel_id = ?', [novelId])

    if (snapshot.creationDraft) {
      execute('INSERT INTO reconstruction_creation_drafts (id, novel_id, value, updated_at) VALUES (?, ?, ?, ?)', [
        snapshot.creationDraft.id, novelId, JSON.stringify(snapshot.creationDraft), snapshot.creationDraft.updatedAt,
      ])
    }
    for (const candidate of snapshot.candidates) {
      execute('INSERT INTO reconstruction_candidates (id, novel_id, chapter_id, status, value, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        candidate.id, novelId, candidate.chapterId ?? null, candidate.status, JSON.stringify(candidate), candidate.updatedAt,
      ])
    }
    for (const finding of snapshot.reviewFindings) {
      execute('INSERT INTO reconstruction_review_findings (id, novel_id, chapter_id, status, value, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        finding.id, novelId, finding.chapterId, finding.status, JSON.stringify(finding), finding.id,
      ])
    }
    for (const review of snapshot.chapterReviews || []) {
      execute('INSERT INTO reconstruction_chapter_reviews (id, novel_id, chapter_id, source_version_id, status, value, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        review.id,
        novelId,
        review.chapterId,
        review.sourceVersionId,
        review.status,
        JSON.stringify(review),
        review.completedAt || review.startedAt,
      ])
    }
    for (const run of snapshot.aiRuns || []) {
      execute('INSERT OR REPLACE INTO reconstruction_ai_runs (id, novel_id, mode, task_type, target_id, chapter_start, chapter_end, token_budget, used_tokens, status, checkpoint, error, created_at, updated_at, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        run.id, novelId, run.mode, run.taskType, run.targetId ?? null, run.chapterStart ?? null, run.chapterEnd ?? null,
        run.tokenBudget ?? null, run.usedTokens ?? null, run.status, run.checkpoint ?? null, run.error ?? null,
        run.createdAt, run.updatedAt, JSON.stringify(run),
      ])
    }
    for (const mutation of snapshot.canonMutations) {
      execute('INSERT INTO reconstruction_canon_mutations (id, candidate_id, novel_id, value, applied_at) VALUES (?, ?, ?, ?, ?)', [
        mutation.id, mutation.candidateId, novelId, JSON.stringify(mutation), mutation.appliedAt,
      ])
    }
}

export async function deleteReconstructionWorkspace(novelId: string): Promise<void> {
  if (usesProjectKernel()) return saveKernelWorkspace(novelId, emptyKernelWorkspace(novelId))
  await initDb()
  await runTransaction(() => {
    execute('DELETE FROM reconstruction_editor_drafts WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_story_memories WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_impact_reports WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_creation_drafts WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_candidates WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_review_findings WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_chapter_reviews WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_ai_runs WHERE novel_id = ?', [novelId])
    execute('DELETE FROM reconstruction_canon_mutations WHERE novel_id = ?', [novelId])
  }, { restoreOnWriteFailure: true })
}

function readEditorDraftRows(novelId: string): EditorDraft[] {
  const rows = queryAll<ValueRow & { id: string; revision: number; status: string; updated_at: string }>(
    'SELECT id, revision, status, updated_at, value FROM reconstruction_editor_drafts WHERE novel_id = ? ORDER BY updated_at, id', [novelId])
    .map(row => {
      const draft = parseValue<EditorDraft>(row.value)
      assertEditorDraft(draft, novelId)
      if (row.id !== draft.id || row.revision !== draft.revision || row.status !== draft.status || row.updated_at !== draft.updatedAt) {
        throw new Error('编辑草稿索引与内容不一致，已停止保存以避免覆盖输入。')
      }
      return draft
    })
  assertEditorDrafts(rows, novelId)
  return rows
}
function writeEditorDraftRow(draft: EditorDraft): void {
  execute('INSERT OR REPLACE INTO reconstruction_editor_drafts (novel_id, id, revision, status, value, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [draft.novelId, draft.id, draft.revision, draft.status, JSON.stringify(draft), draft.updatedAt])
}
/** Narrow durable operation: no stale full-workspace snapshot can erase other collections. */
export async function commitEditorDraftCommand(command: EditorDraftCommand, assertAvailable: () => void): Promise<{ drafts: EditorDraft[]; draft: EditorDraft }> {
  let result!: { drafts: EditorDraft[]; draft: EditorDraft }
  if (usesProjectKernel()) {
    await changeKernelWorkspace(command.novelId, workspace => {
      assertAvailable()
      result = applyEditorDraftCommand(workspace.editorDrafts || [], command, new Date().toISOString())
      workspace.editorDrafts = result.drafts
    })
  } else {
    await initDb()
    await runTransaction(() => {
      assertAvailable()
      if (!queryAll('SELECT id FROM novels WHERE id = ?', [command.novelId]).length) throw new Error('作品已不存在，草稿未保存。')
      result = applyEditorDraftCommand(readEditorDraftRows(command.novelId), command, new Date().toISOString())
      writeEditorDraftRow(result.draft)
    }, { restoreOnWriteFailure: true })
  }
  return result
}
