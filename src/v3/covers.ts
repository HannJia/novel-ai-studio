// 内置封面：按作品大类自动匹配，作者可在书架手动更换（Novel.coverId）。
import type { Novel } from '@/types/novel'

const FILES = import.meta.glob('../assets/v3/covers/*.webp', { eager: true, import: 'default' }) as Record<string, string>
const URLS: Record<string, string> = {}
for (const [file, url] of Object.entries(FILES)) URLS[file.replace(/^.*\/(.+)\.webp$/, '$1')] = url

/** 作品大类 value → 默认封面 ID（与 src/data/genres.ts 的顶层 value 对应）。 */
const BY_GENRE: Record<string, string> = {
  xuanhuan: 'xuanhuan', xianxia: 'xianxia', wuxia: 'wuxia', urban: 'urban', reality: 'reality', history: 'history',
  military: 'military', game: 'game', scifi: 'scifi', mystery: 'mystery', sports: 'sports', 'light-novel': 'light-novel',
  multiverse: 'multiverse', other: 'other',
}

export const COVER_CHOICES: Array<{ id: string; label: string }> = [
  { id: 'xuanhuan', label: '玄幻 · 云龙' }, { id: 'xianxia', label: '仙侠 · 鹤月' }, { id: 'wuxia', label: '武侠 · 雪剑' },
  { id: 'urban', label: '都市 · 雨城' }, { id: 'reality', label: '现实 · 小巷' }, { id: 'history', label: '历史 · 城门' },
  { id: 'military', label: '军事 · 旌旗' }, { id: 'game', label: '游戏 · 方阵' }, { id: 'scifi', label: '科幻 · 星环' },
  { id: 'mystery', label: '悬疑 · 夜渡' }, { id: 'sports', label: '体育 · 晨跑' }, { id: 'light-novel', label: '轻小说 · 樱屋顶' },
  { id: 'multiverse', label: '诸天 · 星珠' }, { id: 'moon-1', label: '月下 · 梅舟' }, { id: 'moon-2', label: '月下 · 远山' },
  { id: 'other', label: '笔砚' },
].filter(choice => URLS[choice.id])

export function coverIdOf(novel: Pick<Novel, 'coverId' | 'genre'>): string {
  if (novel.coverId && URLS[novel.coverId]) return novel.coverId
  return BY_GENRE[novel.genre] || 'other'
}
export function coverUrl(novel: Pick<Novel, 'coverId' | 'genre'>): string {
  return URLS[coverIdOf(novel)] || URLS.other || ''
}
export const coverUrlById = (id: string) => URLS[id] || ''
