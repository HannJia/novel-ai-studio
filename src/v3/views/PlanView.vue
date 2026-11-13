<template>
  <Teleport defer to="#v3-crumb"><router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">结构与规划</span></Teleport>
  <Teleport defer to="#v3-tools"><button v-if="activeTab !== 'overview'" class="m-btn sm" type="button" @click="selectTab('overview')">结构总览</button><button class="m-btn sm" type="button" @click="selectTab('outline')">总纲编辑</button><button class="m-btn sm" type="button" @click="openPlanner('plans')">规划工作台</button></Teleport>
  <div v-if="loading" class="plan-state">正在读取结构规划…</div>
  <div v-else-if="error" class="plan-state error">{{ error }}</div>
  <div v-else-if="!novel" class="plan-state error">作品不存在。</div>
  <div v-else class="plan-page" :class="{ 'is-overview': activeTab === 'overview' }">
    <header v-if="activeTab !== 'overview'" class="plan-head"><div><div class="eyebrow">PLAN · {{ novel.title }}</div><h1>结构与规划</h1><p>完整规划工作台保留编辑、版本、多方案与草稿恢复。</p></div></header>
    <nav v-if="activeTab !== 'overview'" class="plan-tabs" aria-label="规划视图"><button v-for="item in tabs" :key="item.id" type="button" :class="{ on: activeTab === item.id }" :aria-current="activeTab === item.id ? 'page' : undefined" @click="selectTab(item.id)">{{ item.label }}<b v-if="item.count">{{ item.count }}</b></button></nav>

    <section v-if="activeTab === 'overview'" class="plan-layout" aria-label="结构与规划三栏总览">
      <aside class="structure-side" aria-label="五层结构">
        <div class="structure-head"><h2>五层结构</h2><button class="m-ibtn" type="button" aria-label="打开完整规划工作台" @click="openPlanner('plans')"><V3Icon name="plus" size="s" /></button></div>
        <div class="structure-tree">
          <button type="button" class="tree-item tree-book" :class="{ on: selectionKind === 'book' }" :aria-pressed="selectionKind === 'book'" @click="selectBook"><span class="level">L1</span><V3Icon name="book" size="s" /><span class="tree-label">《{{ novel.title }}》· 全书骨架</span></button>
          <div v-for="group in treeGroups" :key="group.index" class="tree-group">
            <div class="tree-volume" :class="{ on: selectionKind === 'volume' && selectedVolumeIndex === group.index }">
              <button type="button" class="tree-toggle" :aria-label="(collapsedVolumes.includes(group.index) ? '展开' : '收起') + group.title" :aria-expanded="!collapsedVolumes.includes(group.index)" @click="toggleVolume(group.index)"><V3Icon :name="collapsedVolumes.includes(group.index) ? 'chevR' : 'chevD'" size="s" /></button>
              <button type="button" class="tree-item" :aria-pressed="selectionKind === 'volume' && selectedVolumeIndex === group.index" @click="selectVolume(group.index)"><span class="level">L2</span><span class="tree-label">{{ group.title }}</span></button>
            </div>
            <template v-if="!collapsedVolumes.includes(group.index)">
              <div v-for="row in group.chapters" :key="row.index">
                <button type="button" class="tree-item tree-chapter" :class="{ on: selectionKind === 'chapter' && selectedIndex === row.index }" :data-chapter-index="row.index" :aria-pressed="selectionKind === 'chapter' && selectedIndex === row.index" @click="selectChapter(row.index)"><span class="level">L3</span><i class="chapter-dot" :class="row.chapter?.status || 'planned'" :title="chapterState(row.chapter)" /><span class="tree-label">{{ row.index + 1 }} {{ row.title }}</span></button>
                <template v-if="selectionKind === 'chapter' && selectedIndex === row.index">
                  <button v-for="scene in row.scenes" :key="scene.id" type="button" class="tree-item tree-scene" :class="{ on: selectedSceneId === scene.id }" :title="scene.approved ? '已批准的场景计划，不代表已写' : '未批准场景草稿'" :aria-pressed="selectedSceneId === scene.id" @click="selectScene(scene.id)"><span class="level">L4</span><span class="tree-label">{{ scene.title }}</span><span v-if="!scene.approved" class="draft-dot">草</span></button>
                </template>
              </div>
              <p v-if="!group.chapters.length" class="tree-empty">尚无章节或单章计划</p>
            </template>
          </div>
          <div v-if="rangePlans.length" class="range-plans"><h3>跨章规划</h3><button v-for="plan in rangePlans" :key="plan.id" type="button" @click="openPlanner('plans', plan.id)"><span>{{ plan.targetChapterStart + 1 }}–{{ plan.targetChapterEnd + 1 }}</span>{{ plan.title }}</button></div>
          <p v-if="!treeGroups.length" class="tree-empty">还没有分卷与章节。可先建立规划，不必生成正文。</p>
        </div>
        <div class="structure-actions"><button type="button" @click="openPlanner('volumes')">分卷</button><button type="button" @click="openPlanner('plans')">章纲</button><button type="button" @click="openPlanner('arcs')">弧线</button><button type="button" @click="openPlanner('timeline')">事件</button></div>
      </aside>

      <main class="plan-board" aria-label="情节线与伏笔">
        <div class="plan-section-heading"><div><h2>情节线</h2><p>{{ timelineRange }} · 实心为有效发生节点，虚线为计划；点击查看章节。</p></div><div class="scope-switch" aria-label="情节线范围"><button type="button" :class="{ on: timelineScope === 'volume' }" :disabled="!selectedGroup" :aria-pressed="timelineScope === 'volume'" @click="timelineScope = 'volume'">{{ selectedGroup?.title || '分卷' }}</button><button type="button" :class="{ on: timelineScope === 'book' }" :aria-pressed="timelineScope === 'book'" @click="timelineScope = 'book'">全书</button></div></div>
        <div v-if="arcLanes.length && timelineColumns.length" class="m-panel lane-panel" tabindex="0" aria-label="情节线章节轨道，可横向滚动">
          <div class="lane-grid" :style="{ gridTemplateColumns: `136px repeat(${timelineColumns.length}, minmax(34px, 1fr))`, minWidth: (136 + timelineColumns.length * 34) + 'px' }">
            <span /><button v-for="index in timelineColumns" :key="index" type="button" class="chapter-tick" :class="{ on: selectedIndex === index && selectionKind === 'chapter' }" :aria-label="'查看第' + (index + 1) + '章'" @click="selectChapter(index)">{{ index + 1 }}</button>
            <template v-for="lane in arcLanes" :key="lane.id">
              <button type="button" class="lane-name" :style="{ '--lane-color': lane.color }" :title="lane.title + ' · 编辑弧线'" @click="openPlanner('arcs', lane.id)"><i /><span>{{ lane.title }}</span><small v-if="lane.unverified">待核对</small></button>
              <div v-for="index in timelineColumns" :key="index" class="lane-cell" :class="{ linked: lane.start !== undefined && index >= lane.start && index <= lane.end! }" :style="{ '--lane-color': lane.color }">
                <button v-for="node in lane.nodes.filter(item => item.index === index)" :key="node.id" type="button" class="arc-node" :class="{ actual: node.actual, planned: !node.actual, uncertain: node.unverified }" :data-node-id="node.id" :aria-label="node.title + ' · 第' + (index + 1) + '章 · ' + (node.actual ? '有效发生记录' : node.unverified ? '待核对节点' : '计划节点')" :title="node.title + ' · ' + (node.actual ? '有效发生记录' : node.unverified ? '待核对，非已发生' : '计划，非已发生')" @click="selectChapter(index)"><span class="node-tip">{{ node.title }} · {{ node.actual ? '已发生' : node.unverified ? '待核对' : '计划' }}</span></button>
              </div>
            </template>
          </div>
        </div>
        <div v-else class="m-panel board-empty"><V3Icon name="layers" size="l" /><h3>{{ arcLanes.length ? '暂无可定位的节点' : '还没有故事弧线' }}</h3><p>建立情节线与预计章节；只有有效的正文来源才能标为已发生。</p><button class="m-btn sm" type="button" @click="openPlanner('arcs')">规划故事弧线</button></div>
        <p v-if="projectionIssueCount" class="projection-notice">{{ projectionIssueCount }} 处来源或字段待核对；旧记录保留在工作台，不作为有效发生节点。</p>

        <div class="plan-section-heading foreshadow-heading"><div><h2>伏笔追踪</h2><p>第 1–{{ lastTimelineIndex + 1 }} 章刻度 · 红线为所选章；埋设、最近推进与回收分别记录。</p></div><button class="m-btn sm" type="button" @click="openPlanner('timeline')"><V3Icon name="plus" size="s" />登记伏笔</button></div>
        <div v-if="foreshadowRows.length" class="m-panel foreshadow-panel" tabindex="0" aria-label="伏笔追踪轨道，可横向滚动">
          <div class="foreshadow-chart">
            <div v-for="item in foreshadowRows" :key="item.id" class="fs-row" :data-event-id="item.id">
              <button type="button" class="fs-name" @click="openPlanner('timeline', item.id)">{{ item.title }}</button>
              <div class="fs-track">
                <span v-if="item.start !== undefined && item.end !== undefined" class="fs-bar" :style="{ left: position(item.start), width: spanWidth(item.start, item.end) }" />
                <span v-if="item.target !== undefined && item.end !== undefined && item.target > item.end" class="fs-bar planned" :style="{ left: position(item.end), width: spanWidth(item.end, item.target) }" />
                <span v-if="selectionKind === 'chapter'" class="now-line" :style="{ left: position(selectedIndex) }" />
                <button v-for="point in item.points" :key="point.kind" type="button" class="fs-point" :class="point.kind" :style="{ left: position(point.index) }" :data-point-kind="point.kind" :title="'第' + (point.index + 1) + '章 · ' + point.label" :aria-label="item.title + ' · 第' + (point.index + 1) + '章 · ' + point.label" @click="selectChapter(point.index)" />
              </div>
              <span class="track-tag" :class="item.tone">{{ item.label }}</span>
            </div>
            <div class="fs-row fs-axis"><span /><div class="fs-track"><span v-for="index in scaleTicks" :key="index" :style="{ left: position(index) }">{{ index + 1 }}</span></div><span /></div>
          </div>
        </div>
        <div v-else class="m-panel board-empty"><h3>尚未登记伏笔</h3><p>预计推进/回收使用虚线，未记录的推进不会自动补齐。</p><button class="m-btn sm" type="button" @click="openPlanner('timeline')">打开事件与伏笔</button></div>
        <div class="board-links"><button type="button" @click="selectTab('chapters')">下一章 / 近期 / 远期</button><button type="button" @click="openPlanner('proposals')">状态提案</button><button type="button" @click="openPlanner('relay')">剧情接力</button><button type="button" @click="openPlanner('memory')">项目记忆与回顾</button></div>
      </main>

      <aside ref="detailElement" class="plan-detail" aria-label="当前结构详情" aria-live="polite">
        <template v-if="selectionKind === 'book'"><div class="eyebrow">全书 · 骨架与方向</div><h2>{{ novel.title }}</h2><template v-if="selectedSkeleton"><span class="track-tag" :class="skeletonApproved ? 'qing' : 'jin'">{{ skeletonApproved ? '已批准骨架 · 计划' : '骨架待确认' }}</span><h3 class="skeleton-title">{{ selectedSkeleton.title }}</h3><dl class="detail-fields"><dt>核心构想</dt><dd>{{ selectedSkeleton.logline || selectedSkeleton.premise || '未记录' }}</dd><dt>读者承诺</dt><dd>{{ selectedSkeleton.promise || '未记录' }}</dd><dt>结局方向</dt><dd>{{ selectedSkeleton.ending || '未记录' }}</dd></dl><ol v-if="selectedSkeleton.beats.length" class="skeleton-beats"><li v-for="beat in selectedSkeleton.beats" :key="beat.id"><strong>{{ beat.title }}</strong><p>{{ beat.description }}</p></li></ol></template><p class="detail-prose">{{ novel.outline || (selectedSkeleton ? '尚未单独保存全书总纲文字。' : '还没有全书总纲。') }}</p><div class="detail-principle">骨架与章纲属于创作计划，不是已发生的故事事实。</div><div class="detail-actions"><button class="m-btn zhu" type="button" @click="selectTab('outline')">编辑总纲</button><router-link class="m-btn" :to="'/generate/' + novel.id">契约与骨架</router-link></div></template>
        <template v-else-if="selectionKind === 'volume'"><div class="eyebrow">分卷 · {{ selectedGroup?.title || '未分卷' }}</div><h2>{{ selectedGroup?.title || '未分卷' }}</h2><dl class="detail-fields"><dt>分卷主题</dt><dd>{{ selectedVolume?.theme || '未记录' }}</dd><dt>剧情概要</dt><dd>{{ selectedVolume?.summary || '未记录' }}</dd><dt>关键转折</dt><dd>{{ selectedVolume?.keyTurningPoints || '未记录' }}</dd><dt>人物变化</dt><dd>{{ selectedVolume?.characterChanges || '未记录' }}</dd><dt>章节</dt><dd>{{ selectedGroup?.chapters.filter(row => row.chapter).length || 0 }} 章已建立<span v-if="selectedVolume"> · 预计 {{ selectedVolume.estimatedChapters }} 章</span></dd></dl><p class="detail-principle">卷级目标、转折和预计章节均为规划，不代表已写或已发生。</p><button class="m-btn zhu" type="button" @click="openPlanner('volumes')">编辑分卷</button></template>
        <template v-else>
          <div class="eyebrow">第 {{ selectedIndex + 1 }} 章 · 章纲</div><h2>{{ selectedRow?.title || '尚未创建章节' }}</h2>
          <div class="detail-tags"><span class="track-tag">{{ chapterState(selectedRow?.chapter) }}</span><span v-if="detailPlan || selectedLegacyPlan" class="track-tag" :class="detailPlanApproved ? 'qing' : 'jin'">{{ detailPlanApproved ? '已批准规划' : '待确认章纲' }}</span><span v-if="selectedRow?.chapter" class="detail-word-count">{{ selectedRow.chapter.wordCount.toLocaleString() }} 字</span></div>
          <dl v-if="detailPlan || selectedLegacyPlan" class="detail-fields chapter-fields"><template v-for="field in detailFields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value || '未记录' }}</dd></template></dl>
          <p v-else class="detail-prose muted">尚无单章章纲。跨章规划不会被当作本章已确认计划。</p>
          <p class="plan-source-note">{{ detailPlanApproved ? '以下为作者批准的创作计划，不代表故事事实。' : '未批准的章纲与场景仅作草稿参考，不进入已确认写作约束。' }}</p>
          <div class="detail-section-title">场景 · {{ selectedRow?.scenes.length || 0 }}<button type="button" @click="editScenes">编辑与方案</button></div>
          <button v-for="(scene, index) in selectedRow?.scenes || []" :key="scene.id" type="button" class="scene-card m-panel" :class="{ selected: selectedSceneId === scene.id }" :data-scene-id="scene.id" @click="selectScene(scene.id)"><span class="scene-card-head">场景 {{ index + 1 }}<span class="track-tag" :class="scene.approved ? 'qing' : 'jin'">{{ scene.approved ? '已批准 · 计划' : '待确认' }}</span></span><strong>{{ scene.title }}</strong><p>{{ scene.purpose }}</p><p v-if="selectedSceneId === scene.id" class="scene-output">结束状态：{{ scene.outputState || '未记录' }}</p></button>
          <p v-if="!selectedRow?.scenes.length" class="detail-empty">还没有场景方案；已有正文或场景笔记不等于场景计划已批准。</p>
          <details v-if="selectedRow?.chapter?.sceneNotes?.length" class="scene-notes"><summary>场景笔记 · {{ selectedRow.chapter.sceneNotes.length }}（非场景方案）</summary><p v-for="note in selectedRow.chapter.sceneNotes" :key="note.id"><strong>{{ note.title }}</strong><br />{{ note.content }}</p></details>
          <div v-if="selectedRangePlans.length" class="detail-ranges"><h3>覆盖本章的跨章规划</h3><button v-for="plan in selectedRangePlans" :key="plan.id" type="button" @click="openPlanner('plans', plan.id)">第 {{ plan.targetChapterStart + 1 }}–{{ plan.targetChapterEnd + 1 }} 章 · {{ plan.title }}</button></div>
          <div class="detail-principle"><h3><V3Icon name="alert" size="s" />修改规划时</h3><p>保存仍经影响分析事务；实际影响记录在工作台查看，不预造“需重审章节”。</p><button type="button" @click="openPlanner('impacts')">查看真实影响记录</button></div>
          <div class="detail-actions"><router-link v-if="selectedRow?.chapter" class="m-btn zhu" :to="'/write/' + novel.id + '/' + selectedRow.chapter.id">打开正文</router-link><button class="m-btn" type="button" @click="editScenes">章纲与场景</button><button v-if="selectedLegacyPlan" class="m-link" type="button" @click="openPlanner('plans', selectedLegacyPlan.id)">编辑章节计划</button></div>
        </template>
      </aside>
    </section>

    <section v-else-if="activeTab === 'outline'" class="m-panel outline-panel"><div class="panel-head"><div><h2>全书总纲</h2><p>保存仍走影响分析事务，修改后相关章节审核会按真实依赖失效。</p></div><div class="panel-actions"><button v-if="!editingOutline" class="m-btn xs" type="button" @click="startOutline">编辑</button><button v-else class="m-btn xs zhu" type="button" :disabled="outlineSaving" @click="saveOutline">{{ outlineSaving ? '保存中…' : '保存总纲' }}</button></div></div><p v-if="outlineError" class="outline-error" role="alert">{{ outlineError }}；输入已保留，可重试保存。</p><textarea v-if="editingOutline" v-model="outlineDraft" class="outline-editor" rows="18" aria-label="全书总纲草稿" /><div v-else class="outline-body">{{ novel.outline || '还没有总纲。可以从完整规划页开始建立全书方向。' }}</div></section>

    <section v-else-if="activeTab === 'volumes'" class="card-list"><article v-for="volume in novel.volumes" :key="volume.id" class="m-panel planning-card"><div><span class="card-kicker">第{{ volume.volumeIndex + 1 }}卷</span><h2>{{ volume.title || '未命名分卷' }}</h2><p>{{ volume.summary || '暂无分卷概要。' }}</p><small>预计 {{ volume.estimatedChapters }} 章 · {{ volume.estimatedWordCount }} 万字</small></div><button class="m-link" type="button" @click="openPlanner('volumes')">编辑分卷</button></article><div v-if="!novel.volumes.length" class="empty m-panel"><p>还没有分卷规划。</p><button class="m-btn zhu" type="button" @click="openPlanner('volumes')">开始规划分卷</button></div></section>

    <section v-else-if="activeTab === 'chapters'" class="plan-columns"><article v-for="horizon in horizons" :key="horizon.id" class="m-panel horizon-panel"><div class="panel-head"><div><h2>{{ horizon.label }}</h2><p>{{ horizon.description }}</p></div><span>{{ plansByHorizon(horizon.id).length }}</span></div><article v-for="plan in plansByHorizon(horizon.id)" :key="plan.id" class="plan-row"><strong>{{ plan.title }}</strong><small>第{{ plan.targetChapterStart + 1 }}–{{ plan.targetChapterEnd + 1 }}章 · {{ planStatusLabel(plan.status) }}</small><p>{{ plan.objective || plan.summary }}</p><button class="m-link" type="button" @click="openPlanner('plans', plan.id)">编辑计划</button></article><div v-if="!plansByHorizon(horizon.id).length" class="empty"><p>暂无计划。</p><button class="m-btn zhu" type="button" @click="openPlanner('plans')">创建章节计划</button></div></article></section>

    <section v-else-if="activeTab === 'arcs'" class="card-list">
      <article v-for="arc in arcCards" :key="arc.id" class="m-panel planning-card">
        <div><span class="card-kicker">{{ arcTypeLabel(arc.type) }} · {{ arcStatusLabel(arc.status) }}</span><h2>{{ arc.title }}</h2><p>{{ arc.description || '暂无弧线描述。' }}</p><small>{{ arc.nodeCount }} 个节点 · 重要度 {{ arc.importance ?? '待核对' }}</small><p v-if="arc.unverified" class="entity-source-notice">来源待核对，请打开编辑核对原记录。</p></div>
        <button class="m-link" type="button" @click="openPlanner('arcs', arc.id)">编辑弧线</button>
      </article>
      <div v-if="!arcCards.length" class="empty m-panel"><p>还没有故事弧线。</p><button class="m-btn zhu" type="button" @click="openPlanner('arcs')">创建故事弧线</button></div>
    </section>

    <section v-else-if="activeTab === 'events'" class="event-columns"><article class="m-panel event-panel"><div class="panel-head"><div><h2>事件与伏笔</h2><p>伏笔使用埋设、最近推进、计划回收和实际回收四个节点。</p></div><button class="m-link" type="button" @click="openPlanner('timeline')">编辑事件</button></div><article v-for="event in events" :key="event.id" class="event-row"><div class="event-marker" :class="event.type === '伏笔' ? 'zhu' : ''" /><div><span class="card-kicker">{{ event.type }} · {{ eventStatusLabel(event.status) }}</span><h3>{{ event.title }}</h3><p>{{ event.description }}</p><div class="event-meta"><small>{{ event.chapterIndex < 0 ? '全书规划' : `第${event.chapterIndex + 1}章` }}<span v-if="event.targetChapter !== undefined"> · 计划第{{ event.targetChapter + 1 }}章推进</span></small><button class="m-link" type="button" @click="openPlanner('timeline', event.id)">编辑事件</button></div></div></article><div v-if="!events.length" class="empty"><p>还没有事件记录。</p><button class="m-btn zhu" type="button" @click="openPlanner('timeline')">添加事件</button></div></article><article class="m-panel event-panel"><div class="panel-head"><div><h2>伏笔追踪</h2><p>按真实事件字段显示推进和回收状态。</p></div></div><article v-for="event in foreshadowings" :key="event.id" class="foreshadow-row"><strong>{{ event.title }}</strong><div class="four-points"><span :class="{ on: event.chapterIndex >= 0 && event.status !== 'unverified' }">埋设</span><span :class="{ on: event.lastProgressChapterIndex !== undefined && event.status !== 'unverified' }">最近推进</span><span :class="{ on: event.targetChapter !== undefined }">计划推进/回收</span><span :class="{ on: event.status === 'resolved' && event.resolvedChapterIndex !== undefined }">实际回收</span></div><small>{{ event.hintCount || 0 }} 次提及</small></article><div v-if="!foreshadowings.length" class="empty">还没有伏笔。</div></article></section>
    <section v-else class="planner-workbench"><StoryPlanner :embedded="true" :initial-tab="plannerTab" :initial-selection="plannerSelection" @tab-change="onPlannerTabChange" @navigate="target => openPlanner(target.tab, target.selection)" /></section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { projectCanonicalEntities } from '@/services/entityProvenance'
