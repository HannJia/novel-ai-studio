import { computed, reactive, ref } from 'vue'
import { appUpdateInstalling } from './appLifecycle'

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
const activeIds = new Set<string>()
export const activeAiCount = ref(0)

function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/'
  return window.location.hash.replace(/^#/, '') || '/'
}

function trimActivities() {
  const completed = activities.filter(item => item.status !== 'running')
  if (completed.length <= MAX_VISIBLE_COMPLETED) return
  const keep = new Set(completed.slice(-MAX_VISIBLE_COMPLETED).map(item => item.id))
  for (let index = activities.length - 1; index >= 0; index--) {
    if (activities[index].status !== 'running' && !keep.has(activities[index].id)) activities.splice(index, 1)
  }
}

export function startAiActivity(name: string, parentId?: string): AiActivity {
  if (appUpdateInstalling.value) throw new Error('正在保存并准备安装更新，暂时不能启动 AI 任务。')
  const activity: AiActivity = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    parentId,
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
}

export function openAiActivity(activity: AiActivity) {
  const target = activity.route
  let rootId = activity.id
  let parentId = activity.parentId
  while (parentId) {
    const parent = activities.find(item => item.id === parentId)
    if (!parent) break
    rootId = parent.id
    parentId = parent.parentId
  }
  acknowledgeAiActivity(rootId)
  if (!target || target === currentRoutePath()) return
  void import('@/router').then(({ default: router }) => router.push(target))
}

export function useAiActivities() {
  const visibleActivities = computed(() => activities.slice())
  const topLevelActivities = computed(() => visibleActivities.value.filter(item => !item.parentId))
  const runningActivities = computed(() => topLevelActivities.value.filter(item => item.status === 'running'))
  const completedActivities = computed(() => topLevelActivities.value.filter(item => item.status !== 'running'))
  const childrenOf = (parentId: string) => visibleActivities.value.filter(item => item.parentId === parentId)
  return {
    activities: topLevelActivities,
    allActivities: visibleActivities,
    runningActivities,
    completedActivities,
    childrenOf,
  }
}
