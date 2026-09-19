// Version-one backups are untrusted files. Validate the entire public structure
// before any write; do not coerce malformed values into plausible project data.
import { parseInspirationSession } from './inspirationSessions'
type Check = (value: unknown, path: string) => void
const fail = (path: string): never => { throw new Error(`备份数据不完整或无效：${path}`) }
const text: Check = (value, path) => { if (typeof value !== 'string' || value.length > 5_000_000) fail(path) }
const id: Check = (value, path) => { text(value, path); if (!(value as string).trim() || (value as string).length > 200) fail(path) }
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path) }
const integer: Check = (value, path) => { number(value, path); if (!Number.isInteger(value) || (value as number) < 0) fail(path) }
const boolean: Check = (value, path) => { if (typeof value !== 'boolean') fail(path) }
const date: Check = (value, path) => { text(value, path); if (!Number.isFinite(Date.parse(value as string))) fail(path) }
const optional = (check: Check): Check => (value, path) => { if (value !== undefined) check(value, path) }
const oneOf = (...values: unknown[]): Check => (value, path) => { if (!values.includes(value)) fail(path) }
const list = (check: Check, max = 100_000): Check => (value, path) => {
  if (!Array.isArray(value) || value.length > max) fail(path)
  ;(value as unknown[]).forEach((item, index) => check(item, `${path}[${index}]`))
}
const object = (fields: Record<string, Check>): Check => (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  for (const [key, check] of Object.entries(fields)) check((value as Record<string, unknown>)[key], `${path}.${key}`)
}
const strings = (names: string) => Object.fromEntries(names.split(' ').map(name => [name, text]))
const times = { createdAt: date, updatedAt: date }
const version = object({ id, label: text, savedAt: date, snapshot: (value, path) => {
  text(value, path)
  try {
    const parsed = JSON.parse(value as string)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(path)
    checkTree(parsed, path)
  } catch { fail(path) }
} })
const versions = optional(list(version, 20))
const source = oneOf('user', 'ai')
const field = object({
  id, ...strings('name value unit note'),
  type: optional(oneOf('text', 'number', 'percent', 'days', 'countdown', 'formula')),
  formula: optional(text), calculationError: optional(text), autoCalculate: optional(boolean),
  modifier: optional(object({ attribute: text, operation: oneOf('flat', 'percent') })),
  automationRules: optional(list(object({
    id, trigger: oneOf('per_chapter', 'on_mention', 'elapsed_days'), amount: number, interval: number, enabled: boolean,
    schedule: optional(list(number, 1000)), sourceFieldName: optional(text),
    lastEvaluatedChapterIndex: optional(number), lastSourceValue: optional(number), appliedCount: optional(integer), pendingChapterIndex: optional(number),
  }), 100)),
})
const equipmentState = oneOf('stored', 'equipped', 'consumed', 'lost')
const dataCategory = oneOf('角色', '作物', '资源', '建筑', '任务', '装备', '道具', '自定义')
const mutation: Check = (value, path) => {
  const kind = (value as { kind?: unknown } | null)?.kind
  if (kind === 'create') object({ kind: oneOf('create'), item: object({
    name: text, category: dataCategory, fields: list(field, 1000), relatedKeywords: list(text),
    ownerItemName: optional(text), equipmentState: optional(equipmentState),
  }) })(value, path)
  else if (kind === 'equipment') object({ kind: oneOf('equipment'), ownerItemName: text, state: equipmentState })(value, path)
  else if (kind === 'field') object({ kind: oneOf('field'), field })(value, path)
  else fail(path)
}
const settings = object({
  protagonist: object({ ...strings('name gender age background initialPower cheatDescription romanceTendency'), personality: list(text, 1000) }),
  supportingCharacters: list(object(strings('name relationship personality role')), 1000),
  worldBuilding: object(strings('worldType worldScale socialStructure techLevel specialRules')),
  powerSystem: object(strings('systemName levelHierarchy combatStyleDesc auxiliarySystems')),
  coreConflict: object(strings('mainConflict mainVillain factionConflicts coreSuspense')),
  romance: object(strings('romanceType developmentPace toneChanges emotionalConflict')),
  payoff: object({ ...strings('faceSlapFrequency levelUpPace'), patterns: list(text, 1000) }),
  structure: object(strings('foreshadowingDensity')), otherSettings: text,
})
const dialogue = object({ id, role: oneOf('user', 'assistant'), content: text, timestamp: date, failed: optional(boolean),
  search: optional(object({ protocol: oneOf('responses', 'anthropic', 'openrouter', 'chat-completions'),
    status: oneOf('searched', 'not-used', 'unverified'), sources: list(object({ url: text, title: text, excerpt: optional(text) }), 30) })),
})
const book = object({
  id, ...strings('title genre subGenre genreLabel subGenreLabel outline synopsis'), tags: list(text, 1000),
  targetWordCountMin: number, targetWordCountMax: number, currentWordCount: integer,
  writingStyle: object(strings('narrativePov toneStyle descriptionDensity dialogueStyle combatStyle pacingControl emotionExpression')),
  writingMode: optional(oneOf('manual', 'ai')), chatWebSearchEnabled: optional(boolean), storyClock: optional(object({
    currentDay: number, label: text, lastChapterIndex: optional(number), updatedAt: date,
  })), settings,
  status: oneOf('creating', 'writing', 'archived', 'trash', 'completed'), ...times, knowledgeBaseIds: list(id, 1000),
  volumes: list(object({ id, volumeIndex: integer, ...strings('title theme summary keyTurningPoints characterChanges'),
    estimatedChapters: number, estimatedWordCount: number, versions }), 10_000),
  chapters: list(object({ id, volumeIndex: integer, chapterIndex: integer, ...strings('title content summary'),
    bannedReview: optional(text), contentReview: optional(text), contentReviewSignature: optional(text), reviewRewriteBlockedSignature: optional(text),
    wordCount: integer, storyDaysElapsed: optional(number), storyDay: optional(number),
    status: oneOf('draft', 'writing', 'completed', 'reviewed', 'finalized', 'locked'), ...times, versions,
    sceneNotes: optional(list(object({ id, title: text, content: text, source, ...times }), 10_000)),
  }), 30_000),
  characters: list(object({ id, ...strings('name identity personality powerLevel faction description avatarColor'), aliases: list(text),
    status: oneOf('活跃', '退场', '死亡', '失踪'), firstAppearChapter: number, events: list(text),
    relationships: list(object({ targetId: id, targetName: text, relation: text })),
  }), 20_000),
  chatHistory: list(dialogue, 100_000),
  inspirationHistory: optional(list(dialogue, 100_000)),
  eventLog: list(object({ id, chapterIndex: number, ...strings('title description'), characters: list(text),
    type: oneOf('主线', '支线', '伏笔', '转折', '战斗', '其他'), scope: optional(oneOf('global', 'volume', 'chapter')),
    status: optional(oneOf('planted', 'developing', 'resolved', 'abandoned')), hintCount: optional(number),
    storyTime: optional(text), location: optional(text), targetChapter: optional(number), importance: optional(number), source: optional(source),
    timestamp: date, updatedAt: optional(date),
  })),
  storyArcs: optional(list(object({ id, ...strings('title description reactivateAt'),
    type: oneOf('main', 'sub', 'character', 'relationship', 'mystery', 'world'), importance: number,
    status: oneOf('active', 'paused', 'completed', 'abandoned'), characterIds: list(id), ...times,
    nodes: list(object({ id, title: text, description: text, targetChapter: number, actualChapter: optional(number),
      status: oneOf('pending', 'completed', 'abandoned'), ...times })),
  }))),
  chapterPlans: optional(list(object({ id, ...strings('title objective summary'), beats: list(text),
    horizon: oneOf('next', 'near', 'far'), targetChapterStart: integer, targetChapterEnd: integer,
    relatedArcIds: list(id), relatedEventIds: list(id), status: oneOf('planned', 'active', 'completed', 'archived'), source, versions, ...times,
  }))),
  storyStateProposals: optional(list(object({ id, targetType: oneOf('story_arc', 'arc_node', 'event', 'chapter_plan'),
    targetId: id, parentId: optional(id), ...strings('targetTitle oldValue newValue reason evidence'),
    field: oneOf('status', 'targetChapter'), chapterIndex: number, status: oneOf('pending', 'accepted', 'rejected'), source, ...times,
  }))),
  dataPanels: list(object({ id, category: oneOf('角色', '作物', '资源', '建筑', '任务', '装备', '道具', '自定义'), name: text,
    fields: list(field, 1000), relatedKeywords: list(text), ownerItemId: optional(id), equipmentState: optional(oneOf('stored', 'equipped', 'consumed', 'lost')), lastMentionChapterIndex: optional(number), versions, ...times })),
  dataPanelChanges: list(object({ id, itemId: id, fieldId: id, ...strings('itemName fieldName oldValue newValue reason'),
    confidence: optional(oneOf('clear', 'possible', 'none')), mutation: optional(mutation),
    chapterIndex: number, status: oneOf('pending', 'accepted', 'rejected'), createdAt: date })),
})
const knowledge = object({ id, name: text, description: text, createdAt: date,
  entries: list(object({ id, ...strings('category title content summary'), tags: list(text), ...times })) })

