/**
 * Deterministic runner for docs/reconstruction-v2-longform-eval-plan.md.
 * It scores the memory projections, retrieval and context assembly; it never calls a model.
 * The question/review banks and scoring functions are reused by the stage-B real-model run.
 */
import type { MemoryKnowledgeEdge } from '@/types/characterMemory'
import type { StoryAggregate } from '@/services/storyAggregate'
import { buildLongformFixture, cloneLongformFixture, CAST, K1B_REWRITE, PLANTS, type LongformFixture, type LongformScale } from './longformEvalFixture'
import { getCharacterStateHistory, getCharacterStateSnapshot, formatCharacterStateContext } from '@/services/reconstructionCharacterState'
import { getRelationshipProjection } from '@/services/relationshipProjection'
import { buildSemanticRecords, retrieveSemanticEvidence } from '@/services/semanticIndex'
import { projectEventCausality, formatEventCausalityContext } from '@/services/eventCausality'
import { buildSemanticMemoryGraph, expandSemanticMemoryGraph } from '@/services/semanticMemoryGraph'
import { buildReviewContext, buildWritingContext } from '@/services/context'
import { buildReviewContextVersion } from '@/services/reconstructionReviewVersion'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from '@/services/reconstructionCandidates'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import { captureChapterDeletionBaseline, deleteChaptersWithImpact } from '@/services/chapterDeletionTransactions'
import { scanContinuity } from '@/services/continuity'

export type CheckGate = 'hard' | 'quality' | 'report'
export interface LongformCheck { id: string; category: string; gate: CheckGate; pass: boolean; expected: string; actual: string }
export interface LongformReport { scale: LongformScale; chapters: number; characters: number; canonRecords: number; durationMs: number; checks: LongformCheck[] }

const IN_CHAPTER_MARKERS = ['本章已确认变化（仅从引文处生效，不可提前）', '本章变化待重新审核']
const causalPath = (path: import('@/services/semanticIndex').SemanticEvidence['path']): boolean => !!path?.length && path.every(hop => hop.type.startsWith('event_'))
const norm = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')
const plant = (key: string) => PLANTS.find(item => item.key === key)!

function knowledgeOf(fixture: LongformFixture, chapterIndex: number, characterId: string, fact: string, boundary: 'before' | 'through' = 'before') {
  return getCharacterStateSnapshot(fixture.novel, fixture.records, chapterIndex, boundary).knowledge
    .filter(state => state.characterId === characterId && norm(state.fact) === norm(fact))
}
function describeStates(states: MemoryKnowledgeEdge[]): string {
  return states.length ? states.map(state => state.state + (state.conflictGroupId ? '[冲突]' : '')).sort().join('、') : '（无）'
}
function contextText(fixture: LongformFixture, chapterIndex: number) {
  const chapter = fixture.novel.chapters[chapterIndex]
  const writing = buildWritingContext(fixture.novel, chapter, undefined, undefined, fixture.records, [], [])
  const review = buildReviewContext(fixture.novel, chapter, chapter.content, undefined, undefined, undefined, fixture.records, [], [])
  const { chapterContent: _body, ...reviewFields } = review
  return { writing, review, fields: [...Object.entries(writing), ...Object.entries(reviewFields).map(([key, value]) => ['review.' + key, value] as const)]
    .filter(([, value]) => typeof value === 'string') as Array<[string, string]> }
}

function k1Checks(fixture: LongformFixture, checks: LongformCheck[]) {
  const fact = plant('k1a').payload!.fact as string, at = fixture.chapterOf
  const points: Array<[string, number, 'before' | 'through', string]> = [
    ['K1.before-k1a', at.k1a, 'before', '（无）'], ['K1.before-k1b', at.k1b, 'before', 'false_belief'],
    ['K1.before-k1c', at.k1c, 'before', 'suspects'], ['K1.end', fixture.novel.chapters.length - 1, 'through', 'knows'],
  ]
  for (const [id, chapter, boundary, expected] of points) {
    const actual = describeStates(knowledgeOf(fixture, chapter, CAST.shenYan, fact, boundary))
    checks.push({ id, category: 'K1', gate: 'hard', pass: actual === expected, expected, actual })
  }
}

function k1UnlinkedChecks(unlinked: LongformFixture, checks: LongformCheck[]) {
  const fact = plant('k1a').payload!.fact as string, at = unlinked.chapterOf
  for (const [id, chapter, boundary] of [['K1-u.before-k1c', at.k1c, 'before'], ['K1-u.end', unlinked.novel.chapters.length - 1, 'through']] as const) {
    const states = knowledgeOf(unlinked, chapter, CAST.shenYan, fact, boundary)
    const distinct = new Set(states.map(state => state.state)).size
    const unmarked = distinct > 1 ? states.filter(state => !state.conflictGroupId).length : 0
    const context = formatCharacterStateContext(unlinked.novel, unlinked.records, chapter)
    checks.push({ id, category: 'K1-u', gate: 'hard', pass: unmarked === 0,
      expected: '同文字的不同认知全部带冲突标记，或只剩一条', actual: describeStates(states) + '；无标记并列 ' + unmarked + ' 条；上下文含冲突说明=' + context.includes('冲突') })
  }
}

function k2Checks(fixture: LongformFixture, checks: LongformCheck[]) {
  const fact = plant('k2a').payload!.fact as string, end = fixture.novel.chapters.length - 1
  const bai = describeStates(knowledgeOf(fixture, end, CAST.baiLu, fact, 'through'))
  const shen = describeStates(knowledgeOf(fixture, end, CAST.shenYan, fact, 'through'))
  checks.push({ id: 'K2.independent', category: 'K2', gate: 'hard', pass: bai === 'does_not_know' && shen === 'suspects',
    expected: '白鹭 does_not_know；沈砚 suspects（互不覆盖、无冲突标记）', actual: '白鹭 ' + bai + '；沈砚 ' + shen })
  const beforeShen = describeStates(knowledgeOf(fixture, fixture.chapterOf.k2b, CAST.shenYan, fact, 'before'))
  checks.push({ id: 'K2.before-k2b', category: 'K2', gate: 'hard', pass: beforeShen === '（无）', expected: '沈砚（无）', actual: '沈砚 ' + beforeShen })
}

