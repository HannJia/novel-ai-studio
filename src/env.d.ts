/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ElectronAPI {
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
}

interface Window {
  electronAPI?: ElectronAPI
}
