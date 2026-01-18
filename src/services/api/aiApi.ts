/**
 * AI配置API服务
 */
import { get, post, put, del, aiPost } from './index'
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
  minWordCount?: number
  maxWordCount?: number
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
  return aiPost<GenerateResult>(`${AI_BASE_URL}/generate`, request)
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
  return aiPost<GenerateResult>(`${AI_BASE_URL}/chat`, request)
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
  return aiPost<GenerateResult>(`${AI_BASE_URL}/continue-writing`, request)
}

/**
 * 大纲生成
 */
export async function generateOutline(request: GenerateOutlineRequest): Promise<GenerateResult> {
  return aiPost<GenerateResult>(`${AI_BASE_URL}/generate-outline`, request)
}

// ========== AI小说初始化相关API ==========

import type { NovelInitInput, NovelInitResult, NovelRefineInput } from '@/types'

/**
 * AI初始化小说 - 生成简介、大纲、角色
 */
export async function initializeNovel(input: NovelInitInput): Promise<NovelInitResult> {
  return aiPost<NovelInitResult>(`${AI_BASE_URL}/initialize-novel`, input)
}

/**
 * AI修改小说设定
 */
export async function refineNovel(input: NovelRefineInput): Promise<NovelInitResult> {
  return aiPost<NovelInitResult>(`${AI_BASE_URL}/refine-novel`, input)
}

// ========== 章节标题生成 ==========

/**
 * 生成章节标题请求
 */
export interface GenerateChapterTitleRequest {
  chapterContent: string
  chapterNumber: number
  bookTitle?: string
  configId?: string
  isReasoningModel?: boolean  // 是否为推理模型
}

/**
 * 章节标题和总结结果
 */
export interface ChapterTitleAndSummaryResult {
  title: string
  summary: string
}

/**
 * 根据章节内容生成章节标题和总结
 * 一次调用同时生成标题和总结，节省 API 调用
 */