import { syncCreationDraftPlanning } from '@/services/reconstructionCreation'
import { getApprovedPlanning } from '@/services/reconstructionPlanning'
import StoryPlanner from '@/views/workspace/StoryPlanner.vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import type { Chapter, ChapterPlanHorizon, ChapterPlanStatus, StoryArcType, StoryArcStatus, EventLogEntry } from '@/types/novel'

defineOptions({ name: 'V3PlanView' })
const route = useRoute(), router = useRouter(), novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const novel = computed(() => novels.getNovel(novelId.value))
type PlanTab = 'overview' | 'outline' | 'volumes' | 'chapters' | 'arcs' | 'events' | 'workbench'
const loading = ref(true), error = ref(''), activeTab = ref<PlanTab>('overview'), plannerTab = ref('plans'), plannerSelection = ref('')
const editingOutline = ref(false), outlineDraft = ref(''), outlineSaving = ref(false), outlineError = ref('')
const selectionKind = ref<'book' | 'volume' | 'chapter'>('chapter'), selectedIndex = ref(0), selectedVolumeIndex = ref(-1), selectedSceneId = ref('')
const collapsedVolumes = ref<number[]>([]), timelineScope = ref<'volume' | 'book'>('volume'), detailElement = ref<HTMLElement>()
const planTabs = new Set<PlanTab>(['overview', 'outline', 'volumes', 'chapters', 'arcs', 'events', 'workbench'])
const tabs = computed(() => [
  { id: 'overview' as const, label: '总览', count: 0 }, { id: 'outline' as const, label: '总纲', count: novel.value?.outline.trim() ? 1 : 0 },
  { id: 'volumes' as const, label: '分卷', count: novel.value?.volumes.length || 0 }, { id: 'chapters' as const, label: '章纲', count: novel.value?.chapterPlans?.length || 0 },
  { id: 'arcs' as const, label: '弧线', count: novel.value?.storyArcs?.length || 0 }, { id: 'events' as const, label: '事件与伏笔', count: novel.value?.eventLog.length || 0 },
  { id: 'workbench' as const, label: '规划工作台', count: 0 },
])
const horizons: Array<{ id: ChapterPlanHorizon; label: string; description: string }> = [{ id: 'next', label: '下一章', description: '当前写作现场的直接计划' }, { id: 'near', label: '近期', description: '接下来几章的推进路径' }, { id: 'far', label: '远期', description: '未来卷章和收束方向' }]
const projection = computed(() => novel.value ? projectCanonicalEntities(novel.value) : { events: [], arcs: [], issues: [] })
const projectionIssueCount = computed(() => projection.value.issues.length)
const arcCards = computed(() => (novel.value?.storyArcs || []).map(raw => {
  const current = projection.value.arcs.find(arc => arc.id === raw.id)
  const ids = new Set([raw.id, ...raw.nodes.map(node => node.id)])
  return { id: raw.id, title: current?.title || raw.title, type: current?.type, status: current?.status ?? ('unverified' as const),
    description: current?.description || current?.goal || '', nodeCount: current?.nodes.length || 0, importance: current?.importance,
    unverified: !current || projection.value.issues.some(issue => ids.has(issue.entityId)) }
}))
const events = computed(() => [...projection.value.events].sort((a, b) => a.chapterIndex - b.chapterIndex || a.title.localeCompare(b.title)))
const foreshadowings = computed(() => events.value.filter(event => event.type === '伏笔'))
const livePlans = computed(() => (novel.value?.chapterPlans || []).filter(plan => plan.status !== 'archived'))
const rangePlans = computed(() => livePlans.value.filter(plan => plan.targetChapterStart !== plan.targetChapterEnd))
const planningDraft = computed(() => {
  const draft = workspace.getCreationDraft(novelId.value)
  return draft && novel.value ? syncCreationDraftPlanning(draft, novel.value, draft.updatedAt) : undefined
})
const selectedSkeleton = computed(() => planningDraft.value?.skeletons.find(skeleton => skeleton.id === planningDraft.value?.selectedSkeletonId))
const skeletonApproved = computed(() => !!selectedSkeleton.value && !!getApprovedPlanning(planningDraft.value, 0))
const chapterRows = computed(() => {
  const indices = new Set((novel.value?.chapters || []).map(chapter => chapter.chapterIndex))
  livePlans.value.filter(plan => plan.targetChapterStart === plan.targetChapterEnd).forEach(plan => indices.add(plan.targetChapterStart))
  return [...indices].sort((a, b) => a - b).map(index => {
    const chapter = novel.value?.chapters.find(item => item.chapterIndex === index)
    const legacy = livePlans.value.find(plan => plan.targetChapterStart === index && plan.targetChapterEnd === index)
    const plans = (planningDraft.value?.chapterPlans || []).filter(plan => plan.number === index + 1 && (plan.endNumber ?? plan.number) === plan.number && plan.status !== 'archived')
    const approved = getApprovedPlanning(planningDraft.value, index)?.chapters.filter(plan => plan.number === index + 1 && (plan.endNumber ?? plan.number) === plan.number) || []
    const approvedScenes = new Set(approved.flatMap(plan => plan.scenes.map(scene => scene.id)))
    const scenes = (planningDraft.value?.scenePlans || []).filter(scene => scene.approval !== 'rejected' && plans.some(plan => plan.id === scene.chapterPlanId && plan.scenePlanIds.includes(scene.id)))
      .sort((a, b) => a.order - b.order).map(scene => ({ ...scene, approved: approvedScenes.has(scene.id) }))
    const volume = novel.value?.volumes.find(item => 'volume-v2:' + item.id === plans[0]?.volumeId)
    return { index, chapter, title: chapter?.title || legacy?.title || '未命名章节', volumeIndex: chapter?.volumeIndex ?? volume?.volumeIndex ?? -1, scenes }
  })
})
const treeGroups = computed(() => {
  const groups = [...(novel.value?.volumes || [])].sort((a, b) => a.volumeIndex - b.volumeIndex).map(volume => ({ index: volume.volumeIndex,
    title: '卷' + (volume.volumeIndex + 1) + ' ' + volume.title, chapters: chapterRows.value.filter(row => row.volumeIndex === volume.volumeIndex) }))
  const unassigned = chapterRows.value.filter(row => !groups.some(group => group.index === row.volumeIndex))
  if (unassigned.length) groups.push({ index: -1, title: '未分卷', chapters: unassigned })
  return groups
})
const selectedRow = computed(() => chapterRows.value.find(row => row.index === selectedIndex.value))
const selectedGroup = computed(() => selectionKind.value === 'book' ? undefined : treeGroups.value.find(group => selectionKind.value === 'volume'
  ? group.index === selectedVolumeIndex.value : group.chapters.some(row => row.index === selectedIndex.value)))
