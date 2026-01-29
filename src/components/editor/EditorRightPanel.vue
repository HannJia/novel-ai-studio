<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useUiStore, useAiStore } from '@/stores'
import CharacterPanel from './panels/CharacterPanel.vue'
import KnowledgePanel from './panels/KnowledgePanel.vue'
import ForeshadowPanel from './panels/ForeshadowPanel.vue'
import TimelinePanel from './panels/TimelinePanel.vue'
import SummaryPanel from './panels/SummaryPanel.vue'

const uiStore = useUiStore()
const aiStore = useAiStore()

// 本地状态 - 移除生成标签（已在底部工具栏设置中）
const activeTab = ref<'character' | 'knowledge' | 'memory'>('character')

// 记忆系统子标签
const memorySubTab = ref<'summary' | 'timeline' | 'foreshadow'>('foreshadow')

// 点击导航项：如果已收缩则展开，如果已展开则切换标签
function handleNavClick(tab: 'character' | 'knowledge' | 'memory') {
  if (!uiStore.rightPanelVisible) {
    uiStore.rightPanelVisible = true
  }
  activeTab.value = tab
}

// 组件卸载时重置状态
onUnmounted(() => {
  aiStore.embeddedPanelVisible = false
})
</script>

<template>
  <aside class="editor-right-panel" :class="{ collapsed: !uiStore.rightPanelVisible }">
    <!-- 面板内容区 -->
    <div class="panel-content" v-show="uiStore.rightPanelVisible">
      <!-- 面板标题 -->
      <div class="panel-header">
        <span class="panel-title">{{ activeTab === 'character' ? '角色' : activeTab === 'knowledge' ? '知识' : '记忆' }}</span>
        <el-button class="collapse-btn" text size="small" @click="uiStore.rightPanelVisible = false">
          <el-icon><ArrowRight /></el-icon>
        </el-button>
      </div>

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
    </div>

    <!-- 右侧图标导航栏 - 始终显示 -->
    <div class="icon-nav-rail">
      <div
        class="nav-item"
        :class="{ active: activeTab === 'character' && uiStore.rightPanelVisible }"
        @click="handleNavClick('character')"
      >
        <el-icon :size="28"><User /></el-icon>
        <span class="nav-label">角色</span>
      </div>
      <div
        class="nav-item"
        :class="{ active: activeTab === 'knowledge' && uiStore.rightPanelVisible }"
        @click="handleNavClick('knowledge')"
      >
        <el-icon :size="28"><FolderOpened /></el-icon>
        <span class="nav-label">知识</span>
      </div>
      <div
        class="nav-item"
        :class="{ active: activeTab === 'memory' && uiStore.rightPanelVisible }"
        @click="handleNavClick('memory')"
      >
        <el-icon :size="28"><Memo /></el-icon>
        <span class="nav-label">记忆</span>
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
  flex-direction: row;
  transition: width $transition-duration $transition-ease;

  &.collapsed {
    width: 64px; // 折叠时只显示图标栏宽度
  }
}

// 面板内容区
.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
}

// 面板标题
.panel-header {
  padding: 16px 0 12px;
  border-bottom: 1px solid var(--border-color, $border-lighter);
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .panel-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, $text-primary);
  }

  .collapse-btn {
    padding: 4px;
    color: var(--text-secondary, $text-secondary);

    &:hover {
      color: var(--text-primary, $text-primary);
    }
  }
}

// 右侧图标导航栏 - 始终显示
.icon-nav-rail {
  width: 64px;
  min-width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  background-color: var(--rail-bg, rgba(0, 0, 0, 0.02));
  border-left: 1px solid var(--border-color, $border-lighter);

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 56px;
    padding: 10px 0;
    border-radius: $border-radius-large;
    cursor: pointer;
    transition: all $transition-duration-fast $transition-ease;
    color: var(--text-secondary, $text-secondary);

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-bg, rgba($primary-color, 0.1));
      color: $primary-color;

      .nav-label {
        color: $primary-color;
        font-weight: 500;
      }
    }

    .nav-label {
      font-size: 11px;
      color: var(--text-secondary, $text-secondary);
      transition: color $transition-duration-fast;
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
  --hover-bg: #{$dark-bg-hover};
  --active-bg: #{$dark-bg-active};
  --rail-bg: rgba(255, 255, 255, 0.02);
}

// 浅色主题适配
:global(.theme-light) .editor-right-panel {
  --panel-bg: #ffffff;
  --border-color: #e2e8f0;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --hover-bg: #f1f5f9;
  --active-bg: #e2e8f0;
  --rail-bg: #f8fafc;
}
</style>
