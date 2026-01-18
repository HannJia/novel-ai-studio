<script setup lang="ts">
import { ref, computed, watchEffect, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore, useAiStore, useChapterStore, useBookStore } from '@/stores'
import CharacterPanel from './panels/CharacterPanel.vue'
import KnowledgePanel from './panels/KnowledgePanel.vue'
import ForeshadowPanel from './panels/ForeshadowPanel.vue'
import TimelinePanel from './panels/TimelinePanel.vue'
import SummaryPanel from './panels/SummaryPanel.vue'
import AIThinkingProcess from './ai/AIThinkingProcess.vue'

const router = useRouter()
const uiStore = useUiStore()
const aiStore = useAiStore()
const chapterStore = useChapterStore()
const bookStore = useBookStore()

const emit = defineEmits<{
  continueWriting: [wordRange: [number, number]]
  generateChapter: [wordRange: [number, number]]
  saveOutline: []
  generateOutline: []
  'update:chapterWordMin': [value: number]
  'update:chapterWordMax': [value: number]
  'update:continueWordMin': [value: number]
  'update:continueWordMax': [value: number]
  'update:temperature': [value: number]
}>()

const props = defineProps<{
  chapterOutline: string
  bookOutline: string
  outlineTab: 'book' | 'chapter'
  chapterWordMin?: number
  chapterWordMax?: number
  continueWordMin?: number
  continueWordMax?: number
  temperature?: number
}>()

// 本地状态 - 添加记忆系统标签
const activeTab = ref<'character' | 'knowledge' | 'memory' | 'ai'>('character')

// 记忆系统子标签
const memorySubTab = ref<'summary' | 'timeline' | 'foreshadow'>('foreshadow')

// 使用 watchEffect 确保响应式更新嵌入面板可见状态
watchEffect(() => {
  aiStore.embeddedPanelVisible = activeTab.value === 'ai' && uiStore.rightPanelVisible
})

// 组件卸载时重置状态
onUnmounted(() => {
  aiStore.embeddedPanelVisible = false
})

// 生成配置 - 使用计算属性绑定到 props，支持双向绑定
const chapterWordMinValue = computed({
  get: () => props.chapterWordMin ?? 2000,
  set: (v) => emit('update:chapterWordMin', v)
})
const chapterWordMaxValue = computed({
  get: () => props.chapterWordMax ?? 4000,
  set: (v) => emit('update:chapterWordMax', v)
})
const continueWordMinValue = computed({
  get: () => props.continueWordMin ?? 300,
  set: (v) => emit('update:continueWordMin', v)
})
const continueWordMaxValue = computed({
  get: () => props.continueWordMax ?? 800,
  set: (v) => emit('update:continueWordMax', v)
})
const temperatureValue = computed({
  get: () => props.temperature ?? 0.7,
  set: (v) => emit('update:temperature', v)
})

// 触发续写
function handleContinueWriting(): void {
  emit('continueWriting', [continueWordMinValue.value, continueWordMaxValue.value])
}

// 触发章节生成
function handleGenerateChapter(): void {
  emit('generateChapter', [chapterWordMinValue.value, chapterWordMaxValue.value])
}
</script>

