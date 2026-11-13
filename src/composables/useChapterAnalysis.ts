import { computed, ref, type Ref } from 'vue'
import { callAI } from '@/services/ai'
import { buildChapterAnalysisPrompt } from '@/services/prompts'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { buildDataMemoryProposals, DATA_MEMORY_OUTPUT, DATA_MEMORY_RULES } from '@/services/dataPanelExtraction'
import { equipmentSnapshot, formatEquipmentTotals } from '@/services/dataPanelEquipment'
import { projectDataPanelReferences } from '@/services/dataPanelReference'
import type { DataPanelItem } from '@/types/novel'
import { parseAiJsonArray, parseAiJsonObject } from '@/utils/aiJson'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates, isCompleteChapterAnalysis, type ChapterAnalysisCandidatePayload } from '@/services/reconstructionCandidates'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { formatCharacterAnalysisReferences, formatCharacterStateContext } from '@/services/reconstructionCharacterState'
import type { CandidateChange } from '@/types/reconstruction'
import { captureChapterAnalysisBaseline, formatChapterAnalysisPlans, type ChapterAnalysisSubmission } from '@/services/chapterAnalysisTransactions'
import { assertStructuredOutputComplete } from '@/services/aiDiagnostics'
import { formatEventCausalityAnalysisReferences } from '@/services/eventCausality'

export interface ChapterStructureAnalysisOptions {
  target?: { novelId: string; chapterId: string }
  includeTimeline?: boolean
  includeCharacters?: boolean
  includeDataChanges?: boolean
  activityParentId?: string
  signal?: AbortSignal
}

export interface DataPanelScanTarget {
  novelId: string
  chapterIndex: number
  content: string
  panels: DataPanelItem[]
  activityParentId?: string
}

interface UseChapterAnalysisOptions {
  currentNovelId: Ref<string>
  currentChapterId: Ref<string>
  currentContent: Ref<string>
  currentPanels: Ref<DataPanelItem[]>
  onInfo?: (message: string) => void
  onWarning?: (message: string) => void
  onDataChangesDetected?: (result: { novelId: string; chapterIndex: number; count: number; foreground: boolean }) => void
  onCandidatesDetected?: (result: {
    novelId: string
    chapterId: string
    chapterIndex: number
    sourceVersionId: string
    candidates: CandidateChange[]
  }) => void
}

interface ChapterAnalysisPayload extends ChapterAnalysisCandidatePayload {
  events?: Array<Record<string, any>>
  characters?: Array<Record<string, any>>
  globalPlans?: Array<Record<string, any>>
  timeAdvanceDays?: number
  newItems?: Array<Record<string, any>>
  equipmentChanges?: Array<Record<string, any>>
  dataChanges?: Array<Record<string, any>>
}

export function buildDataScanContent(sourceContent: string, panels: DataPanelItem[]): string {
  const text = sourceContent.trim()
  if (text.length <= 5000) return text
  const keywords = panels.flatMap(item => [
    item.name,
    ...item.relatedKeywords,
    ...item.fields.map(field => field.name),
  ]).filter(Boolean)
  const snippets: string[] = []
  let snippetLength = 0
  for (const keyword of keywords) {
    let start = 0
    while (snippetLength < 7000) {
      const index = text.indexOf(keyword, start)
      if (index < 0) break
      const from = Math.max(0, index - 280)
      const to = Math.min(text.length, index + keyword.length + 420)
      const snippet = text.slice(from, to)
      snippets.push(snippet)
      snippetLength += snippet.length
      start = index + keyword.length
    }
  }
  if (snippets.length > 0) return Array.from(new Set(snippets)).join('\n\n---\n\n').slice(0, 8000)
  const partSize = 1800
  const middle = Math.max(0, Math.floor(text.length / 2) - Math.floor(partSize / 2))
  return [text.slice(0, partSize), text.slice(middle, middle + partSize), text.slice(-partSize)].join('\n\n---\n\n')
}

function formatDataPanelText(panels: DataPanelItem[]): string {
  return panels.map(item => {
    const fields = item.fields.map(field => `  - ${field.name}：${field.value}${field.unit ? ` ${field.unit}` : ''}${field.modifier ? `；加成规则 ${JSON.stringify(field.modifier)}` : ''}`).join('\n')
    return `- ID(${item.id}) [${item.category}] ${item.name}（${equipmentSnapshot(item, panels)}）\n${fields}\n${formatEquipmentTotals(panels, item.id)}`
  }).join('\n')
}

