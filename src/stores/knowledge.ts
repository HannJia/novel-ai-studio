// 知识库 Store — SQLite 持久化
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadAllKnowledgeBasesFromDb, saveKnowledgeBaseToDb, deleteKnowledgeBaseFromDb } from '@/services/db/knowledge'
import { createRevisionPersistence } from './revisionPersistence'
import { splitKnowledgeText } from '@/services/knowledgeText'
import { entrySourceVersion, baseSourceVersion, createEntrySummarySource, createBaseSummarySource } from '@/services/knowledgeSources'
import { selectKnowledgeEntries } from '@/services/knowledgeSelection'
import type { KBEntry, KnowledgeBase, KnowledgeSummarySource, KnowledgeSummaryHistory, KnowledgeSummaryCoverage } from '@/types/knowledge'
export type { KBEntry, KnowledgeBase } from '@/types/knowledge'

// 知识库条目
type SummaryTarget = { summary?: string; summarySource?: KnowledgeSummarySource; summaryLevel?: KnowledgeBase['summaryLevel']; summaryHistory?: KnowledgeSummaryHistory[] }

/** A summary editor cannot overwrite a newer confirmation of the same source. */
export function knowledgeSummaryEditVersion(target: SummaryTarget): string {
  return JSON.stringify([target.summary || '', target.summarySource, target.summaryLevel])
}

function retainSummary(target: SummaryTarget, now: string) {
  if (!target.summary && !target.summarySource) return
  target.summaryHistory = [...(target.summaryHistory || []), {
    id: 'summary:' + Date.now().toString(36) + Math.random().toString(36).slice(2),
    summary: target.summary || '', summarySource: target.summarySource, summaryLevel: target.summaryLevel, savedAt: now,
  }].slice(-20)
}

// 预设分类
export const kbCategories = [
  { value: '世界观', label: '🌍 世界观', icon: '🌍' },
  { value: '人物', label: '👤 人物', icon: '👤' },
  { value: '势力', label: '⚔️ 势力', icon: '⚔️' },
  { value: '功法', label: '📜 功法/技能', icon: '📜' },
  { value: '道具', label: '💎 道具/宝物', icon: '💎' },
  { value: '地点', label: '🏔️ 地点', icon: '🏔️' },
  { value: '事件', label: '📅 事件', icon: '📅' },
  { value: '数值属性', label: '🔢 数值/属性', icon: '🔢' },
  { value: '其他', label: '📝 其他', icon: '📝' },
]

