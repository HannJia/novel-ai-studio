import { ref, type Ref } from 'vue'
import { callAI, type ChatMessage } from '@/services/ai'
import { buildChapterWritingPlanPrompt } from '@/services/prompts'
import type { ModelConfig } from '@/stores/config'
import type { Novel } from '@/types/novel'
import { countNovelWords } from '@/utils/format'
import { MAX_CHAPTER_DRAFT_REQUESTS } from '@/services/chapterGeneration'
import type { ChapterLengthPolicy } from '@/services/chapterLength'

interface ChapterAiGenerationOptions {
  writing: Ref<boolean>
  statusText: Ref<string>
  lengthPolicy: Ref<ChapterLengthPolicy>
  onChunk?: () => void
  onWarning?: (message: string) => void
  ensureCurrent?: () => void
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
  // This buffer is never the manuscript ref watched by editor autosave.
  const draft = ref('')

  function beginGeneration(baseContent = '') {
    abortController?.abort()
    draft.value = baseContent
    options.writing.value = true
    abortController = new AbortController()
    draftRequests = 0
  }

  async function waitForGeneration<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = getGenerationSignal()
    signal.throwIfAborted()
    options.ensureCurrent?.()
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason || new DOMException('生成已停止', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve().then(() => {
        signal.throwIfAborted()
        return request(signal)
      }).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  async function requestDraft<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
    getGenerationSignal().throwIfAborted()
    options.ensureCurrent?.()
    if (draftRequests >= MAX_CHAPTER_DRAFT_REQUESTS) throw new Error('本次正文生成已达到 3 次请求上限，已保留候选，请检查后再继续')
    draftRequests++
    return waitForGeneration(request)
  }

  function stopGeneration() {
    abortController?.abort()
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
    const signal = getGenerationSignal()
    try {
      signal.throwIfAborted()
      options.ensureCurrent?.()
      const result = await waitForGeneration(() => callAI({
        model,
        skillTask: 'planning',
        messages: buildChapterWritingPlanPrompt(novel, factCard, chapterGuidance),
        maxTokens: 1200,
        signal,
        taskName: '写作计划',
        noAutomaticRetry: true,
        activityParentId,
      }))
      signal.throwIfAborted()
      options.ensureCurrent?.()
      return result.content.trim()
    } catch (error) {
      signal.throwIfAborted()
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
    const before = draft.value
    let streamed = ''
    let receiving = true
    const result = await requestDraft(() => callAI({
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
        // Some transports still deliver queued chunks after abort/restart.
        if (!receiving || signal.aborted || signal !== abortController?.signal) return
        try { options.ensureCurrent?.() }
        catch (error) { abortController?.abort(error); return }
        streamed += chunk
        draft.value = before + streamed
        options.statusText.value = getChapterGenerationStatus(
          countNovelWords(draft.value), options.lengthPolicy.value.minWords, options.lengthPolicy.value.targetWords, options.lengthPolicy.value.maxWords,
        )
        options.onChunk?.()
      },
    })).finally(() => { receiving = false })
    signal.throwIfAborted()
    options.ensureCurrent?.()
    if (!streamed) draft.value = before + result.content
    else if (result.content && result.content !== streamed) {
      if (result.content.startsWith(streamed)) draft.value = before + result.content
      else throw new Error('模型最终输出与流式片段不一致，已保留收到的候选，请人工核对')
    }
    if (result.finishReason && !['stop', 'length'].includes(result.finishReason)) {
      throw new Error('模型未正常完成正文输出，已保留草稿，请查看接口返回情况')
    }
    if (result.finishReason === 'length') options.onWarning?.('输出达到模型上限，已保留候选，将检查是否需要收尾')
    return result
  }

  return { draft, beginGeneration, stopGeneration, getGenerationSignal, generateWritingPlan, streamAppend, requestDraft, waitForGeneration }
}
