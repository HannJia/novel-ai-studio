<template>
  <div class="story-planner page-container fade-in">
    <header class="planner-header">
      <div>
        <h2 class="page-title">剧情规划</h2>
        <p class="page-subtitle">从分卷到章节，统一管理剧情推进、关键事件与项目记忆</p>
      </div>
      <div v-if="activeTab === 'plans'" class="header-actions">
        <n-button secondary :loading="generatingPlans" :disabled="!novel?.outline" @click="generatePlans">AI 生成计划</n-button>
        <n-button type="primary" @click="openPlanModal()">
          <template #icon><n-icon><add-outline /></n-icon></template>
          新建计划
        </n-button>
      </div>
      <div v-else-if="activeTab === 'arcs'" class="header-actions">
        <n-button secondary :loading="extractingArcs" :disabled="!novel?.outline" @click="handleExtractArcs">AI 提取</n-button>
        <n-button type="primary" @click="openArcModal()">
          <template #icon><n-icon><add-outline /></n-icon></template>
          新建弧线
        </n-button>
      </div>
      <n-button v-else-if="activeTab === 'timeline'" type="primary" @click="openEventModal()">
        <template #icon><n-icon><add-outline /></n-icon></template>
        添加事件
      </n-button>
      <n-button v-else-if="activeTab === 'proposals'" :loading="scanningState" :disabled="!latestCompletedChapter" type="primary" @click="scanLatestChapterState">
        检查最新章节
      </n-button>
    </header>

    <div class="planner-summary">
      <span><strong>{{ activeArcCount }}</strong> 条活跃弧线</span>
      <span><strong>{{ pendingNodeCount }}</strong> 个待完成节点</span>
      <span><strong>{{ unresolvedEventCount }}</strong> 个待推进事件</span>
      <span><strong>{{ activePlanCount }}</strong> 条进行中计划</span>
      <span><strong>{{ pendingProposalCount }}</strong> 条待审状态提案</span>
      <span><strong>{{ memoryRecordCount }}</strong> 条可检索记忆</span>
    </div>

    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane name="volumes" tab="分卷规划">
        <VolumeOutline
          embedded
          :chapter-plan-confirmed="Boolean(novel?.chapterPlanConfirmed)"
          @confirmed="confirmVolumesAndGeneratePlans"
        />
      </n-tab-pane>

      <n-tab-pane name="plans" tab="章节计划">
        <div class="plan-board">
          <section v-for="lane in planLanes" :key="lane.horizon" class="plan-lane">
            <div class="plan-lane-header">
              <div>
                <strong>{{ lane.label }}</strong>
                <span>{{ lane.description }}</span>
              </div>
              <n-tag size="small" round>{{ plansByHorizon[lane.horizon].length }}</n-tag>
            </div>
            <div class="plan-list">
              <article v-for="plan in plansByHorizon[lane.horizon]" :key="plan.id" class="plan-card">
                <div class="plan-card-header">
                  <div>
                    <n-tag size="small" :type="planStatusColor(plan.status)">{{ planStatusLabel(plan.status) }}</n-tag>
                    <span class="plan-range">{{ chapterRangeLabel(plan.targetChapterStart, plan.targetChapterEnd) }}</span>
                  </div>
                  <div class="icon-actions">
                    <n-button quaternary circle size="small" title="编辑计划" @click="openPlanModal(plan)">
                      <template #icon><n-icon><create-outline /></n-icon></template>
                    </n-button>
                    <n-button v-if="plan.versions?.length" quaternary size="small" title="查看版本对比" @click="openPlanVersionModal(plan)">
                      版本 {{ plan.versions.length }}
                    </n-button>
                    <n-button quaternary size="small" title="局部重新生成" :loading="regeneratingPlanId === plan.id" @click="refreshPlan(plan)">
                      重生成
                    </n-button>
                    <n-popconfirm @positive-click="removePlan(plan.id)">
                      <template #trigger>
                        <n-button quaternary circle size="small" title="删除计划">
                          <template #icon><n-icon><trash-outline /></n-icon></template>
                        </n-button>
                      </template>
                      删除这条章节计划？
                    </n-popconfirm>
                  </div>
                </div>
                <h3>{{ plan.title }}</h3>
                <strong class="plan-objective">{{ plan.objective }}</strong>
                <p>{{ plan.summary }}</p>
                <ol v-if="plan.beats.length" class="plan-beats">
                  <li v-for="beat in plan.beats" :key="beat">{{ beat }}</li>
                </ol>
                <small>{{ plan.source === 'ai' ? 'AI 生成' : '手动创建' }}</small>
              </article>
              <button v-if="plansByHorizon[lane.horizon].length === 0" class="empty-plan" @click="openPlanModal(undefined, lane.horizon)">
                <n-icon :size="20"><add-outline /></n-icon>
                <span>添加{{ lane.label }}计划</span>
              </button>
            </div>
          </section>
        </div>
      </n-tab-pane>

      <n-tab-pane name="arcs" tab="故事弧线">
        <div v-if="sortedArcs.length" class="arc-list">
          <article v-for="arc in sortedArcs" :key="arc.id" class="arc-card">
            <div class="arc-card-header">
              <div class="arc-title-row">
                <n-tag size="small" :type="arcTypeColor(arc.type)">{{ arcTypeLabel(arc.type) }}</n-tag>
                <h3>{{ arc.title }}</h3>
                <n-tag size="small" :type="arcStatusColor(arc.status)">{{ arcStatusLabel(arc.status) }}</n-tag>
              </div>
              <div class="icon-actions">
                <n-button quaternary circle size="small" title="编辑弧线" @click="openArcModal(arc)">
                  <template #icon><n-icon><create-outline /></n-icon></template>
                </n-button>
                <n-popconfirm @positive-click="removeArc(arc.id)">
                  <template #trigger>
                    <n-button quaternary circle size="small" title="删除弧线">
                      <template #icon><n-icon><trash-outline /></n-icon></template>
                    </n-button>
                  </template>
                  删除弧线及其全部节点？
                </n-popconfirm>
              </div>
            </div>

            <p class="arc-description">{{ arc.description || '暂未填写弧线描述' }}</p>

            <div class="arc-meta">
              <span>重要度 {{ arc.importance }}/5</span>
              <span>{{ completedNodeCount(arc) }}/{{ arc.nodes.length }} 个节点已完成</span>
              <span v-if="arc.status === 'paused' && arc.reactivateAt">恢复：{{ arc.reactivateAt }}</span>
            </div>
            <div class="progress-track" aria-hidden="true">
              <div class="progress-value" :style="{ width: arcProgress(arc) + '%' }"></div>
            </div>

            <div class="node-list">
              <div v-if="arc.nodes.length === 0" class="node-empty">还没有里程碑节点</div>
              <div v-for="node in arc.nodes" :key="node.id" class="node-row" :class="`node-${node.status}`">
                <button class="node-toggle" :title="node.status === 'completed' ? '标记为待完成' : '标记为已完成'" @click="toggleNode(arc, node)">
                  <n-icon :size="16"><checkmark-circle-outline v-if="node.status === 'completed'" /><ellipse-outline v-else /></n-icon>
                </button>
                <div class="node-chapter">第 {{ node.actualChapter !== undefined ? node.actualChapter + 1 : node.targetChapter + 1 }} 章</div>
                <div class="node-content">
                  <strong>{{ node.title }}</strong>
                  <span v-if="node.description">{{ node.description }}</span>
                </div>
                <n-popconfirm @positive-click="removeNode(arc.id, node.id)">
                  <template #trigger>
                    <n-button quaternary circle size="tiny" title="删除节点">
                      <template #icon><n-icon><trash-outline /></n-icon></template>
                    </n-button>
                  </template>
                  删除这个里程碑？
                </n-popconfirm>
              </div>
            </div>

            <n-button text type="primary" class="add-node-button" @click="openNodeModal(arc.id)">
              <template #icon><n-icon><add-outline /></n-icon></template>
              添加里程碑
            </n-button>
          </article>
        </div>
        <n-empty v-else description="还没有故事弧线" class="empty-block">
          <template #extra><n-button type="primary" @click="openArcModal()">创建第一条弧线</n-button></template>
        </n-empty>
      </n-tab-pane>

      <n-tab-pane name="timeline" tab="故事时间线">
        <div class="filter-bar">
          <n-input v-model:value="timelineQuery" clearable placeholder="搜索事件、地点或角色" />
          <n-select v-model:value="timelineType" :options="timelineTypeOptions" />
          <n-select v-model:value="timelineStatus" :options="timelineStatusOptions" />
        </div>

        <div v-if="filteredEvents.length" class="timeline-list">
          <article v-for="event in filteredEvents" :key="event.id" class="timeline-row">
            <div class="timeline-marker">
              <span>{{ eventChapterLabel(event.chapterIndex) }}</span>
              <i></i>
            </div>
            <div class="timeline-content">
              <div class="timeline-heading">
                <div>
                  <n-tag size="small" :type="eventTypeColor(event.type)">{{ event.type }}</n-tag>
                  <strong>{{ event.title }}</strong>
                </div>
                <div class="icon-actions">
                  <n-button quaternary circle size="small" title="编辑事件" @click="openEventModal(event)">
                    <template #icon><n-icon><create-outline /></n-icon></template>
                  </n-button>
                  <n-popconfirm @positive-click="removeEvent(event.id)">
                    <template #trigger>
                      <n-button quaternary circle size="small" title="删除事件">
                        <template #icon><n-icon><trash-outline /></n-icon></template>
                      </n-button>
                    </template>
                    删除这个事件？
                  </n-popconfirm>
                </div>
              </div>
              <p>{{ event.description }}</p>
              <div class="timeline-meta">
                <span v-if="event.storyTime">{{ event.storyTime }}</span>
                <span v-if="event.location">{{ event.location }}</span>
                <span v-if="event.targetChapter !== undefined">预计第 {{ event.targetChapter + 1 }} 章推进</span>
                <span>重要度 {{ event.importance || 3 }}/5</span>
                <span>{{ eventStatusLabel(event.status) }}</span>
              </div>
              <div v-if="event.characters?.length" class="character-tags">
                <n-tag v-for="name in event.characters" :key="name" size="small" round>{{ name }}</n-tag>
              </div>
            </div>
          </article>
        </div>
        <n-empty v-else description="没有符合条件的事件" class="empty-block" />
      </n-tab-pane>

      <n-tab-pane name="memory" tab="项目记忆">
        <div class="index-status">
          <span v-if="memoryIndexInfo.recordCount">
            {{ memoryIndexInfo.provider === 'remote' ? '真实向量' : '本地索引' }} ·
            {{ memoryIndexInfo.model }} · {{ memoryIndexInfo.recordCount }} 条 · {{ memoryIndexInfo.dimensions }} 维
          </span>
          <span v-else>尚未建立持久化记忆索引</span>
          <n-button text type="primary" :loading="memoryIndexing" @click="rebuildMemoryIndex">同步索引</n-button>
        </div>
        <div class="memory-search">
          <n-input v-model:value="memoryQuery" clearable placeholder="输入人物、事件、设定或剧情问题" @keydown.enter="runMemorySearch">
            <template #prefix><n-icon><search-outline /></n-icon></template>
          </n-input>
          <n-select v-model:value="memorySource" :options="memorySourceOptions" />
          <n-button type="primary" :loading="memorySearching" :disabled="!memoryQuery.trim()" @click="runMemorySearch">检索</n-button>
        </div>

        <div v-if="searched && memoryResults.length" class="memory-results">
          <article v-for="item in memoryResults" :key="item.id" class="memory-result">
            <div class="memory-result-header">
              <n-tag size="small">{{ sourceLabel(item.sourceType) }}</n-tag>
              <strong>{{ item.title }}</strong>
              <span>{{ Math.round(item.score * 100) }}% 相关</span>
            </div>
            <p>{{ item.content }}</p>
            <small>{{ item.citation }}</small>
          </article>
        </div>
        <n-empty v-else-if="searched" description="没有找到足够相关的项目记忆" class="empty-block" />
        <div v-else class="memory-placeholder">
          <n-icon :size="36"><search-outline /></n-icon>
          <strong>搜索整本小说的结构化记忆</strong>
          <span>范围包括章节摘要、角色、事件、故事弧线、数据面板和已绑定知识库。</span>
        </div>
      </n-tab-pane>

      <n-tab-pane name="proposals" :tab="pendingProposalCount ? `状态提案 (${pendingProposalCount})` : '状态提案'">
        <div v-if="pendingStateProposals.length" class="proposal-list">
          <article v-for="proposal in pendingStateProposals" :key="proposal.id" class="proposal-card">
            <div class="proposal-header">
              <div>
                <n-tag size="small">{{ proposalTargetLabel(proposal.targetType) }}</n-tag>
                <strong>{{ proposal.targetTitle }}</strong>
              </div>
              <span>来自第 {{ proposal.chapterIndex + 1 }} 章</span>
            </div>
            <div class="proposal-change">
              <span>{{ proposalFieldLabel(proposal.field) }}</span>
              <code>{{ proposalValueLabel(proposal) }}</code>
            </div>
            <p>{{ proposal.reason }}</p>
            <blockquote v-if="proposal.evidence">证据：{{ proposal.evidence }}</blockquote>
            <div class="proposal-actions">
              <n-button size="small" type="primary" @click="acceptProposal(proposal.id)">应用</n-button>
              <n-button size="small" @click="rejectProposal(proposal.id)">忽略</n-button>
            </div>
          </article>
        </div>
        <div v-else class="memory-placeholder">
          <n-icon :size="36"><checkmark-circle-outline /></n-icon>
          <strong>没有待审批的状态变更</strong>
          <span>完成章节后，AI 会在后台检查弧线、事件与章节计划，只生成提案，不直接改数据。</span>
        </div>
      </n-tab-pane>
    </n-tabs>

    <n-modal v-model:show="showPlanModal" preset="card" :title="editingPlanId ? '编辑章节计划' : '新建章节计划'" class="form-modal">
      <n-form label-placement="top">
        <div class="form-grid">
          <n-form-item label="计划层级"><n-select v-model:value="planForm.horizon" :options="planHorizonOptions" /></n-form-item>
          <n-form-item label="状态"><n-select v-model:value="planForm.status" :options="planStatusOptions" /></n-form-item>
          <n-form-item label="计划名称" class="span-2"><n-input v-model:value="planForm.title" placeholder="例如：抵达锚点七号" /></n-form-item>
          <n-form-item label="开始章节"><n-input-number v-model:value="planForm.startChapter" :min="1" /></n-form-item>
          <n-form-item label="结束章节"><n-input-number v-model:value="planForm.endChapter" :min="planForm.startChapter" /></n-form-item>
          <n-form-item label="阶段目标" class="span-2"><n-input v-model:value="planForm.objective" placeholder="完成后必须发生什么变化" /></n-form-item>
          <n-form-item label="推进说明" class="span-2"><n-input v-model:value="planForm.summary" type="textarea" :rows="4" placeholder="冲突、信息释放和收束条件" /></n-form-item>
          <n-form-item label="写作节拍" class="span-2"><n-input v-model:value="planForm.beatsText" type="textarea" :rows="5" placeholder="每行一个节拍" /></n-form-item>
        </div>
      </n-form>
      <template #footer><div class="modal-actions"><n-button @click="showPlanModal = false">取消</n-button><n-button type="primary" :disabled="!planForm.title.trim() || !planForm.objective.trim()" @click="submitPlan">保存</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showPlanVersionModal" preset="card" title="章节计划版本对比" class="form-modal">
      <div v-if="versionPlan" class="version-dialog">
        <p class="version-current"><strong>{{ versionPlan.title }}</strong> · 当前版本</p>
        <n-select v-model:value="selectedPlanVersionId" :options="planVersionOptions" placeholder="选择历史版本" />
        <div v-if="planVersionDiff.length" class="version-diff-list">
          <div v-for="diff in planVersionDiff" :key="diff.field" class="version-diff-row">
            <strong>{{ diff.field }}</strong>
            <span>{{ diff.before }}</span>
            <span>→</span>
            <span>{{ diff.after }}</span>
          </div>
        </div>
        <n-empty v-else description="当前版本与历史版本没有可见差异" />
        <div v-if="selectedPlanVersionId" class="version-actions">
          <n-button type="warning" size="small" @click="restoreSelectedPlanVersion">恢复此版本</n-button>
        </div>
      </div>
      <template #footer><div class="modal-actions"><n-button @click="showPlanVersionModal = false">关闭</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showArcModal" preset="card" :title="editingArcId ? '编辑故事弧线' : '新建故事弧线'" class="form-modal">
      <n-form label-placement="top">
        <div class="form-grid">
          <n-form-item label="弧线名称" class="span-2"><n-input v-model:value="arcForm.title" placeholder="例如：复仇之路" /></n-form-item>
          <n-form-item label="类型"><n-select v-model:value="arcForm.type" :options="arcTypeOptions" /></n-form-item>
          <n-form-item label="状态"><n-select v-model:value="arcForm.status" :options="arcStatusOptions" /></n-form-item>
          <n-form-item label="重要度"><n-input-number v-model:value="arcForm.importance" :min="1" :max="5" /></n-form-item>
          <n-form-item label="相关角色"><n-select v-model:value="arcForm.characterIds" multiple clearable :options="characterOptions" /></n-form-item>
          <n-form-item v-if="arcForm.status === 'paused'" label="恢复条件" class="span-2"><n-input v-model:value="arcForm.reactivateAt" placeholder="例如：主角进入第二卷后恢复推进" /></n-form-item>
          <n-form-item label="整体描述" class="span-2"><n-input v-model:value="arcForm.description" type="textarea" :rows="4" placeholder="弧线目标、核心冲突和预期变化" /></n-form-item>
        </div>
      </n-form>
      <template #footer><div class="modal-actions"><n-button @click="showArcModal = false">取消</n-button><n-button type="primary" :disabled="!arcForm.title.trim()" @click="submitArc">保存</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showNodeModal" preset="card" title="添加里程碑" class="form-modal small-modal">
      <n-form label-placement="top">
        <n-form-item label="节点名称"><n-input v-model:value="nodeForm.title" placeholder="例如：首次发现仇人线索" /></n-form-item>
        <n-form-item label="预计章节"><n-input-number v-model:value="nodeForm.targetChapter" :min="1" /></n-form-item>
        <n-form-item label="节点说明"><n-input v-model:value="nodeForm.description" type="textarea" :rows="3" /></n-form-item>
      </n-form>
      <template #footer><div class="modal-actions"><n-button @click="showNodeModal = false">取消</n-button><n-button type="primary" :disabled="!nodeForm.title.trim()" @click="submitNode">添加</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showEventModal" preset="card" :title="editingEventId ? '编辑时间线事件' : '添加时间线事件'" class="form-modal">
      <n-form label-placement="top">
        <div class="form-grid">
          <n-form-item label="事件标题" class="span-2"><n-input v-model:value="eventForm.title" /></n-form-item>
          <n-form-item label="事件类型"><n-select v-model:value="eventForm.type" :options="eventTypeOptions" /></n-form-item>
          <n-form-item label="状态"><n-select v-model:value="eventForm.status" :options="eventStatusOptions" /></n-form-item>
          <n-form-item label="发生章节"><n-input-number v-model:value="eventForm.chapter" :min="1" /></n-form-item>
          <n-form-item label="预计推进章节"><n-input-number v-model:value="eventForm.targetChapter" clearable :min="1" /></n-form-item>
          <n-form-item label="故事内时间"><n-input v-model:value="eventForm.storyTime" placeholder="例如：玄历三年春" /></n-form-item>
          <n-form-item label="地点"><n-input v-model:value="eventForm.location" /></n-form-item>
          <n-form-item label="重要度"><n-input-number v-model:value="eventForm.importance" :min="1" :max="5" /></n-form-item>
          <n-form-item label="相关角色"><n-input v-model:value="eventForm.characters" placeholder="多个角色用逗号分隔" /></n-form-item>
          <n-form-item label="事件描述" class="span-2"><n-input v-model:value="eventForm.description" type="textarea" :rows="4" /></n-form-item>
        </div>
      </n-form>
      <template #footer><div class="modal-actions"><n-button @click="showEventModal = false">取消</n-button><n-button type="primary" :disabled="!eventForm.title.trim() || !eventForm.description.trim()" @click="submitEvent">保存</n-button></div></template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton, NEmpty, NForm, NFormItem, NIcon, NInput, NInputNumber, NModal,
  NPopconfirm, NSelect, NTabPane, NTabs, NTag, useDialog, useMessage,
} from 'naive-ui'
import {
  AddOutline, CheckmarkCircleOutline, CreateOutline, EllipseOutline,
  SearchOutline, TrashOutline,
} from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import VolumeOutline from '@/views/workspace/VolumeOutline.vue'
import { generateChapterPlanDrafts, generateStoryArcDrafts, generateStoryStateProposalDrafts } from '@/services/storyPlanning'
import { comparePlanningVersions, createLocalChapterPlanRefresh, type PlanningDiff } from '@/services/planningVersions'
import {
  buildSemanticRecords, getSemanticIndexInfo, queryPersistedSemanticEvidence,
  syncSemanticIndexForNovel, type SemanticEvidence, type SemanticIndexInfo, type SemanticSourceType,
} from '@/services/semanticIndex'
import type {
  ChapterPlan, ChapterPlanHorizon, ChapterPlanStatus, EventLogEntry, StoryArc, StoryArcNode,
  StoryArcStatus, StoryArcType, StoryStateProposal, StoryStateProposalField, StoryStateTargetType,
} from '@/types/novel'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const novelStore = useNovelStore()
const knowledgeStore = useKnowledgeStore()
const configStore = useConfigStore()
const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))

