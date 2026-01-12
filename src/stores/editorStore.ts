import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { countWords } from '@/utils/wordCount'

export interface EditorState {
  content: string
  selection: { start: number; end: number }
  scrollPosition: number
}

export const useEditorStore = defineStore('editor', () => {
  // 状态
  const content = ref('')
  const originalContent = ref('')  // 用于检测是否有未保存的更改
  const selection = ref({ start: 0, end: 0 })
  const scrollPosition = ref(0)
  const isSaving = ref(false)
  const lastSavedAt = ref<string | null>(null)
  const autoSaveEnabled = ref(true)
  const autoSaveInterval = ref(30000)  // 30秒
  const currentChapterId = ref<string | null>(null)

  // 计算属性
  const hasUnsavedChanges = computed(() => content.value !== originalContent.value)

  const wordCount = computed(() => {
    return countWords(content.value)
  })

  const selectionLength = computed(() => {
    const selectedText = content.value.slice(selection.value.start, selection.value.end)
    return countWords(selectedText)
  })

  // 方法
  function setContent(newContent: string): void {
    content.value = newContent
  }

  function setOriginalContent(newContent: string): void {
    originalContent.value = newContent
  }

  function updateContent(newContent: string): void {
    content.value = newContent
  }

  function setSelection(start: number, end: number): void {
    selection.value = { start, end }
  }

  function setCurrentChapterId(id: string | null): void {
    currentChapterId.value = id
  }

  function insertText(text: string): void {
    const before = content.value.slice(0, selection.value.start)
    const after = content.value.slice(selection.value.end)
    content.value = before + text + after
    const newPosition = selection.value.start + text.length
    selection.value = { start: newPosition, end: newPosition }
  }

  function replaceSelection(text: string): void {
    insertText(text)
  }

  function loadChapterContent(chapterContent: string, chapterId: string): void {
    content.value = chapterContent
    originalContent.value = chapterContent
    currentChapterId.value = chapterId
    lastSavedAt.value = null
    selection.value = { start: 0, end: 0 }
  }

  function undo(): void {
    // TODO: 实现撤销功能
  }

  function redo(): void {
    // TODO: 实现重做功能
  }

  function markAsSaved(): void {
    originalContent.value = content.value
    lastSavedAt.value = new Date().toISOString()
  }

  function reset(): void {
    content.value = ''
    originalContent.value = ''
    selection.value = { start: 0, end: 0 }
    scrollPosition.value = 0
    lastSavedAt.value = null
    currentChapterId.value = null
  }

  return {
    // 状态
    content,
    originalContent,
    selection,
    scrollPosition,
    isSaving,
    lastSavedAt,
    autoSaveEnabled,
    autoSaveInterval,
    currentChapterId,
    // 计算属性
    hasUnsavedChanges,
    wordCount,
    selectionLength,
    // 方法
    setContent,
    setOriginalContent,
    updateContent,
    setSelection,
    setCurrentChapterId,
    insertText,
    replaceSelection,
    loadChapterContent,
    undo,
    redo,
    markAsSaved,
    reset
  }
})
