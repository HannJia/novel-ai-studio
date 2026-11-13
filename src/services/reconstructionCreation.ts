import type { Novel } from '@/types/novel'
import { contractCards, contractCardConfirmed, contractCardSignature, contractContent } from './storyContract'
import { styleDimensions } from '@/data/styles'
import {
  createEmptyCreationDraft,
  type CreationDraft,
  type PlotSkeleton,
  type StoryBeat,
  type StoryContract,
  type StructuredChapterPlan,
  type VolumeOutline,
  type ScenePlan,
  validateCreationStage,
} from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { saveSkeletonRevision, skeletonCompletionIssues, skeletonContentSignature } from './creationDraft'

function splitRules(value: string): string[] {
  return value.split(/[\n；;。]+/).map(item => item.trim()).filter(Boolean).slice(0, 20)
}

function sectionText(markdown: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
    const match = markdown.match(new RegExp('^#{1,4}\\s*' + escaped + '[：:]?\\s*\\n?([\\s\\S]*?)(?=^#{1,4}\\s|(?![\\s\\S]))', 'im'))
    if (match?.[1]?.trim()) return match[1].trim()
  }
  return ''
}

function beatKind(title: string): StoryBeat['kind'] {
  if (/开端|开局|起点|引子/.test(title)) return 'opening'
  if (/契机|引发|导火|开始/.test(title)) return 'inciting'
  if (/中点|中期|转折|反转/.test(title)) return 'midpoint'
  if (/低谷|危机|绝境|失败/.test(title)) return 'low_point'
  if (/高潮|决战|终局|最终/.test(title)) return 'climax'
  if (/收束|结局|尾声|解决/.test(title)) return 'resolution'
  return 'custom'
}

