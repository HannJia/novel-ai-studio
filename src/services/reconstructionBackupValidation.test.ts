import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Novel } from '@/types/novel'
import type { ChapterReview } from '@/types/reconstruction'
import { characterStateFixture, knowledgeCandidate, relationshipCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import { emptyProjectWorkspace, plannedProjectWorkspace } from '@/test/projectBackupFixture'
import { validateReconstructionWorkspaces as validate } from './reconstructionBackupValidation'
import { applyCandidateChangeToCanon } from './reconstructionCanon'
import { acceptCandidateChange } from './reconstructionReview'
import { parseReviewFindings } from './reconstructionFindings'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { buildChapterReviewSourceVersion, buildChapterReviewSignature } from './chapterReviewIdentity'
import { createAiRun } from './reconstructionAiRun'
import { approveScenePlans, confirmChapterPlan, normalizeScenePlans, proposeScenePlans } from './reconstructionPlanning'
import { confirmCreationSkeleton, confirmStoryContract, reviseStoryContract, syncCreationDraftPlanning } from './reconstructionCreation'

beforeEach(() => setActivePinia(createPinia()))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function fixture() {
  const { novel } = characterStateFixture()
  const workspace = plannedProjectWorkspace(novel)
  workspace.creationDraft!.skeletons[0] = { ...workspace.creationDraft!.skeletons[0], title: '追寻失踪者',
    premise: '主角追查父亲失踪的旧案。', logline: '主角循线追查父亲失踪的真相。',
    promise: '逐步揭开旧案背后的秘密。', ending: '主角查明真相并作出选择。',
    beats: [{ id: 'beat:0', title: '获得线索', description: '主角从旧案中找到第一条线索。', kind: 'opening',
      relatedCharacterIds: [novel.characters[0].id], relatedPlotlineIds: [] }]
  }
  const records = workspace.canonMutations
  for (const index of [0, 1]) for (const make of [knowledgeCandidate, relationshipCandidate]) {
    const candidate = acceptCandidateChange(make(novel, index), now)
    records.push(applyCandidateChangeToCanon(novel, candidate, now, records).record)
    workspace.candidates.push(candidate)
  }
  const chapter = novel.chapters[0]
  workspace.reviewFindings = parseReviewFindings({ chapterId: chapter.id, sourceVersionId: buildAnalysisSourceVersionId(chapter.content),
    content: chapter.content, report: '## 必改\n1. [知情] 请复核「林澈以为城主已经死了。」' })
  const review: ChapterReview = { id: novel.id + ':review', chapterId: chapter.id, sourceVersionId: 'historical-review-version', startedAt: now, completedAt: now,
    deterministicChecksPassed: true, semanticChecksPassed: false, status: 'needs_revision',
    findings: clone(workspace.reviewFindings), candidateChanges: clone(workspace.candidates.filter(row => row.chapterId === chapter.id)) }
  workspace.chapterReviews.push(review)
  return { novel, workspace }
}

function otherNovel(): Novel {
  // This validator consumes identity indexes; the main backup validator checks Novel fields.
  return { id: 'other', chapters: [{ id: 'foreign-chapter', sceneNotes: [{ id: 'foreign-scene' }], versions: [{ id: 'foreign-version' }] }],
    characters: [{ id: 'foreign-character' }], eventLog: [{ id: 'foreign-event' }], storyArcs: [{ id: 'foreign-plotline', nodes: [] }],
    volumes: [{ id: 'foreign-volume' }], chapterPlans: [{ id: 'foreign-plan' }], dataPanels: [{ id: 'foreign-rule' }],
  } as unknown as Novel
}
function changeAt(value: unknown, path: string, replacement: unknown) {
  const keys = path.split('.')
  let row = value as Record<string, unknown>
  for (const key of keys.slice(0, -1)) row = row[key] as Record<string, unknown>
  row[keys[keys.length - 1]] = replacement
}

describe('V2 reconstruction backup validation', () => {
  it('accepts foreshadowing review findings in backups', () => {
    const { novel, workspace } = fixture()
    workspace.reviewFindings[0].type = 'foreshadowing'
    workspace.chapterReviews[0].findings[0].type = 'foreshadowing'
    expect(() => validate([workspace], [novel])).not.toThrow()
  })

  it.each([
    ['source', 'unknown'], ['content', null], ['complete', 'yes'], ['contextBaseline', undefined],
    ['directionSignature', 3], ['updatedAt', 'yesterday'],
  ])('rejects a corrupt creation outline candidate field %s', (field, value) => {
    const { novel, workspace } = fixture()
    workspace.creationDraft!.outlineCandidate = { content: '未确认大纲', source: 'model', complete: false,
      contextBaseline: 'historical-context', directionSignature: 'historical-direction', updatedAt: now }
    expect(() => validate([workspace], [novel])).not.toThrow()
    changeAt(workspace.creationDraft!.outlineCandidate, field as string, value)
    expect(() => validate([workspace], [novel])).toThrow('outlineCandidate')
  })

  it.each([
    ['parserVersion', 'unknown'], ['reconciledAt', 'yesterday'], ['report', null], ['reviewStatus', 'done'],
    ['workspaceFindings.0.status', 'done'], ['reviewFindings.0.authorNote', 1],
    ['workspaceFindings.0.chapterId', 'foreign-chapter'], ['reviewFindings.0.chapterId', 'missing-other-chapter'],
    ['workspaceFindings.0.evidence.0.sourceId', 'foreign-chapter'],
  ])('validates reconciliation archive %s and preserves valid preimages', (field, value) => {
    const { novel, workspace } = fixture()
    const review = workspace.chapterReviews[0]
    const archive = { id: 'archive', parserVersion: 'grouped-details-v1' as const, reconciledAt: now,
      report: '保留原报告', reviewStatus: review.status,
      workspaceFindings: clone(workspace.reviewFindings), reviewFindings: clone(review.findings) }
    review.findingReconciliations = [archive]
    const original = clone(workspace)
    expect(() => validate([workspace, emptyProjectWorkspace('other')], [novel, otherNovel()])).not.toThrow()
    expect(workspace).toEqual(original)
    changeAt(archive, field as string, value)
    expect(() => validate([workspace, emptyProjectWorkspace('other')], [novel, otherNovel()])).toThrow()
  })

  it.each([
    ['content', '被替换的正文'], ['contextVersion', 'changed-context'],
    ['review.sourceVersionId', 'wrong-review'], ['review.findings.0.sourceVersionId', 'wrong-body'],
    ['review.candidateChanges.0.sourceVersionId', 'wrong-body'], ['review.chapterId', 'foreign-chapter'],
    ['review.candidateChanges.0.novelId', 'other'], ['chapterIndex', 50], ['review', undefined], ['status', 'accepted'],
  ])('rejects corrupt draft %s during full project validation', (path, replacement) => {
    const { novel, workspace } = fixture(), chapter = novel.chapters[0]
    const content = chapter.content, contextVersion = 'draft-context'
    const draft = { id: 'isolated-draft', chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content, baseContent: '', contextVersion,
      status: 'pending' as const, stage: 'analyzed' as const, report: '审核报告', createdAt: now, updatedAt: now, history: [],
      review: { ...clone(workspace.chapterReviews[0]), id: 'isolated-review', sourceVersionId: buildChapterReviewSourceVersion(content, contextVersion) } }
    workspace.aiRuns = [{ ...createAiRun({ id: 'isolated-run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 2, tokenBudget: 10000, now }),
      status: 'completed', chapterDrafts: [draft] }]
    expect(() => validate([workspace], [novel])).not.toThrow()
    changeAt(draft, path as string, replacement)
    expect(() => validate([workspace], [novel])).toThrow()
  })

  it.each([4, 5, 6, 7])('preserves a v%s candidate review as history without accepting it as current', protocol => {
    const { novel, workspace } = fixture(), chapter = novel.chapters[0]
    const content = chapter.content, contextVersion = 'historical-context'
    const signature = buildChapterReviewSignature(content, contextVersion).replace('review-v8:', 'review-v' + protocol + ':')
    const draft = { id: 'historical-draft', chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content, baseContent: '', contextVersion,
      status: 'pending' as const, stage: 'analyzed' as const, report: '历史审核报告', createdAt: now, updatedAt: now, history: [],
      reviewCoverage: { signature, totalChunks: 1, completedChunks: 1, totalCharacters: content.length, coveredCharacters: content.length,
        status: 'complete' as const, globalStatus: 'not-needed' as const },
      review: { ...clone(workspace.chapterReviews[0]), id: 'historical-review',
        sourceVersionId: buildAnalysisSourceVersionId(content) + '|context:' + signature } }
    workspace.aiRuns = [{ ...createAiRun({ id: 'historical-run', mode: 'autonomous', taskType: 'draft', targetId: novel.id, chapterStart: 0, chapterEnd: 2, tokenBudget: 10000, now }),
      status: 'completed', chapterDrafts: [draft] }]
    const before = clone(workspace)
    expect(() => validate([workspace], [novel])).not.toThrow()
    expect(workspace).toEqual(before)
    expect(signature).not.toBe(buildChapterReviewSignature(content, contextVersion))
    draft.reviewCoverage.signature = buildChapterReviewSignature(content, contextVersion)
    expect(() => validate([workspace], [novel])).toThrow()
    draft.reviewCoverage.signature = signature
    draft.content += '正文被改写'
    expect(() => validate([workspace], [novel])).toThrow()
  })

  it('accepts production canonical before/after states and shared review snapshots without mutation', () => {
    const { novel, workspace } = fixture()
    // Similar wording does not establish identity. This new proposition remains
    // independent until an author explicitly links it to the earlier one.
    expect(workspace.canonMutations[2].characterState?.before).toBeUndefined()
    expect(workspace.canonMutations[3].characterState?.before).toBeDefined()
    const before = clone(workspace)
    const freeze = (value: unknown) => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
    }
    freeze(workspace)
    expect(() => validate([workspace], [novel])).not.toThrow()
    expect(workspace).toEqual(before)
  })

  it('requires exactly one workspace per novel, including empty workspaces', () => {
    const { novel } = fixture()
    expect(() => validate([], [])).not.toThrow()
    expect(() => validate([emptyProjectWorkspace(novel.id)], [novel])).not.toThrow()
    expect(() => validate(undefined, [])).toThrow('reconstructionWorkspaces')
    expect(() => validate([], [novel])).toThrow('恰好一个')
    expect(() => validate([emptyProjectWorkspace(novel.id)], [])).toThrow()
    expect(() => validate([emptyProjectWorkspace('missing')], [novel])).toThrow('工作区')
    expect(() => validate([emptyProjectWorkspace(novel.id), emptyProjectWorkspace(novel.id)], [novel, otherNovel()])).toThrow('重复工作区')
  })

  it.each(['candidates', 'reviewFindings', 'chapterReviews', 'aiRuns', 'canonMutations'])('requires %s without inserting a default', key => {
    const { novel, workspace } = fixture()
    const value = workspace as unknown as Record<string, unknown>
    delete value[key]
    expect(() => validate([workspace], [novel])).toThrow(key)
    expect(Object.hasOwnProperty.call(value, key)).toBe(false)
    value[key] = null
    expect(() => validate([workspace], [novel])).toThrow(key)
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects dangerous workspace ID %s even when a novel has that ID', novelId => {
    const novel = { id: novelId, chapters: [], characters: [] } as unknown as Novel
    expect(() => validate([emptyProjectWorkspace(novelId)], [novel])).toThrow('novelId')
  })

  it('accepts stable proposition IDs and ordinary belief text resembling prototype keys', () => {
    const { novel } = characterStateFixture()
    const workspace = emptyProjectWorkspace(novel.id)
    const candidate = acceptCandidateChange(knowledgeCandidate(novel, 0, { fact: '城主仍然在世而且有重要秘密'.repeat(40), belief: 'constructor' }), now)
    const record = applyCandidateChangeToCanon(novel, candidate, now).record
    if (record.characterState?.kind !== 'knowledge') throw new Error('fixture')
    expect(record.characterState.after.factId).toBe('proposition:' + candidate.id)
    expect(record.characterState.after.factId.length).toBeLessThan(200)
    workspace.candidates = [candidate]
    workspace.canonMutations = [record]
    expect(() => validate([workspace], [novel])).not.toThrow()
    record.characterState.after.belief = '  '
    expect(() => validate([workspace], [novel])).toThrow('belief')
  })

  it('preserves history after chapters, characters, scenes, candidates, events and volumes have been deleted', () => {
    const { novel, workspace } = fixture()
    workspace.candidates = []
    workspace.reviewFindings[0].sceneId = 'deleted-scene'
    workspace.reviewFindings[0].evidence.push({ id: 'deleted-evidence', sourceType: 'event', sourceId: 'deleted-event' })
    workspace.creationDraft!.chapterPlans[0].status = 'archived'
    workspace.creationDraft!.volumes = []
    novel.chapters = []
    novel.characters = []
    expect(() => validate([workspace], [novel])).not.toThrow()
  })

  it('does not demand current quotes, source versions, approvals or resolved findings for historical records', () => {
    const { novel, workspace } = fixture()
    novel.chapters.forEach(chapter => { chapter.content = '正文已经完全改写。' })
    workspace.candidates[0].status = 'stale'
    workspace.creationDraft!.approval = { contract: 'draft', skeleton: 'rejected', 'scene-outline': 'awaiting_approval' }
    expect(() => validate([workspace], [novel])).not.toThrow()
    expect(workspace.creationDraft!.approval.contract).toBe('draft')
  })

  it.each([
    ['candidates.0.type', 'execute'], ['candidates.0.status', 'approved'], ['candidates.0.source', 'system'], ['candidates.0.confidence', 1],
    ['candidates.0.proposedValue', {}], ['candidates.0.evidence', undefined], ['candidates.0.evidence.0.sourceType', 'candidate'],
    ['candidates.0.evidence.0.sourceId', ''], ['candidates.0.evidence.0.startOffset', -1], ['candidates.0.evidence.0.endOffset', 0.5],
    ['reviewFindings.0.type', 'execute'], ['reviewFindings.0.severity', 'critical'], ['reviewFindings.0.status', 'approved'],
    ['reviewFindings.0.blocksFinalization', 'false'], ['reviewFindings.0.evidence', {}], ['reviewFindings.0.startOffset', -1],
    ['chapterReviews.0.status', 'completed'], ['chapterReviews.0.findings', null], ['chapterReviews.0.candidateChanges', undefined],
    ['chapterReviews.0.deterministicChecksPassed', 1], ['chapterReviews.0.semanticChecksPassed', 'true'],
    ['chapterReviews.0.findings.0.blocksFinalization', 0], ['chapterReviews.0.candidateChanges.0.status', 'approved'],
    ['canonMutations.0.type', 'execute'], ['canonMutations.0.characterState.kind', 'state'], ['canonMutations.0.characterState.after', null],
    ['canonMutations.0.characterState.after.state', 'unknown'], ['canonMutations.0.characterState.after.knownSinceChapter', -1],
    ['canonMutations.3.characterState.before.evidence', false], ['canonMutations.3.characterState.before.sinceChapter', 0.5],
    ['canonMutations.1.characterState.after.description', 7], ['aiRuns.0.mode', 'automatic'], ['aiRuns.0.taskType', 'execute'],
    ['aiRuns.0.status', 'approved'], ['aiRuns.0.chapterStart', -1], ['aiRuns.0.chapterEnd', 0.2], ['aiRuns.0.tokenBudget', 0],
    ['aiRuns.0.usedTokens', -1], ['aiRuns.0.usedTokens', Infinity], ['aiRuns.0.checkpoint', {}],
    ['creationDraft.entry', 'legacy'], ['creationDraft.mode', 'assist'], ['creationDraft.stage', 'complete'],
    ['creationDraft.contract.format', 'book'], ['creationDraft.contract.title', null], ['creationDraft.contract.worldRules', 'rule'],
    ['creationDraft.contract.targetWordCountMin', Infinity], ['creationDraft.contract.authorPreferences', undefined],
    ['creationDraft.skeletons.0.beats.0.kind', 'chapter'], ['creationDraft.skeletons.0.beats.0.relatedCharacterIds', undefined],
    ['creationDraft.volumes.0.approval', true], ['creationDraft.chapterPlans.0.status', 'draft'], ['creationDraft.chapterPlans.0.number', 1.5],
    ['creationDraft.chapterPlans.0.requiredEvents', undefined], ['creationDraft.chapterPlans.0.prohibitedReveals.0', 5],
    ['creationDraft.scenePlans.0.status', 'archived'], ['creationDraft.scenePlans.0.order', -1], ['creationDraft.scenePlans.0.requiredActions', {}],
    ['creationDraft.approval.unknown', 'approved'], ['creationDraft.approval.contract', 'accepted'],
  ])('rejects malformed %s', (path, replacement) => {
    const { novel, workspace } = fixture()
    changeAt(workspace, path as string, replacement)
    expect(() => validate([workspace], [novel])).toThrow()
  })

  it.each(['2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-27', 'today', '2026-10-27T24:00:00Z', '2026-10-27T05:00:00x000Z', '2026-10-27T05:00:00000Z'])('rejects malformed date %s', value => {
    const { novel, workspace } = fixture()
    workspace.candidates[0].createdAt = value
    expect(() => validate([workspace], [novel])).toThrow('createdAt')
  })

  it('validates every date location, numeric ranges and before/after identity', () => {
    const checks: Array<[string, unknown]> = [
      ['candidates.0.updatedAt', 'bad'], ['creationDraft.updatedAt', 'bad'], ['creationDraft.contract.updatedAt', 'bad'],
      ['creationDraft.skeletons.0.updatedAt', 'bad'], ['chapterReviews.0.startedAt', 'bad'], ['chapterReviews.0.completedAt', 'bad'],
      ['canonMutations.0.appliedAt', 'bad'], ['aiRuns.0.createdAt', 'bad'], ['aiRuns.0.updatedAt', 'bad'],
      ['candidates.0.evidence.0.startOffset', 9999], ['reviewFindings.0.startOffset', 99], ['aiRuns.0.chapterStart', 3],
      ['creationDraft.chapterPlans.0.endNumber', -1], ['canonMutations.3.characterState.before.characterId', 'different'],
      ['canonMutations.3.characterState.before.targetCharacterId', 'different'],
      ['canonMutations.0.type', 'fact'],
    ]
    for (const [path, replacement] of checks) {
      const { novel, workspace } = fixture()
      if (path.startsWith('reviewFindings.0.')) workspace.reviewFindings[0].endOffset = 0
      changeAt(workspace, path, replacement)
      expect(() => validate([workspace], [novel]), path).toThrow()
    }
  })

  it.each(['draft', 'awaiting_approval', 'rejected', 'approved'] as const)('preserves finite unfinished target word counts for %s contracts', approval => {
    for (const [min, max] of [[0, 0], [-2, 10], [20, 10]]) {
      const { novel, workspace } = fixture()
      const contract = workspace.creationDraft!.contract
      Object.assign(contract, { approval, targetWordCountMin: min, targetWordCountMax: max })
      if (approval === 'approved') expect(() => validate([workspace], [novel])).toThrow('targetWordCount')
      else {
        expect(() => validate([workspace], [novel])).not.toThrow()
        expect([contract.targetWordCountMin, contract.targetWordCountMax]).toEqual([min, max])
      }
    }
  })

  it.each(['creationDraft', 'candidates', 'reviewFindings', 'chapterReviews', 'canonMutations'])('enforces global SQL IDs for %s', key => {
    const { novel, workspace } = fixture()
    const other = otherNovel()
    const next = emptyProjectWorkspace(other.id) as unknown as Record<string, unknown>
    next[key] = clone((workspace as unknown as Record<string, unknown>)[key])
    expect(() => validate([workspace, next], [novel, other])).toThrow('重复 ID')
  })

  it('enforces mutation candidate uniqueness and the actual AI run composite key', () => {
    const { novel, workspace } = fixture()
    workspace.canonMutations[1].candidateId = workspace.canonMutations[0].candidateId
    expect(() => validate([workspace], [novel])).toThrow('candidateId：重复 ID')
    workspace.canonMutations = []
    const other = otherNovel()
    const next = emptyProjectWorkspace(other.id)
    next.aiRuns = [{ ...workspace.aiRuns[0], targetId: other.id }]
    expect(() => validate([workspace, next], [novel, other])).not.toThrow()
    workspace.aiRuns.push(clone(workspace.aiRuns[0]))
    expect(() => validate([workspace, next], [novel, other])).toThrow('aiRuns：重复 ID')
  })

  it.each(['candidates', 'reviewFindings', 'chapterReviews', 'canonMutations'])('rejects duplicate rows within %s', key => {
    const { novel, workspace } = fixture()
    const rows = (workspace as unknown as Record<string, Array<unknown>>)[key]
    rows.push(clone(rows[0]))
    expect(() => validate([workspace], [novel])).toThrow('重复 ID')
  })

  it.each(['findings', 'candidateChanges'])('rejects duplicates inside review %s while permitting snapshots across reviews', key => {
    const { novel, workspace } = fixture()
    workspace.chapterReviews.push({ ...clone(workspace.chapterReviews[0]), id: 'later-review' })
    expect(() => validate([workspace], [novel])).not.toThrow()
    const rows = workspace.chapterReviews[0][key as 'findings']
    rows.push(clone(rows[0]))
    expect(() => validate([workspace], [novel])).toThrow('重复 ID')
  })

  it.each(['candidates.0.novelId', 'chapterReviews.0.candidateChanges.0.novelId', 'canonMutations.0.novelId'])('rejects owner mismatch at %s', path => {
    const { novel, workspace } = fixture()
    changeAt(workspace, path, 'unknown-owner')
    expect(() => validate([workspace], [novel])).toThrow()
  })

  it.each([
    ['candidates.0.chapterId', 'foreign-chapter'], ['candidates.0.targetId', 'foreign-character'],
    ['reviewFindings.0.chapterId', 'foreign-chapter'], ['reviewFindings.0.sceneId', 'foreign-scene'],
    ['chapterReviews.0.chapterId', 'foreign-chapter'], ['chapterReviews.0.candidateChanges.0.chapterId', 'foreign-chapter'],
    ['chapterReviews.0.findings.0.chapterId', 'foreign-chapter'], ['canonMutations.0.chapterId', 'foreign-chapter'],
    ['canonMutations.0.characterState.after.characterId', 'foreign-character'],
    ['canonMutations.3.characterState.before.characterId', 'foreign-character'], ['canonMutations.1.characterState.after.targetCharacterId', 'foreign-character'],
    ['canonMutations.0.characterState.after.sourceEventId', 'foreign-event'], ['aiRuns.0.targetId', 'foreign-chapter'],
    ['creationDraft.scenePlans.0.viewpointCharacterId', 'foreign-character'],
    ['creationDraft.skeletons.0.beats.0.relatedCharacterIds.0', 'foreign-character'], ['creationDraft.volumes.0.plotlineIds.0', 'foreign-plotline'],
    ['creationDraft.chapterPlans.0.foreshadowingIds.0', 'foreign-event'],
  ])('rejects foreign references at %s even if local planning uses the same ID', (path, foreignId) => {
    const { novel, workspace } = fixture()
    const draft = workspace.creationDraft!
    draft.skeletons[0].id = foreignId
    draft.selectedSkeletonId = foreignId
    changeAt(workspace, path, foreignId)
    expect(() => validate([workspace, emptyProjectWorkspace('other')], [novel, otherNovel()])).toThrow()
  })

  it.each(['chapter', 'character', 'scene', 'event', 'plotline', 'rule', 'outline'])('checks typed ownership of %s evidence', sourceType => {
    const { novel, workspace } = fixture()
    const foreignId = { chapter: 'foreign-chapter', character: 'foreign-character', scene: 'foreign-scene', event: 'foreign-event',
      plotline: 'foreign-plotline', rule: 'foreign-rule', outline: 'foreign-plan' }[sourceType]!
    if (sourceType === 'scene') {
      workspace.creationDraft!.skeletons[0].id = foreignId
      workspace.creationDraft!.selectedSkeletonId = foreignId
    } else {
      workspace.creationDraft!.chapterPlans[0].scenePlanIds = [foreignId]
      workspace.creationDraft!.scenePlans[0].id = foreignId
    }
    changeAt(workspace, 'candidates.0.evidence.0.sourceType', sourceType)
    changeAt(workspace, 'candidates.0.evidence.0.sourceId', foreignId)
    expect(() => validate([workspace, emptyProjectWorkspace('other')], [novel, otherNovel()])).toThrow('其他小说')
  })

  it('checks typed character references inside JSON proposals and permits inert author text', () => {
    const { novel, workspace } = fixture()
    workspace.creationDraft!.skeletons[0].id = 'foreign-character'
    workspace.creationDraft!.selectedSkeletonId = 'foreign-character'
    workspace.candidates[0].proposedValue = JSON.stringify({ characterId: 'foreign-character' })
    expect(() => validate([workspace, emptyProjectWorkspace('other')], [novel, otherNovel()])).toThrow('proposedValue.characterId')
    workspace.candidates[0].proposedValue = '作者尚在编辑，不是 JSON。'
    expect(() => validate([workspace], [novel])).not.toThrow()
  })

  it.each([
    ['creationDraft.selectedSkeletonId', 'missing'], ['creationDraft.volumes.0.chapterPlanIds.0', 'missing'],
    ['creationDraft.chapterPlans.0.volumeId', 'missing'], ['creationDraft.chapterPlans.0.scenePlanIds.0', 'missing'],
    ['creationDraft.scenePlans.0.chapterPlanId', 'missing'],
  ])('rejects dangling planning association %s', (path, replacement) => {
    const { novel, workspace } = fixture()
    changeAt(workspace, path, replacement)
    expect(() => validate([workspace], [novel])).toThrow('引用不存在')
  })

  it.each(['skeletons', 'volumes', 'chapterPlans', 'scenePlans'])('rejects duplicate planning %s IDs', key => {
    const { novel, workspace } = fixture()
    const rows = workspace.creationDraft![key as 'skeletons']
    rows.push(clone(rows[0]))
    expect(() => validate([workspace], [novel])).toThrow('重复 ID')
  })

  it.each(['volumes.0.chapterPlanIds', 'volumes.0.plotlineIds', 'chapterPlans.0.scenePlanIds', 'chapterPlans.0.foreshadowingIds',
    'skeletons.0.beats.0.relatedCharacterIds', 'skeletons.0.beats.0.relatedPlotlineIds'])('rejects duplicate planning links %s', path => {
    const { novel, workspace } = fixture()
    changeAt(workspace.creationDraft, path, ['same', 'same'])
    expect(() => validate([workspace], [novel])).toThrow('重复关联')
  })

  it('accepts production pending/approved/rejected scene replacements and planning resynchronization', () => {
    const { novel, workspace } = fixture()
    const original = workspace.creationDraft!
    original.contract.genre = '悬疑'
    original.contract.centralConflict = '寻找真相'
    original.contract.endingDirection = '揭晓谜底'
    let draft = confirmCreationSkeleton(confirmStoryContract(original, original.contract, now), now)
    draft = confirmChapterPlan(draft, draft.chapterPlans[0].id, now)
    const planId = draft.chapterPlans[0].id
    const scenes = normalizeScenePlans([{ title: '新的场景', purpose: '查证', outputState: '获知线索', locationId: '旧书店' }], planId, 'replacement')
    draft = proposeScenePlans(draft, planId, scenes, now)
    workspace.creationDraft = draft
    expect(() => validate([workspace], [novel])).not.toThrow()
    draft = approveScenePlans(draft, planId, scenes.map(scene => scene.id), now)
    workspace.creationDraft = draft
    expect(() => validate([workspace], [novel])).not.toThrow()
    workspace.creationDraft = reviseStoryContract(draft, { ...draft.contract, centralConflict: '重新寻找真相' }, now)
    expect(() => validate([workspace], [novel])).not.toThrow()
    workspace.creationDraft = syncCreationDraftPlanning(workspace.creationDraft, novel, now)
    expect(() => validate([workspace], [novel])).not.toThrow()
  })

  it.each(['__proto__', 'constructor', 'prototype'])('recursively rejects %s in unknown fields and JSON proposal payloads', key => {
    const { novel, workspace } = fixture()
    const unsafe = JSON.parse('{"extension":{"' + key + '":{"polluted":true}}}')
    Object.assign(workspace, unsafe)
    expect(() => validate([workspace], [novel])).toThrow(key)
    delete (workspace as unknown as Record<string, unknown>).extension
    workspace.candidates[0].proposedValue = JSON.stringify(unsafe)
    expect(() => validate([workspace], [novel])).toThrow(key)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects excessive depth, cycles, class prototypes, functions, sparse arrays and getters without invoking them', () => {
    const { novel, workspace } = fixture()
    let deep: unknown = 'leaf'
    for (let i = 0; i < 45; i++) deep = { next: deep }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const getter = vi.fn(() => 'should not execute')
    const withGetter = Object.defineProperty({}, 'read', { get: getter, enumerable: true })
    for (const extension of [deep, cycle, new Date(), () => undefined, new Array(2), withGetter]) {
      Object.assign(workspace, { extension })
      expect(() => validate([workspace], [novel])).toThrow()
    }
    expect(getter).not.toHaveBeenCalled()
    delete (workspace as unknown as Record<string, unknown>).extension
    workspace.candidates[0].proposedValue = JSON.stringify(deep)
    expect(() => validate([workspace], [novel])).toThrow('嵌套过深')
  })
})
