import type { Character, Novel } from '@/types/novel'
import type { CandidateChange, CanonMutationRecord, CharacterStateChange, EvidenceRef, KnowledgeState } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId } from './reconstructionCandidates'
import { withCurrentStoryEntities, sourceNovel } from './effectiveStory'
import type { CharacterMemoryConfirmation, MemoryKnowledgeEdge, MemoryRelationshipState, PropositionCatalogEntry, StoryProposition } from '@/types/characterMemory'
import { assertRelationshipDimension, characterMemoryEvidenceSignature, describeProposition, knowledgeResolutionSignature, propositionOf, propositionSignature, relationshipDimensionLabel, relationshipIdentity } from './characterMemoryIdentity'

export const knowledgeStateLabels: Record<KnowledgeState, string> = {
  knows: '已知', suspects: '怀疑', does_not_know: '明确不知情', false_belief: '错误信念',
}
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()

type CharacterStateProjectionCache = {
  source: Novel
  chaptersById: Map<string, Novel['chapters'][number]>
  characterIds: Set<string>
  effectiveCharacterIdsByChapter: Map<number, Set<string>>
  sourceVersionByChapter: Map<string, string>
}

function createCharacterStateProjectionCache(novel: Novel): CharacterStateProjectionCache {
  const source = sourceNovel(novel)
  const chaptersById = new Map<string, Novel['chapters'][number]>()
  for (const chapter of source.chapters || []) if (!chaptersById.has(chapter.id)) chaptersById.set(chapter.id, chapter)
  return {
    source,
    chaptersById,
    characterIds: new Set((source.characters || []).map(character => character.id)),
    effectiveCharacterIdsByChapter: new Map(),
    sourceVersionByChapter: new Map(),
  }
}

function effectiveCharacterIds(cache: CharacterStateProjectionCache, chapterIndex: number): Set<string> {
  const cached = cache.effectiveCharacterIdsByChapter.get(chapterIndex)
  if (cached) return cached
  const effective = withCurrentStoryEntities(cache.source, chapterIndex + 1)
  const ids = new Set(effective.characters.map(character => character.id))
  cache.effectiveCharacterIdsByChapter.set(chapterIndex, ids)
  return ids
}

function chapterSourceVersion(cache: CharacterStateProjectionCache, chapter: Novel['chapters'][number]): string {
  const cached = cache.sourceVersionByChapter.get(chapter.id)
  if (cached) return cached
  const version = buildAnalysisSourceVersionId(chapter.content)
  cache.sourceVersionByChapter.set(chapter.id, version)
  return version
}

function resolveCharacter(novel: Novel, id: unknown, name: unknown): Character {
  const matches = clean(id)
    ? novel.characters.filter(character => character.id === clean(id))
    : novel.characters.filter(character => [character.name, ...(character.aliases || [])]
      .some(alias => normalized(alias) === normalized(clean(name))))
  if (matches.length !== 1) throw new Error('角色引用不存在或存在同名歧义，请先确认角色，再重新提取候选')
  if (clean(name) && ![matches[0].name, ...(matches[0].aliases || [])].some(alias => normalized(alias) === normalized(clean(name)))) {
    throw new Error('角色 ID 与名称不一致，请重新提取候选')
  }
  return matches[0]
}

function characterStateEvidenceIssueWithCache(cache: CharacterStateProjectionCache, record: CanonMutationRecord): string | undefined {
  const novel = cache.source
  const change = record.characterState
  if (!change) return undefined
  if (record.novelId !== novel.id) return '记录属于其他作品'
  const chapter = cache.chaptersById.get(record.chapterId || '')
  if (!chapter) return '来源章节已删除'
  const chapterIndex = change.kind === 'knowledge' ? change.after.knownSinceChapter : change.after.sinceChapter
  if (chapter.chapterIndex !== chapterIndex) return '来源章节顺序已改变'
  const proposition = change.kind === 'knowledge' ? (change.after as MemoryKnowledgeEdge).proposition : undefined
  const characterIds = change.kind === 'knowledge' ? [change.after.characterId, proposition?.subjectId, proposition?.objectId].filter((id): id is string => !!id) : [change.after.characterId, change.after.targetCharacterId]
  if (characterIds.some(id => !cache.characterIds.has(id))) return '关联角色已删除'
  if (characterIds.some(id => !effectiveCharacterIds(cache, chapterIndex).has(id))) return '关联角色来源失效或在该章尚未出现'
  const evidence = change.after.evidence
  const version = chapterSourceVersion(cache, chapter)
  if (!evidence.length || evidence.some(item => item.sourceType !== 'chapter' || item.sourceId !== chapter.id
    || item.sourceVersionId !== version || !item.quote?.trim() || !chapter.content.includes(item.quote)
    || (item.startOffset !== undefined && chapter.content.slice(item.startOffset, item.endOffset) !== item.quote))) {
    return '来源正文或证据已变化，需要重新审核'
  }
  return undefined
}

