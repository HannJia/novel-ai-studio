<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAiStore, useBookStore } from '@/stores'
import { ElMessage } from 'element-plus'
import type { BookGenre, BookSubGenre, BookStyle, NovelInitResult, NovelSettings, HaremSize } from '@/types'
import {
  BOOK_GENRE_MAP, BOOK_STYLE_MAP, BOOK_SUB_GENRE_MAP, GENRE_SUB_GENRES_MAP,
  GOLDEN_FINGER_TYPE_MAP, GOLDEN_FINGER_EXAMPLES,
  NARRATIVE_PERSPECTIVE_MAP, NARRATIVE_TENSE_MAP, ERA_SETTING_MAP, POWER_SYSTEM_MAP,
  TECH_LEVEL_MAP, PROTAGONIST_PERSONALITY_MAP, ROMANCE_LINE_MAP, HAREM_SIZE_MAP, PACING_PREFERENCE_MAP,
  CONFLICT_DENSITY_MAP, ANGST_LEVEL_MAP, ENDING_PREFERENCE_MAP, WRITING_STYLE_MAP,
  DIALOGUE_RATIO_MAP, DESCRIPTION_LEVEL_MAP
} from '@/types'
import { generateVolumeOutline } from '@/services/api/aiApi'

const emit = defineEmits<{
  close: []
  created: [bookId: string]
}>()

const aiStore = useAiStore()
const bookStore = useBookStore()

// 步骤状态
const currentStep = ref(0)
const steps = ['基本信息', 'AI 生成', '预览确认']

// 高级设置展开状态
const showAdvancedSettings = ref(false)
const activeSettingPanels = ref<string[]>([])

// 表单数据
const formData = ref({
  title: '',
  author: '',
  genre: 'xuanhuan' as BookGenre,
  subGenre: '' as BookSubGenre | '',  // 子分类
  style: 'qingsong' as BookStyle,
  targetWordCountMin: 100, // 目标字数最小值（万字）
  targetWordCountMax: 200, // 目标字数最大值（万字）
  protagonist: '',
  worldKeywords: '',
  coreConflict: ''
})

// 高级设置
const advancedSettings = ref<NovelSettings>({
  narrative: {
    perspective: 'third_limited',
    tense: 'past'
  },
  worldBuilding: {
    era: undefined,
    powerSystem: undefined,
    powerSystemCustom: '',
    techLevel: undefined
  },
  protagonist: {
    personality: undefined,
    goldenFinger: {
      type: 'none',
      name: '',
      description: '',
      limitation: '',
      growthPath: ''
    },
    romanceLine: undefined,
    haremSize: undefined
  },
  plot: {
    pacing: undefined,
    conflictDensity: undefined,
    angstLevel: undefined,
    ending: undefined
  },
  writing: {
    style: undefined,
    dialogueRatio: undefined,
    psychologyDescription: undefined,
    environmentDescription: undefined
  },
  preferences: {
    forbiddenElements: [],
    requiredElements: [],
    referenceWorks: ''
  }
})

// 禁用/必含元素的输入
const forbiddenInput = ref('')
const requiredInput = ref('')

// AI 生成的内容（扩展结构）
interface VolumeOutline {
  id: string
  title: string
  summary: string
  plotLine: string         // 核心剧情线
  chapterCount: number
  startChapter: number
  endChapter: number
  wordCountTarget: number
  chapters: { title: string; brief: string }[]
}

interface ExtendedNovelResult extends NovelInitResult {
  totalOutline: string // 总大纲
  volumes: VolumeOutline[] // 分卷大纲
  suggestedTitles?: string[] // 推荐书名
}

const generatedContent = ref<ExtendedNovelResult | null>(null)

// 加载状态
const generating = ref(false)
const creating = ref(false)

// 修改请求
const refineRequest = ref('')
const refining = ref(false)

// 选项映射转数组
const genreOptions = Object.entries(BOOK_GENRE_MAP).map(([value, label]) => ({ value, label }))
const styleOptions = Object.entries(BOOK_STYLE_MAP).map(([value, label]) => ({ value, label }))
const goldenFingerOptions = Object.entries(GOLDEN_FINGER_TYPE_MAP).map(([value, label]) => ({ value, label }))
const perspectiveOptions = Object.entries(NARRATIVE_PERSPECTIVE_MAP).map(([value, label]) => ({ value, label }))
const tenseOptions = Object.entries(NARRATIVE_TENSE_MAP).map(([value, label]) => ({ value, label }))
const eraOptions = Object.entries(ERA_SETTING_MAP).map(([value, label]) => ({ value, label }))
const powerSystemOptions = Object.entries(POWER_SYSTEM_MAP).map(([value, label]) => ({ value, label }))
const techLevelOptions = Object.entries(TECH_LEVEL_MAP).map(([value, label]) => ({ value, label }))
const personalityOptions = Object.entries(PROTAGONIST_PERSONALITY_MAP).map(([value, label]) => ({ value, label }))
const romanceOptions = Object.entries(ROMANCE_LINE_MAP).map(([value, label]) => ({ value, label }))
const haremSizeOptions = Object.entries(HAREM_SIZE_MAP).map(([value, label]) => ({ value, label }))
const pacingOptions = Object.entries(PACING_PREFERENCE_MAP).map(([value, label]) => ({ value, label }))
const conflictOptions = Object.entries(CONFLICT_DENSITY_MAP).map(([value, label]) => ({ value, label }))
const angstOptions = Object.entries(ANGST_LEVEL_MAP).map(([value, label]) => ({ value, label }))
const endingOptions = Object.entries(ENDING_PREFERENCE_MAP).map(([value, label]) => ({ value, label }))
const writingStyleOptions = Object.entries(WRITING_STYLE_MAP).map(([value, label]) => ({ value, label }))
const dialogueOptions = Object.entries(DIALOGUE_RATIO_MAP).map(([value, label]) => ({ value, label }))
const descriptionOptions = Object.entries(DESCRIPTION_LEVEL_MAP).map(([value, label]) => ({ value, label }))