function checkTree(value: unknown, path: string, depth = 0) {
  if (depth > 40) fail(`${path}（嵌套过深）`)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${path}.${key}`)
    checkTree(child, `${path}.${key}`, depth + 1)
  }
}

export function validateProjectBackup(value: unknown): void {
  checkTree(value, '项目')
  object({ exportedAt: date, novels: list(book, 1000), knowledgeBases: list(knowledge, 1000),
    chapterRevisions: optional(list(object({ id, novelId: id, chapterId: id,
      ...strings('baseContent proposedContent diff reason'), source: oneOf('ai', 'user', 'review'),
      status: oneOf('pending', 'accepted', 'rejected', 'stale'), ...times, appliedAt: optional(date),
    }))),
  })(value, '项目')
  const project = value as import('./projectBackup').ProjectBackup
  if (project.inspirationSessions !== undefined) {
    if (!Array.isArray(project.inspirationSessions) || project.inspirationSessions.length > 1000) fail('灵感会话')
    project.inspirationSessions.forEach(parseInspirationSession)
    if (new Set(project.inspirationSessions.map(item => item.id)).size !== project.inspirationSessions.length) fail('灵感会话编号重复')
  }
  const globalIds = new Map<string, Set<string>>()
  function unique(table: string, rows: { id: string }[]) {
    const ids = globalIds.get(table) || new Set<string>()
    for (const row of rows) {
      if (ids.has(row.id)) fail(`${table}：重复 ID ${row.id}`)
      ids.add(row.id)
    }
    globalIds.set(table, ids)
  }
  unique('novels', project.novels)
  unique('knowledgeBases', project.knowledgeBases)
  unique('chapterRevisions', project.chapterRevisions || [])
  for (const kb of project.knowledgeBases) unique('entries', kb.entries)
  for (const novel of project.novels) {
    for (const key of ['chapters', 'volumes', 'characters', 'chatHistory', 'inspirationHistory', 'eventLog', 'storyArcs', 'dataPanels', 'dataPanelChanges'] as const) {
      unique(key, novel[key] || [])
    }
    if (novel.targetWordCountMin < 0 || novel.targetWordCountMax < novel.targetWordCountMin) fail(`${novel.title}：目标字数`)
    if (new Set(novel.chapters.map(chapter => chapter.chapterIndex)).size !== novel.chapters.length) fail(`${novel.title}：重复章节序号`)
    for (const panel of novel.dataPanels) {
      if (new Set(panel.fields.map(field => field.id)).size !== panel.fields.length) fail(`${panel.name}：重复字段 ID`)
      for (const version of panel.versions || []) object({ name: text, category: text, fields: list(field, 1000), relatedKeywords: list(text) })(JSON.parse(version.snapshot), `${panel.name}：历史快照`)
    }
    for (const chapter of novel.chapters) {
      for (const version of chapter.versions || []) object({ ...strings('title content summary'), status: oneOf('draft', 'writing', 'completed', 'reviewed', 'finalized', 'locked') })(JSON.parse(version.snapshot), `${chapter.title}：历史快照`)
    }
    for (const volume of novel.volumes) {
      for (const version of volume.versions || []) object({ ...strings('title theme summary keyTurningPoints characterChanges'), volumeIndex: integer, estimatedChapters: number, estimatedWordCount: number })(JSON.parse(version.snapshot), `${volume.title}：历史快照`)
    }
    for (const plan of novel.chapterPlans || []) {
      for (const version of plan.versions || []) object({ ...strings('title objective summary'), beats: list(text),
        horizon: oneOf('next', 'near', 'far'), targetChapterStart: integer, targetChapterEnd: integer,
        relatedArcIds: list(id), relatedEventIds: list(id), status: oneOf('planned', 'active', 'completed', 'archived'),
      })(JSON.parse(version.snapshot), `${plan.title}：历史快照`)
    }
    for (const kbId of novel.knowledgeBaseIds) {
      if (!globalIds.get('knowledgeBases')?.has(kbId)) fail(`${novel.title}：知识库引用不存在 ${kbId}`)
    }
    // Historical changes/proposals can intentionally refer to deleted objects.
    // They remain inert history; do not silently discard them during import.
  }
  for (const revision of project.chapterRevisions || []) {
    const novel = project.novels.find(book => book.id === revision.novelId)
    if (!novel?.chapters.some(chapter => chapter.id === revision.chapterId)) fail(`正文修订：章节引用不存在 ${revision.chapterId}`)
  }
}
