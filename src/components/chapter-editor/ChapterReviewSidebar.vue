<template>
  <button v-if="hasContent || summary || editingCandidate || requestError" class="review-toggle-btn" :class="{ 'is-open': open }" :title="open ? '收起审查面板' : '展开审查面板'" @click="emit('toggle')">
    {{ open ? '▶' : '◀' }}<span v-if="!open" class="review-toggle-label">审查</span>
  </button>
  <transition name="slide-right">
    <div v-if="open && (hasContent || summary || loading || editingCandidate || requestError)" class="review-sidebar">
      <div class="review-sidebar-header">
        <div class="review-header-title"><div v-if="loading" class="ai-spinner"></div><strong>{{ loading ? '审查进行中…' : '本章审查' }}</strong></div>
        <button class="close-btn" title="关闭审查面板" @click="emit('close')">✕</button>
      </div>
      <div class="review-sidebar-body">
        <p class="review-intro">结合人物、情节与叙事节奏，查看本章审查结果。</p>
        <section v-if="requestError" class="review-request-error" role="alert" aria-label="本次检查未完成">
          <strong>本次检查未完成</strong>
          <p>{{ requestError }}</p>
          <p>本次未产生新的有效审核结论。下方已有报告仍保留。</p>
        </section>
        <p v-if="contentReview" class="review-verdict" :class="`review-verdict--${loading || reviewNeedsRevalidation ? 'unknown' : reviewVerdict}`" role="status">{{ loading ? '正在审查，结论尚未完成' : reviewNeedsRevalidation ? '原报告待重新审核，不能代表当前正文结论' : reviewVerdict === 'passed' ? '报告结论：可通过' : reviewVerdict === 'changes-required' ? '报告结论：需要修改' : '报告结论：待确认结论' }}</p>
        <section v-if="coverageStatus" class="review-section">
          <div class="review-section-title">审核覆盖范围</div>
          <p class="review-section-content" role="status">{{ coverageStatus }}</p>
        </section>
        <section v-if="endingCheck" class="review-section ending-check-section">
          <div class="review-section-title">章节结尾检查 · {{ endingCheck.isComplete ? '已通过' : '需要收尾' }}</div>
          <div class="review-section-content">
            <p>{{ endingCheck.reason }}</p>
            <p v-if="endingCheck.openAction"><strong>未完成事项：</strong>{{ endingCheck.openAction }}</p>
            <p v-if="endingCheck.continuationInstruction"><strong>收尾建议：</strong>{{ endingCheck.continuationInstruction }}</p>
            <p v-if="endingCheck.isValidCliffhanger" class="revision-meta">结尾属于本章行动已有结果后引出的有效悬念。</p>
          </div>
        </section>

        <section v-if="pendingRevision" class="review-section revision-section">
          <div class="review-section-title">待确认正文修订</div>
          <div class="review-section-content">
            <p class="revision-meta">{{ pendingRevision.reason || 'AI 生成的正文修订建议' }}</p>
            <template v-if="pendingRevision.selection">
              <p class="revision-meta">{{ pendingRevision.selection.mode === 'continue' ? '插入续写，原有文字保持不变。' : '只替换所选文字，其他段落保持不变。' }}草稿可以先接受局部修改，篇幅和全文审核在定稿时检查。</p>
              <label class="selection-revision-label">候选文字<textarea v-model="selectionDraft" class="selection-replacement" aria-label="编辑选区候选文字" rows="6" :disabled="revisionLoading || aiWriting || completing || !allowRewrite"></textarea></label>
              <n-button size="small" :disabled="!selectionEdited || !selectionDraft.trim() || revisionLoading || aiWriting || completing || !allowRewrite" @click="emit('edit-revision', selectionDraft)">保存候选修改</n-button>
              <p v-if="selectionEdited" class="revision-meta" role="status">候选文字已修改，请先保存修改再确认写入。</p>
            </template>
            <pre class="revision-diff">{{ pendingRevision.diff }}</pre>
            <div class="action-row"><n-button size="small" type="primary" :disabled="revisionLoading || aiWriting || completing || !allowRewrite || selectionEdited" @click="emit('approve-revision')">确认写入</n-button><n-button size="small" :disabled="revisionLoading || aiWriting || completing" @click="emit('reject-revision')">拒绝</n-button></div>
          </div>
        </section>

        <section v-if="candidateChanges.length || editingCandidate" class="review-section candidate-section">
          <div class="review-section-title">待确认故事变化（{{ candidateChanges.length }}）</div>
          <div class="review-section-content">
            <p class="revision-meta">AI 只提出了候选变化，确认前不会修改正式人物、事件或时间线。</p>
            <p v-if="editingCandidate && editingVersion !== decisionVersion" class="candidate-warning" role="status">正文或审核依据已经变化，修改草稿已保留。请取消修改并重新审核后再确认。</p>
            <StoryCandidateEditor v-if="editingCandidate" :key="editingCandidate.id" :candidate="editingCandidate" :busy="candidateSaving"
              :disabled="decisionDisabled || editingVersion !== decisionVersion" @confirm="confirmEditedCandidate" @cancel="editingCandidate = null" />
            <article v-for="candidate in candidateChanges" :key="candidate.id" class="candidate-card">
              <strong>{{ candidateTypeLabel(candidate.type) }}</strong>
              <small v-if="candidate.status === 'deferred'" class="candidate-warning">已延后 · 定稿前仍需确认或忽略</small>
              <pre>{{ formatCandidateValue(candidate.proposedValue, candidate.type) }}</pre>
              <small v-if="candidate.type === 'knowledge' || candidate.type === 'relationship'">确认后按来源章节记录，可在角色库的“知情与关系历史”中回看。</small>
              <div v-for="evidence in candidate.evidence" :key="evidence.id" class="evidence-line">
                <small>证据：{{ evidence.quote || evidence.label || '已关联正文' }}</small>
                <button v-if="evidence.sourceType === 'chapter'" type="button" class="evidence-locate" :disabled="candidateSaving" @click="emit('locate-evidence', evidence)">定位正文</button>
              </div>
              <small v-if="!candidate.evidence.length" class="candidate-warning">缺少可定位正文证据，暂不能确认</small>
              <div v-if="candidateImpact(candidate.id)" class="candidate-impact">
                <strong>影响分析：</strong>{{ candidateImpact(candidate.id)!.summary }}
                <span v-if="candidateImpact(candidate.id)!.items.length">涉及章节：{{ candidateImpact(candidate.id)!.items.map(item => '第' + (item.chapterIndex + 1) + '章').join('、') }}</span>
              </div>
              <small v-if="candidate.authorNote">作者记录：{{ candidate.authorNote }}</small>
              <label class="decision-note">处理说明（可选）<textarea :value="candidateNotes[candidate.id]?.note || ''" rows="2" aria-label="候选处理说明" :disabled="decisionDisabled || !!editingCandidate" @input="captureCandidateNote(candidate, ($event.target as HTMLTextAreaElement).value)"></textarea></label>
              <div class="action-row">
                <n-button v-if="candidate.type === 'event_causality'" size="small" type="primary" :disabled="decisionDisabled || !!editingCandidate || !causalityNovelFor(candidate)" @click="openCausality(candidate)">事件因果面板：编辑、采用、暂缓或拒绝</n-button>
                <template v-else>
                  <n-button size="small" type="primary" :disabled="!candidate.evidence.length || decisionDisabled || !!editingCandidate" @click="decideCandidate(candidate, 'accept')">确认候选</n-button>
                  <n-button size="small" :disabled="decisionDisabled || !!editingCandidate" @click="startEditing(candidate)">修改后确认</n-button>
                </template>
                <n-button v-if="candidate.type !== 'event_causality'" size="small" :disabled="decisionDisabled || !!editingCandidate" @click="decideCandidate(candidate, 'defer')">{{ candidate.status === 'deferred' ? '保存延后说明' : '稍后处理' }}</n-button>
                <n-button v-if="candidate.type !== 'event_causality'" size="small" :disabled="decisionDisabled || !!editingCandidate" @click="decideCandidate(candidate, 'reject')">忽略</n-button>
              </div>
            </article>
          </div>
        </section>

        <div v-if="loading && !contentReview" class="review-loading-hint"><div class="ai-spinner"></div><p>AI 正在分析章节内容...</p></div>

        <section v-if="summary" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'summary')">章节总结<span>{{ expanded.summary ? '▼' : '▶' }}</span></button>
          <div v-if="summaryState !== 'current'" class="review-section-content summary-source-warning" role="status">
            {{ summaryState === 'stale' ? '正文或总结已经改变，这份总结暂不用于 AI 写作和审核。' : '这份总结尚未绑定正文版本，暂不用于 AI 写作和审核。' }}
            <n-button size="small" :disabled="summarySaving || loading || completing || aiWriting || !allowRewrite" :loading="summarySaving" @click="emit('confirm-summary')">已核对正文，确认沿用总结</n-button>
          </div>
          <div v-if="expanded.summary" class="review-section-content">{{ summary }}</div>
        </section>

        <section v-if="contentReview" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'contentReview')">内容审查 {{ loading ? '(生成中...)' : '' }}<span>{{ expanded.contentReview ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.contentReview" class="review-section-content">
            <div v-if="!loading && allowRewrite && contentReviewVerdict(contentReview) === 'changes-required'" class="rewrite-actions">
              <textarea :value="editableReview" class="editable-review" rows="4" placeholder="报告未列出具体修改项，可在这里填写后修订" @input="emit('update-editable-review', ($event.target as HTMLTextAreaElement).value)"></textarea>
              <div class="action-row"><n-button size="small" type="primary" :disabled="aiWriting || completing || !editableReview.trim()" @click="emit('rewrite', editableReview, 'targeted')">局部修正</n-button><n-button size="small" :disabled="aiWriting || completing || !editableReview.trim()" @click="emit('rewrite', editableReview, 'full')">整章修订</n-button></div>
            </div>
            <p v-if="reviewStatus" class="review-status" role="status">{{ reviewStatus }}</p>
            <div class="review-cards">
              <article v-for="(section, index) in reviewCards" :key="index" class="review-card">
                <h4><span class="review-card-mark" aria-hidden="true">{{ index + 1 }}</span>{{ section.title }}</h4>
                <p>{{ section.content }}</p>
              </article>
            </div>
            <details class="review-full-report" :open="reviewCards.length === 0"><summary>完整审查报告</summary><div class="banned-content" v-html="renderedContentReview"></div></details>
          </div>
        </section>

        <section v-if="localScanResults.length" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'localScan')">违禁词扫描（{{ localScanResults.length }} 项）<span>{{ expanded.localScan ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.localScan" class="review-section-content">
            <div v-for="item in localScanResults" :key="item.word.word" class="scan-item">
              <span class="scan-word" :class="item.word.level">{{ item.word.word }}</span><span>{{ item.word.category }}</span><span>×{{ item.count }}</span>
              <n-button v-if="item.word.suggestion" size="tiny" type="primary" @click="emit('replace-word', item.word.word, item.word.suggestion)">替换</n-button>
            </div>
            <n-button v-if="localScanResults.some(item => item.word.suggestion)" size="small" type="warning" @click="emit('replace-all')">一键替换</n-button>
          </div>
        </section>

        <section v-if="continuityAlerts.length" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'continuity')">连续性提醒（{{ continuityAlerts.length }} 项）<span>{{ expanded.continuity ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.continuity" class="review-section-content">
            <div v-for="alert in continuityAlerts" :key="alert.id" class="continuity-item" :class="`continuity-${alert.level}`">
              <strong>{{ alert.title }}</strong>
              <p>{{ alert.detail }}</p>
              <small>依据：{{ alert.evidence }}</small>
            </div>
          </div>
        </section>

        <section v-if="reviewFindings.length" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'findings')">结构化审核问题（{{ reviewFindings.length }} 项）<span>{{ expanded.findings ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.findings" class="review-section-content">
            <article v-for="finding in reviewFindings" :key="finding.id" class="finding-item" :class="'finding-' + finding.severity">
              <div class="finding-heading"><strong>{{ finding.title }}</strong><small>{{ findingSeverityLabel(finding.severity) }} · {{ findingStatusLabels[finding.status] }}</small></div>
              <p>{{ finding.explanation }}</p>
              <div v-for="evidence in findingEvidence(finding)" :key="evidence.id" class="evidence-line">
                <small>证据：{{ evidence.quote || evidence.label || '未提供正文引文' }}</small>
                <button v-if="evidence.sourceType === 'chapter'" type="button" class="evidence-locate" :disabled="candidateSaving" @click="emit('locate-evidence', evidence)">定位正文</button>
              </div>
              <small v-if="finding.suggestedFix">建议：{{ finding.suggestedFix }}</small>
              <small v-if="isFindingBlocking(finding)" class="candidate-warning">当前问题会阻塞章节定稿{{ finding.status === 'deferred' ? '；延后不代表已解决' : '' }}</small>
              <small v-if="finding.status === 'stale'" class="candidate-warning">正文版本已经变化，请重新审核。</small>
              <small v-if="finding.authorNote">作者记录：{{ finding.authorNote }}</small>
              <template v-if="finding.status === 'open' || finding.status === 'deferred'">
                <label class="decision-note">处理说明（可选）<textarea :value="findingNotes[finding.id]?.note || ''" rows="2" aria-label="审核问题处理说明" :disabled="decisionDisabled" @input="captureFindingNote(finding, ($event.target as HTMLTextAreaElement).value)"></textarea></label>
                <div class="action-row">
                  <n-button size="small" type="primary" :disabled="decisionDisabled" @click="decideFinding(finding, 'accepted')">已处理</n-button>
                  <n-button size="small" :disabled="decisionDisabled" @click="decideFinding(finding, 'intentional')">标记有意</n-button>
                  <n-button size="small" :disabled="decisionDisabled" @click="decideFinding(finding, 'deferred')">稍后处理</n-button>
                </div>
              </template>
            </article>
          </div>
        </section>

        <section v-if="bannedResult" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'aiReview')">AI 审查意见<span>{{ expanded.aiReview ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.aiReview" class="review-section-content"><div class="banned-content" v-html="renderedBannedResult"></div></div>
        </section>
      </div>
      <div class="review-sidebar-footer">
        <n-button size="small" quaternary :disabled="loading || completing || aiWriting || candidateSaving || !!editingCandidate" @click="emit('clear')">清空报告</n-button>
        <n-button v-if="actionLabel" size="small" type="primary" :disabled="actionDisabled || candidateSaving || !!editingCandidate" :loading="actionLoading" @click="emit('proceed')">{{ actionLabel }}</n-button>
      </div>
    </div>
  </transition>
  <n-modal v-model:show="showCausality" display-directive="show" :mask-closable="false">
    <section v-if="causalityNovel" class="causality-review-dialog" role="dialog" aria-modal="true" aria-label="事件因果候选核对">
      <header><strong>事件因果候选核对</strong><n-button @click="showCausality = false">收起（保留本页输入）</n-button></header>
      <EventCausalityPanel :key="causalityNovel.id" :novel="causalityNovel" :focus-candidate-id="causalityCandidateId"
        :initial-author-note="candidateNotes[causalityCandidateId]?.note" />
    </section>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NModal } from 'naive-ui'