const planningTabs = new Set(['volumes', 'plans', 'arcs', 'timeline', 'memory', 'proposals'])
const requestedTab = String(route.query.tab || '')
const activeTab = ref(planningTabs.has(requestedTab) ? requestedTab : 'plans')
const timelineQuery = ref('')
const timelineType = ref('all')
const timelineStatus = ref('all')
const generatingPlans = ref(false)
const regeneratingPlanId = ref('')
const showPlanVersionModal = ref(false)
const versionPlan = ref<ChapterPlan | null>(null)
const selectedPlanVersionId = ref('')
const scanningState = ref(false)
const memoryQuery = ref('')
const memorySource = ref<'all' | SemanticSourceType>('all')
const searched = ref(false)
const extractingArcs = ref(false)
const memorySearching = ref(false)
const memoryIndexing = ref(false)
const memoryResults = ref<SemanticEvidence[]>([])
const memoryIndexInfo = ref<SemanticIndexInfo>({ recordCount: 0, provider: 'local', model: 'local-hash-v1', dimensions: 0, updatedAt: '' })
const chapterCreationPrompted = ref(false)

const planLanes: Array<{ horizon: ChapterPlanHorizon; label: string; description: string }> = [
  { horizon: 'next', label: '下一章', description: '可直接进入写作的详细计划' },
  { horizon: 'near', label: '近期', description: '未来约 2-10 章的推进路径' },
  { horizon: 'far', label: '远期', description: '后续阶段的方向与收束条件' },
]
const planHorizonOptions = planLanes.map(item => ({ label: item.label, value: item.horizon }))
const planStatusOptions = [
  { label: '待执行', value: 'planned' }, { label: '进行中', value: 'active' },
  { label: '已完成', value: 'completed' }, { label: '已归档', value: 'archived' },
]

