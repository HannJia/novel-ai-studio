import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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

  // 计算属性
  const hasUnsavedChanges = computed(() => content.value !== originalContent.value)

  const wordCount = computed(() => {
    // 使用字数统计工具（待实现）
    return 0
  })

  const selectionLength = computed(() => selection.value.end - selection.value.start)

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
    // 计算属性
    hasUnsavedChanges,
    wordCount,
    selectionLength,
    // 方法
    setContent,
    setOriginalContent,
    updateContent,
    setSelection,
    insertText,
    replaceSelection,
    undo,
    redo,
    markAsSaved,
    reset
  }
})
