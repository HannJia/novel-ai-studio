<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useChapterStore, useEditorStore, useUiStore } from '@/stores'
import { ElMessage } from 'element-plus'
import AIThinkingProcess from './ai/AIThinkingProcess.vue'

const chapterStore = useChapterStore()
const editorStore = useEditorStore()
const uiStore = useUiStore()

// 章节标题编辑状态
const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

// 监听当前章节变化，重置编辑状态
watch(() => chapterStore.currentChapter, () => {
  isEditingTitle.value = false
  editingTitle.value = ''
})

// 开始编辑标题
async function startEditTitle() {
  if (!chapterStore.currentChapter) return
  editingTitle.value = chapterStore.currentChapter.title
  isEditingTitle.value = true
  await nextTick()
  titleInputRef.value?.focus()
  titleInputRef.value?.select()
}

// 保存标题
async function saveTitle() {
  if (!chapterStore.currentChapter) return

  const newTitle = editingTitle.value.trim()
  if (!newTitle) {
    ElMessage.warning('章节标题不能为空')
    editingTitle.value = chapterStore.currentChapter.title
    isEditingTitle.value = false
    return
  }

  if (newTitle !== chapterStore.currentChapter.title) {
    const result = await chapterStore.updateChapter(chapterStore.currentChapter.id, {
      title: newTitle
    })
    if (result) {
      ElMessage.success('标题已更新')
    } else {
      ElMessage.error('更新标题失败')
      editingTitle.value = chapterStore.currentChapter.title
    }
  }

  isEditingTitle.value = false
}

// 取消编辑
function cancelEditTitle() {
  if (chapterStore.currentChapter) {
    editingTitle.value = chapterStore.currentChapter.title
  }
  isEditingTitle.value = false
}

// 按键处理
function handleTitleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveTitle()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEditTitle()
  }
}
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

    <!-- 编辑器容器 - 纸张卡片样式 -->
    <div v-else class="editor-container">
      <div class="paper-card" :style="{ maxWidth: uiStore.editorWidth + 'px' }">
        <!-- 章节标题居中显示 -->
        <div class="chapter-title-section">
          <h2
            v-if="!isEditingTitle"
            class="chapter-title editable"
            @dblclick="startEditTitle"
            title="双击编辑标题"
          >
            {{ chapterStore.currentChapter.title }}
            <el-icon class="edit-hint"><Edit /></el-icon>
          </h2>
          <el-input
            v-else
            ref="titleInputRef"
            v-model="editingTitle"
            class="title-input"
            size="large"
            @blur="saveTitle"
            @keydown="handleTitleKeydown"
          />
          <div class="chapter-meta">
            <el-tag size="small" type="info">
              {{ chapterStore.currentChapter.status === 'completed' ? '已完成' : '草稿' }}
            </el-tag>
            <span class="word-count">{{ editorStore.wordCount }} 字</span>
          </div>
        </div>

        <!-- 主编辑区 -->
        <div class="editor-wrapper">
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
    </div>

    <!-- AI思考过程浮窗（非嵌入模式） -->
    <AIThinkingProcess :embedded="false" />
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
  position: relative;
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

// 编辑器容器 - 居中布局
.editor-container {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 32px;
  overflow-y: auto;
  background-color: var(--page-bg, #f5f5f5);
}

// 纸张卡片样式
.paper-card {
  width: 100%;
  max-width: 1100px;
  background-color: var(--paper-bg, #ffffff);
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  padding: 48px 64px;
  display: flex;
  flex-direction: column;
  min-height: 600px;
}

// 章节标题区域 - 居中
.chapter-title-section {
  text-align: center;
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-color, $border-lighter);

  .chapter-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--text-title, $light-text-title);
    margin: 0 0 12px 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;

    &.editable {
      cursor: pointer;
      padding: 8px 16px;
      border-radius: $border-radius-base;
      transition: background-color 0.2s ease;

      .edit-hint {
        font-size: 14px;
        color: var(--text-placeholder, $text-placeholder);
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      &:hover {
        background-color: var(--hover-bg, $light-bg-hover);

        .edit-hint {
          opacity: 1;
        }
      }
    }
  }

  .title-input {
    width: 400px;
    margin: 0 auto;

    :deep(.el-input__inner) {
      font-size: 22px;
      font-weight: 600;
      text-align: center;
      height: 44px;
    }
  }

  .chapter-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;

    .word-count {
      font-size: 13px;
      color: var(--text-secondary, $text-secondary);
    }
  }
}

// 编辑区包装
.editor-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
}

// 主文本框
.main-textarea {
  flex: 1;
  width: 100%;
  min-height: 400px;
  padding: 0;
  border: none;
  resize: none;
  font-family: $font-family;
  background-color: transparent;
  color: var(--text-primary, $text-primary);
  line-height: 1.8;

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--text-placeholder, $text-placeholder);
  }
}

// 深色主题适配
:global(html.dark) .editor-main {
  --main-bg: #{$dark-bg-page};
  --page-bg: #{$dark-bg-base};
  --paper-bg: #{$dark-bg-card};
  --border-color: #{$dark-border-lighter};
  --text-title: #{$dark-text-primary};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --text-placeholder: #{$dark-text-placeholder};
  --hover-bg: #{$dark-bg-hover};
}

// 浅色主题适配
:global(.theme-light) .editor-main {
  --main-bg: #f8fafc;
  --page-bg: #f1f5f9;
  --paper-bg: #ffffff;
  --border-color: #e2e8f0;
  --text-title: #1e293b;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-placeholder: #94a3b8;
  --hover-bg: #f1f5f9;
}
</style>
