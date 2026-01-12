/**
 * AI配置API服务
 */
import { get, post, put, del } from './index'
import type { AIConfig, GenerateResult } from '@/types'

const CONFIG_BASE_URL = '/ai-configs'
const AI_BASE_URL = '/ai'

/**
 * 创建AI配置输入
 */
export interface CreateAIConfigInput {
  name: string
  provider: string
  apiKey: string
  baseUrl?: string
  model: string
  maxTokens?: number
  temperature?: number
  topP?: number
  isDefault?: boolean
  usageTasks?: string[]
}

/**
 * 更新AI配置输入
 */
export interface UpdateAIConfigInput {
  name?: string
  provider?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  isDefault?: boolean
  usageTasks?: string[]
}

/**
 * 生成请求参数
 */
export interface GenerateRequest {
  prompt: string
  configId?: string
  systemPrompt?: string
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}

/**
 * 对话消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 对话请求参数
 */
export interface ChatRequest {
  messages: ChatMessage[]
  configId?: string
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
}

/**
 * 续写请求参数
 */
export interface ContinueWritingRequest {
  content: string
  outline?: string
  configId?: string
  wordCount?: number
}

/**
 * 大纲生成请求参数
 */
export interface GenerateOutlineRequest {
  bookTitle: string
  genre?: string
  style?: string
  description?: string
  configId?: string
  type?: 'book' | 'volume' | 'chapter'
}

// ========== AI配置相关API ==========

/**
 * 获取所有AI配置列表
 */
export async function getAIConfigs(): Promise<AIConfig[]> {
  return get<AIConfig[]>(CONFIG_BASE_URL)
}

/**
 * 获取AI配置详情
 */
export async function getAIConfig(id: string): Promise<AIConfig> {
  return get<AIConfig>(`${CONFIG_BASE_URL}/${id}`)
}

/**
 * 获取默认AI配置
 */
export async function getDefaultAIConfig(): Promise<AIConfig> {
  return get<AIConfig>(`${CONFIG_BASE_URL}/default`)
}

/**
 * 创建AI配置
 */
export async function createAIConfig(input: CreateAIConfigInput): Promise<AIConfig> {
  return post<AIConfig>(CONFIG_BASE_URL, input)
}

/**
 * 更新AI配置
 */
export async function updateAIConfig(id: string, input: UpdateAIConfigInput): Promise<AIConfig> {
  return put<AIConfig>(`${CONFIG_BASE_URL}/${id}`, input)
}

/**
 * 删除AI配置
 */
export async function deleteAIConfig(id: string): Promise<void> {
  return del<void>(`${CONFIG_BASE_URL}/${id}`)
}

/**
 * 设置默认AI配置
 */
export async function setDefaultAIConfig(id: string): Promise<void> {
  return post<void>(`${CONFIG_BASE_URL}/${id}/set-default`)
}

/**
 * 测试AI配置连接
 */
export async function testAIConfigConnection(id: string): Promise<boolean> {
  return post<boolean>(`${CONFIG_BASE_URL}/${id}/test`)
}

/**
 * 获取可用模型列表
 */
export async function getAvailableModels(id: string): Promise<string[]> {
  return get<string[]>(`${CONFIG_BASE_URL}/${id}/models`)
}

// ========== AI生成相关API ==========

/**
 * 同步生成内容
 */
export async function generate(request: GenerateRequest): Promise<GenerateResult> {
  return post<GenerateResult>(`${AI_BASE_URL}/generate`, request)
}

/**
 * 流式生成内容（返回EventSource URL）
 */
export function generateStreamUrl(): string {
  return `/api${AI_BASE_URL}/generate/stream`
}

/**
 * 多轮对话
 */
export async function chat(request: ChatRequest): Promise<GenerateResult> {
  return post<GenerateResult>(`${AI_BASE_URL}/chat`, request)
}

/**
 * 流式对话（返回EventSource URL）
 */
export function chatStreamUrl(): string {
  return `/api${AI_BASE_URL}/chat/stream`
}

/**
 * 小说续写
 */
export async function continueWriting(request: ContinueWritingRequest): Promise<GenerateResult> {
  return post<GenerateResult>(`${AI_BASE_URL}/continue-writing`, request)
}

/**
 * 大纲生成
 */
export async function generateOutline(request: GenerateOutlineRequest): Promise<GenerateResult> {
  return post<GenerateResult>(`${AI_BASE_URL}/generate-outline`, request)
}
