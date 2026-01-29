/**
 * AI提供商
 */
export type AIProvider =
  | 'openai'
  | 'claude'
  | 'qianwen'      // 通义千问
  | 'wenxin'       // 文心一言
  | 'zhipu'        // 智谱
  | 'gemini'       // Google Gemini
  | 'ollama'       // 本地Ollama
  | 'custom'       // 自定义API

/**
 * AI配置
 */
export interface AIConfig {
  id: string
  name: string                // 配置名称（如：GPT-4创作）
  provider: AIProvider
  apiKey: string              // 加密存储
  baseUrl?: string            // API地址（支持代理）
  model: string               // 模型名称
  maxTokens: number
  temperature: number
  topP: number
  isDefault: boolean
  usageTask: AIUsageTask[]    // 用于哪些任务
  createdAt: string
  updatedAt: string
}

/**
 * AI使用任务类型
 */
export type AIUsageTask =
  | 'generate'      // 内容生成
  | 'review'        // 逻辑审查
  | 'summary'       // 摘要生成
  | 'chat'          // 对话
  | 'all'           // 全部

/**
 * AI场景类型（用于场景化模型配置）
 */
export type AISceneType =
  | 'creative'      // 创作：续写、扩写、生成章节、生成细纲
  | 'review'        // 审查：润色、改写、逻辑检查、连贯性审查
  | 'vision'        // 识图：知识库图片识别、封面分析
  | 'analysis'      // 分析：大纲分析、角色分析、情节梳理

/**
 * AI场景配置接口
 */
export interface AISceneConfig {
  useUnified: boolean           // 是否统一使用同一模型
  unifiedConfigId?: string      // 统一配置ID
  sceneConfigs: {
    creative?: string           // 创作场景配置ID
    review?: string             // 审查场景配置ID
    vision?: string             // 识图场景配置ID
    analysis?: string           // 分析场景配置ID
  }
}

/**
 * 生成参数配置
 */
export interface GenerateParamsConfig {
  chapterWordRange: [number, number]  // 章节字数范围 [min, max]
  continueWordRange: [number, number] // 续写字数范围 [min, max]
  temperature: number                  // 创意温度 0-1
}

/**
 * AI生成选项
 */
export interface GenerateOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}

/**
 * AI生成结果
 */
export interface GenerateResult {
  content: string
  reasoning?: string            // 推理/思考过程（GLM-4.7等推理模型返回）
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason: 'stop' | 'length' | 'error'
  model: string
  duration: number            // 耗时（毫秒）
  errorMessage?: string       // 错误信息
}

/**
 * AI适配器接口
 */
export interface AIAdapter {
  name: string
  provider: AIProvider

  /**
   * 生成内容
   */
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>

  /**
   * 流式生成
   */
  generateStream(
    prompt: string,
    options?: GenerateOptions,
    onChunk?: (chunk: string) => void
  ): Promise<GenerateResult>

  /**
   * 测试连接
   */
  testConnection(): Promise<boolean>

  /**
   * 获取可用模型列表
   */
  listModels(): Promise<string[]>
}

/**
 * Token使用记录
 */
export interface TokenUsageRecord {
  id: string
  bookId?: string
  configId: string
  task: AIUsageTask
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCost: number       // 估算费用（元）
  timestamp: string
}

/**
 * AI提供商映射
 */
export const AI_PROVIDER_MAP: Record<AIProvider, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  qianwen: '通义千问',
  wenxin: '文心一言',
  zhipu: '智谱AI',
  gemini: 'Google Gemini',
  ollama: 'Ollama本地',
  custom: '自定义API'
}

/**
 * AI任务类型映射
 */
export const AI_USAGE_TASK_MAP: Record<AIUsageTask, string> = {
  generate: '内容生成',
  review: '逻辑审查',
  summary: '摘要生成',
  chat: '对话',
  all: '全部任务'
}

/**
 * AI场景类型映射
 */
export const AI_SCENE_TYPE_MAP: Record<AISceneType, { label: string; icon: string; description: string }> = {
  creative: {
    label: '创作模型',
    icon: '✍️',
    description: '用于：续写、扩写、生成章节、生成细纲'
  },
  review: {
    label: '审查模型',
    icon: '🔍',
    description: '用于：润色、改写、逻辑检查、连贯性审查'
  },
  vision: {
    label: '识图模型',
    icon: '🖼️',
    description: '用于：知识库图片识别、封面分析'
  },
  analysis: {
    label: '分析模型',
    icon: '📋',
    description: '用于：大纲分析、角色分析、情节梳理'
  }
}