import { contentReviewVerdict } from '@/services/contentReview'
import type { ChapterEndingCheck } from '@/services/chapterEnding'
import type { BannedWordEntry } from '@/data/bannedWords'
import type { ChapterRevision } from '@/types/novel'
import type { CandidateChange, EvidenceRef, ReviewFinding } from '@/types/reconstruction'
import type { FindingDecisionStatus } from '@/services/storyDecisions'
import { isFindingBlocking } from '@/services/reconstructionReview'
import { findingEvidence } from '@/services/reviewEvidence'
import StoryCandidateEditor from './StoryCandidateEditor.vue'
import { candidateFields, candidateFieldValues } from '@/services/candidateEditing'
import type { ReconstructionImpactReport } from '@/services/reconstructionImpact'
import { knowledgeStateLabels } from '@/services/reconstructionCharacterState'
import { relationshipDimensionLabel } from '@/services/characterMemoryIdentity'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
import { selectionReplacement } from '@/services/selectionRevisionMetadata'
import EventCausalityPanel from '@/components/EventCausalityPanel.vue'
import { useNovelStore } from '@/stores/novel'

type SectionKey = 'summary' | 'contentReview' | 'localScan' | 'aiReview' | 'continuity' | 'findings'

const props = defineProps<{
  open: boolean; hasContent: boolean; summary: string; loading: boolean; endingCheck: ChapterEndingCheck | null
  pendingRevision: ChapterRevision | null; revisionLoading: boolean; contentReview: string; renderedContentReview: string
  editableReview: string; aiWriting: boolean; completing: boolean; allowRewrite: boolean
  localScanResults: Array<{ word: BannedWordEntry; count: number; positions: number[] }>
  continuityAlerts: Array<{ id: string; level: 'warning' | 'info'; title: string; detail: string; evidence: string }>
  bannedResult: string; renderedBannedResult: string; expanded: Record<SectionKey, boolean>
  reviewStatus?: string; reviewNeedsRevalidation?: boolean; requestError?: string; coverageStatus?: string; actionLabel?: string; actionDisabled?: boolean; actionLoading?: boolean
  candidateChanges: CandidateChange[]; candidateImpacts?: Record<string, ReconstructionImpactReport>; reviewFindings: import('@/types/reconstruction').ReviewFinding[]
  candidateSaving?: boolean
  decisionVersion?: string; candidateReceipt?: { id: string; sequence: number }
  summaryState?: 'empty' | 'current' | 'unverified' | 'stale'; summarySaving?: boolean
}>()