const selectedVolume = computed(() => novel.value?.volumes.find(volume => volume.volumeIndex === selectedGroup.value?.index))
const approvedSelection = computed(() => getApprovedPlanning(planningDraft.value, selectedIndex.value))
const detailPlan = computed(() => {
  const exact = (planningDraft.value?.chapterPlans || []).filter(plan => plan.number === selectedIndex.value + 1 && (plan.endNumber ?? plan.number) === plan.number && plan.status !== 'archived')
  return exact.find(plan => approvedSelection.value?.chapters.some(approved => approved.id === plan.id)) || exact[0]
})
const detailPlanApproved = computed(() => !!detailPlan.value && !!approvedSelection.value?.chapters.some(plan => plan.id === detailPlan.value!.id))
const selectedLegacyPlan = computed(() => livePlans.value.find(plan => 'chapter-plan-v2:' + plan.id === detailPlan.value?.id)
  || livePlans.value.find(plan => plan.targetChapterStart === selectedIndex.value && plan.targetChapterEnd === selectedIndex.value))
const selectedRangePlans = computed(() => rangePlans.value.filter(plan => plan.targetChapterStart <= selectedIndex.value && plan.targetChapterEnd >= selectedIndex.value))
const detailFields = computed(() => {
  const plan = detailPlan.value, legacy = selectedLegacyPlan.value
  const related = plan?.foreshadowingIds || legacy?.relatedEventIds || []
  return [{ label: '章节目标', value: plan?.objective || legacy?.objective }, { label: '核心事件', value: (plan?.requiredEvents || legacy?.beats || []).join('；') },
    { label: '人物变化', value: plan?.characterChangeNotes.join('；') }, { label: '关联伏笔', value: related.map(id => novel.value?.eventLog.find(event => event.id === id)?.title).filter(Boolean).join('、') },
    { label: '结尾状态', value: plan?.endingState }, { label: '禁止揭露', value: plan?.prohibitedReveals.join('；') }]
})
const validIndex = (value: number | undefined): value is number => Number.isInteger(value) && value! >= 0
const arcColors = ['var(--zhu)', 'var(--dai)', 'var(--zi)', 'var(--ink-2)', 'var(--qing)']
const arcLanes = computed(() => (novel.value?.storyArcs || []).map((raw, index) => {
  const arc = projection.value.arcs.find(item => item.id === raw.id)
  const nodes = (arc?.nodes || []).filter(node => node.status !== 'abandoned').flatMap(node => {
    const actual = node.status === 'completed' && validIndex(node.actualChapter)
    const at = actual ? node.actualChapter : node.targetChapter
    return validIndex(at) ? [{ id: node.id, title: node.title, index: at, actual, unverified: node.status === 'unverified' }] : []
  })
  const indices = nodes.map(node => node.index)
  return { id: raw.id, title: arc?.title || raw.title, color: arcColors[index % arcColors.length], nodes,
    unverified: !arc || arc.status === 'unverified' || projection.value.issues.some(issue => issue.entityId === raw.id),
    start: indices.length ? Math.min(...indices) : undefined, end: indices.length ? Math.max(...indices) : undefined }
}))
const timelineColumns = computed(() => {
  const group = timelineScope.value === 'volume' ? selectedGroup.value : undefined
  const base = group ? group.chapters.map(row => row.index) : chapterRows.value.map(row => row.index)
  const indices = new Set(base)
  const min = base.length ? Math.min(...base) : 0, max = base.length ? Math.max(...base) : -1
  for (const lane of arcLanes.value) for (const node of lane.nodes) if (!group || node.index >= min && node.index <= max) indices.add(node.index)
  return [...indices].sort((a, b) => a - b)
})
const timelineRange = computed(() => timelineColumns.value.length ? '第 ' + (timelineColumns.value[0] + 1) + '–' + (timelineColumns.value[timelineColumns.value.length - 1] + 1) + ' 章' : '尚无章节刻度')
const foreshadowRows = computed(() => (novel.value?.eventLog || []).filter(event => event.type === '伏笔').map(raw => {
  const event = projection.value.events.find(item => item.id === raw.id)
  const known = event && event.status !== 'unverified'
  const start = known && validIndex(event.chapterIndex) ? event.chapterIndex : undefined
  const progress = known && validIndex(event.lastProgressChapterIndex) ? event.lastProgressChapterIndex : undefined
  const resolved = known && event.status === 'resolved' && validIndex(event.resolvedChapterIndex) ? event.resolvedChapterIndex : undefined
  const target = event && validIndex(event.targetChapter) && resolved === undefined ? event.targetChapter : undefined
  const points: Array<{ kind: string; index: number; label: string }> = []
  if (start !== undefined) points.push({ kind: 'planted', index: start, label: '埋设记录' })
  if (progress !== undefined) points.push({ kind: 'progress', index: progress, label: '最近推进（仅此一次记录）' })
  if (resolved !== undefined) points.push({ kind: 'resolved', index: resolved, label: '实际回收记录' })
  if (target !== undefined) points.push({ kind: 'planned', index: target, label: '计划推进/回收，非已发生' })
  const end = start === undefined ? undefined : Math.max(start, progress ?? start, resolved ?? start)
  return { id: raw.id, title: event?.title || raw.title, start, end, target, points,
    label: !known ? '来源待核对' : resolved !== undefined ? '已回收' : event.status === 'resolved' ? '回收章未记录' : event.status === 'abandoned' ? '已放弃' : progress !== undefined ? '已推进' : start !== undefined ? '已埋设' : '待埋设',
    tone: !known || event?.status === 'resolved' && resolved === undefined ? 'jin' : resolved !== undefined ? 'qing' : '' }
}))
const lastTimelineIndex = computed(() => Math.max(0, ...chapterRows.value.map(row => row.index), ...arcLanes.value.flatMap(lane => lane.nodes.map(node => node.index)),
  ...foreshadowRows.value.flatMap(item => item.points.map(point => point.index)), selectionKind.value === 'chapter' ? selectedIndex.value : 0))
