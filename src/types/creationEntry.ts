export type CreationSetupMethod = 'inspiration' | 'outline' | 'blank' | 'custom'
export type CreationOutlineFormat = 'txt' | 'md' | 'markdown' | 'docx'

/** Local text candidate; it never grants approval to planning or Canon. */
export interface CreationOutlineInput {
  source: 'file' | 'paste'
  fileName?: string
  format?: CreationOutlineFormat
  fileBytes?: number
  originalText: string
  text: string
  capturedAt: string
  savedAt?: string
}

/** Immutable initial author input, committed with the first novel/workspace aggregate. */
export interface CreationEntryInput {
  method: CreationSetupMethod
  idea?: string
  includeDiscussion?: boolean
  outline?: CreationOutlineInput
  savedAt: string
}

export const creationSetupLabels: Record<CreationSetupMethod, string> = {
  inspiration: '一句话灵感', outline: '已有大纲', blank: '空白模板', custom: '自选设定',
}
