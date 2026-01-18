<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick, Document, List, DocumentCopy } from '@element-plus/icons-vue'
import { useMemoryStore } from '@/stores/memoryStore'
import { useBookStore, useChapterStore } from '@/stores'
import type { ChapterSummary } from '@/types/memory'

const memoryStore = useMemoryStore()
const bookStore = useBookStore()
const chapterStore = useChapterStore()

// 显示详情对话框
const showDetailDialog = ref(false)
const showEditDialog = ref(false)

// 当前选中的摘要
const selectedSummary = ref<ChapterSummary | null>(null)

// 编辑中的摘要
const editingSummary = ref({
  summary: '',
  keyEvents: [] as string[],
  emotionalTone: ''
})

// AI生成中
const generating = ref(false)

// 新关键事件输入
const newKeyEvent = ref('')

// 当前章节的摘要
const currentChapterSummary = computed(() => {
  if (!chapterStore.currentChapter?.id) return null
  return memoryStore.summaries.find(s => s.chapterId === chapterStore.currentChapter?.id)
})

// 加载摘要数据
onMounted(async () => {
  if (bookStore.currentBook?.id) {
    await memoryStore.loadBookSummaries(bookStore.currentBook.id)
  }
})

// 监听书籍变化
watch(() => bookStore.currentBook?.id, async (newId) => {
  if (newId) {
    await memoryStore.loadBookSummaries(newId)
  }
})

// AI生成当前章节摘要
async function handleGenerateSummary() {
  if (!chapterStore.currentChapter?.id) {
    ElMessage.warning('请先选择章节')
    return
  }

  generating.value = true
  try {
    const summary = await memoryStore.generateSummary(chapterStore.currentChapter.id)
    if (summary) {
      ElMessage.success('摘要生成成功')
    } else {
      ElMessage.error('摘要生成失败')
    }
  } finally {
    generating.value = false
  }
}

// 查看摘要详情
function viewSummary(summary: ChapterSummary) {
  selectedSummary.value = summary
  showDetailDialog.value = true
}

// 打开编辑对话框
function openEditDialog(summary: ChapterSummary) {
  selectedSummary.value = summary
  editingSummary.value = {
    summary: summary.summary,
    keyEvents: [...(summary.keyEvents || [])],
    emotionalTone: summary.emotionalTone || ''
  }
  showEditDialog.value = true
}

// 添加关键事件
function addKeyEvent() {
  if (newKeyEvent.value.trim()) {
    editingSummary.value.keyEvents.push(newKeyEvent.value.trim())
    newKeyEvent.value = ''
  }
}

// 移除关键事件
function removeKeyEvent(index: number) {
  editingSummary.value.keyEvents.splice(index, 1)
}

// 保存摘要
async function handleSaveSummary() {
  if (!selectedSummary.value) return

  const updated: Partial<ChapterSummary> = {
    ...selectedSummary.value,
    summary: editingSummary.value.summary,
    keyEvents: editingSummary.value.keyEvents,
    emotionalTone: editingSummary.value.emotionalTone
  }

  const result = await memoryStore.saveSummary(updated)
  if (result) {
    ElMessage.success('摘要已保存')
    showEditDialog.value = false
  }
}

// 获取情感基调颜色
function getToneColor(tone: string): string {
  const toneColors: Record<string, string> = {
    '紧张': '#F56C6C',
    '热血': '#E6A23C',
    '温馨': '#67C23A',
    '悲伤': '#909399',
    '欢乐': '#67C23A',
    '神秘': '#9B59B6',
    '恐怖': '#1F1F1F'
  }
  return toneColors[tone] || '#409EFF'
}
</script>