export async function generateChapterTitleAndSummary(request: GenerateChapterTitleRequest): Promise<ChapterTitleAndSummaryResult> {
  // 推理模型不传 maxTokens，避免思考过程耗尽 token
  const generateParams: Record<string, unknown> = {
    prompt: `请根据以下小说章节内容，完成两个任务：

【章节内容】
${request.chapterContent.slice(0, 3000)}${request.chapterContent.length > 3000 ? '...' : ''}

【任务1：生成标题】
为这一章起一个简短有吸引力的标题（2-6个字）。
- 标题要概括章节核心内容或关键事件
- 标题要有吸引力，引发读者好奇
- 不要包含"第X章"等前缀

【任务2：生成总结】
用100-200字总结本章的主要剧情和关键事件。
- 包含主要人物的行动和遭遇
- 概括核心情节发展
- 简洁明了，便于回顾

请严格按以下JSON格式返回，不要有其他内容：
{
  "title": "标题文字",
  "summary": "章节总结内容..."
}`,
    systemPrompt: '你是一位专业的小说编辑。请严格按JSON格式返回结果，不要有任何其他解释或内容。',
    temperature: 0.7,
    configId: request.configId
  }

  // 推理模型需要给足够的 maxTokens 上限
  generateParams.maxTokens = request.isReasoningModel ? 32000 : 500

  const result = await aiPost<GenerateResult>(`${AI_BASE_URL}/generate`, generateParams)

  console.log('生成章节标题和总结响应:', result)

  // 检查返回内容是否为空
  if (!result?.content) {
    console.warn('章节标题和总结生成返回空内容，finishReason:', result?.finishReason)
    return { title: '新章节', summary: '' }
  }

  // 解析 JSON 结果
  try {
    const content = result.content.trim()
    // 提取 JSON 部分（处理可能的 markdown 代码块）
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      let title = (parsed.title || '新章节').trim()
      // 清理标题
      title = title.replace(/^["'《】【「『]|["'》】】」』]$/g, '')
      title = title.replace(/^第.{1,3}章[：:\s]*/g, '')

      return {
        title: title || '新章节',
        summary: (parsed.summary || '').trim()
      }
    }
  } catch (e) {
    console.error('解析章节标题和总结JSON失败:', e)
  }

  // 解析失败时的降级处理
  return { title: '新章节', summary: '' }
}

/**
 * 根据章节内容生成章节标题（兼容旧接口）
 * @deprecated 推荐使用 generateChapterTitleAndSummary
 */
export async function generateChapterTitle(request: GenerateChapterTitleRequest): Promise<string> {
  const result = await generateChapterTitleAndSummary(request)
  return result.title
}

// ========== 分卷大纲生成 ==========

/**
 * 生成分卷大纲请求
 */
export interface GenerateVolumeOutlineRequest {
  bookTitle: string
  totalOutline: string
  targetTotalWords: number
  genre: string
  style: string
  configId?: string
}

/**
 * 分卷大纲结构
 */
export interface VolumeOutlineResult {
  id: string
  title: string           // 如：第一卷 起源
  summary: string         // 分卷简介
  plotLine: string        // 核心剧情线索
  wordTarget: number      // 目标字数
  startChapter: number    // 起始章节
  endChapter: number      // 结束章节
  chapterCount: number    // 章节数量
  chapters: {
    title: string         // 章节标题
    brief: string         // 章节概要
  }[]
}

/**
 * 根据总大纲生成分卷大纲
 * 按剧情划分，章节数根据剧情复杂度动态分配
 */
export async function generateVolumeOutline(request: GenerateVolumeOutlineRequest): Promise<VolumeOutlineResult[]> {
  // 计算总章节数（假设每章3000字）
  const chapterWordCount = 3000
  const totalChapters = Math.ceil(request.targetTotalWords / chapterWordCount)

  // 分卷章节范围：60-150章，允许更大的弹性
  const minChaptersPerVolume = 60
  const maxChaptersPerVolume = 150
  const avgChaptersPerVolume = 100

  // 计算推荐分卷数
  const volumeCount = Math.max(1, Math.ceil(totalChapters / avgChaptersPerVolume))

  const result = await aiPost<GenerateResult>(`${AI_BASE_URL}/generate`, {
    prompt: `请根据以下小说信息，按剧情发展阶段划分生成分卷大纲。

【小说信息】
书名：${request.bookTitle}
类型：${request.genre}
风格：${request.style}
目标总字数：${request.targetTotalWords}字
总章节数：约${totalChapters}章
推荐分卷数：${volumeCount}卷

【总大纲】
${request.totalOutline}

【重要：智能分卷规则】
1. 章节数量必须根据剧情复杂度动态分配，不要机械平均分配！
   - 铺垫期、过渡卷可以较短（${minChaptersPerVolume}-80章）
   - 高潮卷、转折卷可以较长（100-${maxChaptersPerVolume}章）
   - 根据剧情内容决定每卷长度

2. 分卷依据（必须遵循）：
   - 按故事的"起承转合"自然划分
   - 每卷应有独立的小目标和冲突
   - 分卷点选在：重大转折、阶段胜利、环境变化、势力更迭等节点
   - 避免在剧情紧张处断卷

3. 每卷字数计算：章节数 × 3000字

【分析大纲后的分卷思路】
请先分析总大纲，识别出：
- 故事的几个主要阶段
- 关键转折点在哪里
- 每个阶段的剧情密度如何
然后基于分析结果进行分卷。

【输出格式】
为每卷生成：
1. 分卷标题：「第X卷 卷名」，卷名2-4字概括该卷主题
2. 分卷简介：200-300字，详细概括该卷主要剧情、角色发展、核心冲突
3. 核心剧情线：一句话描述该卷的核心目标或冲突
4. 章节范围：startChapter 和 endChapter（注意：每卷章节数可以不同！）
5. 关键章节：该卷内6-10个关键节点的章节号、标题和概要

请以JSON格式返回：
[
  {
    "title": "第一卷 卷名",
    "summary": "详细的分卷简介，包含主要剧情线、角色发展...",
    "plotLine": "核心剧情线...",
    "startChapter": 1,
    "endChapter": 85,
    "chapterCount": 85,
    "keyChapters": [
      {"chapterNum": 1, "title": "章节标题", "brief": "章节概要..."},
      {"chapterNum": 20, "title": "转折点", "brief": "重要转折..."},
      ...
    ]
  },
  {
    "title": "第二卷 卷名",
    "summary": "...",
    "plotLine": "...",
    "startChapter": 86,
    "endChapter": 200,
    "chapterCount": 115,
    "keyChapters": [...]
  },
  ...
]

注意：每卷的 chapterCount 必须等于 endChapter - startChapter + 1，且各卷章节数应该有差异！`,
    systemPrompt: `你是一位资深的网络小说策划编辑，有丰富的长篇连载小说结构设计经验。
请务必做到：
1. 先仔细阅读和分析总大纲，理解故事的完整脉络
2. 识别故事中的关键转折点和阶段划分
3. 根据每个阶段的剧情密度和重要性分配章节数量
4. 每卷章节数应该有明显差异，体现剧情轻重缓急
5. 确保JSON格式正确，可以被解析`,
    maxTokens: 8000,
    temperature: 0.7,
    configId: request.configId
  })

  try {
    // 尝试从返回内容中提取JSON
    const jsonMatch = result.content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const volumes = JSON.parse(jsonMatch[0]) as any[]

      // 验证和处理分卷数据
      let lastEndChapter = 0
      return volumes.map((v, index) => {
        // 获取AI分配的章节范围
        const startChapter = v.startChapter || (lastEndChapter + 1)
        let endChapter = v.endChapter || (startChapter + avgChaptersPerVolume - 1)

        // 计算章节数
        let chapterCount = v.chapterCount || (endChapter - startChapter + 1)

        // 验证章节数在合理范围内，但保留AI的差异化分配
        if (chapterCount < minChaptersPerVolume * 0.8) { // 允许一定弹性
          chapterCount = minChaptersPerVolume
          endChapter = startChapter + chapterCount - 1
        } else if (chapterCount > maxChaptersPerVolume * 1.1) {
          chapterCount = maxChaptersPerVolume
          endChapter = startChapter + chapterCount - 1
        }

        lastEndChapter = endChapter

        return {
          id: `vol_${index + 1}`,
          title: v.title || `第${index + 1}卷`,
          summary: v.summary || '',
          plotLine: v.plotLine || '',
          wordTarget: chapterCount * chapterWordCount,
          startChapter,
          endChapter,
          chapterCount,
          chapters: (v.keyChapters || v.chapters || []).map((c: any) => ({
            title: c.title || '未命名章节',
            brief: c.brief || ''
          }))
        }
      })
    }
  } catch (e) {
    console.error('解析分卷大纲JSON失败:', e)
  }

  // 解析失败时返回默认结构（但仍然尝试有差异化）
  const defaultVolumes: VolumeOutlineResult[] = []
  let currentChapter = 1

  // 为默认分卷创建差异化的章节分配
  const volumeDistribution = generateVariedDistribution(totalChapters, volumeCount, minChaptersPerVolume, maxChaptersPerVolume)

  for (let i = 0; i < volumeCount; i++) {
    const chapterCount = volumeDistribution[i]
    const endChapter = currentChapter + chapterCount - 1

    defaultVolumes.push({
      id: `vol_${i + 1}`,
      title: `第${i + 1}卷`,
      summary: '待生成',
      plotLine: '',
      wordTarget: chapterCount * chapterWordCount,
      startChapter: currentChapter,
      endChapter,
      chapterCount,
      chapters: []
    })

    currentChapter = endChapter + 1
  }
  return defaultVolumes
}

