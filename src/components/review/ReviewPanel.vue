<template>
  <div class="review-panel">
    <!-- 头部统计 -->
    <div class="review-header">
      <div class="stats-cards">
        <div class="stat-card error" v-if="errorCount > 0">
          <el-icon><CircleCloseFilled /></el-icon>
          <span class="count">{{ errorCount }}</span>
          <span class="label">错误</span>
        </div>
        <div class="stat-card warning" v-if="warningCount > 0">
          <el-icon><WarningFilled /></el-icon>
          <span class="count">{{ warningCount }}</span>
          <span class="label">警告</span>
        </div>
        <div class="stat-card suggestion" v-if="suggestionCount > 0">
          <el-icon><InfoFilled /></el-icon>
          <span class="count">{{ suggestionCount }}</span>
          <span class="label">建议</span>
        </div>
        <div class="stat-card success" v-if="openCount === 0">
          <el-icon><CircleCheckFilled /></el-icon>
          <span class="label">无问题</span>
        </div>
      </div>

      <div class="actions">
        <el-button
          type="primary"
          size="small"
          :loading="reviewing"
          @click="handleReviewChapter"
        >
          审查当前章节
        </el-button>
        <el-dropdown @command="handleCommand" trigger="click">
          <el-button size="small">
            更多 <el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="reviewBook">审查全书</el-dropdown-item>
              <el-dropdown-item command="quickReview">快速审查</el-dropdown-item>
              <el-dropdown-item command="clear" divided>清除所有问题</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 筛选器 -->
    <div class="filter-bar" v-if="issues.length > 0">
      <el-radio-group v-model="filterLevel" size="small">
        <el-radio-button label="">全部 ({{ openCount }})</el-radio-button>
        <el-radio-button label="error" v-if="errorCount > 0">错误 ({{ errorCount }})</el-radio-button>
        <el-radio-button label="warning" v-if="warningCount > 0">警告 ({{ warningCount }})</el-radio-button>
        <el-radio-button label="suggestion" v-if="suggestionCount > 0">建议 ({{ suggestionCount }})</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 问题列表 -->
    <div class="issues-list" v-if="filteredIssues.length > 0">
      <ReviewIssueItem
        v-for="issue in filteredIssues"
        :key="issue.id"
        :issue="issue"
        @fix="handleFix"
        @ignore="handleIgnore"
        @locate="handleLocate"
      />
    </div>

    <!-- 空状态 -->
    <div class="empty-state" v-else-if="!reviewing">
      <el-empty description="暂无审查问题">
        <el-button type="primary" @click="handleReviewChapter">开始审查</el-button>
      </el-empty>
    </div>

    <!-- 审查中 -->
    <div class="reviewing-state" v-if="reviewing">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>正在审查...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCloseFilled,
  WarningFilled,
  InfoFilled,
  CircleCheckFilled,
  ArrowDown,
  Loading
} from '@element-plus/icons-vue'
import { useReviewStore } from '@/stores/reviewStore'
import { useBookStore } from '@/stores/bookStore'
import { useChapterStore } from '@/stores/chapterStore'
import type { ReviewIssue, ReviewLevel } from '@/types/review'
import ReviewIssueItem from './ReviewIssueItem.vue'

const reviewStore = useReviewStore()
const bookStore = useBookStore()
const chapterStore = useChapterStore()

const filterLevel = ref<ReviewLevel | ''>('')

const issues = computed(() => reviewStore.openIssues)
const reviewing = computed(() => reviewStore.reviewing)

const openCount = computed(() => issues.value.length)
const errorCount = computed(() => reviewStore.errorIssues.length)
const warningCount = computed(() => reviewStore.warningIssues.length)
const suggestionCount = computed(() => reviewStore.suggestionIssues.length)

const filteredIssues = computed(() => {
  if (!filterLevel.value) {
    return issues.value
  }
  return issues.value.filter(i => i.level === filterLevel.value)
})