const novelStore = useNovelStore()
const showCausality = ref(false), causalityCandidateId = ref(''), causalityNovelId = ref('')
const causalityNovel = computed(() => novelStore.getNovel(causalityNovelId.value))
function causalityNovelFor(candidate: CandidateChange) {
  const novel = candidate.novelId ? novelStore.getNovel(candidate.novelId)
    : novelStore.novels.find(book => book.chapters.some(chapter => chapter.id === candidate.chapterId))
  return novel?.chapters.some(chapter => chapter.id === candidate.chapterId) ? novel : undefined
}
function openCausality(candidate: CandidateChange) {
  const novel = causalityNovelFor(candidate)
  if (!novel || decisionDisabled.value) return
  causalityNovelId.value = novel.id; causalityCandidateId.value = candidate.id; showCausality.value = true
}

const decisionDisabled = computed(() => !!(props.candidateSaving || props.loading || props.revisionLoading || props.aiWriting || props.completing || !props.allowRewrite))
const editingCandidate = ref<CandidateChange | null>(null)
const editingVersion = ref('')
type NoteDraft<T> = { record: T; version: string; note: string }
const candidateNotes = ref<Record<string, NoteDraft<CandidateChange>>>({})
const findingNotes = ref<Record<string, NoteDraft<ReviewFinding>>>({})
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const findingStatusLabels: Record<ReviewFinding['status'], string> = { open: '待处理', accepted: '已处理', rejected: '已忽略', intentional: '有意设计', deferred: '已延后', stale: '已过期' }
function captureCandidateNote(candidate: CandidateChange, note: string) {
  candidateNotes.value[candidate.id] ||= { record: clone(candidate), version: props.decisionVersion || '', note: '' }
  candidateNotes.value[candidate.id].note = note
}
function captureFindingNote(finding: ReviewFinding, note: string) {
  findingNotes.value[finding.id] ||= { record: clone(finding), version: props.decisionVersion || '', note: '' }
  findingNotes.value[finding.id].note = note
}
function startEditing(candidate: CandidateChange) {
  if (decisionDisabled.value || editingCandidate.value) return
  if (candidate.type === 'event_causality') { openCausality(candidate); return }
  editingCandidate.value = clone(candidate)
  editingVersion.value = props.decisionVersion || ''
}
function confirmEditedCandidate(candidate: CandidateChange, value: string, note: string, memoryDecision?: CharacterMemoryAuthorDecision) {
  if (decisionDisabled.value || editingVersion.value !== (props.decisionVersion || '')) return
  if (candidate.type === 'event_causality') { openCausality(candidate); return }
  emit('accept-candidate', candidate, editingVersion.value, value, note, memoryDecision)
}
function decideCandidate(candidate: CandidateChange, action: 'accept' | 'reject' | 'defer') {
  if (decisionDisabled.value || editingCandidate.value) return
  if (candidate.type === 'event_causality') { openCausality(candidate); return }
  if (action === 'accept' && ['knowledge', 'relationship'].includes(candidate.type)) { startEditing(candidate); return }
  const draft = candidateNotes.value[candidate.id] || { record: clone(candidate), version: props.decisionVersion || '', note: '' }
  if (action === 'accept') emit('accept-candidate', draft.record, draft.version, undefined, draft.note)
  else if (action === 'reject') emit('reject-candidate', draft.record, draft.version, draft.note)
  else emit('defer-candidate', draft.record, draft.version, draft.note)
}
function decideFinding(finding: ReviewFinding, status: FindingDecisionStatus) {
  if (decisionDisabled.value) return
  const draft = findingNotes.value[finding.id] || { record: clone(finding), version: props.decisionVersion || '', note: '' }
  emit('resolve-finding', draft.record, status, draft.version, draft.note)
}
watch(() => props.candidateReceipt, receipt => {
  if (!receipt) return
  if (editingCandidate.value?.id === receipt.id) editingCandidate.value = null
  delete candidateNotes.value[receipt.id]
  delete findingNotes.value[receipt.id]
})

