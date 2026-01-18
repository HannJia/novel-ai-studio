<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, MagicStick, Location, Timer } from '@element-plus/icons-vue'
import { useMemoryStore } from '@/stores/memoryStore'
import { useBookStore, useChapterStore } from '@/stores'
import type { StoryEvent } from '@/types/memory'
import { EVENT_TYPE_MAP } from '@/types/memory'

const memoryStore = useMemoryStore()
const bookStore = useBookStore()
const chapterStore = useChapterStore()

// 筛选类型
const filterType = ref<string>('all')

// 显示创建对话框
const showCreateDialog = ref(false)
const showDetailDialog = ref(false)

// 当前选中的事件
const selectedEvent = ref<StoryEvent | null>(null)

// 新事件表单
const newEvent = ref({
  title: '',
  description: '',
  eventType: 'minor' as 'major' | 'minor' | 'background',
  location: '',
  impact: '',
  involvedCharacters: [] as string[]
})

// AI提取中
const extracting = ref(false)

// 计算属性：筛选后的事件
const filteredEvents = computed(() => {
  if (filterType.value === 'all') {
    return memoryStore.events
  }
  return memoryStore.events.filter(e => e.eventType === filterType.value)
})

// 当前章节序号
const currentChapterOrder = computed(() => chapterStore.currentChapter?.orderNum ?? 1)

// 加载事件数据
onMounted(async () => {
  if (bookStore.currentBook?.id) {
    await memoryStore.loadBookEvents(bookStore.currentBook.id)
  }
})

// 监听书籍变化
watch(() => bookStore.currentBook?.id, async (newId) => {
  if (newId) {
    await memoryStore.loadBookEvents(newId)
  }
})

// 打开创建对话框
function openCreateDialog() {
  newEvent.value = {
    title: '',
    description: '',
    eventType: 'minor',
    location: '',
    impact: '',
    involvedCharacters: []
  }
  showCreateDialog.value = true
}

// 创建事件
async function handleCreateEvent() {
  if (!newEvent.value.title.trim()) {
    ElMessage.warning('请输入事件标题')
    return
  }

  if (!bookStore.currentBook?.id || !chapterStore.currentChapter?.id) {
    ElMessage.warning('请先选择章节')
    return
  }

  const event: Partial<StoryEvent> = {
    bookId: bookStore.currentBook.id,
    chapterId: chapterStore.currentChapter.id,
    chapterOrder: currentChapterOrder.value,
    title: newEvent.value.title,
    description: newEvent.value.description,
    eventType: newEvent.value.eventType,
    location: newEvent.value.location,
    impact: newEvent.value.impact,
    involvedCharacters: newEvent.value.involvedCharacters
  }

  const result = await memoryStore.createEvent(event)
  if (result) {
    ElMessage.success('事件已创建')
    showCreateDialog.value = false
  }
}

// AI提取当前章节事件
async function handleExtractEvents() {
  if (!chapterStore.currentChapter?.id) {
    ElMessage.warning('请先选择章节')
    return
  }

  extracting.value = true
  try {
    const events = await memoryStore.extractEvents(chapterStore.currentChapter.id)
    if (events.length > 0) {
      ElMessage.success(`成功提取 ${events.length} 个事件`)
    } else {
      ElMessage.info('未能从章节中提取到事件')
    }
  } finally {
    extracting.value = false
  }
}

// 查看事件详情
function viewEvent(event: StoryEvent) {
  selectedEvent.value = event
  showDetailDialog.value = true
}

// 删除事件
async function handleDelete(event: StoryEvent) {
  await ElMessageBox.confirm('确定要删除这个事件吗？', '确认删除', {
    type: 'warning'
  })
  const result = await memoryStore.deleteEvent(event.id)
  if (result) {
    ElMessage.success('事件已删除')
    if (selectedEvent.value?.id === event.id) {
      showDetailDialog.value = false
    }
  }
}

// 获取事件类型颜色
function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    major: '#F56C6C',
    minor: '#E6A23C',
    background: '#909399'
  }
  return colors[type] || '#909399'
}

// 获取事件类型样式
function getTypeStyle(type: string): string {
  const styles: Record<string, string> = {
    major: 'danger',
    minor: 'warning',
    background: 'info'
  }
  return styles[type] || 'info'
}
</script>