const arcTypeOptions = [
  { label: '主线', value: 'main' }, { label: '支线', value: 'sub' },
  { label: '角色成长', value: 'character' }, { label: '关系线', value: 'relationship' },
  { label: '悬念线', value: 'mystery' }, { label: '世界线', value: 'world' },
]
const arcStatusOptions = [
  { label: '推进中', value: 'active' }, { label: '暂停', value: 'paused' },
  { label: '已完成', value: 'completed' }, { label: '已放弃', value: 'abandoned' },
]
const eventTypeOptions = ['主线', '支线', '伏笔', '转折', '战斗', '其他'].map(value => ({ label: value, value }))
const eventStatusOptions = [
  { label: '已埋设', value: 'planted' }, { label: '推进中', value: 'developing' },
  { label: '已解决', value: 'resolved' }, { label: '已放弃', value: 'abandoned' },
]
const timelineTypeOptions = [{ label: '全部类型', value: 'all' }, ...eventTypeOptions]
const timelineStatusOptions = [{ label: '全部状态', value: 'all' }, ...eventStatusOptions]
const memorySourceOptions = [
  { label: '全部来源', value: 'all' }, { label: '章节', value: 'chapter' },
  { label: '角色', value: 'character' }, { label: '事件', value: 'event' },
  { label: '故事弧线', value: 'story_arc' }, { label: '章节计划', value: 'chapter_plan' }, { label: '知识库', value: 'knowledge' },
  { label: '数据面板', value: 'data_panel' },
]

