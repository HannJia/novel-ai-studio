<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAiStore, useBookStore } from '@/stores'
import { ElMessage } from 'element-plus'
import type { BookGenre, BookStyle, NovelInitResult, GeneratedCharacter } from '@/types'
import { BOOK_GENRE_MAP, BOOK_STYLE_MAP } from '@/types'

const emit = defineEmits<{
  close: []
  created: [bookId: string]
}>()

const aiStore = useAiStore()
const bookStore = useBookStore()

// 步骤状态
const currentStep = ref(0)
const steps = ['基本信息', 'AI 生成', '预览确认']

// 字数区间选项
const wordCountRanges = [
  { value: '30-50', label: '30-50万字', min: 300000, max: 500000, volumes: 2 },
  { value: '50-80', label: '50-80万字', min: 500000, max: 800000, volumes: 3 },
  { value: '80-120', label: '80-120万字', min: 800000, max: 1200000, volumes: 4 },
  { value: '120-200', label: '120-200万字', min: 1200000, max: 2000000, volumes: 5 },
  { value: '200-300', label: '200-300万字', min: 2000000, max: 3000000, volumes: 7 },
  { value: '300+', label: '300万字以上', min: 3000000, max: 5000000, volumes: 10 },
]

// 表单数据
const formData = ref({
  title: '',
  author: '',
  genre: 'xuanhuan' as BookGenre,
  style: 'qingsong' as BookStyle,
  wordCountRange: '50-80', // 默认50-80万字
  protagonist: '',
  worldKeywords: '',
  coreConflict: ''
})

// AI 生成的内容（扩展结构）
interface VolumeOutline {
  id: string
  title: string
  summary: string
  chapterCount: number
  wordCountTarget: number
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
      // 生成模拟的分卷大纲（实际应该由 AI 返回）
      const volumes = generateMockVolumes(wordRange.volumes, wordRange.min, wordRange.max)

      generatedContent.value = {
        description: data.data.description || '',
        outline: data.data.outline || '',
        totalOutline: data.data.totalOutline || data.data.outline || '',
        volumes: data.data.volumes || volumes,
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

// 生成模拟分卷数据（实际应由 AI 生成）
function generateMockVolumes(volumeCount: number, minWords: number, maxWords: number): VolumeOutline[] {
  const avgWords = Math.floor((minWords + maxWords) / 2 / volumeCount)
  const volumeNames = [
    '起源', '觉醒', '试炼', '崛起', '风云',
    '争霸', '巅峰', '沉浮', '归来', '永恒'
  ]

  return Array.from({ length: volumeCount }, (_, i) => ({
    id: `vol_${i + 1}`,
    title: `第${i + 1}卷 ${volumeNames[i] || '未命名'}`,
    summary: `第${i + 1}卷的主要剧情概要...`,
    chapterCount: Math.floor(avgWords / 3000), // 假设每章3000字
    wordCountTarget: avgWords
  }))
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
      // 保存大纲到书籍
      await bookStore.updateBook(book.id, {
        outline: generatedContent.value.outline
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
              <span>AI 将根据字数目标生成 {{ selectedWordRange.volumes }} 卷大纲，每卷约 {{ Math.floor(selectedWordRange.max / selectedWordRange.volumes / 10000) }} 万字</span>
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
              分卷大纲 ({{ generatedContent.volumes.length }} 卷)
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
                        约 {{ Math.floor(volume.wordCountTarget / 10000) }} 万字 / {{ volume.chapterCount }} 章
                      </el-tag>
                    </div>
                  </template>
                  <div class="volume-summary">{{ volume.summary }}</div>
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
      background-color: var(--bg-light, $light-bg-panel);
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
        background-color: var(--bg-light, $light-bg-panel);
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
        background-color: var(--bg-light, $light-bg-panel);
        border-radius: $border-radius-base;
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
    background-color: var(--bg-light, $light-bg-panel);
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
  background-color: var(--bg-light, $light-bg-panel);
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
