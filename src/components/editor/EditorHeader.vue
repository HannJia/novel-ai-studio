<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore, useEditorStore, useUiStore, useAiStore } from '@/stores'

const router = useRouter()
const bookStore = useBookStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()
const aiStore = useAiStore()

const emit = defineEmits<{
  save: []
  continueWriting: []
  toggleFocus: []
  toggleFullscreen: []
}>()

const props = defineProps<{
  focusMode: boolean
  isFullscreen: boolean
}>()

const progress = computed(() => {
  const total = bookStore.currentBook?.wordCount || 0
  const target = 100000 // 默认目标10万字
  return Math.min((total / target) * 100, 100)
})

// AI生成进度
const generatingProgress = computed(() => aiStore.generatingProgress)
const isGenerating = computed(() => aiStore.generating)
// 进度百分比
const progressPercent = computed(() => {
  const { current, total } = generatingProgress.value
  if (total <= 0) return 0
  return Math.round((current / total) * 100)
})
// 续写按钮显示文字
const continueButtonText = computed(() => {
  if (!isGenerating.value) return '续写'
  const stage = generatingProgress.value.stage
  if (stage) return stage
  return '生成中...'
})

function goHome(): void {
  if (editorStore.hasUnsavedChanges) {
    emit('save')
  }
  router.push('/')
}

function toggleTheme(): void {
  const newMode = uiStore.themeMode === 'dark' ? 'light' : 'dark'
  uiStore.setThemeMode(newMode)
  uiStore.saveSettings()
}
</script>

<template>
  <header class="editor-header">
    <!-- 左侧：返回和书籍信息 -->
    <div class="header-left">
      <el-button class="back-btn" text @click="goHome">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="book-info">
        <span class="book-title">{{ bookStore.currentBook?.title || '加载中...' }}</span>
        <span class="book-meta">
          <el-tag size="small" type="info">{{ bookStore.currentBook?.genre || '' }}</el-tag>
        </span>
      </div>
      <div class="progress-bar">
        <el-progress
          :percentage="progress"
          :stroke-width="6"
          :show-text="false"
        />
        <span class="progress-text">{{ bookStore.currentBook?.wordCount || 0 }} 字</span>
      </div>
    </div>

    <!-- 中间：工具栏 -->
    <div class="header-center">
      <div class="toolbar-group">
        <el-tooltip content="保存 (Ctrl+S)" placement="bottom">
          <el-button
            class="toolbar-btn"
            :class="{ 'has-changes': editorStore.hasUnsavedChanges }"
            @click="$emit('save')"
            :loading="editorStore.isSaving"
          >
            <el-icon><DocumentChecked /></el-icon>
          </el-button>
        </el-tooltip>

        <el-divider direction="vertical" />

        <el-tooltip content="AI续写" placement="bottom">
          <el-button
            class="toolbar-btn primary"
            :class="{ generating: aiStore.generating }"
            @click="$emit('continueWriting')"
            :loading="aiStore.generating"
            :disabled="!aiStore.hasConfig"
          >
            <el-icon><MagicStick /></el-icon>
            <span class="btn-text">{{ continueButtonText }}</span>
          </el-button>
        </el-tooltip>

        <el-divider direction="vertical" />

        <el-tooltip content="专注模式 (ESC退出)" placement="bottom">
          <el-button
            class="toolbar-btn"
            :class="{ active: focusMode }"
            @click="$emit('toggleFocus')"
          >
            <el-icon><View /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip content="全屏" placement="bottom">
          <el-button
            class="toolbar-btn"
            :class="{ active: isFullscreen }"
            @click="$emit('toggleFullscreen')"
          >
            <el-icon><FullScreen /></el-icon>
          </el-button>
        </el-tooltip>
      </div>
    </div>

    <!-- 右侧：设置和主题切换 -->
    <div class="header-right">
      <span class="word-count" v-if="uiStore.showWordCount">
        <el-icon><Document /></el-icon>
        {{ editorStore.wordCount }} 字
      </span>

      <el-tooltip :content="uiStore.isDarkMode ? '切换浅色模式' : '切换深色模式'" placement="bottom">
        <el-button class="theme-btn" text @click="toggleTheme">
          <el-icon v-if="uiStore.isDarkMode"><Sunny /></el-icon>
          <el-icon v-else><Moon /></el-icon>
        </el-button>
      </el-tooltip>

      <el-tooltip content="设置面板" placement="bottom">
        <el-button class="setting-btn" text @click="uiStore.toggleRightPanel">
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>
    </div>
  </header>
</template>

<style scoped lang="scss">
.editor-header {
  height: $header-height;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--header-bg, $bg-base);
  border-bottom: 1px solid var(--border-color, $border-light);
  z-index: $z-header;
  transition: all $transition-duration $transition-ease;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;

  .back-btn {
    padding: 8px;
    border-radius: $border-radius-large;

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
    }
  }

  .book-info {
    display: flex;
    align-items: center;
    gap: 8px;

    .book-title {
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary, $text-primary);
    }
  }

  .progress-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 120px;

    .el-progress {
      flex: 1;
    }

    .progress-text {
      font-size: 12px;
      color: var(--text-secondary, $text-secondary);
      white-space: nowrap;
    }
  }
}

.header-center {
  display: flex;
  align-items: center;
  justify-content: center;

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background-color: var(--toolbar-bg, $light-bg-panel);
    border-radius: $border-radius-card;
  }

  .toolbar-btn {
    padding: 8px 12px;
    border-radius: $border-radius-large;
    border: none;
    background: transparent;
    color: var(--text-regular, $text-regular);
    transition: all $transition-duration-fast $transition-ease;

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-bg, $light-bg-active);
      color: $primary-color;
    }

    &.primary {
      background-color: $primary-color;
      color: #fff;

      &:hover {
        background-color: darken($primary-color, 5%);
      }

      .btn-text {
        margin-left: 4px;
      }

      &.generating {
        min-width: 100px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        animation: pulse-generating 2s ease-in-out infinite;

        .btn-text {
          font-size: 12px;
        }
      }
    }

    &.has-changes {
      color: $warning-color;
    }
  }

  .el-divider {
    height: 20px;
    margin: 0 4px;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  justify-content: flex-end;

  .word-count {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-secondary, $text-secondary);
    padding: 4px 12px;
    background-color: var(--toolbar-bg, $light-bg-panel);
    border-radius: $border-radius-large;
  }

  .theme-btn,
  .setting-btn {
    padding: 8px;
    border-radius: $border-radius-large;
    color: var(--text-regular, $text-regular);

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }
  }
}

// 深色主题适配
:global(html.dark) .editor-header {
  --header-bg: #{$dark-bg-base};
  --border-color: #{$dark-border-light};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --text-regular: #{$dark-text-regular};
  --hover-bg: #{$dark-bg-hover};
  --active-bg: #{$dark-bg-active};
  --toolbar-bg: #{$dark-bg-panel};
}

// 生成中的脉冲动画
@keyframes pulse-generating {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.85;
  }
}
</style>
