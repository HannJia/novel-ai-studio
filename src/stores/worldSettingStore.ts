/**
 * 世界观设定状态管理
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { WorldSetting, WorldSettingCategory, WorldSettingStats } from '@/types'
import * as settingApi from '@/services/api/worldSettingApi'
import type { CreateWorldSettingInput, UpdateWorldSettingInput } from '@/types/worldSetting'

export const useWorldSettingStore = defineStore('worldSetting', () => {
  // 状态
  const settings = ref<WorldSetting[]>([])
  const currentSetting = ref<WorldSetting | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const stats = ref<WorldSettingStats | null>(null)
  const allTags = ref<string[]>([])

  // 按分类分组的设定
  const settingsByCategory = computed(() => {
    const grouped: Record<WorldSettingCategory, WorldSetting[]> = {
      power_system: [],
      item: [],
      location: [],
      organization: [],
      other: []
    }

    settings.value.forEach(s => {
      const category = s.category as WorldSettingCategory
      if (grouped[category]) {
        grouped[category].push(s)
      } else {
        grouped.other.push(s)
      }
    })

    return grouped
  })

  const settingCount = computed(() => settings.value.length)

  // 获取书籍的所有设定
  async function fetchSettings(bookId: string) {
    loading.value = true
    error.value = null
    try {
      settings.value = await settingApi.getSettingsByBook(bookId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取设定列表失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 按分类获取设定
  async function fetchSettingsByCategory(bookId: string, category: string) {
    loading.value = true
    error.value = null
    try {
      return await settingApi.getSettingsByCategory(bookId, category)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取设定列表失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取设定详情
  async function fetchSetting(id: string) {
    loading.value = true
    error.value = null
    try {
      currentSetting.value = await settingApi.getSetting(id)
      return currentSetting.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取设定详情失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 创建设定
  async function createSetting(input: CreateWorldSettingInput) {
    loading.value = true
    error.value = null
    try {
      const setting = await settingApi.createSetting(input)
      settings.value.push(setting)
      return setting
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建设定失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 更新设定
  async function updateSetting(id: string, input: UpdateWorldSettingInput) {
    loading.value = true
    error.value = null
    try {
      const setting = await settingApi.updateSetting(id, input)
      const index = settings.value.findIndex(s => s.id === id)
      if (index !== -1) {
        settings.value[index] = setting
      }
      if (currentSetting.value?.id === id) {
        currentSetting.value = setting
      }
      return setting
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新设定失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 删除设定
  async function deleteSetting(id: string) {
    loading.value = true
    error.value = null
    try {
      await settingApi.deleteSetting(id)
      settings.value = settings.value.filter(s => s.id !== id)
      if (currentSetting.value?.id === id) {
        currentSetting.value = null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除设定失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 搜索设定
  async function searchSettings(bookId: string, keyword: string) {
    loading.value = true
    error.value = null
    try {
      return await settingApi.searchSettings(bookId, keyword)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '搜索设定失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 添加标签
  async function addTag(id: string, tag: string) {
    loading.value = true
    error.value = null
    try {
      const setting = await settingApi.addSettingTag(id, tag)
      const index = settings.value.findIndex(s => s.id === id)
      if (index !== -1) {
        settings.value[index] = setting
      }
      return setting
    } catch (e) {
      error.value = e instanceof Error ? e.message : '添加标签失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 移除标签
  async function removeTag(id: string, tag: string) {
    loading.value = true
    error.value = null
    try {
      const setting = await settingApi.removeSettingTag(id, tag)
      const index = settings.value.findIndex(s => s.id === id)
      if (index !== -1) {
        settings.value[index] = setting
      }
      return setting
    } catch (e) {
      error.value = e instanceof Error ? e.message : '移除标签失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取统计
  async function fetchStats(bookId: string) {
    loading.value = true
    error.value = null
    try {
      stats.value = await settingApi.getSettingStats(bookId)
      return stats.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取统计失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 获取所有标签
  async function fetchAllTags(bookId: string) {
    loading.value = true
    error.value = null
    try {
      allTags.value = await settingApi.getAllTags(bookId)
      return allTags.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取标签失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  // 设置当前设定
  function setCurrentSetting(setting: WorldSetting | null) {
    currentSetting.value = setting
  }

  // 根据ID获取设定（从本地缓存）
  function getSettingById(id: string): WorldSetting | undefined {
    return settings.value.find(s => s.id === id)
  }

  // 清空状态
  function clearState() {
    settings.value = []
    currentSetting.value = null
    stats.value = null
    allTags.value = []
    error.value = null
  }

  return {
    // 状态
    settings,
    currentSetting,
    loading,
    error,
    stats,
    allTags,
    // 计算属性
    settingsByCategory,
    settingCount,
    // 方法
    fetchSettings,
    fetchSettingsByCategory,
    fetchSetting,
    createSetting,
    updateSetting,
    deleteSetting,
    searchSettings,
    addTag,
    removeTag,
    fetchStats,
    fetchAllTags,
    setCurrentSetting,
    getSettingById,
    clearState
  }
})
