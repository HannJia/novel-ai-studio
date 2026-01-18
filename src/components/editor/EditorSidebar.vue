<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChapterStore, useUiStore, useBookStore, useAiStore, useEditorStore } from '@/stores'
import type { VolumeOutlineChapter, DetailOutlineStep } from '@/types'
import { DETAIL_OUTLINE_STEPS } from '@/types'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { generateChapterTitleAndSummary } from '@/services/api/aiApi'

const chapterStore = useChapterStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()
const bookStore = useBookStore()
const aiStore = useAiStore()

// 中文数字转换
const chineseNumbers = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十',
  '三十一', '三十二', '三十三', '三十四', '三十五', '三十六', '三十七', '三十八', '三十九', '四十',
  '四十一', '四十二', '四十三', '四十四', '四十五', '四十六', '四十七', '四十八', '四十九', '五十']

function toChineseNumber(num: number): string {
  if (num <= 50) return chineseNumbers[num]
  return num.toString()
}

const emit = defineEmits<{
  selectChapter: [id: string]
  createChapter: []
  deleteChapter: [id: string, title: string, event: Event]
}>()

// Props - 章节生成字数配置
const props = defineProps<{
  chapterWordMin?: number
  chapterWordMax?: number
}>()

// 默认字数配置
const minWords = computed(() => props.chapterWordMin || 2000)
const maxWords = computed(() => props.chapterWordMax || 4000)

// 本地状态
const searchQuery = ref('')
const activeTab = ref<'chapters' | 'outline' | 'detail'>('chapters')

// 当前选中的大纲项索引
const selectedOutlineIndex = ref<number | null>(null)

// 是否显示总大纲
const showTotalOutline = ref(false)

// 展开的分卷列表
const expandedVolumes = ref<string[]>([])

// 切换分卷展开/折叠
function toggleVolume(volumeId: string) {
  const index = expandedVolumes.value.indexOf(volumeId)
  if (index === -1) {
    expandedVolumes.value.push(volumeId)
  } else {
    expandedVolumes.value.splice(index, 1)
  }
}

// 细纲相关状态
const detailOutlineMode = ref<'view' | 'generate'>('view')  // 查看/生成模式
const selectedChapterForDetail = ref<string | null>(null)  // 选中查看的章节
const isGeneratingChapter = ref(false)  // 是否正在生成章节内容
const isGeneratingOutline = ref(false)  // 是否正在生成细纲
const pendingDetailOutline = ref<DetailOutlineStep[]>([])  // 待确认的细纲
const outlineConfirmed = ref(false)  // 细纲是否已确认

// 章节搜索过滤
const filteredChapters = computed(() => {
  if (!searchQuery.value.trim()) {
    return chapterStore.chapterTree
  }
  const query = searchQuery.value.toLowerCase()
  return chapterStore.chapterTree.filter(chapter =>
    chapter.title.toLowerCase().includes(query)
  )
})

// 大纲数据（从 bookStore 获取，如果没有则使用章节数据生成）
const bookOutlineData = computed(() => {
  const book = bookStore.currentBook
  const chapters = chapterStore.chapterTree

  // 如果书籍有分卷大纲数据，使用大纲结构但关联实际章节
  if (book?.volumes && book.volumes.length > 0) {
    let chapterIndex = 0
    return book.volumes.map((vol: any, vIndex: number) => {
      // 计算当前卷应该包含的章节数量
      const volChapterCount = vol.chapters?.length || 10
      // 从实际章节中取出对应数量的章节
      const actualChapters = chapters.slice(chapterIndex, chapterIndex + volChapterCount)
      chapterIndex += volChapterCount

      return {
        id: vol.id || `vol_${vIndex + 1}`,
        title: vol.title,
        summary: vol.summary || '',
        // 使用实际章节数据，保留大纲章节的brief信息
        chapters: actualChapters.map((ch, i) => ({
          id: `ch_${vIndex}_${i}`,
          title: ch.title,
          chapterId: ch.id,
          brief: vol.chapters?.[i]?.brief || ''  // 保留大纲中的章节简介
        }))
      }
    })
  }

  // 没有分卷数据时，根据章节自动分组（每10章一卷）
  if (chapters.length === 0) {
    return []
  }

  const volumeSize = 10
  const volumes = []
  const volumeNames = ['起源', '觉醒', '试炼', '崛起', '风云', '争霸', '巅峰', '沉浮', '归来', '永恒']

  for (let i = 0; i < chapters.length; i += volumeSize) {
    const volumeIndex = Math.floor(i / volumeSize)
    const volumeChapters = chapters.slice(i, i + volumeSize)

    volumes.push({
      id: `vol_${volumeIndex + 1}`,
      title: `第${volumeIndex + 1}卷 ${volumeNames[volumeIndex] || '未命名'}`,
      summary: '',
      chapters: volumeChapters.map((ch, j) => ({
        id: `ch_${volumeIndex}_${j}`,
        title: ch.title,
        chapterId: ch.id
      }))
    })
  }

  return volumes
})

// 总大纲文本
const totalOutline = computed(() => {
  return bookStore.currentBook?.outline || '暂无总大纲'
})

// 当前分卷大纲（根据下一章序号计算所属分卷）
const currentVolumeOutline = computed(() => {
  const book = bookStore.currentBook
  if (!book?.volumes || book.volumes.length === 0) return null

  const nextOrder = chapterStore.nextChapterNumber
  let chapterCount = 0

  // 根据章节序号找到对应的分卷
  for (const vol of book.volumes) {
    const volChapterCount = vol.chapters?.length || 10
    chapterCount += volChapterCount
    if (nextOrder <= chapterCount) {
      return vol
    }
  }

  // 默认返回最后一卷
  return book.volumes[book.volumes.length - 1] || null
})

// 已完成章节列表（用于选择查看）
const completedChaptersList = computed(() => {
  return chapterStore.chapters.filter(ch => ch.content && ch.content.trim().length > 0)
})

// 下一章信息
const nextChapterInfo = computed(() => {
  const nextOrder = chapterStore.nextChapterNumber
  return {
    order: nextOrder,
    title: `第${nextOrder}章`
  }
})

// 检查细纲是否有任何内容
const hasAnyOutlineContent = computed(() => {
  return pendingDetailOutline.value.some(step => step.content && step.content.trim().length > 0)
})

// 联动：当选择章节时，自动选中对应的大纲项
watch(() => chapterStore.currentChapter, (chapter) => {
  if (chapter) {
    // 查找当前章节在大纲中的位置
    for (const vol of bookOutlineData.value) {
      const index = vol.chapters.findIndex((ch: VolumeOutlineChapter) => ch.chapterId === chapter.id)
      if (index !== -1) {
        selectedOutlineIndex.value = index
        break
      }
    }
  }
})