function outlineBeats(outline: string): StoryBeat[] {
  const headings = Array.from(outline.matchAll(/^#{1,4}\s+(.+)$/gm))
    .map(match => match[1].replace(/[：:].*$/, '').trim())
    .filter(title => title && !/推荐书名|主要角色|核心冲突|全书伏笔|字数|简介/.test(title))
    .slice(0, 12)
  return headings.map((title, index) => ({
    id: 'beat:' + index,
    title,
    description: sectionText(outline, [title]).slice(0, 1200),
    kind: beatKind(title),
    relatedPlotlineIds: [],
    relatedCharacterIds: [],
  }))
}

export function createCreationDraftFromNovel(novel: Novel, now: string): CreationDraft {
  const styleLabel = (key: string, value: string) => styleDimensions.find(item => item.key === key)?.options.find(item => item.value === value)?.label || value
  const draft = createEmptyCreationDraft({
    id: 'creation:' + novel.id,
    now,
    entry: novel.outline ? 'import' : 'idea',
    mode: novel.writingMode === 'ai' ? 'collaborative' : 'author',
  })
  draft.contract = {
    ...draft.contract,
    title: novel.title,
    genre: novel.genreLabel || novel.genre,
    subGenre: novel.subGenreLabel || novel.subGenre,
    format: 'serial',
    targetWordCountMin: novel.targetWordCountMin > 0 ? novel.targetWordCountMin * 10000 : undefined,
    targetWordCountMax: novel.targetWordCountMax > 0 ? novel.targetWordCountMax * 10000 : undefined,
    pointOfView: styleLabel('narrativePov', novel.writingStyle.narrativePov),
    styleDirection: Object.entries(novel.writingStyle).filter(([, value]) => Boolean(value)).map(([key, value]) => styleLabel(key, value)).join(' / '),
    coreTheme: novel.tags.join('、'),
    readerPromise: novel.settings.payoff.patterns.join('、'),
    protagonistPremise: [novel.settings.protagonist.name, novel.settings.protagonist.background].filter(Boolean).join('：'),
    protagonistGoal: novel.settings.coreConflict.mainConflict,
    protagonistFear: '',
    centralConflict: novel.settings.coreConflict.mainConflict,
    endingDirection: '',
    romanceDirection: [novel.settings.romance.romanceType, novel.settings.romance.developmentPace].filter(Boolean).join('，'),
    worldRules: splitRules(novel.settings.worldBuilding.specialRules),
    authorPreferences: novel.tags.slice(0, 12),
    updatedAt: now,
  }
  return draft
}

export function buildPlotSkeletonFromOutline(novel: Novel, outline: string, now: string): PlotSkeleton {
  const synopsis = sectionText(outline, ['小说简介', '一句话概括', '主线剧情走向']) || novel.synopsis || novel.settings.coreConflict.mainConflict || outline.trim().slice(0, 1500)
  const ending = sectionText(outline, ['结局方向', '最终结局', '结局']) || '待作者确认'
  const title = sectionText(outline, ['推荐书名']).split('\n').map(item => item.replace(/[\-*《》]/g, '').trim()).find(Boolean) || novel.title
  return {
    id: 'skeleton:' + novel.id,
    title: title || novel.title,
    premise: synopsis.slice(0, 1500),
    logline: synopsis.slice(0, 500),
    promise: [novel.settings.coreConflict.mainConflict, novel.settings.payoff.patterns.join('、')].filter(Boolean).join('；'),
    ending: ending.slice(0, 1200),
    beats: outlineBeats(outline),
    approval: 'draft',
    updatedAt: now,
  }
}

export function buildPlotSkeletonPrompt(contract: StoryContract): string {
  if (contract.approval !== 'approved') throw new Error('请先确认作品契约')
  return '请根据作者已经确认的作品契约生成 2-3 个可比较的原创故事骨架候选。遵守世界规则、禁用内容、叙事视角、读者承诺和结局方向；标为暂不确定的部分可以提出备选建议。只输出 JSON，不要 Markdown 或解释。每个候选包含 title、premise、logline、promise、ending 和 beats；beats 为 4-8 个节点，每个节点包含 title、description、kind（opening|inciting|turning_point|midpoint|low_point|climax|resolution|custom）。\n\n作品契约：' + JSON.stringify(contract)
    + '\n输出格式：{"skeletons":[{"title":"","premise":"","logline":"","promise":"","ending":"","beats":[{"title":"","description":"","kind":"custom"}]}]}'
}

export function reviseStoryContract(draft: CreationDraft, contract: StoryContract, now: string): CreationDraft {
  if (contract.id !== draft.contract.id) throw new Error('作品契约不属于当前创作草稿')
  contract = { ...contract, worldRules: contract.worldRules.map(value => value.trim()).filter(Boolean),
    forbiddenTopics: contract.forbiddenTopics.map(value => value.trim()).filter(Boolean),
    authorPreferences: contract.authorPreferences.map(value => value.trim()).filter(Boolean) }
  contract = { ...contract, cardConfirmations: (contract.cardConfirmations || []).filter(item =>
    contractCards.some(card => card.id === item.cardId) && item.signature === contractCardSignature(contract, item.cardId)) }
  const contentChanged = JSON.stringify(contractContent(draft.contract)) !== JSON.stringify(contractContent(contract))
  const withdrawn = draft.contract.approval === 'approved' && contractCards.some(card => !contractCardConfirmed(contract, card.id))
  if (!contentChanged && !withdrawn) {
    if (JSON.stringify(draft.contract.cardConfirmations) === JSON.stringify(contract.cardConfirmations)) return draft
    return { ...draft, contract: { ...draft.contract, cardConfirmations: contract.cardConfirmations }, updatedAt: now }
  }
  return {
    ...draft, stage: 'contract', contract: { ...contract, approval: 'draft', updatedAt: now },
    approval: {}, selectedSkeletonId: undefined,
    skeletons: draft.skeletons.map(item => ({ ...item, approval: 'draft', updatedAt: now })),
    volumes: draft.volumes.map(item => ({ ...item, approval: 'draft' })),
    chapterPlans: draft.chapterPlans.map(item => ({ ...item, approval: 'draft' })),
    scenePlans: invalidateSceneApprovals(draft.scenePlans), updatedAt: now,
  }
}

export function confirmStoryContract(draft: CreationDraft, contract: StoryContract, now: string): CreationDraft {
  const revised = reviseStoryContract(draft, contract, now)
  const issues = validateCreationStage({ ...revised, stage: 'contract' })
  if (contractCards.some(card => !contractCardConfirmed(revised.contract, card.id))) issues.push('请逐项确认全部八张契约卡片')
  if (issues.length) throw new Error(issues.join('；'))
  return { ...revised, stage: revised.stage === 'contract' ? 'skeleton' : revised.stage,
    contract: { ...revised.contract, approval: 'approved', updatedAt: now },
    approval: { ...revised.approval, contract: 'approved' }, updatedAt: now }
}

export function normalizePlotSkeletonCandidates(novel: Novel, raw: unknown, now: string): PlotSkeleton[] {
  const source: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).skeletons)
    ? (raw as Record<string, unknown>).skeletons as unknown[]
    : []
  return source.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, any>
    const title = String(value.title || '').trim()
    const premise = String(value.premise || '').trim()
    if (!title || !premise) return []
    const beats: StoryBeat[] = Array.isArray(value.beats) ? value.beats.flatMap((beat: any, beatIndex: number) => {
      if (!beat || typeof beat !== 'object' || !String(beat.title || '').trim()) return []
      const kind = ['opening', 'inciting', 'turning_point', 'midpoint', 'low_point', 'climax', 'resolution', 'custom'].includes(beat.kind) ? beat.kind : 'custom'
      return [{
        id: 'skeleton:' + novel.id + ':' + index + ':beat:' + beatIndex,
        title: String(beat.title).trim(),
        description: String(beat.description || '').trim(),
        kind,
        relatedPlotlineIds: [],
        relatedCharacterIds: [],
      }]
    }) : []
    return [{
      id: 'skeleton:' + novel.id + ':ai:' + index,
      title,
      premise,
      logline: String(value.logline || premise).trim(),
      promise: String(value.promise || '').trim(),
      ending: String(value.ending || '').trim(),
      beats,
      approval: 'draft' as const,
      complete: Array.isArray(value.beats) && beats.length === value.beats.length,
      updatedAt: now,
    }]
  })
}

