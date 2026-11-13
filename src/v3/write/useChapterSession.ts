import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useEditorRecovery, type EditorDraftSession } from '@/composables/useEditorRecovery'
import { registerDraftSaver, type DraftFlushToken } from '@/services/appLifecycle'
import { buildReviewContextVersion, buildChapterReviewSignature, buildChapterReviewSourceVersion } from '@/services/reconstructionReviewVersion'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { projectStoryTime } from '@/services/storyTime'
import { resolveChapterLengthPolicy } from '@/services/chapterLength'
import { deriveChapterWorkflow, type ChapterWorkflow } from '../selectors/chapterWorkflow'
import type { Chapter, ChapterRevision, Novel } from '@/types/novel'
import type { EditorDraft } from '@/types/editorRecovery'

export interface ChapterSessionOptions {
  novelId: Ref<string>
  chapterId: Ref<string>
}

/**
 * The writing desk owns the short-lived editor state. Formal chapter data still
 * goes through the existing Novel store and workspace transactions.
 */
export function useChapterSession(options: ChapterSessionOptions) {
  const novels = useNovelStore()
  const knowledge = useKnowledgeStore()
  const workspace = useReconstructionWorkspaceStore()
  const recovery = useEditorRecovery()
  const content = ref('')
  const title = ref('')
  const loading = ref(true)
  const loadError = ref('')
  const saving = ref(false)
  const saveError = ref('')
  const loadedKey = ref('')
  const changed = ref(0)
  const session = ref<EditorDraftSession>()
  const pendingRevision = ref<ChapterRevision | undefined>()
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let unregisterDraftSaver: (() => void) | undefined
  let loadSequence = 0
  let saveWork: Promise<boolean> | undefined

  const novel = computed(() => novels.getNovel(options.novelId.value))
  const chapter = computed(() => novel.value?.chapters.find(item => item.id === options.chapterId.value))
  const chapterKey = computed(() => `${options.novelId.value}:${options.chapterId.value}`)
  const saved = computed(() => !!chapter.value && content.value === chapter.value.content && title.value === chapter.value.title)
  const contextVersion = computed(() => {
    const n = novel.value, c = chapter.value
    if (!n || !c) return ''
    const current = { ...c, content: content.value, title: title.value }
    return buildReviewContextVersion(n, current, knowledge.knowledgeBases, workspace.getCreationDraft(n.id),
      workspace.getCanonMutations(n.id), workspace.getStoryMemories(n.id))
  })
  const reviewSignature = computed(() => content.value && contextVersion.value
    ? buildChapterReviewSignature(content.value, contextVersion.value) : '')
  const reviewSourceVersion = computed(() => content.value && contextVersion.value
    ? buildChapterReviewSourceVersion(content.value, contextVersion.value) : '')
  const contentVersion = computed(() => buildAnalysisSourceVersionId(content.value))
  const findings = computed(() => workspace.getReviewFindings(options.novelId.value, options.chapterId.value))
  const candidates = computed(() => workspace.getCandidates(options.novelId.value)
    .filter(item => item.chapterId === options.chapterId.value))
  const latestReview = computed(() => workspace.getLatestChapterReview(options.novelId.value, options.chapterId.value))
  const storyTime = computed(() => novel.value && chapter.value ? projectStoryTime(novel.value, { ...chapter.value, content: content.value }) : undefined)
  const hasPlan = computed(() => {
    const n = novel.value, c = chapter.value
    if (!n || !c) return false
    return Boolean(n.chapterPlans?.some(plan => plan.targetChapterStart <= c.chapterIndex && plan.targetChapterEnd >= c.chapterIndex)
      || c.sceneNotes?.length)
  })
  const workflow = computed<ChapterWorkflow | undefined>(() => {
    void changed.value
    const c = chapter.value
    if (!c || !novel.value) return undefined
    return deriveChapterWorkflow({
      chapter: c,
      content: content.value,
      contextVersion: contextVersion.value,
      lengthPolicy: resolveChapterLengthPolicy(novel.value.chapterLengthPolicy),
      hasPlan: hasPlan.value,
      storyTimeKnown: storyTime.value?.known === true,
      latestReview: latestReview.value,
      findings: findings.value,
      candidates: candidates.value,
      hasPendingRevision: Boolean(pendingRevision.value),
    })
  })
  const drafts = computed(() => {
    void changed.value
    const novelId = options.novelId.value, chapterId = options.chapterId.value
    return workspace.getEditorDrafts(novelId).filter(draft => draft.kind === 'chapter-form'
      && draft.scope === `${novelId}:${chapterId}` && draft.targetId === chapterId)
  })

  function markChanged() { changed.value++ }

  async function refreshRevision() {
    if (!options.chapterId.value) { pendingRevision.value = undefined; return }
    const rows = await novels.getChapterRevisions(options.chapterId.value)
    pendingRevision.value = rows.find(row => row.status === 'pending')
    markChanged()
  }

  function startDraftSession(n: Novel, c: Chapter) {
    session.value = recovery.begin({ novelId: n.id, kind: 'chapter-form', scope: `${n.id}:${c.id}`, targetId: c.id,
      openedBaseline: JSON.stringify(c) })
  }

  async function load() {
    const sequence = ++loadSequence
    const nId = options.novelId.value, cId = options.chapterId.value
    loading.value = true; loadError.value = ''; loadedKey.value = ''
    try {
      if (!nId || !cId) throw new Error('写作台缺少作品或章节。')
      await workspace.hydrateFromPersistence(nId)
      if (sequence !== loadSequence) return
      const n = novels.getNovel(nId), c = n?.chapters.find(item => item.id === cId)
      if (!n || !c) throw new Error('作品或章节不存在。')
      content.value = c.content
      title.value = c.title
      startDraftSession(n, c)
      loadedKey.value = chapterKey.value
      await refreshRevision()
      markChanged()
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (sequence === loadSequence) loading.value = false
    }
  }

  function queueDraft() {
    const current = session.value, n = novel.value, c = chapter.value
    if (!current || !n || !c || loadedKey.value !== chapterKey.value) return
    recovery.queue(current, { chapterId: c.id, title: title.value, content: content.value, sourceContent: c.content })
  }

  async function saveNow(token?: DraftFlushToken): Promise<boolean> {
    while (saveWork) {
      await saveWork
      if (saved.value) return true
    }
    const work = persistNow(token)
    saveWork = work
    try { return await work }
    finally { if (saveWork === work) saveWork = undefined }
  }

  async function persistNow(token?: DraftFlushToken): Promise<boolean> {
    const n = novel.value, c = chapter.value
    if (!n || !c || c.status === 'locked') return false
    let checkpoint: EditorDraft | undefined
    if (session.value) {
      try {
        checkpoint = await recovery.flushSession(session.value, token)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('草稿已被其他编辑或历史恢复更改')) throw error
        // Preserve the conflicting durable draft, then continue with a new
        // draft identity carrying the current editor input.
        session.value = await recovery.fork(session.value)
        checkpoint = await recovery.flushSession(session.value, token)
      }
    }
    saving.value = true; saveError.value = ''
    try {
      const nextSignature = reviewSignature.value
      const keepReview = c.contentReviewSignature === nextSignature && c.content === content.value
      const changedText = c.content !== content.value || c.title !== title.value
      const status = changedText ? (content.value.trim() ? 'writing' : 'draft') : c.status
      const ok = novels.updateChapter(n.id, c.id, {
        title: title.value,
        content: content.value,
        status,
        contentReviewSignature: keepReview ? c.contentReviewSignature : '',
        reviewRewriteBlockedSignature: c.reviewRewriteBlockedSignature === contentVersion.value ? c.reviewRewriteBlockedSignature : '',
      })
      if (!ok) throw new Error('章节已锁定或不存在，正文未保存。')
      await novels.saveNovelNow(n.id)
      if (checkpoint && session.value) {
        const committedSession = session.value
        const consumed = await recovery.consume(committedSession, checkpoint)
        // Consumed draft IDs are durable tombstones. The next save/edit must
        // start from a fresh identity rather than consume that checkpoint twice.
        // Keep a session that received newer input while cleanup was pending.
        if (consumed && session.value === committedSession && !committedSession.pending
          && !committedSession.running && committedSession.sequence === committedSession.savedSequence) {
          startDraftSession(n, c)
        }
      }
      markChanged()
      return true
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      saving.value = false
    }
  }

  async function saveTitle() { return saveNow() }

  async function restoreDraft(draft: EditorDraft) {
    const restored = recovery.restore(draft)
    const payload = restored.latest
    if (!payload || typeof payload.content !== 'string' || typeof payload.title !== 'string') throw new Error('章节草稿格式无效。')
    session.value = restored
    content.value = payload.content
    title.value = payload.title
    markChanged()
  }

  async function discardDraft(draft: EditorDraft) {
    await recovery.discard(draft)
    markChanged()
  }

  async function restoreVersion(versionId: string) {
    const n = novel.value, c = chapter.value
    if (!n || !c) return false
    const result = await novels.restoreChapterVersion(n.id, c.id, versionId, JSON.stringify(c))
    if (result) {
      const next = novels.getNovel(n.id)?.chapters.find(item => item.id === c.id)
      if (next) { content.value = next.content; title.value = next.title }
      await refreshRevision()
      markChanged()
    }
    return result
  }

  async function acceptRevision() {
    const n = novel.value, c = chapter.value, revision = pendingRevision.value
    if (!n || !c || !revision) return false
    const accepted = await novels.acceptChapterRevision(n.id, c.id, revision.id)
    const next = novels.getNovel(n.id)?.chapters.find(item => item.id === c.id)
    if (accepted && next) { content.value = next.content; title.value = next.title }
    await refreshRevision()
    markChanged()
    return Boolean(accepted)
  }

  async function rejectRevision() {
    const revision = pendingRevision.value
    if (!revision) return false
    await novels.rejectChapterRevision(revision.id)
    await refreshRevision()
    markChanged()
    return true
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void saveNow().catch(() => undefined) }, 5000)
  }

  watch([options.novelId, options.chapterId], () => { void load() }, { immediate: true })
  watch([content, title], () => {
    if (loading.value || loadedKey.value !== chapterKey.value || saved.value) return
    queueDraft(); scheduleSave(); markChanged()
  })
  onMounted(() => {
    unregisterDraftSaver = registerDraftSaver(async token => {
      if (session.value) await recovery.flushSession(session.value, token)
      if (!saved.value) await saveNow(token)
    })
  })
  onBeforeUnmount(() => {
    if (saveTimer) clearTimeout(saveTimer)
    unregisterDraftSaver?.()
  })

  return {
    novel, chapter, content, title, loading, loadError, saving, saveError, saved, contextVersion,
    reviewSignature, reviewSourceVersion, contentVersion, findings, candidates, latestReview, storyTime,
    workflow, drafts, pendingRevision, hasPlan, saveNow, saveTitle, restoreDraft, discardDraft, restoreVersion,
    refreshRevision, acceptRevision, rejectRevision, markChanged,
  }
}
