import type { DialogueMessage, CreateWizardForm, Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot, CreationDraft, CreationEntry } from '@/types/reconstruction'
import type { CreationSetupMethod } from '@/types/creationEntry'
import type { InspirationMessage } from './inspiration'
import { createNovelDraft } from '@/stores/novel'
import { createCreationDraftFromNovel } from './reconstructionCreation'
import { assertCreationEntryInput } from './creationEntryInput'

/** Setup choices collapse onto the V2 creation entry; "custom" keeps its historical blank-entry meaning. */
export const creationEntryForMethod: Record<CreationSetupMethod, CreationEntry> = {
  inspiration: 'idea', outline: 'import', blank: 'blank', custom: 'blank',
}

export interface PreparedStoryCreation {
  novel: Novel
  workspace: ReconstructionWorkspaceSnapshot
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Build the complete first aggregate without mutating a store or a caller-owned input. */
export function prepareStoryCreation(
  form: CreateWizardForm,
  inspiration: InspirationMessage[],
  entry: CreationSetupMethod,
  now = new Date().toISOString(),
  id?: string,
): PreparedStoryCreation {
  if (form.creationInput) {
    assertCreationEntryInput(form.creationInput)
    if (form.creationInput.method !== entry) throw new Error('创建输入与所选创建方式不一致，请重新选择后再创建')
  } else if (entry === 'outline') throw new Error('已有大纲创建必须先保存大纲文字')
  const capturedForm = clone(form)
  const novel = createNovelDraft(capturedForm, now, id)
  const inspirationHistory: DialogueMessage[] = clone(inspiration).map((item, index) => ({
    ...item,
    id: `inspiration-${novel.id}-${index}`,
    timestamp: now,
  }))
  novel.inspirationHistory = inspirationHistory

  const creationDraft: CreationDraft = createCreationDraftFromNovel(novel, now)
  creationDraft.entry = creationEntryForMethod[entry]
  if (capturedForm.creationInput) creationDraft.initialInput = capturedForm.creationInput
  return {
    novel,
    workspace: {
      creationDraft,
      candidates: [],
      reviewFindings: [],
      chapterReviews: [],
      aiRuns: [],
      canonMutations: [],
    },
  }
}