export function syncCreationDraftFromOutline(draft: CreationDraft, novel: Novel, outline: string, now: string): CreationDraft {
  const skeleton = buildPlotSkeletonFromOutline(novel, outline, now)
  const skeletons = draft.skeletons.length ? draft.skeletons : [skeleton]
  const selectedSkeletonId = draft.selectedSkeletonId && skeletons.some(item => item.id === draft.selectedSkeletonId)
    ? draft.selectedSkeletonId : undefined
  return {
    ...draft,
    skeletons,
    selectedSkeletonId,
    stage: draft.contract.approval !== 'approved' || draft.approval.contract !== 'approved' ? 'contract'
      : selectedSkeletonId && draft.approval.skeleton === 'approved' ? 'volume-outline' : 'skeleton',
    approval: { ...draft.approval },
    updatedAt: now,
  }
}

export function confirmCreationSkeleton(draft: CreationDraft, now: string): CreationDraft {
  if (draft.contract.approval !== 'approved' || draft.approval.contract !== 'approved') throw new Error('请先确认作品契约')
  if (!draft.skeletons.length) throw new Error('还没有可确认的故事骨架')
  const selectedSkeletonId = draft.editingSkeletonId || draft.selectedSkeletonId || (draft.skeletons.length === 1 ? draft.skeletons[0].id : undefined)
  if (!selectedSkeletonId || !draft.skeletons.some(item => item.id === selectedSkeletonId)) {
    throw new Error('请先选择一个故事骨架，再展开大纲')
  }
  const selected = draft.skeletons.find(item => item.id === selectedSkeletonId)!
  const issues = skeletonCompletionIssues(selected)
  if (issues.length) throw new Error(issues.join('；'))
  if (draft.selectedSkeletonId === selectedSkeletonId && draft.approval.skeleton === 'approved' && selected.approval === 'approved') return draft
  const previous = draft.skeletons.find(item => item.id === draft.selectedSkeletonId && item.approval === 'approved')
  const directionChanged = !previous || skeletonContentSignature(previous) !== skeletonContentSignature(selected)
  const skeletons = draft.skeletons.map(item => item.id === selectedSkeletonId ? { ...item, approval: 'approved' as const, updatedAt: now } : item)
  return {
    ...draft,
    skeletons,
    selectedSkeletonId,
    stage: 'volume-outline',
    approval: { ...draft.approval, skeleton: 'approved', ...(directionChanged ? { 'volume-outline': 'draft', 'chapter-outline': 'draft', 'scene-outline': 'draft' } as const : {}) },
    volumes: directionChanged ? draft.volumes.map(item => ({ ...item, approval: 'draft' })) : draft.volumes,
    chapterPlans: directionChanged ? draft.chapterPlans.map(item => ({ ...item, approval: 'draft' })) : draft.chapterPlans,
    scenePlans: directionChanged ? invalidateSceneApprovals(draft.scenePlans) : draft.scenePlans,
    updatedAt: now,
  }
}

