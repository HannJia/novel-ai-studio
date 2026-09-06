import { callAI } from '@/services/ai'
import {
  chapterEndingPasses,
  cleanEndingContinuation,
  normalizeChapterEndingCheck,
  type ChapterEndingCheck,
} from '@/services/chapterEnding'
import { buildChapterEndingCheckPrompt, buildChapterEndingContinuationPrompt } from '@/services/prompts'
import type { ModelConfig } from '@/stores/config'
import { parseAiJsonObject } from '@/utils/aiJson'

export type { ChapterEndingCheck }

export function useChapterEndingCheck() {
  async function requestChapterEndingCheck(
    model: ModelConfig,
    chapterText: string,
    chapterGuidance = '',
    writingPlan = '',
    signal?: AbortSignal,
    activityParentId?: string,
  ): Promise<ChapterEndingCheck> {
    const result = await callAI({
      model,
      skillTask: 'review',
      messages: buildChapterEndingCheckPrompt(chapterText, chapterGuidance, writingPlan),
      maxTokens: 900,
      signal,
      taskName: '章节结尾检查',
      activityParentId,
    })
    return normalizeChapterEndingCheck(parseAiJsonObject(result.content))
  }

  async function generateEndingContinuation(
    model: ModelConfig,
    chapterText: string,
    check: ChapterEndingCheck,
    chapterGuidance = '',
    writingPlan = '',
    factCard = '',
    signal?: AbortSignal,
    activityParentId?: string,
  ): Promise<string> {
    const result = await callAI({
      model,
      skillTask: 'writing',
      messages: buildChapterEndingContinuationPrompt(chapterText, check, chapterGuidance, writingPlan, factCard),
      maxTokens: 1000,
      signal,
      taskName: '补全章节结尾',
      activityParentId,
    })
    return cleanEndingContinuation(result.content)
  }

  return { chapterEndingPasses, requestChapterEndingCheck, generateEndingContinuation }
}