export function characterStateEvidenceIssue(novel: Novel, record: CanonMutationRecord): string | undefined {
  return characterStateEvidenceIssueWithCache(createCharacterStateProjectionCache(novel), record)
}

function stateKey(change: CharacterStateChange): string {
  return change.kind === 'knowledge'
    ? JSON.stringify(['knowledge', change.after.characterId, (change.after as MemoryKnowledgeEdge).stateIdentityId || change.after.factId])
    : relationshipIdentity(change.after.characterId, change.after.targetCharacterId, (change.after as MemoryRelationshipState).dimension)
}

export function getCharacterStateHistory(novel: Novel, records: CanonMutationRecord[], chapterIndex: number, boundary: 'before' | 'through' = 'through') {
  const cache = createCharacterStateProjectionCache(novel)
  return records.filter(record => record.novelId === cache.source.id && record.characterState)
    .filter(record => {
      const change = record.characterState!
      const index = change.kind === 'knowledge' ? change.after.knownSinceChapter : change.after.sinceChapter
      return boundary === 'before' ? index < chapterIndex : index <= chapterIndex
    })
    .sort((left, right) => {
      const a = left.characterState!, b = right.characterState!
      const ai = a.kind === 'knowledge' ? a.after.knownSinceChapter : a.after.sinceChapter
      const bi = b.kind === 'knowledge' ? b.after.knownSinceChapter : b.after.sinceChapter
      const ao = a.after.evidence[0]?.startOffset ?? 0, bo = b.after.evidence[0]?.startOffset ?? 0
      return ai - bi || ao - bo || left.appliedAt.localeCompare(right.appliedAt) || left.id.localeCompare(right.id)
    })
    .map(record => ({ record, issue: characterStateEvidenceIssueWithCache(cache, record) }))
}

function projectPropositionHistory(history: ReturnType<typeof getCharacterStateHistory>) {
  const entries = new Map<string, { proposition: StoryProposition; evidence: EvidenceRef[] }>()
  const aliases = new Map<string, string>()
  const priorStates = new Map<string, MemoryKnowledgeEdge>()
  const decisions: Array<{ record: CanonMutationRecord; active: boolean; issue?: string }> = []
  const resolve = (id: string) => {
    const seen = new Set<string>()
    while (aliases.has(id) && !seen.has(id)) { seen.add(id); id = aliases.get(id)! }
    return id
  }
  const entry = (id: string): PropositionCatalogEntry | undefined => {
    const current = entries.get(id)
    if (!current) return undefined
    const row = { ...current, canonicalId: resolve(id) }
    return { ...row, signature: propositionSignature(row) }
  }
  for (const item of history) {
    if (item.record.characterState?.kind !== 'knowledge') continue
    const state = item.record.characterState.after as MemoryKnowledgeEdge, decision = state.propositionDecision
    let issue = item.issue
    if (decision && !issue) {
      const target = entry(decision.targetId)
      const priorFrom = decision.fromIds.filter(id => id !== state.factId)
      if (decision.confirmedBy !== 'author' || decision.chapterId !== item.record.chapterId
        || decision.chapterIndex !== state.knownSinceChapter || decision.sourceVersionId !== state.evidence[0]?.sourceVersionId
        || characterMemoryEvidenceSignature(decision.evidence) !== characterMemoryEvidenceSignature(state.evidence)
        || !target || decision.targetSignature !== target.signature
        || decision.fromIds.some(id => id === decision.targetId || (id !== state.factId && !entries.has(id)))
        || priorFrom.some(id => entry(id)?.signature !== decision.mergeFromSignature)) issue = '命题归并决定的来源或被选身份已变化'
      if (!issue && decision.resolvedStateIds?.length) {
        const roots = new Set([decision.targetId, ...priorFrom].map(resolve))
        const states = decision.resolvedStateIds.map(id => priorStates.get(id))
        if (!decision.reason.trim() || states.some(prior => !prior || prior.characterId !== state.characterId || !roots.has(resolve(prior.factId)))
          || knowledgeResolutionSignature(states.filter((prior): prior is MemoryKnowledgeEdge => !!prior)) !== decision.resolutionSignature) issue = '作者处理冲突时的原认知或来源已变化'
      }
      if (!issue) for (const id of decision.fromIds) {
        const root = resolve(id), to = resolve(decision.targetId)
        if (root !== to) aliases.set(root, to)
      }
    }
    if (decision) decisions.push({ record: item.record, active: !issue, issue })
    // Invalid decisions never remove the original proposition/history.
    if (!item.issue) {
      priorStates.set(state.id, state)
      const proposition = propositionOf(state), existing = entries.get(proposition.id)
      if (!existing) entries.set(proposition.id, { proposition, evidence: state.evidence.map(ref => ({ ...ref })) })
      else existing.evidence.push(...state.evidence.map(ref => ({ ...ref })))
    }
  }
  return { entries: [...entries.keys()].sort().map(id => entry(id)!), resolve, decisions }
}

