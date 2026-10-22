import { countNovelWords } from '@/utils/format'

export interface ChapterLengthPolicy {
  minWords: number
  targetWords: number
  maxWords: number
}

export const DEFAULT_CHAPTER_LENGTH_POLICY: Readonly<ChapterLengthPolicy> = Object.freeze({
  minWords: 2000,
  targetWords: 2200,
  maxWords: 2400,
})

export type ChapterLengthStatus = 'short' | 'within' | 'long'

export interface ChapterLengthInspection {
  words: number
  status: ChapterLengthStatus
  deficit: number
  excess: number
}

function isValidLengthValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 100 && value <= 20000
}

function isOrdered(min: number, target: number, max: number): boolean {
  return min <= target && target <= max
}

export function resolveChapterLengthPolicy(value?: Partial<ChapterLengthPolicy>): ChapterLengthPolicy {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_CHAPTER_LENGTH_POLICY }
  }

  const min = value.minWords
  const target = value.targetWords
  const max = value.maxWords

  const hasMin = min !== undefined
  const hasTarget = target !== undefined
  const hasMax = max !== undefined

  if (hasMin && !isValidLengthValue(min)) {
    return { ...DEFAULT_CHAPTER_LENGTH_POLICY }
  }
  if (hasTarget && !isValidLengthValue(target)) {
    return { ...DEFAULT_CHAPTER_LENGTH_POLICY }
  }
  if (hasMax && !isValidLengthValue(max)) {
    return { ...DEFAULT_CHAPTER_LENGTH_POLICY }
  }

  const resolvedMin = hasMin ? min! : DEFAULT_CHAPTER_LENGTH_POLICY.minWords
  const resolvedTarget = hasTarget ? target! : DEFAULT_CHAPTER_LENGTH_POLICY.targetWords
  const resolvedMax = hasMax ? max! : DEFAULT_CHAPTER_LENGTH_POLICY.maxWords

  if (!isOrdered(resolvedMin, resolvedTarget, resolvedMax)) {
    return { ...DEFAULT_CHAPTER_LENGTH_POLICY }
  }

  return { minWords: resolvedMin, targetWords: resolvedTarget, maxWords: resolvedMax }
}

export function inspectChapterLength(
  text: string,
  policy: ChapterLengthPolicy = DEFAULT_CHAPTER_LENGTH_POLICY,
): ChapterLengthInspection {
  const words = countNovelWords(text)
  let status: ChapterLengthStatus
  let deficit = 0
  let excess = 0

  if (words < policy.minWords) {
    status = 'short'
    deficit = policy.minWords - words
  } else if (words > policy.maxWords) {
    status = 'long'
    excess = words - policy.maxWords
  } else {
    status = 'within'
  }

  return { words, status, deficit, excess }
}

export function chapterLengthPrompt(policy: ChapterLengthPolicy = DEFAULT_CHAPTER_LENGTH_POLICY): string {
  return `【章节长度统一规则】
- 目标长度：${policy.targetWords} 字（非空白 UTF-16 字符单位，含标点）
- 接受范围：${policy.minWords}~${policy.maxWords} 字（包含边界）
- 字数统计方法：移除所有空白字符后的 UTF-16 单位长度，包含标点符号
- 保留场景核心事件和章节结尾，不得强行截断正文以达到字数要求`
}