const characterOptions = computed(() => (novel.value?.characters || []).map(character => ({ label: character.name, value: character.id })))
const sortedArcs = computed(() => [...(novel.value?.storyArcs || [])].sort((a, b) => b.importance - a.importance || a.createdAt.localeCompare(b.createdAt)))
const activeArcCount = computed(() => sortedArcs.value.filter(arc => arc.status === 'active').length)
const pendingNodeCount = computed(() => sortedArcs.value.reduce((sum, arc) => sum + arc.nodes.filter(node => node.status === 'pending').length, 0))
const unresolvedEventCount = computed(() => (novel.value?.eventLog || []).filter(event => event.status !== 'resolved' && event.status !== 'abandoned').length)
const sortedPlans = computed(() => [...(novel.value?.chapterPlans || [])].sort((a, b) => a.targetChapterStart - b.targetChapterStart || a.createdAt.localeCompare(b.createdAt)))
const plansByHorizon = computed<Record<ChapterPlanHorizon, ChapterPlan[]>>(() => ({
  next: sortedPlans.value.filter(plan => plan.horizon === 'next' && (plan.status === 'planned' || plan.status === 'active')),
  near: sortedPlans.value.filter(plan => plan.horizon === 'near' && (plan.status === 'planned' || plan.status === 'active')),
  far: sortedPlans.value.filter(plan => plan.horizon === 'far' && (plan.status === 'planned' || plan.status === 'active')),
}))
const activePlanCount = computed(() => sortedPlans.value.filter(plan => plan.status === 'planned' || plan.status === 'active').length)
const pendingStateProposals = computed(() => (novel.value?.storyStateProposals || []).filter(proposal => proposal.status === 'pending'))
const pendingProposalCount = computed(() => pendingStateProposals.value.length)
const planningReady = computed(() => Boolean(
  novel.value?.volumes?.length
  && novel.value?.chapterPlans?.length
  && novel.value?.storyArcs?.length
  && novel.value?.eventLog?.length,
))
const latestCompletedChapter = computed(() => [...(novel.value?.chapters || [])]
  .filter(chapter => ['completed', 'reviewed', 'finalized', 'locked'].includes(chapter.status))
  .sort((a, b) => b.chapterIndex - a.chapterIndex)[0])