// 子类型选项（根据主类型动态变化）
const subGenreOptions = computed(() => {
  const subGenres = GENRE_SUB_GENRES_MAP[formData.value.genre] || []
  return subGenres.map(value => ({
    value,
    label: BOOK_SUB_GENRE_MAP[value]
  }))
})

// 当主类型改变时，清空子类型
watch(() => formData.value.genre, () => {
  formData.value.subGenre = ''
})

// 计算字数相关信息（使用区间中值）
const wordCountInfo = computed(() => {
  const minWords = formData.value.targetWordCountMin * 10000
  const maxWords = formData.value.targetWordCountMax * 10000
  const avgWords = (minWords + maxWords) / 2
  const chaptersEstimate = Math.ceil(avgWords / 2500) // 每章约2500字（2000-3000的中间值）
  return {
    totalWords: avgWords,
    minWords,
    maxWords,
    chaptersEstimate
  }
})

// 金手指示例
const currentGoldenFingerExample = computed(() => {
  const type = advancedSettings.value.protagonist?.goldenFinger?.type
  if (type && GOLDEN_FINGER_EXAMPLES[type]) {
    return GOLDEN_FINGER_EXAMPLES[type]
  }
  return null
})

// 计算属性
const canGoNext = computed(() => {
  if (currentStep.value === 0) {
    return formData.value.title.trim().length > 0
  }
  if (currentStep.value === 1) {
    return generatedContent.value !== null
  }
  return true
})

const canGoBack = computed(() => {
  return currentStep.value > 0
})

// 角色类型映射
const roleTypeMap: Record<string, string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派'
}

// 添加禁用元素
function addForbiddenElement(): void {
  const value = forbiddenInput.value.trim()
  if (value && !advancedSettings.value.preferences?.forbiddenElements?.includes(value)) {
    if (!advancedSettings.value.preferences) {
      advancedSettings.value.preferences = { forbiddenElements: [], requiredElements: [], referenceWorks: '' }
    }
    advancedSettings.value.preferences.forbiddenElements?.push(value)
    forbiddenInput.value = ''
  }
}

// 移除禁用元素
function removeForbiddenElement(element: string): void {
  const list = advancedSettings.value.preferences?.forbiddenElements
  if (list) {
    const index = list.indexOf(element)
    if (index > -1) list.splice(index, 1)
  }
}

// 添加必含元素
function addRequiredElement(): void {
  const value = requiredInput.value.trim()
  if (value && !advancedSettings.value.preferences?.requiredElements?.includes(value)) {
    if (!advancedSettings.value.preferences) {
      advancedSettings.value.preferences = { forbiddenElements: [], requiredElements: [], referenceWorks: '' }
    }
    advancedSettings.value.preferences.requiredElements?.push(value)
    requiredInput.value = ''
  }
}

// 移除必含元素
function removeRequiredElement(element: string): void {
  const list = advancedSettings.value.preferences?.requiredElements
  if (list) {
    const index = list.indexOf(element)
    if (index > -1) list.splice(index, 1)
  }
}

// 应用金手指示例
function applyGoldenFingerExample(): void {
  const example = currentGoldenFingerExample.value
  if (example && advancedSettings.value.protagonist?.goldenFinger) {
    advancedSettings.value.protagonist.goldenFinger.name = example.name
    advancedSettings.value.protagonist.goldenFinger.description = example.desc
  }
}

// 方法
function nextStep(): void {
  if (currentStep.value === 0) {
    currentStep.value = 1
    // 自动开始生成
    if (!generatedContent.value) {
      generateNovelContent()
    }
  } else if (currentStep.value === 1) {
    currentStep.value = 2
  }
}

function prevStep(): void {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

async function generateNovelContent(): Promise<void> {
  if (!aiStore.hasConfig) {
    ElMessage.warning('请先在设置中配置 AI')
    return
  }

  generating.value = true
  try {
    const totalWords = wordCountInfo.value.totalWords
    const result = await fetch('/api/ai/initialize-novel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formData.value.title,
        genre: formData.value.genre,
        style: formData.value.style,
        protagonist: formData.value.protagonist,
        worldKeywords: formData.value.worldKeywords,
        coreConflict: formData.value.coreConflict,
        // 字数规划参数
        wordCountTarget: {
          min: totalWords * 0.9,
          max: totalWords * 1.1,
          total: totalWords
        },
        // 高级设置
        advancedSettings: advancedSettings.value
      })
    })

    const data = await result.json()
    if (data.success && data.data) {
      const totalOutline = data.data.totalOutline || data.data.outline || ''

      // 调用 AI 生成分卷大纲
      ElMessage.info('正在生成分卷大纲...')
      let volumes: VolumeOutline[] = []

      try {
        const volumeResults = await generateVolumeOutline({
          bookTitle: formData.value.title,
          totalOutline: totalOutline,
          targetTotalWords: totalWords,
          genre: BOOK_GENRE_MAP[formData.value.genre] || formData.value.genre,
          style: BOOK_STYLE_MAP[formData.value.style] || formData.value.style,
          configId: aiStore.defaultConfig?.id
        })

        // 转换为内部格式
        volumes = volumeResults.map(v => ({
          id: v.id,
          title: v.title,
          summary: v.summary,
          plotLine: v.plotLine || '',
          chapterCount: v.chapterCount || v.chapters.length || Math.floor(v.wordTarget / 2500),
          startChapter: v.startChapter,
          endChapter: v.endChapter,
          wordCountTarget: v.wordTarget,
          chapters: v.chapters || []
        }))
      } catch (volumeError) {
        console.error('生成分卷大纲失败，使用模拟数据:', volumeError)
        // 生成分卷失败时使用模拟数据
        volumes = generateMockVolumes(wordCountInfo.value.chaptersEstimate, totalWords)
      }

      generatedContent.value = {
        description: data.data.description || '',
        outline: data.data.outline || '',
        totalOutline: totalOutline,
        volumes: volumes,
        characters: data.data.characters || []
      }
      ElMessage.success('AI 生成完成')
    } else {
      ElMessage.error(data.message || 'AI 生成失败')
    }
  } catch (e) {
    ElMessage.error('AI 生成失败: ' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    generating.value = false
  }
}

