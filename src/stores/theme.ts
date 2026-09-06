import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GlobalThemeOverrides } from 'naive-ui'

export type ThemeName = 'fanqie' | 'eyecare' | 'dark'

export interface ThemeOption {
  name: ThemeName
  label: string
  icon: string
}

// 主题选项列表
export const themeOptions: ThemeOption[] = [
  { name: 'fanqie', label: '番茄风格', icon: '🍅' },
  { name: 'eyecare', label: '护眼模式', icon: '🌿' },
  { name: 'dark', label: '深色模式', icon: '🌙' },
]

export const useThemeStore = defineStore('theme', () => {
  // 当前主题名
  const currentTheme = ref<ThemeName>('fanqie')

  // 是否为深色模式
  const isDark = computed(() => currentTheme.value === 'dark')

  // 切换主题
  function switchTheme(theme: ThemeName) {
    currentTheme.value = theme
    document.documentElement.setAttribute('data-theme', theme)
    // 持久化到 localStorage
    localStorage.setItem('novel-writer-theme', theme)
  }

  // 初始化主题（从 localStorage 或默认）
  function initTheme() {
    const saved = localStorage.getItem('novel-writer-theme') as ThemeName | null
    if (saved && ['fanqie', 'eyecare', 'dark'].includes(saved)) {
      switchTheme(saved)
    } else {
      switchTheme('fanqie')
    }
  }

  // 获取 Naive UI 主题覆盖配置
  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const primary = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary').trim() || '#FF4D2E'
    const primaryHover = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary-hover').trim() || '#FF6B4F'
    const primaryPressed = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary-pressed').trim() || '#E04428'

    return {
      common: {
        primaryColor: primary,
        primaryColorHover: primaryHover,
        primaryColorPressed: primaryPressed,
        borderRadius: '10px',
        fontFamily: "'Microsoft YaHei', 'PingFang SC', -apple-system, sans-serif",
      },
      Button: {
        borderRadiusMedium: '8px',
        borderRadiusLarge: '10px',
      },
      Card: {
        borderRadius: '14px',
      },
      Input: {
        borderRadius: '8px',
      },
      Select: {
        borderRadius: '8px',
      },
    }
  })

  return {
    currentTheme,
    isDark,
    switchTheme,
    initTheme,
    themeOverrides,
  }
})
