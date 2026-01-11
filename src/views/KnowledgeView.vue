<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
const bookId = route.params.bookId as string
</script>

<template>
  <div class="knowledge-view">
    <div class="page-header">
      <h1>知识库</h1>
      <p>书籍ID: {{ bookId }}</p>
    </div>
    <div class="page-content">
      <el-empty description="知识库功能开发中..." />
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
}

.page-header {
  margin-bottom: 24px;

  h1 {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  p {
    color: $text-secondary;
  }
}

.page-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