// 联动：点击大纲项时，跳转到对应章节
function selectOutlineChapter(chapterId: string | undefined) {
  if (chapterId) {
    emit('selectChapter', chapterId)
    // 自动切换到细纲标签
    activeTab.value = 'detail'
  }
}

// 选择已完成章节查看
function selectCompletedChapter(chapterId: string) {
  selectedChapterForDetail.value = chapterId
  detailOutlineMode.value = 'view'
}

// 切换到生成下一章模式
function switchToGenerateMode() {
  detailOutlineMode.value = 'generate'
  selectedChapterForDetail.value = null
  // 始终确保细纲数组有5个元素
  if (pendingDetailOutline.value.length !== 5) {
    pendingDetailOutline.value = DETAIL_OUTLINE_STEPS.map(step => ({
      type: step.type,
      content: '',
      completed: false
    }))
  }
  outlineConfirmed.value = false
}

// AI生成细纲
async function generateDetailOutline() {
  if (isGeneratingOutline.value) return

  isGeneratingOutline.value = true
  outlineConfirmed.value = false

  try {
    const book = bookStore.currentBook
    const nextOrder = chapterStore.nextChapterNumber
    const previousContext = chapterStore.getPreviousChaptersContext(nextOrder)
    // 优先使用 plotLine（详细分卷大纲），其次 summary
    const volumeOutline = currentVolumeOutline.value?.plotLine || currentVolumeOutline.value?.summary || ''
    const volumeTitle = currentVolumeOutline.value?.title || ''

    const result = await aiStore.generate({
      prompt: `请为《${book?.title || '未命名'}》第${nextOrder}章生成五步细纲。

【背景信息】
总大纲：${totalOutline.value}
${volumeTitle ? `当前卷：${volumeTitle}` : ''}
${volumeOutline ? `分卷大纲：${volumeOutline}` : ''}
前文概要：${previousContext || '（第一章开篇）'}

【请按以下五个步骤生成细纲】
1. 场景铺设：设定本章的场景环境、时间地点
2. 角色出场：本章出场的角色及其状态、情绪
3. 剧情展开：本章的核心剧情发展
4. 高潮推进：情节如何推向高潮
5. 本章收尾：本章如何结尾，留下什么悬念

请以JSON格式返回：
{
  "scene": "场景铺设内容...",
  "characters": "角色出场内容...",
  "plot": "剧情展开内容...",
  "climax": "高潮推进内容...",
  "ending": "本章收尾内容..."
}`,
      systemPrompt: '你是专业的小说策划编辑，擅长设计章节结构。请直接返回JSON格式的细纲内容，不要有其他解释。',
      temperature: 0.7,
      // 推理模型思考过程会消耗大量 token，需要给足够上限
      maxTokens: aiStore.isReasoningModel ? 32000 : 4000
    })

    console.log('AI返回结果:', result)
    console.log('AI返回内容:', result?.content)
    if (!result?.content) {
      throw new Error('生成细纲失败，请重试')
    }

    // 解析JSON结果
    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const outlineData = JSON.parse(jsonMatch[0])
        pendingDetailOutline.value = [
          { type: 'scene', content: outlineData.scene || '', completed: true },
          { type: 'characters', content: outlineData.characters || '', completed: true },
          { type: 'plot', content: outlineData.plot || '', completed: true },
          { type: 'climax', content: outlineData.climax || '', completed: true },
          { type: 'ending', content: outlineData.ending || '', completed: true }
        ]
        ElMessage.success('细纲生成成功，请查看并确认')
      } else {
        throw new Error('无法解析细纲JSON')
      }
    } catch (parseError) {
      console.error('解析细纲失败:', parseError)
      ElMessage.error('解析细纲失败，请重试')
    }
  } catch (e) {
    console.error('生成细纲失败:', e)
    ElMessage.error('生成细纲失败，请重试')
  } finally {
    isGeneratingOutline.value = false
  }
}

// 确认细纲
function confirmOutline() {
  if (pendingDetailOutline.value.length === 0) {
    ElMessage.warning('请先生成细纲')
    return
  }
  outlineConfirmed.value = true
  ElMessage.success('细纲已确认，可以生成章节内容了')
}

// 重置细纲
function resetOutline() {
  pendingDetailOutline.value = []
  outlineConfirmed.value = false
}

// 清理AI输出中的元数据和思考过程
function cleanAIOutput(text: string): string {
  if (!text || text.length === 0) return text

  let cleaned = text

  // 检测是否包含大量元数据特征
  const metadataIndicators = ['分析要求', '起草', '润色', '场景设置', '动作:', '事件:', '角色：', '输出：', '限制：', '字数：']
  let hasMetadata = false
  for (const indicator of metadataIndicators) {
    if (cleaned.includes(indicator)) {
      hasMetadata = true
      break
    }
  }

  if (hasMetadata) {
    // 尝试找到真正的故事内容开始位置
    // 查找第一个看起来像故事开头的段落（通常以场景描写或人物动作开始）
    const storyStartPatterns = [
      /(?:^|\n)[\u4e00-\u9fa5]{2,}(?:的|着|了|在|是|上|下|中|里|外)[\u4e00-\u9fa5]/m,  // 常见中文句式
      /(?:^|\n)"[^"]+"/m,  // 以对话开头
      /(?:^|\n)[\u4e00-\u9fa5]+(?:说道|问道|喊道|叫道|笑道)/m,  // 以对话标记开头
    ]

    for (const pattern of storyStartPatterns) {
      const match = cleaned.match(pattern)
      if (match && match.index !== undefined && match.index > 50) {
        // 从故事内容开始处截取
        cleaned = cleaned.substring(match.index).trim()
        break
      }
    }

    // 如果还有元数据，逐行过滤
    const lines = cleaned.split('\n')
    const storyLines: string[] = []
    let inStory = false

    for (const line of lines) {
      const trimmedLine = line.trim()
      // 跳过明显是元数据的行
      if (trimmedLine.match(/^\d+\.\s*\*{0,2}(分析|起草|润色|撰写|解构|拆解)/)) continue
      if (trimmedLine.match(/^\*{0,2}(角色|输出|限制|字数|背景|设定|情节|场景)[：:]/)) continue
      if (trimmedLine.match(/^[-*]\s*\*{0,2}[^：:]+[：:]/)) continue
      if (trimmedLine === '') {
        if (inStory) storyLines.push('')
        continue
      }

      // 一旦开始故事内容，后续都是故事
      inStory = true
      storyLines.push(line)
    }

    cleaned = storyLines.join('\n').trim()
  }

  return cleaned
}