function relationLine(fixture: LongformFixture, chapter: number, boundary: 'before' | 'through') {
  return getCharacterStateSnapshot(fixture.novel, fixture.records, chapter, boundary).relationships
    .map(edge => edge.characterId + '>' + edge.targetCharacterId + ':' + edge.dimension + '=' + edge.relation).sort()
}
function r1Checks(fixture: LongformFixture, checks: LongformCheck[]) {
  const s = CAST.shenYan, g = CAST.guTinglan, end = fixture.novel.chapters.length - 1
  const before = relationLine(fixture, fixture.chapterOf.r1c, 'before')
  const expectedBefore = [g + '>' + s + ':allegiance=暗中护持', s + '>' + g + ':trust=戒备'].sort()
  checks.push({ id: 'R1.before-r1c', category: 'R1', gate: 'hard', pass: JSON.stringify(before) === JSON.stringify(expectedBefore), expected: expectedBefore.join('；'), actual: before.join('；') })
  const after = relationLine(fixture, end, 'through')
  const expectedAfter = [g + '>' + s + ':allegiance=暗中护持', s + '>' + g + ':trust=信任'].sort()
  checks.push({ id: 'R1.end', category: 'R1', gate: 'hard', pass: JSON.stringify(after) === JSON.stringify(expectedAfter), expected: expectedAfter.join('；'), actual: after.join('；') })
  const projection = getRelationshipProjection(fixture.novel, fixture.records, end, 'through').edges
    .map(edge => edge.source.id + '>' + edge.target.id + ':' + edge.dimension + '=' + edge.relation).sort()
  checks.push({ id: 'R1.projection-no-reverse', category: 'R1', gate: 'hard', pass: JSON.stringify(projection) === JSON.stringify(expectedAfter),
    expected: '关系投影与认知快照一致，无反推边', actual: projection.join('；') })
}

function n1Check(fixture: LongformFixture, checks: LongformCheck[]) {
  const copy = cloneLongformFixture(fixture)
  const chapter = copy.novel.chapters[copy.chapterOf.n1]
  const [candidate] = buildChapterAnalysisCandidates(copy.novel, chapter, buildAnalysisSourceVersionId(chapter.content), { knowledgeChanges: [{
    characterName: '顾先生', fact: '茶楼有人来过', state: 'knows', evidence: plant('n1').sentence }] })
  let actual = '已写入 Canon'
  try { applyCandidateChangeToCanon(copy.novel, acceptCandidateChange(candidate, '2026-11-02T00:00:00.000Z'), '2026-11-02T00:00:00.000Z', copy.records) }
  catch (error) { actual = '拒绝：' + (error instanceof Error ? error.message : String(error)) }
  checks.push({ id: 'N1.ambiguous-alias', category: 'N1', gate: 'hard', pass: actual.includes('歧义'), expected: '拒绝（同名歧义）', actual })
}

const RECALL = [
  { id: 'F1', plant: 'f1', payoff: 'f1p', query: '那把刻有鹤纹的铜钥匙最初是在什么情况下丢失的' },
  { id: 'F2', plant: 'f2', payoff: 'f2p', query: '潮音石在什么时候才会发出鸣响' },
  { id: 'F3', plant: 'f3', payoff: 'f3p', query: '白鹭手腕上的旧疤是怎么来的' },
]
function recallChecks(fixture: LongformFixture, checks: LongformCheck[]) {
  for (const item of RECALL) {
    const sentence = plant(item.plant).sentence
    const records = buildSemanticRecords(fixture.novel, [], fixture.chapterOf[item.payoff], [], fixture.records)
    const top = retrieveSemanticEvidence(item.query, records, 5, 0, { beforeChapterIndex: fixture.chapterOf[item.payoff] })
    const rank = top.findIndex(result => result.content.includes(sentence))
    checks.push({ id: item.id + '.recall@5', category: 'F', gate: 'quality', pass: rank >= 0, expected: '埋设原句进入前 5',
      actual: rank >= 0 ? '第 ' + (rank + 1) + ' 位' : '未进入；前 5：' + top.map(result => result.title).join(' | ') })
    const early = buildSemanticRecords(fixture.novel, [], fixture.chapterOf[item.plant], [], fixture.records)
    const leaked = retrieveSemanticEvidence(item.query, early, 8, 0, { beforeChapterIndex: fixture.chapterOf[item.plant] })
      .filter(result => plant(item.plant).needles.some(needle => (result.title + result.content).includes(needle)))
    checks.push({ id: item.id + '.isolation', category: 'F-iso', gate: 'hard', pass: leaked.length === 0, expected: '0 条泄漏', actual: leaked.length + ' 条' })
  }
}

