export interface ChapterEndingCheck {
  isComplete: boolean
  isValidCliffhanger: boolean
  openAction: string
  reason: string
  continuationInstruction: string
}

const UNKNOWN_CHAPTER_ENDING_CHECK: ChapterEndingCheck = {
  isComplete: false,
  isValidCliffhanger: false,
  openAction: '',
  reason: 'AI 未返回可识别的章节结尾检查结果',
  continuationInstruction: '完成当前剧情节拍并形成阶段性结果',
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeChapterEndingCheck(value: unknown): ChapterEndingCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...UNKNOWN_CHAPTER_ENDING_CHECK }
  }
  const raw = value as Record<string, unknown>
  return {
    isComplete: raw.isComplete === true,
    isValidCliffhanger: raw.isValidCliffhanger === true,
    openAction: toText(raw.openAction),
    reason: toText(raw.reason) || UNKNOWN_CHAPTER_ENDING_CHECK.reason,
    continuationInstruction: toText(raw.continuationInstruction)
      || (raw.isComplete === true ? '' : UNKNOWN_CHAPTER_ENDING_CHECK.continuationInstruction),
  }
}

export function chapterEndingPasses(check: ChapterEndingCheck): boolean {
  return check.isComplete === true
}

export function cleanEndingContinuation(text: string): string {
  return text
    .replace(/^\s*```(?:markdown|text)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .replace(/^\s*(?:续写(?:正文|内容)?|自然收尾|收尾)\s*[：:]\s*/i, '')
    .replace(/^\s*(?:#{1,6}\s*)?第[一二三四五六七八九十百千万\d]+章[^\n]*\n+/i, '')
    .trim()
}
