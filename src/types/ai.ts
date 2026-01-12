/**
 * AI提供商
 */
export type AIProvider =
  | 'openai'
  | 'claude'
  | 'qianwen'      // 通义千问
  | 'wenxin'       // 文心一言
  | 'zhipu'        // 智谱
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