function causalityChecks(fixture: LongformFixture, checks: LongformCheck[]) {
  const end = fixture.novel.chapters.length - 1, ids = fixture.eventIdOf
  const records = buildSemanticRecords(fixture.novel, [], end, [], fixture.records)
  const graph = buildSemanticMemoryGraph(records, end)
  const rootRecordId = fixture.eventIdOf.e1
  const rootRecord = records.find(record => record.sourceType === 'event' && record.sourceId === rootRecordId)
  const targetRecord = records.find(record => record.sourceType === 'event' && record.sourceId === fixture.eventIdOf.e4)
  const reverse = targetRecord ? expandSemanticMemoryGraph(graph, [targetRecord.id], 4, 64).find(item => item.recordId === rootRecord?.id) : undefined
  const rootEvidence = retrieveSemanticEvidence('知府为什么会被罢官，追根溯源最初是哪件事引起的', records, 8, 0, { beforeChapterIndex: end })
  const root = rootEvidence.findIndex(result => result.sourceId === rootRecordId || result.content.includes(plant('e1').sentence)
    || (result.metadata?.stateKind === 'event_causality' && result.metadata.fromEventId === rootRecordId))
  checks.push({ id: 'M1.root@8', category: 'M1', gate: 'quality', pass: root >= 0, expected: '根事件“南城盐仓失火”进入查询前 8（直接命中或图扩展）',
    actual: root >= 0 ? '检索结果第 ' + (root + 1) + ' 位' : reverse ? '知府罢官 → 盐仓失火，路径 ' + reverse.path.map(hop => hop.type).join(' → ') : '未召回；前 8：' + rootEvidence.map(result => result.title).join(' | ') })
  const trace = rootEvidence.find(result => causalPath(result.path))
  checks.push({ id: 'M1.trace-path', category: 'M1', gate: 'quality', pass: !!reverse && reverse.path.length >= 3
    && reverse.path.some(hop => hop.type === 'event_cause_trace' && hop.from === targetRecord?.id)
    && reverse.path.some(hop => hop.to === rootRecord?.id), expected: '从知府罢官命题经多跳因果边回溯至盐仓失火，路径方向标签不冒充反向事实',
    actual: reverse ? reverse.path.map(hop => hop.type + ':' + hop.label).join(' → ') : '目标事件无法回溯到根事件；检索路径=' + (trace?.path?.map(hop => hop.type).join(' → ') || '无') })
  const context = formatEventCausalityContext(fixture.novel, fixture.records, end)
  const chain = [['e1', 'e2', '导致'], ['e2', 'e3', '动机'], ['e3', 'e4', '导致']] as const
  const missing = chain.filter(([from, to, label]) => !context.split('\n').some(line => line.includes('[' + ids[from] + '] —' + label) && line.includes('→ ') && line.includes('[' + ids[to] + ']')))
  checks.push({ id: 'M1.context-chain', category: 'M1', gate: 'quality', pass: missing.length === 0, expected: '三条边按方向列出', actual: missing.length ? '缺少 ' + missing.map(item => item.join('→')).join('、') : '完整' })
  const atE4 = projectEventCausality(fixture.novel, fixture.records, fixture.chapterOf.e4).edges.map(edge => edge.recordId)
  const confirmed = ['c12', 'c23', 'c34', 'cd12', 'cd23'].filter(key => fixture.recordIdOf[key])
  const expectedAtE4 = confirmed.filter(key => fixture.chapterOf[key] < fixture.chapterOf.e4).map(key => fixture.recordIdOf[key])
  const outside = atE4.filter(id => !expectedAtE4.includes(id))
  checks.push({ id: 'M3.boundary', category: 'M3', gate: 'hard', pass: outside.length === 0 && expectedAtE4.every(id => atE4.includes(id)),
    expected: '第三条盐案边所在章之前：只含更早章节确认的 ' + expectedAtE4.length + ' 条边', actual: atE4.length + ' 条；越界 ' + outside.length })
  const cycle = fixture.expectedRejections.cloop || ''
  checks.push({ id: 'M2.cycle-rejected', category: 'M2', gate: 'hard', pass: cycle.includes('因果环') && !fixture.recordIdOf.cloop,
    expected: '拒绝（因果环），无记录', actual: cycle || '未拒绝' })
}

function sampleChapters(fixture: LongformFixture): number[] {
  const total = fixture.novel.chapters.length, step = fixture.scale === 'large' ? 10 : 3
  const set = new Set<number>()
  for (let index = 0; index < total; index += step) set.add(index)
  for (const index of Object.values(fixture.chapterOf)) { set.add(index); if (index + 1 < total) set.add(index + 1) }
  set.add(total - 1)
  return [...set].sort((a, b) => a - b)
}
function isolationChecks(fixture: LongformFixture, checks: LongformCheck[]) {
  const needles = PLANTS.flatMap(item => item.needles.map(text => ({ text, chapter: fixture.chapterOf[item.key], key: item.key })))
  const future: string[] = [], current: string[] = []
  for (const chapter of sampleChapters(fixture)) {
    const { fields } = contextText(fixture, chapter)
    for (const needle of needles) for (const [field, value] of fields) {
      if (!value.includes(needle.text)) continue
      if (needle.chapter > chapter) future.push('第' + (chapter + 1) + '章 ' + field + ' 含第' + (needle.chapter + 1) + '章「' + needle.text + '」')
      else if (needle.chapter === chapter && field !== 'lastParagraph') {
        const bad = value.split('\n').filter(line => line.includes(needle.text) && !IN_CHAPTER_MARKERS.some(marker => line.includes(marker)))
        if (bad.length) current.push('第' + (chapter + 1) + '章 ' + field + '「' + needle.text + '」：' + bad[0].slice(0, 80))
      }
    }
  }
  checks.push({ id: 'I1.future', category: 'I1', gate: 'hard', pass: future.length === 0, expected: '0 次', actual: future.length + ' 次' + (future.length ? '：' + future.slice(0, 5).join('；') : '') })
  checks.push({ id: 'I1.same-chapter-unmarked', category: 'I1', gate: 'hard', pass: current.length === 0, expected: '0 次', actual: current.length + ' 次' + (current.length ? '：' + current.slice(0, 5).join('；') : '') })
}

