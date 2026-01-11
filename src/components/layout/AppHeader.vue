<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '@/stores'

const uiStore = useUiStore()

const collapsed = computed(() => uiStore.sidebarCollapsed)
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <el-button text class="toggle-btn" @click="uiStore.toggleSidebar">
        <el-icon>
          <Expand v-if="collapsed" />
          <Fold v-else />
        </el-icon>
      </el-button>
      <slot name="left"></slot>
    </div>
    <div class="header-center">
      <slot name="center"></slot>
    </div>
    <div class="header-right">
      <slot name="right"></slot>
    </div>
  </header>
</template>

<style scoped lang="scss">
.app-header {
  height: $header-height;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: $bg-base;
  border-bottom: 1px solid $border-light;
  z-index: $z-header;
}

.header-left,
.header-center,
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left {
  flex: 0 0 auto;
}

.header-center {
  flex: 1;
  justify-content: center;
}

.header-right {
  flex: 0 0 auto;
}

.toggle-btn {
  font-size: 18px;
}
</style>
