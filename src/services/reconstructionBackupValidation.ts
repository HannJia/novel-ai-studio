import type { Novel } from '@/types/novel'
import type { EditorDraft } from '@/types/editorRecovery'
import { assertEditorDrafts } from './editorRecoveryValidation'
import type { StoryMemoryRecord } from '@/types/storyMemory'
import type { StoryImpactReport, StoryImpactKind } from '@/types/storyImpact'
import { assertStoryMemoryRecord } from './storyMemory'
import { assertStoryImpactReport } from './storyImpactValidation'
import { validateCanonEntityChanges } from './entityProvenanceValidation'
import { assertStoredCharacterMemory, assertCharacterMemoryReferences } from './characterMemoryValidation'
import { assertEventCausalityRevision, assertEventCausalityHistory } from './eventCausalityValidation'
import { isKnowledgeSummaryCoverage, coverageMatchesSources } from './knowledgeSummaryCoverage'
import { assertAiRunRequests } from './aiRunRequestValidation'
import { skeletonCompletionIssues, skeletonContentSignature } from './creationDraft'
import { assertScenePlanningRecovery } from './planningRecoveryValidation'
import { assertCreationEntryInput } from './creationEntryInput'
import { contractCards, parseContractExploration } from './storyContract'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { isStoredChapterReviewSignature, isStoredChapterReviewSourceVersion } from './chapterReviewIdentity'
import { normalizeStoredReviewCoverage, isReviewCoverageComplete } from './chapterReviewAcceptance'
import { isReviewCheckpoint } from './chapterReviewCheckpoint'
import type { AiRun, CandidateChange, CanonMutationRecord, ChapterReview, CreationDraft, EvidenceRef, ReviewFinding } from '@/types/reconstruction'

type Check = (value: unknown, path: string) => void
type Row = { id: string }
interface Workspace {
  editorDrafts?: EditorDraft[]
  storyMemories?: StoryMemoryRecord[]
  impactReports?: StoryImpactReport[]
  novelId: string
  creationDraft?: CreationDraft
  candidates: CandidateChange[]
  reviewFindings: ReviewFinding[]
  chapterReviews: ChapterReview[]
  aiRuns: AiRun[]
  canonMutations: CanonMutationRecord[]
}

const fail = (path: string): never => { throw new Error(`备份数据不完整或无效：${path}`) }
const text: Check = (value, path) => { if (typeof value !== 'string' || value.length > 5_000_000) fail(path) }
// Composite IDs and URI-encoded propositions are deliberately not limited to 200 characters.
const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor'])
const id: Check = (value, path) => {
  text(value, path)
  if (!(value as string).trim() || dangerousKeys.has(value as string)) fail(path)
}
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(path) }
const finite: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path) }
const integer: Check = (value, path) => { number(value, path); if (!Number.isSafeInteger(value)) fail(path) }
const positive: Check = (value, path) => { number(value, path); if ((value as number) <= 0) fail(path) }
const boolean: Check = (value, path) => { if (typeof value !== 'boolean') fail(path) }
const date: Check = (value, path) => {
  text(value, path)
  const s = value as string
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(s)
    || !Number.isFinite(Date.parse(s))) fail(path)
  const day = new Date(s.slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== s.slice(0, 10)) fail(path)
}
const optional = (check: Check): Check => (value, path) => { if (value !== undefined) check(value, path) }
const oneOf = (...values: string[]): Check => (value, path) => { if (!values.includes(value as string)) fail(path) }
const list = (check: Check, max = 100_000): Check => (value, path) => {
  if (!Array.isArray(value) || value.length > max) fail(path)
  for (let i = 0; i < (value as unknown[]).length; i++) check((value as unknown[])[i], `${path}[${i}]`)
}
const object = (fields: Record<string, Check>): Check => (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  for (const [key, check] of Object.entries(fields)) check((value as Record<string, unknown>)[key], `${path}.${key}`)
}
const strings = (names: string) => Object.fromEntries(names.split(' ').map(name => [name, text]))
const optionalStrings = (names: string) => Object.fromEntries(names.split(' ').map(name => [name, optional(text)]))
const stages = ['contract', 'skeleton', 'volume-outline', 'chapter-outline', 'scene-outline', 'ready']
const approval = oneOf('draft', 'awaiting_approval', 'approved', 'rejected')
const candidateType = oneOf('fact', 'state', 'relationship', 'timeline', 'plotline', 'foreshadowing', 'knowledge', 'event_causality')
const times = { createdAt: date, updatedAt: date }

// Scan even unknown fields, before reading any values. Never invoke getters or accept
// executable/non-JSON objects; unknown JSON data remains inert and is not applied here.
function checkTree(value: unknown, path: string, depth = 0, ancestors = new Set<object>()): void {
  if (depth > 40) fail(`${path}（嵌套过深）`)
  if (value === null || value === undefined || typeof value === 'boolean') return
  if (typeof value === 'string') { text(value, path); return }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail(path); return }
  if (typeof value !== 'object') fail(path)
  const obj = value as object
  const proto = Object.getPrototypeOf(obj)
  if (Array.isArray(obj) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail(`${path}（对象原型）`)
  if (ancestors.has(obj)) fail(`${path}（循环引用）`)
  if (Array.isArray(obj)) {
    if (obj.length > 100_000) fail(path)
    for (let i = 0; i < obj.length; i++) if (!Object.hasOwnProperty.call(obj, i)) fail(`${path}[${i}]`)
  }
  ancestors.add(obj)
  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key !== 'string' || dangerousKeys.has(key)) fail(`${path}.${String(key)}`)
    const descriptor = Object.getOwnPropertyDescriptor(obj, key)!
    if (!('value' in descriptor) || !descriptor.enumerable && !(Array.isArray(obj) && key === 'length')) fail(`${path}.${String(key)}`)
    checkTree(descriptor.value, `${path}.${String(key)}`, depth + 1, ancestors)
  }
  ancestors.delete(obj)
}