function reviewVersion(fixture: LongformFixture, chapter: number) {
  return buildReviewContextVersion(fixture.novel, fixture.novel.chapters[chapter], [], undefined, fixture.records, [])
}
function e1Checks(fixture: LongformFixture, checks: LongformCheck[]) {
  const edited = cloneLongformFixture(fixture), at = edited.chapterOf.k1b, chapter = edited.novel.chapters[at]
  const original = plant('k1b').sentence
  chapter.content = chapter.content.replace(original, K1B_REWRITE)
  const sameLength = chapter.content.length === fixture.novel.chapters[at].content.length
  const history = getCharacterStateHistory(edited.novel, edited.records, edited.novel.chapters.length - 1)
  const stage2 = history.find(item => item.record.id === edited.recordIdOf.k1b)
  checks.push({ id: 'E1.record-invalid', category: 'E1', gate: 'hard', pass: sameLength && !!stage2?.issue, expected: '等长改写后第二阶段记录失效', actual: '等长=' + sameLength + '；' + (stage2?.issue || '仍有效') })
  const fact = plant('k1a').payload!.fact as string
  const between = describeStates(knowledgeOf(edited, edited.chapterOf.k1c, CAST.shenYan, fact, 'before'))
  checks.push({ id: 'E1.no-resurrection', category: 'E1', gate: 'hard', pass: between === '（无）', expected: '第三阶段前为（无），不复活 false_belief', actual: between })
  const later = describeStates(knowledgeOf(edited, edited.novel.chapters.length - 1, CAST.shenYan, fact, 'through'))
  checks.push({ id: 'E1.later-stage', category: 'E1', gate: 'report', pass: later === 'knows', expected: 'knows（第三阶段独立来源仍有效）', actual: later })
  const earlier = Array.from({ length: at }, (_, index) => index).filter(index => reviewVersion(fixture, index) !== reviewVersion(edited, index))
  checks.push({ id: 'E1.earlier-signatures', category: 'E1', gate: 'hard', pass: earlier.length === 0, expected: '改写章之前 0 章签名变化', actual: earlier.length + ' 章' })
  const step = fixture.scale === 'large' ? 10 : 1
  let changed = 0, sampled = 0
  for (let index = at; index < fixture.novel.chapters.length; index += step) { sampled++; if (reviewVersion(fixture, index) !== reviewVersion(edited, index)) changed++ }
  checks.push({ id: 'E1.later-signatures', category: 'E1', gate: 'report', pass: true, expected: '记录改写章及之后签名变化数', actual: changed + '/' + sampled + ' 章' })
}

function d1Checks(fixture: LongformFixture, checks: LongformCheck[]) {
  const removed = cloneLongformFixture(fixture), at = removed.chapterOf.k1b
  const removedId = removed.novel.chapters[at].id
  removed.novel.chapters = removed.novel.chapters.filter(chapter => chapter.id !== removedId)
  const history = getCharacterStateHistory(removed.novel, removed.records, fixture.novel.chapters.length)
  const fromRemoved = history.filter(item => item.record.chapterId === removedId)
  const others = history.filter(item => item.record.chapterId !== removedId)
  checks.push({ id: 'D1.removed-source-inactive', category: 'D1', gate: 'hard', pass: fromRemoved.length > 0 && fromRemoved.every(item => !!item.issue),
    expected: '被删章派生记录 100% 失效', actual: fromRemoved.filter(item => item.issue).length + '/' + fromRemoved.length })
  checks.push({ id: 'D1.other-retention', category: 'D1', gate: 'report', pass: true, expected: '记录其他人物记录保留率', actual: others.filter(item => !item.issue).length + '/' + others.length })
  const edges = (fx: LongformFixture) => projectEventCausality(fx.novel, fx.records).edges.length
  checks.push({ id: 'D1.causality-retention', category: 'D1', gate: 'report', pass: true, expected: '记录因果边保留数（删章改变章节顺序快照）', actual: edges(removed) + '/' + edges(fixture) })
}

function d2Checks(fixture: LongformFixture, checks: LongformCheck[]) {
  const copy = cloneLongformFixture(fixture), chapterId = copy.novel.chapters[copy.chapterOf.k1b].id
  const aggregate = { novel: copy.novel, workspace: { candidates: copy.candidates, reviewFindings: [], chapterReviews: [], aiRuns: [],
    canonMutations: copy.records, impactReports: [] } } as unknown as StoryAggregate
  let actual: string
  try {
    deleteChaptersWithImpact(aggregate, chapterId, captureChapterDeletionBaseline(copy.novel, chapterId), '2026-11-02T00:00:00.000Z', () => 'lf-delete')
    const history = getCharacterStateHistory(copy.novel, copy.records, copy.novel.chapters.length)
    const removed = history.filter(item => item.record.chapterId === chapterId)
    actual = '删除成功；被删章记录失效 ' + removed.filter(item => item.issue).length + '/' + removed.length + '；其他记录失效 ' + history.filter(item => item.record.chapterId !== chapterId && item.issue).length
  } catch (error) { actual = '被拒绝：' + (error instanceof Error ? error.message : String(error)).slice(0, 160) }
  checks.push({ id: 'D2.product-delete', category: 'D2', gate: 'report', pass: true, expected: '记录产品删章入口实际结果', actual })
}

function s1Check(fixture: LongformFixture, checks: LongformCheck[]) {
  const copy = cloneLongformFixture(fixture)
  copy.novel.characters.find(item => item.id === CAST.guTinglan)!.avatarColor = '#123456'
  const changed = sampleChapters(fixture).filter(index => reviewVersion(fixture, index) !== reviewVersion(copy, index))
  checks.push({ id: 'S1.non-review-field', category: 'S1', gate: 'hard', pass: changed.length === 0, expected: '0 章审核输入变化', actual: changed.length + ' 章' })
}

