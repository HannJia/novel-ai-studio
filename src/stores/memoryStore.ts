import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChapterSummary, StoryEvent, Foreshadow, CharacterStateChange } from '@/types/memory'
import * as memoryApi from '@/services/api/memoryApi'

export const useMemoryStore = defineStore('memory', () => {
  // ========== 状态 ==========
  const summaries = ref<ChapterSummary[]>([])
  const events = ref<StoryEvent[]>([])
  const foreshadows = ref<Foreshadow[]>([])
  const stateChanges = ref<CharacterStateChange[]>([])

  const loading = ref(false)
  const error = ref<string | null>(null)

  // 当前选中的书籍ID
  const currentBookId = ref<string | null>(null)

  // ========== 计算属性 ==========

  // 未回收的伏笔
  const unresolvedForeshadows = computed(() =>
    foreshadows.value.filter(f => f.status === 'planted' || f.status === 'partial')
  )

  // 重要的未回收伏笔
  const majorUnresolvedForeshadows = computed(() =>
    unresolvedForeshadows.value.filter(f => f.importance === 'major')
  )

  // 主要事件
  const majorEvents = computed(() =>
    events.value.filter(e => e.eventType === 'major')
  )

  // 伏笔统计
  const foreshadowStats = computed(() => {
    const stats = {
      planted: 0,
      partial: 0,
      resolved: 0,
      abandoned: 0,
      total: foreshadows.value.length
    }
    foreshadows.value.forEach(f => {
      if (stats[f.status as keyof typeof stats] !== undefined) {
        stats[f.status as keyof typeof stats]++
      }
    })
    return stats
  })

  // ========== 章节摘要方法 ==========

  /**
   * 加载书籍的所有章节摘要
   */
  async function loadBookSummaries(bookId: string) {
    loading.value = true
    error.value = null
    try {
      const res = await memoryApi.getBookSummaries(bookId)
      summaries.value = res.data || []
      currentBookId.value = bookId
    } catch (e: any) {
      error.value = e.message || '加载摘要失败'
      console.error('加载摘要失败:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取章节摘要
   */
  async function getChapterSummary(chapterId: string): Promise<ChapterSummary | null> {
    try {
      const res = await memoryApi.getChapterSummary(chapterId)
      return res.data
    } catch (e) {
      console.error('获取章节摘要失败:', e)
      return null
    }
  }

  /**
   * AI生成章节摘要
   */
  async function generateSummary(chapterId: string): Promise<ChapterSummary | null> {
    loading.value = true
    try {
      const res = await memoryApi.generateChapterSummary(chapterId)
      const summary = res.data
      if (summary) {
        // 更新本地缓存
        const index = summaries.value.findIndex(s => s.chapterId === chapterId)
        if (index >= 0) {
          summaries.value[index] = summary
        } else {
          summaries.value.push(summary)
        }
      }
      return summary
    } catch (e: any) {
      error.value = e.message || '生成摘要失败'
      console.error('生成摘要失败:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 保存摘要
   */
  async function saveSummary(summary: Partial<ChapterSummary>): Promise<ChapterSummary | null> {
    try {
      const res = await memoryApi.saveSummary(summary)
      const saved = res.data
      if (saved) {
        const index = summaries.value.findIndex(s => s.chapterId === saved.chapterId)
        if (index >= 0) {
          summaries.value[index] = saved
        } else {
          summaries.value.push(saved)
        }
      }
      return saved
    } catch (e) {
      console.error('保存摘要失败:', e)
      return null
    }
  }

  // ========== 故事事件方法 ==========

  /**
   * 加载书籍的所有事件
   */
  async function loadBookEvents(bookId: string) {
    loading.value = true
    error.value = null
    try {
      const res = await memoryApi.getBookEvents(bookId)
      events.value = res.data || []
      currentBookId.value = bookId
    } catch (e: any) {
      error.value = e.message || '加载事件失败'
      console.error('加载事件失败:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * AI提取章节事件
   */
  async function extractEvents(chapterId: string): Promise<StoryEvent[]> {
    loading.value = true
    try {
      const res = await memoryApi.extractChapterEvents(chapterId)
      const extracted = res.data || []
      // 添加到本地缓存
      events.value.push(...extracted)
      return extracted
    } catch (e: any) {
      error.value = e.message || '提取事件失败'
      console.error('提取事件失败:', e)
      return []
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建事件
   */
  async function createEvent(event: Partial<StoryEvent>): Promise<StoryEvent | null> {
    try {
      const res = await memoryApi.createEvent(event)
      const created = res.data
      if (created) {
        events.value.push(created)
      }
      return created
    } catch (e) {
      console.error('创建事件失败:', e)
      return null
    }
  }

  /**
   * 更新事件
   */
  async function updateEvent(id: string, event: Partial<StoryEvent>): Promise<StoryEvent | null> {
    try {
      const res = await memoryApi.updateEvent(id, event)
      const updated = res.data
      if (updated) {
        const index = events.value.findIndex(e => e.id === id)
        if (index >= 0) {
          events.value[index] = updated
        }
      }
      return updated
    } catch (e) {
      console.error('更新事件失败:', e)
      return null
    }
  }

  /**
   * 删除事件
   */
  async function deleteEvent(id: string): Promise<boolean> {
    try {
      await memoryApi.deleteEvent(id)
      events.value = events.value.filter(e => e.id !== id)
      return true
    } catch (e) {
      console.error('删除事件失败:', e)
      return false
    }
  }

  // ========== 伏笔方法 ==========

  /**
   * 加载书籍的所有伏笔
   */
  async function loadBookForeshadows(bookId: string) {
    loading.value = true
    error.value = null
    try {
      const res = await memoryApi.getBookForeshadows(bookId)
      foreshadows.value = res.data || []
      currentBookId.value = bookId
    } catch (e: any) {
      error.value = e.message || '加载伏笔失败'
      console.error('加载伏笔失败:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 创建伏笔
   */
  async function createForeshadow(foreshadow: Partial<Foreshadow>): Promise<Foreshadow | null> {
    try {
      const res = await memoryApi.createForeshadow(foreshadow)
      const created = res.data
      if (created) {
        foreshadows.value.push(created)
      }
      return created
    } catch (e) {
      console.error('创建伏笔失败:', e)
      return null
    }
  }

  /**
   * 更新伏笔
   */
  async function updateForeshadow(id: string, foreshadow: Partial<Foreshadow>): Promise<Foreshadow | null> {
    try {
      const res = await memoryApi.updateForeshadow(id, foreshadow)
      const updated = res.data
      if (updated) {
        const index = foreshadows.value.findIndex(f => f.id === id)
        if (index >= 0) {
          foreshadows.value[index] = updated
        }
      }
      return updated
    } catch (e) {
      console.error('更新伏笔失败:', e)
      return null
    }
  }

  /**
   * 更新伏笔状态
   */
  async function updateForeshadowStatus(id: string, status: string, notes?: string): Promise<Foreshadow | null> {
    try {
      const res = await memoryApi.updateForeshadowStatus(id, status, notes)
      const updated = res.data
      if (updated) {
        const index = foreshadows.value.findIndex(f => f.id === id)
        if (index >= 0) {
          foreshadows.value[index] = updated
        }
      }
      return updated
    } catch (e) {
      console.error('更新伏笔状态失败:', e)
      return null
    }
  }

  /**
   * 标记伏笔为已回收
   */
  async function resolveForeshadow(id: string, notes?: string): Promise<Foreshadow | null> {
    try {
      const res = await memoryApi.resolveForeshadow(id, notes)
      const updated = res.data
      if (updated) {
        const index = foreshadows.value.findIndex(f => f.id === id)
        if (index >= 0) {
          foreshadows.value[index] = updated
        }
      }
      return updated
    } catch (e) {
      console.error('回收伏笔失败:', e)
      return null
    }
  }

  /**
   * 删除伏笔
   */
  async function deleteForeshadow(id: string): Promise<boolean> {
    try {
      await memoryApi.deleteForeshadow(id)
      foreshadows.value = foreshadows.value.filter(f => f.id !== id)
      return true
    } catch (e) {
      console.error('删除伏笔失败:', e)
      return false
    }
  }

  /**
   * 获取需要提醒的伏笔
   */
  async function getForeshadowReminders(currentChapter: number): Promise<Foreshadow[]> {
    if (!currentBookId.value) return []
    try {
      const res = await memoryApi.getForeshadowReminders(currentBookId.value, currentChapter)
      return res.data || []
    } catch (e) {
      console.error('获取伏笔提醒失败:', e)
      return []
    }
  }

  // ========== 角色状态方法 ==========

  /**
   * 加载书籍的所有状态变更
   */
  async function loadBookStateChanges(bookId: string) {
    try {
      const res = await memoryApi.getBookStateChanges(bookId)
      stateChanges.value = res.data || []
    } catch (e) {
      console.error('加载状态变更失败:', e)
    }
  }

  /**
   * 记录状态变更
   */
  async function recordStateChange(change: Partial<CharacterStateChange>): Promise<CharacterStateChange | null> {
    try {
      const res = await memoryApi.recordStateChange(change)
      const created = res.data
      if (created) {
        stateChanges.value.push(created)
      }
      return created
    } catch (e) {
      console.error('记录状态变更失败:', e)
      return null
    }
  }

  // ========== 工具方法 ==========

  /**
   * 加载书籍的全部记忆数据
   */
  async function loadAllMemoryData(bookId: string) {
    currentBookId.value = bookId
    await Promise.all([
      loadBookSummaries(bookId),
      loadBookEvents(bookId),
      loadBookForeshadows(bookId),
      loadBookStateChanges(bookId)
    ])
  }

  /**
   * 清空记忆数据
   */
  function clearMemoryData() {
    summaries.value = []
    events.value = []
    foreshadows.value = []
    stateChanges.value = []
    currentBookId.value = null
    error.value = null
  }

  return {
    // 状态
    summaries,
    events,
    foreshadows,
    stateChanges,
    loading,
    error,
    currentBookId,

    // 计算属性
    unresolvedForeshadows,
    majorUnresolvedForeshadows,
    majorEvents,
    foreshadowStats,

    // 摘要方法
    loadBookSummaries,
    getChapterSummary,
    generateSummary,
    saveSummary,

    // 事件方法
    loadBookEvents,
    extractEvents,
    createEvent,
    updateEvent,
    deleteEvent,

    // 伏笔方法
    loadBookForeshadows,
    createForeshadow,
    updateForeshadow,
    updateForeshadowStatus,
    resolveForeshadow,
    deleteForeshadow,
    getForeshadowReminders,

    // 状态变更方法
    loadBookStateChanges,
    recordStateChange,

    // 工具方法
    loadAllMemoryData,
    clearMemoryData
  }
})
