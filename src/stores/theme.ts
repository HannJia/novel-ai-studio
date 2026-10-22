import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { GlobalThemeOverrides } from 'naive-ui'

// 主题键名保持不变，兼容已保存在 localStorage 中的偏好
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
  { name: 'fanqie', label: '宣纸', description: '东方书卷，淡雅舒适', swatch: ['#F6F1E7', '#B83A2E'] },
  { name: 'eyecare', label: '护眼', description: '柔和豆青，长时写作', swatch: ['#E9EEDD', '#47695A'] },
  { name: 'dark', label: '夜墨', description: '深色护眼，专注沉浸', swatch: ['#191C20', '#D86A5C'] },
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

// 与 variables.css 中三套主题保持一致
const palettes: Record<ThemeName, Palette> = {
  fanqie: {
    primary: '#B83A2E', primaryHover: '#C94C3F', primaryPressed: '#9E3026',
    info: '#3E5C6B', success: '#5E8C6A', warning: '#B7832F', error: '#B83A2E',
    body: '#F6F1E7', card: '#FBF8F2', border: '#E3DACB', text: '#2B2A28',
  },
  eyecare: {
    primary: '#A8432F', primaryHover: '#B85540', primaryPressed: '#8E3726',
    info: '#47695A', success: '#4F7D5B', warning: '#A57A2E', error: '#A8432F',
    body: '#E9EEDD', card: '#F1F4E8', border: '#CFD8C0', text: '#2D3328',
  },
  dark: {
    primary: '#D86A5C', primaryHover: '#E47F72', primaryPressed: '#C2594C',
    info: '#7FA3B4', success: '#8DBB98', warning: '#D8B26A', error: '#E0837A',
    body: '#191C20', card: '#22262C', border: '#343941', text: '#E6E0D4',
  },
}

const UI_FONT = "'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', -apple-system, sans-serif"

export const useThemeStore = defineStore('theme', () => {
  // 当前主题名
  const currentTheme = ref<ThemeName>('fanqie')

  // 是否为深色模式
  const isDark = computed(() => currentTheme.value === 'dark')

  // 切换主题
  function switchTheme(theme: ThemeName) {
    // A storage failure must leave the visible theme unchanged during restore.
    localStorage.setItem('novel-writer-theme', theme)
    currentTheme.value = theme
    document.documentElement.setAttribute('data-theme', theme)
    // 持久化到 localStorage
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
