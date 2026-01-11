<script setup lang="ts">
// 主内容区域组件
</script>

<template>
  <main class="app-content">
    <slot></slot>
  </main>
</template>

<style scoped lang="scss">
.app-content {
  flex: 1;
  overflow: auto;
  background-color: $bg-page;
}
</style>
