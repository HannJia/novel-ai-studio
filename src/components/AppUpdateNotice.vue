<template>
  <div v-if="store.showNotice" class="update-notice" role="status">
    <span>{{ store.state.phase === 'downloaded' ? '新版已下载' : '发现新版本' }} · {{ store.state.release?.version }}</span>
    <div class="notice-actions">
      <n-button size="small" @click="store.detailsOpen = true">查看更新</n-button>
      <n-button quaternary circle size="small" title="稍后处理" aria-label="稍后处理" @click="store.dismissNotice">
        <template #icon><n-icon><close-outline /></n-icon></template>
      </n-button>
    </div>
  </div>
  <n-modal v-model:show="store.detailsOpen" preset="card" title="软件更新" style="width: min(620px, calc(100vw - 32px));"
    :mask-closable="store.state.phase !== 'installing'" :closable="store.state.phase !== 'installing'"
    :close-on-esc="store.state.phase !== 'installing'">
    <AppUpdatePanel />
  </n-modal>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { NButton, NIcon, NModal } from 'naive-ui'
import { CloseOutline } from '@vicons/ionicons5'
import AppUpdatePanel from './AppUpdatePanel.vue'
import { useAppUpdateStore } from '@/stores/appUpdate'
const store = useAppUpdateStore()
onMounted(() => { void store.init() })
</script>

<style scoped>
.update-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 8px 18px; font-size: 13px; color: var(--text-color-primary); background: var(--bg-color-card); border-bottom: 1px solid var(--border-color); }
.update-notice > span { overflow-wrap: anywhere; }
.notice-actions { display: flex; align-items: center; gap: 8px; }
</style>
