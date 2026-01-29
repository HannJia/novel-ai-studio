<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAiStore, useEditorStore, useChapterStore, useBookStore } from '@/stores'
import { ElMessage } from 'element-plus'

const router = useRouter()
const aiStore = useAiStore()
const editorStore = useEditorStore()
const chapterStore = useChapterStore()
const bookStore = useBookStore()

// 今日写作字数
const todayWordCount = computed(() => editorStore.todayWordCount || 0)

const emit = defineEmits<{
  undo: []
  regenerate: []
  openFontSettings: []
  openGenerateSettings: []
  generateNextChapter: []
  generateOutline: []
  generateFromOutline: []
  freeWrite: []
}>()

// AI写作上拉菜单状态
const showAIMenu = ref(false)

// 当前模型名称
const currentModelName = computed(() => {
  return aiStore.currentConfig?.model || aiStore.defaultConfig?.model || '未配置'
})

// 显示简短的模型名
const shortModelName = computed(() => {
  const name = currentModelName.value
  if (name.length > 15) {
    return name.substring(0, 12) + '...'
  }
  return name
})

// 切换上拉菜单
function toggleAIMenu() {
  showAIMenu.value = !showAIMenu.value
}

// 关闭菜单
function closeMenu() {
  showAIMenu.value = false
}

// 菜单项点击处理
function handleMenuAction(action: string) {
  closeMenu()
  switch (action) {
    case 'nextChapter':
      emit('generateNextChapter')
      break
    case 'outline':
      emit('generateOutline')
      break
    case 'fromOutline':
      emit('generateFromOutline')
      break
    case 'freeWrite':
      emit('freeWrite')
      break
  }
}

// 撤销
function handleUndo() {
  emit('undo')
}

// 重新生成
function handleRegenerate() {
  emit('regenerate')
}

// 字体设置
function handleFontSettings() {
  emit('openFontSettings')
}

// 生成设置
function handleGenerateSettings() {
  emit('openGenerateSettings')
}
</script>