export function getPropositionCatalog(novel: Novel, records: CanonMutationRecord[], chapterIndex: number, boundary: 'before' | 'through' = 'through'): PropositionCatalogEntry[] {
  return projectPropositionHistory(getCharacterStateHistory(novel, records, chapterIndex, boundary)).entries
}

function buildCharacterStateSnapshot(
  history: ReturnType<typeof getCharacterStateHistory>,
  propositions: ReturnType<typeof projectPropositionHistory>,
) {
  const latest = new Map<string, ReturnType<typeof getCharacterStateHistory>[number]>()
  const activeDecisions = new Set(propositions.decisions.filter(item => item.active).map(item => item.record.id))
  const invalidSources = new Set(history.filter(item => item.issue).map(item => item.record.id))
  const resolvedStateIds = new Set(propositions.decisions.filter(item => item.active).flatMap(item => ((item.record.characterState!.after as MemoryKnowledgeEdge).propositionDecision?.resolvedStateIds || [])))
  const effectiveKey = (record: CanonMutationRecord) => {
    const change = record.characterState!
    if (change.kind !== 'knowledge') return stateKey(change)
    const state = change.after as MemoryKnowledgeEdge
    // An invalid later update still blocks stale fallback in its original lane.
    // A valid update whose equivalence alone has expired regains its own identity.
    const identity = state.propositionDecision?.action === 'link' && (activeDecisions.has(record.id) || invalidSources.has(record.id)) ? state.stateIdentityId || state.factId : state.factId
    return JSON.stringify(['knowledge', state.characterId, identity])
  }
  const revisionGroups = new Map<string, { version: string | undefined; appliedAt: string }>()
  const groupKey = (record: CanonMutationRecord) => effectiveKey(record) + ':' + record.chapterId
  for (const item of history) {
    const key = groupKey(item.record), previous = revisionGroups.get(key)
    if (!previous || previous.appliedAt <= item.record.appliedAt) {
      revisionGroups.set(key, { version: item.record.characterState!.after.evidence[0]?.sourceVersionId, appliedAt: item.record.appliedAt })
    }
  }
  for (const item of history) {
    // 同章改稿后的重新确认取代旧正文版本；同一正文内仍按证据位置排序。
    if (item.record.characterState!.after.evidence[0]?.sourceVersionId !== revisionGroups.get(groupKey(item.record))?.version) continue
    latest.set(effectiveKey(item.record), item)
  }
  const knowledge: MemoryKnowledgeEdge[] = [], relationships: MemoryRelationshipState[] = []
  const invalid: Array<{ record: CanonMutationRecord; issue: string }> = []
  for (const item of latest.values()) {
    if (resolvedStateIds.has(item.record.characterState!.after.id)) continue
    // 最新变化失效时不能悄悄回退成旧状态，避免把“未知”当成已知。
    if (item.issue) { invalid.push({ record: item.record, issue: item.issue }); continue }
    const change = item.record.characterState!
    if (change.kind === 'knowledge') {
      const after = change.after as MemoryKnowledgeEdge
      knowledge.push({ ...after, stateIdentityId: after.propositionDecision?.action === 'link' && activeDecisions.has(item.record.id) ? after.stateIdentityId : after.factId, projectedFactId: propositions.resolve(after.factId) })
    }
    else relationships.push(change.after)
  }
  const groups = new Map<string, MemoryKnowledgeEdge[]>()
  for (const state of knowledge) {
    const key = JSON.stringify([state.characterId, state.projectedFactId]), group = groups.get(key) || []
    group.push(state); groups.set(key, group)
  }
  for (const [key, group] of groups) if (new Set(group.map(state => JSON.stringify([state.state, state.belief || '']))).size > 1) {
    for (const state of group) state.conflictGroupId = key
  }
  // Same wording without an author identity decision is never merged, but it must not be
  // handed to writing/review as unrelated settled facts either: flag it for the author.
  const sameWording = new Map<string, MemoryKnowledgeEdge[]>()
  for (const state of knowledge) {
    const proposition = propositionOf(state)
    const key = JSON.stringify(['text', state.characterId, normalized(state.fact), normalized(proposition.scope || ''), proposition.subjectId || '', proposition.objectId || ''])
    sameWording.set(key, [...(sameWording.get(key) || []), state])
  }
  for (const [key, group] of sameWording) {
    if (new Set(group.map(state => state.projectedFactId || state.factId)).size < 2) continue
    if (new Set(group.map(state => JSON.stringify([state.state, state.belief || '']))).size < 2) continue
    for (const state of group) state.conflictGroupId ||= key
  }
  knowledge.sort((a,b) => a.characterId.localeCompare(b.characterId) || a.factId.localeCompare(b.factId) || a.id.localeCompare(b.id))
  relationships.sort((a,b) => stateKey({ kind: 'relationship', after: a }).localeCompare(stateKey({ kind: 'relationship', after: b })))
  return { knowledge, relationships, invalid, propositionDecisions: propositions.decisions }
}

