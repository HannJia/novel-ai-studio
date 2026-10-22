import { ref } from 'vue'

export const appUpdateInstalling = ref(false)
export const cloudApplyBusy = ref(false)
// Network polling is serialized without covering or disabling the whole page.
export const cloudPreferencesBusy = ref(false)
export const cloudConfigApplying = ref(false)
const draftSavers = new Set<() => Promise<void>>()

export function registerDraftSaver(save: () => Promise<void>): () => void {
  draftSavers.add(save)
  return () => { draftSavers.delete(save) }
}

export async function flushEditorDrafts(): Promise<void> {
  for (const save of draftSavers) await save()
}