export interface LongformQuestion {
  id: string; category: string; chapter: (fixture: LongformFixture) => number; question: string
  /** Every inner group needs at least one term in the answer. */
  answerRequires: string[][]; answerForbids: string[]
  /** Context checks: forbidden terms must not appear outside in-chapter markers; required terms are reported. */
  contextForbids: string[]; contextShould: string[]
}
const endChapter = (fixture: LongformFixture) => fixture.novel.chapters.length - 1
export const LONGFORM_QUESTIONS: LongformQuestion[] = [
  { id: 'Q1', category: 'K1', chapter: f => f.chapterOf.k1b, question: '本章开始时，沈砚认为父亲沈伯衡是生是死？依据是什么？',
    answerRequires: [['已死', '死了', '葬身', '去世']], answerForbids: ['亲笔信'], contextForbids: ['亲笔信', '旧码头的笔迹'], contextShould: ['葬身洪水'] },
  { id: 'Q2', category: 'K1', chapter: f => f.chapterOf.k1c, question: '本章开始时，沈砚对父亲是否在世是什么态度？',
    answerRequires: [['怀疑', '不确定', '猜测']], answerForbids: ['亲笔信'], contextForbids: ['白鹭转交的父亲亲笔信'], contextShould: ['怀疑'] },
  { id: 'Q3', category: 'K1', chapter: endChapter, question: '沈砚现在是否确知父亲在世？他是怎么知道的？',
    answerRequires: [['知道', '确知', '确认', '已知'], ['信', '亲笔']], answerForbids: [], contextForbids: [], contextShould: ['白鹭转交的父亲亲笔信'] },
  { id: 'Q4', category: 'K2', chapter: endChapter, question: '白鹭是否知道顾听澜的真实身份？',
    answerRequires: [['不知道', '不知情', '并不知道', '不清楚']], answerForbids: ['白鹭怀疑'], contextForbids: [], contextShould: ['明确不知情'] },
  { id: 'Q5', category: 'K2', chapter: endChapter, question: '沈砚如何看待顾听澜的身份？',
    answerRequires: [['怀疑', '猜测'], ['镇海司', '密探']], answerForbids: ['确知顾听澜是密探'], contextForbids: [], contextShould: ['镇海司'] },
  { id: 'Q6', category: 'R1', chapter: f => f.chapterOf.r1c, question: '本章开始时，沈砚和顾听澜彼此是什么态度？',
    answerRequires: [['戒备', '提防', '不信任'], ['护持', '保护', '挡下']], answerForbids: ['沈砚信任顾听澜'], contextForbids: ['雨夜同舟'], contextShould: ['戒备'] },
  { id: 'Q7', category: 'R1', chapter: endChapter, question: '沈砚现在是否信任顾听澜？',
    answerRequires: [['信任']], answerForbids: [], contextForbids: [], contextShould: ['信任'] },
  { id: 'Q8', category: 'M1', chapter: endChapter, question: '知府为什么被罢官？请按因果顺序说明。',
    answerRequires: [['盐仓'], ['盐价'], ['渔户', '围']], answerForbids: [], contextForbids: [], contextShould: ['南城盐仓失火', '城中盐价暴涨', '渔户围堵府衙'] },
  { id: 'Q9', category: 'M3', chapter: f => f.chapterOf.e4, question: '本章开始时，知府是否已经被罢官？',
    answerRequires: [['没有', '尚未', '还未', '未被']], answerForbids: ['已经被罢官'], contextForbids: ['渔户围府一事断送了知府的官职'], contextShould: [] },
  { id: 'Q10', category: 'F1', chapter: f => f.chapterOf.f1p, question: '鹤纹铜钥匙最初是在什么情况下丢失的？',
    answerRequires: [['祠堂'], ['失火', '火']], answerForbids: [], contextForbids: [], contextShould: ['鹤纹'] },
]

export const LONGFORM_QUESTION_FOLLOWUPS: LongformQuestion[] = [
  { id: 'Q9-r1', category: 'M3-abstention', chapter: f => f.chapterOf.e4,
    question: '根据本章开始前可用的已确认资料，能否确定知府已经被罢官？',
    answerRequires: [['无法确认', '不能确定', '没有足够依据', '未见已确认记录']], answerForbids: [],
    contextForbids: ['渔户围府一事断送了知府的官职', '朝廷以激起民变为由，下旨将知府即日罢官'],
    contextShould: ['渔户围堵府衙'] },
]

export function buildLongformQuestionContext(fixture: LongformFixture, question: LongformQuestion): string {
  // outlineContext is the composite the writing prompt sends (outline, characters, promises, structured state, recall).
  const { writing } = contextText(fixture, question.chapter(fixture))
  return [writing.outlineContext, writing.chapterGuidance, writing.previousSummary, writing.lastParagraph].filter(Boolean).join('\n\n')
}
export function scoreLongformAnswer(question: LongformQuestion, answer: string) {
  const missing = question.answerRequires.filter(group => !group.some(term => answer.includes(term)))
  const forbidden = question.answerForbids.filter(term => answer.includes(term))
  return { pass: !missing.length && !forbidden.length, missing, forbidden }
}
function questionChecks(fixture: LongformFixture, checks: LongformCheck[]) {
  for (const question of LONGFORM_QUESTIONS) {
    const context = buildLongformQuestionContext(fixture, question)
    const lines = context.split('\n').filter(line => !IN_CHAPTER_MARKERS.some(marker => line.includes(marker)))
    const leaked = question.contextForbids.filter(term => lines.some(line => line.includes(term)))
    checks.push({ id: question.id + '.context-forbids', category: 'Q', gate: 'hard', pass: leaked.length === 0, expected: '上下文不含禁止信息', actual: leaked.length ? '含 ' + leaked.join('、') : '无' })
    const absent = question.contextShould.filter(term => !context.includes(term))
    checks.push({ id: question.id + '.context-supplies', category: 'Q', gate: 'report', pass: true, expected: '记录上下文是否提供作答依据', actual: absent.length ? '缺 ' + absent.join('、') : '齐全' })
  }
}

export interface LongformReviewCase {
  id: string
  chapterKey: string
  baseline: string
  insert: string
  expected: 'knowledge' | 'relationship' | 'possession' | 'timeline' | 'none'
}