export function getCharacterStateSnapshot(novel: Novel, records: CanonMutationRecord[], chapterIndex: number, boundary: 'before' | 'through' = 'before') {
  const history = getCharacterStateHistory(novel, records, chapterIndex, boundary)
  return buildCharacterStateSnapshot(history, projectPropositionHistory(history))
}

export function getCharacterStateProjection(novel: Novel, records: CanonMutationRecord[], chapterIndex: number, boundary: 'before' | 'through' = 'through') {
  const history = getCharacterStateHistory(novel, records, chapterIndex, boundary)
  const propositions = projectPropositionHistory(history)
  return {
    history,
    catalog: propositions.entries,
    snapshot: buildCharacterStateSnapshot(history, propositions),
  }
}

export function createCharacterStateChange(novel: Novel, candidate: CandidateChange, value: Record<string, unknown>, records: CanonMutationRecord[], confirmation: CharacterMemoryConfirmation = {}): { change: CharacterStateChange; summary: string } {
  const chapter = novel.chapters.find(item => item.id === candidate.chapterId)
  if (!chapter) throw new Error('知情与关系变化必须关联来源章节')
  const character = resolveCharacter(novel, value.characterId, value.characterName)
  if (character.firstAppearChapter > chapter.chapterIndex) throw new Error('角色在来源章节尚未出现，请核对角色与章节')
  const evidence: EvidenceRef[] = candidate.evidence.map(item => ({ ...item }))
  if (evidence.some(item => chapter.content.indexOf(item.quote!) !== chapter.content.lastIndexOf(item.quote!))) {
    throw new Error('证据在正文中重复出现，请重新提取包含上下文的完整引文')
  }
  const sourceOffset = evidence[0]?.startOffset ?? chapter.content.indexOf(evidence[0]?.quote || '')
  const preceding = records.filter(record => record.chapterId !== chapter.id
    || ((record.characterState?.after.evidence[0]?.startOffset ?? 0) <= sourceOffset))
  const current = getCharacterStateSnapshot(novel, preceding, chapter.chapterIndex, 'through')
  const id = 'character-state:' + candidate.id
  if (candidate.type === 'knowledge') {
    const fact = clean(value.fact), state = clean(value.state) as KnowledgeState, belief = clean(value.belief)
    if (!fact || !Object.prototype.hasOwnProperty.call(knowledgeStateLabels, state)) throw new Error('知情候选缺少命题或有效的知情状态')
    if (state === 'false_belief' && !belief) throw new Error('错误信念必须说明角色实际相信什么')
    const factId = 'proposition:' + candidate.id
    const subjectId = clean(value.subjectId), objectId = clean(value.objectId), scope = clean(value.scope)
    for (const ref of [subjectId, objectId].filter(Boolean)) {
      const entity = resolveCharacter(withCurrentStoryEntities(novel, chapter.chapterIndex + 1), ref, undefined)
      if (entity.firstAppearChapter > chapter.chapterIndex) throw new Error('命题主体/对象在来源章节尚未出现')
    }
    const proposition: StoryProposition = { version: 1, id: factId, text: fact, subjectId: subjectId || undefined, objectId: objectId || undefined,
      scope: scope || '范围未确认；本条独立保留', identityStatus: subjectId && scope ? 'explicit' : 'unresolved' }
    const after: MemoryKnowledgeEdge = { id, characterId: character.id, factId, fact, state, proposition, stateIdentityId: factId,
      belief: state === 'false_belief' ? belief : undefined, learnedFrom: clean(value.learnedFrom) || undefined,
      knownSinceChapter: chapter.chapterIndex, evidence }
    // Model-supplied factId/merge flags never enter this branch as authorization.
    const decision = confirmation.authorDecision
    if (decision && confirmation.mode === 'proposal') throw new Error('扫描候选不能携带作者命题身份授权')
    if (decision && (!decision.confirmed || !['new', 'link', 'merge'].includes(decision.action))) throw new Error('命题身份决定需要作者明确确认')
    if (decision && decision.action !== 'new') {
      if (!confirmation.confirmedAt) throw new Error('命题身份决定缺少作者确认时间')
      const catalog = getPropositionCatalog(novel, preceding, chapter.chapterIndex, 'through')
      const target = catalog.find(item => item.proposition.id === decision.targetId)
      const mergeFrom = catalog.find(item => item.proposition.id === decision.mergeFromId)
      if (!target || decision.targetSignature !== target.signature) throw new Error('所选命题已变化或在该证据之前尚未成立，请重新核对')
      if (decision.action === 'merge' && (!mergeFrom || mergeFrom.signature !== decision.mergeFromSignature
        || mergeFrom.canonicalId === target.canonicalId || !clean(decision.reason))) throw new Error('请明确选择两个不同命题并填写归并说明')
      after.propositionDecision = { version: 1, id: 'proposition-decision:' + candidate.id, action: decision.action,
        fromIds: [factId, ...(mergeFrom && decision.action === 'merge' ? [mergeFrom.proposition.id] : [])], targetId: target.proposition.id,
        targetSignature: target.signature, mergeFromSignature: decision.action === 'merge' ? mergeFrom?.signature : undefined, confirmedBy: 'author',
        confirmedAt: confirmation.confirmedAt, reason: clean(decision.reason), chapterId: chapter.id, chapterIndex: chapter.chapterIndex,
        sourceVersionId: evidence[0]?.sourceVersionId || '', evidence: evidence.map(ref => ({ ...ref })) }
      if (decision.resolvedStateIds?.length) {
        const roots = new Set([target.canonicalId, ...(decision.action === 'merge' && mergeFrom ? [mergeFrom.canonicalId] : [])])
        const states = current.knowledge.filter(item => item.characterId === character.id && roots.has(item.projectedFactId || item.factId))
        const selected = [...decision.resolvedStateIds].sort()
        if (!clean(decision.reason) || new Set(selected).size !== selected.length
          || JSON.stringify(selected) !== JSON.stringify(states.map(item => item.id).sort())
          || knowledgeResolutionSignature(states) !== decision.resolutionSignature) throw new Error('待处理的冲突认知已变化，请重新核对全部条目并填写处理说明')
        after.propositionDecision.resolvedStateIds = selected
        after.propositionDecision.resolutionSignature = decision.resolutionSignature
      }
      // A mere identity merge does not replace either existing attitude lane.
      if (decision.action === 'link') after.stateIdentityId = target.canonicalId
    }
    const prior = current.knowledge.find(item => item.characterId === character.id && (item.stateIdentityId || item.factId) === after.stateIdentityId)
    const priorRecord = prior ? records.find(record => record.characterState?.kind === 'knowledge' && record.characterState.after.id === prior.id) : undefined
    const before: MemoryKnowledgeEdge | undefined = priorRecord?.characterState?.kind === 'knowledge' ? JSON.parse(JSON.stringify(priorRecord.characterState.after)) : undefined
    if (before) { delete before.projectedFactId; delete before.conflictGroupId }
    return { change: { kind: 'knowledge', before, after },
      summary: character.name + '：' + knowledgeStateLabels[state] + '「' + (state === 'false_belief' ? belief : fact) + '」' }
  }
  const target = resolveCharacter(novel, value.targetCharacterId, value.targetCharacterName)
  if (target.id === character.id) throw new Error('人物关系的双方不能是同一角色')
  if (target.firstAppearChapter > chapter.chapterIndex) throw new Error('关系对象在来源章节尚未出现')
  const relation = clean(value.relation)
  if (!relation) throw new Error('关系候选缺少关系描述')
  const dimension = confirmation.mode === 'proposal' && !clean(value.dimension) ? 'unclassified' : assertRelationshipDimension(value.dimension)
  const after: MemoryRelationshipState = { id, characterId: character.id, targetCharacterId: target.id, dimension,
    relation, description: clean(value.description), sinceChapter: chapter.chapterIndex, evidence }
  return { change: { kind: 'relationship', before: current.relationships.find(item => relationshipIdentity(item.characterId, item.targetCharacterId, item.dimension) === relationshipIdentity(character.id, target.id, dimension)), after },
    summary: character.name + ' → ' + target.name + '｜' + relationshipDimensionLabel(dimension) + '：' + relation }
}