// 确保文本在完整句子处结束（后处理函数）
function ensureCompleteSentence(text: string): string {
  if (!text || text.length === 0) return text

  const trimmed = text.trim()

  // 中英文句子结束符号 (使用 Unicode 避免解析问题)
  const sentenceEnders = ['。', '！', '？', '…', '"', '\u2019', '.', '!', '?']

  // 如果已经以句子结束符结尾，直接返回
  const lastChar = trimmed[trimmed.length - 1]
  if (sentenceEnders.includes(lastChar)) {
    return trimmed
  }

  // 查找最后一个完整句子的位置
  let lastSentenceEnd = -1
  for (const ender of sentenceEnders) {
    const pos = trimmed.lastIndexOf(ender)
    if (pos > lastSentenceEnd) {
      lastSentenceEnd = pos
    }
  }

  // 如果找到了句子结束符，截取到该位置
  if (lastSentenceEnd > trimmed.length * 0.5) {
    // 只有当截取后保留超过50%内容时才截取，避免丢失太多内容
    return trimmed.substring(0, lastSentenceEnd + 1)
  }

  // 如果没找到合适的结束位置，尝试添加省略号使其看起来更自然
  // 检查是否在对话中间被截断（中文引号）
  const closeQuotes = '"\u2019'  // " 和 '
  const openQuotes = '"\u2018'   // " 和 '
  const lastQuoteClose = Math.max(trimmed.lastIndexOf(closeQuotes[0]), trimmed.lastIndexOf(closeQuotes[1]))
  const lastQuoteOpen = Math.max(trimmed.lastIndexOf(openQuotes[0]), trimmed.lastIndexOf(openQuotes[1]))

  if (lastQuoteOpen > lastQuoteClose) {
    // 在对话中间被截断，添加结束引号和省略
    return trimmed + '……"'
  }

  // 普通文本被截断，添加省略号
  return trimmed + '……'
}

// 分段生成章节内容：每个部分单独生成，确保内容完整
async function generateChapterContent() {
  if (isGeneratingChapter.value) return

  isGeneratingChapter.value = true

  try {
    const book = bookStore.currentBook
    const nextOrder = chapterStore.nextChapterNumber
    const previousContext = chapterStore.getPreviousChaptersContext(nextOrder)
    // 优先使用 plotLine（详细分卷大纲），其次 summary
    const volumeOutline = currentVolumeOutline.value?.plotLine || currentVolumeOutline.value?.summary || ''

    // 使用配置的字数范围
    const wordMin = minWords.value
    const wordMax = maxWords.value
    const targetWords = Math.floor((wordMin + wordMax) / 2)

    // 推理模型（如 Gemini 3 Pro）倾向于生成更详细的内容
    // 根据测试，实际输出约为目标字数的 1.5-1.6 倍
    // 因此需要动态计算系数，让最终结果落在 [wordMin, wordMax] 区间内
    const isReasoning = aiStore.isReasoningModel
    let adjustedTargetWords: number
    if (isReasoning) {
      // 推理模型：目标区间中点除以膨胀系数（约1.5），确保结果落在区间内
      // 例：区间 2000-3000，中点 2500，调整后 2500/1.5 ≈ 1667，实际输出约 2500
      const expansionFactor = 1.5
      adjustedTargetWords = Math.floor(targetWords / expansionFactor)
    } else {
      adjustedTargetWords = targetWords
    }

    // 分配每个部分的字数（4个部分）
    const partDistribution = [
      { part: '开篇', ratio: 0.2 },   // 20% - 场景铺设
      { part: '发展', ratio: 0.3 },   // 30% - 情节推进
      { part: '高潮', ratio: 0.3 },   // 30% - 冲突高潮
      { part: '收尾', ratio: 0.2 }    // 20% - 自然结束
    ]

    const sections = partDistribution.map(p => ({
      ...p,
      targetWords: Math.floor(adjustedTargetWords * p.ratio)
    }))

    aiStore.resetProgress()

    // 逐段生成
    const generatedParts: string[] = []
    let accumulatedContent = ''

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const isFirst = i === 0
      const isLast = i === sections.length - 1

      // 更新进度（使用新的步骤更新方法）
      aiStore.updateProgress(i + 1, section.part)

      // 构建当前段落的 prompt - 传入段落索引用于匹配五步细纲
      const sectionPrompt = buildSectionPrompt({
        book,
        nextOrder,
        totalOutline: totalOutline.value,
        volumeOutline,
        previousContext,
        section,
        isFirst,
        isLast,
        previousParts: generatedParts,
        accumulatedContent,
        sectionIndex: i  // 传入当前段落索引
      })

      // 推理模型（如 Gemini 3 Pro）的思考过程会消耗大量 token
      // 需要给足够的 maxTokens 上限，实际输出长度由 prompt 中的字数要求控制
      const isReasoning = aiStore.isReasoningModel
      // 推理模型：给足够空间让思考完成（32000）；非推理模型：正常限制
      const maxTokens = isReasoning ? 32000 : Math.ceil(section.targetWords * 1.5)

      const result = await aiStore.generate({
        prompt: sectionPrompt,
        systemPrompt: `【核心规则】你是小说作家，必须直接输出小说正文。

【绝对禁止】以下内容一旦出现即为失败：
× 任何带有星号*的内容
× 任何编号列表（1. 2. 3.）
× 任何分析/思考/计划/推理过程
× 任何标记如【分析】【起草】【润色】
× 任何元描述如"场景设置"、"角色："、"动作："
× 任何大纲/笔记/草稿格式

【正确输出示例】
云雾缭绕的青云门广场上，数百名少年少女正紧张地等待着。韩立站在人群中，手心微微冒汗，偷偷摸了摸怀里那本破旧的小册子...

【严格字数限制】⚠️
- 本段必须控制在 ${section.targetWords} 字左右（允许±10%误差）
- 超过 ${Math.ceil(section.targetWords * 1.1)} 字视为失败
- ${isFirst ? '自然引入场景' : '承接前文'}
- ${isLast ? '自然收尾' : '为下文铺垫'}
- 以完整句子结束
- 从第一个字就是故事内容`,
        maxTokens
      })

      if (!result?.content) {
        throw new Error(`生成【${section.part}】失败`)
      }

      // 后处理：清理元数据并确保句子完整性
      const cleanedContent = cleanAIOutput(result.content.trim())
      const partContent = ensureCompleteSentence(cleanedContent)
      generatedParts.push(partContent)
      accumulatedContent += (accumulatedContent ? '\n\n' : '') + partContent

      console.log(`【${section.part}】生成完成，字数：${partContent.replace(/\s/g, '').length}`)
    }

    // 合并所有部分
    const finalContent = generatedParts.join('\n\n')
    const actualWordCount = finalContent.replace(/\s/g, '').length

    // 创建章节
    const tempTitle = `第${toChineseNumber(nextOrder)}章`
    const newChapter = await chapterStore.createChapter({
      bookId: book?.id || '',
      title: tempTitle,
      content: finalContent,
      order: nextOrder
    })

    if (newChapter) {
      // 直接设置当前章节并加载内容到编辑器
      chapterStore.setCurrentChapter(newChapter)
      // 确保编辑器内容被更新（双重保险）
      editorStore.loadChapterContent(finalContent, newChapter.id)

      // 根据实际字数给出提示
      if (actualWordCount < wordMin) {
        ElMessage.warning(`第${toChineseNumber(nextOrder)}章已生成（${actualWordCount}字，略少于目标${wordMin}字）`)
      } else if (actualWordCount > wordMax) {
        ElMessage.warning(`第${toChineseNumber(nextOrder)}章已生成（${actualWordCount}字，略多于目标${wordMax}字）`)
      } else {
        ElMessage.success(`第${toChineseNumber(nextOrder)}章已生成（${actualWordCount}字）`)
      }

      // 异步生成章节标题和总结
      try {
        const { title: generatedTitle, summary } = await generateChapterTitleAndSummary({
          chapterContent: finalContent,
          chapterNumber: nextOrder,
          bookTitle: book?.title,
          isReasoningModel: aiStore.isReasoningModel
        })
        const fullTitle = `第${toChineseNumber(nextOrder)}章 ${generatedTitle}`
        // 同时更新标题和总结
        await chapterStore.updateChapter(newChapter.id, {
          title: fullTitle,
          summary: summary || undefined
        })
        ElMessage.success(`章节标题已更新为：${fullTitle}`)
        if (summary) {
          console.log('章节总结已保存:', summary.slice(0, 50) + '...')
        }
      } catch (titleError) {
        console.error('生成章节标题和总结失败:', titleError)
      }

      // 刷新章节列表以更新字数显示
      await chapterStore.fetchChaptersByBook(book?.id || '')
      // 重置细纲状态
      resetOutline()
      detailOutlineMode.value = 'view'
      selectedChapterForDetail.value = newChapter.id
    }
  } catch (e) {
    console.error('生成章节失败:', e)
    ElMessage.error('生成章节失败，请重试')
  } finally {
    isGeneratingChapter.value = false
    aiStore.resetProgress()
  }
}

