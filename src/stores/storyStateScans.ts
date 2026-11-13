import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ModelConfig } from './config'
import { useReconstructionWorkspaceStore } from './reconstructionWorkspace'
import { captureStoryStateScanBaseline, generateStoryStateProposalDrafts } from '@/services/storyPlanning'
import type { StoryStateScanSubmission } from '@/services/storyStateScanTransactions'

interface PendingScan { novelId: string; chapterId: string; title: string; input: StoryStateScanSubmission; error: string }
interface ScanOptions { activityParentId?: string; signal?: AbortSignal; expectedContent?: string }
const scanKey = (novelId: string, chapterId: string) => JSON.stringify([novelId, chapterId])

/** Keeps failed batches available to both the planner and completion background work. No automatic AI retry. */
export const useStoryStateScansStore = defineStore('storyStateScans', () => {
  const workspace = useReconstructionWorkspaceStore()
  const pending = ref<Record<string, PendingScan>>({})
  const running = ref<string[]>([])
  const tasks = new Map<string, Promise<number>>()
  const getPending = (novelId: string) => Object.values(pending.value).filter(item => item.novelId === novelId)
  const isRunning = (novelId: string, chapterId: string) => running.value.includes(scanKey(novelId, chapterId))

  function discard(novelId: string, chapterId: string) {
    const key = scanKey(novelId, chapterId)
    if (!tasks.has(key)) delete pending.value[key]
  }

  async function performScan(novelId: string, chapterId: string, model?: ModelConfig, options: ScanOptions = {}) {
    const key = scanKey(novelId, chapterId)
    options.signal?.throwIfAborted()
    if (!pending.value[key]) {
      if (!model) throw new Error('请先配置审查模型。')
      const { novel } = await workspace.prepareChapterAnalysis(novelId)
      const chapter = novel.chapters.find(item => item.id === chapterId)
      if (!chapter || !chapter.content.trim() || !['completed', 'reviewed', 'finalized', 'locked'].includes(chapter.status)) throw new Error('章节尚未完成，无法核对故事状态。')
      if (options.expectedContent !== undefined && chapter.content !== options.expectedContent) throw new Error('待扫描的章节正文已变化，请重新核对。')
      options.signal?.throwIfAborted()
      const baseline = captureStoryStateScanBaseline(novel, chapter)
      const proposals = await generateStoryStateProposalDrafts(novel, chapter, model, options.activityParentId, options.signal)
      options.signal?.throwIfAborted()
      pending.value[key] = { novelId, chapterId, title: chapter.title,
        input: { chapterId, baseline, proposals }, error: '' }
    }
    const entry = pending.value[key]
    try {
      const count = await workspace.saveStoryStateScan(novelId, entry.input, options.signal)
      if (pending.value[key] === entry) delete pending.value[key]
      return count
    } catch (error) {
      entry.error = error instanceof Error ? error.message : '故事状态提案保存失败，请重试。'
      throw error
    }
  }

  async function scan(novelId: string, chapterId: string, model?: ModelConfig, options: ScanOptions = {}) {
    options.signal?.throwIfAborted()
    const key = scanKey(novelId, chapterId), active = tasks.get(key)
    if (active) return active
    running.value.push(key)
    const task = performScan(novelId, chapterId, model, options)
    tasks.set(key, task)
    try { return await task } finally {
      if (tasks.get(key) === task) { tasks.delete(key); running.value = running.value.filter(item => item !== key) }
    }
  }
  return { getPending, isRunning, discard, scan }
})