export function reviseCreationSkeleton(draft: CreationDraft, selectedId: string, skeleton: PlotSkeleton | undefined, now: string, id: () => string = () => crypto.randomUUID()): CreationDraft {
  const existing = draft.skeletons.find(item => item.id === selectedId)
  if (!existing || (skeleton && skeleton.id !== selectedId)) throw new Error('故事骨架不属于当前作品')
  if (!skeleton || skeletonContentSignature(skeleton) === skeletonContentSignature(existing)) {
    return draft.editingSkeletonId === selectedId ? draft : { ...draft, editingSkeletonId: selectedId }
  }
  // An approved direction is immutable while the author explores another candidate.
  const candidate = { ...skeleton, id: existing.approval === 'approved' ? id() : existing.id, approval: 'draft' as const }
  return saveSkeletonRevision(draft, candidate, 'author', now, id, { parentRevisionId: existing.revisionId })
}

export function buildConfirmedSkeletonConstraint(draft: CreationDraft): string {
  if (draft.contract.approval !== 'approved' || draft.approval.contract !== 'approved') throw new Error('请先确认作品契约')
  const skeleton = draft.skeletons.find(item => item.id === draft.selectedSkeletonId)
  if (draft.approval.skeleton !== 'approved' || skeleton?.approval !== 'approved') {
    throw new Error('故事骨架尚未由作者确认')
  }
  return [
    '【作者已确认的作品契约和故事骨架】',
    '以下为本次展开的唯一故事方向。保留主线、关键选择、转折因果和结局，不混入其他候选。',
    '尚未确定的内容请明确标记为待作者设计，不擅自把推测设为已确认事实。',
    JSON.stringify({ contract: draft.contract, skeleton }),
  ].join('\n')
}

