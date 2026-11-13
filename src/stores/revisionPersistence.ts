import { computed, onScopeDispose, ref, type Ref } from 'vue'
import { mergeCommittedSnapshot } from '@/services/committedSnapshotMerge'

export interface PreparedPersistence<T> {
  persist: (() => Promise<void>) | null
  value: T
}

// Revision numbers are local monotonic counters, independent of wall-clock
// precision. A save barrier waits for the revision observed by its caller.
export function createRevisionPersistence<T extends { id: string }>(
  items: Ref<T[]>, initialized: Ref<boolean>, write: (snapshot: T) => Promise<void>,
) {
  const revisions = new Map<string, number>()
  const persisted = new Map<string, number>()
  const dirty = new Set<string>()
  const pendingCount = ref(0)
  const saving = ref(false)
  const saveError = ref('')
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null
  let operations: Promise<unknown> = Promise.resolve()
  let queuedOperations = 0
  const transactions = new Set<Promise<unknown>>()
  const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value))

  function enqueue<R>(operation: () => Promise<R>): Promise<R> {
    queuedOperations++
    saving.value = true
    const task = operations.then(operation).finally(() => {
      queuedOperations--
      saving.value = queuedOperations > 0
    })
    operations = task.catch(() => undefined)
    return task
  }

  function clearTimer() { clearTimeout(timer); timer = undefined }
  function schedule() {
    clearTimer()
    // A write may finish after the owning Pinia/effect scope was disposed.
    // Preserve dirty edits for explicit flush, but do not resurrect its timer.
    if (disposed) return
    if (initialized.value && !saveError.value) timer = setTimeout(() => {
      timer = undefined
      void flushObserved().catch(() => undefined)
    }, 1500)
  }
  function markDirty(id: string) {
    revisions.set(id, (revisions.get(id) || 0) + 1)
    dirty.add(id)
    pendingCount.value = dirty.size
    schedule()
  }
  function adopt() {
    clearTimer()
    revisions.clear()
    persisted.clear()
    dirty.clear()
    pendingCount.value = 0
    saveError.value = ''
    for (const item of items.value) {
      revisions.set(item.id, 0)
      persisted.set(item.id, 0)
    }
  }
  function forget(id: string) {
    revisions.delete(id); persisted.delete(id); dirty.delete(id)
    pendingCount.value = dirty.size
  }
  function batch(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = enqueue(async () => {
      for (const id of [...dirty]) {
        const item = items.value.find(item => item.id === id)
        if (!item) { forget(id); continue }
        const revision = revisions.get(id) || 0
        const snapshot = JSON.parse(JSON.stringify(item)) as T
        await write(snapshot)
        persisted.set(id, revision)
        if (revisions.get(id) === revision) dirty.delete(id)
        pendingCount.value = dirty.size
      }
      saveError.value = ''
    }).catch(error => {
      saveError.value = error instanceof Error ? error.message : '数据保存失败'
      throw error
    }).finally(() => {
      inFlight = null
      if (dirty.size) schedule()
    })
    return inFlight
  }
  async function through(targets: Map<string, number>) {
    clearTimer()
    if (transactions.size) await Promise.all([...transactions])
    // Always await an existing transaction, even for a barrier with no dirty IDs.
    if (inFlight) await inFlight
    while ([...targets].some(([id, revision]) => items.value.some(item => item.id === id) && (persisted.get(id) ?? -1) < revision)) {
      await batch()
    }
    if (!dirty.size) clearTimer()
  }
  async function saveNow(id: string) {
    if (!items.value.some(item => item.id === id)) throw new Error('要保存的数据已不存在')
    markDirty(id)
    await through(new Map([[id, revisions.get(id)!]]))
  }
  async function flushObserved() {
    await through(new Map([...dirty].map(id => [id, revisions.get(id) || 0])))
  }
  async function flush() {
    // Closing/importing must drain edits that arrive while an older snapshot
    // is being written, not just the revisions visible at the first call.
    do {
      await flushObserved()
    } while (dirty.size || inFlight || transactions.size)
    clearTimer()
  }
  /** Stage a domain operation alongside normal autosaves; publish only on commit. */
  function transact<R>(id: string, prepare: (draft: T) => Promise<PreparedPersistence<R>>, reconcile?: (committed: T, merged: T) => T): Promise<R> {
    clearTimer()
    const task = enqueue(async () => {
      const item = items.value.find(item => item.id === id)
      if (!item) throw new Error('要保存的数据已不存在')
      const before = clone(item)
      const draft = clone(before)
      const prepared = await prepare(draft)
      // An already-applied/no-op decision must not mark unrelated dirty prose
      // as saved when it performed no durable write.
      if (!prepared.persist) return prepared.value
      try { await prepared.persist() }
      catch (error) {
        saveError.value = error instanceof Error ? error.message : '数据保存失败'
        throw error
      }
      const current = items.value.find(item => item.id === id)
      if (current) {
        const combined = mergeCommittedSnapshot(before, draft, clone(current))
        const merged = reconcile ? reconcile(draft, combined) : combined
        // Editors and in-flight commands also hold chapter/entity references.
        // Publish the merged fields without detaching those retained objects.
        publishSnapshot(current, merged)
        const revision = (revisions.get(id) || 0) + 1
        revisions.set(id, revision)
        if (JSON.stringify(merged) === JSON.stringify(draft)) {
          persisted.set(id, revision)
          dirty.delete(id)
        } else dirty.add(id)
        pendingCount.value = dirty.size
      }
      saveError.value = ''
      return prepared.value
    })
    transactions.add(task)
    void task.finally(() => {
      transactions.delete(task)
      if (dirty.size) schedule()
    }).catch(() => undefined)
    return task
  }
  onScopeDispose(() => { disposed = true; clearTimer() })
  return { markDirty, adopt, forget, saveNow, flush, transact, saveError, saving,
    hasPendingSaves: computed(() => pendingCount.value > 0) }
}

function publishSnapshot(current: unknown, snapshot: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(snapshot)) {
    const hasIds = (rows: unknown[]) => rows.every(row => !!row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string')
      && new Set(rows.map(row => (row as { id: string }).id)).size === rows.length
    if (hasIds(current) && hasIds(snapshot)) {
      const byId = new Map(current.map(row => [row.id, row]))
      const rows = snapshot.map(row => byId.has(row.id) ? publishSnapshot(byId.get(row.id), row) : row)
      current.splice(0, current.length, ...rows)
      return current
    }
    return snapshot
  }
  if (current && snapshot && typeof current === 'object' && typeof snapshot === 'object'
    && !Array.isArray(current) && !Array.isArray(snapshot)) {
    const target = current as Record<string, unknown>, source = snapshot as Record<string, unknown>
    for (const key of Object.keys(target)) if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key]
    for (const key of Object.keys(source)) target[key] = publishSnapshot(target[key], source[key])
    return current
  }
  return snapshot
}
