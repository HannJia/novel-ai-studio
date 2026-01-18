<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, MoreFilled, DocumentRemove } from '@element-plus/icons-vue'
import { useMemoryStore } from '@/stores/memoryStore'
import { useBookStore, useChapterStore } from '@/stores'
import type { Foreshadow, ForeshadowType, ForeshadowStatus, ForeshadowImportance } from '@/types/memory'
import { FORESHADOW_TYPE_MAP, FORESHADOW_STATUS_MAP, FORESHADOW_IMPORTANCE_MAP } from '@/types/memory'

const memoryStore = useMemoryStore()
const bookStore = useBookStore()
const chapterStore = useChapterStore()

// 筛选状态
const filterStatus = ref<ForeshadowStatus | 'all'>('all')

// 显示创建对话框
const showCreateDialog = ref(false)
const showDetailDialog = ref(false)

// 当前选中的伏笔
const selectedForeshadow = ref<Foreshadow | null>(null)

// 新伏笔表单
const newForeshadow = ref({
  title: '',
  type: 'hint' as ForeshadowType,
  importance: 'minor' as ForeshadowImportance,
  plantedText: '',
  expectedResolve: '',
  relatedCharacters: [] as string[]
})

// 计算属性：筛选后的伏笔
const filteredForeshadows = computed(() => {
  if (filterStatus.value === 'all') {
    return memoryStore.foreshadows
  }
  return memoryStore.foreshadows.filter(f => f.status === filterStatus.value)
})

// 当前章节序号
const currentChapterOrder = computed(() => chapterStore.currentChapter?.order ?? 1)

// 加载伏笔数据
onMounted(async () => {
  if (bookStore.currentBook?.id) {
    await memoryStore.loadBookForeshadows(bookStore.currentBook.id)
  }
})

// 监听书籍变化
watch(() => bookStore.currentBook?.id, async (newId) => {
  if (newId) {
    await memoryStore.loadBookForeshadows(newId)
  }
})

// 打开创建对话框
function openCreateDialog() {
  newForeshadow.value = {
    title: '',
    type: 'hint',
    importance: 'minor',
    plantedText: '',
    expectedResolve: '',
    relatedCharacters: []
  }
  showCreateDialog.value = true
}

// 创建伏笔
async function handleCreateForeshadow() {
  if (!newForeshadow.value.title.trim()) {
    ElMessage.warning('请输入伏笔标题')
    return
  }

  if (!bookStore.currentBook?.id || !chapterStore.currentChapter?.id) {
    ElMessage.warning('请先选择章节')
    return
  }

  const foreshadow: Partial<Foreshadow> = {
    bookId: bookStore.currentBook.id,
    title: newForeshadow.value.title,
    type: newForeshadow.value.type,
    importance: newForeshadow.value.importance,
    plantedChapter: currentChapterOrder.value,
    plantedChapterId: chapterStore.currentChapter.id,
    plantedText: newForeshadow.value.plantedText,
    expectedResolve: newForeshadow.value.expectedResolve,
    relatedCharacters: newForeshadow.value.relatedCharacters,
    source: 'manual'
  }

  const result = await memoryStore.createForeshadow(foreshadow)
  if (result) {
    ElMessage.success('伏笔已创建')
    showCreateDialog.value = false
  }
}

// 查看伏笔详情
function viewForeshadow(foreshadow: Foreshadow) {
  selectedForeshadow.value = foreshadow
  showDetailDialog.value = true
}

// 标记为部分回收
async function markAsPartial(foreshadow: Foreshadow) {
  await memoryStore.updateForeshadowStatus(foreshadow.id, 'partial')
  ElMessage.success('已标记为部分回收')
}

// 标记为完全回收
async function markAsResolved(foreshadow: Foreshadow) {
  await memoryStore.resolveForeshadow(foreshadow.id)
  ElMessage.success('伏笔已回收')
}