// 构建单个段落的 prompt - 根据五步细纲编排正文
function buildSectionPrompt(params: {
  book: typeof bookStore.currentBook
  nextOrder: number
  totalOutline: string
  volumeOutline: string
  previousContext: string
  section: { part: string; targetWords: number; ratio: number }
  isFirst: boolean
  isLast: boolean
  previousParts: string[]
  accumulatedContent: string
  sectionIndex: number  // 当前段落索引 0-3
}): string {
  const { book, nextOrder, totalOutline, volumeOutline, previousContext, section, isFirst, accumulatedContent, sectionIndex } = params

  // 获取各步骤细纲内容
  const sceneOutline = getStepContent('scene')      // 场景铺设
  const charactersOutline = getStepContent('characters')  // 角色出场
  const plotOutline = getStepContent('plot')        // 剧情展开
  const climaxOutline = getStepContent('climax')    // 高潮推进
  const endingOutline = getStepContent('ending')    // 本章收尾

  // 根据段落索引确定当前应该写的内容
  // 开篇(0)：场景铺设 + 角色出场
  // 发展(1)：剧情展开
  // 高潮(2)：高潮推进
  // 收尾(3)：本章收尾
  let currentFocus = ''
  let currentGuidance = ''

  switch (sectionIndex) {
    case 0: // 开篇 - 场景铺设 + 角色出场
      currentFocus = `【本段重点】场景铺设 + 角色出场
${sceneOutline ? `场景：${sceneOutline}` : ''}
${charactersOutline ? `角色：${charactersOutline}` : ''}`
      currentGuidance = '以场景描写开头，自然引入角色，营造氛围'
      break
    case 1: // 发展 - 剧情展开
      currentFocus = `【本段重点】剧情展开
${plotOutline ? `剧情：${plotOutline}` : '承接上文，展开核心剧情'}`
      currentGuidance = '推进情节，展开剧情，制造张力'
      break
    case 2: // 高潮 - 高潮推进
      currentFocus = `【本段重点】高潮推进
${climaxOutline ? `高潮：${climaxOutline}` : '将情节推向高潮'}`
      currentGuidance = '情节高潮，情感爆发，关键转折'
      break
    case 3: // 收尾 - 本章收尾
      currentFocus = `【本段重点】本章收尾
${endingOutline ? `收尾：${endingOutline}` : '自然收尾，可留悬念'}`
      currentGuidance = '情节收束，留下悬念或伏笔，为下章铺垫'
      break
  }

  // 构建提示词
  let prompt = `【任务】直接撰写《${book?.title || '未命名'}》第${nextOrder}章的「${section.part}」部分正文

【背景设定】
${totalOutline}${volumeOutline ? `\n当前卷：${volumeOutline}` : ''}

${currentFocus}`

  if (isFirst) {
    prompt += `\n\n【前文概要】\n${previousContext || '（第一章开篇）'}`
  } else {
    prompt += `\n\n【已写内容】\n${accumulatedContent}\n\n---\n请紧接上文继续写：`
  }

  prompt += `

【输出规范】
字数：约${section.targetWords}字
重点：${currentGuidance}
格式：纯小说正文，包含场景描写、人物对话、心理活动
禁止：任何分析、大纲、注释、星号标记

请直接开始写正文：
`

  return prompt
}

// 获取章节标题
function getChapterTitle(chapterId: string): string {
  const chapter = chapterStore.chapters.find(ch => ch.id === chapterId)
  return chapter?.title || '未知章节'
}

// 获取章节摘要
function getChapterSummary(chapterId: string): string {
  return chapterStore.getChapterSummary(chapterId)
}

// 获取指定步骤的内容（用于判断是否有内容）
function getStepContent(stepType: string): string {
  const stepIndex = DETAIL_OUTLINE_STEPS.findIndex(s => s.type === stepType)
  if (stepIndex >= 0 && pendingDetailOutline.value[stepIndex]) {
    return pendingDetailOutline.value[stepIndex].content?.trim() || ''
  }
  return ''
}
</script>

