import { ref, type Ref } from 'vue'
import { callAI } from '@/services/ai'
import { buildChapterAnalysisPrompt } from '@/services/prompts'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { useNovelStore } from '@/stores/novel'
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
    const fields = item.fields.map(field => `  - ${field.name}：${field.value}${field.unit ? ` ${field.unit}` : ''}`).join('\n')
    return `- ID(${item.id}) ${item.name}\n${fields}`
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
    let result = ''
    await callAI({
      model,
      skillTask: 'analysis',
      messages: buildChapterAnalysisPrompt(
        buildDataScanContent(targetChapter.content, targetPanels),
        formatDataPanelText(targetPanels),
        formatActiveGlobalPlanText(targetNovel),
      ),
      stream: true,
      activityParentId: analysisOptions.activityParentId,
      onChunk: chunk => { result += chunk },
    })

    const parsed = parseAiJsonObject<ChapterAnalysisPayload>(result)
    if (!parsed) return

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

    let dataChangeCount = 0
    if (includeDataChanges) {
      for (const change of parsed.dataChanges || []) {
        if (change.confidence && change.confidence !== 'clear') continue
        const item = targetPanels.find(candidate => candidate.id === change.itemId || candidate.name === change.itemName)
        const field = item?.fields.find(candidate => candidate.name === change.fieldName)
        if (!item || !field) continue
        const oldValue = change.oldValue === undefined || change.oldValue === null || String(change.oldValue).trim() === ''
          ? String(field.value)
          : String(change.oldValue)
        const newValue = String(change.newValue ?? '').trim()
        if (!newValue || newValue === oldValue) continue
        const entry = novelStore.addDataPanelChange(targetNovel.id, {
          itemId: item.id,
          fieldId: field.id,
          itemName: item.name,
          fieldName: field.name,
          oldValue,
          newValue,
          reason: String(change.reason || ''),
          confidence: 'clear',
          chapterIndex: targetChapter.chapterIndex,
        })
        if (entry) dataChangeCount++
      }
    }
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
    if (targetChapterIndex === undefined || targetPanels.length === 0 || !targetContent.trim()) return
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
          content: `请分析本章正文是否出现数据面板变化。
- 明确变化 clear：正文直接写出新数值、明确经过天数、明确收入/支出/等级变化。
- 可能变化 possible：正文暗示可能变化，但没有足够数值或证据，输出但不要当作可直接应用。
- 无变化 none：没有变化，不要输出。

【当前数据面板】
${formatDataPanelText(targetPanels)}

【本章正文相关片段】
${buildDataScanContent(targetContent, targetPanels)}

【输出格式】只输出 JSON 数组，不要解释：
[{"itemId":"数据对象ID","itemName":"数据对象名","fieldName":"字段名","oldValue":"旧值","newValue":"新值","confidence":"clear|possible","reason":"正文原文依据，尽量引用关键短句"}]`,
        }],
        stream: true,
        activityParentId: target?.activityParentId,
        onChunk: chunk => { result += chunk },
      })
      const parsed = parseAiJsonArray<Record<string, any>>(result)
      let added = 0
      let possible = 0
      for (const change of parsed) {
        const confidence = change.confidence === 'possible' ? 'possible' : 'clear'
        if (confidence !== 'clear') {
          possible++
          continue
        }
        const currentPanels = novelStore.getNovel(targetNovelId)?.dataPanels || targetPanels
        const item = currentPanels.find(candidate => candidate.id === change.itemId || candidate.name === change.itemName)
        const field = item?.fields.find(candidate => candidate.name === change.fieldName)
        if (!item || !field) continue
        const oldValue = change.oldValue === undefined || change.oldValue === null || String(change.oldValue).trim() === ''
          ? String(field.value)
          : String(change.oldValue)
        const newValue = String(change.newValue ?? '').trim()
        if (!newValue || newValue === oldValue) continue
        const entry = novelStore.addDataPanelChange(targetNovelId, {
          itemId: item.id,
          fieldId: field.id,
          itemName: item.name,
          fieldName: field.name,
          oldValue,
          newValue,
          reason: String(change.reason || ''),
          confidence,
          chapterIndex: targetChapterIndex,
        })
        if (entry) added++
      }
      if (added > 0) {
        options.onDataChangesDetected?.({ novelId: targetNovelId, chapterIndex: targetChapterIndex, count: added, foreground: !target })
        options.onInfo?.(`检测到 ${added} 条明确数据变更，请确认${possible ? `；另有 ${possible} 条可能变化未加入待确认` : ''}`)
      } else if (possible > 0) {
        options.onInfo?.(`检测到 ${possible} 条可能变化，但证据不足，未加入待确认`)
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