const memoryRecords = computed(() => novel.value ? buildSemanticRecords(novel.value, knowledgeStore.knowledgeBases) : [])
const memoryRecordCount = computed(() => memoryRecords.value.length)
const planVersionOptions = computed(() => (versionPlan.value?.versions || []).slice().reverse().map(version => ({
  label: `${version.label} · ${new Date(version.savedAt).toLocaleString('zh-CN')}`,
  value: version.id,
})))
const planVersionDiff = computed<PlanningDiff[]>(() => {
  const version = versionPlan.value?.versions?.find(item => item.id === selectedPlanVersionId.value)
  return versionPlan.value ? comparePlanningVersions(version, versionPlan.value) : []
})

const filteredEvents = computed(() => {
  const query = timelineQuery.value.trim().toLowerCase()
  return [...(novel.value?.eventLog || [])]
    .filter(event => timelineType.value === 'all' || event.type === timelineType.value)
    .filter(event => timelineStatus.value === 'all' || (event.status || 'resolved') === timelineStatus.value)
    .filter(event => !query || [event.title, event.description, event.location, event.storyTime, ...(event.characters || [])].some(value => value?.toLowerCase().includes(query)))
    .sort((a, b) => a.chapterIndex - b.chapterIndex || a.timestamp.localeCompare(b.timestamp))
})

async function refreshMemoryIndexInfo() {
  memoryIndexInfo.value = await getSemanticIndexInfo(novelId.value)
}

async function rebuildMemoryIndex() {
  if (!novel.value || memoryIndexing.value) return
  memoryIndexing.value = true
  try {
    const result = await syncSemanticIndexForNovel(novel.value, knowledgeStore.knowledgeBases, configStore.embedding, false)
    await refreshMemoryIndexInfo()
    const provider = result.provider === 'remote' ? `真实向量 ${result.model}` : '本地混合检索'
    const changes = result.updatedCount + result.removedCount
    message.success(changes
      ? `已同步 ${result.recordCount} 条记忆：更新 ${result.updatedCount} 条、移除 ${result.removedCount} 条，新增向量 ${result.embeddedCount} 条，使用 ${provider}`
      : `记忆索引已是最新，共 ${result.recordCount} 条，未重复生成向量`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '记忆索引构建失败')
  } finally {
    memoryIndexing.value = false
  }
}

async function runMemorySearch() {
  const query = memoryQuery.value.trim()
  searched.value = Boolean(query)
  if (!query || memorySearching.value) return
  memorySearching.value = true
  try {
    if (memoryIndexInfo.value.recordCount === 0 && memoryRecords.value.length > 0) {
      await rebuildMemoryIndex()
    }
    memoryResults.value = await queryPersistedSemanticEvidence(
      novelId.value,
      query,
      12,
      configStore.embedding,
      memorySource.value === 'all' ? undefined : memorySource.value,
    )
  } catch (error) {
    memoryResults.value = []
    message.error(error instanceof Error ? error.message : '项目记忆检索失败')
  } finally {
    memorySearching.value = false
  }
}

onMounted(() => { void refreshMemoryIndexInfo() })

watch(planningReady, ready => {
  if (!ready) {
    chapterCreationPrompted.value = false
    return
  }
  if (chapterCreationPrompted.value) return
  chapterCreationPrompted.value = true
  dialog.info({
    title: '剧情规划已完成',
    content: '分卷、章节计划、故事弧线和故事时间线都已创建完成，是否现在创建章节？',
    positiveText: '创建章节',
    negativeText: '稍后再说',
    onPositiveClick: () => router.push(`/workspace/${novelId.value}/chapters`),
  })
}, { immediate: true })

function arcTypeLabel(type: StoryArcType) { return arcTypeOptions.find(item => item.value === type)?.label || type }
function arcStatusLabel(status: StoryArcStatus) { return arcStatusOptions.find(item => item.value === status)?.label || status }
function eventStatusLabel(status?: EventLogEntry['status']) { return eventStatusOptions.find(item => item.value === (status || 'resolved'))?.label || '已解决' }
function eventChapterLabel(chapterIndex: number) { return chapterIndex < 0 ? '全书规划' : `第 ${chapterIndex + 1} 章` }
function sourceLabel(source: SemanticSourceType) { return memorySourceOptions.find(item => item.value === source)?.label || source }
function arcTypeColor(type: StoryArcType): 'error' | 'warning' | 'info' | 'success' | 'default' { return type === 'main' ? 'error' : type === 'character' ? 'success' : type === 'mystery' ? 'warning' : 'info' }
function arcStatusColor(status: StoryArcStatus): 'warning' | 'success' | 'default' | 'info' { return status === 'completed' ? 'success' : status === 'paused' ? 'warning' : status === 'active' ? 'info' : 'default' }
function eventTypeColor(type: EventLogEntry['type']): 'error' | 'warning' | 'info' | 'success' | 'default' { return type === '主线' ? 'error' : type === '伏笔' ? 'warning' : type === '转折' ? 'success' : type === '支线' ? 'info' : 'default' }
function completedNodeCount(arc: StoryArc) { return arc.nodes.filter(node => node.status === 'completed').length }
function arcProgress(arc: StoryArc) { return arc.nodes.length ? Math.round(completedNodeCount(arc) / arc.nodes.length * 100) : 0 }
function planStatusLabel(status: ChapterPlanStatus) { return planStatusOptions.find(item => item.value === status)?.label || status }
function planStatusColor(status: ChapterPlanStatus): 'warning' | 'success' | 'default' | 'info' { return status === 'completed' ? 'success' : status === 'active' ? 'info' : status === 'archived' ? 'default' : 'warning' }
function chapterRangeLabel(start: number, end: number) { return start === end ? `第 ${start + 1} 章` : `第 ${start + 1}-${end + 1} 章` }

async function generatePlans() {
  if (!novel.value?.outline || generatingPlans.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { message.warning('请先配置大纲模型'); return }
  novelStore.setChapterPlanConfirmed(novelId.value, false)
  generatingPlans.value = true
  try {
    const drafts = await generateChapterPlanDrafts(novel.value, model)
    const existing = new Set((novel.value.chapterPlans || []).map(plan => `${plan.horizon}:${plan.title.trim().toLowerCase()}:${plan.targetChapterStart}`))
    let added = 0
    for (const draft of drafts) {
      const key = `${draft.horizon}:${draft.title.trim().toLowerCase()}:${draft.targetChapterStart}`
      if (existing.has(key)) continue
      novelStore.addChapterPlan(novelId.value, draft)
      existing.add(key)
      added += 1
    }
    message.success(added ? `已生成 ${added} 条三层章节计划` : '没有新增计划，重复内容已跳过')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '章节计划生成失败')
  } finally {
    generatingPlans.value = false
  }
}