// 审查当前章节
async function handleReviewChapter() {
  const bookId = bookStore.currentBook?.id
  const chapterId = chapterStore.currentChapter?.id

  if (!bookId || !chapterId) {
    ElMessage.warning('请先选择章节')
    return
  }

  try {
    const report = await reviewStore.reviewChapter(bookId, chapterId)
    if (report.totalIssues === 0) {
      ElMessage.success('审查完成，未发现问题')
    } else {
      ElMessage.info(`审查完成，发现 ${report.totalIssues} 个问题`)
    }
  } catch (e) {
    ElMessage.error('审查失败')
  }
}

// 处理下拉命令
async function handleCommand(command: string) {
  const bookId = bookStore.currentBook?.id
  const chapterId = chapterStore.currentChapter?.id

  if (!bookId) {
    ElMessage.warning('请先选择书籍')
    return
  }

  switch (command) {
    case 'reviewBook':
      try {
        const report = await reviewStore.reviewBook(bookId)
        ElMessage.info(`全书审查完成，发现 ${report.totalIssues} 个问题`)
      } catch (e) {
        ElMessage.error('审查失败')
      }
      break

    case 'quickReview':
      if (!chapterId) {
        ElMessage.warning('请先选择章节')
        return
      }
      try {
        const report = await reviewStore.quickReview(bookId, chapterId)
        ElMessage.info(`快速审查完成，发现 ${report.totalIssues} 个错误`)
      } catch (e) {
        ElMessage.error('快速审查失败')
      }
      break

    case 'clear':
      try {
        await ElMessageBox.confirm('确定要清除所有审查问题吗？', '确认')
        await reviewStore.clearBookIssues(bookId)
        ElMessage.success('已清除所有问题')
      } catch {
        // 取消
      }
      break
  }
}

// 标记为已修复
async function handleFix(issue: ReviewIssue) {
  try {
    await reviewStore.updateIssueStatus(issue.id, 'fixed')
    ElMessage.success('已标记为已修复')
  } catch {
    ElMessage.error('操作失败')
  }
}

// 忽略问题
async function handleIgnore(issue: ReviewIssue) {
  try {
    await reviewStore.updateIssueStatus(issue.id, 'ignored')
    ElMessage.success('已忽略')
  } catch {
    ElMessage.error('操作失败')
  }
}

// 定位到问题位置
function handleLocate(issue: ReviewIssue) {
  // TODO: 实现编辑器定位功能
  console.log('Locate issue:', issue)
}

// 监听书籍变化
watch(
  () => bookStore.currentBook?.id,
  (bookId) => {
    if (bookId) {
      reviewStore.fetchBookIssues(bookId)
    } else {
      reviewStore.reset()
    }
  },
  { immediate: true }
)

onMounted(() => {
  reviewStore.fetchRules()
})
</script>

<style scoped lang="scss">
.review-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.review-header {
  margin-bottom: 12px;

  .stats-cards {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;

    .stat-card {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 13px;

      &.error {
        background: rgba(245, 108, 108, 0.1);
        color: #f56c6c;
      }

      &.warning {
        background: rgba(230, 162, 60, 0.1);
        color: #e6a23c;
      }

      &.suggestion {
        background: rgba(64, 158, 255, 0.1);
        color: #409eff;
      }

      &.success {
        background: rgba(103, 194, 58, 0.1);
        color: #67c23a;
      }

      .count {
        font-weight: 600;
        font-size: 16px;
      }

      .label {
        opacity: 0.8;
      }
    }
  }

  .actions {
    display: flex;
    gap: 8px;
  }
}

.filter-bar {
  margin-bottom: 12px;
}

.issues-list {
  flex: 1;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--el-border-color);
    border-radius: 2px;
  }
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reviewing-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-secondary);

  .is-loading {
    animation: rotate 1s linear infinite;
  }
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
