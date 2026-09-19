// 知识库 Store — SQLite 持久化
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadAllKnowledgeBasesFromDb, saveKnowledgeBaseToDb, deleteKnowledgeBaseFromDb } from '@/services/db/knowledge'
import { createRevisionPersistence } from './revisionPersistence'
import { splitKnowledgeText } from '@/services/knowledgeText'

// 知识库条目
export interface KBEntry {
  id: string
  category: string    // 分类：世界观/人物/势力/功法/道具/其他
  title: string       // 标题
  content: string     // 内容（Markdown）— 原始完整内容
  summary: string     // AI 总结（写作时注入此字段，审查时才用完整 content）
  tags: string[]      // 标签
  createdAt: string
  updatedAt: string
}

// 知识库
export interface KnowledgeBase {
  id: string
  name: string
  description: string
  entries: KBEntry[]
  summary?: string
  summaryLevel?: 'brief' | 'standard' | 'detailed'
  summaryUpdatedAt?: string
  createdAt: string
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

  function updateSummary(id: string, summary: string, level: KnowledgeBase['summaryLevel'] = 'standard') {
    const kb = getKB(id)
    if (!kb) return
    kb.summary = summary
    kb.summaryLevel = level
    kb.summaryUpdatedAt = new Date().toISOString()
    persistence.markDirty(id)
  }

  // 删除知识库
  async function deleteKB(id: string) {
    await flushPendingSaves()
    await deleteKnowledgeBaseFromDb(id)
    knowledgeBases.value = knowledgeBases.value.filter(kb => kb.id !== id)
    persistence.forget(id)
  }

  // 获取知识库
  function getKB(id: string) {
    return knowledgeBases.value.find(kb => kb.id === id)
  }

  // 添加条目
  function addEntry(kbId: string, entry: Omit<KBEntry, 'id' | 'createdAt' | 'updatedAt'>): KBEntry | null {
    const kb = getKB(kbId)
    if (!kb) return null
    const newEntry: KBEntry = {
      ...entry,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    kb.entries.unshift(newEntry)
    kb.summary = ''
    kb.summaryUpdatedAt = ''
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
      kb.summary = ''
      kb.summaryUpdatedAt = ''
      persistence.markDirty(kbId)
    }
  }

  // 删除条目
  function deleteEntry(kbId: string, entryId: string) {
    const kb = getKB(kbId)
    if (!kb) return
    kb.entries = kb.entries.filter(e => e.id !== entryId)
    kb.summary = ''
    kb.summaryUpdatedAt = ''
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
    const all: KBEntry[] = []
    for (const kbId of kbIds) {
      const kb = getKB(kbId)
      if (kb) all.push(...kb.entries)
    }
    if (!keywords.length) return all.slice(0, maxEntries)
    // 关键词匹配评分
    const scored = all.map(entry => {
      let score = 0
      for (const kw of keywords) {
        const kwl = kw.toLowerCase()
        if (entry.title.toLowerCase().includes(kwl)) score += 3
        if (entry.content.toLowerCase().includes(kwl)) score += 1
        if (entry.summary.toLowerCase().includes(kwl)) score += 2
        if (entry.tags.some(t => t.toLowerCase().includes(kwl))) score += 2
      }
      return { entry, score }
    }).sort((a, b) => b.score - a.score)
    const matched = scored.filter(s => s.score > 0).slice(0, maxEntries).map(s => s.entry)
    return matched.length > 0 ? matched : all.slice(0, Math.min(maxEntries, 3))
  }

  return {
    knowledgeBases,
    isInitialized,
    initStore,
    flushPendingSaves,
    adoptImportedKnowledgeBases,
    saveError, saving, hasPendingSaves,
    createKB, deleteKB, getKB,
    updateSummary,
    addEntry, updateEntry, deleteEntry,
    importFromText, getRelevantEntries,
  }
})