<template>
  <aside class="editor-right-panel" v-show="uiStore.rightPanelVisible">
    <!-- 标签切换 -->
    <div class="panel-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'character' }"
        @click="activeTab = 'character'"
      >
        <el-icon><User /></el-icon>
        <span>角色</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'knowledge' }"
        @click="activeTab = 'knowledge'"
      >
        <el-icon><FolderOpened /></el-icon>
        <span>知识</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'memory' }"
        @click="activeTab = 'memory'"
      >
        <el-icon><Memo /></el-icon>
        <span>记忆</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'ai' }"
        @click="activeTab = 'ai'"
      >
        <el-icon><MagicStick /></el-icon>
        <span>生成</span>
      </button>
    </div>

    <!-- 面板内容 -->
    <div class="panel-content">
      <!-- 角色面板 -->
      <CharacterPanel v-if="activeTab === 'character'" />

      <!-- 知识库面板 -->
      <KnowledgePanel v-else-if="activeTab === 'knowledge'" />

      <!-- 记忆系统面板 -->
      <div v-else-if="activeTab === 'memory'" class="memory-panel">
        <!-- 记忆子标签 -->
        <div class="memory-sub-tabs">
          <el-radio-group v-model="memorySubTab" size="small">
            <el-radio-button value="foreshadow">伏笔</el-radio-button>
            <el-radio-button value="timeline">事件</el-radio-button>
            <el-radio-button value="summary">摘要</el-radio-button>
          </el-radio-group>
        </div>
        <!-- 子面板内容 -->
        <div class="memory-content">
          <ForeshadowPanel v-if="memorySubTab === 'foreshadow'" />
          <TimelinePanel v-else-if="memorySubTab === 'timeline'" />
          <SummaryPanel v-else-if="memorySubTab === 'summary'" />
        </div>
      </div>

      <!-- 生成配置面板 -->
      <div v-else-if="activeTab === 'ai'" class="generate-panel">
        <!-- 无AI配置提示 -->
        <div v-if="!aiStore.hasConfig" class="no-config-tip">
          <el-icon class="tip-icon"><WarningFilled /></el-icon>
          <p>尚未配置AI</p>
          <el-button type="primary" size="small" @click="router.push('/config')">
            前往配置
          </el-button>
        </div>

        <template v-else>
          <!-- 生成参数 -->
          <div class="config-section">
            <h4 class="section-title">
              <el-icon><Setting /></el-icon>
              生成配置
            </h4>
            <div class="config-form">
              <!-- 章节生成字数区间 -->
              <div class="form-item">
                <label>章节生成字数</label>
                <div class="range-inputs">
                  <el-input-number
                    v-model="chapterWordMinValue"
                    :min="500"
                    :max="chapterWordMaxValue - 100"
                    :step="100"
                    size="small"
                    controls-position="right"
                  />
                  <span class="range-separator">~</span>
                  <el-input-number
                    v-model="chapterWordMaxValue"
                    :min="chapterWordMinValue + 100"
                    :max="10000"
                    :step="100"
                    size="small"
                    controls-position="right"
                  />
                  <span class="range-unit">字</span>
                </div>
              </div>

              <!-- 续写字数区间 -->
              <div class="form-item">
                <label>续写字数</label>
                <div class="range-inputs">
                  <el-input-number
                    v-model="continueWordMinValue"
                    :min="100"
                    :max="continueWordMaxValue - 50"
                    :step="50"
                    size="small"
                    controls-position="right"
                  />
                  <span class="range-separator">~</span>
                  <el-input-number
                    v-model="continueWordMaxValue"
                    :min="continueWordMinValue + 50"
                    :max="3000"
                    :step="50"
                    size="small"
                    controls-position="right"
                  />
                  <span class="range-unit">字</span>
                </div>
              </div>

              <!-- 创意温度 -->
              <div class="form-item">
                <label>创意温度</label>
                <div class="range-input">
                  <el-slider
                    v-model="temperatureValue"
                    :min="0"
                    :max="1"
                    :step="0.1"
                  />
                  <span class="range-value">{{ temperatureValue }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 生成按钮 -->
          <div class="action-buttons">
            <el-button
              type="primary"
              class="generate-btn"
              @click="handleContinueWriting"
              :loading="aiStore.generating"
            >
              <el-icon><MagicStick /></el-icon>
              AI 续写
            </el-button>
          </div>

          <!-- 当前配置信息 -->
          <div class="config-info">
            <span class="info-label">当前模型:</span>
            <span class="info-value">{{ aiStore.defaultConfig?.model || '未配置' }}</span>
          </div>

          <!-- AI 思考过程和对话（常驻显示） -->
          <AIThinkingProcess :embedded="true" :always-show-chat="true" />
        </template>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.editor-right-panel {
  width: $right-panel-width;
  background-color: var(--panel-bg, $bg-base);
  border-left: 1px solid var(--border-color, $border-light);
  display: flex;
  flex-direction: column;
  transition: all $transition-duration $transition-ease;
}

.panel-tabs {
  display: flex;
  padding: 8px;
  gap: 4px;
  border-bottom: 1px solid var(--border-color, $border-lighter);

  .tab-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px;
    border: none;
    border-radius: $border-radius-large;
    background: transparent;
    color: var(--text-secondary, $text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all $transition-duration-fast $transition-ease;

    .el-icon {
      font-size: 18px;
    }

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-bg, $light-bg-active);
      color: $primary-color;
    }
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

// 生成配置面板
.generate-panel {
  .no-config-tip {
    text-align: center;
    padding: 32px 16px;

    .tip-icon {
      font-size: 40px;
      color: $warning-color;
      margin-bottom: 12px;
    }

    p {
      color: var(--text-secondary, $text-secondary);
      margin-bottom: 16px;
    }
  }

  .config-section {
    margin-bottom: 20px;

    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary, $text-primary);
      margin-bottom: 16px;

      .el-icon {
        font-size: 16px;
        color: var(--text-secondary, $text-secondary);
      }
    }
  }

  .config-form {
    display: flex;
    flex-direction: column;
    gap: 16px;

    .form-item {
      label {
        display: block;
        font-size: 13px;
        color: var(--text-secondary, $text-secondary);
        margin-bottom: 8px;
      }

      .range-input {
        display: flex;
        align-items: center;
        gap: 12px;

        .el-slider {
          flex: 1;
        }

        .range-value {
          font-size: 12px;
          color: var(--text-regular, $text-regular);
          min-width: 50px;
          text-align: right;
        }
      }

      .range-inputs {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;

        :deep(.el-input-number) {
          width: 90px;

          .el-input__inner {
            padding-left: 8px;
            padding-right: 8px;
          }
        }

        .range-separator {
          color: var(--text-secondary, $text-secondary);
          font-size: 14px;
        }

        .range-unit {
          color: var(--text-secondary, $text-secondary);
          font-size: 12px;
          margin-left: 4px;
        }
      }
    }
  }

  .action-buttons {
    margin-top: 20px;

    .generate-btn {
      width: 100%;
      height: 40px;
      font-size: 14px;
    }
  }

  .config-info {
    margin-top: 16px;
    padding: 12px;
    background-color: var(--info-bg, $light-bg-panel);
    border-radius: $border-radius-large;
    font-size: 12px;

    .info-label {
      color: var(--text-secondary, $text-secondary);
    }

    .info-value {
      color: var(--text-primary, $text-primary);
      margin-left: 8px;
    }
  }
}

// 记忆系统面板
.memory-panel {
  height: 100%;
  display: flex;
  flex-direction: column;

  .memory-sub-tabs {
    margin-bottom: 16px;

    :deep(.el-radio-group) {
      display: flex;
      width: 100%;

      .el-radio-button {
        flex: 1;

        .el-radio-button__inner {
          width: 100%;
        }
      }
    }
  }

  .memory-content {
    flex: 1;
    overflow: hidden;
  }
}

// 深色主题适配
:global(html.dark) .editor-right-panel {
  --panel-bg: #{$dark-bg-base};
  --border-color: #{$dark-border-light};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --text-regular: #{$dark-text-regular};
  --hover-bg: #{$dark-bg-hover};
  --active-bg: #{$dark-bg-active};
  --info-bg: #{$dark-bg-panel};
}
</style>
