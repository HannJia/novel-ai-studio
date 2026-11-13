import { createTextDiff } from '@/utils/textDiff'
import type { ProjectHistoryChange, ProjectHistoryDiff, ProjectHistoryDiffSection, ProjectHistoryScope } from '@/types/projectHistory'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
/** Canonical object ordering; array order remains meaningful. */
export function stableHistoryValue(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableHistoryValue).join(',') + ']'
  return '{' + Object.keys(value).filter(key => record(value)[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + stableHistoryValue(record(value)[key])).join(',') + '}'
}
function fields(before: unknown, after: unknown): string[] {
  const a = record(before), b = record(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => stableHistoryValue(a[key]) !== stableHistoryValue(b[key]))
}
function label(value: unknown, id: string) { const row = record(value); return String(row.title || row.name || row.label || id) }
function list(key: string, title: string, before: unknown[], after: unknown[]): ProjectHistoryDiffSection {
  // One entity type per section: never concatenate heterogeneous rows with colliding IDs.
  const index = (rows: unknown[]) => new Map(rows.map((row, i) => [key + ':' + String(record(row).id ?? record(row).chapterId ?? i), row]))
  const left = index(before), right = index(after), changes: ProjectHistoryChange[] = []
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id), b = right.get(id), changedFields = fields(a, b)
    if (a !== undefined && b !== undefined && !changedFields.length) continue
    // References into the read-only preview avoid duplicating manuscript strings and histories.
    changes.push({ id, label: label(b ?? a, id), kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', changedFields, before: a, after: b })
  }
  return { key, label: title, summary: changes.length ? '新增 ' + changes.filter(row => row.kind === 'added').length + '，删除 ' + changes.filter(row => row.kind === 'removed').length + '，修改 ' + changes.filter(row => row.kind === 'changed').length : '无变化', changes }
}
const novelCollections = new Set(['chapters', 'archivedChapters', 'characters', 'eventLog', 'chapterPlans', 'storyArcs', 'volumes', 'chatHistory', 'inspirationHistory', 'dataPanels', 'dataPanelChanges', 'storyStateProposals'])
function metadata(scope: ProjectHistoryScope) {
  return scope.novel ? [Object.fromEntries(Object.entries(scope.novel).filter(([key]) => !novelCollections.has(key)))] : []
}
export function historyTextDiff(change: ProjectHistoryChange, field: string) {
  const a = record(change.before)[field], b = record(change.after)[field]
  const before = typeof a === 'string' ? a : '', after = typeof b === 'string' ? b : ''
  return { beforeLength: before.length, afterLength: after.length, sameLength: before.length === after.length, ...createTextDiff(before, after) }
}
export function buildProjectHistoryDiff(current: ProjectHistoryScope, historical: ProjectHistoryScope, novelId: string): ProjectHistoryDiff {
  const sections = [list('novel', '作品设定', metadata(current), metadata(historical))]
  const novelSections = { chapters: '章节与正文', archivedChapters: '归档章节', characters: '人物', eventLog: '事件', chapterPlans: '章节规划', storyArcs: '剧情弧线', volumes: '分卷', chatHistory: '作品对话', inspirationHistory: '该书灵感会话', dataPanels: '数据面板', dataPanelChanges: '数据决定', storyStateProposals: '故事状态提案' }
  for (const [key, title] of Object.entries(novelSections)) sections.push(list(key, title,
    record(current.novel)[key] as unknown[] || [], record(historical.novel)[key] as unknown[] || []))
  sections.push(list('chapterRevisions', '正文修订历史', current.chapterRevisions, historical.chapterRevisions))
  const workspaceSections = { candidates: '候选与作者决定', canonMutations: 'Canon 决定历史', chapterReviews: '章节审核', reviewFindings: '审核发现', storyMemories: '故事记忆', impactReports: '影响报告', aiRuns: 'AI 请求账本（恢复时累计合并）' }
  for (const [key, title] of Object.entries(workspaceSections)) sections.push(list(key, title,
    record(current.workspace)[key] as unknown[] || [], record(historical.workspace)[key] as unknown[] || []))
  sections.push(list('creationDraft', '创建与场景规划', current.workspace?.creationDraft ? [current.workspace.creationDraft] : [], historical.workspace?.creationDraft ? [historical.workspace.creationDraft] : []))
  const changed = sections.filter(section => section.changes.length)
  return { novelId, sections, summary: changed.length ? changed.map(section => section.label + '：' + section.summary).join('；') : '所选作品没有变化。',
    scopeStatement: '仅恢复所选作品、章节历史、工作区和该书灵感记录。其他作品、共享知识库、账户、密钥及无作品归属的全局灵感会话保持当前内容。缺失知识库的挂载引用将移除。恢复前的作者决定保存在保护点中，可随时只读查看。',
    sharedKnowledgeBaseIds: current.knowledgeBaseIds.filter(id => historical.knowledgeBaseIds.includes(id)), unchangedKnowledgeBaseIds: [...current.knowledgeBaseIds],
    budgetNotes: ['所有有效来源按 run.id / request.id 合并累计付费账本；当前结算优先，未知用量保守保留，不因恢复返还额度。', '旧审核须重审，旧候选停用，任务暂停待作者；不会自动继续付费请求。'] }
}
