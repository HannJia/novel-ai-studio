// V3 外壳的共享状态：提示、命令面板、设置浮层、界面偏好、当前作品与各区入口。
import { reactive, ref } from 'vue'
import type { ThemeName } from '@/stores/theme'

export interface V3Toast { id: number; text: string; error?: boolean }
export const toasts = reactive<V3Toast[]>([])
let toastSeq = 0
export function toast(text: string, options: { error?: boolean; ms?: number } = {}) {
  const item = { id: ++toastSeq, text, error: options.error }
  toasts.push(item)
  setTimeout(() => { const i = toasts.findIndex(t => t.id === item.id); if (i >= 0) toasts.splice(i, 1) }, options.ms ?? (options.error ? 5200 : 2600))
}
export function toastError(error: unknown, fallback: string) {
  toast(error instanceof Error && error.message ? error.message : fallback, { error: true })
}

export const paletteOpen = ref(false)
/** 设置仍使用现有设置页，以浮层打开，直到新版设置页完成（计划批 7）。 */
export const settingsOpen = ref(false)

const SHELL_KEY = 'mojian-ui-shell'
export type ShellPref = 'v3' | 'legacy'
export function readShellPref(): ShellPref {
  try { return localStorage.getItem(SHELL_KEY) === 'legacy' ? 'legacy' : 'v3' } catch { return 'v3' }
}
export function writeShellPref(pref: ShellPref) {
  try { localStorage.setItem(SHELL_KEY, pref) } catch { /* 偏好写入失败时本次仍按地址切换 */ }
}

const BOOK_KEY = 'mojian-v3-current-book'
export function rememberBook(novelId: string) { try { localStorage.setItem(BOOK_KEY, novelId) } catch { /* 仅为便利 */ } }
export function recalledBook(): string { try { return localStorage.getItem(BOOK_KEY) || '' } catch { return '' } }

export const THEME_LABEL: Record<ThemeName, string> = { fanqie: '宣纸', eyecare: '青瓷', dark: '夜墨' }
export const THEME_ORDER: ThemeName[] = ['fanqie', 'eyecare', 'dark']
export const nextTheme = (current: ThemeName): ThemeName => THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length]

export type BookArea = 'write' | 'plan' | 'codex' | 'review' | 'auto'
/**
 * 各区入口。新界面尚未接管的区域暂时进入旧界面的对应页面（地址由已实现的界面负责）；
 * 每完成一批，在这里改为新界面地址。
 */
export function areaPath(area: BookArea, novelId: string, chapterId?: string): string {
  switch (area) {
    case 'write': return chapterId ? `/write/${novelId}/${chapterId}` : `/write/${novelId}`
    case 'plan': return `/plan/${novelId}`
    case 'codex': return `/codex/${novelId}`
    case 'review': return `/review/${novelId}`
    case 'auto': return `/auto/${novelId}`
  }
}
