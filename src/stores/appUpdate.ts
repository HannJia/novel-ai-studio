import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { version } from '../../package.json'
import type { AppUpdateState } from '@/types/update'
import { appUpdateInstalling } from '@/services/appLifecycle'

export const useAppUpdateStore = defineStore('app-update', () => {
  const state = ref<AppUpdateState>({
    supported: false, currentVersion: version, phase: 'unsupported', autoCheck: true,
    release: null, checkedAt: '', error: '', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, revision: -1,
  })
  const detailsOpen = ref(false)
  const dismissed = ref('')
  let initialization: Promise<void> | null = null
  let unsubscribe: (() => void) | undefined
  const wake = () => { if (window.electronAPI?.updateWake) void run(window.electronAPI.updateWake) }
  function apply(next: AppUpdateState) {
    if (next.revision < state.value.revision) return
    state.value = next
    appUpdateInstalling.value = next.phase === 'installing'
  }
  async function run(action: () => Promise<AppUpdateState>) {
    try { apply(await action()) }
    catch {
      state.value = { ...state.value, error: '更新操作失败，请稍后重试或打开发布页。' }
      appUpdateInstalling.value = false
    }
  }
  function init(): Promise<void> {
    if (initialization) return initialization
    initialization = (async () => {
      const api = window.electronAPI
      if (!api?.updateGetState || !api.onUpdateState) return
      unsubscribe = api.onUpdateState(apply)
      window.addEventListener('online', wake)
      await run(api.updateGetState)
    })()
    return initialization
  }
  const noticeKey = computed(() => `${state.value.release?.version}:${state.value.phase}`)
  const showNotice = computed(() => state.value.supported && ['available', 'downloaded', 'error'].includes(state.value.phase)
    && dismissed.value !== noticeKey.value)
  function dismissNotice() { dismissed.value = noticeKey.value }
  async function check() {
    await init()
    if (state.value.supported) await run(() => window.electronAPI!.updateCheck())
  }
  async function download() { await run(() => window.electronAPI!.updateDownload()) }
  async function cancel() { await run(() => window.electronAPI!.updateCancel()) }
  async function install() { await run(() => window.electronAPI!.updateInstall()) }
  async function setAutoCheck(enabled: boolean) { await run(() => window.electronAPI!.updateSetAutoCheck(enabled)) }
  async function openRelease() {
    try { await window.electronAPI?.updateOpenRelease?.() }
    catch { state.value = { ...state.value, error: '无法打开发布页，请检查默认浏览器设置。' } }
  }
  onScopeDispose(() => { unsubscribe?.(); window.removeEventListener('online', wake) })
  return { state, init, detailsOpen, showNotice, dismissNotice, check, download, cancel, install, setAutoCheck, openRelease }
})
