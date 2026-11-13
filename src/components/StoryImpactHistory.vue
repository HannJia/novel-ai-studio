<template>
  <section class="impact-history" aria-label="设定影响记录">
    <div class="impact-heading"><h3>设定影响记录</h3><span>{{ filtered.length }} 次变更</span></div>
    <p class="impact-note">记录保存当时的依赖路径、直接关联和正文线索，帮助核对后续剧情。关联对象不会被自动改写；历史报告也不会随之后的修改重算。</p>
    <label class="impact-search">查找变更 <input v-model="query" aria-label="查找设定影响" placeholder="人物、事件或剧情线名称" /></label>
    <p v-if="!filtered.length">{{ query ? '没有匹配的变更记录。' : '尚无设定影响记录；保存人物、事件或剧情线变更后会记录在这里。' }}</p>
    <details v-for="report in visible" :key="report.id" class="impact-report">
      <summary><strong>{{ report.changes.map(change => change.target.label).join('、') }}</strong><time :datetime="report.createdAt">{{ new Date(report.createdAt).toLocaleString('zh-CN') }}</time><span>{{ report.affected.length }} 个结构关联 · 当时 {{ report.reviewChapterIds.length }} 章审核失效</span></summary>
      <ul class="impact-changes"><li v-for="(change, index) in report.changes" :key="index">{{ actionLabels[change.action] }} · {{ kindLabels[change.target.kind] }} · <router-link v-if="location(change.target)" :to="location(change.target)!">{{ change.target.label }}</router-link><span v-else>{{ change.target.label }}（当前已不存在）</span><small> · {{ [...new Set(change.fields.map(field => fieldLabels[field] || '其他设定'))].join('、') }}</small></li></ul>
      <p v-if="!report.reviewChapterIds.length" class="impact-policy">本次变更未使已有章节的审核失效。下列关联仅用于辅助核对，不表示已确认剧情矛盾。</p>
      <p v-else-if="report.reviewPolicy === 'changed-inputs'" class="impact-policy">本次按修改前后实际审核输入的差异确定重审章节；名单见下方记录。结构关联和正文线索不等同于重审范围，也不表示已确认剧情矛盾。</p>
      <p v-else class="impact-policy">本次采用全书保守审核策略：全部已写章节的旧审核失效。下列关联用于说明核对线索，不代表只有这些章节需要重审，也不表示已确认剧情矛盾。</p>
      <h4>依赖与关联（{{ report.affected.length }}）</h4>
      <p v-if="!report.affected.length">未找到当前支持的结构化引用；审核失效范围以本次保存的名单为准。</p>
      <ul class="impact-targets">
        <li v-for="item in report.affected.slice(0, limit(report.id, 'targets'))" :key="item.target.kind + ':' + item.target.id">
          <div><span class="impact-kind">{{ kindLabels[item.target.kind] }}</span> <router-link v-if="location(item.target)" :to="location(item.target)!">{{ item.target.label }}</router-link><strong v-else>{{ item.target.label }}（当前已不存在）</strong> <small>{{ item.depth === 1 ? '直接关联' : '经 ' + item.depth + ' 层引用' }}</small></div>
          <ul><li v-for="(reason, index) in item.reasons" :key="index">{{ reason.phase === 'before' ? '修改前' : '修改后' }}：{{ reason.from.label }} → {{ reason.relation }}<small v-if="reason.kind === 'association'">（仅关联，不继续传播）</small></li></ul>
        </li>
      </ul>
      <button v-if="report.affected.length > limit(report.id, 'targets')" type="button" @click="more(report.id, 'targets')">继续显示结构关联</button>
      <details class="impact-mentions"><summary>正文名称线索（{{ report.mentions.length }} 章，仅字面匹配）</summary>
        <p>正文中出现了改动对象的新旧姓名、别称或事件标题。可能包含同名或普通词语，不据此推断因果，也不沿名称命中继续传播。</p>
        <ul><li v-for="mention in report.mentions.slice(0, limit(report.id, 'mentions'))" :key="mention.chapter.id"><router-link v-if="location(mention.chapter)" :to="location(mention.chapter)!">{{ mention.chapter.label }}</router-link><span v-else>{{ mention.chapter.label }}（当前已不存在）</span>：{{ mention.terms.join('、') }}</li></ul>
        <button v-if="report.mentions.length > limit(report.id, 'mentions')" type="button" @click="more(report.id, 'mentions')">继续显示正文线索</button>
      </details>
      <details><summary>当时审核失效的章节（{{ report.reviewChapterIds.length }}）</summary>
        <p>这是保存时的记录；章节可能已在之后重新审核，当前状态请打开章节查看。</p>
        <ul><li v-for="chapterId in report.reviewChapterIds.slice(0, limit(report.id, 'reviews'))" :key="chapterId"><router-link v-if="chapterRef(chapterId)" :to="location(chapterRef(chapterId)!)!">{{ chapterRef(chapterId)!.label }}</router-link><span v-else>章节已删除</span></li></ul>
        <button v-if="report.reviewChapterIds.length > limit(report.id, 'reviews')" type="button" @click="more(report.id, 'reviews')">继续显示审核章节</button>
      </details>
    </details>
    <button v-if="filtered.length > visible.length" type="button" @click="visibleCount += 10">显示更早的变更</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot } from '@/types/reconstruction'
