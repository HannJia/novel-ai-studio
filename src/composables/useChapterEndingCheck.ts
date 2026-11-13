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
import { assertStructuredOutputComplete, structuredOutputDiagnostic } from '@/services/aiDiagnostics'

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
      structuredOutput: 'concise-json',
      signal,
      taskName: '章节结尾检查',
      noAutomaticRetry: true,
      activityParentId,
    })
    signal?.throwIfAborted()
    assertStructuredOutputComplete(result, '结尾检查')
    const parsed = parseAiJsonObject<{ isComplete?: unknown }>(result.content)
    if (!parsed || typeof parsed.isComplete !== 'boolean') {
      throw new Error(`结尾检查返回格式无效，需要 JSON 布尔字段 isComplete；未将格式错误当作章节不完整（${structuredOutputDiagnostic(result)}）`)
    }
    return normalizeChapterEndingCheck(parsed)
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
      noAutomaticRetry: true,
      activityParentId,
    })
    signal?.throwIfAborted()
    if (result.finishReason && result.finishReason !== 'stop') throw new Error('收尾输出未正常完成，未自动追加半截内容')
    return cleanEndingContinuation(result.content)
  }

  return { chapterEndingPasses, requestChapterEndingCheck, generateEndingContinuation }
}
