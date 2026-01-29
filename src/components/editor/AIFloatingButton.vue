<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAiStore } from '@/stores'

const aiStore = useAiStore()

// 是否展开
const isExpanded = ref(false)

// 是否正在生成
const isGenerating = computed(() => aiStore.generating)

// 思考过程内容
const reasoningContent = computed(() => aiStore.currentReasoning)

// 生成进度
const generatingProgress = computed(() => aiStore.generatingProgress)

// 进度百分比
const progressPercent = computed(() => {
  const { current, total } = generatingProgress.value
  if (total <= 0) return 0
  return Math.round((current / total) * 100)
})

// 当前阶段
const currentStage = computed(() => generatingProgress.value.stage || '准备中')

// 当开始生成时自动展开
watch(isGenerating, (val) => {
  if (val) {
    isExpanded.value = true
  }
})

// 切换展开/收起
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// 关闭面板
function closePanel() {
  isExpanded.value = false
}

// 清除思考过程
function clearReasoning() {
  aiStore.clearReasoning()
}
</script>

<template>
  <!-- 悬浮按钮（收起状态） -->
  <div
    v-if="!isExpanded"
    class="ai-floating-btn"
    :class="{ generating: isGenerating }"
    @click="toggleExpand"
  >
    <el-icon v-if="isGenerating" class="is-loading"><Loading /></el-icon>
    <el-icon v-else><ChatDotRound /></el-icon>
    <span v-if="isGenerating" class="progress-badge">{{ progressPercent }}%</span>
  </div>

  <!-- 展开的面板 -->
  <Transition name="float-panel">
    <div v-if="isExpanded" class="ai-floating-panel">
      <!-- 头部 -->
      <div class="panel-header">
        <div class="header-left">
          <el-icon><MagicStick /></el-icon>
          <span class="title">AI 思考过程</span>
          <el-tag v-if="isGenerating" type="primary" size="small" effect="dark">
            {{ currentStage }}
          </el-tag>
        </div>
        <div class="header-actions">
          <el-button
            v-if="reasoningContent"
            class="clear-btn"
            text
            size="small"
            @click="clearReasoning"
          >
            <el-icon><Delete /></el-icon>
          </el-button>
          <el-button class="minimize-btn" text size="small" @click="closePanel">
            <el-icon><Minus /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 进度条 -->
      <div v-if="isGenerating" class="progress-section">
        <el-progress
          :percentage="progressPercent"
          :stroke-width="4"
          :show-text="false"
          color="#f97316"
        />
        <div class="progress-steps">
          <div
            v-for="(step, index) in generatingProgress.steps"
            :key="step.id"
            class="step-item"
            :class="step.status"
          >
            <span class="step-num">{{ index + 1 }}</span>
            <span class="step-name">{{ step.name }}</span>
            <el-icon v-if="step.status === 'completed'" class="step-check">
              <CircleCheck />
            </el-icon>
            <el-icon v-else-if="step.status === 'running'" class="step-loading is-loading">
              <Loading />
            </el-icon>
          </div>
        </div>
      </div>

      <!-- 思考内容 -->
      <div class="panel-content">
        <div v-if="reasoningContent" class="reasoning-content">
          <pre>{{ reasoningContent }}</pre>
        </div>
        <div v-else-if="!isGenerating" class="empty-state">
          <el-icon><InfoFilled /></el-icon>
          <span>暂无思考过程</span>
        </div>
        <div v-else class="generating-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>AI正在思考中...</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
// 悬浮按钮
.ai-floating-btn {
  position: fixed;
  right: 24px;
  bottom: 80px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-primary, #f97316);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(249, 115, 22, 0.4);
  transition: all 0.3s ease;
  z-index: 1000;

  .el-icon {
    font-size: 22px;
  }

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 20px rgba(249, 115, 22, 0.5);
  }

  &.generating {
    animation: pulse-glow 2s infinite;
  }

  .progress-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 24px;
    height: 18px;
    padding: 0 4px;
    font-size: 10px;
    font-weight: 600;
    background-color: #22c55e;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
}

// 展开的面板
.ai-floating-panel {
  position: fixed;
  right: 24px;
  bottom: 80px;
  width: 360px;
  max-height: 480px;
  background-color: var(--bg-elevated, #262626);
  border: 1px solid var(--border-base, #333);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 1000;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background-color: var(--bg-surface, #1a1a1a);
  border-bottom: 1px solid var(--border-base, #333);

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;

    .el-icon {
      font-size: 18px;
      color: var(--color-primary, #f97316);
    }

    .title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary, #f5f5f5);
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;

    .el-button {
      padding: 4px;
      color: var(--text-secondary, #a3a3a3);

      &:hover {
        color: var(--text-primary, #f5f5f5);
      }
    }
  }
}

.progress-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-base, #333);

  .el-progress {
    margin-bottom: 12px;
  }

  .progress-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .step-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background-color: var(--bg-hover, #333);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-secondary, #a3a3a3);

    .step-num {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--bg-active, #404040);
      border-radius: 50%;
      font-size: 10px;
      font-weight: 600;
    }

    &.running {
      color: var(--color-primary, #f97316);
      background-color: rgba(249, 115, 22, 0.15);

      .step-num {
        background-color: var(--color-primary, #f97316);
        color: white;
      }
    }

    &.completed {
      color: #22c55e;

      .step-num {
        background-color: #22c55e;
        color: white;
      }

      .step-check {
        color: #22c55e;
      }
    }

    .step-loading {
      color: var(--color-primary, #f97316);
    }
  }
}

.panel-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  min-height: 120px;
  max-height: 300px;
}

.reasoning-content {
  pre {
    margin: 0;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-primary, #f5f5f5);
    white-space: pre-wrap;
    word-break: break-word;
  }
}

.empty-state,
.generating-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: var(--text-secondary, #a3a3a3);
  font-size: 13px;

  .el-icon {
    font-size: 32px;
  }
}

// 动画
@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.4);
  }
  50% {
    box-shadow: 0 4px 24px rgba(249, 115, 22, 0.7);
  }
}

.float-panel-enter-active,
.float-panel-leave-active {
  transition: all 0.3s ease;
}

.float-panel-enter-from,
.float-panel-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.95);
}

// 浅色主题
:global(.theme-light) {
  .ai-floating-btn {
    box-shadow: 0 4px 12px rgba(249, 115, 22, 0.3);
  }

  .ai-floating-panel {
    --bg-elevated: #ffffff;
    --bg-surface: #f8fafc;
    --border-base: #e2e8f0;
    --text-primary: #1e293b;
    --text-secondary: #64748b;
    --bg-hover: #f1f5f9;
    --bg-active: #e2e8f0;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  }
}
</style>
