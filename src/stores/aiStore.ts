import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AIConfig, AIProvider, TokenUsageRecord, GenerateResult } from '@/types'
import * as aiApi from '@/services/api/aiApi'

export const useAiStore = defineStore('ai', () => {
  // 状态
  const configs = ref<AIConfig[]>([])
  const currentConfig = ref<AIConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const usageRecords = ref<TokenUsageRecord[]>([])
  const generating = ref(false)
  const generatedContent = ref('')

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

  const hasConfig = computed(() => configs.value.length > 0)

  // 方法
  async function fetchConfigs(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      configs.value = await aiApi.getAIConfigs()
      // 设置当前配置为默认配置
      if (!currentConfig.value && defaultConfig.value) {
        currentConfig.value = defaultConfig.value
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '获取AI配置失败'
    } finally {
      loading.value = false
    }
  }

  async function createConfig(input: aiApi.CreateAIConfigInput): Promise<AIConfig | null> {
    loading.value = true
    error.value = null
    try {
      const config = await aiApi.createAIConfig(input)
      configs.value.push(config)
      // 如果是默认配置，更新其他配置
      if (config.isDefault) {
        configs.value.forEach(c => {
          if (c.id !== config.id) {
            c.isDefault = false
          }
        })
      }
      return config
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建AI配置失败'
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateConfig(id: string, input: aiApi.UpdateAIConfigInput): Promise<AIConfig | null> {
    loading.value = true
    error.value = null
    try {
      const config = await aiApi.updateAIConfig(id, input)
      const index = configs.value.findIndex(c => c.id === id)
      if (index >= 0) {
        configs.value[index] = config
      }
      // 如果设置为默认配置，更新其他配置
      if (config.isDefault) {
        configs.value.forEach(c => {
          if (c.id !== config.id) {
            c.isDefault = false
          }
        })
      }
      return config
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
      await aiApi.deleteAIConfig(id)
      configs.value = configs.value.filter(c => c.id !== id)
      if (currentConfig.value?.id === id) {
        currentConfig.value = defaultConfig.value
      }
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除AI配置失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function setDefault(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await aiApi.setDefaultAIConfig(id)
      configs.value.forEach(c => {
        c.isDefault = c.id === id
      })
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '设置默认配置失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function testConnection(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      return await aiApi.testAIConfigConnection(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '测试连接失败'
      return false
    } finally {
      loading.value = false
    }
  }

  async function getModels(id: string): Promise<string[]> {
    try {
      return await aiApi.getAvailableModels(id)
    } catch (e) {
      console.error('获取模型列表失败:', e)
      return []
    }
  }

  function setCurrentConfig(config: AIConfig | null): void {
    currentConfig.value = config
  }

  function addUsageRecord(record: TokenUsageRecord): void {
    usageRecords.value.push(record)
  }

  // AI生成相关方法
  async function generate(request: aiApi.GenerateRequest): Promise<GenerateResult | null> {
    generating.value = true
    error.value = null
    generatedContent.value = ''
    try {
      const result = await aiApi.generate(request)
      generatedContent.value = result.content
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '生成失败'
      return null
    } finally {
      generating.value = false
    }
  }

  async function continueWriting(request: aiApi.ContinueWritingRequest): Promise<GenerateResult | null> {
    generating.value = true
    error.value = null
    generatedContent.value = ''
    try {
      const result = await aiApi.continueWriting(request)
      generatedContent.value = result.content
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '续写失败'
      return null
    } finally {
      generating.value = false
    }
  }

  async function generateOutline(request: aiApi.GenerateOutlineRequest): Promise<GenerateResult | null> {
    generating.value = true
    error.value = null
    generatedContent.value = ''
    try {
      const result = await aiApi.generateOutline(request)
      generatedContent.value = result.content
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '生成大纲失败'
      return null
    } finally {
      generating.value = false
    }
  }

  async function chat(request: aiApi.ChatRequest): Promise<GenerateResult | null> {
    generating.value = true
    error.value = null
    try {
      const result = await aiApi.chat(request)
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '对话失败'
      return null
    } finally {
      generating.value = false
    }
  }

  return {
    // 状态
    configs,
    currentConfig,
    loading,
    error,
    usageRecords,
    generating,
    generatedContent,
    // 计算属性
    defaultConfig,
    configsByProvider,
    totalTokensUsed,
    totalCost,
    hasConfig,
    // 配置管理方法
    fetchConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
    setDefault,
    testConnection,
    getModels,
    setCurrentConfig,
    addUsageRecord,
    // AI生成方法
    generate,
    continueWriting,
    generateOutline,
    chat
  }
})