function range(value: unknown, path: string, start: string, end: string): void {
  const row = value as Record<string, number | undefined>
  if (row[start] !== undefined && row[end] !== undefined && row[start]! > row[end]!) fail(`${path}.${end}（范围倒置）`)
}
const evidence: Check = (value, path) => {
  object({ id, sourceType: oneOf('chapter', 'scene', 'character', 'event', 'plotline', 'rule', 'outline'), sourceId: id,
    sourceVersionId: optional(id), quote: optional(text), label: optional(text), startOffset: optional(integer), endOffset: optional(integer),
  })(value, path)
  range(value, path, 'startOffset', 'endOffset')
}
const candidate: Check = object({ id, novelId: optional(id), chapterId: optional(id), type: candidateType, targetId: optional(id),
  sourceVersionId: optional(id), proposedValue: (value, path) => {
    text(value, path)
    // Author edits can be plain text; JSON proposals must not hide prototype keys.
    let parsed: unknown
    try { parsed = JSON.parse(value as string) } catch { return }
    checkTree(parsed, path)
  }, originalProposedValue: optional(text), evidence: list(evidence), status: oneOf('proposed', 'accepted', 'edited', 'rejected', 'deferred', 'merged', 'stale'),
  source: optional(oneOf('ai', 'author', 'import')), confidence: optional(oneOf('confirmed', 'probable', 'uncertain')), authorNote: optional(text), ...times,
})
const finding: Check = (value, path) => {
  object({ id, type: oneOf('continuity', 'character', 'timeline', 'plot', 'foreshadowing', 'knowledge', 'world_rule', 'style', 'pacing', 'format'),
    severity: oneOf('blocker', 'warning', 'suggestion'), ...strings('title explanation'), chapterId: id, sourceVersionId: optional(id), sceneId: optional(id),
    startOffset: optional(integer), endOffset: optional(integer), ...optionalStrings('quotedText expectedState suggestedFix authorNote'),
    evidence: list(evidence), blocksFinalization: boolean, status: oneOf('open', 'accepted', 'rejected', 'intentional', 'deferred', 'stale'),
  })(value, path)
  range(value, path, 'startOffset', 'endOffset')
}
const review = object({ id, chapterId: id, sourceVersionId: id, startedAt: date, completedAt: optional(date), deterministicChecksPassed: boolean,
  semanticChecksPassed: optional(boolean), findings: list(finding), candidateChanges: list(candidate),
  status: oneOf('running', 'needs_revision', 'ready_to_finalize', 'approved', 'failed'),
})
const knowledge: Check = (value, path) => {
  object({ id, characterId: id, factId: id, fact: text, state: oneOf('knows', 'suspects', 'does_not_know', 'false_belief'),
    ...optionalStrings('belief learnedFrom'), knownSinceChapter: integer, sourceEventId: optional(id), evidence: list(evidence),
  })(value, path)
  const row = value as { state: string; belief?: string }
  if (row.state === 'false_belief') {
    text(row.belief, `${path}.belief`)
    if (!row.belief!.trim()) fail(`${path}.belief`)
  }
}
const relationship: Check = (value, path) => {
  object({ id, characterId: id, targetCharacterId: id, ...strings('relation description'), sinceChapter: integer, evidence: list(evidence) })(value, path)
  const row = value as { characterId: string; targetCharacterId: string }
  if (row.characterId === row.targetCharacterId) fail(`${path}.targetCharacterId`)
}
const characterState: Check = (value, path) => {
  const kind = (value as { kind?: unknown } | null)?.kind
  const check = kind === 'knowledge' ? knowledge : kind === 'relationship' ? relationship : undefined
  if (!check) fail(`${path}.kind`)
  object({ kind: oneOf('knowledge', 'relationship'), before: optional(check!), after: check! })(value, path)
  assertStoredCharacterMemory(value, path)
  const row = value as { before?: Record<string, string>; after: Record<string, string> }
  for (const key of kind === 'knowledge' ? ['characterId'] : ['characterId', 'targetCharacterId']) {
    if (row.before && row.before[key] !== row.after[key]) fail(`${path}.before.${key}（人物变更对象不一致）`)
  }
}
const mutation: Check = (value, path) => {
  object({ id, candidateId: id, novelId: id, chapterId: optional(id), type: candidateType, targetId: optional(id), summary: text,
    appliedAt: date, characterState: optional(characterState),
  })(value, path)
  const row = value as CanonMutationRecord
  if (row.type === 'event_causality') {
    try { assertEventCausalityRevision(row.eventCausality) } catch { fail(path + '.eventCausality') }
  } else if (row.eventCausality !== undefined) fail(path + '.eventCausality（类型错误）')
  if (row.characterState && row.type !== row.characterState.kind) fail(`${path}.characterState.kind`)
}
const memoryTask: Check = (value, path) => {
  object({ version: (value, path) => { if (value !== 1) fail(path) }, scope: (value, child) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(child)
    const row = value as { kind?: string }
    if (row.kind === 'scene') object({ kind: oneOf('scene'), chapterId: id, startOffset: integer, endOffset: integer })(value, child)
    else if (row.kind === 'volume') object({ kind: oneOf('volume'), volumeId: id, throughChapterId: id })(value, child)
    else if (row.kind === 'book') object({ kind: oneOf('book'), throughChapterId: id })(value, child)
    else fail(child)
  }, sourceVersionId: id, openBaseline: text, titleDraft: text, bodyDraft: text, level: oneOf('brief', 'standard', 'detailed'),
    modelSignature: text, promptSignature: text, stage: oneOf('draft', 'planned', 'running', 'interrupted', 'paused', 'awaiting_author', 'failed', 'cancelled', 'committed'),
    graph: list(object({ id, kind: oneOf('leaf', 'merge'), level: integer, dependencyIds: list(id), sourceRanges: list(object({ entryId: id, sourceVersionId: id, start: integer, end: integer, contentLength: integer })), sourceFingerprints: list(object({ entryId: id, start: integer, end: integer, digest: id })), signature: text, outputLimit: positive, status: oneOf('pending', 'running', 'completed', 'failed', 'unknown', 'reused'), output: optional(text), requestId: optional(id), requestSignature: optional(text), reusedFrom: optional(object({ requestId: id, sourceRanges: list(object({ entryId: id, sourceVersionId: id, start: integer, end: integer, contentLength: integer })) })), error: optional(text), inputTokens: integer, outputTokens: integer, usageSource: optional(oneOf('reserved', 'reported', 'estimated')) })), finalNodeId: text,
    candidate: optional(object({ title: text, summary: text, sourceVersionId: id, coverage: (candidateValue, candidatePath) => { if (!isKnowledgeSummaryCoverage(candidateValue)) fail(candidatePath) } })),
    executionId: optional(id),
    requests: list(object({ id, nodeId: id, runId: id, executionId: id, nodeSignature: text, requestSignature: text, modelSignature: text, promptSignature: text, sourceRanges: list(object({ entryId: id, sourceVersionId: id, start: integer, end: integer, contentLength: integer })), sourceFingerprints: list(object({ entryId: id, start: integer, end: integer, digest: id })), partialOutput: optional(text), status: oneOf('pending', 'completed', 'failed', 'unknown', 'interrupted', 'not_sent'), reservedTokens: positive, inputTokens: integer, outputTokens: integer, usageSource: oneOf('reservation', 'reported', 'estimated'), startedAt: date, completedAt: optional(date), error: optional(text) })), reservedTokens: integer, currentInputTokens: integer, currentOutputTokens: integer, historicalInputTokens: integer, historicalOutputTokens: integer, usageEstimated: boolean, updatedAt: date
  })(value, path)
}
const run: Check = (value, path) => {
  object({ id, mode: oneOf('assist', 'collaborative', 'autonomous'),
    taskType: oneOf('brainstorm', 'contract', 'skeleton', 'outline', 'draft', 'review', 'memory_update', 'export'), targetId: optional(id),
    chapterStart: optional(integer), chapterEnd: optional(integer), tokenBudget: optional(positive), checkpointEvery: optional(integer), usedTokens: optional(number),
    status: oneOf('queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'needs_author'), ...optionalStrings('checkpoint error'), ...times,
    memoryTask: optional(memoryTask),
    chapterDrafts: optional(list(object({ id, chapterId: id, chapterIndex: integer, ...strings('baseContent content contextVersion'),
      status: oneOf('pending', 'accepted', 'rejected'), stage: oneOf('generated', 'reviewed', 'analyzed'),
      ...optionalStrings('report analysisError generationFinishReason'), review: optional(review), acceptedAt: optional(date), ...times,
      reviewCoverage: optional((value, path) => { if (!normalizeStoredReviewCoverage(value)) fail(path) }),
      history: list(object({ content: text, updatedAt: date }), 20),
    }))),
  })(value, path)
  range(value, path, 'chapterStart', 'chapterEnd')
  if ((value as AiRun).checkpointEvery !== undefined && ((value as AiRun).checkpointEvery! < 1 || (value as AiRun).checkpointEvery! > 1000)) fail(path + '.checkpointEvery')
  assertAiRunRequests(value as AiRun)
  const memoryRun = value as AiRun
  const task = memoryRun.memoryTask
  if (task) {
    if (memoryRun.taskType !== 'memory_update') fail(path + '.memoryTask.type')
    if (task.candidate) {
      const final = task.graph.find(node => node.id === task.finalNodeId)
      const leaves = task.graph.filter(node => node.kind === 'leaf')
      const sources = [...new Map(leaves.flatMap(node => node.sourceRanges).map(range => [range.entryId, { entryId: range.entryId, sourceVersionId: range.sourceVersionId, contentLength: range.contentLength }])).values()]
      const evidence = task.candidate.coverage.leafEvidence
      const ownRequests = task.requests.filter(row => row.executionId === task.executionId && row.status !== 'not_sent')
      if (task.candidate.coverage.requestCount !== ownRequests.length || task.candidate.coverage.inputTokens !== task.currentInputTokens || task.candidate.coverage.outputTokens !== task.currentOutputTokens || task.candidate.coverage.usageEstimated !== task.usageEstimated) fail(path + '.memoryTask.candidate.accounting')
      if (!['awaiting_author', 'committed'].includes(task.stage) || task.candidate.sourceVersionId !== task.sourceVersionId || task.candidate.summary !== final?.output || task.graph.some(node => !['completed', 'reused'].includes(node.status)) || !coverageMatchesSources(task.candidate.coverage, sources) || !evidence || evidence.length !== leaves.length || evidence.some(item => !leaves.some(node => node.id === item.nodeId && node.signature === item.signature && node.requestId === item.requestId && item.runId === memoryRun.id && JSON.stringify(item.binding) === JSON.stringify(node.sourceRanges[0]) && JSON.stringify(item.originalBinding) === JSON.stringify(task.requests.find(row => row.id === node.requestId)?.sourceRanges[0])))) fail(path + '.memoryTask.candidate')
    } else if (['awaiting_author', 'committed'].includes(task.stage)) fail(path + '.memoryTask.candidate')
  }
  const row = value as AiRun, chapters = new Set<string>(), ids = new Set<string>()
  for (const draft of row.chapterDrafts || []) {
    if (row.mode !== 'autonomous' || chapters.has(draft.chapterId) || ids.has(draft.id) || !draft.content.trim()
      || draft.chapterIndex < (row.chapterStart ?? 0) || draft.chapterIndex > (row.chapterEnd ?? -1)) fail(path + '.chapterDrafts')
    chapters.add(draft.chapterId); ids.add(draft.id)
    if (draft.stage !== 'generated' && !draft.report?.trim() || draft.stage === 'analyzed' && !draft.review) fail(path + '.chapterDrafts.stage')
    if (draft.status === 'accepted' && !draft.acceptedAt || draft.status !== 'accepted' && draft.acceptedAt) fail(path + '.chapterDrafts.acceptedAt')
    if (draft.reviewCoverage) {
      const signature = draft.reviewCoverage.signature
      if (!isStoredChapterReviewSignature(signature, draft.content, draft.contextVersion)
        || draft.reviewCoverage.checkpoint && !isReviewCheckpoint(draft.reviewCoverage.checkpoint, draft.content)
        || draft.stage !== 'generated' && !isReviewCoverageComplete(draft.reviewCoverage, signature, draft.content)) fail(path + '.chapterDrafts.reviewCoverage')
    }
    if (draft.review && (draft.review.chapterId !== draft.chapterId
      || draft.review.findings.some(finding => finding.chapterId !== draft.chapterId)
      || draft.review.candidateChanges.some(candidate => candidate.chapterId !== draft.chapterId))) fail(path + '.chapterDrafts.review.chapterId')
    if (draft.review) {
      const bodyVersion = buildAnalysisSourceVersionId(draft.content)
      if (!isStoredChapterReviewSourceVersion(draft.review.sourceVersionId, draft.content, draft.contextVersion)
        || draft.reviewCoverage && draft.review.sourceVersionId !== bodyVersion + '|context:' + draft.reviewCoverage.signature
        || draft.review.findings.some(finding => finding.sourceVersionId !== bodyVersion)
        || draft.review.candidateChanges.some(candidate => candidate.sourceVersionId !== bodyVersion)) fail(path + '.chapterDrafts.review.sourceVersionId')
    }
  }
}

export function validateReconstructionAiRun(value: unknown): void { checkTree(value, 'aiRun'); run(value, 'aiRun') }
const contract: Check = (value, path) => {
  object({ id, ...strings('title genre'), ...optionalStrings('subGenre audience pointOfView tense styleDirection coreTheme readerPromise protagonistPremise protagonistGoal protagonistFear centralConflict endingDirection romanceDirection'),
    format: oneOf('serial', 'complete', 'undecided'), targetWordCountMin: optional(finite), targetWordCountMax: optional(finite), pacingDirection: optional(text),
    worldRules: list(text), forbiddenTopics: list(text), authorPreferences: list(text), approval, updatedAt: date,
    cardConfirmations: optional(list(object({ cardId: oneOf(...contractCards.map(card => card.id)), signature: text, confirmedAt: date }), 8)),
  })(value, path)
  const row = value as { approval: string; targetWordCountMin?: number; targetWordCountMax?: number }
  const confirmations = (value as CreationDraft['contract']).cardConfirmations || []
  uniqueLinks(confirmations.map(item => item.cardId), path + '.cardConfirmations')
  // Saving an unfinished contract deliberately preserves author input with issues.
  if (row.approval === 'approved') {
    optional(positive)(row.targetWordCountMin, `${path}.targetWordCountMin`)
    optional(positive)(row.targetWordCountMax, `${path}.targetWordCountMax`)
    range(value, path, 'targetWordCountMin', 'targetWordCountMax')
  }
}
const skeleton = object({ id, ...strings('title premise logline promise ending'), beats: list(object({ id, ...strings('title description'),
  kind: oneOf('opening', 'inciting', 'turning_point', 'midpoint', 'low_point', 'climax', 'resolution', 'custom'), targetRange: optional(text),
  relatedPlotlineIds: list(id), relatedCharacterIds: list(id),
})), approval, sourceRunId: optional(id), complete: optional(boolean), revisionId: optional(id), updatedAt: date })
const skeletonSource = object({ revisionId: id, field: oneOf('title', 'premise', 'logline', 'promise', 'ending', 'beat'), beatId: optional(id), targetBeatId: optional(id) })
const skeletonRevision = object({ id, skeletonId: id, kind: oneOf('initial', 'model', 'author', 'mixed', 'restored', 'confirmed', 'import'),
  snapshot: skeleton, parentRevisionId: optional(id), attemptId: optional(id), sources: list(skeletonSource), createdAt: date })
const skeletonAttempt = object({ id, parentAttemptId: optional(id), mode: oneOf('generate', 'retry', 'continue'),
  status: oneOf('queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'conflict'),
  baseline: text, modelId: id, messages: list(object({ role: oneOf('system', 'user', 'assistant'), content: text })),
  modelSettings: optional(object({ modelName: id, maxTokens: positive, temperature: number, topP: number })),
  output: text, finishReason: optional(text), error: optional(text), candidateIds: list(id), createdAt: date, updatedAt: date })
const exploration = object({ input: text, messages: list(object({ id, role: oneOf('user', 'assistant'), content: text,
  status: oneOf('completed', 'running', 'partial', 'failed', 'interrupted'), reply: optional(text),
  suggestions: optional(list(object({ cardId: oneOf(...contractCards.map(card => card.id)), baseline: text, values: object({}) }), 8)),
}), 1000) })
const creationEditor = object({ id, baseline: text, surface: optional(oneOf('skeleton', 'manual-outline', 'outline', 'contract')), savedAt: optional(date),
  contract: optional(contract), exploration: optional(exploration), skeleton: optional(skeleton), manualOutline: text, outlineText: text, updatedAt: date })
const volume = object({ id, sourceVersion: optional(text), ...strings('title objective conflict openingState endingState'), midpointChange: optional(text),
  chapterPlanIds: list(id), plotlineIds: list(id), approval })
const chapterPlan: Check = (value, path) => {
  object({ id, sourceVersion: optional(text), volumeId: optional(id), number: integer, endNumber: optional(integer),
    ...strings('title objective conflict openingState endingState'), requiredEvents: list(text), prohibitedReveals: list(text), characterChangeNotes: list(text),
    foreshadowingIds: list(id), scenePlanIds: list(id), status: oneOf('planned', 'active', 'awaiting_review', 'completed', 'archived'), approval,
  })(value, path)
  range(value, path, 'number', 'endNumber')
}
const scene = object({ id, chapterPlanId: id, order: integer, ...strings('title purpose outputState'), viewpointCharacterId: optional(id),
  locationId: optional(id), conflict: optional(text), requiredActions: list(text), informationChanges: list(text),
  status: oneOf('planned', 'drafted', 'completed'), approval })
const initialInput: Check = (value, path) => {
  try { assertCreationEntryInput(value, path) } catch { fail(path) }
}
const draft = object({ id, entry: oneOf('idea', 'import', 'blank'), initialInput: optional(initialInput), mode: oneOf('author', 'collaborative', 'autonomous'), stage: oneOf(...stages), contract,
  skeletons: list(skeleton), selectedSkeletonId: optional(id), volumes: list(volume), chapterPlans: list(chapterPlan), scenePlans: list(scene),
  editingSkeletonId: optional(id), skeletonHistory: optional(list(skeletonRevision)), skeletonAttempts: optional(list(skeletonAttempt)), editorDrafts: optional(list(creationEditor)),
  sceneRecovery: optional(assertScenePlanningRecovery),
  outlineCandidate: optional(object({ content: text, source: oneOf('author', 'model'), complete: optional(boolean), skeletonId: optional(id), contextBaseline: text, directionSignature: text, updatedAt: date })),
  acceptedOutline: optional(object({ contentSignature: id, directionSignature: text, confirmedAt: date })),
  approval: (value, path) => {
    object({})(value, path)
    for (const [key, item] of Object.entries(value as object)) {
      if (!stages.includes(key)) fail(`${path}.${key}`)
      optional(approval)(item, `${path}.${key}`)
    }
  }, updatedAt: date,
})
const workspace = object({ novelId: id, editorDrafts: optional(list(object({}), 10_000)), creationDraft: optional(draft), candidates: list(candidate), reviewFindings: list(finding),
  chapterReviews: list(review), aiRuns: list(run), canonMutations: list(mutation), storyMemories: optional(list(object({}))), impactReports: optional(list(object({}))) })

function unique(rows: Row[], path: string, seen = new Set<string>()): void {
  for (const row of rows) {
    if (seen.has(row.id)) fail(`${path}：重复 ID ${row.id}`)
    seen.add(row.id)
  }
}
function uniqueLinks(ids: string[], path: string): void {
  if (new Set(ids).size !== ids.length) fail(`${path}（重复关联）`)
}

const initialEntry: Record<string, CreationDraft['entry']> = { inspiration: 'idea', outline: 'import', blank: 'blank', custom: 'blank' }
function checkPlanning(value: CreationDraft, path: string): void {
  if (value.initialInput && initialEntry[value.initialInput.method] !== value.entry) fail(path + '.initialInput.method（与创建入口不一致）')
  const history = value.skeletonHistory || [], attempts = value.skeletonAttempts || []
  unique(history, path + '.skeletonHistory'); unique(attempts, path + '.skeletonAttempts'); unique(value.editorDrafts || [], path + '.editorDrafts')
  const revisions = new Map(history.map(item => [item.id, item]))
  const seenRevisions = new Set<string>(), seenAttempts = new Set<string>()
  for (const attempt of attempts) {
    if (!attempt.baseline || !attempt.messages.length || attempt.parentAttemptId && !seenAttempts.has(attempt.parentAttemptId)) fail(path + '.skeletonAttempts（来源请求无效）')
    if (attempt.mode !== 'generate' && !attempt.parentAttemptId) fail(path + '.skeletonAttempts.parentAttemptId')
    uniqueLinks(attempt.candidateIds, path + '.skeletonAttempts.candidateIds')
    if (attempt.candidateIds.some(id => !value.skeletons.some(item => item.id === id))) fail(path + '.skeletonAttempts.candidateIds')
    seenAttempts.add(attempt.id)
  }
  for (const editor of value.editorDrafts || []) {
    if (!editor.baseline) fail(path + '.editorDrafts.baseline')
    if (editor.skeleton) unique(editor.skeleton.beats, path + '.editorDrafts.skeleton.beats')
    if (editor.surface === 'contract' && (!editor.contract || editor.contract.id !== value.contract.id)) fail(path + '.editorDrafts.contract')
    if (editor.exploration) {
      unique(editor.exploration.messages, path + '.editorDrafts.exploration.messages')
      for (const message of editor.exploration.messages) if (message.suggestions?.length) {
        try { parseContractExploration(JSON.stringify({ reply: message.reply || '建议', suggestions: message.suggestions }), editor.contract || value.contract) }
        catch { fail(path + '.editorDrafts.exploration.suggestions') }
      }
    }
  }
  for (const revision of history) {
    if (revision.snapshot.id !== revision.skeletonId || revision.snapshot.revisionId !== revision.id) fail(path + '.skeletonHistory.snapshot（身份不一致）')
    if (revision.parentRevisionId && !seenRevisions.has(revision.parentRevisionId)) fail(path + '.skeletonHistory.parentRevisionId')
    if (revision.attemptId && !attempts.some(item => item.id === revision.attemptId && item.candidateIds.includes(revision.skeletonId))) fail(path + '.skeletonHistory.attemptId')
    unique(revision.snapshot.beats, path + '.skeletonHistory.snapshot.beats')
    const fields = new Set<string>(), beats = new Set<string>()
    for (const source of revision.sources) {
      const origin = revisions.get(source.revisionId)
      if (!origin || !seenRevisions.has(source.revisionId)) { fail(path + '.skeletonHistory.sources'); continue }
      if (source.field === 'beat') {
        const from = origin.snapshot.beats.find(item => item.id === source.beatId), to = revision.snapshot.beats.find(item => item.id === source.targetBeatId)
        if (!from || !to || beats.has(to.id) || JSON.stringify({ ...from, id: to.id }) !== JSON.stringify(to)) { fail(path + '.skeletonHistory.sources.beat'); continue }
        beats.add(to.id)
      } else {
        if (fields.has(source.field) || source.beatId || source.targetBeatId || origin.snapshot[source.field] !== revision.snapshot[source.field]) fail(path + '.skeletonHistory.sources.field')
        fields.add(source.field)
      }
    }
    if (revision.kind === 'mixed' && (fields.size !== 5 || beats.size !== revision.snapshot.beats.length)) fail(path + '.skeletonHistory（混合来源不完整）')
    if (revision.kind === 'confirmed' && skeletonCompletionIssues(revision.snapshot).length) fail(path + '.skeletonHistory（未完整候选被确认）')
    seenRevisions.add(revision.id)
  }
  for (const item of value.skeletons) {
    if (item.revisionId) {
      const version = revisions.get(item.revisionId)
      if (!version || version.skeletonId !== item.id || skeletonContentSignature(version.snapshot) !== skeletonContentSignature(item)) fail(path + '.skeletons.revisionId')
    }
    if (item.complete === false && item.approval === 'approved') fail(path + '.skeletons（未完整候选不能确认）')
  }
  if (value.editingSkeletonId && !value.skeletons.some(item => item.id === value.editingSkeletonId)) fail(path + '.editingSkeletonId')
  if (value.outlineCandidate?.skeletonId && !value.skeletons.some(item => item.id === value.outlineCandidate!.skeletonId)) fail(path + '.outlineCandidate.skeletonId')
  for (const key of ['skeletons', 'volumes', 'chapterPlans', 'scenePlans'] as const) unique(value[key], `${path}.${key}`)
  for (const item of value.skeletons) {
    unique(item.beats, `${path}.skeletons.${item.id}.beats`)
    for (const beat of item.beats) {
      uniqueLinks(beat.relatedCharacterIds, `${path}.beats.${beat.id}.relatedCharacterIds`)
      uniqueLinks(beat.relatedPlotlineIds, `${path}.beats.${beat.id}.relatedPlotlineIds`)
    }
  }
  if (value.selectedSkeletonId !== undefined && !value.skeletons.some(item => item.id === value.selectedSkeletonId)) fail(`${path}.selectedSkeletonId（引用不存在）`)
  const plans = new Map(value.chapterPlans.map(item => [item.id, item]))
  const volumes = new Map(value.volumes.map(item => [item.id, item]))
  const scenes = new Map(value.scenePlans.map(item => [item.id, item]))
  for (const item of value.volumes) {
    uniqueLinks(item.chapterPlanIds, `${path}.volumes.${item.id}.chapterPlanIds`)
    uniqueLinks(item.plotlineIds, `${path}.volumes.${item.id}.plotlineIds`)
    for (const target of item.chapterPlanIds) if (plans.get(target)?.volumeId !== item.id) fail(`${path}.volumes.${item.id}.chapterPlanIds（引用不存在或归属错误）`)
  }
  for (const item of value.chapterPlans) {
    // syncCreationDraftPlanning preserves archived plans when their source volume is deleted.
    if (item.volumeId !== undefined && item.status !== 'archived' && !volumes.get(item.volumeId)?.chapterPlanIds.includes(item.id)) fail(`${path}.chapterPlans.${item.id}.volumeId（引用不存在或缺少反向关联）`)
    uniqueLinks(item.scenePlanIds, `${path}.chapterPlans.${item.id}.scenePlanIds`)
    uniqueLinks(item.foreshadowingIds, `${path}.chapterPlans.${item.id}.foreshadowingIds`)
    for (const target of item.scenePlanIds) if (scenes.get(target)?.chapterPlanId !== item.id) fail(`${path}.chapterPlans.${item.id}.scenePlanIds（引用不存在或归属错误）`)
  }
  const approvedOrders = new Set<string>()
  for (const item of value.scenePlans) {
    const parent = plans.get(item.chapterPlanId)
    if (!parent || item.approval !== 'rejected' && !parent.scenePlanIds.includes(item.id)) fail(`${path}.scenePlans.${item.id}.chapterPlanId（引用不存在或缺少反向关联）`)
    // Approved and pending replacement batches may legitimately share order numbers.
    if (item.approval === 'approved') {
      const key = JSON.stringify([item.chapterPlanId, item.order])
      if (approvedOrders.has(key)) fail(`${path}.scenePlans.${item.id}.order（重复关联）`)
      approvedOrders.add(key)
    }
  }
}

/** Shared SQL, recovery-save and backup shape/link validation. */
export function validateReconstructionCreationDraft(value: unknown): void {
  checkTree(value, 'creationDraft')
  draft(value, 'creationDraft')
  checkPlanning(value as CreationDraft, 'creationDraft')
}

/** Validate a complete V3 workspace collection without normalizing or approving it. */
export function validateReconstructionWorkspaces(value: unknown, novels: Novel[]): void {
  const path = 'reconstructionWorkspaces'
  checkTree(value, path)
  list(workspace, 1000)(value, path)
  const workspaces = value as Workspace[]
  const novelIds = new Set(novels.map(novel => novel.id))
  if (novelIds.size !== novels.length || workspaces.length !== novelIds.size) fail(`${path}（每本小说必须恰好一个工作区）`)
  const seenOwners = new Set<string>()
  const tables = new Map<string, Set<string>>()
  for (const item of workspaces) {
    assertEditorDrafts(item.editorDrafts || [], item.novelId)
    if (!novelIds.has(item.novelId) || seenOwners.has(item.novelId)) fail(`${path}.novelId（额外或重复工作区）`)
    seenOwners.add(item.novelId)
    for (const key of ['creationDraft', 'candidates', 'reviewFindings', 'chapterReviews', 'canonMutations'] as const) {
      const rows = key === 'creationDraft' ? item.creationDraft ? [item.creationDraft] : [] : item[key]
      const seen = tables.get(key) || new Set<string>()
      unique(rows, `${path}.${key}`, seen)
      tables.set(key, seen)
    }
    unique(item.aiRuns, `${path}.${item.novelId}.aiRuns`) // SQL PRIMARY KEY (novel_id, id).
    unique(item.storyMemories || [], `${path}.${item.novelId}.storyMemories`)
    for (const memory of item.storyMemories || []) assertStoryMemoryRecord(memory, item.novelId)
    unique(item.impactReports || [], `${path}.${item.novelId}.impactReports`)
    for (const report of item.impactReports || []) assertStoryImpactReport(report, item.novelId)
    const candidateIds = tables.get('canonMutationCandidateIds') || new Set<string>()
    unique(item.canonMutations.map(row => ({ id: row.candidateId })), `${path}.canonMutations.candidateId`, candidateIds)
    tables.set('canonMutationCandidateIds', candidateIds) // SQL UNIQUE(candidate_id).
    for (const review of item.chapterReviews) {
      unique(review.findings, `${path}.chapterReviews.${review.id}.findings`)
      unique(review.candidateChanges, `${path}.chapterReviews.${review.id}.candidateChanges`)
    }
    if (item.creationDraft) checkPlanning(item.creationDraft, `${path}.${item.novelId}.creationDraft`)
  }

  // Missing references are legal historical evidence; only known foreign owners fail.
  // Use sets because JSON-local IDs (for example beat:0) may recur in other novels.
  const owners = new Map<string, Set<string>>()
  const ownerKey = (kind: string, target: string) => JSON.stringify([kind, target])
  const add = (target: string, owner: string, kind = 'entity') => {
    const key = ownerKey(kind, target)
    const existing = owners.get(key) || new Set<string>()
    existing.add(owner); owners.set(key, existing)
    if (kind !== 'entity') add(target, owner)
  }
  for (const novel of novels) {
    add(novel.id, novel.id, 'novel')
    const kinds = { chapters: 'chapter', characters: 'character', volumes: 'volume', eventLog: 'event', storyArcs: 'plotline', chapterPlans: 'outline', dataPanels: 'rule' }
    for (const key of ['chapters', 'characters', 'volumes', 'eventLog', 'storyArcs', 'chapterPlans', 'dataPanels'] as const) {
      for (const row of novel[key] || []) add(row.id, novel.id, kinds[key])
    }
    for (const chapter of novel.chapters) {
      for (const row of chapter.sceneNotes || []) add(row.id, novel.id, 'scene')
      for (const row of chapter.versions || []) add(row.id, novel.id, 'version')
    }
    for (const arc of novel.storyArcs || []) for (const node of arc.nodes) add(node.id, novel.id, 'node')
    for (const row of novel.volumes || []) add('volume:' + row.id, novel.id, 'volume')
    for (const row of novel.chapterPlans || []) add('chapter-plan:' + row.id, novel.id, 'outline')
  }
  for (const item of workspaces) {
    const d = item.creationDraft
    const rows: Row[] = [...item.candidates, ...item.reviewFindings, ...item.chapterReviews, ...item.canonMutations]
    if (d) rows.push(d, d.contract, ...d.skeletons, ...d.skeletons.flatMap(row => row.beats), ...d.volumes, ...d.chapterPlans, ...d.scenePlans)
    for (const review of item.chapterReviews) rows.push(...review.findings, ...review.candidateChanges)
    for (const row of rows) add(row.id, item.novelId)
    for (const row of item.candidates) add(row.id, item.novelId, 'candidate')
    for (const review of item.chapterReviews) for (const row of review.candidateChanges) add(row.id, item.novelId, 'candidate')
    for (const row of item.aiRuns) add(row.id, item.novelId, 'run')
    for (const memory of item.storyMemories || []) add(memory.id, item.novelId, 'memory')
    if (d) {
      for (const row of d.scenePlans) add(row.id, item.novelId, 'scene')
      for (const row of d.volumes) add(row.id, item.novelId, 'volume')
      for (const row of [d, d.contract, ...d.skeletons, ...d.chapterPlans]) add(row.id, item.novelId, 'outline')
    }
  }
  for (const item of workspaces) {
    const base = `${path}.${item.novelId}`
    const ref = (target: string | undefined, at: string, kind = 'entity') => {
      if (target === undefined) return
      const known = owners.get(ownerKey(kind, target))
      if (known && !known.has(item.novelId)) fail(`${at}（引用属于其他小说）`)
    }
    const refs = (values: string[], at: string, kind = 'entity') => values.forEach(target => ref(target, at, kind))
    const impactKinds: Record<StoryImpactKind, string> = {
      novel: 'novel', volume: 'volume', character: 'character', event: 'event', arc: 'plotline', node: 'node',
      plan: 'outline', scene: 'scene', chapter: 'chapter', memory: 'memory',
    }
    const checkImpactRef = (value: { kind: StoryImpactKind; id: string; parentId?: string }, at: string) => {
      ref(value.id, `${at}.id`, impactKinds[value.kind])
      if (value.parentId !== undefined) {
        const parentKind = value.kind === 'node' ? 'plotline' : value.kind === 'scene' ? 'outline' : 'entity'
        ref(value.parentId, `${at}.parentId`, parentKind)
      }
    }
    for (const report of item.impactReports || []) {
      const at = `${base}.impactReports.${report.id}`
      for (const change of report.changes) checkImpactRef(change.target, `${at}.changes.target`)
      for (const affected of report.affected) {
        checkImpactRef(affected.target, `${at}.affected.target`)
        for (const reason of affected.reasons) checkImpactRef(reason.from, `${at}.affected.reasons.from`)
      }
      for (const mention of report.mentions) checkImpactRef(mention.chapter, `${at}.mentions.chapter`)
      refs(report.reviewChapterIds, `${at}.reviewChapterIds`, 'chapter')
    }
    for (const memory of item.storyMemories || []) {
      for (const revision of [memory, ...memory.history]) {
        const scope = revision.scope
        ref(scope.kind === 'scene' ? scope.chapterId : scope.throughChapterId, `${base}.storyMemories.${memory.id}.chapterId`, 'chapter')
        if (scope.kind === 'volume') ref(scope.volumeId, `${base}.storyMemories.${memory.id}.volumeId`, 'volume')
        for (const source of revision.source.coverage?.sources || []) ref(source.entryId, `${base}.storyMemories.${memory.id}.coverage`, 'chapter')
      }
    }
    const evidenceRefs = (values: EvidenceRef[], at: string) => {
      for (const row of values) { ref(row.sourceId, `${at}.sourceId`, row.sourceType); ref(row.sourceVersionId, `${at}.sourceVersionId`, 'version') }
    }
    const checkCandidate = (row: CandidateChange, at: string) => {
      if (row.novelId !== undefined && row.novelId !== item.novelId) fail(`${at}.novelId（工作区归属错误）`)
      ref(row.chapterId, `${at}.chapterId`, 'chapter')
      ref(row.targetId, `${at}.targetId`, ['knowledge', 'relationship', 'state'].includes(row.type) ? 'character' : 'entity')
      if (row.type === 'plotline') { ref(row.targetId, `${at}.targetId`, 'plotline'); ref(row.targetId, `${at}.targetId`, 'event') }
      ref(row.sourceVersionId, `${at}.sourceVersionId`, 'version')
      evidenceRefs(row.evidence, `${at}.evidence`)
      let payload: unknown
      try { payload = JSON.parse(row.proposedValue) } catch { return }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const fields = payload as Record<string, unknown>
        for (const key of ['characterId', 'targetCharacterId', 'chapterId', 'targetId', 'sourceEventId', 'locationId', 'fromEventId', 'toEventId']) {
          const kind = key === 'characterId' || key === 'targetCharacterId' ? 'character' : key === 'chapterId' ? 'chapter' : ['sourceEventId', 'fromEventId', 'toEventId'].includes(key) ? 'event' : 'entity'
          if (typeof fields[key] === 'string') ref(fields[key], `${at}.proposedValue.${key}`, kind)
        }
        if (Array.isArray(fields.relatedArcIds)) for (const target of fields.relatedArcIds) if (typeof target === 'string') ref(target, `${at}.proposedValue.relatedArcIds`, 'plotline')
      }
    }
    const checkFinding = (row: ReviewFinding, at: string) => {
      ref(row.chapterId, `${at}.chapterId`, 'chapter'); ref(row.sceneId, `${at}.sceneId`, 'scene'); ref(row.sourceVersionId, `${at}.sourceVersionId`, 'version'); evidenceRefs(row.evidence, `${at}.evidence`)
    }
    item.candidates.forEach((row, i) => checkCandidate(row, `${base}.candidates[${i}]`))
    item.reviewFindings.forEach((row, i) => checkFinding(row, `${base}.reviewFindings[${i}]`))
    for (const row of item.chapterReviews) {
      const at = `${base}.chapterReviews.${row.id}`
      ref(row.chapterId, `${at}.chapterId`, 'chapter'); ref(row.sourceVersionId, `${at}.sourceVersionId`, 'version')
      row.findings.forEach(f => checkFinding(f, `${at}.findings.${f.id}`))
      row.candidateChanges.forEach(c => checkCandidate(c, `${at}.candidateChanges.${c.id}`))
      if (row.findings.some(f => f.chapterId !== row.chapterId) || row.candidateChanges.some(c => c.chapterId !== undefined && c.chapterId !== row.chapterId)) fail(`${at}.chapterId（内嵌审核归属错误）`)
    }
    assertCharacterMemoryReferences(novels, item.novelId, item.canonMutations, base + '.canonMutations')
    assertEventCausalityHistory(item.canonMutations, item.candidates, item.novelId)
    for (const row of item.canonMutations) {
      const at = `${base}.canonMutations.${row.id}`
      validateCanonEntityChanges(row, novels, at)
      if (row.eventCausality) {
        ref(row.eventCausality.fromEventId, at + '.fromEventId', 'event')
        ref(row.eventCausality.toEventId, at + '.toEventId', 'event')
        ref(row.eventCausality.effectiveChapterId, at + '.effectiveChapterId', 'chapter')
        for (const endpoint of row.eventCausality.endpoints) ref(endpoint.chapterId, at + '.endpoints.chapterId', 'chapter')
      }
      if (row.novelId !== item.novelId) fail(`${at}.novelId（工作区归属错误）`)
      ref(row.candidateId, `${at}.candidateId`, 'candidate'); ref(row.chapterId, `${at}.chapterId`, 'chapter')
      ref(row.targetId, `${at}.targetId`, ['knowledge', 'relationship', 'state'].includes(row.type) ? 'character' : 'entity')
      if (row.characterState) for (const state of [row.characterState.before, row.characterState.after]) {
        if (!state) continue
        ref(state.characterId, `${at}.characterState.characterId`, 'character')
        if ('targetCharacterId' in state) ref(state.targetCharacterId, `${at}.characterState.targetCharacterId`, 'character')
        if ('sourceEventId' in state) ref(state.sourceEventId, `${at}.characterState.sourceEventId`, 'event')
        evidenceRefs(state.evidence, `${at}.characterState.evidence`)
      }
    }
    for (const row of item.aiRuns) {
      ref(row.targetId, `${base}.aiRuns.${row.id}.targetId`)
      if (row.taskType === 'draft' || row.taskType === 'review') ref(row.targetId, `${base}.aiRuns.${row.id}.targetId`, 'chapter')
      for (const draft of row.chapterDrafts || []) {
        const at = `${base}.aiRuns.${row.id}.chapterDrafts.${draft.id}`
        ref(draft.chapterId, at + '.chapterId', 'chapter')
        draft.review?.findings.forEach(f => checkFinding(f, at + '.findings.' + f.id))
        draft.review?.candidateChanges.forEach(c => checkCandidate(c, at + '.candidates.' + c.id))
      }
    }
    const d = item.creationDraft
    if (d) {
      for (const row of d.skeletons) {
        ref(row.sourceRunId, `${base}.skeletons.sourceRunId`, 'run')
        for (const beat of row.beats) { refs(beat.relatedCharacterIds, `${base}.beats.relatedCharacterIds`, 'character'); refs(beat.relatedPlotlineIds, `${base}.beats.relatedPlotlineIds`, 'plotline') }
      }
      for (const row of d.volumes) refs(row.plotlineIds, `${base}.volumes.plotlineIds`, 'plotline')
      for (const row of d.chapterPlans) { ref(row.volumeId, `${base}.chapterPlans.volumeId`, 'volume'); refs(row.foreshadowingIds, `${base}.chapterPlans.foreshadowingIds`, 'event') }
      for (const row of d.scenePlans) { ref(row.viewpointCharacterId, `${base}.scenePlans.viewpointCharacterId`, 'character'); ref(row.locationId, `${base}.scenePlans.locationId`) }
    }
  }
}
