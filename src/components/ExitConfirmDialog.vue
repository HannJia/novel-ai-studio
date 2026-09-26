<template>
  <div v-if="visible" class="exit-dialog-overlay" @click.self="handleCancel">
    <div class="exit-dialog" role="dialog" aria-labelledby="exit-title" aria-describedby="exit-detail">
      <div class="exit-dialog-icon">⚠️</div>
      <h2 id="exit-title" class="exit-dialog-title">保存未完成</h2>
      <p class="exit-dialog-message">关闭前保存未完成，是否仍然退出？</p>
      <p id="exit-detail" class="exit-dialog-detail">{{ errorDetail }}</p>
      <div class="exit-dialog-actions">
        <button class="exit-btn exit-btn-cancel" @click="handleCancel">取消</button>
        <button class="exit-btn exit-btn-confirm" @click="handleConfirm">仍然退出</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const errorDetail = ref('')
let unsubscribe: (() => void) | undefined

onMounted(() => {
  unsubscribe = window.electronAPI?.onExitConfirm?.((detail: string) => {
    errorDetail.value = detail
    visible.value = true
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

function handleCancel() {
  visible.value = false
  window.electronAPI?.sendExitChoice?.(false)
}

function handleConfirm() {
  visible.value = false
  window.electronAPI?.sendExitChoice?.(true)
}
</script>

<style scoped>
.exit-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
}

.exit-dialog {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 16px;
  padding: 32px;
  max-width: 480px;
  width: 90%;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.exit-dialog-icon {
  font-size: 48px;
  line-height: 1;
}

.exit-dialog-title {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}

.exit-dialog-message {
  font-size: 16px;
  color: #cccccc;
  margin: 0;
  text-align: center;
}

.exit-dialog-detail {
  font-size: 14px;
  color: #999999;
  margin: 0;
  text-align: center;
  padding: 12px 16px;
  background: #0a0a0a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  width: 100%;
  box-sizing: border-box;
}

.exit-dialog-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  width: 100%;
}

.exit-btn {
  flex: 1;
  height: 44px;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.exit-btn-cancel {
  background: #2a2a2a;
  color: #ffffff;
  border: 1px solid #3a3a3a;
}

.exit-btn-cancel:hover {
  background: #333333;
}

.exit-btn-cancel:active {
  transform: scale(0.98);
}

.exit-btn-confirm {
  background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%);
  color: white;
  font-weight: 600;
}

.exit-btn-confirm:hover {
  background: linear-gradient(135deg, #ff5722 0%, #ff7733 100%);
  box-shadow: 0 4px 12px rgba(255, 107, 53, 0.4);
}

.exit-btn-confirm:active {
  transform: scale(0.98);
}
</style>