function neutralReviewBody(kind: 'accounting' | 'herbs'): string {
  const paragraphs = kind === 'accounting'
    ? [
      '天刚亮，沈砚先把窗扇推开一条缝，让河面吹来的湿气散进账房。昨夜收来的单据按铺面分成三摞，他没有急着落笔，而是先把每一摞的页脚对齐，检查有没有夹错的纸张。',
      '掌柜进门时带着一只旧算盘，顺口问起北街米行的回款。沈砚把已经核过的数字报了一遍，又把尚未拿到凭据的两笔单独圈出，说明今日要等脚夫送来收条才能记入总账。',
      '门外的挑夫把麻袋靠在檐下，等雨势小些再往后院搬货。沈砚听见动静，起身替他让开门槛，回身时顺手记下三袋粗盐和两袋麦子的入库次序，没有把口头报数当成最后凭据。',
      '上午的客人渐多，茶摊、布铺和船行轮流来问账。沈砚每接一张单子，便在边角写明来处和日期，问清楚是现钱、赊账还是以货相抵。有人催他先盖印，他只说等掌柜看过原件再办。',
      '午饭前，掌柜发现一笔旧账的墨色比旁边浅，疑心是抄录时漏了一行。沈砚把原册和副页并排摊开，沿着页码从头查到尾，最后找出那行字被折痕遮住的缘故，重新注明位置便收好册子。',
      '午后短暂放晴，巷口送来一篮新晒的鱼干。伙计们忙着过秤，沈砚站在旁边听清每一篮的重量，发现其中一篮少了半斤，便请送货人当面复称。对方补足差额后，他才在单子上写下实数。',
      '书肆掌柜来换零钱，顺便说起城西修桥的工钱。沈砚没有接着议论，只问对方是否带来了上月的收据。等收据从袖中取出，他才把两笔旧款合在一起核对，提醒掌柜还有一张未盖章的凭单。',
      '下午的风把柜台上的纸吹得四处乱动，沈砚用镇纸压住最上面一页，再按日期重新排序。每次翻页都留意纸背有没有新的批注，遇到看不清的字便另抄一份，留给明日向经手人确认。',
      '正要收起笔时，后院管事送来一只没有封口的木匣。匣中装着南街铺子的票据，最上面一张被水洇湿了半边。沈砚请管事在门口稍候，先把能辨认的日期与票号抄下，再摊开其余纸页，确认它们确实属于同一批货。',
      '那张湿票上的数字缺了一角，账房的副册却留有对应的提货记录。沈砚将两处信息放在一起，看出货物是昨天午后送到的，数目仍不能凭副册单独确定。他请伙计去找当时卸货的人，自己则查起仓门旁的过秤簿。',
      '过秤簿写得匆忙，一处横线与数字挤在一起。沈砚把它移到窗前，借着天光辨出另一个仓号，于是发现先前拿来的副册并不是那批货的最终记录。他用纸条标好两本册子的用途，避免后来的人把收货与转仓算成两次进货。',
      '伙计领着卸货的船工回来。船工记得木匣曾放在堤边避雨，却说不准少掉的那一角原来写着什么。沈砚请他只说明亲眼看见的经过，没有让他猜数字。船工把船靠岸的时辰和搬货的顺序说清后，便回到院里照看船绳。',
      '掌柜听完船工的说明，提议先按往常的数量入账，免得晚上交不出汇总。“货分了两处卸，旧数不能作准。”沈砚按住空白的一栏。他想到自己追查的旧案，越发不愿把猜测留作凭据。掌柜终于点头，允他将此笔列为待核，明早对照实存复称，今晚只交已经确认的账页。',
      '两人将木匣中的纸重新铺平，在每页背面写上发现时的状态。湿票另夹薄纸，免得墨迹沾到别的单据；完整的票按经手人归到原位。沈砚把自己的查验过程写在备忘页上，写明哪些是簿册记录，哪些只是船工的口述。',
      '院里渐渐安静下来，早先过秤的伙计也换下湿鞋。沈砚请他把两处仓门的钥匙交给掌柜，明早再按规矩领用。仓门与账房各有一套钥匙，账房仍由顾听澜开关门。伙计说南街那批货已单独垒在墙边，沈砚记下位置，没有据此补一个未经确认的重量。',
      '一位客人临关门前来结清布铺的旧款，手里带着两张折过的银票。沈砚当面点清金额，请客人核对收据上的姓名与日期，再把副联交给掌柜。他等客人走远才把这笔已结款写进当日汇总，和那笔待核货款分开列示。',
      '窗外渐有归船靠岸，潮水拍在石阶上，声音比白天更近。沈砚把不同铺面的页签按颜色放回盒内，免得明日一早查找时翻乱。他还在桌边留下一张简短说明，提醒接班的人先核南街货，再向送票的人确认破损票据。',
      '掌柜又回到账房，逐页看过沈砚交出的汇总。确认后的条目有凭单和经手人，待核的一笔则留着清楚的空格，没有被写成零，也没有混入已结栏。掌柜在末页签名，让沈砚把今日的记录妥善收好，明早再继续处理。',
      '沈砚等掌柜签完，才把桌上用过的草稿逐张翻过，找出仍需保存的查验笔记。写错的草稿当面撕掉，留下的则按票号夹进木匣。他将明日复称所需的两本册子放在同一侧，给封面各贴了不同的窄纸签。',
      '傍晚，河边的船娘捎来一则关于运费的口信。掌柜让沈砚先记在备忘页上，沈砚却把口信内容复述给她听，请她确认船名和日期。两人确认无误后，他才把这条消息夹进对应的货运账册。',
      '晚饭后，账房里只剩算盘珠子的轻响。沈砚把当天新增的页码写在目录上，发现有两笔账还缺对方签字，于是用红线标出，免得夜里整理时误认为已经结清。',
      '掌柜临走前问他为何还不收灯，沈砚说还有一摞单据要按街巷归档。掌柜没有催促，只把明早要问的几件事写在纸上。沈砚看完后逐项回应，把可以确认的先勾掉，留下需要查证的部分。',
      '夜深时，河面的潮声隔着墙传来，店里已经没有客人。沈砚把算盘、镇纸和印泥分别放回原处，又检查窗扇是否关好，才将整理好的账册放进木柜，给明日的工作留出一张干净的桌面。',
      '顾听澜拿着他保管的账房钥匙回来。沈砚把待核的票号念给他听，确认没有把口头消息写成定论，便吹灭灯芯。两人走到门外，顾听澜落锁，沈砚看清门已锁妥，才沿着熟悉的巷子回到住处。',
    ]
    : [
      '午后的雨刚停，白鹭把院门前的积水扫到石缝里，再将竹匾一只只搬到廊下。草药经过清水浸洗，叶面还留着细小的水珠，她先按品种分开，避免气味互相沾染。',
      '药铺伙计来取陈皮和薄荷，白鹭让他先看清匾上的标签，再按斤两装入纸包。伙计嫌其中一包略轻，她没有争辩，重新把药材倒在秤盘上，当着他的面补足分量。',
      '院外有小贩推车经过，车轮压过湿石板发出短促的声响。白鹭听见孩子咳嗽，便让伙计把一包温和的草药放到门边，说明只作备用，真正的药方仍要等大夫看过之后再取。',
      '风从河面吹来，廊下的竹帘来回摆动。白鹭用木夹固定住边角，逐一翻看叶片背面，把还未干透的部分移到通风处。她不急着收匾，只按干湿程度分成几处，免得外层已经脆了，内里仍带着潮气。',
      '邻院的妇人送来一小篮晒过的果皮，请她看看有没有霉点。白鹭把果皮摊开，指出两片颜色不对，建议先挑出丢掉。妇人问能不能混在一起煎，她摇头说药材的来路和状态都要分清。',
      '妇人走后，白鹭把剩下的果皮放到干净的竹筛上。竹筛底部有几根旧篾松了，她担心搬动时会漏下碎片，便从库房取来一只完好的筛子。她在旧筛边系上红绳，留给明日修补，不再用它承放药材。',
      '药铺后门传来敲门声，一位送货人推来装满根茎的木车。车轮沾着泥，白鹭请他把车停在石阶外，自己取了两只空筐接货。她先问明采收的地方与装车日期，再看筐底有没有积水，才请伙计按批次搬进院中。',
      '其中一筐的麻布角上留有潮印，摸上去比旁边的布更冷。白鹭掀开布角，发现靠近车底的几束根茎还带着湿泥。她没有把这几束混入已经晾干的旧货，而是在桌上铺纸，分别写明送货批次和需要检查的原因。',
      '送货人说路上遇到骤雨，木车在桥洞下等了半个时辰。白鹭请他照实写在收货条上，又告诉伙计暂不把这筐放进药柜。送货人怕耽误结算，她便请掌柜来核定价钱，自己只负责把药材的状态记录清楚。',
      '掌柜看过根茎，决定先收下外层干燥的一部分，其余放在通风处再看。白鹭按他的决定分出两筐，在筐柄系上不同颜色的布条。已收部分称量入册，待看的部分只写数量和来路，没有提前贴上可用的标签。',
      '伙计端来温水，劝她歇一会儿。“先把这一筐分清，我才放得下心。”白鹭喝了几口，望见云缝透出的光落在廊边，便请他卷高竹帘。她担心的不是今日少结几文钱，而是来路含混的药材混进旧货后，再也无人说得清。两人把根茎摆开，匾间留出空隙，免得底层再受潮。',
      '院门旁的石缝里长出几株野草，叶子在风里贴着地面。白鹭趁伙计去取新纸的空当，把野草拔起，扫净石阶上的泥，再用干布擦去木车留下的水痕。她做完才回到廊下，查看先前被雨淋湿的标签是否还能辨认。',
      '标签上有一行字被水冲得模糊，白鹭只认得采收地点，认不清数量。她从登记册找出同批货的原始记录，与送货条上的日期逐项对照，发现两边记的筐数相同。她仍没有重写模糊的数字，只在新标签上注明核对依据。',
      '隔壁的孩子来帮母亲送还借用的木夹，见院中排满竹匾，便好奇地问哪只匾里的叶子最香。白鹭让他站在门槛外，指给他看不同叶形，却没有请他随手触碰。孩子把木夹放在桌边，听完便跑回家吃晚饭。',
      '天色转暗前，白鹭查看每只匾下的阴影，挑出还需要通风的一角。她在小册子里记下今天新收的根茎和尚待处理的湿货，另在门边挂起一张提醒，免得夜里值守的人误把待看那筐搬进已经清点好的药柜。',
      '伙计将剩下的空筐摞到墙边，问那些潮湿的根茎明早要不要先称。白鹭说要等掌柜和送货人确认可用的部分，秤盘也得先擦干。她把今天写过的收货条与待看记录分开放好，又检查筐柄的布条仍系得牢靠，让夜里的人一眼就能认出两批货。',
      '忙完院里的事，她坐到门边听了一会儿雨后的水声。檐下没有再滴水，先前移开的旧竹筛却还靠在墙角。白鹭把它收进杂物间，在门旁留下一张修补便条，随后洗净手上的泥，才继续处理掌柜托付的旧方抄本。',
      '暮色渐深时，药铺掌柜来取一张旧方的抄本。白鹭翻出柜底的纸页，先核对日期和落款，再把抄本递给他。掌柜发现其中一味药名写得模糊，白鹭便照着原方重新抄录，没有凭印象补字。',
      '街上的叫卖声渐渐低下去，几个脚夫在墙根分拣刚送来的柴火。白鹭把已经干透的药材装入瓷罐，在罐口贴上日期和名称，又把剩下的碎叶另装一罐，留作平日熬煮，不和成药混放。',
      '夜色落下来时，院中只剩一盏小灯。白鹭检查竹匾上的水痕，把被檐水打湿的包药纸摊在高处晾着。纸面上的字已经看不全，她没有把它当成药方，只在旁边放了一张注明来源的空白纸。',
      '有人从巷口来问一包遗失的药材，伙计翻了收货条，请白鹭核对。她问清包纸的颜色和送达的时辰，没有把来历不明的湿货递出去。“今夜先查清单，明早请掌柜当面认领。”对方把自己的凭条留下，她将它夹到备查页，另把未认领的药材放在原处。',
      '雨后的石板路映着灯光，院墙外传来收摊的木轮声。白鹭把门边的水桶移到墙下，顺手把晾药用的夹子数了一遍。少了一只，她沿着廊下找回，擦干后挂在木钉上。',
      '掌柜临走时提醒明日要清点冬季常用药。白鹭把这句话写进小册子，按药柜顺序列出需要查看的几格。她没有凭记忆预先填写数量，只留下空格，准备明早逐罐称量。',
      '夜深后，白鹭把药铺今日的收支和药材去向分开记录。每一张纸都有对应的日期和经手人，尚未确认的来货只夹在备查页里。她合上册子，熄灭廊灯，将院门轻轻扣好。',
      '回到屋内，她把明日要用的竹匾叠在墙边，检查窗缝没有漏雨，才坐下来整理白天留下的标签。最后一张标签贴好时，院外已经听不见脚步声，她收起笔墨，安静地准备休息。',
    ]
  return paragraphs.join('\n\n')
}

