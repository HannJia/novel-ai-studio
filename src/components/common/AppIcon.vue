<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name?: string
  size?: number | string
  color?: string
}>(), {
  name: '',
  size: 16,
  color: 'currentColor'
})

const iconStyle = computed(() => ({
  fontSize: typeof props.size === 'number' ? `${props.size}px` : props.size,
  color: props.color
}))
</script>

<template>
  <el-icon :style="iconStyle">
    <component :is="name" v-if="name" />
    <slot v-else></slot>
  </el-icon>
</template>