// 生成模拟分卷数据（章节数有差异化）
function generateMockVolumes(totalChapters: number, _totalWords: number): VolumeOutline[] {
  const avgChaptersPerVolume = 100
  const volumeCount = Math.max(1, Math.ceil(totalChapters / avgChaptersPerVolume))

  const volumeNames = [
    '起源', '觉醒', '试炼', '崛起', '风云',
    '争霸', '巅峰', '沉浮', '归来', '永恒'
  ]

  // 生成差异化的章节分配
  const distribution = generateVariedChapterDistribution(totalChapters, volumeCount)

  let currentChapter = 1
  return distribution.map((chapterCount, i) => {
    const startChapter = currentChapter
    const endChapter = currentChapter + chapterCount - 1
    currentChapter = endChapter + 1

    return {
      id: `vol_${i + 1}`,
      title: `第${i + 1}卷 ${volumeNames[i] || '未命名'}`,
      summary: `第${i + 1}卷的主要剧情概要，讲述主角在该阶段的成长和挑战...`,
      plotLine: `该卷核心：${volumeNames[i] || '发展'}阶段的关键冲突`,
      chapterCount,
      startChapter,
      endChapter,
      wordCountTarget: chapterCount * 2500,
      chapters: []
    }
  })
}

// 生成差异化的章节分布
function generateVariedChapterDistribution(totalChapters: number, volumeCount: number): number[] {
  const min = 60
  const max = 150
  const result: number[] = []
  let remaining = totalChapters

  for (let i = 0; i < volumeCount; i++) {
    const isLast = i === volumeCount - 1
    if (isLast) {
      result.push(Math.min(Math.max(remaining, min), max))
    } else {
      // 使用正弦波创造中间高、两头低的分布
      const position = volumeCount > 1 ? i / (volumeCount - 1) : 0.5
      const variance = Math.sin(position * Math.PI) * 0.3
      const base = totalChapters / volumeCount
      const chapters = Math.round(base * (0.85 + variance))
      const clamped = Math.min(Math.max(chapters, min), max)
      result.push(clamped)
      remaining -= clamped
    }
  }

  return result
}

async function refineContent(): Promise<void> {
  if (!refineRequest.value.trim()) {
    ElMessage.warning('请输入修改要求')
    return
  }

  if (!generatedContent.value) {
    ElMessage.warning('请先生成内容')
    return
  }

  refining.value = true
  try {
    const result = await fetch('/api/ai/refine-novel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentContent: generatedContent.value,
        userRequest: refineRequest.value
      })
    })

    const data = await result.json()
    if (data.success && data.data) {
      generatedContent.value = {
        ...generatedContent.value,
        description: data.data.description || generatedContent.value.description,
        outline: data.data.outline || generatedContent.value.outline,
        totalOutline: data.data.totalOutline || generatedContent.value.totalOutline,
        volumes: data.data.volumes || generatedContent.value.volumes,
        characters: data.data.characters || generatedContent.value.characters
      }
      refineRequest.value = ''
      ElMessage.success('内容已修改')
    } else {
      ElMessage.error(data.message || '修改失败')
    }
  } catch (e) {
    ElMessage.error('修改失败: ' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    refining.value = false
  }
}

