import { ref } from 'vue'

export const appUpdateInstalling = ref(false)
const draftSavers = new Set<() => Promise<void>>()

export function registerDraftSaver(save: () => Promise<void>): () => void {
  draftSavers.add(save)
  return () => { draftSavers.delete(save) }
}

export async function flushEditorDrafts(): Promise<void> {
  for (const save of draftSavers) await save()
}
