import { computed, onBeforeUnmount, ref } from 'vue'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { registerDraftSaver, type DraftFlushToken } from '@/services/appLifecycle'
import { editorDraftVersion } from '@/services/editorRecovery'
import { assertEditorDraft, assertEditorPayload } from '@/services/editorRecoveryValidation'
import type { EditorDraft, EditorDraftCommand, EditorDraftIdentity, EditorDraftPayload, EditorDraftVersion } from '@/types/editorRecovery'

export interface EditorDraftSession {
  identity: EditorDraftIdentity
  version: EditorDraftVersion
  latest?: EditorDraftPayload
  sequence: number
  savedSequence: number
  saved?: EditorDraft
  pending?: { command: EditorDraftCommand; sequence: number }
  running?: Promise<EditorDraft | undefined>
  error: string
}
export interface PendingEditorDraftVersion {
  sequence: number
  version: EditorDraftVersion
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

type Workspace = ReturnType<typeof useReconstructionWorkspaceStore>
const controllers = new WeakMap<Workspace, ReturnType<typeof createEditorRecovery>>()

/**
 * Pending input remains reachable across route remounts, scoped to the owning Pinia workspace.
 *
 * Integration (call during setup; hydrate the workspace before showing its recovery picker):
 *   const recovery = useEditorRecovery()
 *   let session = recovery.begin({ novelId, kind: 'event-form', scope: 'event:' + eventId,
 *     targetId: eventId, openedBaseline: JSON.stringify(openedEvent) })
 *   // A synchronous/deep form watcher: capture plain AUTHOR fields, never model/config objects.
 *   recovery.queue(session, { title: form.title, description: form.description })
 *   // Only from an explicit recovery button; assign payload separately to the editor.
 *   session = recovery.restore(selectedDraft)
 *   // On author confirmation: freeze/capture the form, flush, save through its existing
 *   // baseline-checked formal API, then consume only this checkpoint. Handle cleanup failure
 *   // separately from formal save success; do not repeat a non-idempotent create operation.
 *   const checkpoint = await recovery.flushSession(session)
 *   await saveFormalWithOriginalBaseline(session.identity.openedBaseline)
 *   if (checkpoint) await recovery.consume(session, checkpoint)
 *
 * CharacterLibrary uses commitCharacterEditorDraft for atomic formal save + retirement.
 * New inputs use a new session ID; restoration keeps the selected ID, version and baseline.
 */
export function useEditorRecovery() {
  const workspace = useReconstructionWorkspaceStore()
  let controller = controllers.get(workspace)
  if (!controller) { controller = createEditorRecovery(workspace); controllers.set(workspace, controller) }
  controller.attach()
  onBeforeUnmount(controller.detach)
  return controller
}

function createEditorRecovery(workspace: Workspace) {
  const sessions = new Set<EditorDraftSession>()
  const changed = ref(0)
  let owners = 0
  let unregister: (() => void) | undefined
  const hasPending = (session: EditorDraftSession) => !!session.pending || session.sequence > session.savedSequence
  const touch = () => { changed.value++ }
  const failures = computed(() => {
    void changed.value
    return [...sessions].filter(session => session.error).map(session => ({ session, message: session.error,
      expected: { sequence: session.sequence, version: { ...session.version } } }))
  })
  const pendingCount = computed(() => { void changed.value; return [...sessions].filter(hasPending).length })
  function maybeUnregister() {
    if (!owners && ![...sessions].some(session => hasPending(session) || session.running)) { unregister?.(); unregister = undefined; sessions.clear() }
  }
  async function flushRegistered(token: DraftFlushToken) {
    // Finish pre-guard writes, then retry each failure with the controlled capability.
    await Promise.allSettled([...sessions].map(session => session.running).filter(Boolean))
    while ([...sessions].some(hasPending)) {
      const results = await Promise.allSettled([...sessions].filter(hasPending).map(session => flushSession(session, token)))
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure) throw failure.reason
    }
  }
  function ensureRegistered() { unregister ||= registerDraftSaver(flushRegistered) }
  function attach() { owners++; ensureRegistered() }
  function detach() { owners--; maybeUnregister() }

