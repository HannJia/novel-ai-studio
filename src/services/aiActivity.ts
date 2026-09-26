import { computed, reactive, ref } from 'vue'
import { appUpdateInstalling, cloudApplyBusy } from './appLifecycle'

export type AiActivityStatus = 'running' | 'completed' | 'failed'

export interface AiActivity {
  id: string
  name: string
  parentId?: string
  status: AiActivityStatus
  route: string
  startedAt: string
  finishedAt?: string
  error?: string
}

const activities = reactive<AiActivity[]>([])
const MAX_VISIBLE_COMPLETED = 20
export const COMPLETED_ACTIVITY_TTL_MS = 30_000
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
const activeIds = new Set<string>()
export const activeAiCount = ref(0)

function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/'
  return window.location.hash.replace(/^#/, '') || '/'
}

function rootOf(activity: AiActivity): AiActivity {
  let root = activity
  const seen = new Set([activity.id])
  while (root.parentId) {
    const parent = activities.find(item => item.id === root.parentId)
    if (!parent || seen.has(parent.id)) break
    root = parent
    seen.add(parent.id)
  }
  return root
}

function groupOf(root: AiActivity): AiActivity[] {
  return activities.filter(item => rootOf(item).id === root.id)
}

function groupIsRunning(root: AiActivity): boolean {
  return groupOf(root).some(item => item.status === 'running')
}

function groupHasFailure(root: AiActivity): boolean {
  return groupOf(root).some(item => item.status === 'failed')
}

export function aiActivityState(activity: AiActivity): AiActivityStatus {
  const root = rootOf(activity)
  if (groupIsRunning(root)) return 'running'
  if (groupHasFailure(root)) return 'failed'
  return 'completed'
}

function scheduleCompletedCleanup(root: AiActivity) {
  const existing = cleanupTimers.get(root.id)
  if (existing) clearTimeout(existing)
  cleanupTimers.delete(root.id)
  if (root.status !== 'completed') return
  const group = groupOf(root)
  if (group.some(item => item.status === 'running' || item.status === 'failed')) return
  const lastFinished = Math.max(...group.map(item => Date.parse(item.finishedAt || '') || 0))
  const delay = Math.max(0, lastFinished + COMPLETED_ACTIVITY_TTL_MS - Date.now())
  cleanupTimers.set(root.id, setTimeout(() => {
    cleanupTimers.delete(root.id)
    const current = activities.find(item => item.id === root.id)
    if (current && current.status === 'completed' && !groupIsRunning(current)
      && !groupHasFailure(current)) {
      acknowledgeAiActivity(current.id)
    }
  }, delay))
}

function trimActivities() {
  const completed = activities.filter(item => !item.parentId && aiActivityState(item) === 'completed')
  for (const item of completed.slice(0, -MAX_VISIBLE_COMPLETED)) acknowledgeAiActivity(item.id)
}

export function startAiActivity(name: string, parentId?: string): AiActivity {
  if (cloudApplyBusy.value) throw new Error('正在合并云端内容，请稍后重试。')
  if (appUpdateInstalling.value) throw new Error('正在保存并准备安装更新，暂时不能启动 AI 任务。')
  const activity: AiActivity = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    parentId: parentId && activities.some(item => item.id === parentId) ? parentId : undefined,
    status: 'running',
    route: currentRoutePath(),
    startedAt: new Date().toISOString(),
  }
  activities.push(activity)
  activeIds.add(activity.id)
  activeAiCount.value = activeIds.size
  return activity
}

export function finishAiActivity(activity: AiActivity, error?: unknown) {
  activeIds.delete(activity.id)
  activeAiCount.value = activeIds.size
  if (!activities.some(item => item.id === activity.id)) return
  activity.status = error ? 'failed' : 'completed'
  activity.finishedAt = new Date().toISOString()
  if (error) activity.error = error instanceof Error ? error.message : String(error)
  scheduleCompletedCleanup(rootOf(activity))
  trimActivities()
}

export function acknowledgeAiActivity(id: string) {
  const removeIds = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const activity of activities) {
      if (activity.parentId && removeIds.has(activity.parentId) && !removeIds.has(activity.id)) {
        removeIds.add(activity.id)
        changed = true
      }
    }
  }
  for (let index = activities.length - 1; index >= 0; index--) {
    if (removeIds.has(activities[index].id)) activities.splice(index, 1)
  }
  for (const id of removeIds) {
    const timer = cleanupTimers.get(id)
    if (timer) clearTimeout(timer)
    cleanupTimers.delete(id)
  }
}

export function openAiActivity(activity: AiActivity) {
  const target = activity.route
  const root = rootOf(activity)
  if (!groupIsRunning(root)) acknowledgeAiActivity(root.id)
  if (!target || target === currentRoutePath()) return
  void import('@/router').then(({ default: router }) => router.push(target))
}

export function useAiActivities() {
  const visibleActivities = computed(() => activities.slice())
  const topLevelActivities = computed(() => visibleActivities.value.filter(item => !item.parentId)
    .sort((a, b) => Number(aiActivityState(b) === 'running') - Number(aiActivityState(a) === 'running')))
  const runningActivities = computed(() => topLevelActivities.value.filter(item => aiActivityState(item) === 'running'))
  const completedActivities = computed(() => topLevelActivities.value.filter(item => aiActivityState(item) !== 'running'))
  const childrenOf = (parentId: string) => visibleActivities.value.filter(item => item.parentId === parentId)
  return {
    activities: topLevelActivities,
    allActivities: visibleActivities,
    runningActivities,
    completedActivities,
    childrenOf,
    aiActivityState,
  }
}