export function useChapterAnalysis(options: UseChapterAnalysisOptions) {
  const novelStore = useNovelStore()
  const configStore = useConfigStore()
  const workspace = useReconstructionWorkspaceStore()
  const scanningDataChanges = ref(false)
  const structureTasks = new Map<string, { selection: string; task: Promise<boolean> }>()
  const dataTasks = new Map<string, Promise<void>>()
  const pendingAnalyses = ref<Record<string, { novelId: string; chapterIndex: number; options: string; input: ChapterAnalysisSubmission; error: string }>>({})
  const analysisKey = (novelId: string, chapterId: string) => JSON.stringify([novelId, chapterId])
  const pendingChapterAnalysis = computed(() => pendingAnalyses.value[analysisKey(options.currentNovelId.value, options.currentChapterId.value)])
  const pendingDataAnalysis = computed(() => pendingAnalyses.value[analysisKey(options.currentNovelId.value, options.currentChapterId.value) + ':data'])
  function discardPendingChapterAnalysis() { delete pendingAnalyses.value[analysisKey(options.currentNovelId.value, options.currentChapterId.value)] }
  function discardPendingDataAnalysis() { delete pendingAnalyses.value[analysisKey(options.currentNovelId.value, options.currentChapterId.value) + ':data'] }

  async function savePendingAnalysis(key: string, signal?: AbortSignal) {
    const pending = pendingAnalyses.value[key]
    if (!pending) return false
    signal?.throwIfAborted()
    try {
      const saved = await workspace.saveChapterAnalysis(pending.novelId, pending.input, signal)
      if (pendingAnalyses.value[key] === pending) delete pendingAnalyses.value[key]
      options.onCandidatesDetected?.({ novelId: pending.novelId, chapterId: pending.input.chapterId,
        chapterIndex: pending.chapterIndex, sourceVersionId: pending.input.sourceVersionId, candidates: pending.input.candidates })
      if (saved.candidates) options.onInfo?.('已保存 ' + saved.candidates + ' 条故事变化候选，请确认后写入长期记忆')
      if (saved.dataChanges) options.onDataChangesDetected?.({ novelId: pending.novelId, chapterIndex: pending.chapterIndex,
        count: saved.dataChanges, foreground: pending.novelId === options.currentNovelId.value && pending.input.chapterId === options.currentChapterId.value })
      return true
    } catch (error) {
      pending.error = error instanceof Error ? error.message : '分析结果保存失败，请重试'
      throw error
    }
  }

  async function analyzeChapterStructure(model: ModelConfig, analysisOptions: ChapterStructureAnalysisOptions = {}) {
    const key = analysisKey(analysisOptions.target?.novelId || options.currentNovelId.value,
      analysisOptions.target?.chapterId || options.currentChapterId.value)
    const active = structureTasks.get(key)
    const selection = JSON.stringify([analysisOptions.includeTimeline ?? true, analysisOptions.includeCharacters ?? true, analysisOptions.includeDataChanges ?? true])
    if (active) {
      if (active.selection !== selection) throw new Error('本章正在分析不同范围，请等当前任务完成。')
      return active.task
    }
    const task = performChapterStructureAnalysis(model, analysisOptions)
    structureTasks.set(key, { selection, task })
    try { return await task } finally { if (structureTasks.get(key)?.task === task) structureTasks.delete(key) }
  }

  async function performChapterStructureAnalysis(
    model: ModelConfig,
    analysisOptions: ChapterStructureAnalysisOptions = {},
  ) {
    const targetNovelId = analysisOptions.target?.novelId || options.currentNovelId.value
    const targetChapterId = analysisOptions.target?.chapterId || options.currentChapterId.value
    const includeTimeline = analysisOptions.includeTimeline ?? true
    const includeCharacters = analysisOptions.includeCharacters ?? true
    const includeDataChanges = analysisOptions.includeDataChanges ?? true
    const key = analysisKey(targetNovelId, targetChapterId), selection = JSON.stringify([includeTimeline, includeCharacters, includeDataChanges])
    if (pendingAnalyses.value[key]) {
      if (pendingAnalyses.value[key].options !== selection) throw new Error('还有不同范围的分析结果待保存，请先处理或放弃。')
      return savePendingAnalysis(key, analysisOptions.signal)
    }
    const source = await workspace.prepareChapterAnalysis(targetNovelId), targetNovel = source.novel
    const targetChapter = targetNovel.chapters.find(item => item.id === targetChapterId)
    if (!targetChapter) return false
    analysisOptions.signal?.throwIfAborted()
    const baseline = captureChapterAnalysisBaseline(targetNovel, targetChapter, source.canonMutations)
    const sourceContent = targetChapter.content
    let result = ''
    const response = await callAI({
      model,
      skillTask: 'analysis',
      structuredOutput: 'concise-json',
      messages: buildChapterAnalysisPrompt(
        sourceContent,
        formatDataPanelText(projectDataPanelReferences(targetNovel, targetChapter.chapterIndex).items),
        formatChapterAnalysisPlans(targetNovel, targetChapter.chapterIndex),
        formatCharacterAnalysisReferences(targetNovel, targetChapter.chapterIndex),
        formatCharacterStateContext(targetNovel, source.canonMutations, targetChapter.chapterIndex),
        formatEventCausalityAnalysisReferences(targetNovel, targetChapter.chapterIndex),
      ),
      stream: true,
      taskName: '更新章节记忆',
      noAutomaticRetry: true,
      activityParentId: analysisOptions.activityParentId,
      signal: analysisOptions.signal,
      onChunk: chunk => { result += chunk },
    })
    assertStructuredOutputComplete(response, '章节记忆')

    const parsed = parseAiJsonObject<ChapterAnalysisPayload>(response.content || result)
    if (!isCompleteChapterAnalysis(parsed)) {
      options.onWarning?.('故事变化提取不完整或因果条目格式无效；需要事件、角色、知情与关系数组，可选因果条目须使用有效ID、方向、类型和说明。请重新分析。')
      return false
    }
    if (analysisOptions.signal?.aborted) throw analysisOptions.signal.reason
    if (novelStore.getNovel(targetNovelId)?.chapters.find(item => item.id === targetChapterId)?.content !== sourceContent) {
      options.onWarning?.('正文已变化，已跳过旧版本的分析结果')
      return false
    }

    const elapsedDays = Math.max(0, Number(parsed.timeAdvanceDays) || 0)
    const sourceVersionId = buildAnalysisSourceVersionId(sourceContent)

    const candidates = buildChapterAnalysisCandidates(targetNovel, targetChapter, sourceVersionId, {
      events: includeTimeline ? parsed.events : [],
      globalPlans: includeTimeline ? parsed.globalPlans : [],
      eventCausalityChanges: includeTimeline ? parsed.eventCausalityChanges : [],
      characters: includeCharacters ? parsed.characters : [],
      timeAdvanceDays: includeTimeline ? elapsedDays : 0,
      knowledgeChanges: includeCharacters ? parsed.knowledgeChanges : [],
      relationshipChanges: includeCharacters ? parsed.relationshipChanges : [],
    })
    pendingAnalyses.value[key] = { novelId: targetNovelId, chapterIndex: targetChapter.chapterIndex, options: selection, error: '',
      input: { chapterId: targetChapterId, sourceVersionId, baseline,
        candidates: candidates.map(candidate => ({ ...candidate, id: candidate.id + ':payload:' + buildAnalysisSourceVersionId(candidate.proposedValue) })),
        dataProposals: includeDataChanges ? buildDataMemoryProposals(targetNovel, targetChapter.chapterIndex, sourceContent, parsed) : [] } }
    return savePendingAnalysis(key, analysisOptions.signal)
  }

  async function scanDataPanelChanges(modelArg?: ModelConfig, target?: DataPanelScanTarget) {
    const key = JSON.stringify([target?.novelId || options.currentNovelId.value, target?.chapterIndex ?? options.currentChapterId.value])
    const active = dataTasks.get(key)
    if (active) return active
    if (!target) scanningDataChanges.value = true
    const task = performDataPanelScan(modelArg, target)
    dataTasks.set(key, task)
    try { await task } finally {
      if (dataTasks.get(key) === task) dataTasks.delete(key)
      if (!target) scanningDataChanges.value = false
    }
  }

  async function performDataPanelScan(modelArg?: ModelConfig, target?: DataPanelScanTarget) {
    const targetNovelId = target?.novelId || options.currentNovelId.value
    const activeNovel = novelStore.getNovel(targetNovelId)
    const currentChapter = activeNovel?.chapters.find(item => item.id === options.currentChapterId.value)
    const targetChapterIndex = target?.chapterIndex ?? currentChapter?.chapterIndex
    const targetContent = target?.content ?? options.currentContent.value
    if (!activeNovel || targetChapterIndex === undefined || !targetContent.trim()) return
    const source = await workspace.prepareChapterAnalysis(targetNovelId), targetNovel = source.novel
    const targetPanels = targetNovel.dataPanels || []
    const sourceChapter = targetNovel.chapters.find(item => item.chapterIndex === targetChapterIndex)
    const sourceChapterId = sourceChapter?.id
    const savedContent = sourceChapter?.content
    if (!sourceChapter || targetContent !== savedContent || target && JSON.stringify(target.panels) !== JSON.stringify(targetPanels)) {
      options.onWarning?.('正文或数据面板已变化，请先保存当前正文再扫描。'); return
    }
    const key = analysisKey(targetNovelId, sourceChapter.id) + ':data'
    const baseline = captureChapterAnalysisBaseline(targetNovel, sourceChapter, source.canonMutations)
    const model = modelArg || configStore.getModelForTask('review') || configStore.getModelForTask('writing')
    if (!model) {
      options.onWarning?.('请先在设置页配置 AI 模型')
      return
    }
    if (!target) scanningDataChanges.value = true
    let result = ''
    try {
      if (pendingAnalyses.value[key]) { await savePendingAnalysis(key); return }
      const response = await callAI({
        model,
        skillTask: 'analysis',
        noAutomaticRetry: true,
        messages: [{
          role: 'system',
          content: '你是小说数据连续性分析助手。只根据正文中明确出现的证据判断数据变化，不要推测未写出的变化；必须区分明确变化、可能变化和无变化。',
        }, {
          role: 'user',
          content: `请提取本章数据记忆，包括新对象、装备状态和已有字段变化。
${DATA_MEMORY_RULES}

【已知角色】
${[targetNovel.settings.protagonist.name, formatCharacterAnalysisReferences(targetNovel, targetChapterIndex)].filter(Boolean).join('\n')}

【当前数据面板】
${formatDataPanelText(projectDataPanelReferences(targetNovel, targetChapterIndex).items)}

【本章完整正文】
${targetContent}

【输出格式】只输出 JSON 对象，不要解释：
${DATA_MEMORY_OUTPUT}`,
        }],
        stream: true,
        activityParentId: target?.activityParentId,
        onChunk: chunk => { result += chunk },
      })
      assertStructuredOutputComplete(response, '数据变更扫描')
      result = response.content || result
      const latestNovel = novelStore.getNovel(targetNovelId)
      const latestChapter = latestNovel?.chapters.find(item => item.id === sourceChapterId)
      if (!latestNovel || !latestChapter || latestChapter.content !== savedContent
        || (!target && options.currentChapterId.value === sourceChapterId && options.currentContent.value !== targetContent)) {
        options.onWarning?.('正文已变化，已跳过旧版本的数据扫描结果')
        return
      }
      const object = parseAiJsonObject<Record<string, unknown>>(result)
      const payload = object && ['newItems', 'equipmentChanges', 'dataChanges'].some(key => Array.isArray(object[key]))
        ? object : parseAiJsonArray(result)
      const dataProposals = buildDataMemoryProposals(targetNovel, targetChapterIndex, targetContent, payload)
      pendingAnalyses.value[key] = { novelId: targetNovelId, chapterIndex: targetChapterIndex, options: 'data', error: '',
        input: { chapterId: sourceChapter.id, sourceVersionId: buildAnalysisSourceVersionId(savedContent!), baseline, candidates: [], dataProposals } }
      await savePendingAnalysis(key)
      if (!dataProposals.length) options.onInfo?.('未检测到明确的数据变更')
    } catch (error) {
      options.onWarning?.(pendingAnalyses.value[key]
        ? '数据扫描结果尚未保存，已保留，可重试：' + (error instanceof Error ? error.message : String(error))
        : '数据变更扫描失败，已跳过')
    } finally {
      if (!target) scanningDataChanges.value = false
    }
  }

  return { scanningDataChanges, analyzeChapterStructure, scanDataPanelChanges, pendingChapterAnalysis, discardPendingChapterAnalysis,
    pendingDataAnalysis, discardPendingDataAnalysis }
}