  function begin(identity: Omit<EditorDraftIdentity, 'id'>): EditorDraftSession {
    ensureRegistered()
    const session: EditorDraftSession = { identity: clone({ ...identity, id: crypto.randomUUID() }), version: editorDraftVersion(), sequence: 0, savedSequence: 0, error: '' }
    sessions.add(session)
    return session
  }
  function restore(draft: EditorDraft): EditorDraftSession {
    assertEditorDraft(draft, draft.novelId)
    if (draft.status !== 'active') throw new Error('该草稿已经丢弃。')
    const related = [...sessions].filter(session => session.identity.novelId === draft.novelId && session.identity.id === draft.id)
    if (related.some(session => hasPending(session) || session.running)) throw new Error('此草稿仍有未落盘输入，请先重试保存或另存草稿。')
    const session: EditorDraftSession = {
      identity: { id: draft.id, novelId: draft.novelId, kind: draft.kind, scope: draft.scope,
        ...(draft.targetId ? { targetId: draft.targetId } : {}), openedBaseline: draft.openedBaseline },
      version: editorDraftVersion(draft), latest: clone(draft.payload!), saved: clone(draft), sequence: 0, savedSequence: 0, error: '',
    }
    sessions.add(session)
    return session
  }
  function queue(session: EditorDraftSession, payload: unknown): void {
    ensureRegistered()
    sessions.add(session)
    assertEditorPayload(payload)
    const captured = clone(payload)
    if (JSON.stringify(session.latest) === JSON.stringify(captured)) return
    session.latest = captured
    session.sequence++
    touch()
    void flushSession(session).catch(() => undefined)
  }
  function flushSession(session: EditorDraftSession, token?: DraftFlushToken): Promise<EditorDraft | undefined> {
    if (session.running) return session.running
    const work = (async () => {
      while (hasPending(session)) {
        if (!session.pending) session.pending = {
          command: { action: 'save', novelId: session.identity.novelId, id: session.identity.id, expected: { ...session.version },
            operationId: crypto.randomUUID(), draft: { ...session.identity, payload: clone(session.latest!) } }, sequence: session.sequence,
        }
        const pending = session.pending
        const saved = await workspace.saveEditorDraft(pending.command, token)
        session.version = editorDraftVersion(saved)
        session.saved = saved
        session.savedSequence = pending.sequence
        session.pending = undefined
        session.error = ''
        touch()
      }
      return session.saved ? clone(session.saved) : undefined
    })().catch(error => {
      session.error = error instanceof Error ? error.message : String(error)
      touch()
      throw error
    }).finally(() => { session.running = undefined; touch(); maybeUnregister() })
    session.running = work
    return workspace.trackEditorDraftWork(work)
  }
  async function retryAll(): Promise<void> {
    await Promise.allSettled([...sessions].map(session => session.running).filter(Boolean))
    const results = await Promise.allSettled([...sessions].filter(hasPending).map(session => flushSession(session)))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  async function discard(draft: EditorDraft): Promise<void> {
    const related = [...sessions].filter(session => session.identity.id === draft.id && session.identity.novelId === draft.novelId)
    if (related.some(session => hasPending(session) || session.running)) throw new Error('仍有更新的输入待保存，请先完成保存再选择要丢弃的版本。')
    await workspace.saveEditorDraft({ action: 'discard', novelId: draft.novelId, id: draft.id,
      expected: editorDraftVersion(draft), operationId: crypto.randomUUID() })
  }
  /** Explicitly forget only failed, uncommitted input. Durable records are never deleted by this action. */
  async function discardPending(session: EditorDraftSession, expected: PendingEditorDraftVersion): Promise<void> {
    await session.running?.catch(() => undefined)
    if (session.sequence !== expected.sequence || session.version.revision !== expected.version.revision
      || session.version.operationId !== expected.version.operationId) throw new Error('输入已经更新，本次放弃未执行。请重新核对要放弃的版本。')
    session.pending = undefined
    session.latest = session.saved?.payload ? clone(session.saved.payload) : undefined
    session.savedSequence = session.sequence
    session.error = ''
    sessions.delete(session)
    touch(); maybeUnregister()
  }
  /** Call only after formal save succeeds, with the exact checkpoint captured before that save. */
  async function consume(session: EditorDraftSession, checkpoint: EditorDraft): Promise<boolean> {
    if (hasPending(session) || session.running || session.version.revision !== checkpoint.revision
      || session.version.operationId !== checkpoint.lastOperationId) return false
    await discard(checkpoint)
    return true
  }
  /** Explicit conflict escape: persist a new ID with the SAME baseline; old durable versions remain. */
  async function fork(session: EditorDraftSession): Promise<EditorDraftSession> {
    await session.running?.catch(() => undefined)
    const { id: _id, ...identity } = session.identity
    const next = begin(identity)
    const sequence = session.sequence
    if (session.latest) queue(next, session.latest)
    await flushSession(next)
    if (session.sequence === sequence) {
      session.pending = undefined; session.savedSequence = sequence; session.error = ''
      sessions.delete(session)
    }
    touch(); maybeUnregister()
    return next
  }
  return { attach, detach, begin, restore, queue, flushSession, retryAll, discard, discardPending, consume, fork, failures, pendingCount }
}