async function confirmVolumesAndGeneratePlans() {
  activeTab.value = 'plans'
  if (!novel.value) return
  if (!(novel.value.storyArcs || []).length) {
    message.info('分卷已确认，正在自动提取故事弧线')
    await extractArcsFromOutline({ onlyWhenEmpty: true, silent: true })
  }
  if ((novel.value?.chapterPlans || []).length) {
    novelStore.setChapterPlanConfirmed(novelId.value, true)
    message.success('分卷规划已确认，已有章节计划可继续编辑')
    return
  }
  message.info('分卷规划已确认，正在生成首批章节计划')
  await generatePlans()
  if ((novel.value?.chapterPlans || []).length) {
    novelStore.setChapterPlanConfirmed(novelId.value, true)
  }
}

const showPlanModal = ref(false)
const editingPlanId = ref('')
const planForm = ref(emptyPlanForm())
function defaultPlanStartChapter() {
  const unfinished = [...(novel.value?.chapters || [])].sort((a, b) => a.chapterIndex - b.chapterIndex)
    .find(chapter => !['completed', 'reviewed', 'finalized', 'locked'].includes(chapter.status))
  return unfinished ? unfinished.chapterIndex + 1 : Math.max(1, (novel.value?.chapters.length || 0) + 1)
}
function emptyPlanForm(horizon: ChapterPlanHorizon = 'next') {
  const startChapter = defaultPlanStartChapter()
  return { horizon, status: 'planned' as ChapterPlanStatus, title: '', objective: '', summary: '', beatsText: '', startChapter, endChapter: startChapter }
}
function openPlanModal(plan?: ChapterPlan, horizon: ChapterPlanHorizon = 'next') {
  editingPlanId.value = plan?.id || ''
  planForm.value = plan ? {
    horizon: plan.horizon,
    status: plan.status,
    title: plan.title,
    objective: plan.objective,
    summary: plan.summary,
    beatsText: plan.beats.join('\n'),
    startChapter: plan.targetChapterStart + 1,
    endChapter: plan.targetChapterEnd + 1,
  } : emptyPlanForm(horizon)
  showPlanModal.value = true
}
function submitPlan() {
  const data = {
    horizon: planForm.value.horizon,
    status: planForm.value.status,
    title: planForm.value.title.trim(),
    objective: planForm.value.objective.trim(),
    summary: planForm.value.summary.trim(),
    beats: planForm.value.beatsText.split(/\r?\n/).map(item => item.replace(/^[-*\d.、)\s]+/, '').trim()).filter(Boolean),
    targetChapterStart: Math.max(0, planForm.value.startChapter - 1),
    targetChapterEnd: Math.max(planForm.value.startChapter - 1, planForm.value.endChapter - 1),
    relatedArcIds: [] as string[],
    relatedEventIds: [] as string[],
    source: 'user' as const,
  }
  if (editingPlanId.value) novelStore.updateChapterPlan(novelId.value, editingPlanId.value, data)
  else novelStore.addChapterPlan(novelId.value, data)
  showPlanModal.value = false
  message.success('章节计划已保存')
}
function removePlan(planId: string) { novelStore.deleteChapterPlan(novelId.value, planId); message.success('章节计划已删除') }

function openPlanVersionModal(plan: ChapterPlan) {
  versionPlan.value = plan
  selectedPlanVersionId.value = plan.versions?.[plan.versions.length - 1]?.id || ''
  showPlanVersionModal.value = true
}

function restoreSelectedPlanVersion() {
  if (!versionPlan.value || !selectedPlanVersionId.value) return
  if (novelStore.restoreChapterPlanVersion(novelId.value, versionPlan.value.id, selectedPlanVersionId.value)) {
    showPlanVersionModal.value = false
    versionPlan.value = null
    message.success('章节计划已恢复')
  }
}

function refreshPlan(plan: ChapterPlan) {
  if (regeneratingPlanId.value) return
  const nextChapter = Math.max(0, (novel.value?.chapters || []).length)
  const updates = createLocalChapterPlanRefresh(plan, nextChapter)
  novelStore.updateChapterPlan(novelId.value, plan.id, updates)
  message.success('已根据当前滚动位置局部刷新下一章计划，可继续编辑细节')
}

async function scanLatestChapterState() {
  if (!novel.value || !latestCompletedChapter.value || scanningState.value) return
  const model = configStore.getModelForTask('review') || configStore.getModelForTask('writing')
  if (!model) { message.warning('请先配置审查模型'); return }
  scanningState.value = true
  try {
    const drafts = await generateStoryStateProposalDrafts(novel.value, latestCompletedChapter.value, model)
    let added = 0
    for (const draft of drafts) {
      if (novelStore.addStoryStateProposal(novelId.value, draft)) added += 1
    }
    message.success(added ? `已生成 ${added} 条状态提案` : '没有发现需要调整的故事状态')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '故事状态检查失败')
  } finally {
    scanningState.value = false
  }
}

const proposalTargetLabels: Record<StoryStateTargetType, string> = { story_arc: '故事弧线', arc_node: '弧线节点', event: '时间线事件', chapter_plan: '章节计划' }
const proposalStatusLabels: Record<string, string> = {
  active: '推进中', paused: '暂停', completed: '已完成', abandoned: '已放弃', pending: '待完成',
  planted: '已埋设', developing: '推进中', resolved: '已解决', planned: '待执行', archived: '已归档',
}
function proposalTargetLabel(target: StoryStateTargetType) { return proposalTargetLabels[target] }
function proposalFieldLabel(field: StoryStateProposalField) { return field === 'status' ? '状态变更' : '预计章节调整' }
function proposalValueLabel(proposal: StoryStateProposal) {
  if (proposal.field === 'targetChapter') return `第 ${Number(proposal.oldValue) + 1} 章 → 第 ${Number(proposal.newValue) + 1} 章`
  return `${proposalStatusLabels[proposal.oldValue] || proposal.oldValue} → ${proposalStatusLabels[proposal.newValue] || proposal.newValue}`
}
function acceptProposal(proposalId: string) {
  if (novelStore.applyStoryStateProposal(novelId.value, proposalId)) message.success('状态提案已应用')
  else message.warning('目标已变化或不存在，请忽略这条过期提案')
}
function rejectProposal(proposalId: string) { novelStore.rejectStoryStateProposal(novelId.value, proposalId); message.success('状态提案已忽略') }

function handleExtractArcs() {
  return extractArcsFromOutline()
}