export const useKnowledgeStore = defineStore('knowledge', () => {
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const isInitialized = ref(false)

  const persistence = createRevisionPersistence(knowledgeBases, isInitialized, saveKnowledgeBaseToDb)
  const { saveError, saving, hasPendingSaves } = persistence
  const flushPendingSaves = persistence.flush

  // 异步初始化数据库
  async function initStore() {
    if (isInitialized.value) return
    const loaded = await loadAllKnowledgeBasesFromDb()
    knowledgeBases.value = loaded
    persistence.adopt()
    isInitialized.value = true
  }

  function adoptImportedKnowledgeBases(imported: KnowledgeBase[]) {
    knowledgeBases.value = JSON.parse(JSON.stringify(imported))
    persistence.adopt()
  }

  // 创建知识库
  function createKB(name: string, description = ''): KnowledgeBase {
    const kb: KnowledgeBase = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      name,
      description,
      entries: [],
      summary: '',
      summaryLevel: 'standard',
      summaryUpdatedAt: '',
      createdAt: new Date().toISOString(),
    }
    knowledgeBases.value.push(kb)
    persistence.markDirty(kb.id)
    return kb
  }

  async function saveEntrySummary(kbId: string, entryId: string, expectedSourceVersion: string, expectedSummaryVersion: string,
    summary: string, origin: KnowledgeSummarySource['origin'] = 'author', coverage?: KnowledgeSummaryCoverage): Promise<void> {
    await persistence.transact(kbId, async draft => {
      const entry = draft.entries.find(item => item.id === entryId)
      if (!entry) throw new Error('资料条目已不存在')
      if (entrySourceVersion(kbId, entry) !== expectedSourceVersion || knowledgeSummaryEditVersion(entry) !== expectedSummaryVersion) {
        throw new Error('资料或摘要在操作期间发生变化，请重新核对')
      }
      const now = new Date().toISOString()
      const binding = createEntrySummarySource(kbId, entry, summary, origin, now, coverage)
      retainSummary(entry, now)
      entry.summary = summary
      entry.summarySource = binding
      entry.updatedAt = now
      return { value: undefined, persist: () => saveKnowledgeBaseToDb(draft) }
    })
  }

  async function saveBaseSummary(kbId: string, expectedSourceVersion: string, expectedSummaryVersion: string, summary: string,
    level: NonNullable<KnowledgeBase['summaryLevel']> = 'standard', origin: KnowledgeSummarySource['origin'] = 'author', coverage?: KnowledgeSummaryCoverage): Promise<void> {
    await persistence.transact(kbId, async draft => {
      if (baseSourceVersion(draft) !== expectedSourceVersion || knowledgeSummaryEditVersion(draft) !== expectedSummaryVersion) {
        throw new Error('知识库或摘要在操作期间发生变化，请重新核对')
      }
      const now = new Date().toISOString()
      const binding = createBaseSummarySource(draft, summary, origin, now, coverage)
      retainSummary(draft, now)
      draft.summary = summary
      draft.summarySource = binding
      draft.summaryLevel = level
      draft.summaryUpdatedAt = now
      return { value: undefined, persist: () => saveKnowledgeBaseToDb(draft) }
    })
  }

  // 删除知识库
  async function deleteKB(id: string) {
    await flushPendingSaves()
    const { useInspirationSessionsStore } = await import('./inspirationSessions')
    const inspiration = useInspirationSessionsStore()
    await inspiration.initialize()
    await inspiration.flushPendingSaves()
    await deleteKnowledgeBaseFromDb(id)
    knowledgeBases.value = knowledgeBases.value.filter(kb => kb.id !== id)
    persistence.forget(id)
    inspiration.detachKnowledgeBase(id)
  }

  // 获取知识库
  function getKB(id: string) {
    return knowledgeBases.value.find(kb => kb.id === id)
  }

  // 添加条目
  function addEntry(kbId: string, entry: Omit<KBEntry, 'id' | 'createdAt' | 'updatedAt'>, summaryOrigin?: KnowledgeSummarySource['origin']): KBEntry | null {
    const kb = getKB(kbId)
    if (!kb) return null
    const newEntry: KBEntry = {
      ...entry,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    if (summaryOrigin && newEntry.summary.trim()) newEntry.summarySource = createEntrySummarySource(kbId, newEntry, newEntry.summary, summaryOrigin, newEntry.createdAt)
    kb.entries.unshift(newEntry)
    persistence.markDirty(kbId)
    return newEntry
  }

  // 更新条目
  function updateEntry(kbId: string, entryId: string, data: Partial<KBEntry>) {
    const kb = getKB(kbId)
    if (!kb) return
    const entry = kb.entries.find(e => e.id === entryId)
    if (entry) {
      Object.assign(entry, data, { updatedAt: new Date().toISOString() })
      persistence.markDirty(kbId)
    }
  }

  // 删除条目
  function deleteEntry(kbId: string, entryId: string) {
    const kb = getKB(kbId)
    if (!kb) return
    kb.entries = kb.entries.filter(e => e.id !== entryId)
    persistence.markDirty(kbId)
  }

  // 从文本批量导入
  function importFromText(kbId: string, text: string, category: string): number {
    const kb = getKB(kbId)
    if (!kb) return 0
    // 按 ## 或 --- 分割为条目
    const sections = splitKnowledgeText(text)
    let count = 0
    for (const { title, content } of sections) {
        addEntry(kbId, { title, content, category, tags: [], summary: '' })
        count++
    }
    return count
  }

  // 获取与关键词相关的知识条目（供 AI Prompt 注入）
  function getRelevantEntries(kbIds: string[], keywords: string[], maxEntries = 5): KBEntry[] {
    return selectKnowledgeEntries(knowledgeBases.value, kbIds, keywords, maxEntries)
  }

  return {
    knowledgeBases,
    isInitialized,
    initStore,
    flushPendingSaves,
    adoptImportedKnowledgeBases,
    saveError, saving, hasPendingSaves,
    createKB, deleteKB, getKB,
    saveEntrySummary, saveBaseSummary,
    addEntry, updateEntry, deleteEntry,
    importFromText, getRelevantEntries,
  }
})
