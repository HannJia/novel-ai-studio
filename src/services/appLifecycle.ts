import { ref } from 'vue'

export const appUpdateInstalling = ref(false)
export const cloudApplyBusy = ref(false)
export const projectTransferBusy = ref(false)
// Covers the entire executor, including gaps between individual AI requests.
export const activeAutonomousRunCount = ref(0)
// Covers memory task persistence and node gaps as well as model requests.
export const activeMemoryRunCount = ref(0)
// Network polling is serialized without covering or disabling the whole page.
export const cloudPreferencesBusy = ref(false)
export const cloudConfigApplying = ref(false)
// This capability is issued only to registered savers during their own flush.
export interface DraftFlushToken { readonly kind: 'editor-draft-flush' }
const activeDraftFlushTokens = new WeakSet<DraftFlushToken>()
const draftSavers = new Set<(token: DraftFlushToken) => Promise<void>>()

export function isDraftFlushTokenActive(token?: DraftFlushToken): boolean {
  return !!token && activeDraftFlushTokens.has(token)
}

export function registerDraftSaver(save: (token: DraftFlushToken) => Promise<void>): () => void {
  draftSavers.add(save)
  return () => { draftSavers.delete(save) }
}

export async function flushEditorDrafts(): Promise<void> {
  for (const save of [...draftSavers]) {
    const token: DraftFlushToken = Object.freeze({ kind: 'editor-draft-flush' })
    activeDraftFlushTokens.add(token)
    try { await save(token) } finally { activeDraftFlushTokens.delete(token) }
  }
}