// 标记为废弃
async function markAsAbandoned(foreshadow: Foreshadow) {
  await memoryStore.updateForeshadowStatus(foreshadow.id, 'abandoned', '用户手动废弃')
  ElMessage.success('伏笔已废弃')
}

// 删除伏笔
async function handleDelete(foreshadow: Foreshadow) {
  await ElMessageBox.confirm('确定要删除这个伏笔吗？', '确认删除', {
    type: 'warning'
  })
  const result = await memoryStore.deleteForeshadow(foreshadow.id)
  if (result) {
    ElMessage.success('伏笔已删除')
    if (selectedForeshadow.value?.id === foreshadow.id) {
      showDetailDialog.value = false
    }
  }
}

// 获取状态颜色
function getStatusColor(status: ForeshadowStatus): string {
  const colors: Record<ForeshadowStatus, string> = {
    planted: '#E6A23C',
    partial: '#409EFF',
    resolved: '#67C23A',
    abandoned: '#909399'
  }
  return colors[status]
}

// 获取重要性颜色
function getImportanceColor(importance: ForeshadowImportance): string {
  const colors: Record<ForeshadowImportance, string> = {
    major: '#F56C6C',
    minor: '#E6A23C',
    subtle: '#909399'
  }
  return colors[importance]
}
</script>