async function extractArcsFromOutline(options: { onlyWhenEmpty?: boolean; silent?: boolean } = {}) {
  if (!novel.value?.outline || extractingArcs.value) return
  if (options.onlyWhenEmpty && (novel.value.storyArcs || []).length) return
  const model = configStore.getModelForTask('outline')
  if (!model) { message.warning('请先配置大纲模型'); return }
  extractingArcs.value = true
  try {
    const suggestions = await generateStoryArcDrafts(novel.value, model)
    const existingTitles = new Set((novel.value.storyArcs || []).map(arc => arc.title.trim().toLowerCase()))
    let createdCount = 0
    for (const suggestion of suggestions) {
      if (existingTitles.has(suggestion.title.toLowerCase())) continue
      const characterIds = novel.value.characters
        .filter(character => suggestion.characterNames.some(name => name === character.name || character.aliases.includes(name)))
        .map(character => character.id)
      const arc = novelStore.addStoryArc(novelId.value, {
        title: suggestion.title,
        description: suggestion.description,
        type: suggestion.type,
        importance: suggestion.importance,
        status: 'active',
        characterIds,
      })
      if (!arc) continue
      for (const node of suggestion.nodes) {
        novelStore.addStoryArcNode(novelId.value, arc.id, {
          title: node.title,
          description: node.description,
          targetChapter: node.targetChapter - 1,
        })
      }
      existingTitles.add(suggestion.title.toLowerCase())
      createdCount += 1
    }
    if (!createdCount && !options.silent) message.info('没有新增弧线，同名内容已跳过')
    else if (createdCount && !options.silent) message.success(`已提取 ${createdCount} 条故事弧线`)
  } catch (error) {
    if (options.silent) message.warning('故事弧线自动提取失败，可手动重试')
    else message.error(error instanceof Error ? error.message : '故事弧线提取失败')
  } finally {
    extractingArcs.value = false
  }
}

const showArcModal = ref(false)
const editingArcId = ref('')
const arcForm = ref(emptyArcForm())
function emptyArcForm() {
  return { title: '', description: '', type: 'sub' as StoryArcType, importance: 3 as 1 | 2 | 3 | 4 | 5, status: 'active' as StoryArcStatus, reactivateAt: '', characterIds: [] as string[] }
}
function openArcModal(arc?: StoryArc) {
  editingArcId.value = arc?.id || ''
  arcForm.value = arc ? {
    title: arc.title, description: arc.description, type: arc.type, importance: arc.importance,
    status: arc.status, reactivateAt: arc.reactivateAt, characterIds: [...arc.characterIds],
  } : emptyArcForm()
  showArcModal.value = true
}
function submitArc() {
  if (editingArcId.value) novelStore.updateStoryArc(novelId.value, editingArcId.value, { ...arcForm.value })
  else novelStore.addStoryArc(novelId.value, { ...arcForm.value })
  showArcModal.value = false
  message.success('故事弧线已保存')
}
function removeArc(arcId: string) { novelStore.deleteStoryArc(novelId.value, arcId); message.success('故事弧线已删除') }

const showNodeModal = ref(false)
const nodeArcId = ref('')
const nodeForm = ref({ title: '', description: '', targetChapter: 1 })
function openNodeModal(arcId: string) { nodeArcId.value = arcId; nodeForm.value = { title: '', description: '', targetChapter: Math.max(1, (novel.value?.chapters.length || 0) + 1) }; showNodeModal.value = true }
function submitNode() {
  novelStore.addStoryArcNode(novelId.value, nodeArcId.value, { title: nodeForm.value.title, description: nodeForm.value.description, targetChapter: nodeForm.value.targetChapter - 1 })
  showNodeModal.value = false
  message.success('里程碑已添加')
}
function toggleNode(arc: StoryArc, node: StoryArcNode) {
  const completed = node.status !== 'completed'
  novelStore.updateStoryArcNode(novelId.value, arc.id, node.id, { status: completed ? 'completed' : 'pending', actualChapter: completed ? Math.max(0, (novel.value?.chapters.length || 1) - 1) : undefined })
}
function removeNode(arcId: string, nodeId: string) { novelStore.deleteStoryArcNode(novelId.value, arcId, nodeId) }

const showEventModal = ref(false)
const editingEventId = ref('')
const eventForm = ref(emptyEventForm())
function emptyEventForm() {
  return { title: '', description: '', type: '主线' as EventLogEntry['type'], status: 'developing' as NonNullable<EventLogEntry['status']>, chapter: Math.max(1, novel.value?.chapters.length || 1), targetChapter: null as number | null, storyTime: '', location: '', importance: 3 as 1 | 2 | 3 | 4 | 5, characters: '' }
}
function openEventModal(event?: EventLogEntry) {
  editingEventId.value = event?.id || ''
  eventForm.value = event ? {
    title: event.title, description: event.description, type: event.type, status: event.status || 'resolved',
    chapter: event.chapterIndex + 1, targetChapter: event.targetChapter !== undefined ? event.targetChapter + 1 : null,
    storyTime: event.storyTime || '', location: event.location || '', importance: event.importance || 3,
    characters: (event.characters || []).join('、'),
  } : emptyEventForm()
  showEventModal.value = true
}
function eventPayload() {
  return {
    title: eventForm.value.title.trim(), description: eventForm.value.description.trim(), type: eventForm.value.type,
    status: eventForm.value.status, chapterIndex: eventForm.value.chapter - 1,
    targetChapter: eventForm.value.targetChapter ? eventForm.value.targetChapter - 1 : undefined,
    storyTime: eventForm.value.storyTime.trim(), location: eventForm.value.location.trim(), importance: eventForm.value.importance,
    characters: eventForm.value.characters.split(/[,，、]/).map(value => value.trim()).filter(Boolean),
    scope: 'chapter' as const, hintCount: 0, source: 'user' as const,
  }
}
function submitEvent() {
  if (editingEventId.value) novelStore.updateEvent(novelId.value, editingEventId.value, eventPayload())
  else novelStore.addEvent(novelId.value, eventPayload())
  showEventModal.value = false
  message.success('时间线事件已保存')
}
function removeEvent(eventId: string) { novelStore.deleteEvent(novelId.value, eventId); message.success('事件已删除') }
</script>