import type { StoryImpactRef, StoryImpactReport, StoryImpactKind } from '@/types/storyImpact'
import { storyImpactLocation } from '@/services/storyImpactLocation'
const props = defineProps<{ novel: Novel; reports: StoryImpactReport[]; workspace?: Pick<ReconstructionWorkspaceSnapshot, 'creationDraft' | 'storyMemories'>; rootKind?: StoryImpactKind }>()
const query = ref(''), visibleCount = ref(10), limits = ref(new Map<string, number>())
const kindLabels: Record<StoryImpactKind, string> = { novel: '作品设定', volume: '分卷', character: '人物', event: '事件', arc: '剧情线', node: '里程碑', plan: '章节计划', scene: '场景', chapter: '章节', memory: '故事回顾' }
const actionLabels = { create: '新增', update: '编辑／确认', delete: '删除', confirm: '状态确认' }
const fieldLabels: Record<string, string> = { $exists: '对象新增／删除', name: '姓名', title: '标题', aliases: '别称', identity: '身份', personality: '性格', powerLevel: '实力', faction: '阵营', status: '状态', firstAppearChapter: '首次出场', description: '说明', relationships: '人物关系', events: '关键事件', characters: '参与人物', type: '类型', scope: '追踪范围', hintCount: '铺垫次数', storyTime: '故事时间', location: '地点', chapterIndex: '发生章节', targetChapter: '计划章节', importance: '重要度', relatedArcIds: '关联剧情线', lastProgressChapterIndex: '最近推进章节', resolvedChapterIndex: '实际回收章节', goal: '目标', conflict: '冲突', expectedResolution: '预期收束', dependencyArcIds: '前置剧情线', characterIds: '相关人物', initialState: '初始状态', desire: '渴望', fear: '恐惧', falseBelief: '错误信念', finalState: '预期成长', turningPointEventIds: '转折事件', prerequisiteNodeIds: '前置里程碑', consequenceEventIds: '后续事件', actualChapter: '实际章节', reactivateAt: '恢复条件', evidence: '原文证据' }
const filtered = computed(() => props.reports.filter(report => report.novelId === props.novel.id
  && (!props.rootKind || report.changes.some(change => change.target.kind === props.rootKind))
  && (!query.value.trim() || [...report.changes.map(change => change.target.label), ...report.affected.map(item => item.target.label), ...report.mentions.flatMap(item => item.terms)]
    .some(label => label.includes(query.value.trim())))).slice().reverse())
const visible = computed(() => filtered.value.slice(0, visibleCount.value))
watch([query, () => props.novel.id], () => { visibleCount.value = 10; limits.value.clear() })
const location = (target: StoryImpactRef) => storyImpactLocation(props.novel, target, props.workspace)
function chapterRef(id: string): StoryImpactRef | undefined {
  const chapter = props.novel.chapters.find(chapter => chapter.id === id)
  return chapter ? { kind: 'chapter', id, label: '第 ' + (chapter.chapterIndex + 1) + ' 章 ' + chapter.title } : undefined
}
const limit = (id: string, section: string) => limits.value.get(JSON.stringify([id, section])) || 30
function more(id: string, section: string) { limits.value.set(JSON.stringify([id, section]), limit(id, section) + 30) }
</script>

<style scoped>
.impact-history { padding: 16px; color: var(--text-primary); }
.impact-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.impact-heading h3 { margin: 0; }
.impact-note, .impact-policy, small, time { color: var(--text-secondary); }
.impact-search { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 16px 0; }
.impact-search input { padding: 8px 10px; color: inherit; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 6px; max-width: 100%; }
.impact-report { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin: 10px 0; overflow-wrap: anywhere; }
.impact-report > summary { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; }
summary { cursor: pointer; }
.impact-report > summary strong { flex: 1; min-width: 120px; }
.impact-report > summary > span { width: 100%; color: var(--text-secondary); }
.impact-targets { padding-left: 20px; }
.impact-targets > li { margin: 14px 0; }
.impact-targets ul, .impact-mentions { color: var(--text-secondary); }
.impact-kind { font-size: 12px; color: var(--text-secondary); }
a { color: var(--accent-primary); text-decoration: underline; }
button { cursor: pointer; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-primary); color: inherit; padding: 6px 12px; margin: 8px 0; }
@media (max-width: 600px) { .impact-history { padding: 10px; } .impact-targets ul { padding-left: 16px; } }
</style>
