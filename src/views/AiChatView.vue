<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AiChat from '@/components/ai/AiChat.vue'

const route = useRoute()

const bookId = computed(() => route.params.bookId as string | undefined)
</script>

<template>
  <div class="ai-chat-view">
    <AiChat :book-id="bookId" />
  </div>
</template>

<style scoped lang="scss">
.ai-chat-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