const reviewVerdict = computed(() => contentReviewVerdict(props.contentReview))
const selectionDraft = ref('')
const savedSelectionDraft = computed(() => props.pendingRevision?.selection ? selectionReplacement(props.pendingRevision) : '')
const selectionEdited = computed(() => !!props.pendingRevision?.selection && selectionDraft.value !== savedSelectionDraft.value)
watch(() => [props.pendingRevision?.id, savedSelectionDraft.value], () => { selectionDraft.value = savedSelectionDraft.value }, { immediate: true })
const candidateTypeLabels: Record<CandidateChange['type'], string> = {
  fact: '新增故事事实', state: '人物/对象状态变化', relationship: '人物关系变化',
  event_causality: '事件因果（请在剧情规划的事件因果面板核对）',
  timeline: '时间线变化', plotline: '剧情线变化', foreshadowing: '伏笔变化', knowledge: '角色知情变化',
}
function candidateTypeLabel(type: CandidateChange['type']) { return candidateTypeLabels[type] }
function candidateImpact(candidateId: string): ReconstructionImpactReport | undefined { return props.candidateImpacts?.[candidateId] }
function formatCandidateValue(value: string, type: CandidateChange['type']) {
  try {
    const data = JSON.parse(value)
    if (type === 'knowledge') return [
      '角色：' + (data.characterName || data.characterId || '未关联'),
      '命题：' + (data.fact || '未填写'),
      '主体：' + (data.subjectId || '指代未确认') + '；对象：' + (data.objectId || '未指定'),
      '范围：' + (data.scope || '未确认，保留独立身份'),
      data.factId ? '模型建议编号：' + data.factId + '（仅为线索，不能授权合并）' : '',
      '状态：' + (knowledgeStateLabels[data.state as keyof typeof knowledgeStateLabels] || '无效'),
      data.state === 'false_belief' ? '角色误信：' + (data.belief || '未填写') + '（不代表客观事实）' : '',
      data.learnedFrom ? '获知途径：' + data.learnedFrom : '',
    ].filter(Boolean).join('\n')
    if (type === 'relationship') return (data.characterName || data.characterId || '未关联') + ' → '
      + (data.targetCharacterName || data.targetCharacterId || '未关联') + '：' + (data.relation || '未填写')
      + '\n维度：' + (data.dimension ? relationshipDimensionLabel(data.dimension) : '等待作者选择')
      + (data.description ? '\n' + data.description : '') + '\n仅记录这个方向的关系。'
    const fields = candidateFields({ type }, data)
    const values = candidateFieldValues(fields, data)
    return fields.filter(field => values[field.key]).map(field => field.label + '：'
      + (field.options?.find(option => option.value === values[field.key])?.label || values[field.key])).join('\n')
  }
  catch { return value }
}
function findingSeverityLabel(severity: import('@/types/reconstruction').ReviewSeverity) {
  return severity === 'blocker' ? '阻塞' : severity === 'warning' ? '警告' : '建议'
}
const reviewCards = computed(() => {
  const sections: Array<{ title: string; content: string }> = []
  let title = ''
  let lines: string[] = []
  const clean = (text: string) => text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  const flush = () => {
    if (!title || !lines.join('').trim()) return
    if (/六维度|维度简评/.test(title)) {
      for (const line of lines) {
        const match = line.match(/^\s*\d+[.、)）]\s*([^：:]+)[：:]\s*(.+)$/)
        if (match) sections.push({ title: clean(match[1]), content: clean(match[2]) })
      }
    } else if (!/结论|审查报告/.test(title)) sections.push({ title: clean(title), content: clean(lines.join('\n').trim()) })
  }
  for (const line of props.contentReview.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/) || line.match(/^\s*\*\*(.+?)\*\*[：:]?\s*$/)
    if (heading) { flush(); title = heading[1]; lines = [] }
    else lines.push(line)
  }
  flush()
  return sections
})

