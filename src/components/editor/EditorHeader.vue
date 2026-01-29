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

// 当前模型名称
const currentModelName = computed(() => {
  const name = aiStore.currentConfig?.model || aiStore.defaultConfig?.model || '未配置'
  if (name.length > 20) {
    return name.substring(0, 17) + '...'
  }
  return name
})

// 保存状态文本
const saveStatusText = computed(() => {
  if (editorStore.isSaving) return '保存中...'
  if (editorStore.hasUnsavedChanges) return '未保存'
  return '已保存'
})

// 保存状态类
const saveStatusClass = computed(() => {
  if (editorStore.isSaving) return 'saving'
  if (editorStore.hasUnsavedChanges) return 'unsaved'
  return 'saved'
})

// 书籍分卷列表
const volumeList = computed(() => {
  return bookStore.currentBook?.volumes || []
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

function handleRefresh(): void {
  // 刷新当前内容
  window.location.reload()
}
</script>

<template>
  <header class="editor-header">
    <!-- 左侧：返回、书籍信息、保存状态、字数 -->
    <div class="header-left">
      <el-button class="back-btn" text @click="goHome">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>

      <!-- 书籍标题下拉选择器 -->
      <el-dropdown v-if="volumeList.length > 0" trigger="click">
        <span class="book-title-trigger">
          {{ bookStore.currentBook?.title || '加载中...' }}
          <el-icon class="arrow-icon"><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="vol in volumeList" :key="vol.id">
              {{ vol.title }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span v-else class="book-title">
        {{ bookStore.currentBook?.title || '加载中...' }}
      </span>

      <!-- 保存状态指示器 -->
      <span class="save-status" :class="saveStatusClass">
        <span class="status-dot"></span>
        {{ saveStatusText }}
      </span>

      <!-- 正文字数 -->
      <span class="word-count">
        正文 {{ bookStore.currentBook?.wordCount || 0 }} 字
      </span>
    </div>

    <!-- 右侧：AI模型选择、刷新按钮 -->
    <div class="header-right">
      <!-- AI模型选择器 -->
      <el-dropdown trigger="click" @command="() => {}">
        <span class="model-selector">
          <el-icon><Monitor /></el-icon>
          {{ currentModelName }}
          <el-icon class="arrow-icon"><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item disabled>
              当前: {{ currentModelName }}
            </el-dropdown-item>
            <el-dropdown-item divided @click="router.push('/config')">
              <el-icon><Setting /></el-icon>
              配置AI模型
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <!-- 主题切换 -->
      <el-tooltip :content="uiStore.isDarkMode ? '切换浅色模式' : '切换深色模式'" placement="bottom">
        <el-button class="theme-btn" text @click="toggleTheme">
          <el-icon v-if="uiStore.isDarkMode"><Sunny /></el-icon>
          <el-icon v-else><Moon /></el-icon>
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

  .back-btn {
    padding: 8px;
    border-radius: $border-radius-large;
    color: var(--text-secondary, $text-secondary);

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }
  }

  .book-title-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 15px;
    color: var(--text-primary, $text-primary);
    cursor: pointer;
    padding: 6px 12px;
    border-radius: $border-radius-base;
    transition: background-color 0.2s;

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
    }

    .arrow-icon {
      font-size: 12px;
      color: var(--text-secondary, $text-secondary);
    }
  }

  .book-title {
    font-weight: 600;
    font-size: 15px;
    color: var(--text-primary, $text-primary);
  }

  .save-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: $border-radius-large;
    background-color: var(--status-bg, rgba(0,0,0,0.05));

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    &.saved {
      color: $success-color;
      .status-dot {
        background-color: $success-color;
      }
    }

    &.unsaved {
      color: $warning-color;
      .status-dot {
        background-color: $warning-color;
      }
    }

    &.saving {
      color: $primary-color;
      .status-dot {
        background-color: $primary-color;
        animation: pulse 1s infinite;
      }
    }
  }

  .word-count {
    font-size: 13px;
    color: var(--text-secondary, $text-secondary);
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;

  .model-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: $border-radius-large;
    background-color: var(--model-bg, $light-bg-panel);
    color: var(--text-primary, $text-primary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
    }

    .arrow-icon {
      font-size: 12px;
      color: var(--text-secondary, $text-secondary);
    }
  }

  .refresh-btn,
  .theme-btn {
    padding: 8px;
    border-radius: $border-radius-large;
    color: var(--text-regular, $text-regular);

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }
  }
}

// 脉冲动画
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
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
  --model-bg: #{$dark-bg-panel};
  --status-bg: rgba(255,255,255,0.05);
}

// 浅色主题适配
:global(.theme-light) .editor-header {
  --header-bg: #ffffff;
  --border-color: #e2e8f0;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-regular: #64748b;
  --hover-bg: #f1f5f9;
  --model-bg: #f8fafc;
  --status-bg: rgba(0,0,0,0.05);
}
</style>