const scaleTicks = computed(() => [...new Set([0, ...[.25, .5, .75, 1].map(fraction => Math.round(lastTimelineIndex.value * fraction))])])
function position(index: number) { return Math.max(0, Math.min(100, index / Math.max(1, lastTimelineIndex.value) * 100)) + '%' }
function spanWidth(start: number, end: number) { return Math.max(0, (end - start) / Math.max(1, lastTimelineIndex.value) * 100) + '%' }
function chapterState(chapter?: Chapter) {
  if (!chapter) return '尚未建章'
  return ({ draft: '草稿', writing: '写作中', completed: '待定稿', reviewed: '已审校', finalized: '已定稿', locked: '已锁定' })[chapter.status]
}
function plansByHorizon(horizon: ChapterPlanHorizon) { return livePlans.value.filter(plan => plan.horizon === horizon).sort((a, b) => a.targetChapterStart - b.targetChapterStart) }
function planStatusLabel(status: ChapterPlanStatus) {
  return ({ planned: '待执行', active: '进行中', awaiting_review: '待核对', completed: '已完成', archived: '已归档' })[status]
}
function arcTypeLabel(type?: StoryArcType) {
  return type && ({ main: '主线', sub: '支线', character: '角色成长', relationship: '关系线', mystery: '悬念线', world: '世界线' })[type] || '类型待核对'
}
function arcStatusLabel(status: StoryArcStatus) {
  return ({ active: '推进中', paused: '暂停', completed: '已完成', abandoned: '已放弃', unverified: '来源待核对' })[status] || '来源待核对'
}
function eventStatusLabel(status?: EventLogEntry['status']) {
  return status ? ({ planted: '已埋设', developing: '推进中', resolved: '已解决', abandoned: '已放弃', unverified: '来源待核对' })[status] || '来源待核对' : '未标记'
}
function toggleVolume(index: number) { collapsedVolumes.value = collapsedVolumes.value.includes(index) ? collapsedVolumes.value.filter(item => item !== index) : [...collapsedVolumes.value, index] }
async function revealDetail() {
  await nextTick()
  if (window.matchMedia('(max-width: 700px)').matches) detailElement.value?.scrollIntoView({ block: 'start' })
}
async function selectScene(id: string) {
  selectedSceneId.value = id
  await nextTick()
  const card = [...(detailElement.value?.querySelectorAll<HTMLElement>('[data-scene-id]') || [])].find(element => element.dataset.sceneId === id)
  card?.scrollIntoView({ block: 'nearest' })
}
function selectChapter(index: number) {
  selectionKind.value = 'chapter'; selectedIndex.value = index; selectedSceneId.value = ''
  void revealDetail()
  if (selectedGroup.value) collapsedVolumes.value = collapsedVolumes.value.filter(item => item !== selectedGroup.value!.index)
  if (!selectedGroup.value) timelineScope.value = 'book'
  void router.replace({ query: { ...route.query, planChapter: String(index + 1), planVolume: undefined, planFocus: undefined } })
}
function selectVolume(index: number) {
  selectionKind.value = 'volume'; selectedVolumeIndex.value = index; selectedSceneId.value = ''; timelineScope.value = 'volume'
  void revealDetail()
  collapsedVolumes.value = collapsedVolumes.value.filter(item => item !== index)
  void router.replace({ query: { ...route.query, planVolume: String(index), planChapter: undefined, planFocus: undefined } })
}
function selectBook() {
  selectionKind.value = 'book'; selectedSceneId.value = ''; timelineScope.value = 'book'
  void revealDetail()
  void router.replace({ query: { ...route.query, planFocus: 'book', planChapter: undefined, planVolume: undefined } })
}
function restoreSelection() {
  if (loading.value) return
  const chapter = typeof route.query.planChapter === 'string' ? Number(route.query.planChapter) - 1 : undefined
  const volume = typeof route.query.planVolume === 'string' ? Number(route.query.planVolume) : undefined
  if (route.query.planFocus === 'book') { selectionKind.value = 'book'; timelineScope.value = 'book' }
  else if (validIndex(chapter) && Number.isSafeInteger(chapter)) { selectionKind.value = 'chapter'; selectedIndex.value = chapter }
  else if (volume !== undefined && treeGroups.value.some(group => group.index === volume)) { selectionKind.value = 'volume'; selectedVolumeIndex.value = volume; timelineScope.value = 'volume' }
  else if (chapterRows.value.length) { selectionKind.value = 'chapter'; selectedIndex.value = chapterRows.value[chapterRows.value.length - 1].index }
  else { selectionKind.value = 'book'; timelineScope.value = 'book' }
  if (!selectedGroup.value) timelineScope.value = 'book'
  else if (selectionKind.value === 'chapter') collapsedVolumes.value = collapsedVolumes.value.filter(index => index !== selectedGroup.value!.index)
}
function editScenes() {
  const id = detailPlan.value?.id || (selectedLegacyPlan.value ? 'chapter-plan-v2:' + selectedLegacyPlan.value.id : '')
  openPlanner(id ? 'scenes' : 'plans', id)
}
function startOutline() { outlineDraft.value = novel.value?.outline || ''; outlineError.value = ''; editingOutline.value = true }
async function saveOutline() {
  if (!novel.value || outlineSaving.value) return
  outlineSaving.value = true; outlineError.value = ''
  try { await novels.updateOutlineWithImpact(novel.value.id, outlineDraft.value); editingOutline.value = false }
  catch (cause) { outlineError.value = cause instanceof Error ? cause.message : String(cause) }
  finally { outlineSaving.value = false }
}
function selectTab(tab: PlanTab) {
  activeTab.value = tab
  void router.replace({ query: { ...route.query, view: tab } })
}
function openPlanner(tab: string, selection = '') {
  plannerTab.value = tab; plannerSelection.value = selection; activeTab.value = 'workbench'
  if (novel.value) void router.replace({ query: { ...route.query, view: 'workbench', plannerTab: tab, plannerSelection: selection || undefined } })
}
function onPlannerTabChange(tab: string) {
  plannerTab.value = tab; plannerSelection.value = ''
  if (novel.value) void router.replace({ query: { ...route.query, view: 'workbench', plannerTab: tab, plannerSelection: undefined } })
}
onMounted(async () => {
  try {
    if (!novelId.value) throw new Error('结构页缺少作品编号。')
    await workspace.hydrateFromPersistence(novelId.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally {
    loading.value = false; restoreSelection()
    collapsedVolumes.value = treeGroups.value.filter(group => group !== selectedGroup.value).map(group => group.index)
  }
})
watch(() => route.query, query => {
  const view = String(query.view || 'overview') as PlanTab
  if (planTabs.has(view)) activeTab.value = view
  if (typeof query.plannerTab === 'string') plannerTab.value = query.plannerTab
  plannerSelection.value = typeof query.plannerSelection === 'string' ? query.plannerSelection : ''
  restoreSelection()
}, { immediate: true })
</script>

<style scoped>
.plan-page.is-overview { padding: 0; overflow: auto; }
.plan-layout { height: 100%; min-height: 0; display: grid; grid-template-columns: 260px minmax(0, 1fr) 340px; }
.structure-side { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: var(--panel); }
.structure-head { display: flex; align-items: center; justify-content: space-between; padding: 15px 16px 10px; }
.structure-head h2 { margin: 0; font: 600 14px var(--f-serif); }
.structure-tree { min-height: 0; overflow: auto; flex: 1; padding: 8px 10px 20px; }
.tree-item { min-width: 0; width: 100%; display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 6px; color: var(--ink-2); text-align: left; font-size: 13px; }
.tree-item:hover, .tree-toggle:hover { background: var(--hover); }
.tree-item.on, .tree-volume.on { color: var(--ink); background: var(--paper); box-shadow: var(--shadow-1); font-weight: 600; }
.level { flex: 0 0 18px; color: var(--ink-4); font: 10px var(--f-num); }
.tree-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-volume { display: flex; align-items: center; padding-left: 3px; border-radius: 6px; }
.tree-toggle { flex: 0 0 16px; align-self: stretch; display: grid; place-items: center; color: var(--ink-4); }
.tree-volume .tree-item { padding-left: 0; }
.tree-chapter { padding-left: 34px; }
.tree-scene { padding-left: 50px; color: var(--ink-3); font-size: 12px; }
.draft-dot { margin-left: auto; font-size: 9px; color: var(--jin); }
.chapter-dot { width: 7px; height: 7px; flex: 0 0 7px; border: 1px solid var(--ink-4); border-radius: 50%; }
.chapter-dot.writing { background: var(--zhu); border-color: var(--zhu); }
.chapter-dot.completed, .chapter-dot.reviewed { border-color: var(--dai); background: var(--dai-soft); }
.chapter-dot.finalized, .chapter-dot.locked { border-color: var(--qing); background: var(--qing); }
.tree-empty { padding: 8px 16px; color: var(--ink-4); font-size: 11px; line-height: 1.8; }
.range-plans { padding: 12px 8px; }
.range-plans h3 { margin: 0 0 6px; font-size: 11px; color: var(--ink-4); font-weight: 500; }
.range-plans button { width: 100%; display: block; padding: 6px 0; text-align: left; color: var(--ink-3); font-size: 12px; }
.range-plans button span { margin-right: 8px; font: 10px var(--f-num); color: var(--jin); }
.structure-actions { display: flex; gap: 14px; padding: 12px 18px; border-top: 1px solid var(--line); }
.structure-actions button { color: var(--ink-3); font-size: 11px; }
.plan-board { min-width: 0; overflow: auto; padding: 22px 24px 40px; background: var(--desk); }
.plan-section-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.plan-section-heading > div:first-child { min-width: 0; }
.plan-section-heading > .m-btn { flex-shrink: 0; }
.plan-section-heading h2 { margin: 0; font: 600 18px var(--f-serif); }
.plan-section-heading p { margin: 3px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.scope-switch { flex-shrink: 0; display: flex; padding: 3px; border: 1px solid var(--line); border-radius: 8px; }
.scope-switch button { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 9px; border-radius: 5px; color: var(--ink-3); font-size: 12px; }
.scope-switch button.on { color: var(--ink); background: var(--paper); box-shadow: var(--shadow-1); }
.scope-switch button:disabled { opacity: .45; cursor: default; }
.lane-panel { padding: 10px 16px 6px; overflow-x: auto; }
.lane-grid { display: grid; align-items: center; }
.chapter-tick { padding: 6px 0; color: var(--ink-4); font: 11px var(--f-num); border-radius: 4px; }
.chapter-tick:hover { background: var(--hover); }
.chapter-tick.on { color: var(--zhu); background: var(--zhu-soft); font-weight: 700; }
.lane-name { min-width: 0; display: flex; align-items: center; gap: 7px; padding: 14px 6px 14px 0; text-align: left; color: var(--ink-2); font-size: 12.5px; font-weight: 600; }
.lane-name i { flex: 0 0 9px; height: 9px; border-radius: 2px; background: var(--lane-color); }
.lane-name > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane-name small { color: var(--jin); font-size: 9px; font-weight: 400; }
.lane-cell { height: 48px; display: flex; justify-content: center; align-items: center; gap: 4px; position: relative; }
.lane-cell.linked::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--lane-color); opacity: .28; }
.arc-node { position: relative; z-index: 1; flex: 0 0 13px; width: 13px; height: 13px; padding: 0; border: 2px solid var(--lane-color); border-radius: 50%; background: var(--paper); }
.arc-node.planned { border-style: dashed; }
.arc-node.actual { flex-basis: 16px; height: 16px; background: var(--lane-color); }
.arc-node.uncertain { border-color: var(--jin); }
.arc-node::after { content: ''; position: absolute; inset: -7px; }
.node-tip { position: absolute; bottom: 19px; left: 50%; transform: translateX(-50%); z-index: 3; padding: 4px 7px; border-radius: 5px; white-space: nowrap; background: var(--rail); color: var(--rail-hi); font-size: 11px; opacity: 0; pointer-events: none; }
.arc-node:hover .node-tip, .arc-node:focus-visible .node-tip { opacity: 1; }
.projection-notice { color: var(--jin); font-size: 11px; line-height: 1.7; }
.board-empty { padding: 30px 20px; text-align: center; color: var(--ink-3); }
.board-empty h3 { margin: 8px 0; font: 600 16px var(--f-serif); color: var(--ink-2); }
.board-empty p { margin: 8px 0 16px; font-size: 12px; line-height: 1.8; }
.foreshadow-heading { margin-top: 30px; }
.foreshadow-panel { padding: 6px 16px; overflow-x: auto; }
.foreshadow-chart { min-width: 500px; }
.fs-row { display: grid; grid-template-columns: 110px minmax(0, 1fr) 92px; align-items: center; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.fs-name { min-width: 0; text-align: left; color: var(--ink); font: 13px var(--f-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-track { position: relative; height: 22px; margin: 0 6px; }
.fs-bar { position: absolute; top: 9px; height: 4px; border-radius: 3px; background: var(--qing); opacity: .55; }
.fs-bar.planned { background: repeating-linear-gradient(90deg, var(--ink-4) 0 4px, transparent 4px 8px); opacity: .8; }
.fs-point { position: absolute; top: 5px; width: 12px; height: 12px; padding: 0; transform: translateX(-50%); border: 2px solid var(--qing); border-radius: 50%; background: var(--paper); }
.fs-point.progress { border-color: var(--jin); }
.fs-point.resolved { background: var(--qing); }
.fs-point.planned { border-style: dashed; border-color: var(--ink-4); }
.fs-point:hover, .arc-node:hover { box-shadow: 0 0 0 4px var(--hover); }
.now-line { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--zhu); opacity: .4; pointer-events: none; }
.track-tag { display: inline-block; width: fit-content; max-width: 100%; border: 1px solid var(--line-2); border-radius: 3px; padding: 2px 6px; color: var(--ink-3); font-size: 10px; line-height: 1.4; white-space: nowrap; }
.fs-row > .track-tag { justify-self: end; }
.track-tag.qing { background: var(--qing-soft); border-color: transparent; color: var(--qing); }
.track-tag.jin { background: var(--jin-soft); border-color: transparent; color: var(--jin); }
.fs-axis { border: 0; padding: 8px 0 3px; }
.fs-axis .fs-track > span { position: absolute; transform: translateX(-50%); color: var(--ink-4); font: 11px var(--f-num); }
.board-links { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 20px; }
.board-links button { padding: 3px 0; color: var(--ink-3); font-size: 11px; }
.board-links button:hover, .structure-actions button:hover { color: var(--zhu); }
.plan-detail { min-width: 0; overflow: auto; padding: 20px; border-left: 1px solid var(--line); background: var(--panel); }
.plan-detail h2 { margin: 4px 0 14px; font: 600 20px/1.35 var(--f-serif); }
.detail-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 16px; }
.detail-word-count { color: var(--ink-4); font: 10px var(--f-num); }
.detail-fields { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 8px 10px; margin: 0 0 16px; font-size: 13px; line-height: 1.6; }
.detail-fields dt { color: var(--ink-3); font-size: 12px; padding-top: 1px; }
.detail-fields dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.plan-source-note, .detail-empty { margin: 12px 0; color: var(--ink-4); font-size: 11px; line-height: 1.8; }
.detail-section-title { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 9px; color: var(--ink-3); font-size: 12px; letter-spacing: .06em; }
.detail-section-title button { color: var(--zhu); font-size: 11px; letter-spacing: 0; }
.scene-card { display: block; width: 100%; padding: 11px 12px; margin-bottom: 8px; text-align: left; }
.scene-card.selected { border-color: var(--zhu); box-shadow: 0 0 0 1px var(--zhu-soft); }
.scene-card-head { display: flex; justify-content: space-between; align-items: center; color: var(--ink-3); font-size: 12px; }
.scene-card strong { display: block; margin: 3px 0 4px; font: 600 14px var(--f-serif); }
.scene-card p { margin: 0; color: var(--ink-2); font-size: 12.5px; line-height: 1.6; }
.scene-card .scene-output { margin-top: 8px; color: var(--ink-3); font-size: 11px; }
.detail-prose { white-space: pre-wrap; font: 13px/1.9 var(--f-serif); overflow-wrap: anywhere; }
.detail-prose.muted { color: var(--ink-3); }
.skeleton-title { margin: 14px 0 8px; font: 600 15px var(--f-serif); }
.skeleton-beats { padding-left: 18px; font-size: 12px; color: var(--ink-2); }
.skeleton-beats p { margin: 3px 0 10px; color: var(--ink-3); line-height: 1.7; }
.detail-principle { padding: 14px; margin-top: 14px; border-radius: var(--r-m); background: var(--jin-soft); color: var(--ink-2); font-size: 12px; line-height: 1.7; }
.detail-principle h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 13px; color: var(--jin); }
.detail-principle p { margin: 0 0 6px; }
.detail-principle button { color: var(--jin); font-size: 11px; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
.detail-actions a { text-decoration: none; }
.detail-ranges { padding: 12px 0; }
.detail-ranges h3 { margin: 0 0 6px; font-size: 12px; }
.detail-ranges button { display: block; text-align: left; padding: 5px 0; color: var(--ink-3); font-size: 12px; }
.scene-notes { margin: 14px 0; color: var(--ink-3); font-size: 11px; }
.scene-notes p { white-space: pre-wrap; line-height: 1.7; }
.outline-error { padding: 0 18px; color: var(--zhu); font-size: 12px; }
@media (max-width: 1280px) { .plan-layout { grid-template-columns: 220px minmax(0, 1fr) 300px; }.plan-section-heading { align-items: flex-start; }.scope-switch button { max-width: 90px; } }
@media (max-width: 980px) { .plan-layout { height: auto; min-width: 0; display: block; }.structure-side { max-height: 285px; border-right: 0; border-bottom: 1px solid var(--line); }.plan-board { overflow: visible; padding: 20px 14px; }.plan-detail { overflow: visible; border-left: 0; border-top: 1px solid var(--line); padding: 20px 16px; }.plan-section-heading { gap: 8px; }.plan-section-heading h2 { font-size: 17px; }.plan-section-heading p { font-size: 11px; }.plan-section-heading .m-btn { flex-shrink: 0; }.scope-switch button { padding: 4px 6px; max-width: 85px; } }
.plan-page { position: absolute; inset: 0; overflow: auto; padding: 30px 42px 60px; background: var(--desk); }.plan-head { max-width: 1280px; margin: 0 auto 20px; display: flex; justify-content: space-between; align-items: flex-end; gap: 18px; }.eyebrow { color: var(--zhu); font-size: 11px; letter-spacing: .18em; }.plan-head h1 { margin: 5px 0; font: 600 29px var(--f-serif); }.plan-head p { margin: 0; color: var(--ink-3); font-size: 13px; }.head-actions { display: flex; gap: 8px; }.plan-tabs { max-width: 1280px; margin: 0 auto 18px; display: flex; border-bottom: 1px solid var(--line); overflow-x: auto; }.plan-tabs button { padding: 12px 18px; color: var(--ink-3); border-bottom: 2px solid transparent; white-space: nowrap; }.plan-tabs button.on { color: var(--zhu); border-color: var(--zhu); }.plan-tabs b { margin-left: 4px; font-size: 10px; color: var(--ink-4); }.m-panel { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow-1); }.overview-grid { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }.overview-card { padding: 15px 17px; }.overview-card span { color: var(--ink-3); font-size: 12px; }.overview-card strong { display: block; margin: 5px 0; font-size: 21px; }.overview-card small { color: var(--ink-4); font-size: 11px; }.structure-map { grid-column: span 4; }.panel-head { display: flex; justify-content: space-between; gap: 12px; padding: 15px 18px; border-bottom: 1px solid var(--line); }.panel-head h2 { margin: 0; font: 600 16px var(--f-serif); }.panel-head p { margin: 4px 0 0; color: var(--ink-3); font-size: 12px; }.map-row { display: grid; grid-template-columns: 80px 1fr 1.5fr; gap: 12px; align-items: baseline; padding: 14px 18px; border-bottom: 1px solid var(--line); }.map-row span { color: var(--zhu); font-size: 12px; }.map-row strong { font: 600 14px var(--f-serif); }.map-row small { color: var(--ink-3); font-size: 11px; }.outline-panel { max-width: 1280px; margin: 0 auto; }.panel-actions { display: flex; gap: 6px; }.outline-editor { display: block; width: 100%; min-height: 420px; padding: 18px; border: 0; outline: 0; resize: vertical; background: var(--paper); color: var(--ink); font: 14px/1.9 var(--f-serif); }.outline-body { min-height: 420px; padding: 20px; white-space: pre-wrap; color: var(--ink-2); font: 14px/1.9 var(--f-serif); }.card-list { max-width: 1280px; margin: 0 auto; display: grid; gap: 12px; }.planning-card { display: flex; justify-content: space-between; gap: 16px; padding: 17px 19px; }.planning-card h2 { margin: 4px 0; font: 600 17px var(--f-serif); }.planning-card p { margin: 5px 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }.planning-card small { color: var(--ink-4); font-size: 11px; }.card-kicker { color: var(--zhu); font-size: 10px; letter-spacing: .08em; }.m-link { display: inline-flex; align-items: center; padding: 5px 0; border: 0; background: transparent; color: var(--zhu); font: 600 12px var(--f-ui); cursor: pointer; white-space: nowrap; }.m-link:hover { color: var(--ink); text-decoration: underline; }.plan-columns { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }.horizon-panel { min-height: 260px; }.horizon-panel > .panel-head span { color: var(--ink-4); font-size: 12px; }.plan-row { padding: 13px 16px; border-bottom: 1px solid var(--line); }.plan-row strong { display: block; font-size: 13px; }.plan-row small { display: block; margin-top: 4px; color: var(--ink-4); font-size: 10px; }.plan-row p { margin: 6px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }.event-columns { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr); gap: 18px; }.event-row { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; padding: 15px 18px; border-bottom: 1px solid var(--line); }.event-marker { width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--ink-4); }.event-marker.zhu { background: var(--zhu); box-shadow: 0 0 0 4px var(--zhu-soft); }.event-row h3 { margin: 4px 0; font: 600 14px var(--f-serif); }.event-row p { margin: 0 0 6px; color: var(--ink-3); font-size: 12px; line-height: 1.6; }.event-row small { color: var(--ink-4); font-size: 10px; }.foreshadow-row { padding: 14px 18px; border-bottom: 1px solid var(--line); }.foreshadow-row strong { font: 600 13px var(--f-serif); }.foreshadow-row small { display: block; margin-top: 7px; color: var(--ink-4); font-size: 10px; }.four-points { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 9px; }.four-points span { padding: 4px 3px; border-radius: 4px; background: var(--panel-2); color: var(--ink-4); text-align: center; font-size: 9px; }.four-points span.on { background: var(--zhu-soft); color: var(--zhu); }.empty, .plan-state { padding: 40px; color: var(--ink-3); }.plan-state.error { color: var(--zhu); }.planner-workbench { max-width: 1280px; margin: 0 auto; }.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-link:hover { color: var(--zhu); }.crumb-sep { margin: 0 7px; color: var(--ink-4); }
@media (max-width: 980px) { .plan-page { padding: 22px 24px 48px; }.overview-grid { grid-template-columns: repeat(2, 1fr); }.structure-map { grid-column: span 2; }.plan-columns { grid-template-columns: 1fr; }.event-columns { grid-template-columns: 1fr; } }
@media (max-width: 680px) { .plan-page { padding: 16px 12px 40px; }.plan-head { display: block; }.head-actions { margin-top: 14px; }.overview-grid { grid-template-columns: 1fr 1fr; gap: 8px; }.structure-map { grid-column: span 2; }.map-row { grid-template-columns: 50px 1fr; }.map-row small { grid-column: 2; }.planning-card { padding: 14px; } }

.planning-card > div, .event-row > div:last-child { min-width: 0; overflow-wrap: anywhere; }
.planning-card .entity-source-notice { color: var(--jin); }
.event-meta { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }

.event-panel { min-width: 0; }
.foreshadow-row { min-width: 0; overflow-wrap: anywhere; }
</style>