export const LONGFORM_REVIEW_CASES: LongformReviewCase[] = [
  { id: 'V1', chapterKey: 'v1', baseline: '雨声渐密，沈砚在账簿旁找出一页旧码头的值夜名册。名册上的墨迹已经浅了，他把日期抄在纸边，准备等天亮后再去核对。\n\n顾听澜从门外经过，只问他是否要留灯。沈砚合上册子，将纸页压在砚台下。',
    insert: '沈砚把父亲的亲笔信收进怀里，逢人便说父亲早就脱险了。', expected: 'knowledge' },
  { id: 'V2', chapterKey: 'v2', baseline: '沈砚将账册摊在案上，顾听澜站在另一侧核对数字。两人各自记下疑点，谁也没有碰对方手边的东西。\n\n窗外更夫敲过一声，屋里仍亮着灯。核完最后一行，沈砚收起账册，顾听澜把自己的纸页留在桌角。',
    insert: '沈砚一见顾听澜便把账房的钥匙递了过去，说只信得过他。', expected: 'relationship' },
  { id: 'V3', chapterKey: 'v3', baseline: '柳昭把一只旧木匣放在桌上，核对封条后又收进柜中。沈砚站在门边报出清单上的编号，等她逐项点验。\n\n屋内只有纸页翻动声，直到最后一项也对上，两人才把清单收好。',
    insert: '沈砚随手把那把鹤纹铜钥匙挂回了自己的腰间。', expected: 'possession' },
  { id: 'V4', chapterKey: 'v4', baseline: '县衙门外的告示被雨水打湿，沈砚停下脚步，将落款和日期记在随身册页上。铺子里有人谈论新到的货船，却无人提起旧账。\n\n他在街角买了盏灯，随后沿河堤回到住处，打算把近日抄下的名册再核一遍。',
    insert: '距离盐仓失火已经过去整整十年，城里早没人记得这件事。', expected: 'timeline' },
  { id: 'V5', chapterKey: 'v5', baseline: neutralReviewBody('accounting'),
    insert: '沈砚在灯下把账本又核了一遍，没有发现新的差错。', expected: 'none' },
  { id: 'V6', chapterKey: 'v6', baseline: neutralReviewBody('herbs'),
    insert: '白鹭在廊下晾晒草药，顺手把竹匾翻了个面。', expected: 'none' },
]
export function buildLongformReviewCase(fixture: LongformFixture, reviewCase: LongformReviewCase) {
  const copy = cloneLongformFixture(fixture), chapter = copy.novel.chapters[copy.reviewCaseChapters[reviewCase.chapterKey]]
  const lines = reviewCase.baseline.split('\n')
  // The neutral accounting scene's original lamp sentence belongs after supper.
  // Contradiction cases retain their original midpoint insertion.
  const insertAt = reviewCase.id === 'V5' ? lines.findIndex(line => line.startsWith('掌柜临走前问他为何还不收灯')) : Math.floor(lines.length / 2)
  lines.splice(insertAt >= 0 ? insertAt : Math.floor(lines.length / 2), 0, reviewCase.insert)
  chapter.content = lines.join('\n')
  chapter.wordCount = chapter.content.length
  return { fixture: copy, chapter }
}
function reviewBankChecks(fixture: LongformFixture, checks: LongformCheck[]) {
  for (const reviewCase of LONGFORM_REVIEW_CASES) {
    const { fixture: copy, chapter } = buildLongformReviewCase(fixture, reviewCase)
    const alerts = scanContinuity(copy.novel, chapter, chapter.content)
    checks.push({ id: reviewCase.id + '.local-continuity', category: 'V', gate: 'report', pass: true,
      expected: '记录本地确定性检查命中（预期：' + reviewCase.expected + '）', actual: alerts.length + ' 条' + (alerts.length ? '：' + alerts.map(alert => alert.title).join('、') : '') })
  }
}

