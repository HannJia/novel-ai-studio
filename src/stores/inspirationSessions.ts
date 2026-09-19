import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createRevisionPersistence } from './revisionPersistence'
import { loadInspirationSessions, saveInspirationSessions } from '@/services/db/inspirationSessions'
import { latestInspirationSessions, parseInspirationSession, type InspirationSession } from '@/services/inspirationSessions'

export const useInspirationSessionsStore = defineStore('inspirationSessions', () => {
  const initialized = ref(false)
  const records = ref([{ id: 'sessions', sessions: [] as InspirationSession[] }])
  const sessions = computed(() => records.value[0].sessions)
  const persistence = createRevisionPersistence(records, initialized, snapshot => saveInspirationSessions(snapshot.sessions))
  let loading: Promise<void> | null = null
  function adopt(items: InspirationSession[]) {
    records.value[0].sessions = latestInspirationSessions(items.map(parseInspirationSession))
    persistence.adopt()
  }
  async function initialize() {
    if (initialized.value) return
    if (!loading) loading = loadInspirationSessions().then(items => { adopt(items); initialized.value = true })
      .finally(() => { loading = null })
    await loading
  }
  function upsert(item: InspirationSession) {
    if (!initialized.value) throw new Error('灵感记录尚未加载完成，请稍后重试。')
    const checked = parseInspirationSession(item)
    records.value[0].sessions = latestInspirationSessions([checked, ...sessions.value.filter(old => old.id !== item.id)])
    persistence.markDirty('sessions')
  }
  return { sessions, initialized, initialize, upsert, adopt, flushPendingSaves: persistence.flush,
    saveError: persistence.saveError, saving: persistence.saving, hasPendingSaves: persistence.hasPendingSaves }
})
