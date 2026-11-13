<template>
  <Teleport defer to="#v3-crumb"><router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">典籍 · 故事记忆</span></Teleport>
  <div v-if="loading" class="codex-state">正在读取典籍…</div>
  <div v-else-if="error" class="codex-state error">{{ error }}</div>
  <div v-else-if="!novel" class="codex-state error">作品不存在。</div>
  <div v-else class="codex-page">
    <main class="codex-main">
      <header class="codex-head"><div><h1>典籍</h1><p>作者确认的知情与关系记录，按来源章节和原文证据投影。</p></div><div class="head-actions"><button v-if="selectedCharacter" class="m-btn sm detail-trigger" type="button" @click="detailOpen = true">人物详情</button><router-link class="m-btn sm" :to="{ path: '/plan/' + novel.id, query: { view: 'workbench', plannerTab: 'memory' } }"><V3Icon name="search" size="s" />检索典籍</router-link></div></header>
      <nav class="codex-tabs" aria-label="典籍视图"><button v-for="item in tabs" :key="item.id" type="button" :class="{ on: activeTab === item.id }" :aria-current="activeTab === item.id ? 'page' : undefined" @click="selectTab(item.id)">{{ item.label }}</button></nav>

      <section v-if="chapters.length" class="projection-control m-panel" aria-label="按章投影控制"><span class="muted">投影到</span><strong>第 {{ atIndex + 1 }} 章<span v-if="atIndex === lastChapterIndex"> · 当前</span></strong><input v-model.number="sliderPosition" type="range" min="0" :max="chapters.length - 1" step="1" :disabled="chapters.length < 2" aria-label="按章节投影" :aria-valuetext="'第' + (atIndex + 1) + '章 · ' + (currentChapter ? chapterTitleForDisplay(currentChapter.title, currentChapter.chapterIndex) : '')" /><select :value="atIndex" aria-label="投影章节" @change="selectChapter(Number(($event.target as HTMLSelectElement).value))"><option v-for="chapter in chapters" :key="chapter.id" :value="chapter.chapterIndex">第 {{ chapter.chapterIndex + 1 }} 章 · {{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex) }}</option></select></section>
      <p v-else class="projection-empty">尚未建立章节；人物资料不等于已确认的知情记录。</p>
      <p v-if="projectionIssues" class="projection-notice">{{ projectionIssues }} 处来源或命题身份待核对；不回退为旧状态，也不当作已知或不知情。</p>

      <section v-if="activeTab === 'knowledge'" aria-label="知情矩阵">
        <div v-if="characters.length && facts.length" ref="matrixWrap" class="matrix-wrap" :class="{ 'is-windowed': matrixVirtualized }" tabindex="0" aria-label="人物知情矩阵，可横向滚动" @scroll.passive="onMatrixScroll"><table class="matrix" :class="{ 'is-windowed': matrixVirtualized }" :aria-rowcount="characters.length + 1"><thead><tr><th scope="col">人物 \ 命题</th><th v-for="fact in facts" :key="fact.key" scope="col" :title="fact.key + '\n' + fact.scope">{{ fact.label }}<small>{{ fact.scope || '独立命题' }}</small></th></tr></thead><tbody><tr v-if="matrixWindow.start" class="matrix-window-spacer" aria-hidden="true"><td :colspan="facts.length + 1" :style="{ height: matrixWindow.start * matrixRowHeight + 'px' }" /></tr><tr v-for="row in visibleMatrixRows" :key="row.character.id" :aria-rowindex="row.index + 2"><th scope="row"><button type="button" class="matrix-person" @click="selectCharacter(row.character.id)"><CharacterAvatar :character="row.character" :size="34" /><span>{{ row.character.name }}</span></button></th><td v-for="item in row.cells" :key="item.fact.key"><button type="button" class="matrix-cell" :class="{ selected: selectedCharacter?.id === row.character.id && selectedFact?.key === item.fact.key }" :data-character-id="row.character.id" :data-fact-id="item.fact.key" :aria-pressed="selectedCharacter?.id === row.character.id && selectedFact?.key === item.fact.key" :aria-label="row.character.name + ' · ' + item.fact.label + ' · ' + item.cell.label" @click="selectCell(row.character.id, item.fact.key)"><span class="cell-state" :class="item.cell.tone"><i aria-hidden="true">{{ item.cell.symbol }}</i>{{ item.cell.label }}</span><span class="cell-source">{{ item.cell.since === undefined ? '不作额外推断' : '自第 ' + (item.cell.since! + 1) + ' 章' }}</span></button></td></tr><tr v-if="matrixWindow.end < characters.length" class="matrix-window-spacer" aria-hidden="true"><td :colspan="facts.length + 1" :style="{ height: (characters.length - matrixWindow.end) * matrixRowHeight + 'px' }" /></tr></tbody></table></div>
        <div v-else class="empty m-panel"><h2>{{ characters.length ? '尚无可投影的知情命题' : '尚无可投影的人物' }}</h2><p>这里只显示截至所选章的有效记录。“未记录”不代表人物不知情，未确认候选不会自动入典。</p><router-link class="m-btn sm" :to="'/characters/' + novel.id">管理人物资料</router-link></div>
        <div class="matrix-legend"><span v-for="state in knowledgeStates" :key="state" :class="state"><i aria-hidden="true">{{ stateSymbols[state] }}</i>{{ stateLabel(state) }}</span><span class="unrecorded">— 未记录</span><span>未确认候选不进入当前投影</span></div>
        <p v-if="pendingKnowledgeCount" class="pending-notice">{{ pendingKnowledgeCount }} 条知情候选尚未明确处理；请到来源章案头逐条核对。</p>
      </section>

      <section v-else-if="activeTab === 'characters'" class="codex-grid" aria-label="人物资料">
        <article v-for="character in characters" :key="character.id" class="character-card m-panel" :class="{ selected: selectedCharacter?.id === character.id }"><button class="character-select" type="button" :aria-pressed="selectedCharacter?.id === character.id" @click="selectCharacter(character.id)"><div class="character-card-head"><CharacterAvatar :character="character" :size="66" /><div><h2>{{ character.name }}</h2><p>{{ character.identity || '身份未记录' }}</p><div class="tags"><span>{{ character.status || '状态未记录' }}</span><span v-if="character.faction">{{ character.faction }}</span></div></div></div><p class="character-description">{{ character.description || '暂无人物简介。' }}</p></button><div v-if="characterTurningPoints(character.id).length" class="turning-points"><div class="turning-points-label">实际转折</div><div v-for="point in characterTurningPoints(character.id)" :key="point.arc.id + ':' + point.event.id" class="turning-point"><strong>{{ point.event.title }}</strong><span>第 {{ point.event.chapterIndex + 1 }} 章 · {{ point.arc.title }}</span><p v-if="point.event.description">{{ point.event.description }}</p></div></div><p v-else class="character-arc-empty">尚未记录实际转折。</p><router-link class="m-link" :to="characterLocation(character.id)">编辑人物</router-link></article>
        <div v-if="!characters.length" class="empty m-panel">截至所选章还没有可投影的人物资料。</div>
      </section>

      <section v-else-if="activeTab === 'relations'" aria-label="有向关系网">
        <template v-if="relations.edges.length"><div class="relation-scroll" tabindex="0" aria-label="人物关系图，可横向滚动"><div class="relation-graph" :style="{ minWidth: graphMinWidth + 'px' }"><svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="codex-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="var(--ink-3)" /></marker></defs><g v-for="edge in graphEdges" :key="edge.key"><path :d="edge.path" class="relationship-line" marker-end="url(#codex-arrow)" /><text :x="edge.labelX" :y="edge.labelY" text-anchor="middle" dominant-baseline="middle" class="relationship-label">{{ edge.relation }}</text></g></svg><button v-for="node in graphNodes" :key="node.character.id" type="button" class="relation-node" :class="{ selected: selectedCharacter?.id === node.character.id }" :style="{ left: node.x + '%', top: node.y + '%' }" :aria-label="'查看' + node.character.name + '的人物详情'" @click="selectCharacter(node.character.id)"><CharacterAvatar :character="node.character" :size="68" /><strong>{{ node.character.name }}</strong></button></div></div><p class="relation-legend">箭头表示方向：A → B 是 A 对 B 的关系，不代表反向关系；不同维度分别保留。</p><details class="relation-records"><summary>关系记录与来源 · {{ relations.edges.length }}</summary><article v-for="edge in relations.edges" :key="edge.source.id + ':' + edge.target.id + ':' + edge.dimension" class="relation-row"><div class="relation-source"><b>{{ edge.source.name }}</b><span>→</span><b>{{ edge.target.name }}</b></div><strong>{{ edge.relation || '关系未命名' }}</strong><small>{{ edge.dimensionLabel }} · {{ edge.origin === 'chapter' ? '正文确认' : '作者资料' }}</small><p v-if="edge.description">{{ edge.description }}</p><blockquote v-for="evidence in edge.evidence" :key="evidence.id">{{ evidence.quote }}<router-link v-if="evidenceLocation(evidence)" :to="evidenceLocation(evidence)!">查看来源原文</router-link></blockquote></article></details></template>
        <div v-else class="empty m-panel">截至所选章还没有有效关系记录。</div>
        <section v-if="relations.invalid.length" class="invalid-panel m-panel"><h2>需重新核对</h2><p>来源失效的关系不显示为有效边，也不回退成旧关系。</p><article v-for="item in relations.invalid" :key="item.record.id"><strong>{{ sourceChapterLabel(item.record.chapterId) }}</strong><p>{{ item.issue }}</p></article></section>
      </section>

      <section v-else-if="activeTab === 'timeline'" aria-label="故事时间线"><p class="timeline-explanation">左侧为已记录的故事时间，卡片按叙事章节排列；规划与来源待核对均不冒充已发生事实。</p><div class="story-timeline"><article v-for="event in timeline" :key="event.id" class="timeline-row" :class="{ planned: !isOccurredEvent(event), uncertain: event.status === 'unverified' }"><span class="timeline-when">{{ event.storyTime || '时间未记录' }}</span><div class="timeline-card m-panel"><div class="event-tags"><span>{{ event.chapterIndex < 0 ? '全书规划' : '第 ' + (event.chapterIndex + 1) + ' 章' }}</span><span>{{ event.status === 'unverified' ? '来源待核对' : isOccurredEvent(event) ? '发生记录' : '计划，非已发生' }}</span><span>{{ event.type }}</span></div><h2>{{ event.title }}</h2><p>{{ event.description || '未记录描述' }}</p><router-link class="m-link" :to="{ path: '/plan/' + novel.id, query: { view: 'workbench', plannerTab: 'timeline', plannerSelection: event.id } }">查看事件与来源</router-link></div></article></div><div v-if="!timeline.length" class="empty m-panel">截至所选章还没有有效事件或规划记录。</div></section>

      <section v-else class="resource-grid"><router-link class="resource-card m-panel" :to="'/inspiration/' + novel.id"><strong>灵感记录</strong><span>查看创建阶段保留的探索对话和灵感片段</span></router-link><router-link class="resource-card m-panel" :to="'/knowledge/' + novel.id"><strong>资料库</strong><span>管理本书挂载的知识库和资料来源</span></router-link><router-link class="resource-card m-panel" :to="'/data/' + novel.id"><strong>数据面板</strong><span>查看数值、装备、公式和按章变化</span></router-link><router-link class="resource-card m-panel" :to="{ path: '/plan/' + novel.id, query: { view: 'workbench', plannerTab: 'memory' } }"><strong>故事回顾</strong><span>打开项目记忆检索和全书、分卷、场景回顾</span></router-link></section>
      <footer class="codex-links"><router-link :to="'/characters/' + novel.id">管理人物</router-link><router-link :to="'/knowledge/' + novel.id">本书资料</router-link><router-link :to="'/data/' + novel.id">数据面板</router-link></footer>
    </main>

    <button v-if="detailOpen" class="detail-backdrop" type="button" aria-label="关闭人物详情" @click="detailOpen = false" />
    <aside class="codex-detail" :class="{ 'is-open': detailOpen }" aria-label="所选人物与认知详情" @keydown.esc="detailOpen = false">
      <div class="detail-mobile-head"><span>人物详情</span><button class="m-ibtn" type="button" aria-label="关闭人物详情" @click="detailOpen = false"><V3Icon name="x" size="s" /></button></div>
      <template v-if="selectedCharacter"><div class="detail-person"><CharacterAvatar :character="selectedCharacter" :size="68" /><div><div class="eyebrow">{{ selectedCharacter.identity || '身份未记录' }}</div><h2>{{ selectedCharacter.name }}</h2></div></div>
        <template v-if="selectedFact"><h3 class="detail-section-heading">关于</h3><p class="detail-proposition">「{{ selectedFact.label }}」</p><p v-if="selectedFact.scope" class="proposition-scope">{{ selectedFact.scope }}</p><span class="detail-state" :class="selectedCell.tone">{{ atIndex < 0 ? '当前' : '第 ' + (atIndex + 1) + ' 章时' }}：{{ selectedCell.label }}</span><section v-for="state in selectedCell.states" :key="state.id" class="current-knowledge"><p v-if="state.belief">角色实际相信：{{ state.belief }}<small>这是角色的信念，不代表客观事实。</small></p><p v-if="state.learnedFrom">获知途径：{{ state.learnedFrom }}</p><p v-if="state.conflictGroupId" class="conflict-notice">存在并列冲突或同文异义认知，不能任选一条当作一致状态。</p></section><p v-for="item in selectedCell.issues" :key="item.record.id" class="conflict-notice">{{ item.issue }}</p>
          <h3 class="detail-section-heading">认知变化</h3><div v-if="selectedHistory.length" class="knowledge-history"><article v-for="item in selectedHistory" :key="item.record.id" class="history-item" :class="{ invalid: item.issue }" :data-record-id="item.record.id"><div class="history-head">第 {{ item.state.knownSinceChapter + 1 }} 章<span v-if="item.issue" class="history-warning">来源待核对 · 仅历史</span></div><strong :class="item.issue ? 'unrecorded' : item.state.state">{{ stateSymbols[item.state.state] }} {{ stateLabel(item.state.state) }}</strong><p v-if="item.state.belief">角色误信：{{ item.state.belief }}</p><p v-if="item.state.learnedFrom">{{ item.state.learnedFrom }}</p><p v-if="item.issue" class="history-issue">{{ item.issue }}</p><blockquote v-for="evidence in item.state.evidence" :key="evidence.id">{{ evidence.quote }}<router-link v-if="!item.issue && evidenceLocation(evidence)" :to="evidenceLocation(evidence)!">查看来源原文</router-link></blockquote><p v-if="item.state.propositionDecision" class="identity-note">命题身份决定：{{ snapshot.propositionDecisions.find(decision => decision.record.id === item.record.id)?.active ? '作者已确认，当前有效' : '已停用，保留历史' }}</p></article></div><p v-else class="detail-empty">没有明确的认知记录；未记录不等于不知情。</p>
          <div class="isolation-note"><V3Icon name="lock" size="s" /><span>只展示截至所选章的已确认记录，不展示后续认知或未采纳候选；失效记录仅供核对。</span></div>
        </template>
        <template v-else><h3 class="detail-section-heading">人物资料</h3><p class="detail-description">{{ selectedCharacter.description || '暂无人物简介。' }}</p><p class="detail-empty">尚无可选择的知情命题，不推断人物知道或不知道。</p></template>
        <router-link class="m-link detail-edit" :to="characterLocation(selectedCharacter.id)">编辑人物资料</router-link>
      </template>
      <div v-else class="detail-empty">选择人物或矩阵单元格后，查看人物与认知来源。</div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { getCharacterStateProjection, knowledgeStateLabels } from '@/services/reconstructionCharacterState'
import { getRelationshipProjection } from '@/services/relationshipProjection'
import { projectCanonicalEntities } from '@/services/entityProvenance'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import CharacterAvatar from '@/components/CharacterAvatar.vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import type { EventLogEntry, StoryArc } from '@/types/novel'
import type { CanonMutationRecord, EvidenceRef, KnowledgeState } from '@/types/reconstruction'
import type { MemoryKnowledgeEdge } from '@/types/characterMemory'

defineOptions({ name: 'V3CodexView' })
type CodexTab = 'knowledge' | 'characters' | 'relations' | 'timeline' | 'resources'
type KnowledgeCell = { states: MemoryKnowledgeEdge[]; issues: Array<{ record: CanonMutationRecord; issue: string }>; label: string; tone: string; symbol: string; since?: number }
const route = useRoute(), router = useRouter(), novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const novel = computed(() => novels.getNovel(novelId.value))
const loading = ref(true), error = ref(''), activeTab = ref<CodexTab>('knowledge'), detailOpen = ref(false)
const selectedCharacterId = ref(''), selectedFactId = ref(''), projectionIndex = ref<number>()
const tabs: Array<{ id: CodexTab; label: string }> = [{ id: 'knowledge', label: '知情矩阵' }, { id: 'characters', label: '人物' }, { id: 'relations', label: '关系网' }, { id: 'timeline', label: '时间线' }, { id: 'resources', label: '资料与回顾' }]
const knowledgeStates: KnowledgeState[] = ['knows', 'suspects', 'does_not_know', 'false_belief']
const stateSymbols: Record<KnowledgeState, string> = { knows: '●', suspects: '◐', does_not_know: '○', false_belief: '×' }
const chapters = computed(() => [...(novel.value?.chapters || [])].sort((a, b) => a.chapterIndex - b.chapterIndex))
const lastChapterIndex = computed(() => chapters.value[chapters.value.length - 1]?.chapterIndex ?? -1)
const atIndex = computed(() => chapters.value.some(chapter => chapter.chapterIndex === projectionIndex.value) ? projectionIndex.value! : lastChapterIndex.value)
const currentChapter = computed(() => chapters.value.find(chapter => chapter.chapterIndex === atIndex.value))
const sliderPosition = computed({ get: () => Math.max(0, chapters.value.findIndex(chapter => chapter.chapterIndex === atIndex.value)), set: (position: number) => { const chapter = chapters.value[position]; if (chapter) selectChapter(chapter.chapterIndex) } })
// 服务按记录里保存的“起始章”纳入投影，不会核对来源章现在排在哪。来源章被移到后面后，
// 早于它当前位置的投影不能再展示这条记录，否则会泄漏后章的命题、认知和引文。
// 来源章已删除的记录保留，由服务标为“来源章节已删除”。
const records = computed(() => {
  const position = new Map(chapters.value.map(chapter => [chapter.id, chapter.chapterIndex]))
  return workspace.getCanonMutations(novelId.value).filter(record => {
    const at = record.chapterId === undefined ? undefined : position.get(record.chapterId)
    return at === undefined || at <= atIndex.value
  })
})
const memoryProjection = computed(() => novel.value ? getCharacterStateProjection(novel.value, records.value, atIndex.value, 'through') : undefined)
const snapshot = computed(() => memoryProjection.value?.snapshot || { knowledge: [], relationships: [], invalid: [], propositionDecisions: [] })
const stateHistory = computed(() => memoryProjection.value?.history || [])
const catalog = computed(() => memoryProjection.value?.catalog || [])
const canonicalIds = computed(() => new Map(catalog.value.map(item => [item.proposition.id, item.canonicalId])))
// 失效记录没有 projectedFactId，也不在命题目录里；它的 stateIdentityId 可能指向后来被归并的命题，
// 必须同样经目录规范化，否则同一命题会拆成“有效”与“失效”两列。
function factKey(state: MemoryKnowledgeEdge) {
  const identity = state.stateIdentityId
  return state.projectedFactId || canonicalIds.value.get(state.factId) || (identity && canonicalIds.value.get(identity)) || identity || state.factId
}
const canonicalEntities = computed(() => novel.value ? projectCanonicalEntities(novel.value, atIndex.value + 1) : { characters: [], events: [], arcs: [], issues: [] })
const characters = computed(() => canonicalEntities.value.characters.filter(character => !chapters.value.length || character.firstAppearChapter <= atIndex.value))
// 没有章节时不存在“第 -1 章”边界；省略边界才会保留作者填写的基础关系。
const relations = computed(() => novel.value ? getRelationshipProjection(novel.value, records.value, chapters.value.length ? atIndex.value : undefined, 'through') : { edges: [], invalid: [] })
const facts = computed(() => {
  const found = new Map<string, { key: string; label: string; scope: string }>()
  for (const entry of catalog.value) {
    if (!found.has(entry.canonicalId) || entry.proposition.id === entry.canonicalId) found.set(entry.canonicalId, { key: entry.canonicalId, label: entry.proposition.text, scope: entry.proposition.scope })
  }
  for (const state of [...snapshot.value.knowledge, ...snapshot.value.invalid.flatMap(item => item.record.characterState?.kind === 'knowledge' ? [item.record.characterState.after as MemoryKnowledgeEdge] : [])]) {
    const key = factKey(state)
    if (!found.has(key)) found.set(key, { key, label: state.fact, scope: state.proposition?.scope || '' })
  }
  return [...found.values()]
})
const emptyCell: KnowledgeCell = { states: [], issues: [], label: '未记录', tone: 'unrecorded', symbol: '—' }
const cells = computed(() => {
  const result = new Map<string, Map<string, KnowledgeCell>>()
  const ensure = (state: MemoryKnowledgeEdge) => {
    let characterCells = result.get(state.characterId)
    if (!characterCells) { characterCells = new Map(); result.set(state.characterId, characterCells) }
    const key = factKey(state)
    if (!characterCells.has(key)) characterCells.set(key, { states: [], issues: [], label: '', tone: '', symbol: '' })
    return characterCells.get(key)!
  }
  for (const state of snapshot.value.knowledge) ensure(state).states.push(state)
  for (const item of snapshot.value.invalid) if (item.record.characterState?.kind === 'knowledge') ensure(item.record.characterState.after).issues.push(item)
  for (const characterCells of result.values()) for (const cell of characterCells.values()) {
    const state = cell.states[0]
    if (cell.issues.length) { cell.label = '来源待核对'; cell.tone = 'unverified'; cell.symbol = '?' }
    // 只有服务标出的并列冲突才算待核对：同一命题经作者归并后，多条一致的认知仍是一致状态。
    else if (cell.states.some(item => item.conflictGroupId)) { cell.label = '认知待核对'; cell.tone = 'conflict'; cell.symbol = '!' }
    else if (state) { cell.label = stateLabel(state.state); cell.tone = state.state; cell.symbol = stateSymbols[state.state]; cell.since = Math.min(...cell.states.map(item => item.knownSinceChapter)) }
  }
  return result
})
function cellFor(characterId: string, factId: string) { return cells.value.get(characterId)?.get(factId) || emptyCell }
function stateLabel(state: KnowledgeState) { return state === 'knows' ? '知道' : state === 'false_belief' ? '误解' : knowledgeStateLabels[state] }
const selectedCharacter = computed(() => characters.value.find(character => character.id === selectedCharacterId.value) || characters.value[0])
const selectedFact = computed(() => facts.value.find(fact => fact.key === selectedFactId.value) || facts.value[0])
const selectedCell = computed(() => selectedCharacter.value && selectedFact.value ? cellFor(selectedCharacter.value.id, selectedFact.value.key) : emptyCell)
const selectedHistory = computed(() => stateHistory.value.flatMap(item => {
  const state = item.record.characterState?.kind === 'knowledge' ? item.record.characterState.after as MemoryKnowledgeEdge : undefined
  return state && state.characterId === selectedCharacter.value?.id && factKey(state) === selectedFact.value?.key ? [{ ...item, state }] : []
}))
const projectionIssues = computed(() => snapshot.value.invalid.length + snapshot.value.propositionDecisions.filter(item => !item.active).length + canonicalEntities.value.issues.filter(issue => issue.reason !== 'future_source').length)
const pendingKnowledgeCount = computed(() => workspace.getCandidates(novelId.value).filter(candidate => candidate.type === 'knowledge' && ['proposed', 'deferred'].includes(candidate.status)).length)
const matrixRowHeight = 58
const matrixOverscan = 4
const matrixCellWindowThreshold = 2400
const matrixWrap = ref<HTMLElement>()
const matrixScrollTop = ref(0)
const matrixVirtualized = computed(() => characters.value.length * facts.value.length > matrixCellWindowThreshold)
const matrixWindow = computed(() => {
  if (!matrixVirtualized.value) return { start: 0, end: characters.value.length }
  const viewportRows = Math.ceil((matrixWrap.value?.clientHeight || 520) / matrixRowHeight)
  const maxStart = Math.max(0, characters.value.length - viewportRows - matrixOverscan * 2)
  const start = Math.min(maxStart, Math.max(0, Math.floor(matrixScrollTop.value / matrixRowHeight) - matrixOverscan))
  return { start, end: Math.min(characters.value.length, start + viewportRows + matrixOverscan * 2) }
})
const visibleMatrixRows = computed(() => characters.value.slice(matrixWindow.value.start, matrixWindow.value.end).map((character, offset) => ({
  character,
  index: matrixWindow.value.start + offset,
  cells: facts.value.map(fact => ({ fact, cell: cellFor(character.id, fact.key) })),
})))
function onMatrixScroll(event: Event) { matrixScrollTop.value = (event.currentTarget as HTMLElement).scrollTop }
function scrollSelectedMatrixRowIntoView() {
  if (!matrixVirtualized.value || activeTab.value !== 'knowledge' || !selectedCharacterId.value || !matrixWrap.value) return
  const index = characters.value.findIndex(character => character.id === selectedCharacterId.value)
  if (index < 0) return
  const top = index * matrixRowHeight, bottom = top + matrixRowHeight, scrollTop = matrixWrap.value.scrollTop
  const viewportHeight = matrixWrap.value.clientHeight || 520
  if (top < scrollTop) matrixWrap.value.scrollTop = top
  else if (bottom > scrollTop + viewportHeight) matrixWrap.value.scrollTop = Math.max(0, bottom - viewportHeight)
  matrixScrollTop.value = matrixWrap.value.scrollTop
}
const timelineOrder = (event: EventLogEntry) => event.chapterIndex < 0 ? Number.MAX_SAFE_INTEGER : event.chapterIndex
const timeline = computed(() => canonicalEntities.value.events.filter(event => event.chapterIndex <= atIndex.value || event.chapterIndex < 0 || event.status === 'planted').sort((a, b) => timelineOrder(a) - timelineOrder(b) || a.title.localeCompare(b.title)))
// “已埋设”不等于“计划”：生效的 status 来自正文修订时，伏笔已经在正文里埋下；作者手填的才是计划。
function plantedInChapter(event: EventLogEntry) {
  const revisions = event.provenance?.revisions || []
  for (let index = revisions.length - 1; index >= 0; index--) {
    if (revisions[index].changes.some(change => change.field === 'status' && change.after === event.status)) return revisions[index].source.kind === 'chapter'
  }
  return false
}
function isOccurredEvent(event: EventLogEntry) {
  return event.chapterIndex >= 0 && event.chapterIndex <= atIndex.value && !!novel.value?.chapters.some(chapter => chapter.chapterIndex === event.chapterIndex && chapter.content.trim())
    && !['abandoned', 'unverified'].includes(event.status || '') && (event.status !== 'planted' || plantedInChapter(event))
}
function characterTurningPoints(characterId: string): Array<{ arc: StoryArc; event: EventLogEntry }> {
  const events = new Map(canonicalEntities.value.events.map(event => [event.id, event]))
  return canonicalEntities.value.arcs.filter(arc => arc.type === 'character' && arc.characterIds.includes(characterId)).flatMap(arc => (arc.turningPointEventIds || []).flatMap(id => { const event = events.get(id); return event && isOccurredEvent(event) ? [{ arc, event }] : [] })).sort((a, b) => a.event.chapterIndex - b.event.chapterIndex || a.event.title.localeCompare(b.event.title))
}
const graphMinWidth = computed(() => Math.max(600, characters.value.length * 80))
const graphNodes = computed(() => characters.value.map((character, index, list) => {
  const angle = -Math.PI / 2 + index * 2 * Math.PI / list.length
  return { character, x: list.length === 1 ? 50 : 50 + 35 * Math.cos(angle), y: list.length === 1 ? 50 : 50 + 34 * Math.sin(angle) }
}))
const graphEdges = computed(() => relations.value.edges.flatMap((edge, index) => {
  const from = graphNodes.value.find(node => node.character.id === edge.source.id), to = graphNodes.value.find(node => node.character.id === edge.target.id)
  if (!from || !to) return []
  const x1 = from.x * 10, y1 = from.y * 5.2, x2 = to.x * 10, y2 = to.y * 5.2, dx = x2 - x1, dy = y2 - y1, distance = Math.hypot(dx, dy)
  const peers = relations.value.edges.filter(item => item.source.id === edge.source.id && item.target.id === edge.target.id)
  const offset = (relations.value.edges.some(item => item.source.id === edge.target.id && item.target.id === edge.source.id) ? 28 : 0) + (peers.indexOf(edge) - (peers.length - 1) / 2) * 38
  const nx = -dy / distance * offset, ny = dx / distance * offset, cx = (x1 + x2) / 2 + nx, cy = (y1 + y2) / 2 + ny
  const startDistance = Math.hypot(cx - x1, cy - y1), endDistance = Math.hypot(x2 - cx, y2 - cy)
  const sx = x1 + (cx - x1) / startDistance * 48, sy = y1 + (cy - y1) / startDistance * 48, ex = x2 - (x2 - cx) / endDistance * 54, ey = y2 - (y2 - cy) / endDistance * 54
  return [{ ...edge, key: edge.source.id + ':' + edge.target.id + ':' + edge.dimension + ':' + index, path: `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`, labelX: (sx + 2 * cx + ex) / 4, labelY: (sy + 2 * cy + ey) / 4 }]
}))
function evidenceLocation(evidence: EvidenceRef) {
  const chapter = novel.value?.chapters.find(chapter => chapter.id === evidence.sourceId)
  if (!chapter || evidence.sourceType !== 'chapter' || evidence.sourceVersionId !== buildAnalysisSourceVersionId(chapter.content) || !evidence.quote) return undefined
  let start = evidence.startOffset
  if (start === undefined) { const at = chapter.content.indexOf(evidence.quote); if (at < 0 || at !== chapter.content.lastIndexOf(evidence.quote)) return undefined; start = at }
  const end = start + evidence.quote.length
  if (chapter.content.slice(start, end) !== evidence.quote) return undefined
  return { path: '/write/' + novelId.value + '/' + chapter.id, query: { evidenceVersion: evidence.sourceVersionId, evidenceStart: String(start), evidenceEnd: String(end) } }
}
function sourceChapterLabel(id?: string) { const chapter = chapters.value.find(chapter => chapter.id === id); return chapter ? '第 ' + (chapter.chapterIndex + 1) + ' 章 · ' + chapterTitleForDisplay(chapter.title, chapter.chapterIndex) : '来源章已删除或未记录' }
function characterLocation(id: string) { return { path: '/characters/' + novelId.value, query: { character: id } } }
function updateQuery() { void router.replace({ query: { ...route.query, tab: activeTab.value, atChapter: atIndex.value < 0 ? undefined : String(atIndex.value + 1), character: selectedCharacter.value?.id, fact: selectedFact.value?.key } }) }
function selectTab(tab: CodexTab) { activeTab.value = tab; updateQuery() }
function selectChapter(index: number) { if (!chapters.value.some(chapter => chapter.chapterIndex === index)) return; projectionIndex.value = index; updateQuery() }
function selectCharacter(id: string) { selectedCharacterId.value = id; detailOpen.value = true; updateQuery() }
function selectCell(characterId: string, factId: string) { selectedCharacterId.value = characterId; selectedFactId.value = factId; detailOpen.value = true; updateQuery() }
watch(() => route.query, query => {
  if (tabs.some(tab => tab.id === query?.tab)) activeTab.value = query.tab as CodexTab
  const index = typeof query?.atChapter === 'string' ? Number(query.atChapter) - 1 : undefined
  projectionIndex.value = Number.isSafeInteger(index) && index! >= 0 ? index : undefined
  selectedCharacterId.value = typeof query?.character === 'string' ? query.character : ''
  selectedFactId.value = typeof query?.fact === 'string' ? query.fact : ''
}, { immediate: true })
watch([characters, selectedCharacterId, activeTab], () => { void nextTick(scrollSelectedMatrixRowIntoView) })
onMounted(async () => { try { if (!novelId.value) throw new Error('典籍缺少作品编号。'); await workspace.hydrateFromPersistence(novelId.value) } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) } finally { loading.value = false } })
</script>

