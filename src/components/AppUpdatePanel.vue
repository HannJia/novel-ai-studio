<template>
  <div class="app-update-panel">
    <div class="update-version-row">
      <strong>当前版本 {{ state.currentVersion }}</strong>
      <span v-if="state.release">最新版本 {{ state.release.version }}</span>
    </div>
    <div class="update-preference">
      <label :for="switchId">自动检查更新</label>
      <n-switch :id="switchId" :value="state.autoCheck" :disabled="!state.supported || busy"
        aria-label="自动检查更新" @update:value="store.setAutoCheck" />
    </div>
    <p class="update-status" role="status">{{ statusText }}</p>
    <div v-if="state.phase === 'downloading'" class="update-progress">
      <n-progress type="line" :percentage="Math.round(state.percent)" :processing="true" />
      <span>{{ megabytes(state.transferred) }} / {{ megabytes(state.total) }} MB</span>
    </div>
    <p v-if="state.error" class="update-error" role="alert">{{ state.error }}</p>
    <p v-if="state.checkedAt" class="update-date">上次检查：{{ formatDate(state.checkedAt) }}</p>
    <details v-if="state.release" class="update-notes" open>
      <summary>更新内容<span v-if="state.release.publishedAt"> · {{ formatDate(state.release.publishedAt) }}</span></summary>
      <pre>{{ state.release.notes || '此版本未提供更新说明。' }}</pre>
    </details>
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
</template>

<script setup lang="ts">
import { computed, onMounted, useId } from 'vue'
import { NButton, NIcon, NProgress, NSwitch, useDialog } from 'naive-ui'
import { RefreshOutline, DownloadOutline, StopOutline, PowerOutline, OpenOutline } from '@vicons/ionicons5'
import { useAppUpdateStore } from '@/stores/appUpdate'

const store = useAppUpdateStore()
const switchId = useId()
const state = computed(() => store.state)
const dialog = useDialog()
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.value.phase))
const statusText = computed(() => {
  switch (state.value.phase) {
    case 'unsupported': return '浏览器 / 开发环境不安装更新，请使用 Windows 安装版。'
    case 'checking': return '正在检查 GitHub 正式版本…'
    case 'current': return '当前已是最新版本。'
    case 'available': return state.value.release?.canDownload
      ? '发现新版本，等待下载。' : '已发现新版本，下载信息尚未就绪，可重试检查或打开发布页。'
    case 'downloading': return '正在下载安装包…'
    case 'downloaded': return '安装包已下载并校验，等待安装。'
    case 'installing': return '正在保存并准备安装，请稍候…'
    case 'error': return '更新检查或下载未完成。'
    default: return state.value.autoCheck ? '自动检查已开启。' : '自动检查已关闭。'
  }
})
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN')
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
function confirmInstall() {
  dialog.warning({
    title: `安装 ${state.value.release?.version} 并重启？`,
    content: '将先保存正文、知识库与配置，再退出并启动安装程序。若 AI 任务仍在运行或保存失败，本次安装会取消。',
    positiveText: '保存并安装', negativeText: '稍后',
    onPositiveClick: () => { void store.install() },
  })
}
onMounted(() => { void store.init() })
</script>

<style scoped>
.app-update-panel { display: grid; gap: 12px; min-width: 0; font-size: 14px; }
.update-version-row, .update-preference { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.update-version-row span, .update-date, .update-progress > span { color: var(--text-color-secondary); font-size: 12px; }
.update-status, .update-date, .update-error { margin: 0; overflow-wrap: anywhere; line-height: 1.6; }
.update-error { color: var(--color-error); }
.update-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.update-notes { border-top: 1px solid var(--border-color-light); padding-top: 12px; min-width: 0; }
.update-notes summary { cursor: pointer; line-height: 1.6; overflow-wrap: anywhere; }
.update-notes summary span { color: var(--text-color-secondary); font-size: 12px; }
.update-notes pre { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; margin: 10px 0 0; }
.update-release-link { color: var(--color-info); }
</style>
