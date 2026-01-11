import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AIConfig, AIProvider, TokenUsageRecord } from '@/types'

export const useAiStore = defineStore('ai', () => {
  // 状态
  const configs = ref<AIConfig[]>([])
  const currentConfig = ref<AIConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const usageRecords = ref<TokenUsageRecord[]>([])

  // 计算属性
  const defaultConfig = computed(() =>
    configs.value.find(c => c.isDefault) || null
  )

  const configsByProvider = computed(() => {
    const grouped: Record<AIProvider, AIConfig[]> = {
      openai: [],
      claude: [],
      qianwen: [],
      wenxin: [],
      zhipu: [],
      ollama: [],
      custom: []
    }
    configs.value.forEach(config => {
      grouped[config.provider].push(config)
    })
    return grouped
  })

  const totalTokensUsed = computed(() =>
    usageRecords.value.reduce((sum, r) => sum + r.totalTokens, 0)
  )

  const totalCost = computed(() =>
    usageRecords.value.reduce((sum, r) => sum + r.estimatedCost, 0)
  )

  // 方法
  async function fetchConfigs(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // TODO: 调用后端API
      // const response = await aiService.getConfigs()
      // configs.value = response.data
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取AI配置失败'
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(config: Omit<AIConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<AIConfig | null> {
    loading.value = true
    error.value = null
    try {
      // TODO: 调用后端API
      // const response = await aiService.saveConfig(config)
      // configs.value.push(response.data)
      // return response.data
      return null
    } catch (e) {
      error.value = e instanceof Error ? e.message : '保存AI配置失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateConfig(id: string, config: Partial<AIConfig>): Promise<AIConfig | null> {
    loading.value = true
    error.value = null
    try {
      // TODO: 调用后端API
      return null
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新AI配置失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteConfig(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      // TODO: 调用后端API
      // await aiService.deleteConfig(id)
      // configs.value = configs.value.filter(c => c.id !== id)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除AI配置失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function testConnection(config: AIConfig): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      // TODO: 调用后端API测试连接
      return false
    } catch (e) {
      error.value = e instanceof Error ? e.message : '测试连接失败'
      return false
    } finally {
      loading.value = false
    }
  }

  function setCurrentConfig(config: AIConfig | null): void {
    currentConfig.value = config
  }

  function setDefaultConfig(id: string): void {
    configs.value.forEach(c => {
      c.isDefault = c.id === id
    })
  }

  function addUsageRecord(record: TokenUsageRecord): void {
    usageRecords.value.push(record)
  }

  return {
    // 状态
    configs,
    currentConfig,
    loading,
    error,
    usageRecords,
    // 计算属性
    defaultConfig,
    configsByProvider,
    totalTokensUsed,
    totalCost,
    // 方法
    fetchConfigs,
    saveConfig,
    updateConfig,
    deleteConfig,
    testConnection,
    setCurrentConfig,
    setDefaultConfig,
    addUsageRecord
  }
})
