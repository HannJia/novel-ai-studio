<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChapterStore, useUiStore, useBookStore, useAiStore } from '@/stores'
import { DETAIL_OUTLINE_STEPS } from '@/types/chapter'
import type { ChapterDetailOutline, VolumeOutlineChapter } from '@/types'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const chapterStore = useChapterStore()
const uiStore = useUiStore()
const bookStore = useBookStore()
const aiStore = useAiStore()

const emit = defineEmits<{
  selectChapter: [id: string]
  createChapter: []
  deleteChapter: [id: string, title: string, event: Event]
}>()

// 本地状态
const searchQuery = ref('')
const activeTab = ref<'chapters' | 'outline' | 'detail'>('chapters')

// 当前选中的大纲项索引
const selectedOutlineIndex = ref<number | null>(null)

// 是否显示总大纲
const showTotalOutline = ref(false)

// 细纲相关状态
const detailOutlineMode = ref<'view' | 'generate' | 'edit'>('view')  // 查看/生成/编辑模式
const selectedChapterForDetail = ref<string | null>(null)  // 选中查看细纲的章节
const isGeneratingOutline = ref(false)  // 是否正在生成细纲
const isGeneratingChapter = ref(false)  // 是否正在生成章节内容
const editingOutline = ref<ChapterDetailOutline | null>(null)  // 正在编辑的细纲
const expandedSteps = ref<string[]>([])  // 展开的步骤列表

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

  // 如果书籍有分卷大纲数据，直接使用
  if (book?.volumes && book.volumes.length > 0) {
    return book.volumes.map((vol: any, vIndex: number) => ({
      id: vol.id || `vol_${vIndex + 1}`,
      title: vol.title,
      summary: vol.summary || '',
      chapters: vol.chapters || chapters.slice(vIndex * 10, (vIndex + 1) * 10).map((ch, i) => ({
        id: `ch_${vIndex}_${i}`,
        title: ch.title,
        chapterId: ch.id
      }))
    }))
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

// 当前分卷大纲（根据当前章节所在分卷）
const currentVolumeOutline = computed(() => {
  if (!chapterStore.currentChapter) return null
  const currentChapterId = chapterStore.currentChapter.id
  for (const vol of bookOutlineData.value) {
    if (vol.chapters.some((ch: VolumeOutlineChapter) => ch.chapterId === currentChapterId)) {
      return vol
    }
  }
  return bookOutlineData.value[0] || null
})

// 当前章节的细纲数据
const chapterDetailOutline = computed(() => {
  // 如果有正在编辑的细纲，优先显示
  if (editingOutline.value) {
    return editingOutline.value.steps.map((step, index) => ({
      id: String(index + 1),
      type: step.type,
      label: DETAIL_OUTLINE_STEPS.find(s => s.type === step.type)?.label || '',
      content: step.content,
      completed: step.completed
    }))
  }

  // 如果有待确认的细纲
  if (chapterStore.pendingDetailOutline) {
    return chapterStore.pendingDetailOutline.steps.map((step, index) => ({
      id: String(index + 1),
      type: step.type,
      label: DETAIL_OUTLINE_STEPS.find(s => s.type === step.type)?.label || '',
      content: step.content,
      completed: step.completed
    }))
  }

  // 查看已选章节的细纲
  if (selectedChapterForDetail.value) {
    const outline = chapterStore.getChapterDetailOutline(selectedChapterForDetail.value)
    if (outline) {
      return outline.steps.map((step, index) => ({
        id: String(index + 1),
        type: step.type,
        label: DETAIL_OUTLINE_STEPS.find(s => s.type === step.type)?.label || '',
        content: step.content,
        completed: step.completed
      }))
    }
  }

  // 默认显示空模板
  return DETAIL_OUTLINE_STEPS.map((step, index) => ({
    id: String(index + 1),
    type: step.type,
    label: step.label,
    content: '',
    completed: false
  }))
})

// 计算当前章节进度
const chapterProgress = computed(() => {
  const items = chapterDetailOutline.value
  if (items.length === 0) return { completed: 0, total: 0 }
  const completed = items.filter(item => item.completed).length
  return { completed, total: items.length }
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

// 是否可以生成下一章细纲
const canGenerateNextOutline = computed(() => {
  return !isGeneratingOutline.value && !isGeneratingChapter.value
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

// 切换步骤展开/折叠
function toggleStepExpand(stepType: string) {
  const index = expandedSteps.value.indexOf(stepType)
  if (index === -1) {
    expandedSteps.value.push(stepType)
  } else {
    expandedSteps.value.splice(index, 1)
  }
}

// 是否步骤已展开
function isStepExpanded(stepType: string): boolean {
  return expandedSteps.value.includes(stepType)
}

// 选择已完成章节查看细纲
function selectCompletedChapter(chapterId: string) {
  selectedChapterForDetail.value = chapterId
  detailOutlineMode.value = 'view'
  editingOutline.value = null
  chapterStore.setPendingDetailOutline(null)
}

// 切换到生成下一章模式
function switchToGenerateMode() {
  detailOutlineMode.value = 'generate'
  selectedChapterForDetail.value = null
  editingOutline.value = null
  chapterStore.setPendingDetailOutline(null)
}

// 生成下一章细纲
async function generateNextChapterOutline() {
  if (isGeneratingOutline.value) return

  isGeneratingOutline.value = true

  try {
    // 构建生成细纲的上下文
    const book = bookStore.currentBook
    const nextOrder = chapterStore.nextChapterNumber
    const previousContext = chapterStore.getPreviousChaptersContext(nextOrder)
    const volumeOutline = currentVolumeOutline.value?.summary || ''

    // 构建 prompt
    const prompt = `你是一位专业的小说写作助手。请根据以下信息，为小说的下一章生成详细的章节细纲。

【小说信息】
书名：${book?.title || '未命名'}
总大纲：${totalOutline.value}
当前分卷大纲：${volumeOutline}

【已完成章节摘要】
${previousContext || '这是第一章，暂无之前章节'}

【要生成的章节】
第${nextOrder}章

请按以下五个步骤生成细纲内容，每个步骤的内容要具体、详细：

1. 场景铺设：设定本章的场景环境、时间地点
2. 角色出场：本章出场的角色及其状态、情绪
3. 冲突展开：本章的核心冲突或矛盾是什么
4. 高潮推进：情节如何推向高潮
5. 本章收尾：本章如何结尾，留下什么悬念

请用 JSON 格式返回，格式如下：
{
  "scene": "场景铺设内容",
  "characters": "角色出场内容",
  "conflict": "冲突展开内容",
  "climax": "高潮推进内容",
  "ending": "本章收尾内容"
}`

    const result = await aiStore.generate({
      prompt,
      systemPrompt: '你是一位专业的小说细纲生成助手，擅长根据大纲和前文内容生成连贯、吸引人的章节细纲。请只返回JSON格式的内容。'
    })

    if (result?.content) {
      // 解析返回的内容
      let outlineData: any = {}
      try {
        // 尝试提取 JSON
        const jsonMatch = result.content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          outlineData = JSON.parse(jsonMatch[0])
        }
      } catch (e) {
        console.error('解析细纲JSON失败:', e)
        // 如果解析失败，尝试简单分割
        outlineData = {
          scene: '解析失败，请重新生成',
          characters: '',
          conflict: '',
          climax: '',
          ending: ''
        }
      }

      // 创建待确认的细纲
      const newOutline: ChapterDetailOutline = {
        chapterId: `pending_${nextOrder}`,
        steps: [
          { type: 'scene', content: outlineData.scene || '', completed: false },
          { type: 'characters', content: outlineData.characters || '', completed: false },
          { type: 'conflict', content: outlineData.conflict || '', completed: false },
          { type: 'climax', content: outlineData.climax || '', completed: false },
          { type: 'ending', content: outlineData.ending || '', completed: false }
        ],
        status: 'draft',
        generatedAt: new Date().toISOString()
      }

      chapterStore.setPendingDetailOutline(newOutline)
      // 展开所有步骤
      expandedSteps.value = ['scene', 'characters', 'conflict', 'climax', 'ending']
    }
  } catch (e) {
    console.error('生成细纲失败:', e)
    ElMessage.error('生成细纲失败，请重试')
  } finally {
    isGeneratingOutline.value = false
  }
}

// 进入编辑模式
function enterEditMode() {
  if (chapterStore.pendingDetailOutline) {
    editingOutline.value = JSON.parse(JSON.stringify(chapterStore.pendingDetailOutline))
  }
  detailOutlineMode.value = 'edit'
}

// 更新编辑中的步骤内容
function updateEditingStep(stepType: string, content: string) {
  if (!editingOutline.value) return
  const step = editingOutline.value.steps.find(s => s.type === stepType)
  if (step) {
    step.content = content
  }
}

// 确认细纲
function confirmOutline() {
  if (editingOutline.value) {
    chapterStore.setPendingDetailOutline(editingOutline.value)
  }

  if (chapterStore.pendingDetailOutline) {
    // 标记为已确认
    const confirmedOutline = {
      ...chapterStore.pendingDetailOutline,
      status: 'confirmed' as const,
      confirmedAt: new Date().toISOString()
    }
    chapterStore.setPendingDetailOutline(confirmedOutline)
    editingOutline.value = null
    detailOutlineMode.value = 'generate'
    ElMessage.success('细纲已确认，可以生成章节内容')
  }
}

// 取消编辑
function cancelEdit() {
  editingOutline.value = null
  detailOutlineMode.value = chapterStore.pendingDetailOutline ? 'generate' : 'view'
}

// 根据细纲生成章节内容
async function generateChapterContent() {
  const outline = chapterStore.pendingDetailOutline
  if (!outline || outline.status !== 'confirmed') {
    ElMessage.warning('请先确认细纲')
    return
  }

  isGeneratingChapter.value = true

  try {
    const book = bookStore.currentBook
    const nextOrder = chapterStore.nextChapterNumber
    const previousContext = chapterStore.getPreviousChaptersContext(nextOrder)

    // 构建步骤内容
    const stepsContent = outline.steps.map(step => {
      const stepConfig = DETAIL_OUTLINE_STEPS.find(s => s.type === step.type)
      return `【${stepConfig?.label || step.type}】${step.content}`
    }).join('\n')

    const prompt = `你是一位专业的小说作家。请根据以下细纲，撰写小说的第${nextOrder}章。

【小说信息】
书名：${book?.title || '未命名'}
总大纲：${totalOutline.value}

【已完成章节摘要】
${previousContext || '这是第一章'}

【本章细纲】
${stepsContent}

请根据细纲撰写完整的章节内容，要求：
1. 内容要紧扣细纲，但可以适当发挥
2. 文笔流畅，描写生动
3. 人物对话自然
4. 字数在2000-4000字左右
5. 只输出小说正文内容，不要输出标题或其他说明

开始撰写：`

    const result = await aiStore.generate({
      prompt,
      systemPrompt: '你是一位专业的小说作家，擅长根据细纲撰写引人入胜的小说章节。',
      maxTokens: 4000
    })

    if (result?.content) {
      // 创建新章节
      const newChapter = await chapterStore.createChapter({
        bookId: book?.id || '',
        title: `第${nextOrder}章`,
        content: result.content,
        order: nextOrder
      })

      if (newChapter) {
        // 保存细纲到章节
        const finalOutline = {
          ...outline,
          chapterId: newChapter.id,
          status: 'generated' as const
        }
        chapterStore.saveDetailOutlineToChapter(newChapter.id, finalOutline)

        // 清除待确认细纲
        chapterStore.setPendingDetailOutline(null)

        // 选中新章节
        emit('selectChapter', newChapter.id)

        ElMessage.success(`第${nextOrder}章已生成`)

        // 重置状态
        detailOutlineMode.value = 'view'
        selectedChapterForDetail.value = newChapter.id
      }
    }
  } catch (e) {
    console.error('生成章节失败:', e)
    ElMessage.error('生成章节失败，请重试')
  } finally {
    isGeneratingChapter.value = false
  }
}

// 重新生成细纲
function regenerateOutline() {
  chapterStore.setPendingDetailOutline(null)
  editingOutline.value = null
  generateNextChapterOutline()
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

        <div class="volumes-list" v-if="bookOutlineData.length > 0">
          <div
            v-for="volume in bookOutlineData"
            :key="volume.id"
            class="volume-section"
          >
            <div class="volume-header">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ volume.title }}</span>
              <span class="volume-count">({{ volume.chapters?.length || 0 }}章)</span>
            </div>
            <div class="volume-chapters">
              <div
                v-for="chapter in volume.chapters"
                :key="chapter.id"
                class="outline-chapter-item"
                :class="{ active: chapter.chapterId === chapterStore.currentChapter?.id }"
                @click="selectOutlineChapter(chapter.chapterId)"
              >
                <el-icon><Document /></el-icon>
                <span>{{ chapter.title }}</span>
                <el-icon v-if="chapter.chapterId === chapterStore.currentChapter?.id" class="active-indicator">
                  <ArrowRight />
                </el-icon>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty-outline">
          <el-icon><InfoFilled /></el-icon>
          <span>暂无大纲，请先创建章节</span>
        </div>

        <div class="outline-tip">
          <el-icon><InfoFilled /></el-icon>
          <span>点击章节可跳转并查看细纲</span>
        </div>
      </div>

      <!-- 细纲列表（章节细纲管理） -->
      <div v-else-if="activeTab === 'detail'" class="detail-outline-list">
        <!-- 模式切换 -->
        <div class="detail-mode-switch">
          <button
            class="mode-btn"
            :class="{ active: detailOutlineMode === 'view' || detailOutlineMode === 'edit' }"
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
              <span>{{ getChapterTitle(selectedChapterForDetail) }} 细纲</span>
            </div>

            <!-- 章节摘要 -->
            <div class="chapter-summary">
              <div class="summary-label">章节摘要</div>
              <div class="summary-content">{{ getChapterSummary(selectedChapterForDetail) }}</div>
            </div>

            <!-- 细纲步骤 -->
            <div class="detail-steps">
              <div
                v-for="(item, index) in chapterDetailOutline"
                :key="item.id"
                class="step-item"
              >
                <div class="step-header" @click="toggleStepExpand(item.type)">
                  <div class="step-label">
                    <el-icon v-if="item.completed" class="completed-icon"><CircleCheckFilled /></el-icon>
                    <el-icon v-else class="pending-icon"><Clock /></el-icon>
                    <span>{{ index + 1 }}. {{ item.label }}</span>
                  </div>
                  <el-icon class="expand-icon">
                    <ArrowDown v-if="isStepExpanded(item.type)" />
                    <ArrowRight v-else />
                  </el-icon>
                </div>
                <div v-if="isStepExpanded(item.type)" class="step-content">
                  {{ item.content || '暂无内容' }}
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 生成模式：生成下一章细纲 -->
        <template v-if="detailOutlineMode === 'generate'">
          <div class="generate-section">
            <div class="next-chapter-info">
              <el-icon><EditPen /></el-icon>
              <span>准备生成: {{ nextChapterInfo.title }}</span>
            </div>

            <!-- 没有待确认细纲时，显示生成按钮 -->
            <div v-if="!chapterStore.pendingDetailOutline && !editingOutline" class="generate-action">
              <div class="generate-tip">
                <el-icon><InfoFilled /></el-icon>
                <span>AI将根据总大纲、分卷大纲和前面章节内容生成细纲</span>
              </div>
              <el-button
                type="primary"
                :loading="isGeneratingOutline"
                :disabled="!canGenerateNextOutline"
                @click="generateNextChapterOutline"
              >
                <el-icon><MagicStick /></el-icon>
                {{ isGeneratingOutline ? '正在生成...' : 'AI推演生成细纲' }}
              </el-button>
            </div>

            <!-- 有待确认细纲时，显示细纲内容 -->
            <div v-else class="pending-outline-section">
              <div class="outline-status">
                <el-tag
                  :type="chapterStore.pendingDetailOutline?.status === 'confirmed' ? 'success' : 'warning'"
                  size="small"
                >
                  {{ chapterStore.pendingDetailOutline?.status === 'confirmed' ? '已确认' : '待确认' }}
                </el-tag>
              </div>

              <!-- 细纲步骤（查看/编辑） -->
              <div class="detail-steps">
                <div
                  v-for="(item, index) in chapterDetailOutline"
                  :key="item.id"
                  class="step-item"
                  :class="{ editing: editingOutline !== null }"
                >
                  <div class="step-header" @click="toggleStepExpand(item.type)">
                    <div class="step-label">
                      <span class="step-number">{{ index + 1 }}</span>
                      <span>{{ item.label }}</span>
                    </div>
                    <el-icon class="expand-icon">
                      <ArrowDown v-if="isStepExpanded(item.type)" />
                      <ArrowRight v-else />
                    </el-icon>
                  </div>
                  <div v-if="isStepExpanded(item.type)" class="step-content">
                    <template v-if="editingOutline !== null">
                      <el-input
                        type="textarea"
                        :rows="3"
                        :model-value="item.content"
                        @input="(val: string) => updateEditingStep(item.type, val)"
                        placeholder="请输入内容..."
                      />
                    </template>
                    <template v-else>
                      {{ item.content || '暂无内容' }}
                    </template>
                  </div>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="outline-actions">
                <template v-if="editingOutline !== null">
                  <el-button size="small" @click="cancelEdit">取消</el-button>
                  <el-button type="primary" size="small" @click="confirmOutline">保存确认</el-button>
                </template>
                <template v-else>
                  <el-button size="small" @click="regenerateOutline" :disabled="isGeneratingOutline">
                    <el-icon><Refresh /></el-icon>
                    重新生成
                  </el-button>
                  <el-button size="small" @click="enterEditMode">
                    <el-icon><Edit /></el-icon>
                    修改
                  </el-button>
                  <el-button
                    v-if="chapterStore.pendingDetailOutline?.status !== 'confirmed'"
                    type="success"
                    size="small"
                    @click="confirmOutline"
                  >
                    <el-icon><Check /></el-icon>
                    确认细纲
                  </el-button>
                </template>
              </div>

              <!-- 确认后显示生成章节按钮 -->
              <div
                v-if="chapterStore.pendingDetailOutline?.status === 'confirmed'"
                class="generate-chapter-section"
              >
                <div class="divider"></div>
                <el-button
                  type="primary"
                  size="default"
                  :loading="isGeneratingChapter"
                  @click="generateChapterContent"
                >
                  <el-icon><Document /></el-icon>
                  {{ isGeneratingChapter ? '正在生成章节...' : '根据细纲生成章节' }}
                </el-button>
              </div>
            </div>
          </div>
        </template>

        <!-- 进度条 -->
        <div v-if="chapterDetailOutline.length > 0 && selectedChapterForDetail" class="detail-progress">
          <span>进度: {{ chapterProgress.completed }}/{{ chapterProgress.total }}</span>
          <el-progress
            :percentage="chapterProgress.total > 0 ? (chapterProgress.completed / chapterProgress.total) * 100 : 0"
            :stroke-width="4"
            :show-text="false"
          />
        </div>
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

      .volume-count {
        margin-left: auto;
        font-size: 11px;
        font-weight: normal;
        color: var(--text-secondary, $text-secondary);
      }

      .el-icon {
        font-size: 14px;
        color: var(--text-secondary, $text-secondary);
      }
    }

    .volume-chapters {
      padding-left: 12px;
      margin-top: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
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
      max-height: 200px;
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
      }

      .summary-content {
        font-size: 12px;
        line-height: 1.6;
        color: var(--text-primary, $text-primary);
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

      &.editing {
        border-color: $primary-color;
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
