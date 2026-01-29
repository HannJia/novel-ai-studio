import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'auto'

export const useUiStore = defineStore('ui', () => {
  // 状态
  const sidebarCollapsed = ref(false)
  const rightPanelVisible = ref(true)
  const rightPanelTab = ref<'ai' | 'outline' | 'character'>('ai')
  const themeMode = ref<ThemeMode>('light')
  const fontSize = ref(16)
  const lineHeight = ref(1.8)
  const editorWidth = ref(800)
  const showWordCount = ref(true)
  const showLineNumbers = ref(false)

  // 计算属性
  const isDarkMode = computed(() => {
    if (themeMode.value === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return themeMode.value === 'dark'
  })

  // 方法
  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function toggleRightPanel(): void {
    rightPanelVisible.value = !rightPanelVisible.value
  }

  function setRightPanelTab(tab: 'ai' | 'outline' | 'character'): void {
    rightPanelTab.value = tab
    if (!rightPanelVisible.value) {
      rightPanelVisible.value = true
    }
  }

  function setThemeMode(mode: ThemeMode): void {
    themeMode.value = mode
    applyTheme()
    // 立即保存到 localStorage
    localStorage.setItem('themeMode', mode)
  }

  function applyTheme(): void {
    const html = document.documentElement
    if (isDarkMode.value) {
      html.classList.remove('theme-light')
      html.classList.add('theme-dark')
      html.classList.add('dark')
    } else {
      html.classList.remove('theme-dark')
      html.classList.remove('dark')
      html.classList.add('theme-light')
    }
  }

  function setFontSize(size: number): void {
    fontSize.value = Math.max(12, Math.min(24, size))
  }

  function setLineHeight(height: number): void {
    lineHeight.value = Math.max(1.2, Math.min(2.5, height))
  }

  function setEditorWidth(width: number): void {
    editorWidth.value = Math.max(600, Math.min(1200, width))
  }

  function toggleWordCount(): void {
    showWordCount.value = !showWordCount.value
  }

  function toggleLineNumbers(): void {
    showLineNumbers.value = !showLineNumbers.value
  }

  // 初始化主题
  function initTheme(): void {
    // 从localStorage读取设置
    const savedTheme = localStorage.getItem('themeMode') as ThemeMode | null
    if (savedTheme) {
      themeMode.value = savedTheme
    }
    applyTheme()

    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode.value === 'auto') {
        applyTheme()
      }
    })
  }

  // 保存设置
  function saveSettings(): void {
    localStorage.setItem('themeMode', themeMode.value)
    localStorage.setItem('fontSize', fontSize.value.toString())
    localStorage.setItem('lineHeight', lineHeight.value.toString())
    localStorage.setItem('editorWidth', editorWidth.value.toString())
    localStorage.setItem('showWordCount', showWordCount.value.toString())
    localStorage.setItem('showLineNumbers', showLineNumbers.value.toString())
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed.value.toString())
  }

  // 加载设置
  function loadSettings(): void {
    const savedFontSize = localStorage.getItem('fontSize')
    const savedLineHeight = localStorage.getItem('lineHeight')
    const savedEditorWidth = localStorage.getItem('editorWidth')
    const savedShowWordCount = localStorage.getItem('showWordCount')
    const savedShowLineNumbers = localStorage.getItem('showLineNumbers')
    const savedSidebarCollapsed = localStorage.getItem('sidebarCollapsed')

    if (savedFontSize) fontSize.value = parseInt(savedFontSize, 10)
    if (savedLineHeight) lineHeight.value = parseFloat(savedLineHeight)
    if (savedEditorWidth) editorWidth.value = parseInt(savedEditorWidth, 10)
    if (savedShowWordCount) showWordCount.value = savedShowWordCount === 'true'
    if (savedShowLineNumbers) showLineNumbers.value = savedShowLineNumbers === 'true'
    if (savedSidebarCollapsed) sidebarCollapsed.value = savedSidebarCollapsed === 'true'

    initTheme()
  }

  return {
    // 状态
    sidebarCollapsed,
    rightPanelVisible,
    rightPanelTab,
    themeMode,
    fontSize,
    lineHeight,
    editorWidth,
    showWordCount,
    showLineNumbers,
    // 计算属性
    isDarkMode,
    // 方法
    toggleSidebar,
    toggleRightPanel,
    setRightPanelTab,
    setThemeMode,
    setFontSize,
    setLineHeight,
    setEditorWidth,
    toggleWordCount,
    toggleLineNumbers,
    saveSettings,
    loadSettings
  }
})