<template>
  <aside class="editor-sidebar" :class="{ collapsed: uiStore.sidebarCollapsed }">
    <!-- 侧边栏头部 -->
    <div class="sidebar-header">
      <div class="header-content" v-show="!uiStore.sidebarCollapsed">
        <el-icon class="header-icon"><Folder /></el-icon>
        <span class="header-title">目录</span>
      </div>
      <el-button class="collapse-btn" text @click="uiStore.toggleSidebar">
        <el-icon>
          <Expand v-if="uiStore.sidebarCollapsed" />
          <Fold v-else />
        </el-icon>
      </el-button>
    </div>

    <!-- 主内容区 -->
    <div class="sidebar-content" v-show="!uiStore.sidebarCollapsed">
      <!-- 搜索框 -->
      <div class="search-box">
        <el-input
          v-model="searchQuery"
          placeholder="搜索章节..."
          :prefix-icon="Search"
          clearable
          size="small"
        />
      </div>

      <!-- 标签切换 -->
      <div class="tab-switch">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'chapters' }"
          @click="activeTab = 'chapters'"
        >
          <el-icon><Document /></el-icon>
          章节
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'outline' }"
          @click="activeTab = 'outline'"
        >
          <el-icon><Notebook /></el-icon>
          大纲
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'detail' }"
          @click="activeTab = 'detail'"
        >
          <el-icon><List /></el-icon>
          细纲
        </button>
      </div>

      <!-- 章节列表 -->
      <div v-if="activeTab === 'chapters'" class="chapter-list">
        <!-- 新建章节按钮 -->
        <button class="create-chapter-btn" @click="$emit('createChapter')">
          <el-icon><Plus /></el-icon>
          新建章节
        </button>

        <!-- 加载状态 -->
        <div v-if="chapterStore.loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>

        <!-- 空状态 -->
        <div v-else-if="filteredChapters.length === 0" class="empty-state">
          <el-icon><DocumentDelete /></el-icon>
          <span>{{ searchQuery ? '未找到章节' : '暂无章节' }}</span>
        </div>

        <!-- 章节树 -->
        <div v-else class="chapters-tree">
          <div
            v-for="chapter in filteredChapters"
            :key="chapter.id"
            class="chapter-item"
            :class="{ active: chapterStore.currentChapter?.id === chapter.id }"
            @click="$emit('selectChapter', chapter.id)"
          >
            <div class="chapter-main">
              <el-icon class="chapter-icon"><Document /></el-icon>
              <span class="chapter-title">{{ chapter.title }}</span>
            </div>
            <div class="chapter-meta">
              <span class="word-count">{{ chapter.wordCount }}字</span>
              <el-button
                class="delete-btn"
                type="danger"
                text
                size="small"
                @click.stop="$emit('deleteChapter', chapter.id, chapter.title, $event)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- 大纲列表（书籍整体大纲） -->
      <div v-else-if="activeTab === 'outline'" class="book-outline-list">
        <div class="outline-header">
          <span class="outline-title">{{ bookStore.currentBook?.title || '书籍大纲' }}</span>
        </div>

        <!-- 总大纲摘要 -->
        <div class="total-outline-section" v-if="totalOutline">
          <div class="section-header" @click="showTotalOutline = !showTotalOutline">
            <el-icon><Notebook /></el-icon>
            <span>总大纲</span>
            <el-icon class="toggle-icon">
              <ArrowDown v-if="showTotalOutline" />
              <ArrowRight v-else />
            </el-icon>
          </div>
          <div v-if="showTotalOutline" class="total-outline-content">
            {{ totalOutline }}
          </div>
        </div>

        <!-- 分卷大纲 -->
        <div class="volumes-section-header">
          <el-icon><FolderOpened /></el-icon>
          <span>分卷大纲</span>
        </div>

        <div class="volumes-list" v-if="bookStore.currentBook?.volumes?.length > 0">
          <div
            v-for="volume in bookStore.currentBook.volumes"
            :key="volume.id"
            class="volume-section"
          >
            <div class="volume-header" @click="toggleVolume(volume.id)">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ volume.title }}</span>
              <el-icon class="expand-icon">
                <ArrowDown v-if="expandedVolumes.includes(volume.id)" />
                <ArrowRight v-else />
              </el-icon>
            </div>
            <div v-if="expandedVolumes.includes(volume.id)" class="volume-outline-content">
              {{ volume.plotLine || volume.summary || '暂无分卷大纲' }}
            </div>
          </div>
        </div>

        <div v-else class="empty-outline">
          <el-icon><InfoFilled /></el-icon>
          <span>暂无分卷大纲</span>
        </div>
      </div>

      <!-- 细纲列表（章节细纲管理） -->
      <div v-else-if="activeTab === 'detail'" class="detail-outline-list">
        <!-- 模式切换 -->
        <div class="detail-mode-switch">
          <button
            class="mode-btn"
            :class="{ active: detailOutlineMode === 'view' }"
            @click="detailOutlineMode = 'view'"
          >
            <el-icon><View /></el-icon>
            查看已完成
          </button>
          <button
            class="mode-btn"
            :class="{ active: detailOutlineMode === 'generate' }"
            @click="switchToGenerateMode"
          >
            <el-icon><MagicStick /></el-icon>
            生成下一章
          </button>
        </div>

        <!-- 查看模式：已完成章节列表 -->
        <template v-if="detailOutlineMode === 'view'">
          <div class="completed-chapters-section">
            <div class="section-title">
              <el-icon><Collection /></el-icon>
              已完成章节
            </div>

            <div v-if="completedChaptersList.length === 0" class="empty-state">
              <el-icon><DocumentDelete /></el-icon>
              <span>暂无已完成章节</span>
            </div>

            <div v-else class="completed-list">
              <div
                v-for="chapter in completedChaptersList"
                :key="chapter.id"
                class="completed-chapter-item"
                :class="{ active: selectedChapterForDetail === chapter.id }"
                @click="selectCompletedChapter(chapter.id)"
              >
                <div class="chapter-info">
                  <el-icon><Document /></el-icon>
                  <span class="chapter-title">{{ chapter.title }}</span>
                </div>
                <span class="word-count">{{ chapter.wordCount }}字</span>
              </div>
            </div>
          </div>

          <!-- 选中章节的细纲详情 -->
          <div v-if="selectedChapterForDetail" class="selected-chapter-detail">
            <div class="detail-header">
              <el-icon><Document /></el-icon>
              <span>{{ getChapterTitle(selectedChapterForDetail) }}</span>
            </div>

            <!-- 单章总结 -->
            <div class="chapter-summary">
              <div class="summary-label">单章总结</div>
              <div class="summary-content">{{ getChapterSummary(selectedChapterForDetail) || '暂无总结' }}</div>
            </div>
          </div>
        </template>

        <!-- 生成模式：生成下一章 -->
        <template v-if="detailOutlineMode === 'generate'">
          <div class="generate-section">
            <div class="next-chapter-info">
              <el-icon><EditPen /></el-icon>
              <span>准备生成: {{ nextChapterInfo.title }}</span>
            </div>

            <!-- AI一键生成按钮 -->
            <div class="ai-generate-row">
              <el-button
                type="primary"
                :loading="isGeneratingOutline"
                :disabled="isGeneratingOutline"
                @click="generateDetailOutline"
              >
                <el-icon><MagicStick /></el-icon>
                {{ isGeneratingOutline ? '生成中...' : 'AI智能生成五步细纲' }}
              </el-button>
            </div>

            <!-- 五步细纲卡片式输入区 -->
            <div class="five-steps-editor">
              <!-- 第1步：场景铺设 -->
              <div class="step-card" :class="{ 'has-content': getStepContent('scene') }">
                <div class="step-card-header">
                  <span class="step-badge">1</span>
                  <span class="step-title">场景铺设</span>
                  <el-icon v-if="getStepContent('scene')" class="check-icon"><CircleCheck /></el-icon>
                </div>
                <div class="step-card-body">
                  <el-input
                    v-model="pendingDetailOutline[0].content"
                    type="textarea"
                    :rows="3"
                    placeholder="设定本章的场景环境、时间地点..."
                    resize="none"
                  />
                </div>
              </div>

              <!-- 第2步：角色出场 -->
              <div class="step-card" :class="{ 'has-content': getStepContent('characters') }">
                <div class="step-card-header">
                  <span class="step-badge">2</span>
                  <span class="step-title">角色出场</span>
                  <el-icon v-if="getStepContent('characters')" class="check-icon"><CircleCheck /></el-icon>
                </div>
                <div class="step-card-body">
                  <el-input
                    v-model="pendingDetailOutline[1].content"
                    type="textarea"
                    :rows="3"
                    placeholder="本章出场的角色及其状态、情绪..."
                    resize="none"
                  />
                </div>
              </div>

              <!-- 第3步：剧情展开 -->
              <div class="step-card" :class="{ 'has-content': getStepContent('plot') }">
                <div class="step-card-header">
                  <span class="step-badge">3</span>
                  <span class="step-title">剧情展开</span>
                  <el-icon v-if="getStepContent('plot')" class="check-icon"><CircleCheck /></el-icon>
                </div>
                <div class="step-card-body">
                  <el-input
                    v-model="pendingDetailOutline[2].content"
                    type="textarea"
                    :rows="3"
                    placeholder="本章的核心剧情发展..."
                    resize="none"
                  />
                </div>
              </div>

              <!-- 第4步：高潮推进 -->
              <div class="step-card" :class="{ 'has-content': getStepContent('climax') }">
                <div class="step-card-header">
                  <span class="step-badge">4</span>
                  <span class="step-title">高潮推进</span>
                  <el-icon v-if="getStepContent('climax')" class="check-icon"><CircleCheck /></el-icon>
                </div>
                <div class="step-card-body">
                  <el-input
                    v-model="pendingDetailOutline[3].content"
                    type="textarea"
                    :rows="3"
                    placeholder="情节如何推向高潮..."
                    resize="none"
                  />
                </div>
              </div>

              <!-- 第5步：本章收尾 -->
              <div class="step-card" :class="{ 'has-content': getStepContent('ending') }">
                <div class="step-card-header">
                  <span class="step-badge">5</span>
                  <span class="step-title">本章收尾</span>
                  <el-icon v-if="getStepContent('ending')" class="check-icon"><CircleCheck /></el-icon>
                </div>
                <div class="step-card-body">
                  <el-input
                    v-model="pendingDetailOutline[4].content"
                    type="textarea"
                    :rows="3"
                    placeholder="本章如何结尾，留下什么悬念..."
                    resize="none"
                  />
                </div>
              </div>
            </div>

            <!-- 操作按钮区 -->
            <div class="outline-action-bar">
              <el-button size="small" @click="resetOutline">
                <el-icon><RefreshRight /></el-icon>
                清空
              </el-button>
              <el-button
                size="small"
                type="success"
                :disabled="!hasAnyOutlineContent"
                @click="confirmOutline"
              >
                <el-icon><Check /></el-icon>
                {{ outlineConfirmed ? '已确认 ✓' : '确认细纲' }}
              </el-button>
            </div>

            <!-- 生成章节按钮 -->
            <div class="generate-chapter-section">
              <div class="divider"></div>
              <div class="generate-tip">
                <el-icon><InfoFilled /></el-icon>
                <span>{{ outlineConfirmed ? '细纲已确认，可以生成章节了' : '请先填写或AI生成细纲，然后确认' }}</span>
              </div>
              <el-button
                type="primary"
                size="large"
                :loading="isGeneratingChapter"
                :disabled="isGeneratingChapter || !outlineConfirmed"
                @click="generateChapterContent"
              >
                <el-icon><MagicStick /></el-icon>
                {{ isGeneratingChapter ? '正在生成章节...' : '根据细纲生成章节' }}
              </el-button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 底部统计 -->
    <div class="sidebar-footer" v-show="!uiStore.sidebarCollapsed">
      <div class="stats-item">
        <el-icon><Warning /></el-icon>
        <span>逻辑告警: 0</span>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.editor-sidebar {
  width: $sidebar-width;
  background-color: var(--sidebar-bg, $bg-base);
  border-right: 1px solid var(--border-color, $border-light);
  display: flex;
  flex-direction: column;
  transition: width $transition-duration $transition-ease;
  overflow: hidden;

  &.collapsed {
    width: $sidebar-collapsed-width;
  }
}

