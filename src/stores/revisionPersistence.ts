import { computed, onScopeDispose, ref, type Ref } from 'vue'

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
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null

  function clearTimer() { clearTimeout(timer); timer = undefined }
  function schedule() {
    clearTimer()
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
    saving.value = true
    inFlight = Promise.resolve().then(async () => {
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
      saving.value = false
      if (dirty.size) schedule()
    })
    return inFlight
  }
  async function through(targets: Map<string, number>) {
    clearTimer()
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
    } while (dirty.size || inFlight)
    clearTimer()
  }
  onScopeDispose(clearTimer)
  return { markDirty, adopt, forget, saveNow, flush, saveError, saving,
    hasPendingSaves: computed(() => pendingCount.value > 0) }
}
