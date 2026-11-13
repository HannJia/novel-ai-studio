import { computed, onScopeDispose, reactive, ref, watch, type Ref } from 'vue'
import { useConfigStore, type EmbeddingConfig } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { writingAdviceReferenceVersion, writingAdviceContentSignature } from '@/services/writingAdviceSource'
import type { Chapter, Novel } from '@/types/novel'
import {
  extractWritingFocus,
  requestWritingAdvice,
  type WritingAdviceMode,
  type WritingAdviceResult,
  type WritingAdviceSuggestion,
} from '@/services/writingAdvisor'

interface UseWritingAdvisorOptions {
  currentNovel: Ref<Novel | null | undefined>
  currentChapter: Ref<Chapter | null | undefined>
  currentContent: Ref<string>
  textarea: Ref<{ selectionStart: number | null; selectionEnd: number | null } | null>
  embeddingConfig?: EmbeddingConfig
  onInfo?: (message: string) => void
  onWarning?: (message: string) => void
}

const modes: WritingAdviceMode[] = ['paragraph', 'scene', 'chapter']
function emptyAdviceState() {
  return { result: null as WritingAdviceResult | null, signature: '', error: '', analyzing: false, rejectedStale: false }
}

export function useWritingAdvisor(options: UseWritingAdvisorOptions) {
  const configStore = useConfigStore()
  const knowledgeStore = useKnowledgeStore()
  const workspace = useReconstructionWorkspaceStore()
  const open = ref(false)
  const lastMode = ref<WritingAdviceMode>('scene')
  const states = reactive({
    paragraph: emptyAdviceState(), scene: emptyAdviceState(), chapter: emptyAdviceState(),
  })
  const requests: Partial<Record<WritingAdviceMode, AbortController>> = {}
  // Keep unrelated actions (chatting, saving, opening panels) out of this
  // signature. Calculate reference-data changes separately from live typing.
  const referenceSignature = computed(() => {
    const novel = options.currentNovel.value
    const chapter = options.currentChapter.value
    if (!novel || !chapter) return ''
    return writingAdviceReferenceVersion(novel, chapter, workspace.getCreationDraft(novel.id),
      workspace.getCanonMutations(novel.id), workspace.getStoryMemories(novel.id), knowledgeStore.knowledgeBases)
  })
  const inputSignature = computed(() => `${referenceSignature.value}:${writingAdviceContentSignature(options.currentContent.value)}`)
  const current = computed(() => states[lastMode.value])
  const analyzing = computed(() => current.value.analyzing)
  const error = computed(() => current.value.error)
  const result = computed(() => current.value.result)
  const stale = computed(() => current.value.rejectedStale
    || Boolean(current.value.result && current.value.signature !== inputSignature.value))
  const analyzingModes = computed(() => modes.filter(mode => states[mode].analyzing))
  const hasAdvice = computed(() => Boolean(result.value?.suggestions.length))

  function selectMode(mode: WritingAdviceMode) {
    lastMode.value = mode
    open.value = true
  }

  function close() {
    open.value = false
  }

  function getSuggestionSourceVersion(suggestion: WritingAdviceSuggestion): string | undefined {
    return modes.some(mode => !states[mode].rejectedStale && states[mode].signature === inputSignature.value
      && states[mode].result?.suggestions.includes(suggestion)) ? inputSignature.value : undefined
  }

  function stop(mode: WritingAdviceMode = lastMode.value) {
    requests[mode]?.abort()
    delete requests[mode]
    states[mode].analyzing = false
  }

  async function analyze(mode: WritingAdviceMode = lastMode.value) {
    selectMode(mode)
    if (states[mode].analyzing) return
    const novel = options.currentNovel.value
    const chapter = options.currentChapter.value
    if (!novel || !chapter) return
    const model = configStore.getModelForTask('writing') || configStore.getModelForTask('outline')
    if (!model) {
      options.onWarning?.('请先在设置页面配置 AI 模型')
      return
    }

    const textarea = options.textarea.value
    const selectionStart = textarea?.selectionStart ?? options.currentContent.value.length
    const selectionEnd = textarea?.selectionEnd ?? selectionStart
    const focus = extractWritingFocus(options.currentContent.value, selectionStart, selectionEnd)
    const snapshotNovelId = novel.id
    const snapshotChapterId = chapter.id
    const snapshotSignature = inputSignature.value

    const request = new AbortController()
    requests[mode] = request
    const state = states[mode]
    state.analyzing = true
    state.error = ''
    state.rejectedStale = false
    try {
      const advice = await requestWritingAdvice({
        creationDraft: workspace.getCreationDraft(novel.id),
        canonMutations: workspace.getCanonMutations(novel.id),
        storyMemories: workspace.getStoryMemories(novel.id),
        readStoryMemories: () => workspace.getStoryMemories(novel.id),
        model: { ...model },
        novel,
        chapter,
        content: options.currentContent.value,
        focus,
        mode,
        embeddingConfig: options.embeddingConfig,
        signal: request.signal,
      })
      if (requests[mode] !== request || request.signal.aborted) return
      const currentNovel = options.currentNovel.value
      const currentChapter = options.currentChapter.value
      if (
        currentNovel?.id !== snapshotNovelId
        || currentChapter?.id !== snapshotChapterId
        || inputSignature.value !== snapshotSignature
      ) {
        state.rejectedStale = true
        state.error = '正文、章节或参考资料已变化，这份建议已过期，请重新分析。'
        return
      }
      state.result = advice
      state.signature = snapshotSignature
      options.onInfo?.(`已生成 ${advice.suggestions.length} 个写作方向`)
    } catch (err: unknown) {
      if (requests[mode] !== request || request.signal.aborted) return
      if (err instanceof Error && err.name === 'AbortError') return
      state.error = err instanceof Error ? err.message : '写作建议生成失败'
      options.onWarning?.(state.error)
    } finally {
      if (requests[mode] === request) {
        state.analyzing = false
        delete requests[mode]
      }
    }
  }

  async function analyzeAll() {
    open.value = true
    await Promise.all(modes.map(mode => analyze(mode)))
  }

  function clear() {
    stop()
    states[lastMode.value] = emptyAdviceState()
  }
  function reset() {
    for (const mode of modes) {
      stop(mode)
      states[mode] = emptyAdviceState()
    }
    lastMode.value = 'scene'
  }
  watch(() => [options.currentNovel.value?.id, options.currentChapter.value?.id], reset, { flush: 'sync' })
  onScopeDispose(() => modes.forEach(mode => stop(mode)))

  return {
    open,
    analyzing,
    error,
    stale,
    result,
    lastMode,
    analyzingModes,
    hasAdvice,
    getSuggestionSourceVersion,
    selectMode,
    analyze,
    analyzeAll,
    stop,
    close,
    clear,
  }
}