async function createBook(): Promise<void> {
  if (!generatedContent.value) {
    ElMessage.warning('请先生成内容')
    return
  }

  creating.value = true
  try {
    const book = await bookStore.createBook({
      title: formData.value.title,
      author: formData.value.author,
      genre: formData.value.genre,
      style: formData.value.style,
      description: generatedContent.value.description
    })

    if (book) {
      // 保存大纲和分卷大纲到书籍（包含完整的分卷信息）
      const volumeOutlines = generatedContent.value.volumes?.map(v => ({
        id: v.id,
        title: v.title,
        summary: v.summary,
        plotLine: v.plotLine,
        startChapter: v.startChapter,
        endChapter: v.endChapter,
        chapterCount: v.chapterCount,
        wordCountTarget: v.wordCountTarget,
        chapters: v.chapters.map((ch, i) => ({
          id: `${v.id}_ch_${i}`,
          title: ch.title,
          brief: ch.brief,
          chapterId: undefined  // 还没有实际章节
        }))
      }))

      console.log('准备保存分卷大纲, volumeOutlines:', volumeOutlines)
      console.log('outline:', generatedContent.value.totalOutline || generatedContent.value.outline)

      const updateResult = await bookStore.updateBook(book.id, {
        outline: generatedContent.value.totalOutline || generatedContent.value.outline,
        volumes: volumeOutlines
      })
      console.log('updateBook 返回:', updateResult)

      ElMessage.success('书籍创建成功')
      emit('created', book.id)
    } else {
      ElMessage.error('创建书籍失败')
    }
  } catch (e) {
    ElMessage.error('创建失败: ' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    creating.value = false
  }
}

function handleClose(): void {
  emit('close')
}
</script>

<template>
  <div class="create-book-wizard">
    <!-- 步骤条 -->
    <div class="wizard-steps">
      <el-steps :active="currentStep" finish-status="success" simple>
        <el-step v-for="(step, index) in steps" :key="index" :title="step" />
      </el-steps>
    </div>

    <!-- 步骤内容 -->
    <div class="wizard-content">
      <!-- 步骤1：基本信息 -->
      <div v-show="currentStep === 0" class="step-content step-basic">
        <h3 class="step-title">输入书籍基本信息</h3>
        <p class="step-desc">AI 将根据这些信息生成小说简介、大纲和角色设定</p>

        <el-form :model="formData" label-width="100px" class="basic-form">
          <el-form-item label="书名" required>
            <el-input
              v-model="formData.title"
              placeholder="请输入书名"
              maxlength="50"
              show-word-limit
            />
          </el-form-item>

          <el-form-item label="作者">
            <el-input v-model="formData.author" placeholder="请输入作者名（可选）" />
          </el-form-item>

          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="类型" required>
                <el-select v-model="formData.genre" placeholder="请选择类型">
                  <el-option
                    v-for="opt in genreOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="子分类">
                <el-select
                  v-model="formData.subGenre"
                  placeholder="请选择子分类"
                  clearable
                  :disabled="subGenreOptions.length === 0"
                >
                  <el-option
                    v-for="opt in subGenreOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="风格" required>
                <el-select v-model="formData.style" placeholder="请选择风格">
                  <el-option
                    v-for="opt in styleOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="目标字数" required>
            <div class="word-count-range-input">
              <el-input-number
                v-model="formData.targetWordCountMin"
                :min="10"
                :max="formData.targetWordCountMax - 10"
                :step="10"
                controls-position="right"
                placeholder="最小"
              />
              <span class="range-separator">-</span>
              <el-input-number
                v-model="formData.targetWordCountMax"
                :min="formData.targetWordCountMin + 10"
                :max="1000"
                :step="10"
                controls-position="right"
                placeholder="最大"
              />
              <span class="unit">万字</span>
            </div>
            <div class="word-count-hint">
              <el-icon><InfoFilled /></el-icon>
              <span>预计{{ wordCountInfo.chaptersEstimate }}章，每章约2000-3000字，AI 将按照剧情发展自动划分卷</span>
            </div>
          </el-form-item>

          <el-divider content-position="left">主角设定</el-divider>

          <!-- 主角预设选项（从高级设置移过来） -->
          <el-row :gutter="16">
            <el-col :span="6">
              <el-form-item label="性格">
                <el-select v-model="advancedSettings.protagonist!.personality" placeholder="选择性格" clearable>
                  <el-option v-for="opt in personalityOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="6">
              <el-form-item label="感情线">
                <el-select v-model="advancedSettings.protagonist!.romanceLine" placeholder="选择感情线" clearable>
                  <el-option v-for="opt in romanceOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="6" v-if="advancedSettings.protagonist?.romanceLine === 'harem'">
              <el-form-item label="女主数量">
                <el-select v-model="advancedSettings.protagonist!.haremSize" placeholder="选择数量">
                  <el-option v-for="opt in haremSizeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="advancedSettings.protagonist?.romanceLine === 'harem' ? 6 : 12">
              <el-form-item label="金手指">
                <el-select v-model="advancedSettings.protagonist!.goldenFinger!.type" placeholder="选择类型">
                  <el-option v-for="opt in goldenFingerOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                </el-select>
                <div class="golden-finger-hint" v-if="advancedSettings.protagonist?.goldenFinger?.type !== 'none'">
                  <el-icon><InfoFilled /></el-icon>
                  <span>可在下方高级设置中详细配置金手指能力</span>
                </div>
              </el-form-item>
            </el-col>
          </el-row>

          <!-- 主角详细描述（原有的输入框） -->
          <el-form-item label="主角描述">
            <el-input
              v-model="formData.protagonist"
              type="textarea"
              :rows="2"
              placeholder="简述主角的身份、性格、特点等，如：少年天才，性格沉稳，身负血海深仇"
            />
          </el-form-item>

          <el-divider content-position="left">AI 创作提示（可选）</el-divider>

          <el-form-item label="世界观关键词">
            <el-input
              v-model="formData.worldKeywords"
              placeholder="如：修仙、宗门、灵气复苏、等级制度"
            />
          </el-form-item>

          <el-form-item label="核心冲突">
            <el-input
              v-model="formData.coreConflict"
              type="textarea"
              :rows="2"
              placeholder="故事的主要矛盾或冲突，如：主角为报家仇，踏上修仙之路"
            />
          </el-form-item>
        </el-form>

        <!-- 高级设置折叠面板 -->
        <div class="advanced-settings-section">
          <div class="advanced-toggle" @click="showAdvancedSettings = !showAdvancedSettings">
            <el-icon><Setting /></el-icon>
            <span>高级设置（可选）</span>
            <el-icon class="arrow-icon">
              <ArrowDown v-if="!showAdvancedSettings" />
              <ArrowUp v-else />
            </el-icon>
          </div>

          <el-collapse-transition>
            <div v-show="showAdvancedSettings" class="advanced-settings-content">
              <el-collapse v-model="activeSettingPanels" accordion>
                <!-- 叙事设定 -->
                <el-collapse-item title="叙事设定" name="narrative">
                  <template #title>
                    <div class="panel-title">
                      <el-icon><Edit /></el-icon>
                      <span>叙事设定</span>
                    </div>
                  </template>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="视角">
                        <el-select v-model="advancedSettings.narrative!.perspective" placeholder="选择视角" clearable>
                          <el-option v-for="opt in perspectiveOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="时态">
                        <el-select v-model="advancedSettings.narrative!.tense" placeholder="选择时态" clearable>
                          <el-option v-for="opt in tenseOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-collapse-item>

                <!-- 世界观设定 -->
                <el-collapse-item title="世界观设定" name="worldBuilding">
                  <template #title>
                    <div class="panel-title">
                      <el-icon><Compass /></el-icon>
                      <span>世界观设定</span>
                    </div>
                  </template>
                  <el-row :gutter="16">
                    <el-col :span="8">
                      <el-form-item label="时代背景">
                        <el-select v-model="advancedSettings.worldBuilding!.era" placeholder="选择时代" clearable>
                          <el-option v-for="opt in eraOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="8">
                      <el-form-item label="力量体系">
                        <el-select v-model="advancedSettings.worldBuilding!.powerSystem" placeholder="选择体系" clearable>
                          <el-option v-for="opt in powerSystemOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="8">
                      <el-form-item label="科技水平">
                        <el-select v-model="advancedSettings.worldBuilding!.techLevel" placeholder="选择科技" clearable>
                          <el-option v-for="opt in techLevelOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-form-item v-if="advancedSettings.worldBuilding?.powerSystem === 'custom'" label="自定义体系">
                    <el-input
                      v-model="advancedSettings.worldBuilding!.powerSystemCustom"
                      type="textarea"
                      :rows="2"
                      placeholder="描述你的力量体系，如：九品中正制，一品最高..."
                    />
                  </el-form-item>
                </el-collapse-item>

                <!-- 金手指详细设定 -->
                <el-collapse-item title="金手指详细设定" name="protagonist">
                  <template #title>
                    <div class="panel-title">
                      <el-icon><Star /></el-icon>
                      <span>金手指详细设定</span>
                    </div>
                  </template>

                  <!-- 金手指示例提示 -->
                  <div v-if="currentGoldenFingerExample && advancedSettings.protagonist?.goldenFinger?.type !== 'none'" class="golden-finger-example">
                    <div class="example-header">
                      <span class="example-label">示例参考：</span>
                      <el-button type="primary" link size="small" @click="applyGoldenFingerExample">
                        <el-icon><CopyDocument /></el-icon>
                        应用示例
                      </el-button>
                    </div>
                    <div class="example-content">
                      <span class="example-name">{{ currentGoldenFingerExample.name }}</span>
                      <span class="example-desc">{{ currentGoldenFingerExample.desc }}</span>
                    </div>
                  </div>

                  <!-- 金手指详细设定 -->
                  <template v-if="advancedSettings.protagonist?.goldenFinger?.type !== 'none'">
                    <el-form-item label="名称">
                      <el-input
                        v-model="advancedSettings.protagonist!.goldenFinger!.name"
                        placeholder="如：掌天瓶、鸿蒙系统、上古传承..."
                      />
                    </el-form-item>
                    <el-form-item label="功能描述">
                      <el-input
                        v-model="advancedSettings.protagonist!.goldenFinger!.description"
                        type="textarea"
                        :rows="3"
                        placeholder="详细描述金手指的功能，如：缓慢吸收灵气产生灵液，加速灵药生长，间接帮助修炼..."
                      />
                    </el-form-item>
                    <el-row :gutter="16">
                      <el-col :span="12">
                        <el-form-item label="限制条件">
                          <el-input
                            v-model="advancedSettings.protagonist!.goldenFinger!.limitation"
                            type="textarea"
                            :rows="2"
                            placeholder="如：每日只能使用一次、需要消耗精血..."
                          />
                        </el-form-item>
                      </el-col>
                      <el-col :span="12">
                        <el-form-item label="成长路线">
                          <el-input
                            v-model="advancedSettings.protagonist!.goldenFinger!.growthPath"
                            type="textarea"
                            :rows="2"
                            placeholder="如：随修为提升解锁新功能..."
                          />
                        </el-form-item>
                      </el-col>
                    </el-row>
                  </template>

                  <div v-else class="no-golden-finger-tip">
                    <el-icon><InfoFilled /></el-icon>
                    <span>当前选择"无金手指"，如需设定金手指详情，请在上方主角设定中选择金手指类型</span>
                  </div>
                </el-collapse-item>

                <!-- 剧情偏好 -->
                <el-collapse-item title="剧情偏好" name="plot">
                  <template #title>
                    <div class="panel-title">
                      <el-icon><TrendCharts /></el-icon>
                      <span>剧情偏好</span>
                    </div>
                  </template>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="节奏">
                        <el-select v-model="advancedSettings.plot!.pacing" placeholder="选择节奏" clearable>
                          <el-option v-for="opt in pacingOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="爽点密度">
                        <el-select v-model="advancedSettings.plot!.conflictDensity" placeholder="选择密度" clearable>
                          <el-option v-for="opt in conflictOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="虐点程度">
                        <el-select v-model="advancedSettings.plot!.angstLevel" placeholder="选择虐度" clearable>
                          <el-option v-for="opt in angstOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="结局倾向">
                        <el-select v-model="advancedSettings.plot!.ending" placeholder="选择结局" clearable>
                          <el-option v-for="opt in endingOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-collapse-item>

                <!-- 写作风格 -->
                <el-collapse-item title="写作风格" name="writing">
                  <template #title>
                    <div class="panel-title">
                      <el-icon><EditPen /></el-icon>
                      <span>写作风格</span>
                    </div>
                  </template>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="文笔风格">
                        <el-select v-model="advancedSettings.writing!.style" placeholder="选择风格" clearable>
                          <el-option v-for="opt in writingStyleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="对话比例">
                        <el-select v-model="advancedSettings.writing!.dialogueRatio" placeholder="选择比例" clearable>
                          <el-option v-for="opt in dialogueOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item label="心理描写">
                        <el-select v-model="advancedSettings.writing!.psychologyDescription" placeholder="选择程度" clearable>
                          <el-option v-for="opt in descriptionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item label="环境描写">
                        <el-select v-model="advancedSettings.writing!.environmentDescription" placeholder="选择程度" clearable>
                          <el-option v-for="opt in descriptionOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-collapse-item>

                <!-- 禁忌/偏好设置 -->
                <el-collapse-item title="禁忌/偏好" name="preferences">
                  <template #title>
                    <div class="panel-title">
                      <el-icon><Warning /></el-icon>
                      <span>禁忌/偏好</span>
                    </div>
                  </template>
                  <el-form-item label="禁用元素">
                    <div class="tag-input-wrapper">
                      <div class="tags-display">
                        <el-tag
                          v-for="element in advancedSettings.preferences?.forbiddenElements"
                          :key="element"
                          closable
                          type="danger"
                          @close="removeForbiddenElement(element)"
                        >
                          {{ element }}
                        </el-tag>
                      </div>
                      <div class="tag-input">
                        <el-input
                          v-model="forbiddenInput"
                          placeholder="输入禁用元素，如：党争、血腥..."
                          size="small"
                          @keyup.enter="addForbiddenElement"
                        />
                        <el-button size="small" @click="addForbiddenElement">添加</el-button>
                      </div>
                    </div>
                  </el-form-item>
                  <el-form-item label="必含元素">
                    <div class="tag-input-wrapper">
                      <div class="tags-display">
                        <el-tag
                          v-for="element in advancedSettings.preferences?.requiredElements"
                          :key="element"
                          closable
                          type="success"
                          @close="removeRequiredElement(element)"
                        >
                          {{ element }}
                        </el-tag>
                      </div>
                      <div class="tag-input">
                        <el-input
                          v-model="requiredInput"
                          placeholder="输入必含元素，如：宠物、师徒..."
                          size="small"
                          @keyup.enter="addRequiredElement"
                        />
                        <el-button size="small" @click="addRequiredElement">添加</el-button>
                      </div>
                    </div>
                  </el-form-item>
                  <el-form-item label="参考作品">
                    <el-input
                      v-model="advancedSettings.preferences!.referenceWorks"
                      placeholder="如：凡人修仙传、斗破苍穹..."
                    />
                  </el-form-item>
                </el-collapse-item>
              </el-collapse>
            </div>
          </el-collapse-transition>
        </div>
      </div>

      <!-- 步骤2：AI 生成 -->
      <div v-show="currentStep === 1" class="step-content step-generate">
        <div v-if="generating" class="generating-state">
          <el-icon class="is-loading generating-icon"><Loading /></el-icon>
          <h3>AI 正在创作中...</h3>
          <p>正在根据您的设定生成小说简介、大纲和角色</p>
        </div>

        <div v-else-if="generatedContent" class="generated-content">
          <h3 class="step-title">AI 生成结果</h3>

          <!-- 书名推荐 -->
          <div class="content-section title-suggestions" v-if="generatedContent.suggestedTitles && generatedContent.suggestedTitles.length > 0">
            <h4>
              <el-icon><EditPen /></el-icon>
              推荐书名
            </h4>
            <div class="title-suggestions-list">
              <el-tag
                v-for="(title, index) in generatedContent.suggestedTitles"
                :key="index"
                :type="formData.title === title ? 'primary' : 'info'"
                size="large"
                class="title-suggestion-tag"
                @click="formData.title = title"
              >
                {{ title }}
              </el-tag>
            </div>
            <div class="current-title">
              <span class="label">当前书名：</span>
              <el-input v-model="formData.title" placeholder="点击上方推荐或自行修改" style="width: 300px;" />
            </div>
          </div>

          <!-- 简介 -->
          <div class="content-section">
            <h4>
              <el-icon><Document /></el-icon>
              小说简介
            </h4>
            <div class="content-text">{{ generatedContent.description }}</div>
          </div>

          <!-- 总大纲 -->
          <div class="content-section">
            <h4>
              <el-icon><Notebook /></el-icon>
              总大纲
            </h4>
            <div class="content-text outline-text">{{ generatedContent.totalOutline || generatedContent.outline }}</div>
          </div>

          <!-- 分卷大纲 -->
          <div class="content-section" v-if="generatedContent.volumes && generatedContent.volumes.length > 0">
            <h4>
              <el-icon><FolderOpened /></el-icon>
              分卷大纲 ({{ generatedContent.volumes.length }} 卷，共 {{ generatedContent.volumes.reduce((sum, v) => sum + v.chapterCount, 0) }} 章)
            </h4>
            <div class="volumes-list">
              <el-collapse>
                <el-collapse-item
                  v-for="volume in generatedContent.volumes"
                  :key="volume.id"
                  :name="volume.id"
                >
                  <template #title>
                    <div class="volume-title">
                      <span class="volume-name">{{ volume.title }}</span>
                      <el-tag size="small" type="info">
                        第{{ volume.startChapter }}-{{ volume.endChapter }}章 · {{ volume.chapterCount }}章 · {{ Math.floor(volume.wordCountTarget / 10000) }}万字
                      </el-tag>
                    </div>
                  </template>
                  <div class="volume-detail">
                    <div class="volume-plot-line" v-if="volume.plotLine">
                      <strong>核心剧情：</strong>{{ volume.plotLine }}
                    </div>
                    <div class="volume-summary">{{ volume.summary }}</div>
                    <div class="volume-chapters" v-if="volume.chapters && volume.chapters.length > 0">
                      <div class="chapters-title">关键章节：</div>
                      <div class="chapter-item" v-for="(chapter, ci) in volume.chapters" :key="ci">
                        <span class="chapter-title">{{ chapter.title }}</span>
                        <span class="chapter-brief">{{ chapter.brief }}</span>
                      </div>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </div>
          </div>

          <!-- 角色 -->
          <div class="content-section">
            <h4>
              <el-icon><User /></el-icon>
              主要角色
            </h4>
            <div class="characters-list">
              <div
                v-for="(char, index) in generatedContent.characters"
                :key="index"
                class="character-card"
              >
                <div class="char-header">
                  <span class="char-name">{{ char.name }}</span>
                  <div class="char-tags">
                    <el-tag
                      :type="char.role === 'protagonist' ? 'primary' : char.role === 'antagonist' ? 'danger' : 'info'"
                      size="small"
                    >
                      {{ roleTypeMap[char.role] || char.role }}
                    </el-tag>
                    <el-tag
                      v-for="tag in (char.tags || [])"
                      :key="tag"
                      size="small"
                      type="warning"
                    >
                      {{ tag }}
                    </el-tag>
                  </div>
                </div>
                <p class="char-desc">{{ char.description }}</p>
              </div>
            </div>
          </div>

          <!-- 预设展示 -->
          <div class="preset-display">
            <span class="preset-label">预设：</span>
            <el-tag size="small" type="primary">{{ BOOK_GENRE_MAP[formData.genre] }}</el-tag>
            <el-tag v-if="formData.subGenre" size="small" type="primary">{{ BOOK_SUB_GENRE_MAP[formData.subGenre as BookSubGenre] }}</el-tag>
            <el-tag size="small" type="success">{{ BOOK_STYLE_MAP[formData.style] }}</el-tag>
            <el-tag v-if="advancedSettings.protagonist?.romanceLine" size="small" type="warning">{{ ROMANCE_LINE_MAP[advancedSettings.protagonist.romanceLine] }}</el-tag>
            <el-tag v-if="advancedSettings.protagonist?.goldenFinger?.type && advancedSettings.protagonist.goldenFinger.type !== 'none'" size="small" type="danger">{{ GOLDEN_FINGER_TYPE_MAP[advancedSettings.protagonist.goldenFinger.type] }}</el-tag>
          </div>

          <!-- 修改区域 -->
          <div class="refine-section">
            <h4>
              <el-icon><Edit /></el-icon>
              修改内容
            </h4>
            <div class="refine-input">
              <el-input
                v-model="refineRequest"
                type="textarea"
                :rows="2"
                placeholder="输入修改要求，如：让主角的性格更阴沉一些、增加一个女主角、修改大纲的结局"
              />
              <el-button
                type="primary"
                :loading="refining"
                :disabled="!refineRequest.trim()"
                @click="refineContent"
              >
                <el-icon><MagicStick /></el-icon>
                AI 修改
              </el-button>
            </div>
          </div>

          <!-- 重新生成 -->
          <div class="regenerate-section">
            <el-button @click="generateNovelContent" :loading="generating">
              <el-icon><Refresh /></el-icon>
              重新生成
            </el-button>
          </div>
        </div>

        <div v-else class="empty-state">
          <el-button type="primary" size="large" @click="generateNovelContent" :loading="generating">
            <el-icon><MagicStick /></el-icon>
            开始 AI 生成
          </el-button>
        </div>
      </div>

      <!-- 步骤3：预览确认 -->
      <div v-show="currentStep === 2" class="step-content step-preview">
        <h3 class="step-title">确认创建</h3>
        <p class="step-desc">请确认以下信息，点击创建完成书籍创建</p>

        <div class="preview-card">
          <div class="preview-header">
            <h2>{{ formData.title }}</h2>
            <div class="preview-tags">
              <el-tag type="info">{{ BOOK_GENRE_MAP[formData.genre] }}</el-tag>
              <el-tag type="info">{{ BOOK_STYLE_MAP[formData.style] }}</el-tag>
            </div>
          </div>

          <div class="preview-section">
            <h4>简介</h4>
            <p>{{ generatedContent?.description }}</p>
          </div>

          <div class="preview-section">
            <h4>大纲</h4>
            <p class="outline-preview">{{ generatedContent?.outline }}</p>
          </div>

          <div class="preview-section">
            <h4>角色 ({{ generatedContent?.characters?.length || 0 }})</h4>
            <div class="preview-characters">
              <el-tag
                v-for="(char, index) in generatedContent?.characters"
                :key="index"
                :type="char.role === 'protagonist' ? 'primary' : char.role === 'antagonist' ? 'danger' : 'info'"
              >
                {{ char.name }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部按钮 -->
    <div class="wizard-footer">
      <el-button @click="handleClose">取消</el-button>
      <div class="footer-right">
        <el-button v-if="canGoBack" @click="prevStep">
          <el-icon><ArrowLeft /></el-icon>
          上一步
        </el-button>
        <el-button
          v-if="currentStep < 2"
          type="primary"
          :disabled="!canGoNext"
          @click="nextStep"
        >
          下一步
          <el-icon><ArrowRight /></el-icon>
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="creating"
          @click="createBook"
        >
          <el-icon><Check /></el-icon>
          创建书籍
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.create-book-wizard {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 80vh;
}

.wizard-steps {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color, $border-light);
}

.wizard-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.step-content {
  min-height: 400px;
}

.step-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, $text-primary);
  margin-bottom: 8px;
}

