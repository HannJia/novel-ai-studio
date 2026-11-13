<template>
  <section class="entity-source-history" aria-label="设定来源与历史">
    <div class="history-heading">
      <div>
        <h3>设定来源与历史</h3>
        <p>作者保存的字段会作为作者全局设定；章节来源会根据当前正文重新核对。</p>
      </div>
      <span v-if="history.length" class="history-count">{{ history.length }} 条记录</span>
    </div>

    <div v-if="issues.length" class="source-issues" role="alert">
      <strong>有待核对的来源</strong>
      <ul>
        <li v-for="issue in groupedIssues" :key="issue.reason">
          {{ issue.fields.slice(0, 4).map(fieldLabel).join('、') }}{{ issue.fields.length > 4 ? '等 ' + issue.fields.length + ' 个字段' : '' }}：{{ reasonLabel(issue.reason) }}
        </li>
      </ul>
    </div>
    <p v-else-if="history.length" class="source-usable" role="status">当前来源均可使用</p>

    <div v-if="history.length" class="history-list">
      <details
        v-for="(item, index) in history"
        :open="index === 0"
        :key="item.revision.id"
        class="history-item"
        :class="{ 'history-item--invalid': item.issue }"
      >
        <summary class="history-item-heading">
          <div>
            <strong>{{ sourceLabel(item.revision.source) }}</strong>
            <span class="history-validity">{{ item.issue ? '来源失效（历史记录）' : '来源有效（历史记录）' }}</span>
          </div>
          <time :datetime="item.revision.appliedAt">{{ formatDate(item.revision.appliedAt) }}</time>
        </summary>

        <p v-if="item.issue" class="history-issue">{{ issueText(item.issue) }}</p>

        <div v-if="item.revision.source.kind === 'chapter'" class="history-evidence">
          <div class="history-source-meta">
            <span>第 {{ item.revision.source.chapterIndex + 1 }} 章</span>
            <n-button
              v-if="chapterById(item.revision.source.chapterId)"
              text
              size="tiny"
              type="primary"
              @click="$emit('open-chapter', item.revision.source.chapterId)"
            >查看章节</n-button>
          </div>
          <blockquote v-for="(evidence, index) in item.revision.source.evidence" :key="`${item.revision.id}-evidence-${index}`">
            {{ evidence.quote || '未提供原文片段' }}
          </blockquote>
        </div>

        <div class="history-changes" aria-label="字段原值与新值">
          <div v-for="change in item.revision.changes" :key="`${item.revision.id}-${change.field}`" class="history-change">
            <strong>{{ fieldLabel(change.field) }}</strong>
            <span>{{ formatValue(change.before, change.field) }}</span>
            <span aria-hidden="true">→</span>
            <span>{{ formatValue(change.after, change.field) }}</span>
          </div>
        </div>
      </details>
    </div>
    <p v-else class="history-empty">尚无字段变更记录；编辑保存当前表单中填写的字段后，会建立作者全局设定记录。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import { getEntityHistory, getEntitySourceIssues } from '@/services/entityProvenance'
import type { EntityFieldChange, EntityKind, EntitySource } from '@/types/entityProvenance'
import type { Novel } from '@/types/novel'

const props = defineProps<{
  novel: Novel
  kind: EntityKind
  entity: object
}>()

defineEmits<{
  (event: 'open-chapter', chapterId: string): void
}>()

const history = computed(() => getEntityHistory(props.novel, props.kind, props.entity).reverse())
const issues = computed(() => getEntitySourceIssues(props.novel, props.kind, props.entity))
const groupedIssues = computed(() => {
  const groups = new Map<string, string[]>()
  for (const issue of issues.value) {
    const fields = groups.get(issue.reason) || []
    if (!fields.includes(issue.field)) fields.push(issue.field)
    groups.set(issue.reason, fields)
  }
  return [...groups].map(([reason, fields]) => ({ reason, fields }))
})

const fieldLabels: Record<string, string> = {
  $exists: '对象存在性', name: '姓名', title: '标题', aliases: '别称', identity: '身份',
  personality: '性格', powerLevel: '实力', faction: '阵营', status: '状态',
  firstAppearChapter: '首次出场章节', description: '描述', relationships: '人物关系', events: '关键事件',
  characters: '相关角色', type: '事件类型', scope: '追踪范围', hintCount: '铺垫次数', storyTime: '故事内时间',
  location: '地点', chapterIndex: '发生章节', targetChapter: '预计推进章节', importance: '重要度',
  relatedArcIds: '关联弧线', lastProgressChapterIndex: '最近推进章节', resolvedChapterIndex: '兑现章节', evidence: '正文证据',
  goal: '剧情目标', conflict: '核心冲突', expectedResolution: '预期收束', dependencyArcIds: '前置剧情线',
  characterIds: '相关角色', initialState: '人物初始状态', desire: '渴望', fear: '恐惧', falseBelief: '错误信念', finalState: '预期成长',
  turningPointEventIds: '成长转折事件', prerequisiteNodeIds: '前置里程碑', consequenceEventIds: '后续事件', actualChapter: '实际发生章节', reactivateAt: '恢复条件',
}

