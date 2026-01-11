<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores'

const uiStore = useUiStore()

const visible = computed(() => uiStore.rightPanelVisible)
const activeTab = computed({
  get: () => uiStore.rightPanelTab,
  set: (value) => uiStore.setRightPanelTab(value)
})
</script>

<template>
  <aside v-show="visible" class="app-right-panel">
    <div class="panel-header">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="AI助手" name="ai" />
        <el-tab-pane label="大纲" name="outline" />
        <el-tab-pane label="角色" name="character" />
      </el-tabs>
      <el-button text class="close-btn" @click="uiStore.toggleRightPanel">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    <div class="panel-content">
      <slot :name="activeTab">
        <div class="placeholder">
          <p>{{ activeTab }} 面板内容</p>
        </div>
      </slot>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.app-right-panel {
  width: $right-panel-width;
  height: 100%;
  background-color: $bg-base;
  border-left: 1px solid $border-light;
  display: flex;
  flex-direction: column;
  z-index: $z-right-panel;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 0;
  border-bottom: 1px solid $border-lighter;

  :deep(.el-tabs) {
    flex: 1;

    .el-tabs__header {
      margin-bottom: 0;
    }

    .el-tabs__nav-wrap::after {
      display: none;
    }
  }
}

.close-btn {
  flex-shrink: 0;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: $text-secondary;
}
</style>