.step-desc {
  font-size: 14px;
  color: var(--text-secondary, $text-secondary);
  margin-bottom: 24px;
}

// 步骤1样式
.basic-form {
  max-width: 600px;

  .el-select {
    width: 100%;
  }
}

.word-count-input {
  display: flex;
  align-items: center;
  gap: 8px;

  .el-input-number {
    width: 150px;
  }

  .unit {
    font-size: 14px;
    color: var(--text-primary, $text-primary);
  }
}

.word-count-range-input {
  display: flex;
  align-items: center;
  gap: 8px;

  .el-input-number {
    width: 130px;
  }

  .range-separator {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-secondary, $text-secondary);
  }

  .unit {
    font-size: 14px;
    color: var(--text-primary, $text-primary);
    margin-left: 4px;
  }
}

.word-count-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary, $text-secondary);

  .el-icon {
    font-size: 14px;
    color: $primary-color;
  }
}

.no-golden-finger-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background-color: var(--bg-light, $bg-page);
  border-radius: $border-radius-base;
  font-size: 13px;
  color: var(--text-secondary, $text-secondary);

  .el-icon {
    font-size: 16px;
    color: var(--text-placeholder, $text-placeholder);
  }
}

.golden-finger-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary, $text-secondary);

  .el-icon {
    font-size: 14px;
    color: $primary-color;
  }
}

