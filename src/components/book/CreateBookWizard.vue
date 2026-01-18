<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAiStore, useBookStore } from '@/stores'
import { ElMessage } from 'element-plus'
import type { BookGenre, BookStyle, NovelInitResult, GeneratedCharacter } from '@/types'
import { BOOK_GENRE_MAP, BOOK_STYLE_MAP } from '@/types'
import { generateVolumeOutline, type VolumeOutlineResult } from '@/services/api/aiApi'

const emit = defineEmits<{
  close: []
  created: [bookId: string]
}>()

const aiStore = useAiStore()
const bookStore = useBookStore()

// 步骤状态
const currentStep = ref(0)
const steps = ['基本信息', 'AI 生成', '预览确认']

// 字数区间选项（每卷100-120章，每章约3000字，即每卷30-36万字）
const wordCountRanges = [
  { value: '30-36', label: '30-36万字（1卷）', min: 300000, max: 360000, chapters: 110 },
  { value: '60-72', label: '60-72万字（2卷）', min: 600000, max: 720000, chapters: 220 },
  { value: '90-108', label: '90-108万字（3卷）', min: 900000, max: 1080000, chapters: 330 },
  { value: '120-144', label: '120-144万字（4卷）', min: 1200000, max: 1440000, chapters: 440 },
  { value: '150-180', label: '150-180万字（5卷）', min: 1500000, max: 1800000, chapters: 550 },
  { value: '180-216', label: '180-216万字（6卷）', min: 1800000, max: 2160000, chapters: 660 },
  { value: '210-252', label: '210-252万字（7卷）', min: 2100000, max: 2520000, chapters: 770 },
  { value: '240-288', label: '240-288万字（8卷）', min: 2400000, max: 2880000, chapters: 880 },
  { value: '300+', label: '300万字以上（10卷）', min: 3000000, max: 3600000, chapters: 1100 },
]

// 表单数据
const formData = ref({
  title: '',
  author: '',
  genre: 'xuanhuan' as BookGenre,
  style: 'qingsong' as BookStyle,
  wordCountRange: '90-108', // 默认90-108万字（3卷）
  protagonist: '',
  worldKeywords: '',
  coreConflict: ''
})

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
}

const generatedContent = ref<ExtendedNovelResult | null>(null)

// 加载状态
const generating = ref(false)
const creating = ref(false)

// 修改请求
const refineRequest = ref('')
const refining = ref(false)

// 选项映射
const genreOptions = Object.entries(BOOK_GENRE_MAP).map(([value, label]) => ({
  value,
  label
}))

const styleOptions = Object.entries(BOOK_STYLE_MAP).map(([value, label]) => ({
  value,
  label
}))

// 计算当前选中的字数区间信息
const selectedWordRange = computed(() => {
  return wordCountRanges.find(r => r.value === formData.value.wordCountRange) || wordCountRanges[1]
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
    const wordRange = selectedWordRange.value
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
          min: wordRange.min,
          max: wordRange.max,
          volumes: wordRange.volumes
        }
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
          targetTotalWords: wordRange.max,
          genre: BOOK_GENRE_MAP[formData.value.genre] || formData.value.genre,
          style: BOOK_STYLE_MAP[formData.value.style] || formData.value.style
        })

        // 转换为内部格式
        volumes = volumeResults.map(v => ({
          id: v.id,
          title: v.title,
          summary: v.summary,
          plotLine: v.plotLine || '',
          chapterCount: v.chapterCount || v.chapters.length || Math.floor(v.wordTarget / 3000),
          startChapter: v.startChapter,
          endChapter: v.endChapter,
          wordCountTarget: v.wordTarget,
          chapters: v.chapters || []
        }))
      } catch (volumeError) {
        console.error('生成分卷大纲失败，使用模拟数据:', volumeError)
        // 生成分卷失败时使用模拟数据
        volumes = generateMockVolumes(wordRange.chapters, wordRange.min, wordRange.max)
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
function generateMockVolumes(totalChapters: number, minWords: number, maxWords: number): VolumeOutline[] {
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
      wordCountTarget: chapterCount * 3000,
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
      // 保存大纲和分卷大纲到书籍
      const volumeOutlines = generatedContent.value.volumes?.map(v => ({
        id: v.id,
        title: v.title,
        summary: v.summary,
        chapters: v.chapters.map((ch, i) => ({
          id: `${v.id}_ch_${i}`,
          title: ch.title,
          chapterId: undefined  // 还没有实际章节
        }))
      }))

      await bookStore.updateBook(book.id, {
        outline: generatedContent.value.totalOutline || generatedContent.value.outline,
        volumes: volumeOutlines
      })

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
            <el-col :span="12">
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
            <el-col :span="12">
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
            <el-select v-model="formData.wordCountRange" placeholder="请选择目标字数">
              <el-option
                v-for="opt in wordCountRanges"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <div class="word-count-hint">
              <el-icon><InfoFilled /></el-icon>
              <span>每卷约100-120章，每章约3000字，AI 将按剧情发展自动划分卷次</span>
            </div>
          </el-form-item>

          <el-divider content-position="left">AI 创作提示（可选）</el-divider>

          <el-form-item label="主角设定">
            <el-input
              v-model="formData.protagonist"
              type="textarea"
              :rows="2"
              placeholder="简述主角的身份、性格、特点等，如：少年天才，性格沉稳，身负血海深仇"
            />
          </el-form-item>

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
                  v-for="(volume, index) in generatedContent.volumes"
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
                  <el-tag
                    :type="char.role === 'protagonist' ? 'primary' : char.role === 'antagonist' ? 'danger' : 'info'"
                    size="small"
                  >
                    {{ roleTypeMap[char.role] || char.role }}
                  </el-tag>
                </div>
                <p class="char-desc">{{ char.description }}</p>
              </div>
            </div>
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
    }

    .char-desc {
      font-size: 13px;
      color: var(--text-secondary, $text-secondary);
      line-height: 1.6;
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
