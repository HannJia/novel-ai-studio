import type { Ref } from 'vue'
import { callAI, type ChatMessage } from '@/services/ai'
import { buildChapterWritingPlanPrompt } from '@/services/prompts'
import type { ModelConfig } from '@/stores/config'
import type { Novel } from '@/types/novel'
import { countNovelWords } from '@/utils/format'

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

  function beginGeneration() {
    options.writing.value = true
    abortController = new AbortController()
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
        activityParentId,
      })
      return result.content.trim()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      options.onWarning?.('写作计划生成失败，已直接进入正文生成')
      return ''
    }
  }

  async function streamAppend(
    model: ModelConfig,
    messages: ChatMessage[],
    maxTokens?: number,
    streamOptions: { stopAtWords?: number; activityParentId?: string; taskName?: string } = {},
  ) {
    let stopAtNaturalSentence = false
    if ((!abortController || abortController.signal.aborted) && options.writing.value) {
      abortController = new AbortController()
    }
    try {
      await callAI({
        model,
        skillTask: 'writing',
        messages,
        stream: true,
        signal: getGenerationSignal(),
        maxTokens,
        taskName: streamOptions.taskName || '正文生成',
        activityParentId: streamOptions.activityParentId,
        onChunk: (chunk) => {
          if (stopAtNaturalSentence) return
          options.content.value += chunk
          options.statusText.value = getChapterGenerationStatus(
            countNovelWords(options.content.value),
            options.minWords,
            options.softWords,
            options.hardWords,
          )
          options.onChunk?.()
          if (streamOptions.stopAtWords && countNovelWords(options.content.value) >= streamOptions.stopAtWords) {
            const endingPattern = /[。！？!?…](?:[」』”’）)]*)/g
            let match: RegExpExecArray | null
            while ((match = endingPattern.exec(options.content.value))) {
              const end = match.index + match[0].length
              if (countNovelWords(options.content.value.slice(0, end)) >= streamOptions.stopAtWords) {
                options.content.value = options.content.value.slice(0, end)
                stopAtNaturalSentence = true
                break
              }
            }
            options.statusText.value = `AI 正在收束本章...（已达到 ${streamOptions.stopAtWords} 字目标）`
          }
        },
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && options.writing.value) return
      throw error
    }
  }

  return { beginGeneration, stopGeneration, getGenerationSignal, generateWritingPlan, streamAppend }
}