// 高级设置样式
.advanced-settings-section {
  margin-top: 24px;
  border: 1px solid var(--border-color, $border-light);
  border-radius: $border-radius-base;
  overflow: hidden;

  .advanced-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background-color: var(--bg-light, $bg-page);
    cursor: pointer;
    user-select: none;
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--el-fill-color-light);
    }

    span {
      flex: 1;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
    }

    .arrow-icon {
      transition: transform 0.3s;
    }
  }

  .advanced-settings-content {
    padding: 16px;
    border-top: 1px solid var(--border-color, $border-light);

    :deep(.el-collapse) {
      border: none;

      .el-collapse-item__header {
        padding: 0 12px;
        height: 44px;
        background-color: var(--bg-light, $bg-page);
        border-radius: $border-radius-base;
        margin-bottom: 8px;
        border: none;
      }

      .el-collapse-item__wrap {
        border: none;
      }

      .el-collapse-item__content {
        padding: 12px 0;
      }
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }

    .el-form-item {
      margin-bottom: 12px;

      :deep(.el-form-item__label) {
        font-size: 13px;
      }
    }

    .el-select {
      width: 100%;
    }
  }
}

// 金手指设定样式
.golden-finger-section {
  margin-top: 16px;
  padding: 16px;
  background-color: var(--bg-light, $bg-page);
  border-radius: $border-radius-base;

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, $text-primary);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px dashed var(--border-color, $border-light);
  }

  .golden-finger-example {
    margin: 12px 0;
    padding: 12px;
    background-color: rgba($primary-color, 0.08);
    border-radius: $border-radius-base;
    border-left: 3px solid $primary-color;

    .example-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;

      .example-label {
        font-size: 12px;
        color: var(--text-secondary, $text-secondary);
      }
    }

    .example-content {
      display: flex;
      flex-direction: column;
      gap: 4px;

      .example-name {
        font-weight: 600;
        color: $primary-color;
      }

      .example-desc {
        font-size: 13px;
        color: var(--text-secondary, $text-secondary);
        line-height: 1.6;
      }
    }
  }
}