export function describeCharacterState(novel: Novel, change: CharacterStateChange): string {
  const name = (id: string) => novel.characters.find(item => item.id === id)?.name || '已删除角色'
  if (change.kind === 'knowledge') {
    const value = change.after as MemoryKnowledgeEdge
    return name(value.characterId) + '｜' + knowledgeStateLabels[value.state] + '｜命题：' + value.fact
      + (value.state === 'false_belief' ? '；角色误信：' + value.belief + '（不代表客观事实）' : '')
      + (value.learnedFrom ? '；获知途径：' + value.learnedFrom : '')
      + '；' + describeProposition(propositionOf(value))
      + (value.projectedFactId && value.projectedFactId !== value.factId ? '；当前等价身份：' + value.projectedFactId : '')
      + (value.conflictGroupId?.startsWith('["text"') ? '；同一角色另有文字相同、尚未确认是否同一命题的不同认知，待作者在候选核对中“明确引用已有命题”或改写范围后处理，不能选取一条冒充当前状态。'
        : value.conflictGroupId ? '；同一命题存在并列冲突认知，待作者处理，不能选取一条冒充一致状态。' : '')
      + (value.propositionDecision?.resolvedStateIds?.length ? '；作者明确以本条认知处理 ' + value.propositionDecision.resolvedStateIds.length + ' 条旧认知（历史与证据保留）' : '')
  }
  return name(change.after.characterId) + ' → ' + name(change.after.targetCharacterId) + '｜维度：' + relationshipDimensionLabel((change.after as MemoryRelationshipState).dimension) + '｜' + change.after.relation
    + (change.after.description ? '；' + change.after.description : '')
}