const emit = defineEmits<{
  toggle: []; close: []; clear: []; 'approve-revision': []; 'reject-revision': []
  'edit-revision': [replacement: string]
  'confirm-summary': []
  rewrite: [review: string, mode: 'targeted' | 'full']; 'replace-word': [word: string, suggestion: string]; 'replace-all': []
  'toggle-section': [key: SectionKey]; 'update-editable-review': [value: string]
  'accept-candidate': [candidate: CandidateChange, version: string, editedValue?: string, authorNote?: string, memoryDecision?: CharacterMemoryAuthorDecision]
  'reject-candidate': [candidate: CandidateChange, version: string, authorNote?: string]
  'defer-candidate': [candidate: CandidateChange, version: string, authorNote?: string]
  'resolve-finding': [finding: ReviewFinding, status: FindingDecisionStatus, version: string, authorNote?: string]
  'locate-evidence': [evidence: EvidenceRef]
  proceed: []
}>()
</script>

<style scoped>
.causality-review-dialog { width: min(900px, 94vw); max-height: 90vh; overflow: auto; padding: 24px; border-radius: 12px; background: var(--bg-primary, #fff); color: var(--text-primary, #222); }
.causality-review-dialog > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.selection-revision-label { display: block; font-size: 12px; margin-bottom: 8px; }
.selection-replacement { display: block; box-sizing: border-box; width: 100%; margin-top: 6px; padding: 8px; resize: vertical; line-height: 1.7; color: var(--text-color); background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 6px; }
.review-toggle-btn { position: fixed; right: 0; top: 50%; z-index: 29; min-width: 28px; height: 52px; border: 1px solid var(--border-color); border-right: 0; background: var(--bg-color-card); color: var(--text-color-secondary); cursor: pointer; }
.review-toggle-btn.is-open { right: min(430px, 92vw); }
.review-toggle-label { writing-mode: vertical-rl; margin-left: 2px; font-size: 11px; }
.review-sidebar { position: fixed; top: 52px; bottom: 0; right: 0; z-index: 28; width: min(430px, 92vw); display: flex; flex-direction: column; background: var(--bg-color-card); border-left: 1px solid var(--border-color); box-shadow: var(--shadow-lg); }
.review-sidebar-header, .review-header-title, .action-row { display: flex; align-items: center; gap: 8px; }
.review-sidebar-header { justify-content: space-between; min-height: 54px; flex-shrink: 0; padding: 0 16px; border-bottom: 1px solid var(--border-color-light); }
.close-btn { border: 0; background: none; color: var(--text-color-tertiary); cursor: pointer; }
.review-sidebar-body { flex: 1; min-height: 0; overflow: auto; padding: 14px; }
.review-sidebar-footer { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 14px 18px; border-top: 1px solid var(--border-color-light); }
.review-status { color: var(--color-primary); font-weight: 600; }
.review-section { margin-bottom: 10px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); overflow: hidden; }
.review-section-title { width: 100%; display: flex; justify-content: space-between; gap: 8px; padding: 10px; border: 0; background: var(--bg-color-secondary); color: var(--text-color-primary); font-weight: 600; text-align: left; }
.review-section-content { padding: 10px; color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
.candidate-card { display: grid; gap: 7px; padding: 10px 0; border-bottom: 1px solid var(--border-color-light); }
.candidate-card:last-child { border-bottom: 0; }
.candidate-card pre { margin: 0; padding: 8px; overflow: auto; border-radius: var(--radius-sm); background: var(--bg-color-secondary); color: var(--text-color-primary); font: 12px/1.55 var(--font-family); white-space: pre-wrap; }
.candidate-card small { color: var(--text-color-tertiary); }
.candidate-impact { display: grid; gap: 3px; padding: 7px 8px; border-radius: var(--radius-sm); background: var(--color-primary-light); color: var(--text-color-secondary); font-size: 12px; line-height: 1.55; }
.candidate-impact span { color: var(--text-color-tertiary); }
.candidate-warning { color: var(--color-warning) !important; }
.finding-item { padding: 8px 0; border-bottom: 1px solid var(--border-color-light); }
.finding-item:last-child { border-bottom: 0; }
.finding-heading { display: flex; justify-content: space-between; gap: 8px; color: var(--text-color-primary); }
.finding-heading small { flex-shrink: 0; color: var(--text-color-tertiary); }
.finding-item p { margin: 5px 0; white-space: pre-wrap; }
.finding-item > small { display: block; margin-top: 4px; color: var(--text-color-tertiary); }
.finding-blocker .finding-heading strong { color: var(--color-error); }
.finding-warning .finding-heading strong { color: var(--color-warning); }
.review-section-content p { margin: 5px 0; }
.summary-source-warning { color: var(--color-warning); display: grid; gap: 8px; }
.revision-diff { max-height: 280px; overflow: auto; white-space: pre-wrap; font: inherit; }
.editable-review { width: 100%; box-sizing: border-box; resize: vertical; padding: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-color); color: var(--text-color-primary); }
.rewrite-actions { margin-bottom: 12px; }
.action-row { margin-top: 8px; flex-wrap: wrap; }
.decision-note { display: grid; gap: 4px; margin-top: 7px; font-size: 12px; }
.decision-note textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 6px; font: inherit; color: var(--text-color-primary); background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 5px; }
.evidence-line { display: grid; gap: 3px; margin-top: 5px; }
.evidence-locate { justify-self: start; border: 0; padding: 2px 0; background: transparent; color: var(--color-primary); font: inherit; font-size: 12px; cursor: pointer; }
.evidence-locate:disabled { opacity: .5; cursor: default; }
.scan-item { display: grid; grid-template-columns: 1fr auto auto auto; gap: 7px; align-items: center; padding: 6px 0; }
.scan-word.must { color: var(--color-error); }
.scan-word.platform { color: var(--color-warning); }
.continuity-item { padding: 7px 0; border-bottom: 1px solid var(--border-color-light); }
.continuity-item:last-child { border-bottom: 0; }
.continuity-item strong { color: var(--text-color-primary); font-size: 12px; }
.continuity-item p { margin: 3px 0; font-size: 12px; }
.continuity-item small { color: var(--text-color-tertiary); font-size: 11px; }
.continuity-warning strong { color: var(--color-warning); }
.continuity-info strong { color: var(--color-info); }
.review-loading-hint { padding: 18px; text-align: center; color: var(--text-color-tertiary); }
.ai-spinner { width: 16px; height: 16px; border: 2px solid var(--border-color); border-top-color: var(--color-primary); border-radius: 50%; animation: spin .8s linear infinite; }
.banned-content :deep(p) { margin: 5px 0; }
.review-intro { color: var(--text-color-tertiary); line-height: 1.7; font-size: 13px; margin: 0 0 16px; }
.review-request-error { margin: 0 0 16px; padding: 12px; border: 1px solid var(--color-error); border-radius: 6px; color: var(--color-error); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.review-request-error p { margin: 6px 0 0; white-space: pre-wrap; }
.review-verdict { padding: 10px 12px; border-radius: var(--radius-md); background: var(--bg-color-secondary); color: var(--text-color-secondary); font-size: 13px; margin: 0 0 16px; }
.review-verdict--passed { background: var(--color-accent-light); color: var(--color-accent); }
.review-verdict--changes-required { background: var(--color-primary-light); color: var(--color-primary); }
.review-cards { display: grid; gap: 12px; }
.review-card { padding: 18px; border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); background: var(--bg-color-paper); }
.review-card h4 { display: flex; align-items: center; gap: 8px; font: 600 17px var(--font-family-serif); color: var(--text-color-primary); margin: 0 0 10px; }
.review-card-mark { font: 12px var(--font-family); color: var(--color-accent); }
.review-card p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; margin: 0; }
.review-full-report { margin-top: 14px; padding: 12px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); }
.review-full-report summary { cursor: pointer; color: var(--text-color-tertiary); }
.review-full-report .banned-content { padding-top: 12px; }
.review-section:has(.review-cards) { border: 0; }
.review-section:has(.review-cards) > .review-section-title { background: transparent; padding: 0 0 12px; }
.review-section:has(.review-cards) > .review-section-content { padding: 0; }
.slide-right-enter-active, .slide-right-leave-active { transition: transform .2s ease, opacity .2s ease; }
.slide-right-enter-from, .slide-right-leave-to { transform: translateX(100%); opacity: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
