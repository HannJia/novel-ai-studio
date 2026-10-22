import { useDialog } from 'naive-ui'
import { useAppUpdateStore } from '@/stores/appUpdate'

export function useUpdateInstall() {
  const dialog = useDialog()
  const store = useAppUpdateStore()
  function confirmInstall() {
    if (store.state.phase !== 'downloaded' || !store.state.release) return
    dialog.warning({
      title: `安装 ${store.state.release.version} 并重启？`,
      content: '将先保存当前内容，再安装更新并重新打开软件。如有任务正在运行，请完成后再安装。',
      positiveText: '保存并安装', negativeText: '稍后',
      onPositiveClick: () => { void store.install() },
    })
  }
  return { confirmInstall }
}
