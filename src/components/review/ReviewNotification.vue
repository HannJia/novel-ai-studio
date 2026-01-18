<template>
  <div class="review-notification" v-if="visible">
    <transition name="slide-fade">
      <div class="notification-content" v-if="showContent">
        <div class="notification-header">
          <el-icon class="icon" :class="levelClass">
            <CircleCloseFilled v-if="level === 'error'" />
            <WarningFilled v-else-if="level === 'warning'" />
            <InfoFilled v-else />
          </el-icon>
          <span class="title">{{ title }}</span>
          <el-button
            type="text"
            size="small"
            class="close-btn"
            @click="handleClose"
          >
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
        <div class="notification-body">
          <p class="message">{{ message }}</p>
          <div class="actions" v-if="showActions">
            <el-button size="small" @click="handleViewDetail">查看详情</el-button>
            <el-button size="small" type="text" @click="handleIgnore">忽略</el-button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { CircleCloseFilled, WarningFilled, InfoFilled, Close } from '@element-plus/icons-vue'
import { useReviewStore } from '@/stores/reviewStore'
import { useBookStore } from '@/stores/bookStore'
import { useChapterStore } from '@/stores/chapterStore'
import type { ReviewLevel } from '@/types/review'

const props = defineProps<{
  autoHide?: boolean
  hideDelay?: number
}>()

const emit = defineEmits<{
  viewDetail: []
  close: []
}>()

const reviewStore = useReviewStore()
const bookStore = useBookStore()
const chapterStore = useChapterStore()

const visible = ref(false)
const showContent = ref(false)
const level = ref<ReviewLevel>('error')
const title = ref('')
const message = ref('')
const showActions = ref(true)

let hideTimer: number | null = null

const levelClass = computed(() => ({
  error: level.value === 'error',
  warning: level.value === 'warning',
  suggestion: level.value === 'suggestion',
  info: level.value === 'info'
}))

// 显示通知
function show(options: {
  level: ReviewLevel
  title: string
  message: string
  showActions?: boolean
}) {
  level.value = options.level
  title.value = options.title
  message.value = options.message
  showActions.value = options.showActions ?? true

  visible.value = true
  setTimeout(() => {
    showContent.value = true
  }, 50)

  // 自动隐藏
  if (props.autoHide) {
    if (hideTimer) {
      clearTimeout(hideTimer)
    }
    hideTimer = window.setTimeout(() => {
      handleClose()
    }, props.hideDelay || 5000)
  }
}

// 关闭通知
function handleClose() {
  showContent.value = false
  setTimeout(() => {
    visible.value = false
  }, 300)
  emit('close')
}

// 查看详情
function handleViewDetail() {
  emit('viewDetail')
  handleClose()
}

// 忽略
function handleIgnore() {
  handleClose()
}

// 监听审查结果变化
watch(
  () => reviewStore.currentReport,
  (report) => {
    if (report && report.totalIssues > 0) {
      const errorCount = report.issuesByLevel['error'] || 0
      const warningCount = report.issuesByLevel['warning'] || 0
      const suggestionCount = report.issuesByLevel['suggestion'] || 0

      let notificationLevel: ReviewLevel = 'info'
      let notificationTitle = ''
      let notificationMessage = ''

      if (errorCount > 0) {
        notificationLevel = 'error'
        notificationTitle = `发现 ${errorCount} 个错误`
        notificationMessage = `检测到 ${errorCount} 个需要立即修复的问题`
      } else if (warningCount > 0) {
        notificationLevel = 'warning'
        notificationTitle = `发现 ${warningCount} 个警告`
        notificationMessage = `检测到 ${warningCount} 个需要关注的问题`
      } else if (suggestionCount > 0) {
        notificationLevel = 'suggestion'
        notificationTitle = `${suggestionCount} 条建议`
        notificationMessage = `有 ${suggestionCount} 条优化建议供参考`
      }

      if (notificationTitle) {
        show({
          level: notificationLevel,
          title: notificationTitle,
          message: notificationMessage
        })
      }
    }
  }
)

// 暴露方法
defineExpose({
  show,
  close: handleClose
})

onUnmounted(() => {
  if (hideTimer) {
    clearTimeout(hideTimer)
  }
})
</script>

<style scoped lang="scss">
.review-notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2000;
}

.notification-content {
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 300px;
  max-width: 400px;
  overflow: hidden;
}

.notification-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .icon {
    font-size: 20px;
    margin-right: 8px;

    &.error {
      color: #f56c6c;
    }

    &.warning {
      color: #e6a23c;
    }

    &.suggestion {
      color: #409eff;
    }

    &.info {
      color: #909399;
    }
  }

  .title {
    flex: 1;
    font-weight: 500;
  }

  .close-btn {
    padding: 4px;
    margin: -4px;
  }
}

.notification-body {
  padding: 12px 16px;

  .message {
    margin: 0 0 12px 0;
    color: var(--el-text-color-regular);
    font-size: 14px;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.3s ease-in;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}
</style>
