<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore, useUiStore } from '@/stores'
import { formatRelativeTime } from '@/utils/format'

const editorStore = useEditorStore()
const uiStore = useUiStore()

const hasUnsavedChanges = computed(() => editorStore.hasUnsavedChanges)
const lastSavedAt = computed(() => editorStore.lastSavedAt)
const wordCount = computed(() => editorStore.wordCount)
const showWordCount = computed(() => uiStore.showWordCount)
</script>

<template>
  <footer class="app-status-bar">
    <div class="status-left">
      <span v-if="hasUnsavedChanges" class="status-item unsaved">
        <el-icon><WarningFilled /></el-icon>
        未保存
      </span>
      <span v-else-if="lastSavedAt" class="status-item saved">
        <el-icon><CircleCheckFilled /></el-icon>
        {{ formatRelativeTime(lastSavedAt) }}保存
      </span>
      <slot name="left"></slot>
    </div>
    <div class="status-center">
      <slot name="center"></slot>
    </div>
    <div class="status-right">
      <span v-if="showWordCount" class="status-item">
        字数：{{ wordCount }}
      </span>
      <slot name="right"></slot>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.app-status-bar {
  height: $status-bar-height;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: $bg-base;
  border-top: 1px solid $border-light;
  font-size: 12px;
  color: $text-secondary;
}

.status-left,
.status-center,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;

  &.unsaved {
    color: $warning-color;
  }

  &.saved {
    color: $success-color;
  }
}
</style>
