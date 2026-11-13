// 写作日历：本机按日记录进入正文的新增字数。只记数字，不记正文；不进入项目备份或云同步。
// 做法：定期比较每章字数与上次快照，只累计增长部分（删改不扣减），因此任何界面里的写作都会被记录。
// “采纳 AI”由新界面在接受候选时显式登记；旧界面接受候选的字数计入“作者”。
import { readonly, ref } from 'vue'
import { useNovelStore } from '@/stores/novel'
import { cloudApplyBusy, projectTransferBusy } from '@/services/appLifecycle'

export interface DayEntry { total: number; ai: number; books: Record<string, number> }
const KEY = 'mojian-writing-log-v1'
const KEEP_DAYS = 400
const log = ref<Record<string, DayEntry>>({})
const snapshot = new Map<string, number>()
const knownBooks = new Set<string>()
let started = false, sessionStart = '', dirty = false

export const dayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    if (raw && typeof raw === 'object') {
      for (const [day, e] of Object.entries(raw as Record<string, Partial<DayEntry>>)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !e || typeof e !== 'object') continue
        const total = Number(e.total) || 0, ai = Math.min(total, Number(e.ai) || 0)
        const books: Record<string, number> = {}
        for (const [id, n] of Object.entries(e.books || {})) if (Number(n) > 0) books[id] = Number(n)
        if (total > 0) log.value[day] = { total, ai, books }
      }
    }
  } catch { /* 损坏的记录直接忽略，从今天重新开始 */ }
}
function save() {
  if (!dirty) return
  const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * 86400000))
  for (const day of Object.keys(log.value)) if (day < cutoff) delete log.value[day]
  try { localStorage.setItem(KEY, JSON.stringify(log.value)); dirty = false } catch { /* 空间不足时保留内存记录，下次重试 */ }
}
function entry(day: string): DayEntry {
  return log.value[day] || (log.value[day] = { total: 0, ai: 0, books: {} })
}

function scan() {
  const store = useNovelStore()
  // 导入项目、合并云端时整体换底，不把载入的旧稿记成今天写的
  const rebase = projectTransferBusy.value || cloudApplyBusy.value
  const seen = new Set<string>(), day = dayKey()
  for (const novel of store.novels) {
    const fresh = !knownBooks.has(novel.id)
    knownBooks.add(novel.id)
    const createdHere = fresh && novel.createdAt >= sessionStart
    for (const chapter of novel.chapters) {
      const key = novel.id + '/' + chapter.id
      seen.add(key)
      const prev = snapshot.get(key)
      snapshot.set(key, chapter.wordCount)
      if (rebase || (fresh && !createdHere)) continue
      const gain = chapter.wordCount - (prev ?? 0)
      if (gain > 0) {
        const e = entry(day)
        e.total += gain
        e.books[novel.id] = (e.books[novel.id] || 0) + gain
        dirty = true
      }
    }
  }
  for (const key of [...snapshot.keys()]) if (!seen.has(key)) snapshot.delete(key)
  save()
}

/** 在应用启动、数据载入后调用一次。 */
export function startWritingLog() {
  if (started) return
  started = true
  sessionStart = new Date().toISOString()
  load()
  const store = useNovelStore()
  for (const novel of store.novels) {
    knownBooks.add(novel.id)
    for (const chapter of novel.chapters) snapshot.set(novel.id + '/' + chapter.id, chapter.wordCount)
  }
  setInterval(scan, 8000)
  window.addEventListener('beforeunload', scan)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') scan() })
}

/** 新界面接受 AI 候选后登记：新增字数中有多少来自采纳的 AI 文字。 */
export function markAiAccepted(addedWords: number) {
  if (!(addedWords > 0)) return
  scan()
  const e = entry(dayKey())
  e.ai = Math.min(e.total, e.ai + addedWords)
  dirty = true
  save()
}

export const writingLog = readonly(log)
export function weekTotal(novelId?: string, now = new Date()): number {
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  let sum = 0
  for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
    const e = log.value[dayKey(d)]
    if (e) sum += novelId ? (e.books[novelId] || 0) : e.total
  }
  return sum
}
export function streakDays(now = new Date()): number {
  const d = new Date(now)
  if (!log.value[dayKey(d)]) d.setDate(d.getDate() - 1)
  let n = 0
  while (log.value[dayKey(d)]) { n++; d.setDate(d.getDate() - 1) }
  return n
}

/** 当前自然周内的连续写作天数，周一作为一周起点。 */
export function weekStreakDays(now = new Date()): number {
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  const weekStart = new Date(d)
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  if (!log.value[dayKey(d)]) d.setDate(d.getDate() - 1)
  if (d < weekStart) return 0
  let n = 0
  while (d >= weekStart && log.value[dayKey(d)]) {
    n++; d.setDate(d.getDate() - 1)
  }
  return n
}

/** 连续写作天数，但只在当前自然月内计算。 */
export function monthStreakDays(now = new Date()): number {
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  const year = d.getFullYear(), month = d.getMonth()
  if (!log.value[dayKey(d)]) d.setDate(d.getDate() - 1)
  if (d.getFullYear() !== year || d.getMonth() !== month) return 0
  let n = 0
  while (d.getFullYear() === year && d.getMonth() === month && log.value[dayKey(d)]) {
    n++; d.setDate(d.getDate() - 1)
  }
  return n
}