export function syncCreationDraftPlanning(draft: CreationDraft, novel: Novel, now: string): CreationDraft {
  const changedVolumes = new Set<string>()
  const volumes: VolumeOutline[] = (novel.volumes || []).map(volume => {
    const id = 'volume:' + volume.id
    const old = draft.volumes.find(item => item.id === id)
    const sourceVersion = buildAnalysisSourceVersionId(JSON.stringify([volume.title, volume.summary, volume.keyTurningPoints, volume.characterChanges]))
    if (old?.sourceVersion === sourceVersion) return { ...old, chapterPlanIds: [] }
    changedVolumes.add(id)
    return { ...old, id, sourceVersion, title: volume.title, objective: volume.summary, conflict: volume.keyTurningPoints,
      openingState: old?.openingState || '', midpointChange: volume.keyTurningPoints, endingState: volume.characterChanges,
      chapterPlanIds: [], plotlineIds: old?.plotlineIds || [], approval: 'draft' }
  })
  const changed = new Set<string>()
  const chapterPlans: StructuredChapterPlan[] = (novel.chapterPlans || []).map(plan => {
    const id = 'chapter-plan:' + plan.id
    const old = draft.chapterPlans.find(item => item.id === id)
    const chapter = novel.chapters.find(item => item.chapterIndex === plan.targetChapterStart)
    let offset = 0
    // The first empty chapter uses the first volume when no range has been estimated yet.
    // Binding it now keeps the author's approval valid when that empty chapter is created.
    const volume = chapter ? novel.volumes?.find(item => item.volumeIndex === chapter.volumeIndex)
      : [...(novel.volumes || [])].sort((a, b) => a.volumeIndex - b.volumeIndex).find(item => {
        const contains = plan.targetChapterStart >= offset && plan.targetChapterStart < offset + item.estimatedChapters
        offset += item.estimatedChapters
        return contains
      }) || (plan.targetChapterStart === 0 ? [...(novel.volumes || [])].sort((a, b) => a.volumeIndex - b.volumeIndex)[0] : undefined)
    const volumeId = volume ? 'volume:' + volume.id : undefined
    const sourceVersion = buildAnalysisSourceVersionId(JSON.stringify([plan.title, plan.objective, plan.summary, plan.beats,
      plan.targetChapterStart, plan.targetChapterEnd, plan.relatedEventIds, volumeId]))
    if (old?.sourceVersion === sourceVersion) {
      if (volumeId && changedVolumes.has(volumeId)) {
        changed.add(id)
        return { ...old, status: plan.status, approval: 'draft' }
      }
      return { ...old, status: plan.status }
    }
    changed.add(id)
    return { ...old, id, sourceVersion, volumeId, number: plan.targetChapterStart + 1, endNumber: plan.targetChapterEnd + 1,
      title: plan.title, objective: plan.objective, conflict: plan.summary, openingState: old?.openingState || '', endingState: old?.endingState || '',
      requiredEvents: [...plan.beats], prohibitedReveals: old?.prohibitedReveals || [], characterChangeNotes: old?.characterChangeNotes || [],
      foreshadowingIds: [...plan.relatedEventIds], scenePlanIds: old?.scenePlanIds || [], status: plan.status, approval: 'draft' }
  })
  for (const old of draft.chapterPlans) {
    if (!chapterPlans.some(item => item.id === old.id)) {
      changed.add(old.id)
      chapterPlans.push({ ...old, status: 'archived', approval: 'draft' })
    }
  }
  for (const volume of volumes) volume.chapterPlanIds = chapterPlans.filter(item => item.volumeId === volume.id && item.status !== 'archived').map(item => item.id)
  const scenePlans = invalidateSceneApprovals(draft.scenePlans, changed)
  const storyConfirmed = draft.approval.contract === 'approved' && draft.approval.skeleton === 'approved'
  const stage = !storyConfirmed ? draft.stage : chapterPlans.length ? 'chapter-outline' : volumes.length ? 'volume-outline' : draft.stage
  return {
    ...draft,
    volumes,
    chapterPlans,
    scenePlans,
    stage,
    approval: {
      ...draft.approval,
      ...(volumes.some(item => item.approval !== 'approved') ? { 'volume-outline': 'draft' as const } : {}),
      ...(changed.size ? { 'chapter-outline': 'draft' as const, 'scene-outline': 'draft' as const } : {}),
    },
    updatedAt: now,
  }
}

export function invalidateSceneApprovals(scenes: ScenePlan[], chapterIds?: Set<string>): ScenePlan[] {
  const hasPending = new Set(scenes.filter(item => ['draft', 'awaiting_approval'].includes(item.approval)).map(item => item.chapterPlanId))
  return scenes.map(item => {
    if (item.approval === 'rejected' || (chapterIds && !chapterIds.has(item.chapterPlanId))) return item
    // 有新候选时，将上一批准方案留在历史里，避免两组场景在重确认时被无意拼在一起。
    return { ...item, approval: item.approval === 'approved' && hasPending.has(item.chapterPlanId) ? 'rejected' : 'draft' }
  })
}
