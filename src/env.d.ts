/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ElectronAPI {
  cloudSessionRead: () => Promise<import('./services/cloudSyncModel').CloudSession | null>
  cloudSessionWrite: (value: import('./services/cloudSyncModel').CloudSession | null) => Promise<void>
  getVersion: () => string
  dbRead: () => Promise<ArrayBuffer | null>
  dbReadBackup: () => Promise<ArrayBuffer | null>
  dbPrepareRecovery: () => Promise<void>
  dbRetainProjectBackup: (serialized: string) => Promise<void>
  dbWrite: (data: ArrayBuffer) => Promise<void>
  dbGetPath: () => Promise<string>
  configRead: () => Promise<string | null>
  configWrite: (data: string) => Promise<void>
  configEncrypt: (value: string) => Promise<string>
  configDecrypt: (value: string) => Promise<string>
  configSecurityStatus: () => Promise<{ encryptionAvailable: boolean }>
  onBeforeClose: (callback: () => void | Promise<void>) => () => void
  updateGetState: () => Promise<import('./types/update').AppUpdateState>
  updateCheck: () => Promise<import('./types/update').AppUpdateState>
  updateDownload: () => Promise<import('./types/update').AppUpdateState>
  updateCancel: () => Promise<import('./types/update').AppUpdateState>
  updateInstall: () => Promise<import('./types/update').AppUpdateState>
  updateSetAutoCheck: (enabled: boolean) => Promise<import('./types/update').AppUpdateState>
  updateOpenRelease: () => Promise<void>
  onUpdateState: (callback: (state: import('./types/update').AppUpdateState) => void) => () => void
  onBeforeUpdate: (callback: () => void | Promise<void>) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
