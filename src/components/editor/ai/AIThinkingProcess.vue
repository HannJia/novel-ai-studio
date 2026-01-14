<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAiStore } from '@/stores'

const aiStore = useAiStore()

const props = defineProps<{
  embedded?: boolean // 是否嵌入模式（嵌入右侧面板）
}>()

// 思考步骤
interface ThinkingStep {
  id: string
  type: 'context' | 'character' | 'visual' | 'logic' | 'generating'
  title: string
  detail: string
  status: 'pending' | 'running' | 'completed' | 'error'
  progress?: number
}

const steps = ref<ThinkingStep[]>([])
const isCollapsed = ref(false)

// 模拟思考过程（实际应该从后端流式接收）
const mockSteps: ThinkingStep[] = [
  {
    id: '1',
    type: 'context',
    title: '加载上下文',
    detail: '正在读取前文 50 章的摘要...',
    status: 'completed'
  },
  {
    id: '2',
    type: 'character',
    title: '角色分析',
    detail: '检测到出场角色: 林枫(主), 守卫(新)',
    status: 'completed'
  },
  {
    id: '3',
    type: 'visual',
    title: '素材识别',
    detail: '识别视觉素材 "荒塔.jpg" → 荒凉、神秘、古老',
    status: 'completed'
  },
  {
    id: '4',
    type: 'logic',
    title: '逻辑检查',
    detail: '角色状态: 林枫当前为"轻伤"，动作需考虑伤势',
    status: 'running'
  },
  {
    id: '5',
    type: 'generating',
    title: '内容生成',
    detail: '正在生成内容...',
    status: 'pending',
    progress: 0
  }
]

// 根据AI生成状态更新步骤
const currentSteps = computed(() => {
  if (!aiStore.generating) {
    return []
  }
  return mockSteps
})

// 当 AI 开始生成时自动展开
watch(() => aiStore.generating, (generating) => {
  if (generating) {
    isCollapsed.value = false
  }
})

const statusIcon = (status: string) => {
  switch (status) {
    case 'completed': return 'CircleCheckFilled'
    case 'running': return 'Loading'
    case 'error': return 'CircleCloseFilled'
    default: return 'Clock'
  }
}

const statusClass = (status: string) => {
  return `status-${status}`
}
</script>

<template>
  <div
    class="thinking-process"
    :class="{ collapsed: isCollapsed, embedded: embedded }"
    v-if="aiStore.generating || embedded"
  >
    <!-- 头部 -->
    <div class="thinking-header" @click="isCollapsed = !isCollapsed">
      <div class="header-left">
        <el-icon v-if="aiStore.generating" class="thinking-icon is-loading"><Loading /></el-icon>
        <el-icon v-else class="thinking-icon idle"><MagicStick /></el-icon>
        <span class="header-title">AI 思考过程</span>
      </div>
      <el-button class="collapse-btn" text size="small">
        <el-icon>
          <ArrowUp v-if="!isCollapsed" />
          <ArrowDown v-else />
        </el-icon>
      </el-button>
    </div>

    <!-- 内容区 -->
    <div class="thinking-content" v-show="!isCollapsed">
      <!-- AI 未生成时的提示 -->
      <div v-if="!aiStore.generating" class="idle-state">
        <p class="idle-tip">点击"AI续写"按钮后，这里将显示 AI 的思考过程</p>
      </div>

      <!-- AI 正在生成时显示步骤 -->
      <template v-else>
        <div class="steps-list">
          <div
            v-for="step in currentSteps"
            :key="step.id"
            class="step-item"
            :class="statusClass(step.status)"
          >
            <div class="step-icon">
              <el-icon v-if="step.status === 'running'" class="is-loading">
                <Loading />
              </el-icon>
              <el-icon v-else-if="step.status === 'completed'" class="completed">
                <CircleCheckFilled />
              </el-icon>
              <el-icon v-else-if="step.status === 'error'" class="error">
                <CircleCloseFilled />
              </el-icon>
              <el-icon v-else class="pending">
                <Clock />
              </el-icon>
            </div>
            <div class="step-content">
              <div class="step-title">{{ step.title }}</div>
              <div class="step-detail">{{ step.detail }}</div>
              <el-progress
                v-if="step.progress !== undefined && step.status === 'running'"
                :percentage="step.progress"
                :stroke-width="4"
                :show-text="false"
                class="step-progress"
              />
            </div>
          </div>
        </div>

        <!-- 底部提示 -->
        <div class="thinking-footer">
          <span class="footer-tip">
            <el-icon><InfoFilled /></el-icon>
            AI 正在根据上下文和设定生成内容
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.thinking-process {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% - 48px);
  max-width: 600px;
  background-color: var(--panel-bg, $bg-base);
  border-radius: $border-radius-card;
  box-shadow: var(--panel-shadow, 0 4px 24px rgba(0, 0, 0, 0.15));
  z-index: $z-thinking-panel;
  overflow: hidden;
  transition: all $transition-duration $transition-ease;

  // 嵌入模式样式（在右侧面板中）
  &.embedded {
    position: static;
    transform: none;
    width: 100%;
    max-width: none;
    box-shadow: none;
    border: 1px solid var(--border-color, $border-lighter);
    margin-top: 16px;
  }

  &.collapsed {
    .thinking-content {
      max-height: 0;
      padding: 0 16px;
    }
  }
}

.thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background-color: var(--header-bg, $light-bg-panel);
  cursor: pointer;
  user-select: none;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;

    .thinking-icon {
      font-size: 16px;
      color: $primary-color;

      &.idle {
        color: var(--text-secondary, $text-secondary);
      }
    }

    .header-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
    }
  }

  .collapse-btn {
    padding: 4px;
    color: var(--text-secondary, $text-secondary);
  }
}

.thinking-content {
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
  transition: all $transition-duration $transition-ease;
}

// 空闲状态
.idle-state {
  padding: 24px 16px;
  text-align: center;

  .idle-tip {
    font-size: 13px;
    color: var(--text-secondary, $text-secondary);
    margin: 0;
  }
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-item {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  background-color: var(--step-bg, $light-bg-panel);
  border-radius: $border-radius-large;
  transition: all $transition-duration-fast $transition-ease;

  &.status-completed {
    .step-icon .completed {
      color: $success-color;
    }
  }

  &.status-running {
    background-color: var(--step-active-bg, rgba($primary-color, 0.1));
    border: 1px solid rgba($primary-color, 0.2);

    .step-icon .is-loading {
      color: $primary-color;
    }
  }

  &.status-error {
    .step-icon .error {
      color: $danger-color;
    }
  }

  &.status-pending {
    opacity: 0.6;

    .step-icon .pending {
      color: var(--text-placeholder, $text-placeholder);
    }
  }

  .step-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;

    .el-icon {
      font-size: 16px;
    }
  }

  .step-content {
    flex: 1;
    min-width: 0;

    .step-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      margin-bottom: 4px;
    }

    .step-detail {
      font-size: 12px;
      color: var(--text-secondary, $text-secondary);
      line-height: 1.4;
    }

    .step-progress {
      margin-top: 8px;
    }
  }
}

.thinking-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, $border-lighter);

  .footer-tip {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary, $text-secondary);

    .el-icon {
      font-size: 14px;
    }
  }
}

// 深色主题适配
:global(html.dark) .thinking-process {
  --panel-bg: #{$dark-bg-card};
  --panel-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  --header-bg: #{$dark-bg-panel};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --text-placeholder: #{$dark-text-placeholder};
  --step-bg: #{$dark-bg-panel};
  --step-active-bg: rgba(#{$primary-color}, 0.15);
  --border-color: #{$dark-border-lighter};
}
</style>