export function formatCharacterStateContext(novel: Novel, records: CanonMutationRecord[], chapterIndex: number, options: { targetCharacterIds?: string[]; query?: string; limit?: number } = {}): string {
  const snapshot = getCharacterStateSnapshot(novel, records, chapterIndex)
  const current = getCharacterStateSnapshot(novel, records, chapterIndex, 'through')
  const before = withCurrentStoryEntities(novel, chapterIndex)
  const through = withCurrentStoryEntities(novel, chapterIndex + 1)
  const source = (evidence: EvidenceRef[]) => evidence.map(item => (item.label || item.sourceId) + '：' + item.quote).join('；')
  const chapter = novel.chapters.find(item => item.chapterIndex === chapterIndex)
  const plans = (novel.chapterPlans || []).filter(plan => plan.targetChapterStart <= chapterIndex && plan.targetChapterEnd >= chapterIndex)
  const query = options.query || [chapter?.title, chapter?.content, ...plans.map(plan => plan.objective + ' ' + plan.summary)].filter(Boolean).join(' ')
  const targetIds = new Set(options.targetCharacterIds || through.characters.filter(character => [character.name, ...(character.aliases || [])].some(name => name && query.includes(name))).map(character => character.id))
  const row = (change: CharacterStateChange, text: string) => {
    const people = [change.after.characterId, ...(change.kind === 'relationship' ? [change.after.targetCharacterId] : [(change.after as MemoryKnowledgeEdge).proposition?.subjectId, (change.after as MemoryKnowledgeEdge).proposition?.objectId])].filter((id): id is string => !!id)
    const tokens = text.split(/[\s；，、：｜]+/u).filter(token => token.length > 1 && token.length < 80)
    return { id: change.after.id, text, target: people.filter(id => targetIds.has(id)).length,
      relevance: tokens.filter(token => query.includes(token)).length,
      recent: change.kind === 'knowledge' ? change.after.knownSinceChapter : change.after.sinceChapter }
  }
  const rows = [
    ...snapshot.knowledge.map(after => row({ kind: 'knowledge', after }, '章初 ' + describeCharacterState(before, { kind: 'knowledge', after }) + '；证据：' + source(after.evidence))),
    ...snapshot.relationships.map(after => row({ kind: 'relationship', after }, '章初 ' + describeCharacterState(before, { kind: 'relationship', after }) + '；证据：' + source(after.evidence))),
    ...snapshot.invalid.map(item => row(item.record.characterState!, '待重新审核：' + item.issue + '；该状态未知，不能当作有效事实。')),
    ...current.knowledge.filter(after => after.knownSinceChapter === chapterIndex).map(after => row({ kind: 'knowledge', after }, '本章已确认变化（仅从引文处生效，不可提前）：' + describeCharacterState(through, { kind: 'knowledge', after }) + '；证据：' + source(after.evidence))),
    ...current.relationships.filter(after => after.sinceChapter === chapterIndex).map(after => row({ kind: 'relationship', after }, '本章已确认变化（仅从引文处生效，不可提前）：' + describeCharacterState(through, { kind: 'relationship', after }) + '；证据：' + source(after.evidence))),
    ...current.invalid.filter(item => item.record.chapterId === chapter?.id).map(item => row(item.record.characterState!, '本章变化待重新审核：' + item.issue + '；该状态未知，不能作为有效事实。')),
    ...current.propositionDecisions.filter(item => item.record.chapterId === chapter?.id).map(item => {
      const change = item.record.characterState!, decision = (change.after as MemoryKnowledgeEdge).propositionDecision!
      return row(change, (item.active ? '本章已确认变化（仅从引文处生效，不可提前）：' : '本章变化待重新审核：') + '作者命题身份决定 '
        + decision.fromIds.join('、') + ' → ' + decision.targetId + '；'
        + (item.active ? '从决定证据位置起有效；' + (decision.action === 'merge' ? '相反认知仍并列。' : '同一命题的较早认知在此之后由本条取代。') : '已停用：' + item.issue + '；恢复各自身份。')
        + '；作者说明：' + (decision.reason || '明确引用已有命题') + '；证据：' + source(decision.evidence))
    }),
    ...snapshot.propositionDecisions.filter(item => !item.active).map(item => row(item.record.characterState!, '命题归并已停用：' + item.issue + '；恢复原身份，历史仍保留。')),
  ].sort((a,b) => b.target - a.target || b.relevance - a.relevance || b.recent - a.recent || a.id.localeCompare(b.id))
  if (!rows.length) return ''
  const selected: string[] = []
  const header = ['角色知情与关系（作者已确认）：',
    '未记录表示未知，不能推断角色不知情。怀疑/错误信念不是客观事实；单向关系及不同维度不能互推。归并身份不消除冲突认知。核查获知途径与正文顺序。']
  const limit = Math.max(0, options.limit ?? 6000)
  const footer = (count: number) => '省略 ' + count + ' 条完整状态；资料不全时应说明未知，不得臆断。'
  let length = header.join('\n').length + footer(rows.length).length + 1
  if (length > limit) {
    const omitted = '人物状态省略 ' + rows.length + ' 条（预算不足，知情状态未知）。'
    return omitted.length <= limit ? omitted : ''
  }
  for (const row of rows) {
    if (length + row.text.length + 1 > limit) continue
    selected.push(row.text); length += row.text.length + 1
  }
  return [...header,
    ...selected, footer(rows.length - selected.length),
  ].filter(Boolean).join('\n')
}

export function formatCharacterAnalysisReferences(novel: Novel, beforeChapterIndex?: number): string {
  novel = withCurrentStoryEntities(novel, beforeChapterIndex)
  return (novel.characters || []).map(character => 'ID(' + character.id + ') ' + character.name
    + (character.aliases?.length ? '；别名：' + character.aliases.join('、') : '')).join('\n')
}
