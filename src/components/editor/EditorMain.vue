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

    <!-- 编辑器容器 -->
    <div v-else class="editor-container">
      <!-- 章节信息栏 -->
      <div class="chapter-info-bar">
        <div class="chapter-header">
          <!-- 可编辑的章节标题 -->
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
      display: flex;
      align-items: center;
      gap: 8px;

      &.editable {
        cursor: pointer;
        padding: 4px 8px;
        margin: -4px -8px;
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
      width: 300px;

      :deep(.el-input__inner) {
        font-size: 18px;
        font-weight: 600;
        height: 36px;
      }
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
  --hover-bg: #{$dark-bg-hover};
}
</style>