<template>
  <div class="foreshadow-panel">
    <!-- 头部 -->
    <div class="panel-header">
      <h4>伏笔管理</h4>
      <el-button type="primary" size="small" @click="openCreateDialog">
        <el-icon><Plus /></el-icon>
        添加伏笔
      </el-button>
    </div>

    <!-- 统计 -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-value">{{ memoryStore.foreshadowStats.planted }}</span>
        <span class="stat-label">待回收</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ memoryStore.foreshadowStats.partial }}</span>
        <span class="stat-label">部分回收</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ memoryStore.foreshadowStats.resolved }}</span>
        <span class="stat-label">已回收</span>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-radio-group v-model="filterStatus" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="planted">待回收</el-radio-button>
        <el-radio-button value="partial">部分</el-radio-button>
        <el-radio-button value="resolved">已回收</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 伏笔列表 -->
    <div class="foreshadow-list" v-loading="memoryStore.loading">
      <div
        v-for="foreshadow in filteredForeshadows"
        :key="foreshadow.id"
        class="foreshadow-item"
        @click="viewForeshadow(foreshadow)"
      >
        <div class="item-header">
          <span class="title">{{ foreshadow.title }}</span>
          <el-tag
            :color="getStatusColor(foreshadow.status)"
            size="small"
            effect="dark"
          >
            {{ FORESHADOW_STATUS_MAP[foreshadow.status] }}
          </el-tag>
        </div>
        <div class="item-meta">
          <el-tag size="small" :color="getImportanceColor(foreshadow.importance)" effect="plain">
            {{ FORESHADOW_IMPORTANCE_MAP[foreshadow.importance] }}
          </el-tag>
          <el-tag size="small" type="info">
            {{ FORESHADOW_TYPE_MAP[foreshadow.type] }}
          </el-tag>
          <span class="chapter-info">第{{ foreshadow.plantedChapter }}章埋设</span>
        </div>
        <div class="item-actions" @click.stop>
          <el-dropdown trigger="click">
            <el-button :icon="MoreFilled" size="small" text />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-if="foreshadow.status === 'planted'"
                  @click="markAsPartial(foreshadow)"
                >
                  标记为部分回收
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="foreshadow.status !== 'resolved'"
                  @click="markAsResolved(foreshadow)"
                >
                  标记为已回收
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="foreshadow.status !== 'abandoned'"
                  @click="markAsAbandoned(foreshadow)"
                >
                  标记为废弃
                </el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(foreshadow)">
                  <span style="color: #F56C6C;">删除</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredForeshadows.length === 0" class="empty-state">
        <el-icon class="empty-icon"><DocumentRemove /></el-icon>
        <p>暂无伏笔</p>
        <el-button type="primary" size="small" @click="openCreateDialog">
          添加第一个伏笔
        </el-button>
      </div>
    </div>

    <!-- 创建对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      title="添加伏笔"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="标题" required>
          <el-input v-model="newForeshadow.title" placeholder="伏笔的简短描述" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="newForeshadow.type" style="width: 100%">
            <el-option
              v-for="(label, value) in FORESHADOW_TYPE_MAP"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="重要性">
          <el-select v-model="newForeshadow.importance" style="width: 100%">
            <el-option
              v-for="(label, value) in FORESHADOW_IMPORTANCE_MAP"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="埋设原文">
          <el-input
            v-model="newForeshadow.plantedText"
            type="textarea"
            :rows="3"
            placeholder="可以粘贴埋设伏笔的原文片段"
          />
        </el-form-item>
        <el-form-item label="预期回收">
          <el-input
            v-model="newForeshadow.expectedResolve"
            type="textarea"
            :rows="2"
            placeholder="描述这个伏笔预期在什么情况下回收"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateForeshadow">创建</el-button>
      </template>
    </el-dialog>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      :title="selectedForeshadow?.title"
      width="600px"
    >
      <template v-if="selectedForeshadow">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="状态">
            <el-tag :color="getStatusColor(selectedForeshadow.status)" effect="dark">
              {{ FORESHADOW_STATUS_MAP[selectedForeshadow.status] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="重要性">
            <el-tag :color="getImportanceColor(selectedForeshadow.importance)" effect="plain">
              {{ FORESHADOW_IMPORTANCE_MAP[selectedForeshadow.importance] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="类型">
            {{ FORESHADOW_TYPE_MAP[selectedForeshadow.type] }}
          </el-descriptions-item>
          <el-descriptions-item label="埋设章节">
            第 {{ selectedForeshadow.plantedChapter }} 章
          </el-descriptions-item>
          <el-descriptions-item label="来源" :span="2">
            {{ selectedForeshadow.source === 'manual' ? '手动添加' : 'AI识别' }}
          </el-descriptions-item>
          <el-descriptions-item label="埋设原文" :span="2">
            <div class="planted-text">{{ selectedForeshadow.plantedText || '无' }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="预期回收" :span="2">
            {{ selectedForeshadow.expectedResolve || '未设置' }}
          </el-descriptions-item>
          <el-descriptions-item label="回收章节" :span="2">
            <template v-if="selectedForeshadow.resolutionChapters?.length">
              第 {{ selectedForeshadow.resolutionChapters.join('、') }} 章
            </template>
            <span v-else>未回收</span>
          </el-descriptions-item>
          <el-descriptions-item label="回收说明" :span="2">
            {{ selectedForeshadow.resolutionNotes || '无' }}
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="showDetailDialog = false">关闭</el-button>
        <el-button
          v-if="selectedForeshadow?.status !== 'resolved'"
          type="primary"
          @click="markAsResolved(selectedForeshadow!)"
        >
          标记为已回收
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.foreshadow-panel {
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

.stats-bar {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  margin-bottom: 12px;

  .stat-item {
    text-align: center;

    .stat-value {
      display: block;
      font-size: 20px;
      font-weight: 600;
      color: var(--el-color-primary);
    }

    .stat-label {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }
}

.filter-bar {
  margin-bottom: 12px;
}

.foreshadow-list {
  flex: 1;
  overflow-y: auto;
}

.foreshadow-item {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;

  &:hover {
    border-color: var(--el-color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .title {
      font-weight: 500;
      font-size: 14px;
    }
  }

  .item-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12px;

    .chapter-info {
      color: var(--el-text-color-secondary);
    }
  }

  .item-actions {
    position: absolute;
    right: 8px;
    top: 8px;
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

.planted-text {
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  padding: 8px;
  border-radius: 4px;
  max-height: 100px;
  overflow-y: auto;
}
</style>
