export interface AppUpdateRelease {
  version: string
  url: string
  notes: string
  publishedAt: string
  canDownload: boolean
}

export interface AppUpdateState {
  supported: boolean
  currentVersion: string
  phase: 'unsupported' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  autoCheck: boolean
  release: AppUpdateRelease | null
  checkedAt: string
  error: string
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
  revision: number
}
