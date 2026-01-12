<script setup lang="ts">
const props = withDefaults(defineProps<{
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'default'
  size?: 'large' | 'default' | 'small'
  loading?: boolean
  disabled?: boolean
  icon?: string
  plain?: boolean
  round?: boolean
  circle?: boolean
}>(), {
  type: 'default',
  size: 'default',
  loading: false,
  disabled: false,
  icon: '',
  plain: false,
  round: false,
  circle: false
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

function handleClick(event: MouseEvent): void {
  if (!props.disabled && !props.loading) {
    emit('click', event)
  }
}
</script>

<template>
  <el-button
    :type="type"
    :size="size"
    :loading="loading"
    :disabled="disabled"
    :plain="plain"
    :round="round"
    :circle="circle"
    @click="handleClick"
  >
    <el-icon v-if="icon && !loading">
      <component :is="icon" />
    </el-icon>
    <slot></slot>
  </el-button>
</template>