.sidebar-header {
  height: 48px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color, $border-lighter);

  .header-content {
    display: flex;
    align-items: center;
    gap: 8px;

    .header-icon {
      font-size: 16px;
      color: var(--text-secondary, $text-secondary);
    }

    .header-title {
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary, $text-primary);
    }
  }

  .collapse-btn {
    padding: 6px;
    border-radius: $border-radius-base;
    color: var(--text-secondary, $text-secondary);

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
    }
  }
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-box {
  :deep(.el-input__wrapper) {
    border-radius: $border-radius-large;
    background-color: var(--input-bg, $light-bg-panel);
    box-shadow: none;
    border: 1px solid transparent;

    &:hover, &.is-focus {
      border-color: $primary-color;
    }
  }
}

.tab-switch {
  display: flex;
  gap: 4px;
  padding: 4px;
  background-color: var(--tab-bg, $light-bg-panel);
  border-radius: $border-radius-large;

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 12px;
    border: none;
    border-radius: $border-radius-base;
    background: transparent;
    color: var(--text-secondary, $text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all $transition-duration-fast $transition-ease;

    &:hover {
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-tab-bg, $bg-base);
      color: var(--text-primary, $text-primary);
      box-shadow: $light-card-shadow;
    }
  }
}

.create-chapter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--border-color, $border-light);
  border-radius: $border-radius-large;
  background: transparent;
  color: var(--text-secondary, $text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all $transition-duration-fast $transition-ease;

  &:hover {
    border-color: $primary-color;
    color: $primary-color;
    background-color: rgba($primary-color, 0.05);
  }
}