/**
 * 生成差异化的章节分配
 */
function generateVariedDistribution(totalChapters: number, volumeCount: number, min: number, max: number): number[] {
  const result: number[] = []
  let remaining = totalChapters

  for (let i = 0; i < volumeCount; i++) {
    const isLast = i === volumeCount - 1
    if (isLast) {
      // 最后一卷获取剩余章节
      result.push(Math.min(Math.max(remaining, min), max))
    } else {
      // 其他卷使用变化的分配
      // 开头卷稍短，中间高潮卷较长
      const position = i / (volumeCount - 1) // 0 到 1
      const variance = Math.sin(position * Math.PI) * 0.3 // 中间最高
      const base = totalChapters / volumeCount
      const chapters = Math.round(base * (0.85 + variance))
      const clamped = Math.min(Math.max(chapters, min), max)
      result.push(clamped)
      remaining -= clamped
    }
  }

  return result
}

// ========== AI上下文增强API ==========

const CONTEXT_URL = '/ai/context'

/**
 * 获取增强上下文（包含角色、设定、知识库）
 */
export async function getEnhancedContext(
  bookId: string,
  query?: string,
  options?: {
    includeCharacters?: boolean
    includeSettings?: boolean
    includeKnowledge?: boolean
  }
): Promise<string> {
  const params: Record<string, unknown> = {
    includeCharacters: options?.includeCharacters ?? true,
    includeSettings: options?.includeSettings ?? true,
    includeKnowledge: options?.includeKnowledge ?? true
  }
  if (query) params.query = query
  return get<string>(`${CONTEXT_URL}/enhanced/${bookId}`, params)
}

/**
 * 获取角色上下文
 */
export async function getCharacterContext(bookId: string): Promise<string> {
  return get<string>(`${CONTEXT_URL}/characters/${bookId}`)
}

/**
 * 获取设定上下文
 */
export async function getSettingContext(bookId: string): Promise<string> {
  return get<string>(`${CONTEXT_URL}/settings/${bookId}`)
}

/**
 * 获取章节生成上下文
 */
export async function getChapterContext(
  bookId: string,
  chapterTitle: string,
  previousContent?: string
): Promise<string> {
  return post<string>(`${CONTEXT_URL}/chapter/${bookId}`, {
    chapterTitle,
    previousContent
  })
}