<style scoped>
.codex-page { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 0; background: var(--desk); }
.codex-main { min-width: 0; overflow: auto; padding: 22px 28px 40px; }
.codex-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.codex-head h1 { margin: 0 0 3px; font: 600 18px var(--f-serif); }
.codex-head p { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.codex-tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--line); overflow-x: auto; }
.codex-tabs button { padding: 10px; border-bottom: 2px solid transparent; color: var(--ink-3); font-size: 14px; white-space: nowrap; }
.codex-tabs button.on { color: var(--ink); border-color: var(--zhu); font-weight: 600; }
.m-panel { border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.projection-control { display: flex; align-items: center; gap: 14px; padding: 12px 16px; margin-bottom: 16px; }
.projection-control .muted { color: var(--ink-3); font-size: 12px; flex-shrink: 0; }
.projection-control strong { min-width: 132px; font: 600 14px var(--f-serif); white-space: nowrap; }
.projection-control input { min-width: 50px; flex: 1; accent-color: var(--zhu); }
.projection-control select { max-width: 180px; min-width: 0; border: 0; background: transparent; color: var(--ink-3); font: 11px var(--f-ui); text-overflow: ellipsis; }
.projection-control option { color: var(--ink); background: var(--paper); }
.projection-empty, .projection-notice, .pending-notice { color: var(--ink-3); font-size: 12px; line-height: 1.8; }
.projection-notice { color: var(--jin); }
.matrix-wrap { overflow: auto; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.matrix-wrap.is-windowed { max-height: min(70vh, 520px); }
.matrix { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 12px; }
.matrix th, .matrix td { padding: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); text-align: left; }
.matrix tr:last-child > * { border-bottom: 0; }.matrix tr > :last-child { border-right: 0; }
.matrix.is-windowed .matrix-window-spacer td { padding: 0; border: 0; }
.matrix.is-windowed tbody tr:not(.matrix-window-spacer) { height: 58px; }
.matrix.is-windowed tbody tr:not(.matrix-window-spacer) .matrix-person, .matrix.is-windowed tbody tr:not(.matrix-window-spacer) .matrix-cell { box-sizing: border-box; height: 58px; overflow: hidden; }
.matrix thead th { min-width: 148px; max-width: 210px; padding: 10px; background: var(--panel); color: var(--ink-2); font-size: 12px; line-height: 1.5; vertical-align: bottom; }
.matrix thead th:first-child { min-width: 160px; }.matrix thead small { display: block; margin-top: 3px; color: var(--ink-4); font-size: 10px; font-weight: 400; }
.matrix.is-windowed thead th { position: sticky; top: 0; z-index: 2; }
.matrix.is-windowed thead th:first-child { left: 0; z-index: 3; }
.matrix tbody th { position: sticky; left: 0; z-index: 1; background: var(--panel); }
.matrix-person { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 12px; white-space: nowrap; text-align: left; font-weight: 600; }
.matrix-cell { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; width: 100%; min-height: 58px; gap: 3px; padding: 8px 10px; text-align: left; }
.matrix-cell:hover, .matrix-person:hover { background: var(--hover); }.matrix-cell.selected { box-shadow: inset 0 0 0 2px var(--zhu); }
.cell-state { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; }.cell-state i, .matrix-legend i { font-style: normal; }
.cell-source { color: var(--ink-4); font: 10.5px var(--f-num); }
.knows { color: var(--qing); }.suspects, .unverified, .conflict { color: var(--jin); }.does_not_know, .unrecorded { color: var(--ink-4); }.false_belief { color: var(--zi); }
.matrix-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; color: var(--ink-3); font-size: 12px; }
.matrix-legend span { display: flex; align-items: center; gap: 5px; }
.codex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.character-card { min-width: 0; padding: 16px; }.character-card.selected { border-color: var(--line-2); }
.character-select { width: 100%; text-align: left; }.character-card-head { display: flex; align-items: center; gap: 12px; }
.character-card-head > div { min-width: 0; }.character-card h2 { margin: 0; font: 600 17px var(--f-serif); }
.character-card-head p { margin: 3px 0 5px; color: var(--ink-3); font-size: 12px; }
.tags, .event-tags { display: flex; flex-wrap: wrap; gap: 5px; }.tags span, .event-tags span { padding: 2px 6px; border: 1px solid var(--line-2); border-radius: 3px; color: var(--ink-3); font-size: 10px; }
.character-description { margin: 12px 0 10px; padding: 8px 10px; border-radius: 6px; background: var(--panel); color: var(--ink-2); font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
.character-arc-empty { margin: 8px 0; color: var(--ink-4); font-size: 10px; line-height: 1.6; }
.turning-points { margin: 12px 0 8px; padding-top: 10px; border-top: 1px solid var(--line); }.turning-points-label { color: var(--ink-3); font-size: 11px; }
.turning-point { display: grid; gap: 3px; margin-top: 8px; }.turning-point strong { font: 600 12px var(--f-serif); }.turning-point span { color: var(--ink-4); font-size: 10px; }.turning-point p { margin: 0; color: var(--ink-3); font-size: 11px; line-height: 1.6; }
:deep(.character-avatar) { border-radius: 50%; border-color: var(--line-2); background: var(--paper); }
.relation-scroll { overflow: auto; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }.relation-graph { position: relative; height: 520px; }.relation-graph svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.relationship-line { fill: none; stroke: var(--ink-3); stroke-width: 1.4; vector-effect: non-scaling-stroke; }.relationship-label { fill: var(--ink-2); stroke: var(--paper); stroke-width: 5px; paint-order: stroke; font: 12px var(--f-ui); }
.relation-node { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 5px; }.relation-node strong { padding: 0 6px; border-radius: 4px; background: var(--paper); font: 600 13px var(--f-serif); }.relation-node:hover :deep(.character-avatar), .relation-node.selected :deep(.character-avatar) { box-shadow: 0 0 0 3px var(--zhu-soft); }
.relation-legend, .timeline-explanation { margin: 12px 0 14px; color: var(--ink-3); font-size: 12px; line-height: 1.8; }
.relation-records { margin-top: 16px; color: var(--ink-3); font-size: 12px; }.relation-records summary { cursor: pointer; }.relation-row { padding: 14px 0; border-bottom: 1px solid var(--line); }.relation-source { display: flex; gap: 8px; color: var(--ink-2); }.relation-source span { color: var(--zhu); }.relation-row > strong { display: inline-block; margin: 6px 8px 0 0; color: var(--ink); }.relation-row small { color: var(--ink-4); }.relation-row p { margin: 6px 0; line-height: 1.7; }
.invalid-panel { padding: 16px; margin-top: 18px; font-size: 12px; color: var(--jin); }.invalid-panel h2 { margin: 0; font: 600 15px var(--f-serif); }.invalid-panel p { line-height: 1.7; }.invalid-panel article { padding-top: 8px; border-top: 1px solid var(--line); }
.story-timeline { position: relative; padding-left: 120px; }.story-timeline::before { content: ''; position: absolute; left: 104px; top: 8px; bottom: 8px; width: 2px; background: var(--line); }
.timeline-row { position: relative; margin-bottom: 12px; }.timeline-row::before { content: ''; position: absolute; left: -21px; top: 18px; width: 10px; height: 10px; border: 2px solid var(--ink-3); border-radius: 50%; background: var(--paper); }.timeline-row.planned::before { border-style: dashed; }.timeline-row.uncertain::before { border-color: var(--jin); }
.timeline-when { position: absolute; left: -120px; top: 12px; width: 92px; color: var(--ink-3); text-align: right; font: 12px/1.5 var(--f-serif); overflow-wrap: anywhere; }
.timeline-card { padding: 12px 14px; }.timeline-card h2 { margin: 5px 0 4px; font: 600 15px var(--f-serif); }.timeline-card p { margin: 0; font-size: 12.5px; line-height: 1.7; }.timeline-row.planned .timeline-card { border-style: dashed; }.timeline-row.uncertain .timeline-card { border-color: var(--jin); }
.resource-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }.resource-card { display: grid; gap: 8px; padding: 18px; text-decoration: none; }.resource-card strong { font: 600 16px var(--f-serif); color: var(--ink); }.resource-card span { color: var(--ink-3); font-size: 12px; line-height: 1.8; }
.codex-links { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 28px; }.codex-links a { color: var(--ink-3); font-size: 11px; text-decoration: none; }.codex-links a:hover { color: var(--zhu); }
.codex-detail { min-width: 0; overflow: auto; padding: 20px; border-left: 1px solid var(--line); background: var(--panel); }.detail-person { display: flex; align-items: center; gap: 12px; }.eyebrow { color: var(--zhu); font-size: 11px; letter-spacing: .1em; }.detail-person h2 { margin: 2px 0 0; font: 600 20px/1.35 var(--f-serif); }
.detail-section-heading { margin: 22px 0 8px; color: var(--ink-3); font-size: 12px; font-weight: 500; letter-spacing: .06em; }.detail-proposition { margin: 0 0 6px; font: 16px/1.7 var(--f-serif); overflow-wrap: anywhere; }.proposition-scope { margin: 4px 0 10px; color: var(--ink-4); font-size: 10px; line-height: 1.6; }
.detail-state { display: inline-block; padding: 3px 7px; border-radius: 3px; background: var(--hover); font-size: 12.5px; }.current-knowledge p, .conflict-notice { font-size: 12px; line-height: 1.8; }.current-knowledge small { display: block; color: var(--ink-4); font-size: 10px; }.conflict-notice { color: var(--jin); }
.knowledge-history { position: relative; padding-left: 18px; }.knowledge-history::before { content: ''; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 1px; background: var(--line-2); }.history-item { position: relative; margin-bottom: 18px; }.history-item::before { content: ''; position: absolute; left: -17px; top: 5px; width: 9px; height: 9px; border: 2px solid var(--ink-3); border-radius: 50%; background: var(--paper); }.history-item.invalid::before { border-color: var(--jin); border-style: dashed; }
.history-head { display: flex; flex-wrap: wrap; gap: 5px; color: var(--ink-3); font-size: 12px; }.history-warning { color: var(--jin); font-size: 10px; }.history-item > strong { display: block; margin: 3px 0; font-size: 13px; }.history-item > p { margin: 5px 0; font-size: 12px; line-height: 1.7; }.history-issue, .identity-note { color: var(--ink-4); }
blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--line); color: var(--ink-2); font: 13px/1.8 var(--f-serif); white-space: pre-wrap; overflow-wrap: anywhere; }blockquote a { display: block; color: var(--zhu); font: 11px var(--f-ui); text-decoration: none; margin-top: 5px; }
.isolation-note { display: flex; gap: 8px; padding: 12px; margin-top: 16px; border: 1px dashed var(--line-2); border-radius: var(--r-m); color: var(--ink-3); font-size: 12px; line-height: 1.7; }.isolation-note svg { flex-shrink: 0; margin-top: 3px; }
.detail-description { font: 14px/1.9 var(--f-serif); white-space: pre-wrap; }.detail-empty { color: var(--ink-3); font-size: 12px; line-height: 1.8; }.detail-edit { margin-top: 12px; }
.detail-mobile-head, .detail-trigger, .detail-backdrop { display: none; }.empty { padding: 28px; color: var(--ink-3); font-size: 13px; line-height: 1.8; }.empty h2 { margin: 0 0 8px; color: var(--ink-2); font: 600 17px var(--f-serif); }.empty p { margin: 0 0 14px; }.codex-state { padding: 60px; color: var(--ink-3); }.codex-state.error { color: var(--zhu); }
.m-link { display: inline-flex; padding: 5px 0; color: var(--zhu); font: 12px var(--f-ui); text-decoration: none; }.m-link:hover { text-decoration: underline; }.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-sep { margin: 0 7px; color: var(--ink-4); }
@media (max-width: 1100px) { .codex-page { grid-template-columns: minmax(0, 1fr); }.codex-detail { display: none; }.codex-detail.is-open { display: block; position: absolute; z-index: 11; inset: 0 0 0 auto; width: min(360px, 100%); box-shadow: var(--shadow-2); }.detail-trigger { display: inline-flex; }.detail-backdrop { display: block; position: absolute; inset: 0; z-index: 10; background: var(--ink); opacity: .16; }.detail-mobile-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; color: var(--ink-3); font-size: 12px; } }
@media (max-width: 680px) { .codex-main { padding: 18px 14px 32px; }.codex-head { align-items: flex-start; gap: 10px; }.head-actions { gap: 5px; }.codex-head p { font-size: 11px; }.head-actions .m-btn { padding: 5px 7px; font-size: 11px; }.codex-tabs button { padding: 10px 8px; font-size: 13px; }.projection-control { flex-wrap: wrap; gap: 10px; padding: 12px; }.projection-control strong { min-width: 0; }.projection-control input { flex-basis: 45%; }.projection-control select { flex: 0 0 100%; max-width: 100%; }.codex-grid { grid-template-columns: 1fr; }.story-timeline { padding-left: 82px; }.story-timeline::before { left: 66px; }.timeline-when { left: -82px; width: 54px; font-size: 11px; }.codex-detail { padding: 16px; } }
</style>