const reasonLabels: Record<string, string> = {
  completion_without_chapter_evidence: '完成状态缺少有效的章节证据', prerequisite_unconfirmed: '前置里程碑未确认或来源已失效',
  evidence_missing: '缺少原文证据', evidence_not_found: '原文中找不到证据片段',
  evidence_ambiguous: '证据片段在原文中有多处匹配', evidence_ambiguous_duplicate: '证据片段重复且无法定位',
  evidence_offset_mismatch: '证据位置与正文不一致', chapter_missing: '来源章节不存在',
  chapter_index_mismatch: '来源章节序号已变化', source_version_mismatch: '来源章节正文已变化',
  future_source: '来源来自尚未到达的章节', raw_mismatch: '对象当前值与来源记录不一致',
  unconfirmed_field: '字段尚未被来源确认', entity_not_exists: '来源记录确认对象不存在',
  entity_existence_unconfirmed: '对象是否存在尚未确认', invalid_entity_name: '对象缺少有效名称',
  source_ai_without_provenance: 'AI 来源缺少可核对的来源记录', invalid_source: '来源记录无法核对',
}

function fieldLabel(field: string) { return fieldLabels[field] || '设定字段' }

function reasonLabel(reason: string) {
  return reason.split('|').map(item => reasonLabels[item] || '来源未通过核对').join('；')
}

function issueText(issue: string) { return reasonLabel(issue) }

function sourceLabel(source: EntitySource) {
  return source.kind === 'author' ? '作者全局设定' : '章节来源'
}

function chapterById(chapterId: string) {
  return props.novel.chapters.find(chapter => chapter.id === chapterId)
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function formatValue(value: EntityFieldChange['before'] | EntityFieldChange['after'], field: string) {
  if (value === undefined) return '未设置'
  const labels: Record<string, string> = field === 'scope' ? { chapter: '章节', volume: '分卷', global: '全书' }
    : field === 'status' ? { planted: '已埋设', developing: '推进中', resolved: '已解决', abandoned: '已放弃', unverified: '待核对', active: '推进中', paused: '暂停', completed: '已完成', pending: '待完成' }
      : field === 'type' && props.kind === 'arc' ? { main: '主线', sub: '支线', character: '人物成长', relationship: '关系', mystery: '悬念', world: '世界' } : {}
  if (typeof value === 'string' && labels[value]) return labels[value]
  if (typeof value === 'boolean') return value ? '已确认存在' : '不存在'
  if (typeof value === 'number' && ['firstAppearChapter', 'chapterIndex', 'targetChapter', 'actualChapter', 'lastProgressChapterIndex', 'resolvedChapterIndex'].includes(field)) return value < 0 ? '全书规划' : '第 ' + (value + 1) + ' 章'
  if (typeof value === 'string') return value || '空'
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join('、') || '空'
  try { return JSON.stringify(value) }
  catch { return String(value) }
}
</script>

<style scoped>
summary { cursor: pointer; }
details > :not(summary) { margin-top: 10px; }
.entity-source-history { display: grid; gap: 12px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border-color-light); }
.history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.history-heading h3 { margin: 0; font: 600 17px var(--font-family-serif); color: var(--text-color-primary); }
.history-heading p, .history-empty, .source-usable { margin: 4px 0 0; color: var(--text-color-tertiary); font-size: 12px; line-height: 1.6; }
.history-count, .history-validity { color: var(--text-color-tertiary); font-size: 11px; white-space: nowrap; }
.source-issues { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--color-warning) 45%, var(--border-color)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-warning) 8%, transparent); color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; }
.source-issues strong { color: var(--color-warning); }
.source-issues ul { margin: 4px 0 0; padding-left: 18px; }
.source-usable { color: var(--color-success); }
.history-list { display: grid; gap: 10px; }
.history-item { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); background: var(--bg-color-card); }
.history-item--invalid { border-color: color-mix(in srgb, var(--color-warning) 55%, var(--border-color)); background: color-mix(in srgb, var(--color-warning) 5%, var(--bg-color-card)); }
.history-item-heading, .history-source-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.history-item-heading { justify-content: space-between; }
.history-item-heading strong { color: var(--text-color-primary); font-size: 13px; }
.history-validity { color: var(--color-success); }
.history-item--invalid .history-validity { color: var(--color-warning); }
.history-item time { color: var(--text-color-tertiary); font-size: 11px; }
.history-issue { margin: 0; color: var(--color-warning); font-size: 12px; }
.history-source-meta { color: var(--text-color-secondary); font-size: 12px; }
.history-source-meta code { max-width: 100%; overflow: hidden; color: var(--text-color-tertiary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.history-evidence { display: grid; gap: 6px; }
.history-evidence blockquote { margin: 0; padding: 7px 9px; border-left: 3px solid var(--border-color-hover); background: var(--bg-color-hover); color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.history-changes { display: grid; gap: 4px; }
.history-change { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto minmax(0, 1fr); gap: 6px; align-items: baseline; font-size: 12px; line-height: 1.5; }
.history-change strong { color: var(--text-color-primary); }
.history-change span { color: var(--text-color-secondary); overflow-wrap: anywhere; }
@media (max-width: 520px) { .history-change { grid-template-columns: 1fr; gap: 2px; } .history-change span:nth-of-type(2) { display: none; } }
</style>
