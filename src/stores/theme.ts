import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GlobalThemeOverrides } from 'naive-ui'

// V3 主题与原生控件使用统一色板。
export type ThemeName = 'fanqie' | 'eyecare' | 'dark'

export interface ThemeOption {
  name: ThemeName
  label: string
  description: string
  /** 色块预览：背景 / 主色 */
  swatch: [string, string]
}

// 主题选项列表
export const themeOptions: ThemeOption[] = [
  { name: 'fanqie', label: '宣纸', description: '东方书卷，淡雅舒适', swatch: ['#ECE7DC', '#B8321F'] },
  { name: 'eyecare', label: '青瓷', description: '柔和豆青，长时写作', swatch: ['#E3E9E4', '#2C5470'] },
  { name: 'dark', label: '夜墨', description: '深色护眼，专注沉浸', swatch: ['#141311', '#E0634B'] },
]

interface Palette {
  primary: string
  primaryHover: string
  primaryPressed: string
  info: string
  success: string
  warning: string
  error: string
  body: string
  card: string
  border: string
  text: string
}

// 与 V3 设计系统的原生色板保持一致。
const palettes: Record<ThemeName, Palette> = {
  fanqie: {
    primary: '#B8321F', primaryHover: '#C44632', primaryPressed: '#9E281A',
    info: '#2F4F6A', success: '#3F7A64', warning: '#A87A1E', error: '#B8321F',
    body: '#ECE7DC', card: '#FCFAF5', border: '#DDD5C6', text: '#1E1C19',
  },
  eyecare: {
    primary: '#B23A2A', primaryHover: '#C54A39', primaryPressed: '#963022',
    info: '#2C5470', success: '#2F7A5E', warning: '#A87A1E', error: '#B23A2A',
    body: '#E3E9E4', card: '#F8FAF7', border: '#CCD7CF', text: '#18221D',
  },
  dark: {
    primary: '#E0634B', primaryHover: '#EA7B65', primaryPressed: '#C54D38',
    info: '#7EA6C4', success: '#6FB596', warning: '#D6A84A', error: '#E0634B',
    body: '#141311', card: '#1F1D1A', border: '#2E2B26', text: '#E9E3D6',
  },
}

const UI_FONT = "'Noto Sans SC Variable', 'Microsoft YaHei UI', system-ui, sans-serif"

export const useThemeStore = defineStore('theme', () => {
  // 当前主题名
  const currentTheme = ref<ThemeName>('fanqie')

  // 是否为深色模式
  const isDark = computed(() => currentTheme.value === 'dark')

  // 切换主题
  function switchTheme(theme: ThemeName) {
    // A storage failure must leave the visible theme unchanged during restore.
    localStorage.setItem('mojian-v3-theme', theme)
    currentTheme.value = theme
    document.documentElement.setAttribute('data-theme', theme)
    // 持久化到 localStorage
  }

  // 初始化主题（从 localStorage 或默认）
  function initTheme() {
    const saved = localStorage.getItem('mojian-v3-theme') as ThemeName | null
    if (saved && ['fanqie', 'eyecare', 'dark'].includes(saved)) {
      switchTheme(saved)
    } else {
      switchTheme('fanqie')
    }
  }

  // Naive UI 主题覆盖，随当前主题变化
  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const p = palettes[currentTheme.value]
    const common: GlobalThemeOverrides['common'] = {
      primaryColor: p.primary,
      primaryColorHover: p.primaryHover,
      primaryColorPressed: p.primaryPressed,
      primaryColorSuppl: p.primaryHover,
      infoColor: p.info,
      infoColorHover: p.info,
      infoColorPressed: p.info,
      infoColorSuppl: p.info,
      successColor: p.success,
      successColorHover: p.success,
      successColorPressed: p.success,
      successColorSuppl: p.success,
      warningColor: p.warning,
      warningColorHover: p.warning,
      warningColorPressed: p.warning,
      warningColorSuppl: p.warning,
      errorColor: p.error,
      errorColorHover: p.primaryHover,
      errorColorPressed: p.primaryPressed,
      errorColorSuppl: p.error,
      borderRadius: '6px',
      borderRadiusSmall: '4px',
      fontFamily: UI_FONT,
    }
    if (!isDark.value) {
      Object.assign(common, {
        bodyColor: p.body,
        cardColor: p.card,
        modalColor: p.card,
        popoverColor: p.card,
        tableColor: p.card,
        inputColor: '#FFFDF8',
        borderColor: p.border,
        dividerColor: p.border,
        textColorBase: p.text,
        textColor1: p.text,
        textColor2: p.text,
      })
    }
    return {
      common,
      Button: {
        borderRadiusTiny: '4px',
        borderRadiusSmall: '4px',
        borderRadiusMedium: '6px',
        borderRadiusLarge: '6px',
        fontWeight: '500',
      },
      Card: { borderRadius: '8px' },
      Input: { borderRadius: '6px' },
      Select: { peers: { InternalSelection: { borderRadius: '6px' } } },
      Tabs: { tabTextColorActiveLine: p.primary, barColor: p.primary },
      Tag: { borderRadius: '4px' },
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
