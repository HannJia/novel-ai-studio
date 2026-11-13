import type { EditorDraft, EditorDraftPayload } from '../types/editorRecovery'

export const EDITOR_DRAFT_LIMITS = { payload: 1_000_000, baseline: 4_000_000, records: 10_000, active: 500, collection: 32_000_000 } as const
const kinds = new Set(['character-form', 'character-scan', 'relationship-scan', 'event-form', 'event-causality', 'story-planner', 'chapter-form', 'scene-form', 'outline-form'])
const forbidden = /^(?:__proto__|prototype|constructor|api[_-]?key(?:encrypted)?|authorization|access[_-]?token|refresh[_-]?token|password|secret|model[_-]?(?:config|configuration)|credentials)$/i
function fail(message: string): never { throw new Error('编辑草稿无效：' + message) }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}
export function assertEditorDraftId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || forbidden.test(value)) fail('编号或范围')
}
/** Capacity is checked before serialization; never invoke toJSON or silently drop undefined. */
export function assertEditorPayload(value: unknown): asserts value is EditorDraftPayload {
  let nodes = 0, chars = 0
  function visit(item: unknown, depth: number): void {
    if (++nodes > 50_000 || depth > 20) fail('表单层级或条目过多')
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('非有限数字'); return }
    if (typeof item === 'string') { chars += item.length; if (chars > EDITOR_DRAFT_LIMITS.payload) fail('表单容量过大'); return }
    if (Array.isArray(item)) {
      if (item.length > 10_000 || Object.getPrototypeOf(item) !== Array.prototype || Object.getOwnPropertySymbols(item).length
        || Object.keys(item).length !== item.length || Object.getOwnPropertyNames(item).length !== item.length + 1) fail('表单数组结构或容量')
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, index)
        if (!descriptor || !('value' in descriptor)) fail('表单数组不得包含空位或访问器')
        visit(descriptor.value, depth + 1)
      }
      return
    }
    if (!record(item)) fail('只允许普通表单数据')
    if (Object.getOwnPropertySymbols(item).length) fail('不得保存符号字段')
    if (Object.getOwnPropertyNames(item).length !== Object.keys(item).length) fail('不得保存隐藏字段')
    for (const key of Object.keys(item)) {
      if (forbidden.test(key) || key === 'toJSON') fail('不得保存凭据、模型配置或序列化方法')
      chars += key.length
      if (chars > EDITOR_DRAFT_LIMITS.payload) fail('表单容量过大')
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!
      if (!('value' in descriptor)) fail('不得保存访问器')
      visit(descriptor.value, depth + 1)
    }
  }
  if (!record(value)) fail('表单必须为对象')
  visit(value, 0)
  if (JSON.stringify(value).length > EDITOR_DRAFT_LIMITS.payload) fail('表单容量过大')
}
function assertKindPayload(draft: EditorDraft): void {
  const p = draft.payload!
  if (draft.kind === 'character-form') {
    for (const key of ['name', 'aliasesText', 'identity', 'personality', 'powerLevel', 'faction', 'status', 'description', 'avatarId']) {
      if (typeof p[key] !== 'string') fail('人物表单字段 ' + key)
    }
    if (!Array.isArray(p.relationships)) fail('人物关系表单')
    for (const row of p.relationships) {
      if (!record(row) || ['targetId', 'targetName', 'relation', 'dimension', 'dimensionName'].some(key => typeof row[key] !== 'string')) fail('人物关系表单行')
    }
  }
  if (draft.kind === 'character-scan' || draft.kind === 'relationship-scan') {
    if (typeof p.rawOutput !== 'string' || !['partial', 'ready'].includes(String(p.state)) || !Array.isArray(p.candidates)) fail('扫描恢复字段')
    if (p.state === 'partial' && p.candidates.length) fail('未完成扫描不得附带可提交候选')
    if (p.state === 'ready' && !p.candidates.length) fail('待提交扫描缺少候选')
    for (const row of p.candidates) {
      if (!record(row) || row.novelId !== draft.novelId || typeof row.id !== 'string' || row.status !== 'proposed'
        || typeof row.chapterId !== 'string' || typeof row.sourceVersionId !== 'string' || typeof row.proposedValue !== 'string'
        || !Array.isArray(row.evidence) || row.type !== (draft.kind === 'character-scan' ? 'fact' : 'relationship')) fail('扫描候选结构或归属')
      if (draft.kind === 'relationship-scan' && (row.chapterId !== draft.targetId || row.sourceVersionId !== p.sourceVersion)) fail('关系候选来源')
    }
    if (draft.kind === 'relationship-scan' && (typeof p.chapterId !== 'string' || typeof p.sourceVersion !== 'string'
      || typeof p.characterBaseline !== 'string' || p.chapterId !== draft.targetId)) fail('关系扫描来源')
  }
  if (draft.kind === 'chapter-form') {
    if (p.chapterId !== draft.targetId || typeof p.chapterId !== 'string' || typeof p.title !== 'string'
      || typeof p.content !== 'string' || typeof p.sourceContent !== 'string') fail('章节草稿字段')
  }
  if (draft.kind === 'event-causality') {
    if (typeof p.mode !== 'string' || !['edge', 'candidate'].includes(p.mode) || typeof p.baseline !== 'string'
      || typeof p.candidateId !== 'string' || typeof p.expectedCandidate !== 'string' || typeof p.authorNote !== 'string' || typeof p.authorChecked !== 'boolean'
      || !record(p.draft)) fail('事件因果草稿类别')
    const causality = p.draft
    for (const key of ['edgeId', 'fromEventId', 'toEventId', 'relation', 'explanation', 'chapterId', 'quote']) if (typeof causality[key] !== 'string') fail('事件因果草稿字段 ' + key)
    if (typeof causality.startOffset !== 'number' || !Number.isSafeInteger(causality.startOffset) || causality.startOffset < 0
      || causality.action !== 'confirm' && causality.action !== 'revoke') fail('事件因果草稿证据位置或动作')
  }
  if (draft.kind === 'story-planner') {
    if (typeof p.surface !== 'string' || !['chapter-plan', 'story-arc', 'event'].includes(p.surface)
      || typeof p.suggestionId !== 'string' || typeof p.suggestionSource !== 'string' || typeof p.editingPlanId !== 'string'
      || typeof p.editingArcId !== 'string' || typeof p.editingEventId !== 'string' || typeof p.sourceBaseline !== 'string'
      || !record(p.formSource) || !Array.isArray(p.suggestedNodes)) fail('剧情规划草稿类别')
    const expected = p.surface === 'chapter-plan' ? 'chapterPlan' : p.surface === 'story-arc' ? 'storyArc' : 'event'
    const payload = p[expected]
    if (!record(payload)) fail('剧情规划表单内容')
    if (p.surface === 'chapter-plan') {
      for (const key of ['horizon', 'status', 'title', 'objective', 'summary', 'beatsText']) if (typeof payload[key] !== 'string') fail('章节计划表单字段 ' + key)
      for (const key of ['startChapter', 'endChapter']) if (typeof payload[key] !== 'number' || !Number.isFinite(payload[key])) fail('章节计划表单字段 ' + key)
    } else if (p.surface === 'story-arc') {
      for (const key of ['title', 'description', 'type', 'status', 'reactivateAt', 'goal', 'conflict', 'expectedResolution', 'initialState', 'desire', 'fear', 'falseBelief', 'finalState']) {
        if (typeof payload[key] !== 'string') fail('剧情弧线表单字段 ' + key)
      }
      if (typeof payload.importance !== 'number' || !Array.isArray(payload.characterIds) || payload.characterIds.some(item => typeof item !== 'string')
        || !Array.isArray(payload.dependencyArcIds) || payload.dependencyArcIds.some(item => typeof item !== 'string')
        || !Array.isArray(payload.turningPointEventIds) || payload.turningPointEventIds.some(item => typeof item !== 'string')) fail('剧情弧线表单关联')
      if (p.suggestedNodes.some(item => !record(item) || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.targetChapter !== 'number')) fail('剧情弧线候选节点')
    } else {
      for (const key of ['title', 'description', 'type', 'status', 'storyTime', 'location', 'characters', 'evidence', 'scope']) if (typeof payload[key] !== 'string') fail('事件表单字段 ' + key)
      for (const key of ['chapter', 'hintCount', 'importance']) if (typeof payload[key] !== 'number' || !Number.isFinite(payload[key])) fail('事件表单字段 ' + key)
      for (const key of ['targetChapter', 'lastProgressChapter', 'resolvedChapter']) if (payload[key] !== null && (typeof payload[key] !== 'number' || !Number.isFinite(payload[key]))) fail('事件表单字段 ' + key)
      if (!Array.isArray(payload.relatedArcIds) || payload.relatedArcIds.some(item => typeof item !== 'string')) fail('事件关联弧线')
    }
  }
}
export function assertEditorDraft(value: unknown, novelId: string): asserts value is EditorDraft {
  if (!record(value)) fail('记录')
  const fields = new Set(['id', 'novelId', 'kind', 'scope', 'targetId', 'openedBaseline', 'status', 'payload', 'revision', 'lastOperationId', 'createdAt', 'updatedAt'])
  if (Object.keys(value).some(key => !fields.has(key))) fail('未知记录字段')
  for (const key of ['id', 'novelId', 'scope', 'lastOperationId']) assertEditorDraftId(value[key])
  if (value.targetId !== undefined) assertEditorDraftId(value.targetId)
  if (value.novelId !== novelId || !kinds.has(String(value.kind))) fail('作品归属或表单类型')
  if (typeof value.openedBaseline !== 'string' || value.openedBaseline.length > EDITOR_DRAFT_LIMITS.baseline) fail('打开时基线')
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) fail('版本')
  for (const key of ['createdAt', 'updatedAt']) {
    const date = value[key]
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) fail('时间')
  }
  if (Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)) fail('更新时间')
  if (value.status === 'discarded') { if (value.payload !== null) fail('已丢弃记录仍有表单'); return }
  if (value.status !== 'active') fail('状态')
  assertEditorPayload(value.payload)
  assertKindPayload(value as unknown as EditorDraft)
}
export function assertEditorDrafts(value: unknown, novelId: string): asserts value is EditorDraft[] {
  if (!Array.isArray(value) || value.length > EDITOR_DRAFT_LIMITS.records) fail('恢复集合容量')
  const ids = new Set<string>(); let active = 0, size = 0
  for (const row of value) {
    assertEditorDraft(row, novelId)
    if (ids.has(row.id)) fail('重复草稿编号')
    ids.add(row.id)
    if (row.status === 'active' && ++active > EDITOR_DRAFT_LIMITS.active) fail('待恢复草稿过多，请先处理已有草稿')
    size += JSON.stringify(row).length
    if (size > EDITOR_DRAFT_LIMITS.collection) fail('恢复集合容量')
  }
}
