<script setup lang="ts">
import { computed } from 'vue'
import { useChapterStore, useEditorStore, useUiStore } from '@/stores'

const chapterStore = useChapterStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()
</script>

<template>
  <main class="editor-main">
    <!-- 无章节选中状态 -->
    <div v-if="!chapterStore.currentChapter" class="no-chapter-selected">
      <div class="empty-placeholder">
        <el-icon class="placeholder-icon"><Edit /></el-icon>
        <h3>开始创作</h3>
        <p>从左侧选择一个章节开始编辑，或创建新章节</p>
      </div>
    </div>

    <!-- 编辑器容器 -->
    <div v-else class="editor-container">
      <!-- 章节信息栏 -->
      <div class="chapter-info-bar">
        <div class="chapter-header">
          <h2 class="chapter-title">{{ chapterStore.currentChapter.title }}</h2>
          <div class="chapter-meta">
            <el-tag size="small" type="info">
              {{ chapterStore.currentChapter.status === 'completed' ? '已完成' : '草稿' }}
            </el-tag>
          </div>
        </div>
        <div class="chapter-stats">
          <span class="stat-item">
            <el-icon><Document /></el-icon>
            {{ editorStore.wordCount }} 字
          </span>
        </div>
      </div>

      <!-- 主编辑区 -->
      <div class="editor-wrapper" :style="{ maxWidth: uiStore.editorWidth + 'px' }">
        <textarea
          v-model="editorStore.content"
          class="main-textarea"
          :style="{
            fontSize: uiStore.fontSize + 'px',
            lineHeight: uiStore.lineHeight
          }"
          placeholder="在此开始你的创作..."
        ></textarea>
      </div>
    </div>
  </main>
</template>

<style scoped lang="scss">
.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--main-bg, $bg-page);
  transition: background-color $transition-duration $transition-ease;
}

.no-chapter-selected {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;

  .empty-placeholder {
    text-align: center;
    padding: 48px;

    .placeholder-icon {
      font-size: 64px;
      color: var(--text-placeholder, $text-placeholder);
      margin-bottom: 24px;
    }

    h3 {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary, $text-primary);
      margin-bottom: 12px;
    }

    p {
      font-size: 14px;
      color: var(--text-secondary, $text-secondary);
    }
  }
}

.editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chapter-info-bar {
  padding: 16px 24px;
  background-color: var(--card-bg, $bg-base);
  border-bottom: 1px solid var(--border-color, $border-lighter);
  display: flex;
  align-items: center;
  justify-content: space-between;

  .chapter-header {
    display: flex;
    align-items: center;
    gap: 12px;

    .chapter-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-title, $light-text-title);
      margin: 0;
    }
  }

  .chapter-stats {
    display: flex;
    align-items: center;
    gap: 16px;

    .stat-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: var(--text-secondary, $text-secondary);

      .el-icon {
        font-size: 14px;
      }
    }
  }
}

.editor-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 0 auto;
  width: 100%;
  padding: 24px;
  overflow-y: auto;
}

.main-textarea {
  flex: 1;
  width: 100%;
  min-height: 500px;
  padding: 24px;
  border: none;
  border-radius: $border-radius-card;
  resize: none;
  font-family: $font-family;
  background-color: var(--textarea-bg, $bg-base);
  color: var(--text-primary, $text-primary);
  box-shadow: var(--textarea-shadow, $light-card-shadow);
  transition: box-shadow $transition-duration $transition-ease;

  &:focus {
    outline: none;
    box-shadow: var(--textarea-shadow-focus, $light-card-shadow-hover);
  }

  &::placeholder {
    color: var(--text-placeholder, $text-placeholder);
  }
}

// 深色主题适配
:global(html.dark) .editor-main {
  --main-bg: #{$dark-bg-page};
  --card-bg: #{$dark-bg-base};
  --border-color: #{$dark-border-lighter};
  --text-title: #{$dark-text-primary};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --text-placeholder: #{$dark-text-placeholder};
  --textarea-bg: #{$dark-bg-card};
  --textarea-shadow: #{$dark-card-shadow};
  --textarea-shadow-focus: 0 0 0 2px #{$primary-color};
}
</style>
