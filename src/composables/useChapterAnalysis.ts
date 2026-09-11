import { ref, type Ref } from 'vue'
import { callAI } from '@/services/ai'
import { buildChapterAnalysisPrompt } from '@/services/prompts'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
import { buildDataMemoryProposals, DATA_MEMORY_OUTPUT, DATA_MEMORY_RULES } from '@/services/dataPanelExtraction'
import { equipmentSnapshot, formatEquipmentTotals } from '@/services/dataPanelEquipment'
import type { DataPanelItem, Novel } from '@/types/novel'
import { parseAiJsonArray, parseAiJsonObject } from '@/utils/aiJson'

export interface ChapterStructureAnalysisOptions {
  target?: { novelId: string; chapterId: string }
  includeTimeline?: boolean
  includeCharacters?: boolean
  includeDataChanges?: boolean
  replaceExistingAiTimeline?: boolean
  activityParentId?: string
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
}

interface ChapterAnalysisPayload {
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

function formatActiveGlobalPlanText(novel: Novel): string {
  return (novel.eventLog || [])
    .filter(event => event.type === '伏笔' && (event.status === 'planted' || event.status === 'developing'))
    .map(event => `- ID(${event.id}): 「${event.title}」- 当前状态：${event.status === 'planted' ? '已埋下' : '推进中'}`)
    .join('\n')
}

export function useChapterAnalysis(options: UseChapterAnalysisOptions) {
  const novelStore = useNovelStore()
  const configStore = useConfigStore()
  const scanningDataChanges = ref(false)

  function queueMemory(novel: Novel, chapterIndex: number, content: string, payload: unknown): number {
    let count = 0
    for (const proposal of buildDataMemoryProposals(novel, chapterIndex, content, payload)) {
      if (novelStore.addDataPanelChange(novel.id, proposal)) count++
    }
    return count
  }

  async function analyzeChapterStructure(
    model: ModelConfig,
    analysisOptions: ChapterStructureAnalysisOptions = {},
  ) {
    const targetNovelId = analysisOptions.target?.novelId || options.currentNovelId.value
    const targetChapterId = analysisOptions.target?.chapterId || options.currentChapterId.value
    const targetNovel = novelStore.getNovel(targetNovelId)
    const targetChapter = targetNovel?.chapters.find(item => item.id === targetChapterId)
    if (!targetNovel || !targetChapter) return
    const includeTimeline = analysisOptions.includeTimeline ?? true
    const includeCharacters = analysisOptions.includeCharacters ?? true
    const includeDataChanges = analysisOptions.includeDataChanges ?? true
    const targetPanels = targetNovel.dataPanels || []
    const sourceContent = targetChapter.content
    let result = ''
    await callAI({
      model,
      skillTask: 'analysis',
      messages: buildChapterAnalysisPrompt(
        sourceContent,
        formatDataPanelText(targetPanels),
        formatActiveGlobalPlanText(targetNovel),
      ),
      stream: true,
      activityParentId: analysisOptions.activityParentId,
      onChunk: chunk => { result += chunk },
    })

    const parsed = parseAiJsonObject<ChapterAnalysisPayload>(result)
    if (!parsed) return
    if (novelStore.getNovel(targetNovelId)?.chapters.find(item => item.id === targetChapterId)?.content !== sourceContent) {
      options.onWarning?.('正文已变化，已跳过旧版本的分析结果')
      return
    }

    const elapsedDays = Math.max(0, Number(parsed.timeAdvanceDays) || 0)
    if (elapsedDays > 0 && targetChapter.storyDay === undefined) {
      novelStore.advanceStoryClock(targetNovel.id, elapsedDays, targetChapter.chapterIndex)
      novelStore.queueAutomaticDataPanelChanges(
        targetNovel.id,
        targetChapter.chapterIndex,
        `${targetChapter.title}\n${targetChapter.content}`,
      )
      options.onInfo?.(`故事时间已推进 ${elapsedDays} 天，数据面板自动规则已生成待确认变更`)
    }

    if (includeTimeline) {
      if (analysisOptions.replaceExistingAiTimeline) {
        targetNovel.eventLog
          .filter(event => event.chapterIndex === targetChapter.chapterIndex && event.source === 'ai')
          .forEach(event => novelStore.deleteEvent(targetNovel.id, event.id))
      }
      for (const event of parsed.events || []) {
        novelStore.addEvent(targetNovel.id, {
          chapterIndex: targetChapter.chapterIndex,
          title: event.title || '未命名事件',
          description: event.description || '',
          characters: Array.isArray(event.characters) ? event.characters : [],
          type: event.type || '其他',
          scope: event.scope || 'chapter',
          status: event.type === '伏笔' ? (event.status || 'planted') : (event.status || 'resolved'),
          hintCount: event.type === '伏笔' ? (Number(event.hintCount) || 1) : 0,
          importance: event.type === '主线' || event.type === '转折' ? 4 : 3,
          source: 'ai',
        })
      }
      for (const update of parsed.globalPlans || []) {
        if (!update.id || !['developing', 'resolved'].includes(update.status)) continue
        novelStore.updateEventStatus(targetNovel.id, update.id, update.status, Number(update.hintCount) || undefined)
      }
    }

    if (includeCharacters) {
      for (const character of parsed.characters || []) {
        if (!character.name) continue
        novelStore.addCharacter(targetNovel.id, {
          name: character.name,
          identity: character.identity || '',
          personality: character.personality || '',
          powerLevel: character.powerLevel || '',
          faction: character.faction || '',
          description: character.description || '',
          firstAppearChapter: targetChapter.chapterIndex,
        })
      }
    }

    const dataChangeCount = includeDataChanges ? queueMemory(targetNovel, targetChapter.chapterIndex, sourceContent, parsed) : 0
    if (dataChangeCount > 0) {
      options.onDataChangesDetected?.({
        novelId: targetNovel.id,
        chapterIndex: targetChapter.chapterIndex,
        count: dataChangeCount,
        foreground: !analysisOptions.target,
      })
      options.onInfo?.(`检测到 ${dataChangeCount} 条数据变更，请确认`)
    }
  }

  async function scanDataPanelChanges(modelArg?: ModelConfig, target?: DataPanelScanTarget) {
    const targetNovelId = target?.novelId || options.currentNovelId.value
    const targetNovel = novelStore.getNovel(targetNovelId)
    const currentChapter = targetNovel?.chapters.find(item => item.id === options.currentChapterId.value)
    const targetChapterIndex = target?.chapterIndex ?? currentChapter?.chapterIndex
    const targetContent = target?.content ?? options.currentContent.value
    const targetPanels = target?.panels || options.currentPanels.value
    if (!targetNovel || targetChapterIndex === undefined || !targetContent.trim() || (!target && scanningDataChanges.value)) return
    const sourceChapter = targetNovel.chapters.find(item => item.chapterIndex === targetChapterIndex)
    const sourceChapterId = sourceChapter?.id
    const savedContent = sourceChapter?.content
    const model = modelArg || configStore.getModelForTask('review') || configStore.getModelForTask('writing')
    if (!model) {
      options.onWarning?.('请先在设置页配置 AI 模型')
      return
    }
    if (!target) scanningDataChanges.value = true
    let result = ''
    try {
      await callAI({
        model,
        skillTask: 'analysis',
        messages: [{
          role: 'system',
          content: '你是小说数据连续性分析助手。只根据正文中明确出现的证据判断数据变化，不要推测未写出的变化；必须区分明确变化、可能变化和无变化。',
        }, {
          role: 'user',
          content: `请提取本章数据记忆，包括新对象、装备状态和已有字段变化。
${DATA_MEMORY_RULES}

【已知角色】
${[targetNovel.settings.protagonist.name, ...targetNovel.characters.map(character => character.name)].filter(Boolean).join('、')}

【当前数据面板】
${formatDataPanelText(targetPanels)}

【本章完整正文】
${targetContent}

【输出格式】只输出 JSON 对象，不要解释：
${DATA_MEMORY_OUTPUT}`,
        }],
        stream: true,
        activityParentId: target?.activityParentId,
        onChunk: chunk => { result += chunk },
      })
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
      const added = queueMemory(latestNovel, targetChapterIndex, targetContent, payload)
      if (added > 0) {
        options.onDataChangesDetected?.({ novelId: targetNovelId, chapterIndex: targetChapterIndex, count: added, foreground: !target })
        options.onInfo?.(`检测到 ${added} 条数据记忆，请确认新对象、属性或装备状态`)
      } else {
        options.onInfo?.('未检测到明确的数据变更')
      }
    } catch {
      options.onWarning?.('数据变更扫描失败，已跳过')
    } finally {
      if (!target) scanningDataChanges.value = false
    }
  }

  return { scanningDataChanges, analyzeChapterStructure, scanDataPanelChanges }
}