<style scoped>
.story-planner { max-width: 1180px; margin: 0 auto; padding-bottom: 56px; }
.planner-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.header-actions { display: flex; gap: 8px; }
.page-subtitle { margin-top: 5px; color: var(--text-color-tertiary); font-size: 13px; }
.planner-summary { display: flex; flex-wrap: wrap; gap: 22px; padding: 12px 0 16px; border-bottom: 1px solid var(--border-color-light); color: var(--text-color-secondary); font-size: 13px; }
.planner-summary strong { margin-right: 4px; color: var(--text-color-primary); font-size: 16px; }
.plan-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding-top: 10px; }
.plan-lane { min-width: 0; }
.plan-lane-header { display: flex; min-height: 52px; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 0 2px 10px; border-bottom: 2px solid var(--border-color-light); }
.plan-lane-header div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.plan-lane-header strong { color: var(--text-color-primary); font-size: 15px; }
.plan-lane-header span { color: var(--text-color-tertiary); font-size: 11px; }
.plan-list { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; }
.plan-card { min-width: 0; padding: 14px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); background: var(--bg-color); }
.version-dialog { display: grid; gap: 12px; }
.version-current { margin: 0; color: var(--text-color-secondary); }
.version-diff-list { display: grid; gap: 8px; max-height: 360px; overflow: auto; }
.version-diff-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 20px minmax(0, 1fr); gap: 8px; padding: 8px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); font-size: 13px; }
.version-diff-row span { overflow-wrap: anywhere; }
.plan-card-header, .plan-card-header > div, .proposal-header, .proposal-header > div { display: flex; align-items: center; gap: 7px; }
.plan-card-header, .proposal-header { justify-content: space-between; }
.plan-card h3 { margin: 10px 0 7px; color: var(--text-color-primary); font-size: 15px; }
.plan-card p { margin: 7px 0; color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
.plan-card small { color: var(--text-color-tertiary); }
.plan-range { color: var(--text-color-tertiary); font-size: 11px; }
.plan-objective { display: block; color: var(--color-primary); font-size: 12px; line-height: 1.5; }
.plan-beats { margin: 8px 0 10px; padding-left: 18px; color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; }
.empty-plan { display: flex; min-height: 96px; align-items: center; justify-content: center; flex-direction: column; gap: 6px; border: 1px dashed var(--border-color); border-radius: var(--radius-md); background: transparent; color: var(--text-color-tertiary); cursor: pointer; }
.empty-plan:hover { border-color: var(--color-primary); color: var(--color-primary); }
.proposal-list { display: flex; flex-direction: column; padding-top: 8px; }
.proposal-card { padding: 16px 0; border-bottom: 1px solid var(--border-color-light); }
.proposal-header { flex-wrap: wrap; }
.proposal-header strong { color: var(--text-color-primary); font-size: 14px; }
.proposal-header > span { color: var(--text-color-tertiary); font-size: 12px; }
.proposal-change { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; }
.proposal-change span { color: var(--text-color-tertiary); font-size: 12px; }
.proposal-change code { padding: 4px 7px; border-radius: var(--radius-sm); background: var(--bg-color-secondary); color: var(--text-color-primary); font-family: inherit; font-size: 12px; }
.proposal-card p, .proposal-card blockquote { color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; }
.proposal-card blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--border-color); color: var(--text-color-tertiary); }
.proposal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.arc-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 14px; padding-top: 8px; }
.arc-card { min-width: 0; padding: 18px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); background: var(--bg-color); }
.arc-card-header, .arc-title-row, .timeline-heading, .timeline-heading > div, .memory-result-header { display: flex; align-items: center; gap: 8px; }
.arc-card-header, .timeline-heading { justify-content: space-between; }
.arc-title-row { min-width: 0; flex-wrap: wrap; }
.arc-title-row h3 { margin: 0; font-size: 16px; color: var(--text-color-primary); }
.icon-actions { display: flex; flex-shrink: 0; }
.arc-description { min-height: 42px; margin: 12px 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.arc-meta, .timeline-meta { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--text-color-tertiary); font-size: 12px; }
.progress-track { height: 4px; margin: 10px 0 14px; overflow: hidden; background: var(--progress-track); border-radius: 2px; }
.progress-value { height: 100%; background: var(--color-primary); transition: width .2s ease; }
.node-list { border-top: 1px solid var(--border-color-light); }
.node-row { display: grid; grid-template-columns: 24px 64px minmax(0, 1fr) 28px; align-items: center; gap: 8px; min-height: 48px; border-bottom: 1px solid var(--border-color-light); }
.node-toggle { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--color-primary); cursor: pointer; }
.node-chapter { color: var(--text-color-tertiary); font-size: 12px; }
.node-content { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.node-content strong { color: var(--text-color-primary); font-size: 13px; }
.node-content span { overflow: hidden; color: var(--text-color-tertiary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.node-completed .node-content { opacity: .65; }
.node-completed .node-content strong { text-decoration: line-through; }
.node-empty { padding: 18px 0; color: var(--text-color-tertiary); font-size: 12px; text-align: center; }
.add-node-button { margin-top: 12px; }
.filter-bar, .memory-search { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 150px; gap: 10px; padding: 8px 0 18px; }
.memory-search { grid-template-columns: minmax(240px, 1fr) 160px auto; }
.index-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0 4px; color: var(--text-color-tertiary); font-size: 12px; }
.timeline-list { position: relative; }
.timeline-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 18px; }
.timeline-marker { position: relative; padding-top: 18px; color: var(--text-color-tertiary); font-size: 12px; text-align: right; }
.timeline-marker::after { position: absolute; top: 0; right: -14px; width: 1px; height: 100%; background: var(--border-color-light); content: ''; }
.timeline-marker i { position: absolute; z-index: 1; top: 22px; right: -18px; width: 9px; height: 9px; border: 2px solid var(--color-primary); border-radius: 50%; background: var(--bg-color); }
.timeline-content { min-width: 0; padding: 14px 0 20px; border-bottom: 1px solid var(--border-color-light); }
.timeline-heading strong { font-size: 14px; }
.timeline-content p { margin: 8px 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
.character-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.memory-results { display: flex; flex-direction: column; }
.memory-result { padding: 15px 0; border-bottom: 1px solid var(--border-color-light); }
.memory-result-header { flex-wrap: wrap; }
.memory-result-header strong { font-size: 14px; }
.memory-result-header span { margin-left: auto; color: var(--text-color-tertiary); font-size: 12px; }
.memory-result p { margin: 8px 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; }
.memory-result small { color: var(--text-color-tertiary); }
.memory-placeholder { display: flex; min-height: 280px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--text-color-tertiary); text-align: center; }
.memory-placeholder strong { color: var(--text-color-secondary); }
.empty-block { padding: 70px 0; }
.form-modal { width: min(680px, calc(100vw - 32px)); }
.small-modal { width: min(480px, calc(100vw - 32px)); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.span-2 { grid-column: span 2; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 720px) {
  .planner-header { align-items: stretch; flex-direction: column; }
  .header-actions { align-self: stretch; }
  .header-actions :deep(.n-button) { flex: 1; }
  .filter-bar, .memory-search, .form-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .timeline-row { grid-template-columns: 68px minmax(0, 1fr); gap: 12px; }
  .node-row { grid-template-columns: 24px 54px minmax(0, 1fr) 28px; }
  .plan-board { grid-template-columns: 1fr; }
}
</style>
