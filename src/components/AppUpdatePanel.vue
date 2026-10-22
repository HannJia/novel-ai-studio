<template>
  <div class="app-update-panel">
    <div class="update-overview">
      <div class="update-col update-col-current">
        <span class="update-version-label">当前版本</span><strong class="update-version-number">{{ state.currentVersion }}</strong>
        <p v-if="state.checkedAt" class="update-date">上次检查：{{ formatDate(state.checkedAt) }}</p>
      </div>
      <div class="update-col update-col-status">
        <p class="update-status" role="status">{{ statusText }}</p>
        <div v-if="state.phase === 'downloading'" class="update-progress">
          <n-progress type="line" :percentage="Math.round(state.percent)" :processing="true" />
          <span>{{ megabytes(state.transferred) }} / {{ megabytes(state.total) }} MB</span>
        </div>
        <p v-if="state.error" class="update-error" role="alert">{{ state.error }}</p>
        <p class="update-release-version" v-if="state.release">最新版本 {{ state.release.version }}</p>
      </div>
      <div class="update-col update-col-actions">
        <div class="update-preference">
          <label :for="switchId">自动更新</label>
          <n-switch :id="switchId" :value="state.autoCheck" :disabled="!state.supported || state.phase === 'installing'"
            aria-label="自动更新" @update:value="store.setAutoCheck" />
        </div>
        <p class="update-description">自动检查新版本并在后台下载；关闭后仍可手动检查、下载与安装。</p>
        <div class="update-actions">
          <n-button :disabled="!state.supported || busy || state.phase === 'downloaded'" :loading="state.phase === 'checking'"
            @click="store.check">
            <template #icon><n-icon><refresh-outline /></n-icon></template>
            {{ state.phase === 'error' ? '重新检查' : '检查更新' }}
          </n-button>
          <n-button v-if="state.phase === 'available' && state.release?.canDownload" type="primary" @click="store.download">
            <template #icon><n-icon><download-outline /></n-icon></template>下载更新
          </n-button>
          <n-button v-if="state.phase === 'downloading'" @click="store.cancel">
            <template #icon><n-icon><stop-outline /></n-icon></template>取消下载
          </n-button>
          <n-button v-if="state.phase === 'downloaded'" type="primary" @click="confirmInstall">
            <template #icon><n-icon><power-outline /></n-icon></template>安装并重启
          </n-button>
          <n-button v-if="state.supported" quaternary :disabled="state.phase === 'installing'" @click="store.openRelease">
            <template #icon><n-icon><open-outline /></n-icon></template>发布页
          </n-button>
          <a v-else class="update-release-link" href="https://github.com/HannJia/novel-ai-studio/releases"
            target="_blank" rel="noopener noreferrer">GitHub 发布页</a>
        </div>
      </div>
    </div>
    <details v-if="state.release" class="update-notes" open>
      <summary>更新内容<span v-if="state.release.publishedAt"> · {{ formatDate(state.release.publishedAt) }}</span></summary>
      <pre>{{ state.release.notes || '此版本未提供更新说明。' }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, useId } from 'vue'
import { NButton, NIcon, NProgress, NSwitch } from 'naive-ui'
import { RefreshOutline, DownloadOutline, StopOutline, PowerOutline, OpenOutline } from '@vicons/ionicons5'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { useUpdateInstall } from '@/composables/useUpdateInstall'

const store = useAppUpdateStore()
const switchId = useId()
const state = computed(() => store.state)
const { confirmInstall } = useUpdateInstall()
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.value.phase))
const statusText = computed(() => {
  switch (state.value.phase) {
    case 'unsupported': return '浏览器 / 开发环境不安装更新，请使用 Windows 安装版。'
    case 'checking': return '正在检查 GitHub 正式版本…'
    case 'current': return '当前已是最新版本。'
    case 'available': return state.value.release?.canDownload
      ? (state.value.autoCheck ? '发现新版本，准备后台下载。' : '发现新版本，可手动下载。')
      : '已发现新版本，下载信息尚未就绪，可重试检查或打开发布页。'
    case 'downloading': return '正在后台下载更新，可以继续使用软件。'
    case 'downloaded': return '更新已准备好，点击“安装并重启”应用新版。'
    case 'installing': return '正在保存并准备安装，请稍候…'
    case 'error': return '更新检查或下载未完成。'
    default: return state.value.autoCheck ? '自动更新已开启。' : '自动更新已关闭。'
  }
})
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN')
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
onMounted(() => { void store.init() })
</script>

<style scoped>
.app-update-panel { display: grid; gap: 14px; min-width: 0; font-size: 14px; }
.update-overview { display: grid; gap: 16px; grid-template-columns: 1fr; min-width: 0; }
.update-col { display: grid; gap: 8px; align-content: start; min-width: 0; }
.update-col-current strong { font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; }
.update-description { margin:0; font-size:12px; color:var(--text-color-secondary); line-height:1.6; }
.update-preference { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.update-release-version, .update-date, .update-progress > span { color: var(--text-color-secondary); font-size: 12px; margin: 0; }
.update-status, .update-error { margin: 0; overflow-wrap: anywhere; line-height: 1.6; }
.update-error { color: var(--color-error); }
.update-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.update-notes { border-top: 1px solid var(--border-color-light); padding-top: 12px; min-width: 0; }
.update-notes summary { cursor: pointer; line-height: 1.6; overflow-wrap: anywhere; }
.update-notes summary span { color: var(--text-color-secondary); font-size: 12px; }
.update-notes pre { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; margin: 10px 0 0; }
.update-release-link { color: var(--color-info); }
@media (min-width: 900px) {
  .update-overview { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.6fr); align-items: start; }
}
.update-overview { padding: 24px; border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); gap: 24px; }
.update-version-label { font-size: 16px; font-weight: 600; }
.update-col-current .update-version-number { font: 600 48px/1.3 var(--font-family-serif); }
.update-col-status .update-status { font: 600 21px/1.6 var(--font-family-serif); }
.update-release-version { color: var(--color-primary); font-size: 16px; }
.update-col-actions .update-preference label { font-weight: 600; font-size: 16px; }
.update-notes { padding: 24px; border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); }
.update-notes summary { font: 600 24px var(--font-family-serif); }
@media (min-width: 900px) { .update-col + .update-col { border-left: 1px solid var(--border-color-light); padding-left: 24px; } }
@media (max-width: 650px) { .update-overview, .update-notes { padding: 16px; } }
</style>
