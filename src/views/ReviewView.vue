<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCloseFilled,
  WarningFilled,
  InfoFilled,
  CircleCheckFilled,
  Refresh,
  Delete,
  Filter,
  Download
} from '@element-plus/icons-vue'
import { useReviewStore } from '@/stores/reviewStore'
import { useBookStore } from '@/stores/bookStore'
import type { ReviewIssue, ReviewLevel } from '@/types/review'
import { REVIEW_LEVEL_CONFIG, REVIEW_TYPE_LABELS } from '@/types/review'

const route = useRoute()
const bookId = route.params.bookId as string

const reviewStore = useReviewStore()
const bookStore = useBookStore()

const filterLevel = ref<ReviewLevel | ''>('')
const filterStatus = ref<'open' | 'fixed' | 'ignored' | ''>('open')
const selectedIssues = ref<string[]>([])

const book = computed(() => bookStore.currentBook)
const issues = computed(() => reviewStore.issues)
const reviewing = computed(() => reviewStore.reviewing)
const stats = computed(() => reviewStore.stats)

const filteredIssues = computed(() => {
  let result = issues.value

  if (filterStatus.value) {
    result = result.filter(i => i.status === filterStatus.value)
  }

  if (filterLevel.value) {
    result = result.filter(i => i.level === filterLevel.value)
  }

  return result
})

const openCount = computed(() => issues.value.filter(i => i.status === 'open').length)
const errorCount = computed(() => issues.value.filter(i => i.status === 'open' && i.level === 'error').length)
const warningCount = computed(() => issues.value.filter(i => i.status === 'open' && i.level === 'warning').length)
const suggestionCount = computed(() => issues.value.filter(i => i.status === 'open' && i.level === 'suggestion').length)

// 加载数据
async function loadData() {
  if (!bookId) return
  await bookStore.fetchBook(bookId)
  await reviewStore.fetchBookIssues(bookId)
  await reviewStore.fetchStats(bookId)
}

// 全书审查
async function handleReviewBook() {
  try {
    const report = await reviewStore.reviewBook(bookId)
    ElMessage.success(`审查完成，发现 ${report.totalIssues} 个问题`)
    await reviewStore.fetchStats(bookId)
  } catch (e) {
    ElMessage.error('审查失败')
  }
}

// 快速审查（仅错误）
async function handleQuickReview() {
  try {
    const report = await reviewStore.reviewBook(bookId, ['error'])
    ElMessage.success(`快速审查完成，发现 ${report.totalIssues} 个错误`)
    await reviewStore.fetchStats(bookId)
  } catch (e) {
    ElMessage.error('审查失败')
  }
}

// 清除所有问题
async function handleClearAll() {
  try {
    await ElMessageBox.confirm('确定要清除所有审查问题吗？', '确认')
    await reviewStore.clearBookIssues(bookId)
    ElMessage.success('已清除所有问题')
    await reviewStore.fetchStats(bookId)
  } catch {
    // 取消
  }
}

// 批量操作
async function handleBatchAction(action: 'fix' | 'ignore' | 'delete') {
  if (selectedIssues.value.length === 0) {
    ElMessage.warning('请先选择问题')
    return
  }

  try {
    if (action === 'delete') {
      await ElMessageBox.confirm(`确定要删除选中的 ${selectedIssues.value.length} 个问题吗？`, '确认')
      for (const id of selectedIssues.value) {
        await reviewStore.deleteIssue(id)
      }
    } else {
      const status = action === 'fix' ? 'fixed' : 'ignored'
      await reviewStore.batchUpdateStatus(selectedIssues.value, status)
    }
    selectedIssues.value = []
    ElMessage.success('操作成功')
    await reviewStore.fetchStats(bookId)
  } catch {
    // 取消或失败
  }
}

// 更新单个问题状态
async function handleUpdateStatus(issue: ReviewIssue, status: 'open' | 'fixed' | 'ignored') {
  try {
    await reviewStore.updateIssueStatus(issue.id, status)
    ElMessage.success('状态已更新')
  } catch {
    ElMessage.error('操作失败')
  }
}

