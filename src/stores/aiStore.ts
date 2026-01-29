import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AIConfig, AIProvider, TokenUsageRecord, GenerateResult, AISceneType, AISceneConfig, GenerateParamsConfig } from '@/types'
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
  // 生成步骤定义
  interface GenerationStep {
    id: string
    name: string
    description: string
    status: 'pending' | 'running' | 'completed'
  }
  // 生成进度（用于分步生成章节）
  const generatingProgress = ref({
    current: 0,      // 当前步骤索引 (0-4)
    total: 5,        // 总步骤数
    stage: '',       // 当前阶段名称
    steps: [
      { id: 'context', name: '加载上下文', description: '', status: 'pending' as const },
      { id: 'character', name: '角色分析', description: '', status: 'pending' as const },
      { id: 'scene', name: '场景理解', description: '', status: 'pending' as const },
      { id: 'logic', name: '逻辑检查', description: '', status: 'pending' as const },
      { id: 'generate', name: '内容生成', description: '', status: 'pending' as const }
    ] as GenerationStep[]
  })
  // 推理/思考过程（GLM-4.7等推理模型返回）
  const currentReasoning = ref<string | null>(null)
  // 嵌入式思考面板是否可见（用于控制浮窗是否显示）
  const embeddedPanelVisible = ref(false)

  // 场景化AI模型配置
  const sceneConfig = ref<AISceneConfig>({
    useUnified: true,
    unifiedConfigId: undefined,
    sceneConfigs: {}
  })

  // 生成参数配置
  const generateParams = ref<GenerateParamsConfig>({
    chapterWordRange: [2000, 4000],
    continueWordRange: [300, 800],
    temperature: 0.7
  })

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
      gemini: [],
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

  // 推理模型列表（这些模型会在内部消耗大量 token 进行思考，不应设置严格的 maxTokens 限制）
  const REASONING_MODELS = [
    'gemini-3-pro-preview',
    'gemini-3-pro',
    'gemini-2.5-pro',
    'deepseek-r1',
    'deepseek-reasoner',
    'o1-preview',
    'o1-mini',
    'o1',
    'o3-mini',
    'glm-4.7',
    'qwq'
  ]

  // 检测指定模型是否为推理模型
  function checkIsReasoningModel(modelName?: string): boolean {
    const model = (modelName || currentConfig.value?.model || '').toLowerCase()
    return REASONING_MODELS.some(rm => model.includes(rm.toLowerCase()))
  }

  // 检测当前配置是否为推理模型
  const isReasoningModel = computed(() => checkIsReasoningModel())

  // 默认 Gemini 3 Pro 配置
  const DEFAULT_GEMINI3_CONFIG: aiApi.CreateAIConfigInput = {
    name: 'Gemini 3 Pro 创作',
    provider: 'custom',
    apiKey: 'sk-iF6IIsU0Yml1qpWQJeSu2dK5JuccSlolrmCJrUQebDI3YhED',
    baseUrl: 'https://api.code-relay.com/v1',
    model: 'gemini-3-pro-preview',
    temperature: 1.0,
    topP: 1.0,
    isDefault: true
  }

  // 方法
  async function fetchConfigs(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      configs.value = await aiApi.getAIConfigs()

      // 检查是否已存在 Gemini 3 Pro 配置，如果不存在则创建并设为默认
      const hasGemini3Pro = configs.value.some(c => c.name === 'Gemini 3 Pro 创作')
      if (!hasGemini3Pro) {
        console.log('未发现AI配置，正在创建默认 Gemini 3 Pro 配置...')
        const newConfig = await aiApi.createAIConfig(DEFAULT_GEMINI3_CONFIG)
        configs.value.push(newConfig)
        console.log('默认 Gemini 3 Pro 配置已创建')
      }

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
    currentReasoning.value = null
    try {
      const result = await aiApi.generate(request)
      generatedContent.value = result.content
      // 保存推理过程（如果有）
      if (result.reasoning) {
        currentReasoning.value = result.reasoning
      }
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
    currentReasoning.value = null
    try {
      const result = await aiApi.continueWriting(request)
      generatedContent.value = result.content
      // 续写正文时不需要显示推理过程，直接输出正文
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
    currentReasoning.value = null
    try {
      const result = await aiApi.generateOutline(request)
      generatedContent.value = result.content
      if (result.reasoning) {
        currentReasoning.value = result.reasoning
      }
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
    currentReasoning.value = null
    try {
      const result = await aiApi.chat(request)
      if (result.reasoning) {
        currentReasoning.value = result.reasoning
      }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : '对话失败'
      return null
    } finally {
      generating.value = false
    }
  }

  // 清除推理内容
  function clearReasoning(): void {
    currentReasoning.value = null
  }

  // 根据场景获取配置
  function getConfigForScene(scene: AISceneType): AIConfig | null {
    if (sceneConfig.value.useUnified) {
      // 统一模式：优先使用默认配置
      return defaultConfig.value
    }
    // 分场景模式
    const configId = sceneConfig.value.sceneConfigs[scene]
    if (configId) {
      return configs.value.find(c => c.id === configId) || getCreativeConfig()
    }
    // 未配置的场景使用创作模型
    return getCreativeConfig()
  }

  // 获取创作模型配置（分场景模式下的默认/全局模型）
  function getCreativeConfig(): AIConfig | null {
    const creativeId = sceneConfig.value.sceneConfigs['creative']
    if (creativeId) {
      return configs.value.find(c => c.id === creativeId) || defaultConfig.value
    }
    return defaultConfig.value
  }

  // 获取全局模型（非创作场景用的通用模型，使用创作模型）
  function getGlobalConfig(): AIConfig | null {
    if (sceneConfig.value.useUnified) {
      return defaultConfig.value
    }
    // 分场景模式下，全局模型使用创作模型
    return getCreativeConfig()
  }

  // 保存场景配置到本地存储
  function saveSceneConfig(): void {
    localStorage.setItem('ai-scene-config', JSON.stringify(sceneConfig.value))
    localStorage.setItem('ai-generate-params', JSON.stringify(generateParams.value))
  }

  // 加载场景配置
  function loadSceneConfig(): void {
    const savedSceneConfig = localStorage.getItem('ai-scene-config')
    const savedGenerateParams = localStorage.getItem('ai-generate-params')
    if (savedSceneConfig) {
      try {
        sceneConfig.value = JSON.parse(savedSceneConfig)
      } catch (e) {
        console.error('加载场景配置失败:', e)
      }
    }
    if (savedGenerateParams) {
      try {
        generateParams.value = JSON.parse(savedGenerateParams)
      } catch (e) {
        console.error('加载生成参数失败:', e)
      }
    }
  }

  // 更新场景配置
  function updateSceneConfig(config: Partial<AISceneConfig>): void {
    sceneConfig.value = { ...sceneConfig.value, ...config }
    saveSceneConfig()
  }

  // 更新生成参数
  function updateGenerateParams(params: Partial<GenerateParamsConfig>): void {
    generateParams.value = { ...generateParams.value, ...params }
    saveSceneConfig()
  }

  // 更新生成步骤状态
  function updateStep(stepId: string, status: 'pending' | 'running' | 'completed', description?: string): void {
    const step = generatingProgress.value.steps.find(s => s.id === stepId)
    if (step) {
      step.status = status
      if (description !== undefined) {
        step.description = description
      }
      // 更新当前步骤索引
      const completedCount = generatingProgress.value.steps.filter(s => s.status === 'completed').length
      generatingProgress.value.current = completedCount
      // 更新当前阶段名称
      const runningStep = generatingProgress.value.steps.find(s => s.status === 'running')
      generatingProgress.value.stage = runningStep?.name || ''
    }
  }

  // 更新生成进度（兼容旧方法）
  function updateProgress(current: number, stage: string): void {
    generatingProgress.value.current = current
    generatingProgress.value.stage = stage
  }

  // 重置生成进度
  function resetProgress(): void {
    generatingProgress.value.current = 0
    generatingProgress.value.stage = ''
    generatingProgress.value.steps.forEach(step => {
      step.status = 'pending'
      step.description = ''
    })
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
    generatingProgress,
    currentReasoning,
    embeddedPanelVisible,
    sceneConfig,
    generateParams,
    // 计算属性
    defaultConfig,
    configsByProvider,
    totalTokensUsed,
    totalCost,
    hasConfig,
    isReasoningModel,
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
    checkIsReasoningModel,
    // AI生成方法
    generate,
    continueWriting,
    generateOutline,
    chat,
    clearReasoning,
    updateStep,
    updateProgress,
    resetProgress,
    // 场景配置方法
    getConfigForScene,
    getCreativeConfig,
    getGlobalConfig,
    saveSceneConfig,
    loadSceneConfig,
    updateSceneConfig,
    updateGenerateParams
  }
})