<template>
  <div class="timeline-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h4>事件时间线</h4>
      <div class="header-actions">
        <el-button
          size="small"
          :loading="extracting"
          @click="handleExtractEvents"
        >
          <el-icon><MagicStick /></el-icon>
          AI提取
        </el-button>
        <el-button type="primary" size="small" @click="openCreateDialog">
          <el-icon><Plus /></el-icon>
          添加
        </el-button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-radio-group v-model="filterType" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="major">重大</el-radio-button>
        <el-radio-button value="minor">次要</el-radio-button>
        <el-radio-button value="background">背景</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 时间线 -->
    <div class="timeline-list" v-loading="memoryStore.loading">
      <el-timeline>
        <el-timeline-item
          v-for="event in filteredEvents"
          :key="event.id"
          :color="getTypeColor(event.eventType)"
          :timestamp="`第${event.chapterOrder}章`"
          placement="top"
        >
          <div class="event-card" @click="viewEvent(event)">
            <div class="event-header">
              <span class="event-title">{{ event.title }}</span>
              <el-tag :type="getTypeStyle(event.eventType)" size="small">
                {{ EVENT_TYPE_MAP[event.eventType] }}
              </el-tag>
            </div>
            <div class="event-desc" v-if="event.description">
              {{ event.description.slice(0, 80) }}{{ event.description.length > 80 ? '...' : '' }}
            </div>
            <div class="event-meta" v-if="event.location">
              <el-icon><Location /></el-icon>
              {{ event.location }}
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>

      <!-- 空状态 -->
      <div v-if="filteredEvents.length === 0" class="empty-state">
        <el-icon class="empty-icon"><Timer /></el-icon>
        <p>暂无事件记录</p>
        <el-button type="primary" size="small" @click="handleExtractEvents" :loading="extracting">
          AI提取当前章节事件
        </el-button>
      </div>
    </div>

    <!-- 创建对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      title="添加事件"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="newEvent.title" placeholder="事件的简短描述" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="newEvent.eventType" style="width: 100%">
            <el-option
              v-for="(label, value) in EVENT_TYPE_MAP"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="地点">
          <el-input v-model="newEvent.location" placeholder="事件发生的地点" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="newEvent.description"
            type="textarea"
            :rows="3"
            placeholder="详细描述这个事件"
          />
        </el-form-item>
        <el-form-item label="影响">
          <el-input
            v-model="newEvent.impact"
            type="textarea"
            :rows="2"
            placeholder="这个事件对剧情的影响"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateEvent">创建</el-button>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      :title="selectedEvent?.title"
      width="600px"
    >
      <template v-if="selectedEvent">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="类型">
            <el-tag :type="getTypeStyle(selectedEvent.eventType)">
              {{ EVENT_TYPE_MAP[selectedEvent.eventType] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="章节">
            第 {{ selectedEvent.chapterOrder }} 章
          </el-descriptions-item>
          <el-descriptions-item label="地点" :span="2">
            {{ selectedEvent.location || '未指定' }}
          </el-descriptions-item>
          <el-descriptions-item label="描述" :span="2">
            <div class="detail-text">{{ selectedEvent.description || '无' }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="影响" :span="2">
            <div class="detail-text">{{ selectedEvent.impact || '未设置' }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="涉及角色" :span="2">
            <template v-if="selectedEvent.involvedCharacters?.length">
              <el-tag
                v-for="char in selectedEvent.involvedCharacters"
                :key="char"
                size="small"
                style="margin-right: 4px;"
              >
                {{ char }}
              </el-tag>
            </template>
            <span v-else>无</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button type="danger" @click="handleDelete(selectedEvent!)">删除</el-button>
        <el-button @click="showDetailDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.timeline-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;

  h4 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }
}

.filter-bar {
  margin-bottom: 12px;
}

.timeline-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
}

.event-card {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .event-title {
      font-weight: 500;
      font-size: 14px;
    }
  }

  .event-desc {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-bottom: 8px;
    line-height: 1.5;
  }

  .event-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--el-text-color-secondary);

  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  p {
    margin-bottom: 16px;
  }
}

.detail-text {
  white-space: pre-wrap;
  line-height: 1.6;
}
</style>