// 导出报告
function handleExport() {
  const report = {
    bookId,
    bookTitle: book.value?.title,
    generatedAt: new Date().toISOString(),
    stats: {
      total: openCount.value,
      error: errorCount.value,
      warning: warningCount.value,
      suggestion: suggestionCount.value
    },
    issues: issues.value.filter(i => i.status === 'open').map(i => ({
      level: i.level,
      type: i.type,
      title: i.title,
      description: i.description,
      chapterOrder: i.chapterOrder,
      suggestion: i.suggestion
    }))
  }

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `review-report-${book.value?.title || bookId}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 获取级别配置
function getLevelConfig(level: ReviewLevel) {
  return REVIEW_LEVEL_CONFIG[level]
}

// 获取类型标签
function getTypeLabel(type: string) {
  return REVIEW_TYPE_LABELS[type as keyof typeof REVIEW_TYPE_LABELS] || type
}

onMounted(() => {
  loadData()
})

watch(() => route.params.bookId, () => {
  loadData()
})
</script>

<template>
  <div class="review-view">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>审查报告</h1>
        <p v-if="book">{{ book.title }}</p>
      </div>
      <div class="header-right">
        <el-button type="primary" :loading="reviewing" @click="handleReviewBook">
          <el-icon><Refresh /></el-icon>
          全书审查
        </el-button>
        <el-button :loading="reviewing" @click="handleQuickReview">
          快速审查
        </el-button>
        <el-button @click="handleExport">
          <el-icon><Download /></el-icon>
          导出报告
        </el-button>
        <el-button type="danger" plain @click="handleClearAll">
          <el-icon><Delete /></el-icon>
          清除全部
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-section">
      <div class="stat-card total">
        <div class="stat-value">{{ openCount }}</div>
        <div class="stat-label">待处理问题</div>
      </div>
      <div class="stat-card error" @click="filterLevel = 'error'">
        <el-icon><CircleCloseFilled /></el-icon>
        <div class="stat-value">{{ errorCount }}</div>
        <div class="stat-label">错误</div>
      </div>
      <div class="stat-card warning" @click="filterLevel = 'warning'">
        <el-icon><WarningFilled /></el-icon>
        <div class="stat-value">{{ warningCount }}</div>
        <div class="stat-label">警告</div>
      </div>
      <div class="stat-card suggestion" @click="filterLevel = 'suggestion'">
        <el-icon><InfoFilled /></el-icon>
        <div class="stat-value">{{ suggestionCount }}</div>
        <div class="stat-label">建议</div>
      </div>
    </div>

    <!-- 筛选工具栏 -->
    <div class="filter-toolbar">
      <div class="filter-left">
        <el-radio-group v-model="filterStatus" size="small">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="open">待处理</el-radio-button>
          <el-radio-button label="fixed">已修复</el-radio-button>
          <el-radio-button label="ignored">已忽略</el-radio-button>
        </el-radio-group>

        <el-select v-model="filterLevel" placeholder="按级别筛选" clearable size="small" style="width: 120px;">
          <el-option label="错误" value="error" />
          <el-option label="警告" value="warning" />
          <el-option label="建议" value="suggestion" />
          <el-option label="提示" value="info" />
        </el-select>
      </div>

      <div class="filter-right" v-if="selectedIssues.length > 0">
        <span class="selected-count">已选 {{ selectedIssues.length }} 项</span>
        <el-button size="small" type="success" @click="handleBatchAction('fix')">标记已修复</el-button>
        <el-button size="small" @click="handleBatchAction('ignore')">忽略</el-button>
        <el-button size="small" type="danger" @click="handleBatchAction('delete')">删除</el-button>
      </div>
    </div>

    <!-- 问题列表 -->
    <div class="issues-table">
      <el-table
        :data="filteredIssues"
        @selection-change="(val: ReviewIssue[]) => selectedIssues = val.map(i => i.id)"
        style="width: 100%"
        row-key="id"
      >
        <el-table-column type="selection" width="40" />

        <el-table-column label="级别" width="80">
          <template #default="{ row }">
            <el-tag :type="getLevelConfig(row.level).tagType" size="small" effect="dark">
              {{ getLevelConfig(row.level).label }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            {{ getTypeLabel(row.type) }}
          </template>
        </el-table-column>

        <el-table-column label="问题" min-width="300">
          <template #default="{ row }">
            <div class="issue-cell">
              <div class="issue-title">{{ row.title }}</div>
              <div class="issue-desc">{{ row.description }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="章节" width="80">
          <template #default="{ row }">
            第{{ row.chapterOrder }}章
          </template>
        </el-table-column>

        <el-table-column label="置信度" width="100">
          <template #default="{ row }">
            <el-progress
              v-if="row.confidence"
              :percentage="Math.round(row.confidence * 100)"
              :stroke-width="4"
              :show-text="true"
            />
            <span v-else>-</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag
              :type="row.status === 'open' ? 'danger' : row.status === 'fixed' ? 'success' : 'info'"
              size="small"
            >
              {{ row.status === 'open' ? '待处理' : row.status === 'fixed' ? '已修复' : '已忽略' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'open'"
              type="success"
              size="small"
              text
              @click="handleUpdateStatus(row, 'fixed')"
            >
              已修复
            </el-button>
            <el-button
              v-if="row.status === 'open'"
              type="info"
              size="small"
              text
              @click="handleUpdateStatus(row, 'ignored')"
            >
              忽略
            </el-button>
            <el-button
              v-if="row.status !== 'open'"
              type="warning"
              size="small"
              text
              @click="handleUpdateStatus(row, 'open')"
            >
              重新打开
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div class="empty-state" v-if="filteredIssues.length === 0 && !reviewing">
        <el-empty :description="openCount === 0 ? '暂无审查问题' : '当前筛选条件下无问题'">
          <el-button type="primary" @click="handleReviewBook" v-if="openCount === 0">开始审查</el-button>
        </el-empty>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.review-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
  overflow: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;

  .header-left {
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    p {
      color: var(--el-text-color-secondary);
    }
  }

  .header-right {
    display: flex;
    gap: 8px;
  }
}

.stats-section {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;

  .stat-card {
    flex: 1;
    padding: 20px;
    border-radius: 8px;
    background: var(--el-fill-color-light);
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .el-icon {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 32px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .stat-label {
      font-size: 14px;
      color: var(--el-text-color-secondary);
    }

    &.total {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;

      .stat-label {
        color: rgba(255, 255, 255, 0.8);
      }
    }

    &.error {
      border-left: 4px solid #f56c6c;

      .el-icon {
        color: #f56c6c;
      }
    }

    &.warning {
      border-left: 4px solid #e6a23c;

      .el-icon {
        color: #e6a23c;
      }
    }

    &.suggestion {
      border-left: 4px solid #409eff;

      .el-icon {
        color: #409eff;
      }
    }
  }
}

.filter-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;

  .filter-left {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .filter-right {
    display: flex;
    gap: 8px;
    align-items: center;

    .selected-count {
      color: var(--el-text-color-secondary);
      margin-right: 8px;
    }
  }
}

.issues-table {
  flex: 1;
  min-height: 0;

  .issue-cell {
    .issue-title {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .issue-desc {
      font-size: 12px;
      color: var(--el-text-color-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}

.empty-state {
  padding: 60px 0;
}
</style>
