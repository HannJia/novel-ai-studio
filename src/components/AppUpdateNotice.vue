<template>
  <div v-if="store.showNotice && store.state.phase === 'downloaded'" class="update-ready-card" role="status" aria-live="polite">
    <strong>更新已准备好</strong>
    <p>v{{ store.state.release?.version }} 已下载，点击“安装并重启”应用新版。</p>
    <pre v-if="store.state.release?.notes" class="ready-notes">{{ store.state.release.notes }}</pre>
    <p v-if="store.state.error" class="ready-error" role="alert">{{ store.state.error }}</p>
    <div class="notice-actions">
      <n-button size="small" type="primary" @click="confirmInstall">安装并重启</n-button>
      <n-button size="small" quaternary @click="store.dismissNotice">稍后</n-button>
    </div>
  </div>
  <div v-else-if="store.showNotice" class="update-notice" role="status">
    <span>{{ store.state.phase === 'error' ? '更新检查或下载未完成' : '发现新版本' }}{{ store.state.release ? ` · ${store.state.release.version}` : '' }}</span>
    <div class="notice-actions">
      <n-button size="small" @click="store.detailsOpen = true">{{ store.state.phase === 'error' ? '查看详情' : '查看更新' }}</n-button>
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
import { useUpdateInstall } from '@/composables/useUpdateInstall'
const store = useAppUpdateStore()
const { confirmInstall } = useUpdateInstall()
onMounted(() => { void store.init() })
</script>

<style scoped>
.update-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 8px 18px; font-size: 13px; color: var(--ink); background: var(--paper); border-bottom: 1px solid var(--line-2); }
.update-notice > span { overflow-wrap: anywhere; }
.notice-actions { display: flex; align-items: center; gap: 8px; }
.update-ready-card { position:fixed; left:20px; bottom:20px; z-index:1100; width:min(380px,calc(100vw - 40px)); box-sizing:border-box; padding:16px; display:grid; gap:12px; border:1px solid var(--line-2); border-radius:12px; background:var(--paper); color:var(--ink); box-shadow:0 6px 24px rgba(0,0,0,.12); font-size:13px; }
.update-ready-card p { margin:0; line-height:1.6; overflow-wrap:anywhere; }
.ready-notes { margin:0; padding:10px; max-height:140px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; line-height:1.6; background:var(--desk); border-radius:6px; }
.ready-error { color:var(--zhu); }
</style>