<template>
  <div class="summary-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h4>章节摘要</h4>
      <el-button
        type="primary"
        size="small"
        :loading="generating"
        @click="handleGenerateSummary"
      >
        <el-icon><MagicStick /></el-icon>
        AI生成
      </el-button>
    </div>

    <!-- 当前章节摘要 -->
    <div class="current-summary" v-if="chapterStore.currentChapter">
      <div class="section-title">
        <el-icon><Document /></el-icon>
        当前章节
      </div>
      <div v-if="currentChapterSummary" class="summary-card active">
        <div class="summary-text">{{ currentChapterSummary.summary }}</div>
        <div class="summary-meta">
          <el-tag
            v-if="currentChapterSummary.emotionalTone"
            size="small"
            :color="getToneColor(currentChapterSummary.emotionalTone)"
            effect="dark"
          >
            {{ currentChapterSummary.emotionalTone }}
          </el-tag>
          <el-button size="small" text @click="openEditDialog(currentChapterSummary)">
            编辑
          </el-button>
        </div>
        <div class="key-events" v-if="currentChapterSummary.keyEvents?.length">
          <div class="events-label">关键事件：</div>
          <el-tag
            v-for="(event, index) in currentChapterSummary.keyEvents"
            :key="index"
            size="small"
            type="info"
          >
            {{ event }}
          </el-tag>
        </div>
      </div>
      <div v-else class="no-summary">
        <p>当前章节暂无摘要</p>
        <el-button type="primary" size="small" :loading="generating" @click="handleGenerateSummary">
          生成摘要
        </el-button>
      </div>
    </div>

    <!-- 历史摘要列表 -->
    <div class="summary-list">
      <div class="section-title">
        <el-icon><List /></el-icon>
        历史摘要
      </div>
      <div class="list-content" v-loading="memoryStore.loading">
        <div
          v-for="summary in memoryStore.summaries"
          :key="summary.chapterId"
          class="summary-item"
          :class="{ current: summary.chapterId === chapterStore.currentChapter?.id }"
          @click="viewSummary(summary)"
        >
          <div class="item-header">
            <span class="chapter-num">第{{ summary.chapterOrder }}章</span>
            <el-tag
              v-if="summary.emotionalTone"
              size="small"
              :color="getToneColor(summary.emotionalTone)"
              effect="plain"
            >
              {{ summary.emotionalTone }}
            </el-tag>
          </div>
          <div class="item-preview">
            {{ summary.summary.slice(0, 60) }}{{ summary.summary.length > 60 ? '...' : '' }}
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="memoryStore.summaries.length === 0" class="empty-state">
          <el-icon class="empty-icon"><DocumentCopy /></el-icon>
          <p>暂无章节摘要</p>
        </div>
      </div>
    </div>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      :title="`第${selectedSummary?.chapterOrder}章 摘要`"
      width="600px"
    >
      <template v-if="selectedSummary">
        <div class="detail-content">
          <div class="detail-section">
            <div class="detail-label">摘要内容</div>
            <div class="detail-text">{{ selectedSummary.summary }}</div>
          </div>

          <div class="detail-section" v-if="selectedSummary.emotionalTone">
            <div class="detail-label">情感基调</div>
            <el-tag :color="getToneColor(selectedSummary.emotionalTone)" effect="dark">
              {{ selectedSummary.emotionalTone }}
            </el-tag>
          </div>

          <div class="detail-section" v-if="selectedSummary.keyEvents?.length">
            <div class="detail-label">关键事件</div>
            <div class="events-list">
              <el-tag
                v-for="(event, index) in selectedSummary.keyEvents"
                :key="index"
                size="default"
              >
                {{ event }}
              </el-tag>
            </div>
          </div>

          <div class="detail-section" v-if="selectedSummary.charactersAppeared?.length">
            <div class="detail-label">出场角色</div>
            <div class="characters-list">
              <el-tag
                v-for="(char, index) in selectedSummary.charactersAppeared"
                :key="index"
                type="success"
                size="default"
              >
                {{ char }}
              </el-tag>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <el-button @click="openEditDialog(selectedSummary!)">编辑</el-button>
        <el-button type="primary" @click="showDetailDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="showEditDialog"
      title="编辑摘要"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="摘要内容">
          <el-input
            v-model="editingSummary.summary"
            type="textarea"
            :rows="6"
            placeholder="章节摘要内容"
          />
        </el-form-item>
        <el-form-item label="情感基调">
          <el-input v-model="editingSummary.emotionalTone" placeholder="如：紧张、温馨、热血" />
        </el-form-item>
        <el-form-item label="关键事件">
          <div class="key-events-edit">
            <div class="events-tags">
              <el-tag
                v-for="(event, index) in editingSummary.keyEvents"
                :key="index"
                closable
                @close="removeKeyEvent(index)"
              >
                {{ event }}
              </el-tag>
            </div>
            <div class="add-event">
              <el-input
                v-model="newKeyEvent"
                placeholder="输入关键事件"
                @keyup.enter="addKeyEvent"
              />
              <el-button @click="addKeyEvent">添加</el-button>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="handleSaveSummary">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.summary-panel {
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
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  margin-bottom: 12px;
}

.current-summary {
  margin-bottom: 20px;

  .summary-card {
    padding: 12px;
    background: var(--el-fill-color-light);
    border-radius: 8px;
    border: 1px solid var(--el-border-color-lighter);

    &.active {
      border-color: var(--el-color-primary);
    }

    .summary-text {
      font-size: 13px;
      line-height: 1.6;
      margin-bottom: 12px;
    }

    .summary-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .key-events {
      .events-label {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        margin-bottom: 6px;
      }

      .el-tag {
        margin-right: 4px;
        margin-bottom: 4px;
      }
    }
  }

  .no-summary {
    text-align: center;
    padding: 24px;
    background: var(--el-fill-color-light);
    border-radius: 8px;

    p {
      color: var(--el-text-color-secondary);
      margin-bottom: 12px;
    }
  }
}

.summary-list {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .list-content {
    flex: 1;
    overflow-y: auto;
  }
}

.summary-item {
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--el-color-primary);
  }

  &.current {
    background: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary);
  }

  .item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;

    .chapter-num {
      font-weight: 500;
      font-size: 13px;
    }
  }

  .item-preview {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    line-height: 1.5;
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
}

.detail-content {
  .detail-section {
    margin-bottom: 16px;

    .detail-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--el-text-color-secondary);
      margin-bottom: 8px;
    }

    .detail-text {
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .events-list,
    .characters-list {
      .el-tag {
        margin-right: 6px;
        margin-bottom: 6px;
      }
    }
  }
}

.key-events-edit {
  .events-tags {
    margin-bottom: 8px;

    .el-tag {
      margin-right: 6px;
      margin-bottom: 6px;
    }
  }

  .add-event {
    display: flex;
    gap: 8px;
  }
}
</style>