.loading-state,
.empty-state,
.no-chapter-tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-secondary, $text-secondary);
  font-size: 13px;

  .el-icon {
    font-size: 24px;
  }
}

.chapters-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chapter-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: $border-radius-large;
  cursor: pointer;
  transition: all $transition-duration-fast $transition-ease;

  &:hover {
    background-color: var(--hover-bg, $light-bg-hover);

    .delete-btn {
      opacity: 1;
    }
  }

  &.active {
    background-color: var(--active-bg, $light-bg-active);

    .chapter-title {
      color: $primary-color;
      font-weight: 500;
    }

    .chapter-icon {
      color: $primary-color;
    }
  }

  .chapter-main {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;

    .chapter-icon {
      font-size: 14px;
      color: var(--text-secondary, $text-secondary);
      flex-shrink: 0;
    }

    .chapter-title {
      font-size: 13px;
      color: var(--text-primary, $text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .chapter-meta {
    display: flex;
    align-items: center;
    gap: 4px;

    .word-count {
      font-size: 11px;
      color: var(--text-secondary, $text-secondary);
    }

    .delete-btn {
      opacity: 0;
      padding: 4px;
      transition: opacity $transition-duration-fast;
    }
  }
}

.outline-list {
  .current-chapter {
    font-size: 12px;
    color: var(--text-secondary, $text-secondary);
    padding: 8px 12px;
    background-color: var(--panel-bg, $light-bg-panel);
    border-radius: $border-radius-base;
    margin-bottom: 8px;
  }

  .outline-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .outline-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: $border-radius-base;
    font-size: 13px;
    color: var(--text-secondary, $text-secondary);

    .el-icon {
      font-size: 14px;
    }

    &.completed {
      color: $success-color;

      .el-icon {
        color: $success-color;
      }
    }
  }

  .outline-progress {
    margin-top: 12px;
    padding: 12px;
    background-color: var(--panel-bg, $light-bg-panel);
    border-radius: $border-radius-base;

    span {
      font-size: 12px;
      color: var(--text-secondary, $text-secondary);
      display: block;
      margin-bottom: 8px;
    }
  }
}

// 书籍大纲列表样式
.book-outline-list {
  .outline-header {
    padding: 8px 12px;
    background-color: var(--panel-bg, $light-bg-panel);
    border-radius: $border-radius-base;
    margin-bottom: 12px;

    .outline-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, $text-primary);
    }
  }

  // 总大纲区域
  .total-outline-section {
    margin-bottom: 16px;

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;
      cursor: pointer;
      transition: all $transition-duration-fast $transition-ease;

      &:hover {
        background-color: var(--hover-bg, $light-bg-hover);
      }

      .toggle-icon {
        margin-left: auto;
        font-size: 12px;
        color: var(--text-secondary, $text-secondary);
      }
    }

    .total-outline-content {
      margin-top: 8px;
      padding: 12px;
      font-size: 12px;
      line-height: 1.8;
      color: var(--text-secondary, $text-secondary);
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
  }

  // 分卷大纲标题
  .volumes-section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary, $text-secondary);
    border-bottom: 1px solid var(--border-color, $border-lighter);
    margin-bottom: 12px;
  }

  .volumes-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .volume-section {
    .volume-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;
      cursor: pointer;
      transition: all $transition-duration-fast $transition-ease;

      &:hover {
        background-color: var(--hover-bg, $light-bg-hover);
      }

      .expand-icon {
        margin-left: auto;
        font-size: 12px;
        color: var(--text-secondary, $text-secondary);
      }

      .el-icon {
        font-size: 14px;
        color: var(--text-secondary, $text-secondary);
      }
    }

    .volume-outline-content {
      padding: 10px 12px;
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.8;
      color: var(--text-primary, $text-primary);
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;
      white-space: pre-wrap;
      word-break: break-word;
    }
  }

  .outline-chapter-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--text-secondary, $text-secondary);
    border-radius: $border-radius-base;
    cursor: pointer;
    transition: all $transition-duration-fast $transition-ease;

    .el-icon {
      font-size: 14px;
    }

    .active-indicator {
      margin-left: auto;
      color: $primary-color;
    }

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-bg, $light-bg-active);
      color: $primary-color;
      font-weight: 500;

      .el-icon {
        color: $primary-color;
      }
    }
  }

  .outline-tip {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    padding: 10px 12px;
    font-size: 12px;
    color: var(--text-secondary, $text-secondary);
    background-color: var(--panel-bg, $light-bg-panel);
    border-radius: $border-radius-base;

    .el-icon {
      font-size: 14px;
    }
  }

  .empty-outline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-secondary, $text-secondary);
    font-size: 13px;
    text-align: center;

    .el-icon {
      font-size: 24px;
      color: var(--text-placeholder, $text-placeholder);
    }
  }
}

