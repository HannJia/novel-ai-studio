import type { Ref } from 'vue'
import { callAI, type ChatMessage } from '@/services/ai'
import { buildChapterWritingPlanPrompt } from '@/services/prompts'
import type { ModelConfig } from '@/stores/config'
import type { Novel } from '@/types/novel'
import { countNovelWords } from '@/utils/format'
import { MAX_CHAPTER_DRAFT_REQUESTS } from '@/services/chapterGeneration'

interface ChapterAiGenerationOptions {
  content: Ref<string>
  writing: Ref<boolean>
  statusText: Ref<string>
  minWords: number
  softWords: number
  hardWords: number
  onChunk?: () => void
  onWarning?: (message: string) => void
}

export function getChapterGenerationStatus(wordCount: number, minWords: number, softWords: number, hardWords: number): string {
  if (wordCount >= hardWords) return `AI 正在完成当前剧情节拍...（${wordCount} 字，不会按字数强行截断）`
  if (wordCount >= softWords) return `AI 正在自然收束本章...（已达建议字数 ${wordCount} 字）`
  if (wordCount >= minWords) return `AI 正在生成中...（已达最低 ${wordCount} 字）`
  return 'AI 正在生成中...'
}

export function useChapterAiGeneration(options: ChapterAiGenerationOptions) {
  let abortController: AbortController | null = null
  let draftRequests = 0

  function beginGeneration() {
    options.writing.value = true
    abortController = new AbortController()
    draftRequests = 0
  }

  function stopGeneration() {
    abortController?.abort()
    options.writing.value = false
  }

  function getGenerationSignal(): AbortSignal {
    if (!abortController) abortController = new AbortController()
    return abortController.signal
  }

  async function generateWritingPlan(
    model: ModelConfig,
    novel: Novel,
    factCard: string,
    chapterGuidance: string,
    activityParentId?: string,
  ): Promise<string> {
    try {
      const result = await callAI({
        model,
        skillTask: 'planning',
        messages: buildChapterWritingPlanPrompt(novel, factCard, chapterGuidance),
        maxTokens: 1200,
        signal: getGenerationSignal(),
        taskName: '写作计划',
        noAutomaticRetry: true,
        activityParentId,
      })
      return result.content.trim()
    } catch (error) {
      getGenerationSignal().throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      options.onWarning?.('写作计划生成失败，已直接进入正文生成')
      return ''
    }
  }

  async function streamAppend(
    model: ModelConfig,
    messages: ChatMessage[],
    maxTokens?: number,
    streamOptions: { activityParentId?: string; taskName?: string } = {},
  ) {
    const signal = getGenerationSignal()
    signal.throwIfAborted()
    if (draftRequests >= MAX_CHAPTER_DRAFT_REQUESTS) throw new Error('本次正文生成已达到 3 次请求上限，已保留草稿，请检查后再继续')
    draftRequests++
    const result = await callAI({
      model,
      skillTask: 'writing',
      messages,
      stream: true,
      signal,
      noAutomaticRetry: true,
      maxTokens,
      taskName: streamOptions.taskName || '正文生成',
      activityParentId: streamOptions.activityParentId,
      onChunk: (chunk) => {
        signal.throwIfAborted()
        options.content.value += chunk
        options.statusText.value = getChapterGenerationStatus(
          countNovelWords(options.content.value), options.minWords, options.softWords, options.hardWords,
        )
        options.onChunk?.()
      },
    })
    signal.throwIfAborted()
    if (result.finishReason && !['stop', 'length'].includes(result.finishReason)) {
      throw new Error('模型未正常完成正文输出，已保留草稿，请查看接口返回情况')
    }
    if (result.finishReason === 'length') options.onWarning?.('输出达到模型上限，已保留正文，将检查是否需要收尾')
    return result
  }

  return { beginGeneration, stopGeneration, getGenerationSignal, generateWritingPlan, streamAppend }
}