// 禁忌/偏好标签输入样式
.tag-input-wrapper {
  .tags-display {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
    min-height: 24px;
  }

  .tag-input {
    display: flex;
    gap: 8px;

    .el-input {
      flex: 1;
    }
  }
}

// 步骤2样式
.generating-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  text-align: center;

  .generating-icon {
    font-size: 48px;
    color: $primary-color;
    margin-bottom: 16px;
  }

  h3 {
    font-size: 18px;
    color: var(--text-primary, $text-primary);
    margin-bottom: 8px;
  }

  p {
    color: var(--text-secondary, $text-secondary);
  }
}

.generated-content {
  .content-section {
    margin-bottom: 24px;

    &.title-suggestions {
      padding: 16px;
      background-color: rgba($primary-color, 0.05);
      border-radius: $border-radius-base;
      border: 1px dashed rgba($primary-color, 0.3);

      .title-suggestions-list {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 16px;

        .title-suggestion-tag {
          cursor: pointer;
          transition: all 0.2s;
          font-size: 14px;
          padding: 8px 16px;

          &:hover {
            transform: scale(1.02);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }
        }
      }

      .current-title {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-color, $border-light);

        .label {
          font-size: 13px;
          color: var(--text-secondary, $text-secondary);
          white-space: nowrap;
        }
      }
    }

    h4 {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary, $text-primary);
      margin-bottom: 12px;
    }

    .content-text {
      padding: 16px;
      background-color: var(--bg-light, $bg-page);
      border-radius: $border-radius-base;
      line-height: 1.8;
      white-space: pre-wrap;
    }

    .outline-text {
      max-height: 200px;
      overflow-y: auto;
    }

    // 分卷大纲样式
    .volumes-list {
      :deep(.el-collapse) {
        border: none;
        background: transparent;
      }

      :deep(.el-collapse-item__header) {
        background-color: var(--bg-light, $bg-page);
        border-radius: $border-radius-base;
        padding: 0 16px;
        margin-bottom: 8px;
        border: none;
        height: 48px;
      }

      :deep(.el-collapse-item__wrap) {
        border: none;
        background: transparent;
      }

      :deep(.el-collapse-item__content) {
        padding: 0 16px 16px 16px;
      }

      .volume-title {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;

        .volume-name {
          font-weight: 500;
          color: var(--text-primary, $text-primary);
        }
      }

      .volume-summary {
        font-size: 13px;
        color: var(--text-secondary, $text-secondary);
        line-height: 1.8;
        padding: 12px 16px;
        background-color: var(--bg-light, $bg-page);
        border-radius: $border-radius-base;
      }

      .volume-detail {
        padding: 0;

        .volume-plot-line {
          font-size: 14px;
          color: var(--text-primary, $text-primary);
          padding: 12px 16px;
          background-color: rgba($primary-color, 0.08);
          border-radius: $border-radius-base;
          margin-bottom: 12px;

          strong {
            color: $primary-color;
          }
        }

        .volume-chapters {
          margin-top: 12px;
          padding: 12px 16px;
          background-color: var(--bg-light, $bg-page);
          border-radius: $border-radius-base;

          .chapters-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--text-secondary, $text-secondary);
            margin-bottom: 8px;
          }

          .chapter-item {
            display: flex;
            gap: 8px;
            padding: 6px 0;
            border-bottom: 1px dashed var(--border-color, $border-light);

            &:last-child {
              border-bottom: none;
            }

            .chapter-title {
              font-weight: 500;
              color: var(--text-primary, $text-primary);
              flex-shrink: 0;
            }

            .chapter-brief {
              font-size: 12px;
              color: var(--text-secondary, $text-secondary);
            }
          }
        }
      }
    }
  }

  .characters-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .character-card {
    padding: 16px;
    background-color: var(--bg-light, $bg-page);
    border-radius: $border-radius-base;

    .char-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;

      .char-name {
        font-weight: 600;
        font-size: 15px;
      }

      .char-tags {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
    }

    .char-desc {
      font-size: 13px;
      color: var(--text-secondary, $text-secondary);
      line-height: 1.6;
    }
  }

  .preset-display {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 24px;
    padding: 12px 16px;
    background: var(--el-fill-color-lighter, #f5f7fa);
    border-radius: 8px;

    .preset-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary, #666);
    }

    .el-tag {
      border-radius: 12px;
    }
  }

  .refine-section {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px dashed var(--border-color, $border-light);

    h4 {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary, $text-primary);
      margin-bottom: 12px;
    }

    .refine-input {
      display: flex;
      gap: 12px;
      align-items: flex-start;

      .el-input {
        flex: 1;
      }

      .el-button {
        flex-shrink: 0;
      }
    }
  }

  .regenerate-section {
    margin-top: 16px;
    text-align: center;
  }
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

// 步骤3样式
.preview-card {
  background-color: var(--bg-light, $bg-page);
  border-radius: $border-radius-card;
  padding: 24px;

  .preview-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color, $border-light);

    h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .preview-tags {
      display: flex;
      gap: 8px;
    }
  }

  .preview-section {
    margin-bottom: 20px;

    h4 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary, $text-secondary);
      margin-bottom: 8px;
    }

    p {
      line-height: 1.8;
      color: var(--text-primary, $text-primary);
    }

    .outline-preview {
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
    }

    .preview-characters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  }
}

.wizard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, $border-light);

  .footer-right {
    display: flex;
    gap: 12px;
  }
}

// 深色主题适配
:global(html.dark) {
  .create-book-wizard {
    --bg-light: #{$dark-bg-panel};
    --text-primary: #{$dark-text-primary};
    --text-secondary: #{$dark-text-secondary};
    --border-color: #{$dark-border-light};
  }
}
</style>