// 细纲列表样式
.detail-outline-list {
  display: flex;
  flex-direction: column;
  gap: 12px;

  // 模式切换
  .detail-mode-switch {
    display: flex;
    gap: 4px;
    padding: 4px;
    background-color: var(--tab-bg, $light-bg-panel);
    border-radius: $border-radius-large;

    .mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 12px;
      border: none;
      border-radius: $border-radius-base;
      background: transparent;
      color: var(--text-secondary, $text-secondary);
      font-size: 12px;
      cursor: pointer;
      transition: all $transition-duration-fast $transition-ease;

      &:hover {
        color: var(--text-primary, $text-primary);
      }

      &.active {
        background-color: var(--active-tab-bg, $bg-base);
        color: $primary-color;
        box-shadow: $light-card-shadow;
      }
    }
  }

  // 已完成章节区域
  .completed-chapters-section {
    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      padding: 8px 0;
      border-bottom: 1px solid var(--border-color, $border-lighter);
      margin-bottom: 8px;
    }

    .completed-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 180px;
      overflow-y: auto;
    }

    .completed-chapter-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: $border-radius-base;
      cursor: pointer;
      transition: all $transition-duration-fast $transition-ease;

      .chapter-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;

        .chapter-title {
          font-size: 13px;
          color: var(--text-primary, $text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      .word-count {
        font-size: 11px;
        color: var(--text-secondary, $text-secondary);
      }

      &:hover {
        background-color: var(--hover-bg, $light-bg-hover);
      }

      &.active {
        background-color: var(--active-bg, $light-bg-active);

        .chapter-title {
          color: $primary-color;
          font-weight: 500;
        }
      }
    }
  }

  // 选中章节详情
  .selected-chapter-detail {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color, $border-lighter);

    .detail-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      margin-bottom: 12px;

      .el-icon {
        color: $primary-color;
      }
    }

    .chapter-summary {
      padding: 10px 12px;
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;
      margin-bottom: 12px;

      .summary-label {
        font-size: 11px;
        color: var(--text-secondary, $text-secondary);
        margin-bottom: 6px;
        font-weight: 500;
      }

      .summary-content {
        font-size: 12px;
        line-height: 1.8;
        color: var(--text-primary, $text-primary);
        white-space: pre-wrap;
        word-break: break-word;
      }
    }
  }

  // 简化的细纲内容显示（查看模式）
  .detail-content-simple {
    display: flex;
    flex-direction: column;
    gap: 10px;

    .content-item {
      padding: 10px 12px;
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;

      .content-label {
        font-size: 12px;
        font-weight: 500;
        color: $primary-color;
        margin-bottom: 6px;
      }

      .content-text {
        font-size: 12px;
        line-height: 1.7;
        color: var(--text-primary, $text-primary);
        white-space: pre-wrap;
      }
    }
  }

  // 细纲步骤
  .detail-steps {
    display: flex;
    flex-direction: column;
    gap: 6px;

    .step-item {
      border: 1px solid var(--border-color, $border-lighter);
      border-radius: $border-radius-base;
      overflow: hidden;

      &.has-content {
        border-color: $success-color;

        .step-number {
          background-color: $success-color !important;
        }
      }

      .step-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background-color: var(--panel-bg, $light-bg-panel);
        cursor: pointer;
        transition: background-color $transition-duration-fast;

        &:hover {
          background-color: var(--hover-bg, $light-bg-hover);
        }

        .step-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text-primary, $text-primary);

          .step-number {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            background-color: $primary-color;
            color: white;
            font-size: 11px;
            font-weight: 500;
            border-radius: 50%;
          }

          .completed-icon {
            color: $success-color;
          }

          .pending-icon {
            color: var(--text-secondary, $text-secondary);
          }
        }

        .expand-icon {
          font-size: 12px;
          color: var(--text-secondary, $text-secondary);
        }
      }

      .step-content {
        padding: 12px;
        font-size: 12px;
        line-height: 1.8;
        color: var(--text-secondary, $text-secondary);
        background-color: var(--bg-base, $bg-base);
        white-space: pre-wrap;

        :deep(.el-textarea__inner) {
          font-size: 12px;
          line-height: 1.6;
        }
      }
    }
  }

  // 生成模式区域
  .generate-section {
    .next-chapter-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background-color: var(--panel-bg, $light-bg-panel);
      border-radius: $border-radius-base;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      margin-bottom: 12px;

      .el-icon {
        color: $primary-color;
      }
    }

    // AI一键生成按钮
    .ai-generate-row {
      display: flex;
      justify-content: center;
      margin-bottom: 16px;

      .el-button {
        width: 100%;
      }
    }

    // 五步细纲卡片式输入区
    .five-steps-editor {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .step-card {
        border: 1px solid var(--border-color, $border-light);
        border-radius: $border-radius-base;
        background-color: var(--bg-base, $bg-base);
        overflow: hidden;
        transition: border-color 0.2s;

        &.has-content {
          border-color: $success-color;
          border-left: 3px solid $success-color;
        }

        .step-card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background-color: var(--panel-bg, $light-bg-panel);
          border-bottom: 1px solid var(--border-color, $border-lighter);

          .step-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            background-color: $primary-color;
            color: white;
            font-size: 11px;
            font-weight: 600;
            border-radius: 50%;
          }

          .step-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--text-primary, $text-primary);
          }

          .check-icon {
            margin-left: auto;
            color: $success-color;
            font-size: 16px;
          }
        }

        .step-card-body {
          padding: 8px;

          :deep(.el-textarea__inner) {
            font-size: 12px;
            line-height: 1.6;
            border: none;
            background-color: transparent;
            box-shadow: none;
            padding: 8px;
            resize: none;

            &::placeholder {
              color: var(--text-placeholder, $text-placeholder);
              font-style: italic;
            }

            &:focus {
              box-shadow: none;
            }
          }
        }
      }
    }

    // 操作按钮区
    .outline-action-bar {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--border-color, $border-lighter);
    }

    // 生成章节区域
    .generate-chapter-section {
      margin-top: 16px;
      text-align: center;

      .divider {
        height: 1px;
        background-color: var(--border-color, $border-lighter);
        margin-bottom: 16px;
      }

      .generate-tip {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 12px;
        color: var(--text-secondary, $text-secondary);
        margin-bottom: 12px;
      }
    }

    // 细纲编辑区（兼容旧样式）
    .detail-outline-editor {
      .outline-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;

        .outline-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary, $text-primary);
        }
      }

      .outline-actions {
        display: flex;
        gap: 8px;
        justify-content: center;
        margin-top: 12px;
        flex-wrap: wrap;
      }
    }

    .generate-action {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
      padding: 20px 12px;

      .generate-tip {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 12px;
        color: var(--text-secondary, $text-secondary);
        line-height: 1.5;

        .el-icon {
          flex-shrink: 0;
          margin-top: 2px;
        }
      }
    }

    .pending-outline-section {
      .outline-status {
        margin-bottom: 12px;
      }

      .outline-actions {
        display: flex;
        gap: 8px;
        justify-content: center;
        margin-top: 12px;
        flex-wrap: wrap;
      }

      .generate-chapter-section {
        margin-top: 16px;
        text-align: center;

        .divider {
          height: 1px;
          background-color: var(--border-color, $border-lighter);
          margin-bottom: 16px;
        }
      }
    }
  }

  // 进度条
  .detail-progress {
    margin-top: 12px;
    padding: 12px;
    background-color: var(--panel-bg, $light-bg-panel);
    border-radius: $border-radius-base;

    span {
      font-size: 12px;
      color: var(--text-secondary, $text-secondary);
      display: block;
      margin-bottom: 8px;
    }
  }
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border-color, $border-lighter);

  .stats-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: $success-color;

    .el-icon {
      font-size: 14px;
    }
  }
}

// 深色主题适配
:global(html.dark) .editor-sidebar {
  --sidebar-bg: #{$dark-bg-base};
  --border-color: #{$dark-border-light};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --hover-bg: #{$dark-bg-hover};
  --active-bg: #{$dark-bg-active};
  --panel-bg: #{$dark-bg-panel};
  --tab-bg: #{$dark-bg-panel};
  --active-tab-bg: #{$dark-bg-card};
  --input-bg: #{$dark-bg-panel};
}
</style>
