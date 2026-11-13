// 书架的派生数据：继续写作、待你决定。只读，不修改任何 Store。
import type { Chapter, Novel } from '@/types/novel'
import type { AiRun, CandidateChange, ReviewFinding } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import type { IconName } from '../icons'
import { areaPath } from '../shell'

export interface ResumeTarget { novel: Novel; chapter?: Chapter; quote: string }

export function lastParagraph(text: string, max = 64): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const line = lines[lines.length - 1] || ''
  return line.length > max ? '…' + line.slice(-max) : line
}

export function resumeTarget(active: Novel[]): ResumeTarget | null {
  const novel = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!novel) return null
  const chapter = [...novel.chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return { novel, chapter, quote: chapter ? lastParagraph(chapter.content) : '' }
}

/** 只统计仍对应当前正文版本的未处理阻塞问题，避免把旧版正文的发现算进来。 */
export function openBlockers(novel: Novel, findings: ReviewFinding[]): ReviewFinding[] {
  const versions = new Map(novel.chapters.map(chapter => [chapter.id, buildAnalysisSourceVersionId(chapter.content)]))
  return findings.filter(f => f.status === 'open' && (f.blocksFinalization || f.severity === 'blocker')
    && versions.has(f.chapterId) && (!f.sourceVersionId || f.sourceVersionId === versions.get(f.chapterId)))
}

export interface PendingItem { key: string; icon: IconName; title: string; detail: string; to: string }
export interface WorkspaceReader {
  findings(novelId: string): ReviewFinding[]
  runs(novelId: string): AiRun[]
  candidates(novelId: string): CandidateChange[]
}

export function pendingItems(novels: Novel[], ws: WorkspaceReader, limit = 8): PendingItem[] {
  const items: PendingItem[] = []
  const chapterLabel = (novel: Novel, id: string) => {
    const c = novel.chapters.find(ch => ch.id === id)
    return c ? `第${c.chapterIndex + 1}章 ${c.title || '未命名'}` : '已删除的章节'
  }
  for (const novel of [...novels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const t = `《${novel.title}》`
    if (novel.status === 'creating') {
      items.push({ key: novel.id + ':creating', icon: 'file', title: `${t}设定尚未完成`, detail: '继续作品契约、故事骨架与大纲', to: `/generate/${novel.id}` })
    }
    const blockers = openBlockers(novel, ws.findings(novel.id))
    if (blockers.length) {
      items.push({ key: novel.id + ':blockers', icon: 'alert', title: `${t}${blockers.length} 处阻塞定稿`, detail: `${chapterLabel(novel, blockers[0].chapterId)} · ${blockers[0].title}`,
        to: areaPath('write', novel.id, blockers[0].chapterId) })
    }
    const waiting = ws.runs(novel.id).filter(run => run.status === 'needs_author')
    if (waiting.length) {
      items.push({ key: novel.id + ':runs', icon: 'bolt', title: `${t}自动写作等待你确认`, detail: waiting[0].error || waiting[0].checkpoint || '到达检查点或遇到需要作者处理的问题',
        to: areaPath('auto', novel.id) })
    }
    const proposed = ws.candidates(novel.id).filter(c => c.status === 'proposed' && c.chapterId && novel.chapters.some(ch => ch.id === c.chapterId))
    if (proposed.length) {
      items.push({ key: novel.id + ':cands', icon: 'book', title: `${t}${proposed.length} 条故事变化待确认`, detail: '确认后才会写入人物状态、事件与伏笔',
        to: areaPath('write', novel.id, proposed[0].chapterId) })
    }
  }
  return items.slice(0, limit)
}

export function relativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso), minutes = Math.floor((now - date.getTime()) / 60000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 书架问候：按本机时间。 */
export function greeting(now = new Date()) {
  const h = now.getHours()
  const hello = h < 5 ? '夜深了，写完这段就休息吧。' : h < 11 ? '早上好，今天写点什么？' : h < 13 ? '中午好，继续写吧。'
    : h < 18 ? '下午好，继续写吧。' : h < 23 ? '晚上好，继续写吧。' : '夜深了，写完这段就休息吧。'
  let lunar = ''
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' }).formatToParts(now)
    const m = parts.find(p => p.type === 'month')?.value, n = Number(parts.find(p => p.type === 'day')?.value)
    if (m && n) {
      const D = '一二三四五六七八九'
      lunar = ' · 农历' + m + (n === 10 ? '初十' : n === 20 ? '二十' : n === 30 ? '三十' : ['初', '十', '廿'][Math.floor(n / 10)] + D[n % 10 - 1])
    }
  } catch { /* 运行环境不支持农历时只显示公历 */ }
  const date = `${now.getMonth() + 1}月${now.getDate()}日 · 星期${'日一二三四五六'[now.getDay()]}${lunar}`
  const period: 'dawn' | 'noon' | 'dusk' | 'night' = h < 5 ? 'night' : h < 9 ? 'dawn' : h < 17 ? 'noon' : h < 19 ? 'dusk' : 'night'
  return { date, hello, period }
}
