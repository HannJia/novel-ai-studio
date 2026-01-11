<script setup lang="ts">
const props = withDefaults(defineProps<{
  title?: string
  width?: string | number
  showClose?: boolean
  closeOnClickModal?: boolean
  closeOnPressEscape?: boolean
  center?: boolean
  draggable?: boolean
}>(), {
  title: '',
  width: '500px',
  showClose: true,
  closeOnClickModal: true,
  closeOnPressEscape: true,
  center: false,
  draggable: false
})

const visible = defineModel<boolean>('visible', { default: false })

const emit = defineEmits<{
  open: []
  close: []
  confirm: []
  cancel: []
}>()

function handleClose(): void {
  visible.value = false
  emit('close')
}

function handleConfirm(): void {
  emit('confirm')
}

function handleCancel(): void {
  visible.value = false
  emit('cancel')
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="width"
    :show-close="showClose"
    :close-on-click-modal="closeOnClickModal"
    :close-on-press-escape="closeOnPressEscape"
    :center="center"
    :draggable="draggable"
    @open="emit('open')"
    @close="handleClose"
  >
    <slot></slot>
    <template #footer>
      <slot name="footer">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleConfirm">确定</el-button>
      </slot>
    </template>
  </el-dialog>
</template>