<template>
  <footer class="editor-toolbar">
    <!-- 最左侧：逻辑告警（在 toolbar-inner 外） -->
    <div class="toolbar-stats left">
      <div class="stats-item warning">
        <el-icon><Warning /></el-icon>
        <span>逻辑告警: 0</span>
      </div>
    </div>

    <!-- 工具栏内容居中 -->
    <div class="toolbar-inner">
      <!-- 撤销 -->
      <el-tooltip content="撤销" placement="top">
        <el-button class="toolbar-btn" text @click="handleUndo">
          <el-icon><RefreshLeft /></el-icon>
          <span class="btn-label">撤销</span>
        </el-button>
      </el-tooltip>

      <!-- 重新生成 -->
      <el-tooltip content="重新生成上次内容" placement="top">
        <el-button
          class="toolbar-btn"
          text
          @click="handleRegenerate"
          :disabled="!aiStore.generatedContent"
        >
          <el-icon><Refresh /></el-icon>
          <span class="btn-label">重新生成</span>
        </el-button>
      </el-tooltip>

      <el-divider direction="vertical" />

      <!-- 字体 -->
      <el-tooltip content="字体设置" placement="top">
        <el-button class="toolbar-btn" text @click="handleFontSettings">
          <span class="font-icon">A</span>
          <span class="btn-label">字体</span>
        </el-button>
      </el-tooltip>

      <el-divider direction="vertical" />

      <!-- AI写作按钮（带上拉菜单） -->
      <div class="ai-menu-wrapper">
        <el-button
          class="toolbar-btn ai-btn"
          :class="{ active: showAIMenu }"
          @click="toggleAIMenu"
        >
          <el-icon><EditPen /></el-icon>
          <span class="btn-label">AI写作</span>
          <el-icon class="arrow-icon">
            <ArrowUp v-if="showAIMenu" />
            <ArrowDown v-else />
          </el-icon>
        </el-button>

        <!-- 上拉菜单 -->
        <Transition name="slide-up">
          <div v-if="showAIMenu" class="ai-pullup-menu">
            <div class="menu-item" @click="handleMenuAction('nextChapter')">
              <el-icon><Plus /></el-icon>
              <span>生成下一章</span>
            </div>
            <div class="menu-divider"></div>
            <div class="menu-item" @click="handleMenuAction('outline')">
              <el-icon><List /></el-icon>
              <span>生成五步细纲</span>
            </div>
            <div class="menu-item" @click="handleMenuAction('fromOutline')">
              <el-icon><Document /></el-icon>
              <span>根据细纲生成章节</span>
            </div>
            <div class="menu-divider"></div>
            <div class="menu-item" @click="handleMenuAction('freeWrite')">
              <el-icon><Edit /></el-icon>
              <span>自由写作（AI辅助）</span>
            </div>
          </div>
        </Transition>

        <!-- 遮罩层 -->
        <div v-if="showAIMenu" class="menu-overlay" @click="closeMenu"></div>
      </div>

      <el-divider direction="vertical" />

      <!-- 设置 -->
      <el-tooltip content="生成设置" placement="top">
        <el-button class="toolbar-btn" text @click="handleGenerateSettings">
          <el-icon><Setting /></el-icon>
          <span class="btn-label">设置</span>
        </el-button>
      </el-tooltip>
    </div>

    <!-- 最右侧：今日字数（在 toolbar-inner 外） -->
    <div class="toolbar-stats right">
      <div class="stats-item">
        <span>今日: {{ todayWordCount }}字</span>
      </div>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.editor-toolbar {
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bg-surface, #1a1a1a);
  border-top: 1px solid var(--border-base, #333);
  z-index: 100;
  flex-shrink: 0;
}

// 工具栏内容容器 - 居中显示按钮组
.toolbar-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

// 左右两侧统计信息
.toolbar-stats {
  display: flex;
  align-items: center;
  min-width: 100px;

  &.left {
    justify-content: flex-start;
  }

  &.right {
    justify-content: flex-end;
  }
}

.stats-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary, #a3a3a3);

  .el-icon {
    font-size: 14px;
  }

  &.warning {
    color: var(--color-success, #22c55e);
  }
}

.toolbar-left,
.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  color: var(--text-secondary, #a3a3a3);
  font-size: 13px;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--bg-hover, #333);
    color: var(--text-primary, #f5f5f5);
  }

  &.active {
    background-color: var(--bg-active, #404040);
    color: var(--color-primary, #f97316);
  }

  .btn-label {
    font-size: 13px;
  }

  .font-icon {
    font-size: 16px;
    font-weight: 600;
    font-family: serif;
  }

  .arrow-icon {
    font-size: 12px;
    margin-left: 2px;
  }
}

.ai-btn {
  background-color: var(--color-primary, #f97316);
  color: white;
  padding: 8px 16px;

  &:hover {
    background-color: #ea580c;
    color: white;
  }

  &.active {
    background-color: #ea580c;
    color: white;
  }
}

.ai-menu-wrapper {
  position: relative;
}

.ai-pullup-menu {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  min-width: 200px;
  background-color: var(--bg-elevated, #262626);
  border: 1px solid var(--border-base, #333);
  border-radius: 12px;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
  padding: 8px 0;
  z-index: 1000;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  color: var(--text-primary, #f5f5f5);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  .el-icon {
    font-size: 16px;
    color: var(--text-secondary, #a3a3a3);
  }

  &:hover {
    background-color: var(--bg-hover, #333);

    .el-icon {
      color: var(--color-primary, #f97316);
    }
  }
}

.menu-divider {
  height: 1px;
  background-color: var(--border-base, #333);
  margin: 4px 12px;
}

.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.el-divider {
  height: 24px;
  margin: 0 8px;
  border-color: var(--border-base, #333);
}

// 上拉动画
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.2s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

// 浅色主题
:global(.theme-light) .editor-toolbar {
  --bg-surface: #f8fafc;
  --border-base: #e2e8f0;
  --text-secondary: #64748b;
  --text-primary: #1e293b;
  --bg-hover: #f1f5f9;
  --bg-active: #e2e8f0;
  --bg-elevated: #ffffff;
}
</style>