export function runLongformEvaluation(scale: LongformScale = 'default'): LongformReport {
  const started = Date.now()
  const fixture = buildLongformFixture(scale), unlinked = buildLongformFixture(scale, { linked: false })
  const checks: LongformCheck[] = []
  k1Checks(fixture, checks); k1UnlinkedChecks(unlinked, checks); k2Checks(fixture, checks); r1Checks(fixture, checks); n1Check(fixture, checks)
  recallChecks(fixture, checks); causalityChecks(fixture, checks); isolationChecks(fixture, checks)
  e1Checks(fixture, checks); d1Checks(fixture, checks); d2Checks(fixture, checks); s1Check(fixture, checks)
  questionChecks(fixture, checks); reviewBankChecks(fixture, checks)
  return { scale, chapters: fixture.novel.chapters.length, characters: fixture.totalCharacters, canonRecords: fixture.records.length, durationMs: Date.now() - started, checks }
}

export function formatLongformReport(report: LongformReport): string {
  const rows = report.checks.map(check => '| ' + check.id + ' | ' + check.gate + ' | ' + (check.gate === 'report' ? '记录' : check.pass ? '通过' : '**失败**')
    + ' | ' + check.expected.replace(/\|/g, '/') + ' | ' + check.actual.replace(/\|/g, '/').replace(/\n/g, ' ') + ' |')
  const failed = report.checks.filter(check => check.gate !== 'report' && !check.pass)
  return ['规模 ' + report.scale + '：' + report.chapters + ' 章，' + report.characters + ' 字符，' + report.canonRecords + ' 条 Canon 记录，耗时 ' + report.durationMs + ' ms。门槛失败 ' + failed.length + ' 项。',
    '', '| 检查 | 门槛 | 结果 | 标准答案 | 实际 |', '| --- | --- | --- | --- | --- |', ...rows].join('\n')
}

