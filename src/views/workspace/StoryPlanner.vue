<template>
  <div class="story-planner page-container fade-in" :class="{ 'v3-embedded': props.embedded }">
    <header class="planner-header" :class="{ 'planner-header-compact': props.embedded }">
      <div v-if="!props.embedded">
        <h2 class="page-title">剧情规划</h2>
        <p class="page-subtitle">从分卷到章节，统一管理剧情推进、关键事件与项目记忆</p>
      </div>
      <div v-if="activeTab === 'plans'" class="header-actions">
        <n-button secondary :loading="generatingPlans" :disabled="!novel?.outline || !workspaceReady || planSaving || showPlanModal" @click="generatePlans">AI 生成计划</n-button>
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
      <n-button v-else-if="activeTab === 'proposals'" :loading="scanningState" :disabled="!latestCompletedChapter" type="primary" @click="scanChapterState()">
        检查最新章节
      </n-button>
    </header>

    <section v-for="pending in pendingStateScans" :key="pending.chapterId" class="paper-panel" aria-label="状态扫描待保存结果">
      <p>《{{ pending.title || '未命名章节' }}》的状态提案尚未保存，重试会使用已返回的结果。</p>
      <p v-if="pending.error" role="alert">{{ pending.error }}</p>
      <n-button :disabled="scanningState || stateScans.isRunning(novelId, pending.chapterId)" @click="runStateScan(pending.chapterId)">重试保存状态提案</n-button>
      <n-button :disabled="stateScans.isRunning(novelId, pending.chapterId)" @click="stateScans.discard(novelId, pending.chapterId)">放弃状态扫描结果</n-button>
    </section>
    <section v-if="!props.embedded" class="planner-overview" aria-label="规划概览"><div class="planner-summary">
      <span><strong>{{ activeArcCount }}</strong> 条活跃弧线</span>
      <span><strong>{{ pendingNodeCount }}</strong> 个待完成节点</span>
      <span><strong>{{ unresolvedEventCount }}</strong> 个待推进事件</span>
      <span><strong>{{ activePlanCount }}</strong> 条进行中计划</span>
      <span><strong>{{ awaitingPlans.length }}</strong> 条计划待核对</span>
      <span><strong>{{ openPromises.length }}</strong> 条未兑现期待</span>
      <span><strong>{{ pendingProposalCount }}</strong> 条待审状态提案</span>
      <span><strong>{{ memoryRecordCount }}</strong> 条可检索记忆</span>
    </div></section>

    <n-tabs v-model:value="activeTab" type="line" class="planner-tabs" @update:value="handleTabChange">
      <n-tab-pane display-directive="show:lazy" name="event-causality" tab="事件因果">
        <EventCausalityPanel v-if="novel && workspaceReady" :novel="novel" />
        <p v-else>创作工作区尚未读取完成。</p>
      </n-tab-pane>
      <n-tab-pane display-directive="show:lazy" name="impacts" tab="设定影响">
        <StoryImpactHistory v-if="novel && workspaceReady" :novel="novel" :reports="reconstructionWorkspaceStore.getImpactReports(novelId)"
          :workspace="{ creationDraft: reconstructionWorkspaceStore.getCreationDraft(novelId), storyMemories: reconstructionWorkspaceStore.getStoryMemories(novelId) }" />
        <p v-else>创作工作区尚未读取完成，暂时无法显示影响记录。</p>
      </n-tab-pane>
      <n-tab-pane display-directive="show:lazy" name="volumes" tab="分卷规划">
        <VolumeOutline
          embedded
          :chapter-plan-confirmed="Boolean(novel?.chapterPlanConfirmed)"
          @confirmed="confirmVolumesAndGeneratePlans"
        />
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="plans" tab="章节计划">
        <section v-if="planSuggestions.length" class="arc-draft-panel paper-panel" aria-label="待确认章节计划建议">
          <h3>章节计划建议 · {{ planSuggestions.length }} 条待确认</h3>
          <p>先编辑核对，再确认加入规划。未确认的建议仅保留在当前页面。</p>
          <article v-for="suggestion in planSuggestions" :key="suggestion.id" class="arc-draft-row">
            <div><strong>{{ suggestion.draft.title }}</strong><p>{{ suggestion.draft.objective }}</p><p>{{ suggestion.draft.summary }}</p></div>
            <n-button :disabled="planSaving" @click="openPlanSuggestion(suggestion.id)">编辑建议</n-button>
            <n-button :disabled="planSaving" @click="planSuggestions = planSuggestions.filter(item => item.id !== suggestion.id)">忽略</n-button>
          </article>
          <n-button type="primary" :loading="planSaving" :disabled="showPlanModal || generatingPlans" @click="acceptPlanSuggestions">确认这些章节计划</n-button>
        </section>
        <div class="plan-workbench"><div class="plan-board">
          <section v-for="lane in planStatusLanes" :key="lane.status" class="plan-lane">
            <div class="plan-lane-header">
              <div>
                <strong>{{ lane.label }}</strong>
                <span>{{ lane.description }}</span>
              </div>
              <n-tag size="small" round>{{ plansByStatus(lane.status).length }}</n-tag>
            </div>
            <div class="plan-list">
              <article v-for="plan in plansByStatus(lane.status)" :key="plan.id" class="plan-card" :class="{ selected: selectedPlan?.id === plan.id }">
                <div class="plan-card-header">
                  <div>
                    <n-tag size="small" :type="planStatusColor(plan.status)">{{ planStatusLabel(plan.status) }}</n-tag>
                    <span class="plan-range">{{ chapterRangeLabel(plan.targetChapterStart, plan.targetChapterEnd) }}</span>
                  </div>
                  <details class="plan-card-menu"><summary aria-label="计划操作">⋯</summary><div class="icon-actions">
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
                  </div></details>
                </div>
                <button type="button" class="planning-select-title" :aria-pressed="selectedPlan?.id === plan.id" @click="selectedPlanId = plan.id">{{ plan.title }}</button>
                <strong class="plan-objective">{{ plan.objective }}</strong>
                <p>{{ plan.summary }}</p>
                <ol v-if="plan.beats.length" class="plan-beats">
                  <li v-for="beat in plan.beats" :key="beat">{{ beat }}</li>
                </ol>
                <small>{{ plan.source === 'ai' ? 'AI 生成' : '手动创建' }}</small>
              </article>
              <button v-if="plansByStatus(lane.status).length === 0" class="empty-plan" @click="openPlanModal()">
                <n-icon :size="20"><add-outline /></n-icon>
                <span>新建计划</span>
              </button>
            </div>
          </section>
        </div><aside v-if="selectedPlan" class="plan-selection-detail paper-panel">
          <n-tag size="small" :type="planStatusColor(selectedPlan.status)">{{ planStatusLabel(selectedPlan.status) }}</n-tag><h3>{{ selectedPlan.title }}</h3>
          <p>{{ chapterRangeLabel(selectedPlan.targetChapterStart, selectedPlan.targetChapterEnd) }}</p>
          <section><h4>阶段目标</h4><p>{{ selectedPlan.objective }}</p></section>
          <section v-if="selectedPlan.summary"><h4>推进说明</h4><p>{{ selectedPlan.summary }}</p></section>
          <section v-if="selectedPlan.beats.length"><h4>写作节拍</h4><ol><li v-for="beat in selectedPlan.beats" :key="beat">{{ beat }}</li></ol></section>
          <section v-if="selectedPlan.relatedArcIds.length"><h4>关联弧线</h4><p>{{ selectedPlan.relatedArcIds.map(id => sortedArcs.find(arc => arc.id === id)?.title).filter(Boolean).join('、') || '暂无对应弧线' }}</p></section>
          <n-button @click="openPlanModal(selectedPlan)">编辑计划</n-button>
        </aside></div>
        <details v-if="closedPlans.length" class="closed-plans"><summary>已完成与已归档（{{ closedPlans.length }}）</summary><button v-for="plan in closedPlans" :key="plan.id" type="button" @click="selectedPlanId = plan.id">{{ plan.title }} · {{ planStatusLabel(plan.status) }}</button></details>
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="scenes" tab="场景设计">
        <ScenePlanner v-if="novel" :novel="novel" :ready="workspaceReady" :initial-plan-id="props.initialTab === 'scenes' ? props.initialSelection : undefined" />
      </n-tab-pane>
      <n-tab-pane display-directive="show:lazy" name="relay" tab="剧情接力">
        <div class="relay-workbench">
        <section class="relay-section">
          <div class="relay-heading">
            <h3>待核对计划</h3>
            <n-button v-if="latestCompletedChapter" text type="primary" :loading="scanningState" @click="scanChapterState()">检查最新章节</n-button>
          </div>
          <div v-if="awaitingPlans.length" class="relay-list">
            <div v-for="plan in awaitingPlans" :key="plan.id" class="relay-row" :class="{ selected: selectedRelayPlan?.id === plan.id }">
              <div class="relay-main">
                <button type="button" class="planning-select-title" :aria-pressed="selectedRelayPlan?.id === plan.id" @click="selectedRelayId = plan.id">{{ plan.title }}</button>
                <span>{{ chapterRangeLabel(plan.targetChapterStart, plan.targetChapterEnd) }} · {{ plan.objective }}</span>
              </div>
              <div class="relay-actions">
                <n-button size="small" secondary :loading="scanningState" @click="scanChapterState(plan.targetChapterEnd, plan.targetChapterStart)">AI 核对</n-button>
                <n-button size="small" quaternary @click="openPlanModal(plan)">手动核对</n-button>
              </div>
            </div>
          </div>
          <n-empty v-else description="没有待核对的章节计划" />
        </section>
        <section v-if="selectedRelayPlan" class="relay-selection paper-panel">
          <h3>{{ selectedRelayPlan.title }}</h3><p>{{ chapterRangeLabel(selectedRelayPlan.targetChapterStart, selectedRelayPlan.targetChapterEnd) }}</p>
          <section><h4>阶段目标</h4><p>{{ selectedRelayPlan.objective }}</p></section>
          <section v-if="selectedRelayPlan.beats.length"><h4>计划要点</h4><ul><li v-for="beat in selectedRelayPlan.beats" :key="beat">{{ beat }}</li></ul></section>
          <section v-if="selectedRelayPlan.summary"><h4>推进说明</h4><p>{{ selectedRelayPlan.summary }}</p></section>
          <section v-if="relayChapter"><h4>关联章节</h4><strong>第 {{ relayChapter.chapterIndex + 1 }} 章 · {{ chapterTitleForDisplay(relayChapter.title, relayChapter.chapterIndex) }}</strong><p>{{ relayChapter.summary || '本章尚未整理摘要，可打开章节查看正文。' }}</p><p v-if="relayChapter.summary && getChapterSummaryStatus(relayChapter) !== 'current'">总结待核对，暂不用于 AI 写作和审核。</p><n-button text type="primary" @click="router.push(`/workspace/${novelId}/editor/${relayChapter.id}`)">查看章节</n-button></section>
          <div class="relay-detail-actions"><n-button type="primary" :loading="scanningState" @click="scanChapterState(selectedRelayPlan.targetChapterEnd, selectedRelayPlan.targetChapterStart)">AI 核对计划</n-button><n-button @click="openPlanModal(selectedRelayPlan)">手动核对</n-button></div>
        </section>
        <section v-else class="relay-selection paper-panel"><h3>剧情接力</h3><p>计划进入待核对后，可在这里对照正文继续推进故事。</p></section>
        <div class="relay-context">
        <section class="relay-section">
          <div class="relay-heading">
            <h3>未兑现的期待</h3>
            <n-button text type="primary" @click="openEventModal()">手动记录</n-button>
          </div>
          <div v-if="openPromises.length" class="relay-list">
            <div v-for="event in openPromises" :key="event.id" class="relay-row">
              <div class="relay-main">
                <strong>{{ event.title }}</strong>
                <span>{{ eventChapterLabel(event.chapterIndex) }}{{ event.chapterIndex >= 0 ? '提出' : '' }} · {{ event.lastProgressChapterIndex === undefined ? '尚未记录后续推进' : `最近第 ${event.lastProgressChapterIndex + 1} 章推进` }}</span>
                <span v-if="event.relatedArcIds?.length">关联：{{ event.relatedArcIds.map(id => novel?.storyArcs?.find(arc => arc.id === id)?.title).filter(Boolean).join('、') }}</span>
                <span v-if="event.evidence" class="relay-evidence">原文：{{ event.evidence }}</span>
              </div>
              <n-button size="small" quaternary title="编辑期待" @click="openEventModal(event)">
                <template #icon><n-icon><create-outline /></n-icon></template>
              </n-button>
            </div>
          </div>
          <n-empty v-else description="没有未兑现的长线期待" />
        </section>
        <section class="relay-section">
          <div class="relay-heading"><h3>活跃弧线</h3></div>
          <div v-if="relayArcs.length" class="relay-list">
            <div v-for="arc in relayArcs" :key="arc.id" class="relay-row">
              <div class="relay-main">
                <strong>{{ arc.title }}</strong>
                <span>{{ arc.description || '尚未填写目标' }} · {{ arc.nodes.filter(node => node.status === 'pending').length }} 个待推进节点</span>
              </div>
              <n-button size="small" quaternary title="编辑弧线" @click="openArcModal(arc)">
                <template #icon><n-icon><create-outline /></n-icon></template>
              </n-button>
            </div>
          </div>
          <n-empty v-else description="没有活跃弧线" />
        </section>
        </div></div>
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="arcs" tab="故事弧线">
        <section v-if="arcSuggestions.length" class="arc-draft-panel paper-panel" aria-label="待确认弧线建议">
          <h3>AI 弧线建议 · {{ arcSuggestions.length }} 条待确认</h3>
          <p>建议只有经你编辑确认后才进入剧情规划。未确认的建议仅保留在当前页面。</p>
          <article v-for="suggestion in arcSuggestions" :key="suggestion.id" class="arc-draft-row">
            <div><strong>{{ suggestion.draft.title }}</strong><p>{{ suggestion.draft.description }}</p></div>
            <n-button :disabled="arcSaving" @click="openArcSuggestion(suggestion.id)">编辑并确认</n-button>
            <n-button :disabled="arcSaving" @click="arcSuggestions = arcSuggestions.filter(item => item.id !== suggestion.id)">忽略</n-button>
          </article>
        </section>
        <details v-if="lastArcImpact" class="arc-impact paper-panel">
          <summary>最近变更：{{ lastArcImpact.arcIds.length }} 条关联弧线，实际需重审 {{ lastArcImpact.reviewChapterIds.length }} 章</summary>
          <p>图关联范围覆盖 {{ lastArcImpact.chapterIds.length }} 章；实际重审集合按本次审核输入变化确定。</p>
          <n-button text type="primary" @click="activeTab = 'impacts'">查看已保存的影响记录</n-button>
          <p v-for="id in lastArcImpact.chapterIds" :key="id">{{ novel?.chapters.find(chapter => chapter.id === id)?.title }}：{{ lastArcImpact.reasons[id]?.join('；') }}</p>
        </details>
        <div v-if="sortedArcs.length || unavailableSelectedArc" class="arc-workbench" :class="{ 'source-only': !sortedArcs.length }">
          <div v-if="sortedArcs.length" class="arc-selector"><button v-for="arc in sortedArcs" :key="arc.id" type="button" class="arc-selector-card paper-panel" :class="{ selected: selectedArc?.id === arc.id }" :aria-pressed="selectedArc?.id === arc.id" @click="selectedArcId = arc.id"><div><h3>{{ arc.title }}</h3><n-tag size="small" :type="arcTypeColor(arc.type)">{{ arcTypeLabel(arc.type) }}</n-tag></div><p>{{ arc.description || '暂未填写弧线描述' }}</p><div class="arc-node-track"><span v-for="node in arc.nodes" :key="node.id" :class="{ completed: node.status === 'completed' }"><i>{{ node.status === 'completed' ? '✓' : '·' }}</i><small>{{ node.title }}</small></span></div><span class="arc-selector-meta">{{ completedNodeCount(arc) }}/{{ arc.nodes.length }} 个节点已完成 · {{ arcStatusLabel(arc.status) }}</span></button></div>
          <article v-if="unavailableSelectedArc" class="arc-card arc-source-recovery">
            <p class="entity-source-alert" role="alert">来源待核对。原记录仍保留，核对前不会用于 AI 写作和审校。</p>
            <h3>{{ unavailableSelectedArc.title }}</h3>
            <p>这条弧线的来源已失效，旧结论暂不显示。请打开原记录核对，再明确保存。</p>
            <n-button @click="openArcModal(unavailableSelectedArc)">核对原弧线</n-button>
            <details class="arc-history"><summary>查看原记录来源与历史</summary><EntitySourceHistory v-if="novel" :novel="novel" kind="arc" :entity="unavailableSelectedArc" @open-chapter="openSourceChapter" /></details>
          </article>
          <article v-for="arc in selectedArc ? [selectedArc] : []" :key="arc.id" class="arc-card">
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
            <dl class="arc-design-fields">
              <template v-for="field in arcDesignFields" :key="field.key"><template v-if="arc[field.key]"><dt>{{ field.label }}</dt><dd>{{ arc[field.key] }}</dd></template></template>
              <template v-if="arc.dependencyArcIds?.length"><dt>前置剧情线</dt><dd>{{ arc.dependencyArcIds.map(id => sortedArcs.find(item => item.id === id)?.title || id).join('、') }}</dd></template>
            </dl>
            <details class="arc-history"><summary>查看剧情线来源与修改历史</summary><entity-source-history v-if="novel" :novel="novel" kind="arc" :entity="arc" @open-chapter="id => router.push(`/workspace/${novelId}/editor/${id}`)" /></details>
            <section v-if="arc.characterIds.length" class="arc-related-characters"><h4>相关角色</h4><span v-for="id in arc.characterIds" :key="id">{{ novel?.characters.find(character => character.id === id)?.name || '未关联角色' }}</span></section>

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
                  <span>{{ node.status === 'completed' ? '已确认发生' : node.status === 'unverified' ? '正文来源或前置条件待核对' : node.status === 'abandoned' ? '已放弃' : '计划节点' }}</span>
                  <details v-if="novel && node.provenance?.revisions.length"><summary>来源与变更记录</summary><entity-source-history :novel="novel" kind="arc_node" :entity="node" @open-chapter="id => router.push(`/workspace/${novelId}/editor/${id}`)" /></details>
                </div>
                <n-button text size="small" :disabled="arcSaving" @click="openNodeModal(arc.id, node)">编辑节点</n-button>
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

      <n-tab-pane display-directive="show:lazy" name="timeline" tab="故事时间线">
        <div class="filter-bar">
          <n-input v-model:value="timelineQuery" clearable placeholder="搜索事件、地点或角色" />
          <n-select v-model:value="timelineType" :options="timelineTypeOptions" />
          <n-select v-model:value="timelineStatus" :options="timelineStatusOptions" />
        </div>

        <div v-if="filteredEvents.length" class="timeline-workbench"><div class="timeline-list">
          <article v-for="event in filteredEvents" :key="event.id" class="timeline-row" :class="{ selected: selectedEvent?.id === event.id }">
            <div class="timeline-marker">
              <span>{{ eventChapterLabel(event.chapterIndex) }}</span>
              <i></i>
            </div>
            <div class="timeline-content">
              <div class="timeline-heading">
                <div>
                  <n-tag size="small" :type="eventTypeColor(event.type)">{{ event.type }}</n-tag>
                  <button type="button" class="planning-select-title" :aria-pressed="selectedEvent?.id === event.id" @click="selectedEventId = event.id">{{ event.title }}</button>
                </div>
                <div class="icon-actions">
                  <n-button quaternary circle size="small" title="编辑事件" @click="openEventModal(event)">
                    <template #icon><n-icon><create-outline /></n-icon></template>
                  </n-button>
                  <n-popconfirm @positive-click="removeEvent(event.id)">
                    <template #trigger>
                      <n-button quaternary circle size="small" title="删除事件" :loading="deletingEvent" :disabled="deletingEvent">
                        <template #icon><n-icon><trash-outline /></n-icon></template>
                      </n-button>
                    </template>
                    删除这个事件？剧情线、里程碑和章节计划需先解除关联；已写章节需重新审核。
                  </n-popconfirm>
                </div>
              </div>
              <p>{{ event.description }}</p>
              <div class="timeline-meta">
                <span v-if="entityIssueIds.has(event.id)" class="entity-source-alert">资料待核对</span>
                <span v-if="event.storyTime">{{ event.storyTime }}</span>
                <span v-if="event.location">{{ event.location }}</span>
                <span v-if="event.targetChapter !== undefined">预计第 {{ event.targetChapter + 1 }} 章推进</span>
                <span>重要度 {{ event.importance || 3 }}/5</span>
                <span>{{ eventStatusLabel(event.status) }}</span>
                <span v-if="event.resolvedChapterIndex !== undefined">第 {{ event.resolvedChapterIndex + 1 }} 章兑现</span>
                <span v-if="event.relatedArcIds?.length">关联：{{ event.relatedArcIds.map(id => novel?.storyArcs?.find(arc => arc.id === id)?.title).filter(Boolean).join('、') }}</span>
              </div>
              <blockquote v-if="event.evidence" class="timeline-evidence">原文：{{ event.evidence }}</blockquote>
              <div v-if="event.characters?.length" class="character-tags">
                <n-tag v-for="name in event.characters" :key="name" size="small" round>{{ name }}</n-tag>
              </div>
            </div>
          </article>
        </div><aside v-if="selectedEvent" class="timeline-selection paper-panel"><h3>事件记录</h3><p v-if="entityIssueIds.has(selectedEvent.id)" class="entity-source-alert" role="alert">资料含待核对字段；原值保留供核对，AI 仅使用有效字段。</p><h4>{{ selectedEvent.title }}</h4><n-tag :type="eventStatusColor(selectedEvent.status)">{{ eventStatusLabel(selectedEvent.status) }}</n-tag><section><h4>提出章节</h4><p>{{ eventChapterLabel(selectedEvent.chapterIndex) }}</p><n-button v-if="selectedEventChapter" text @click="router.push(`/workspace/${novelId}/editor/${selectedEventChapter.id}`)">查看章节 →</n-button></section><section><h4>事件说明</h4><p>{{ selectedEvent.description || '暂无说明' }}</p></section><section v-if="selectedEvent.relatedArcIds?.length"><h4>关联弧线</h4><p>{{ selectedEvent.relatedArcIds.map(id => sortedArcs.find(arc => arc.id === id)?.title).filter(Boolean).join('、') || '暂无对应弧线' }}</p></section><section v-if="selectedEvent.evidence"><h4>原文依据</h4><blockquote>{{ selectedEvent.evidence }}</blockquote></section><section v-if="selectedEvent.storyTime || selectedEvent.location"><h4>时间与地点</h4><p>{{ [selectedEvent.storyTime, selectedEvent.location].filter(Boolean).join(' · ') }}</p></section><EntitySourceHistory v-if="novel" :novel="novel" kind="event" :entity="selectedEvent" @open-chapter="openSourceChapter" /><n-button @click="openEventModal(selectedEvent)">编辑事件</n-button></aside></div>
        <n-empty v-else description="没有符合条件的事件" class="empty-block" />
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="memory" tab="项目记忆">
        <StoryMemoryPanel v-if="novel" :novel="novel" :ready="workspaceReady" />
        <div class="index-status">
          <span v-if="memoryIndexInfo.recordCount">
            {{ memoryIndexInfo.provider === 'remote' ? '真实向量' : '本地索引' }} ·
            {{ memoryIndexInfo.model }} · {{ memoryIndexInfo.recordCount }} 条 · {{ memoryIndexInfo.dimensions }} 维
          </span>
          <span v-else>尚未建立持久化记忆索引</span>
          <n-button text type="primary" :loading="memoryIndexing" :disabled="memorySearching" @click="rebuildMemoryIndex">同步索引</n-button>
        </div>
        <p class="memory-freshness-note">新增或修改的内容可以直接检索；同步索引会更新向量。</p>
        <div class="memory-categories" role="group" aria-label="记忆分类">
          <button v-for="category in memorySourceOptions" :key="category.value" type="button" :aria-pressed="memorySource === category.value" @click="memorySource = category.value">
            {{ category.label }}<span>{{ memoryCategoryCounts[category.value] || 0 }}</span>
          </button>
        </div>
        <div class="memory-search">
          <n-input v-model:value="memoryQuery" clearable placeholder="输入人物、事件、设定或剧情问题" @keydown.enter="runMemorySearch">
            <template #prefix><n-icon><search-outline /></n-icon></template>
          </n-input>
          <n-button type="primary" :loading="memorySearching" :disabled="!memoryQuery.trim()" @click="runMemorySearch">检索</n-button>
        </div>

        <div v-if="displayedMemory.length" class="memory-workbench">
        <div class="memory-results">
          <button v-for="item in displayedMemory" :key="item.id" type="button" class="memory-result" :aria-pressed="selectedMemory?.id === item.id" @click="selectedMemoryId = item.id">
            <div class="memory-result-header">
              <n-tag size="small">{{ sourceLabel(item.sourceType) }}</n-tag>
              <strong>{{ item.title }}</strong>
              <span v-if="searched && 'score' in item">{{ Math.round(Number(item.score) * 100) }}% 相关</span>
            </div>
            <p v-if="searched" class="memory-excerpt">{{ item.content.slice(0, 160) }}{{ item.content.length > 160 ? '…' : '' }}</p>
            <small v-if="cognitionLabel(item)" class="memory-state">{{ cognitionLabel(item) }}</small>
            <small>{{ item.citation }}</small>
            <small v-if="item.path?.length" class="memory-path">路径：{{ item.path.map(hop => formatSemanticGraphHop(hop)).join('；') }}</small>
          </button>
          <n-button v-if="!searched && browsableMemory.length > memoryBrowseLimit" @click="memoryBrowseLimit += 100">加载更多记忆</n-button>
        </div>
        <article v-if="selectedMemory" class="memory-detail paper-panel">
          <n-tag size="small">{{ sourceLabel(selectedMemory.sourceType) }}</n-tag>
          <h3>{{ selectedMemory.title }}</h3>
          <p>{{ selectedMemory.content }}</p>
          <small>{{ selectedMemory.citation }}</small>
          <p v-if="cognitionLabel(selectedMemory)" class="memory-state">{{ cognitionLabel(selectedMemory) }}</p>
          <p v-else-if="selectedMemory.metadata?.stateKind === 'relationship'" class="memory-state">方向关系｜{{ selectedMemory.metadata.dimensionLabel || '未分类历史' }}：{{ selectedMemory.metadata.relation }}</p>
          <p v-if="selectedMemory.metadata?.stateKind === 'proposition'" class="memory-state">原命题身份：{{ selectedMemory.metadata.factId }}；当前等价身份：{{ selectedMemory.metadata.projectedFactId }}。身份相同不代表人物认知一致。</p>
          <p v-if="selectedMemory.metadata?.stateKind === 'proposition_decision'" class="memory-state">决定状态：{{ selectedMemory.metadata.decisionActive ? '当前章节边界有效' : '已停用，恢复原身份投影' }}；依据见来源记录。</p>
          <div v-if="selectedMemory.path?.length" class="memory-path-detail">
            <strong>多跳路径 · 相关度与距离不代表因果置信度</strong>
            <section v-for="(hop, index) in selectedMemory.path" :key="`${hop.from}-${hop.to}-${index}`">
              <p>{{ formatSemanticGraphHop(hop) }}</p>
              <n-button v-if="hop.fromLocation" text @click="openGraphLocation(hop.fromLocation)">查看起点</n-button>
              <n-button v-if="hop.toLocation" text @click="openGraphLocation(hop.toLocation)">查看终点</n-button>
              <n-button v-if="hop.sourceLocation" text @click="openGraphLocation(hop.sourceLocation)">查看依据记录</n-button>
              <blockquote v-if="hop.quote">{{ hop.quote }}</blockquote>
            </section>
          </div>
          <n-button v-if="memorySourceChapter(selectedMemory)" text type="primary" @click="openMemorySource(selectedMemory)">查看来源章节 →</n-button>
          <n-button v-if="memoryEntityTarget(selectedMemory)" text type="primary" @click="openMemoryEntity(selectedMemory)">打开来源实体 →</n-button>
        </article>
        </div>
        <n-empty v-else-if="searched" description="没有找到足够相关的项目记忆" class="empty-block" />
        <div v-else class="memory-placeholder">
          <n-icon :size="36"><search-outline /></n-icon>
          <strong>搜索整本小说的结构化记忆</strong>
          <span>范围包括章节摘要、角色、事件、故事弧线、数据面板和已绑定知识库。</span>
        </div>
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="proposals" :tab="pendingProposalCount ? `状态提案 (${pendingProposalCount})` : '状态提案'">
        <div v-if="pendingStateProposals.length" class="proposal-list">
          <article v-for="proposal in pendingStateProposals" :key="proposal.id" class="proposal-card">
            <div class="proposal-header">
              <div>
                <n-tag size="small">{{ proposalTargetLabel(proposal.targetType) }}</n-tag>
                <strong>{{ proposal.targetTitle }}</strong>
              </div>
              <span>来自第 {{ proposal.chapterIndex + 1 }} 章</span>
            </div>
            <p>{{ proposal.reason }}</p>
            <div class="proposal-comparison" :aria-label="proposalValueLabel(proposal)"><section class="proposal-evidence"><h4>证据片段</h4><blockquote>{{ proposal.evidence || '本次提案未附正文片段，请先查看来源章节核对。' }}</blockquote></section><section><h4>当前值 · {{ proposalFieldLabel(proposal.field) }}</h4><code>{{ proposalDisplayValue(proposal, false) }}</code></section><span class="proposal-arrow" aria-hidden="true">→</span><section><h4>建议更新为</h4><code>{{ proposalDisplayValue(proposal, true) }}</code></section></div>
            <div class="proposal-actions">
              <n-button size="small" type="primary" :loading="applyingProposalId === proposal.id" :disabled="Boolean(applyingProposalId)" @click="acceptProposal(proposal.id)">应用</n-button>
              <n-button size="small" :disabled="Boolean(applyingProposalId)" @click="rejectProposal(proposal.id)">忽略</n-button>
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

    <n-modal v-model:show="showPlanModal" preset="card" :title="editingPlanSuggestion ? '编辑计划建议' : editingPlanId ? '编辑章节计划' : '新建章节计划'" :closable="!planSaving" :mask-closable="!planSaving" :close-on-esc="!planSaving" class="form-modal" :class="{ v3: props.embedded }" style="width: min(680px, calc(100vw - 32px))">
      <EditorRecoveryPicker :drafts="plannerDrafts('chapter-plan')" :busy="planSaving" :conflict="plannerDraftConflict" @restore="restorePlannerDraft" @discard="discardPlannerDraft" />
      <p v-if="planSaveError" role="alert" class="save-error">{{ planSaveError }}</p>
      <n-form label-placement="top" :disabled="planSaving">
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
      <template #footer><div class="modal-actions"><n-button :disabled="planSaving" @click="showPlanModal = false; closePlannerDraft('chapter-plan')">取消</n-button><n-button type="primary" :loading="planSaving" :disabled="planSaving || !planForm.title.trim() || !planForm.objective.trim()" @click="submitPlan">{{ editingPlanSuggestion ? '保存建议' : '确认并保存' }}</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showPlanVersionModal" preset="card" title="章节计划版本对比" class="form-modal" :class="{ v3: props.embedded }" style="width: min(680px, calc(100vw - 32px))">
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

    <n-modal v-model:show="showArcModal" preset="card" :title="editingArcId ? '编辑故事弧线' : editingSuggestion ? '确认 AI 弧线建议' : '新建故事弧线'" :closable="!arcSaving" :mask-closable="!arcSaving" :close-on-esc="!arcSaving" class="form-modal" :class="{ v3: props.embedded }" style="width: min(680px, calc(100vw - 32px))">
      <EditorRecoveryPicker :drafts="plannerDrafts('story-arc')" :busy="arcSaving" :conflict="plannerDraftConflict" @restore="restorePlannerDraft" @discard="discardPlannerDraft" />
      <p>剧情设计是作者确认的预期走向；里程碑完成需要另行核对正文。</p>
      <p v-if="arcSaveError" role="alert" class="save-error">{{ arcSaveError }}</p>
      <p v-if="editingArcImpact">此变更关联 {{ editingArcImpact.arcIds.length }} 条剧情线，图关联范围覆盖 {{ editingArcImpact.chapterIds.length }} 章；保存后按审核输入变化确定实际重审章节。</p>
      <n-form label-placement="top" :disabled="arcSaving">
        <div class="form-grid">
          <n-form-item label="弧线名称" class="span-2"><n-input v-model:value="arcForm.title" placeholder="例如：复仇之路" /></n-form-item>
          <n-form-item label="类型"><n-select v-model:value="arcForm.type" :options="arcTypeOptions" /></n-form-item>
          <n-form-item label="状态"><n-select v-model:value="arcForm.status" :options="arcStatusOptions" /></n-form-item>
          <n-form-item label="重要度"><n-input-number v-model:value="arcForm.importance" :min="1" :max="5" /></n-form-item>
          <n-form-item label="相关角色"><n-select v-model:value="arcForm.characterIds" multiple clearable :options="characterOptions" /></n-form-item>
          <n-form-item v-if="arcForm.status === 'paused'" label="恢复条件" class="span-2"><n-input v-model:value="arcForm.reactivateAt" placeholder="例如：主角进入第二卷后恢复推进" /></n-form-item>
          <n-form-item label="整体描述" class="span-2"><n-input v-model:value="arcForm.description" type="textarea" :rows="4" placeholder="弧线目标、核心冲突和预期变化" /></n-form-item>
          <n-form-item v-for="field in arcDesignFields.filter(field => !field.characterOnly || arcForm.type === 'character')" :key="field.key" :label="field.label"><n-input v-model:value="arcForm[field.key]" type="textarea" :rows="2" /></n-form-item>
          <n-form-item label="前置剧情线" class="span-2"><n-select v-model:value="arcForm.dependencyArcIds" multiple clearable :options="dependencyArcOptions" /></n-form-item>
          <n-form-item v-if="arcForm.type === 'character'" label="成长转折事件" class="span-2"><n-select v-model:value="arcForm.turningPointEventIds" multiple clearable :options="arcEventOptions" /></n-form-item>
          <section v-if="editingSuggestion" class="span-2" aria-label="建议里程碑"><h4>计划里程碑</h4>
            <div v-for="(node, index) in arcSuggestedNodes" :key="index" class="suggested-node">
              <n-form-item label="节点名称"><n-input v-model:value="node.title" /></n-form-item>
              <n-form-item label="预计章节"><n-input-number v-model:value="node.targetChapter" :min="1" /></n-form-item>
              <n-form-item label="节点说明"><n-input v-model:value="node.description" type="textarea" /></n-form-item>
              <n-button @click="arcSuggestedNodes.splice(index, 1)">移除此建议节点</n-button>
            </div>
          </section>
        </div>
      </n-form>
      <template #footer><div class="modal-actions"><n-button :disabled="arcSaving" @click="showArcModal = false; closePlannerDraft('story-arc')">取消</n-button><n-button type="primary" :loading="arcSaving" :disabled="arcSaving || !arcForm.title.trim()" @click="submitArc">确认并保存</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showNodeModal" preset="card" :title="editingNodeId ? '编辑里程碑' : '添加里程碑'" :closable="!arcSaving" :mask-closable="!arcSaving" :close-on-esc="!arcSaving" class="form-modal small-modal" :class="{ v3: props.embedded }" style="width: min(480px, calc(100vw - 32px))">
      <p v-if="arcSaveError" role="alert" class="save-error">{{ arcSaveError }}</p>
      <n-form label-placement="top" :disabled="arcSaving">
        <n-form-item label="节点名称"><n-input v-model:value="nodeForm.title" placeholder="例如：首次发现仇人线索" /></n-form-item>
        <n-form-item label="预计章节"><n-input-number v-model:value="nodeForm.targetChapter" :min="1" /></n-form-item>
        <n-form-item label="节点说明"><n-input v-model:value="nodeForm.description" type="textarea" :rows="3" /></n-form-item>
        <n-form-item label="前置里程碑"><n-select v-model:value="nodeForm.prerequisiteNodeIds" multiple clearable :options="prerequisiteNodeOptions" /></n-form-item>
        <n-form-item label="后续事件"><n-select v-model:value="nodeForm.consequenceEventIds" multiple clearable :options="arcEventOptions" /></n-form-item>
      </n-form>
      <template #footer><div class="modal-actions"><n-button :disabled="arcSaving" @click="showNodeModal = false">取消</n-button><n-button type="primary" :loading="arcSaving" :disabled="arcSaving || !nodeForm.title.trim()" @click="submitNode">确认并保存</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showNodeStatusModal" preset="card" title="核对里程碑进展" :closable="!arcSaving" :mask-closable="!arcSaving" :close-on-esc="!arcSaving" class="form-modal" :class="{ v3: props.embedded }" style="width: min(680px, calc(100vw - 32px))">
      <p v-if="arcSaveError" role="alert" class="save-error">{{ arcSaveError }}</p>
      <n-form label-placement="top" :disabled="arcSaving">
        <n-form-item label="进展状态"><n-select v-model:value="nodeStatus" :options="[{ label: '已完成（需正文证据）', value: 'completed' }, { label: '恢复待完成', value: 'pending' }, { label: '已放弃', value: 'abandoned' }]" /></n-form-item>
        <template v-if="nodeStatus === 'completed'">
          <n-form-item label="实际发生章节"><n-select :value="sourceChapterId" :options="sourceChapterOptions" placeholder="选择已写正文的章节" @update:value="selectSourceChapter" /></n-form-item>
          <details v-if="sourceChapterSnapshot"><summary>查看所选章节原文</summary><pre class="arc-source-text">{{ sourceChapterSnapshot.content }}</pre></details>
          <n-form-item label="原文证据"><n-input v-model:value="nodeEvidence" type="textarea" :rows="4" placeholder="粘贴能够证明节点完成的连续原句；重复句请补足上下文" /></n-form-item>
        </template>
      </n-form>
      <template #footer><div class="modal-actions"><n-button :disabled="arcSaving" @click="showNodeStatusModal = false">取消</n-button><n-button type="primary" :loading="arcSaving" :disabled="arcSaving || (nodeStatus === 'completed' && (!sourceChapterId || !nodeEvidence.trim()))" @click="submitNodeStatus">确认进展</n-button></div></template>
    </n-modal>

    <n-modal v-model:show="showEventModal" preset="card" :title="editingEventId ? '编辑时间线事件' : '添加时间线事件'" :closable="!eventSaving" :mask-closable="!eventSaving" :close-on-esc="!eventSaving" class="form-modal" :class="{ v3: props.embedded }" style="width: min(680px, calc(100vw - 32px))">
      <EditorRecoveryPicker :drafts="plannerDrafts('event')" :busy="eventSaving" :conflict="plannerDraftConflict" @restore="restorePlannerDraft" @discard="discardPlannerDraft" />
      <div v-if="eventFormChanged" class="recovery-pending" role="status">未提交事件已保存为恢复草稿</div>
      <p class="entity-source-note">保存后，表单中的字段会作为作者全局设定。已写章节需重新审核；章节原文仍可在历史记录中核对。</p>
      <p v-if="eventSaveError" class="save-error" role="alert">{{ eventSaveError }}</p>
      <n-form label-placement="top" :disabled="eventSaving">
        <div class="form-grid">
          <n-form-item label="事件标题" class="span-2"><n-input v-model:value="eventForm.title" /></n-form-item>
          <n-form-item label="事件类型"><n-select v-model:value="eventForm.type" :options="eventTypeOptions" /></n-form-item>
          <n-form-item label="状态"><n-select v-model:value="eventForm.status" :options="eventStatusOptions" /></n-form-item>
          <n-form-item label="追踪范围"><n-select v-model:value="eventForm.scope" :options="[{ label: '全书', value: 'global' }, { label: '分卷', value: 'volume' }, { label: '章节', value: 'chapter' }]" /></n-form-item>
          <n-form-item label="发生章节（0 表示尚未发生）"><n-input-number v-model:value="eventForm.chapter" :min="0" /></n-form-item>
          <n-form-item label="预计推进章节"><n-input-number v-model:value="eventForm.targetChapter" clearable :min="1" /></n-form-item>
          <n-form-item label="已铺垫次数"><n-input-number v-model:value="eventForm.hintCount" :min="0" /></n-form-item>
          <n-form-item label="最近推进章节"><n-input-number v-model:value="eventForm.lastProgressChapter" clearable :min="1" /></n-form-item>
          <n-form-item label="实际回收章节"><n-input-number v-model:value="eventForm.resolvedChapter" clearable :min="1" :disabled="eventForm.status !== 'resolved'" /></n-form-item>
          <n-form-item label="故事内时间"><n-input v-model:value="eventForm.storyTime" placeholder="例如：玄历三年春" /></n-form-item>
          <n-form-item label="地点"><n-input v-model:value="eventForm.location" /></n-form-item>
          <n-form-item label="重要度"><n-input-number v-model:value="eventForm.importance" :min="1" :max="5" /></n-form-item>
          <n-form-item label="相关角色"><n-input v-model:value="eventForm.characters" placeholder="多个角色用逗号分隔" /></n-form-item>
          <n-form-item label="关联弧线"><n-select v-model:value="eventForm.relatedArcIds" multiple clearable :options="arcLinkOptions" placeholder="可选" /></n-form-item>
          <n-form-item label="正文证据" class="span-2"><n-input v-model:value="eventForm.evidence" type="textarea" :rows="2" placeholder="可记录原文，便于后续核对" /></n-form-item>
          <n-form-item label="事件描述" class="span-2"><n-input v-model:value="eventForm.description" type="textarea" :rows="4" /></n-form-item>
        </div>
      </n-form>
      <template #footer><div class="modal-actions"><n-button :disabled="eventSaving" @click="showEventModal = false; closePlannerDraft('event')">取消</n-button><n-button type="primary" :loading="eventSaving" :disabled="eventSaving || !eventForm.title.trim() || !eventForm.description.trim()" @click="submitEvent">保存</n-button></div></template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ARC_CANON_FIELDS } from '@/types/entityProvenance'
import { buildAnalysisSourceVersionId } from '@/services/reconstructionCandidates'
import { analyzeStoryArcImpact, arcPlanningSourceVersion, type ArcDefinition, type ArcEditImpact, type StoryArcEdit } from '@/services/storyArcEditing'
import type { StoryArcDraft, ChapterPlanDraft } from '@/services/storyPlanning'
import { applyChapterPlanEdit, chapterPlanningSourceVersion, type ChapterPlanEdit } from '@/services/storyPlanTransactions'
import { getChapterSummaryStatus } from '@/services/derivedSources'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorRecoveryPicker from '@/components/EditorRecoveryPicker.vue'
import { useEditorRecovery, type EditorDraftSession } from '@/composables/useEditorRecovery'
import type { EditorDraft } from '@/types/editorRecovery'
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
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useConfigStore } from '@/stores/config'
import VolumeOutline from '@/views/workspace/VolumeOutline.vue'
import ScenePlanner from '@/components/ScenePlanner.vue'
import StoryMemoryPanel from '@/views/workspace/StoryMemoryPanel.vue'
import EntitySourceHistory from '@/components/EntitySourceHistory.vue'
import EventCausalityPanel from '@/components/EventCausalityPanel.vue'
import StoryImpactHistory from '@/components/StoryImpactHistory.vue'
import { projectCanonicalEntities } from '@/services/entityProvenance'
import { generateChapterPlanDrafts, generateStoryArcDrafts } from '@/services/storyPlanning'
import { useStoryStateScansStore } from '@/stores/storyStateScans'
import { comparePlanningVersions, createLocalChapterPlanRefresh, type PlanningDiff } from '@/services/planningVersions'
import {
  buildSemanticRecords, cognitionLabel, getSemanticIndexInfo, queryPersistedSemanticEvidence,
  syncSemanticIndexForNovel, type SemanticEvidence, type SemanticIndexInfo, type SemanticRecord, type SemanticSourceType,
} from '@/services/semanticIndex'
import { formatSemanticGraphHop, type SemanticGraphLocation } from '@/services/semanticMemoryGraph'
import type {
  ChapterPlan, ChapterPlanHorizon, ChapterPlanStatus, EventLogEntry, StoryArc, StoryArcNode,
  StoryArcStatus, StoryArcType, StoryStateProposal, StoryStateProposalField, StoryStateTargetType,
} from '@/types/novel'

const props = withDefaults(defineProps<{ embedded?: boolean; initialTab?: string; initialSelection?: string }>(), {
  embedded: false,
  initialTab: 'plans',
  initialSelection: '',
})
const emit = defineEmits<{ tabChange: [tab: string]; navigate: [target: { tab: string; selection: string }] }>()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const novelStore = useNovelStore()
const reconstructionWorkspaceStore = useReconstructionWorkspaceStore()
const knowledgeStore = useKnowledgeStore()
const configStore = useConfigStore()
const recovery = useEditorRecovery()
const recoverySessions = new Map<string, EditorDraftSession>()
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))

const workspaceReady = ref(false)
const planningTabs = new Set(['volumes', 'plans', 'scenes', 'relay', 'arcs', 'timeline', 'memory', 'proposals', 'impacts'])
const requestedTab = props.embedded ? props.initialTab : String(route.query.tab || '')
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
const stateScans = useStoryStateScansStore()
const pendingStateScans = computed(() => stateScans.getPending(novelId.value))
let stateScanController: AbortController | undefined
watch(novelId, () => stateScanController?.abort(new Error('已离开原作品，状态扫描未提交。')))
const memoryQuery = ref('')
const memorySource = ref<'all' | SemanticSourceType>('all')
const searched = ref(false)
const extractingArcs = ref(false)
const memorySearching = ref(false)
const memoryIndexing = ref(false)
const memoryResults = ref<SemanticEvidence[]>([])
const selectedMemoryId = ref('')
const selectedMemory = computed<SemanticEvidence | undefined>(() => displayedMemory.value.find(item => item.id === selectedMemoryId.value)
  || allBrowsableMemory.value.find(item => item.id === selectedMemoryId.value) || displayedMemory.value[0])
const memoryIndexInfo = ref<SemanticIndexInfo>({ recordCount: 0, provider: 'local', model: 'local-hash-v1', dimensions: 0, updatedAt: '' })
let chapterCreationPrompted = false
let chapterCreationDialog: ReturnType<typeof dialog.info> | null = null

const planLanes: Array<{ horizon: ChapterPlanHorizon; label: string; description: string }> = [
  { horizon: 'next', label: '下一章', description: '可直接进入写作的详细计划' },
  { horizon: 'near', label: '近期', description: '未来约 2-10 章的推进路径' },
  { horizon: 'far', label: '远期', description: '后续阶段的方向与收束条件' },
]
const planHorizonOptions = planLanes.map(item => ({ label: item.label, value: item.horizon }))
const planStatusOptions = [
  { label: '待执行', value: 'planned' }, { label: '进行中', value: 'active' },
  { label: '待核对', value: 'awaiting_review' },
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
  { label: '未核对', value: 'unverified' },
]
const timelineTypeOptions = [{ label: '全部类型', value: 'all' }, ...eventTypeOptions]
const timelineStatusOptions = [{ label: '全部状态', value: 'all' }, ...eventStatusOptions]
const memorySourceOptions = [
  { label: '全部', value: 'all' }, { label: '章节', value: 'chapter' },
  { label: '角色', value: 'character' }, { label: '事件', value: 'event' },
  { label: '故事弧线', value: 'story_arc' }, { label: '章节计划', value: 'chapter_plan' }, { label: '知识库', value: 'knowledge' },
  { label: '数据面板', value: 'data_panel' }, { label: '已写故事回顾', value: 'story_memory' },
] satisfies Array<{ label: string; value: 'all' | SemanticSourceType }>

const characterOptions = computed(() => (novel.value?.characters || []).map(character => ({ label: character.name, value: character.id })))
const sortedArcs = computed(() => [...(novel.value ? projectCanonicalEntities(novel.value).arcs : [])].sort((a, b) => b.importance - a.importance || a.createdAt.localeCompare(b.createdAt)))
const arcLinkOptions = computed(() => sortedArcs.value.map(arc => ({ label: arc.title, value: arc.id })))
const selectedArcId = ref('')
const selectedArc = computed(() => sortedArcs.value.find(arc => arc.id === selectedArcId.value)
  || (selectedArcId.value && novel.value?.storyArcs?.some(arc => arc.id === selectedArcId.value) ? undefined : sortedArcs.value[0]))
const unavailableSelectedArc = computed(() => selectedArcId.value && !sortedArcs.value.some(arc => arc.id === selectedArcId.value)
  ? novel.value?.storyArcs?.find(arc => arc.id === selectedArcId.value) : undefined)
const relayArcs = computed(() => sortedArcs.value.filter(arc => arc.status === 'active' || arc.status === 'paused'))
const openPromises = computed(() => (novel.value?.eventLog || [])
  .filter(event => event.type === '伏笔' && event.status !== 'resolved' && event.status !== 'abandoned')
  .sort((a, b) => (b.lastProgressChapterIndex ?? b.chapterIndex) - (a.lastProgressChapterIndex ?? a.chapterIndex)))
const activeArcCount = computed(() => sortedArcs.value.filter(arc => arc.status === 'active').length)
const pendingNodeCount = computed(() => sortedArcs.value.reduce((sum, arc) => sum + arc.nodes.filter(node => node.status === 'pending' || node.status === 'unverified').length, 0))
const unresolvedEventCount = computed(() => (novel.value?.eventLog || []).filter(event => event.status !== 'resolved' && event.status !== 'abandoned').length)
const sortedPlans = computed(() => [...(novel.value?.chapterPlans || [])].sort((a, b) => a.targetChapterStart - b.targetChapterStart || a.createdAt.localeCompare(b.createdAt)))
const awaitingPlans = computed(() => sortedPlans.value.filter(plan => plan.status === 'awaiting_review'))
const selectedRelayId = ref('')
const selectedRelayPlan = computed(() => awaitingPlans.value.find(plan => plan.id === selectedRelayId.value) || awaitingPlans.value[0])
const relayChapter = computed(() => selectedRelayPlan.value ? novel.value?.chapters.find(chapter => chapter.chapterIndex === selectedRelayPlan.value!.targetChapterEnd) : undefined)
const planStatusLanes = [{ status: 'planned', label: '待推进', description: '尚未开始的章节计划' }, { status: 'active', label: '进行中', description: '正在推进的故事内容' }, { status: 'awaiting_review', label: '待核对', description: '对照已写正文核对计划' }]
function plansByStatus(status: string) { return sortedPlans.value.filter(plan => plan.status === status) }
const closedPlans = computed(() => sortedPlans.value.filter(plan => plan.status === 'completed' || plan.status === 'archived'))
const selectedPlanId = ref('')
const selectedPlan = computed(() => sortedPlans.value.find(plan => plan.id === selectedPlanId.value) || sortedPlans.value.find(plan => !['completed', 'archived'].includes(plan.status)) || sortedPlans.value[0])
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
const memoryRecords = computed(() => novel.value ? buildSemanticRecords(novel.value, knowledgeStore.knowledgeBases, undefined, reconstructionWorkspaceStore.getStoryMemories(novelId.value), reconstructionWorkspaceStore.getCanonMutations(novelId.value)) : [])
const memoryCategoryCounts = computed(() => {
  const counts: Record<string, number> = { all: memoryRecords.value.length }
  for (const record of memoryRecords.value) counts[record.sourceType] = (counts[record.sourceType] || 0) + 1
  return counts
})
const memoryBrowseLimit = ref(100)
const allBrowsableMemory = computed<SemanticEvidence[]>(() => memoryRecords.value.map(item => ({ ...item, score: 0, citation: `${sourceLabel(item.sourceType)} · ${item.title}` })))
const browsableMemory = computed(() => allBrowsableMemory.value.filter(item => memorySource.value === 'all' || item.sourceType === memorySource.value))
const displayedMemory = computed(() => searched.value ? memoryResults.value : browsableMemory.value.slice(0, memoryBrowseLimit.value))
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
const selectedEventId = ref('')
const selectedEvent = computed(() => filteredEvents.value.find(event => event.id === selectedEventId.value) || filteredEvents.value[0])
const entityIssueIds = computed(() => new Set(novel.value ? projectCanonicalEntities(novel.value).issues.filter(issue => issue.entityType === 'event').map(issue => issue.entityId) : []))
const selectedEventChapter = computed(() => selectedEvent.value ? novel.value?.chapters.find(chapter => chapter.chapterIndex === selectedEvent.value!.chapterIndex) : undefined)
function openSourceChapter(chapterId: string) {
  router.push('/workspace/' + novelId.value + '/editor/' + chapterId)
}
function openPlanningTab(tab: string, selection = '') {
  if (props.embedded) {
    emit('navigate', { tab, selection })
    return
  }
  const queryKey = tab === 'timeline' ? 'event' : tab === 'arcs' ? 'arc' : 'plan'
  const query = selection ? { tab, [queryKey]: selection } : { tab }
  void router.push({ path: `/workspace/${novelId.value}/planning`, query })
}
function memorySourceChapter(item: Pick<SemanticRecord, 'sourceType' | 'sourceId' | 'metadata'>): string | undefined {
  const metadata = item.metadata || {}
  if (typeof metadata.sourceChapterId === 'string') return metadata.sourceChapterId
  if (item.sourceType === 'chapter') return item.sourceId
  const chapterIds = metadata.chapterIds
  if (Array.isArray(chapterIds) && typeof chapterIds[0] === 'string') return chapterIds[0]
  const chapterIndex = typeof metadata.chapterIndex === 'number' ? metadata.chapterIndex
    : typeof metadata.actualChapter === 'number' ? metadata.actualChapter
      : typeof metadata.targetChapterStart === 'number' ? metadata.targetChapterStart : undefined
  return chapterIndex === undefined ? undefined : novel.value?.chapters.find(chapter => chapter.chapterIndex === chapterIndex)?.id
}
function memoryEntityTarget(item: Pick<SemanticRecord, 'sourceType' | 'sourceId' | 'metadata'>): boolean {
  return !item.metadata?.stateKind && ['event', 'story_arc', 'chapter_plan', 'character'].includes(item.sourceType)
}
function openGraphLocation(location: SemanticGraphLocation) {
  const record = allBrowsableMemory.value.find(item => item.id === location.recordId)
  if (record) { selectedMemoryId.value = record.id; return }
  if (location.chapterId && novel.value?.chapters.some(chapter => chapter.id === location.chapterId)) return openSourceChapter(location.chapterId)
  if (location.sourceType === 'story_arc') return openPlanningTab('arcs', location.sourceId)
  message.info('该路径来源已变化，请重新检索。')
}
function openMemorySource(item: Pick<SemanticRecord, 'sourceType' | 'sourceId' | 'metadata'>) {
  const chapterId = memorySourceChapter(item)
  if (chapterId) {
    const m = item.metadata || {}
    if (typeof m.sourceVersionId === 'string' && typeof m.startOffset === 'number' && typeof m.endOffset === 'number') {
      return router.push({ path: `/workspace/${novelId.value}/editor/${chapterId}`, query: {
        evidenceVersion: m.sourceVersionId, evidenceStart: String(m.startOffset), evidenceEnd: String(m.endOffset),
      } })
    }
    return openSourceChapter(chapterId)
  }
  return openMemoryEntity(item)
}
function openMemoryEntity(item: Pick<SemanticRecord, 'sourceType' | 'sourceId' | 'metadata'>) {
  if (item.sourceType === 'event') return openPlanningTab('timeline', item.sourceId)
  if (item.sourceType === 'story_arc') return openPlanningTab('arcs', item.sourceId)
  if (item.sourceType === 'chapter_plan') return openPlanningTab('plans', item.sourceId)
  if (item.sourceType === 'character') return router.push({ path: `/workspace/${novelId.value}/characters`, query: { character: String(item.metadata?.characterId || item.sourceId) } })
}
function eventStatusColor(status: EventLogEntry['status']) { return status === 'resolved' ? 'success' : status === 'developing' ? 'info' : status === 'abandoned' ? 'default' : 'warning' }

function readMemorySource() {
  if (!novel.value) throw new Error('当前作品已关闭')
  return { novel: novel.value, knowledgeBases: knowledgeStore.knowledgeBases, storyMemories: reconstructionWorkspaceStore.getStoryMemories(novelId.value), canonMutations: reconstructionWorkspaceStore.getCanonMutations(novelId.value) }
}

async function refreshMemoryIndexInfo() {
  memoryIndexInfo.value = await getSemanticIndexInfo(novelId.value)
}

async function rebuildMemoryIndex() {
  if (!novel.value || memoryIndexing.value) return
  memoryIndexing.value = true
  try {
    const result = await syncSemanticIndexForNovel(readMemorySource, configStore.embedding, false)
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
  if (!query || memorySearching.value || memoryIndexing.value || !novel.value) return
  const source = memorySource.value
  const requestId = ++memoryRequestId
  searched.value = true
  memoryResults.value = []
  memorySearching.value = true
  try {
    const results = await queryPersistedSemanticEvidence(
      readMemorySource,
      query,
      12,
      configStore.embedding,
      source === 'all' ? undefined : source,
    )
    if (requestId === memoryRequestId) memoryResults.value = results.filter(item => source === 'all' || item.sourceType === source)
  } catch (error) {
    if (requestId !== memoryRequestId) return
    memoryResults.value = []
    searched.value = false
    message.error(error instanceof Error ? error.message : '项目记忆检索失败')
  } finally {
    memorySearching.value = false
  }
}

let memoryRequestId = 0
watch([memoryQuery, memorySource, novelId, memoryRecords], () => {
  memoryRequestId++
  searched.value = false
  memoryResults.value = []
  selectedMemoryId.value = ''
  memoryBrowseLimit.value = 100
})

watch(() => route.query, query => {
  if (props.embedded) return
  const tab = String(query?.tab || '')
  if (planningTabs.has(tab)) activeTab.value = tab
  if (typeof query?.event === 'string') { selectedEventId.value = query.event; timelineQuery.value = ''; timelineType.value = 'all'; timelineStatus.value = 'all' }
  if (typeof query?.arc === 'string') selectedArcId.value = query.arc
  if (typeof query?.plan === 'string') selectedPlanId.value = query.plan
}, { immediate: true })

function handleTabChange(tab: string) { if (props.embedded) emit('tabChange', tab) }
watch([() => props.initialTab, () => props.initialSelection], ([tab, selection]) => {
  if (!props.embedded || !planningTabs.has(tab)) return
  activeTab.value = tab
  if (tab === 'plans' && selection) selectedPlanId.value = selection
  if (tab === 'arcs' && selection) selectedArcId.value = selection
  if (tab === 'timeline' && selection) selectedEventId.value = selection
}, { immediate: true })

onMounted(async () => {
  try {
    await reconstructionWorkspaceStore.hydrateFromPersistence(novelId.value)
    workspaceReady.value = true
  } catch (error) {
    message.warning(error instanceof Error ? '创作工作区读取失败：' + error.message : '创作工作区读取失败')
  }
  void refreshMemoryIndexInfo()
})

onBeforeUnmount(() => {
  plannerDisposed = true
  for (const timer of recoveryTimers.values()) clearTimeout(timer)
  recoveryTimers.clear()
  for (const [key, session] of recoverySessions) {
    const surface = key.substring(key.indexOf(':') + 1)
    const metadata = surface === 'chapter-plan' ? { editingPlanId: editingPlanId.value, suggestionId: editingPlanSuggestion.value, suggestionSource: planSuggestionSource.value, sourceBaseline: planBaseline, formSource: planFormSource }
      : surface === 'story-arc' ? { editingArcId: editingArcId.value, suggestionId: editingSuggestion.value, suggestionSource: suggestionSource.value, sourceBaseline: arcEditBaseline.value, suggestedNodes: arcSuggestedNodes.value }
        : { editingEventId: editingEventId.value, sourceBaseline: eventEditBaseline.value }
    const value = surface === 'chapter-plan' ? planForm.value : surface === 'story-arc' ? arcForm.value : eventForm.value
    try { recovery.queue(session, plannerDraftPayload(surface as 'chapter-plan' | 'story-arc' | 'event', metadata, value)) } catch { /* Registered flush retains the last valid checkpoint. */ }
    void recovery.flushSession(session).catch(() => undefined)
  }
  stateScanController?.abort(new Error('页面已关闭，状态扫描未提交。'))
  memoryRequestId++
  chapterCreationDialog?.destroy()
  chapterCreationDialog = null
})

function offerChapterCreation() {
  if (chapterCreationPrompted || !planningReady.value || novel.value?.chapters.length) return
  chapterCreationPrompted = true
  const targetNovelId = novelId.value
  chapterCreationDialog = dialog.info({
    title: '剧情规划已完成',
    content: '分卷、章节计划、故事弧线和故事时间线都已创建完成，是否现在创建章节？',
    positiveText: '创建章节',
    negativeText: '稍后再说',
    onPositiveClick: () => router.push(`/workspace/${targetNovelId}/chapters`),
  })
}

function arcTypeLabel(type: StoryArcType) { return arcTypeOptions.find(item => item.value === type)?.label || type }
function arcStatusLabel(status: StoryArcStatus) { if (status === 'unverified') return '来源待核对'; return arcStatusOptions.find(item => item.value === status)?.label || status }
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
  if (!novel.value?.outline || !workspaceReady.value || generatingPlans.value || planSaving.value || showPlanModal.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { message.warning('请先配置大纲模型'); return }
  const source = cloneArcValue(novel.value), memories = cloneArcValue(reconstructionWorkspaceStore.getStoryMemories(source.id))
  const sourceVersion = chapterPlanningSourceVersion(source, memories, knowledgeStore.knowledgeBases)
  generatingPlans.value = true
  try {
    const drafts = await generateChapterPlanDrafts(source, model, memories)
    if (plannerDisposed || novel.value?.id !== source.id) return
    if (sourceVersion !== currentPlanSource()) throw new Error('规划来源已变化，本次建议未采用，请重新生成。')
    const planKey = (plan: ChapterPlanDraft) => JSON.stringify([plan.horizon, plan.title.trim().toLowerCase(), plan.targetChapterStart])
    const existing = new Set((novel.value.chapterPlans || []).map(planKey))
    planSuggestions.value = drafts.filter(draft => {
      if (existing.has(planKey(draft))) return false
      existing.add(planKey(draft)); return true
    }).map((draft, index) => ({ id: sourceVersion + ':' + index, draft }))
    planSuggestionSource.value = sourceVersion
    message.info(planSuggestions.value.length ? '章节计划建议已生成，请编辑核对后确认。' : '没有新增计划建议，重复内容已跳过。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '章节计划生成失败')
  } finally {
    generatingPlans.value = false
  }
}

async function confirmVolumesAndGeneratePlans() {
  activeTab.value = 'plans'
  if (!novel.value || planSaving.value || generatingPlans.value) return
  if ((novel.value?.chapterPlans || []).length) {
    planSaving.value = true
    try {
      await commitPlannerEdit({ action: 'confirm-planning', expectedVolumes: JSON.stringify(novel.value.volumes), expectedPlans: JSON.stringify(novel.value.chapterPlans) })
      message.success('分卷规划已确认，已有章节计划可继续编辑')
      offerChapterCreation()
    } catch (error) { message.error(error instanceof Error ? error.message : '规划确认保存失败') }
    finally { planSaving.value = false }
    return
  }
  message.info('正在生成首批章节计划建议，返回后请核对并确认。')
  await generatePlans()
}

const showPlanModal = ref(false)
const editingPlanId = ref('')
const editingPlanSuggestion = ref(''), planSaveError = ref(''), planSaving = ref(false)
const planSuggestions = ref<Array<{ id: string; draft: ChapterPlanDraft }>>([])
const planSuggestionSource = ref('')
let planBaseline = '', planVersionBaseline = '', planFormOwner = '', planVersionOwner = ''
let planFormSource: ChapterPlanDraft | undefined, plannerDisposed = false
const plannerDraftCapture: Record<'chapter-plan' | 'story-arc' | 'event', boolean> = {
  'chapter-plan': false,
  'story-arc': false,
  event: false,
}
function plannerDrafts(surface: 'chapter-plan' | 'story-arc' | 'event') {
  return reconstructionWorkspaceStore.getEditorDrafts(novelId.value).filter(row => row.kind === 'story-planner' && row.payload?.surface === surface)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
function plannerDraftBaseline(surface: string, source: string) { return JSON.stringify({ novelId: novelId.value, surface, source }) }
function plannerDraftPayload(surface: 'chapter-plan' | 'story-arc' | 'event', metadata: Record<string, unknown>, value: Record<string, unknown>) {
  return { surface, suggestionId: String(metadata.suggestionId || ''), suggestionSource: String(metadata.suggestionSource || ''), editingPlanId: String(metadata.editingPlanId || ''), editingArcId: String(metadata.editingArcId || ''), editingEventId: String(metadata.editingEventId || ''),
    sourceBaseline: String(metadata.sourceBaseline || ''), formSource: metadata.formSource || {}, chapterPlan: surface === 'chapter-plan' ? value : {}, storyArc: surface === 'story-arc' ? value : {}, event: surface === 'event' ? value : {}, suggestedNodes: metadata.suggestedNodes || [] }
}
function plannerScope(surface: string, metadata: Record<string, unknown>) {
  return surface + ':' + String(metadata.suggestionId || metadata.editingPlanId || metadata.editingArcId || metadata.editingEventId || 'new')
}
function queuePlannerDraft(surface: 'chapter-plan' | 'story-arc' | 'event', metadata: Record<string, unknown>, value: Record<string, unknown>, source: string) {
  const owner = novelId.value, key = owner + ':' + surface
  const requestedScope = plannerScope(surface, metadata), openedBaseline = plannerDraftBaseline(surface, source)
  const existingDraft = plannerDrafts(surface).find(row => row.scope === requestedScope && row.openedBaseline === openedBaseline)
  let session = recoverySessions.get(key)
  const sameSession = !!session && session.identity.scope === requestedScope && session.identity.openedBaseline === openedBaseline
  const hasPendingWrite = !!recoveryTimers.get(key) || (!!session && (!!session.running || !!session.pending || session.sequence > session.savedSequence))
  if (session && !sameSession) {
    recoveryTimers.get(key) && clearTimeout(recoveryTimers.get(key))
    recoveryTimers.delete(key)
    recoverySessions.delete(key)
    if (!hasPendingWrite) void recovery.flushSession(session).catch(() => undefined)
    session = undefined
  }
  if (hasPendingWrite && !sameSession) {
    const queued = existingDraft?.payload ? { ...existingDraft.payload } as Record<string, unknown> : {}
    const activeForm = surface === 'chapter-plan' ? planForm.value : surface === 'story-arc' ? arcForm.value : eventForm.value
    const preserved = plannerDraftPayload(surface, metadata, activeForm)
    if (surface === 'chapter-plan' && queued.chapterPlan && typeof queued.chapterPlan === 'object' && !Array.isArray(queued.chapterPlan)) preserved.chapterPlan = queued.chapterPlan as Record<string, unknown>
    if (surface === 'story-arc') {
      if (queued.storyArc && typeof queued.storyArc === 'object' && !Array.isArray(queued.storyArc)) preserved.storyArc = queued.storyArc as Record<string, unknown>
      if (Array.isArray(queued.suggestedNodes)) preserved.suggestedNodes = queued.suggestedNodes
    }
    if (surface === 'event' && queued.event && typeof queued.event === 'object' && !Array.isArray(queued.event)) preserved.event = queued.event as Record<string, unknown>
    const fork = recovery.begin({ novelId: owner, kind: 'story-planner', scope: requestedScope, targetId: String(metadata.editingPlanId || metadata.editingArcId || metadata.editingEventId || metadata.suggestionId || '') || undefined, openedBaseline })
    recoverySessions.set(key, fork)
    void recovery.queue(fork, preserved)
    return
  }
  if (!session && existingDraft) {
    try { session = recovery.restore(existingDraft) } catch { /* Keep edited data in a new revision if an old writer is still draining. */ }
  }
  if (!session) {
    session = recovery.begin({ novelId: owner, kind: 'story-planner', scope: requestedScope, targetId: String(metadata.editingPlanId || metadata.editingArcId || metadata.editingEventId || metadata.suggestionId || '') || undefined, openedBaseline })
    recoverySessions.set(key, session)
  }
  const existingTimer = recoveryTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)
  const captured = plannerDraftPayload(surface, metadata, value)
  recoveryTimers.set(key, setTimeout(() => {
    recoveryTimers.delete(key)
    if (plannerDisposed || novelId.value !== owner || recoverySessions.get(key) !== session) return
    try { recovery.queue(session!, captured) }
    catch (error) { if (surface === 'chapter-plan') planSaveError.value = error instanceof Error ? error.message : String(error); else if (surface === 'story-arc') arcSaveError.value = error instanceof Error ? error.message : String(error); else eventSaveError.value = error instanceof Error ? error.message : String(error) }
  }, 100))
}
function queueCurrentPlannerDraft(surface: 'chapter-plan' | 'story-arc' | 'event') {
  if (surface === 'chapter-plan') {
    const suggestion = editingPlanSuggestion.value
    const metadata = {
      editingPlanId: suggestion ? '' : editingPlanId.value,
      suggestionId: suggestion,
      suggestionSource: suggestion ? planSuggestionSource.value : '',
      sourceBaseline: suggestion ? '' : planBaseline,
      formSource: planFormSource,
    }
    queuePlannerDraft(surface, metadata, planForm.value, suggestion ? planSuggestionSource.value : planBaseline)
    return
  }
  if (surface === 'story-arc') {
    const suggestion = editingSuggestion.value
    const metadata = {
      editingArcId: suggestion ? '' : editingArcId.value,
      suggestionId: suggestion,
      suggestionSource: suggestion ? suggestionSource.value : '',
      sourceBaseline: suggestion ? '' : arcEditBaseline.value,
      suggestedNodes: arcSuggestedNodes.value,
    }
    queuePlannerDraft(surface, metadata, arcForm.value, suggestion ? suggestionSource.value : arcEditBaseline.value)
    return
  }
  queuePlannerDraft(surface, { editingEventId: editingEventId.value, sourceBaseline: eventEditBaseline.value }, eventForm.value, eventEditBaseline.value)
}
function currentPlannerSource(surface: string, payload: EditorDraft['payload']) {
  if (surface === 'chapter-plan') {
    const id = String(payload?.editingPlanId || '')
    return id ? JSON.stringify(novel.value?.chapterPlans?.find(plan => plan.id === id) || null) : String(payload?.suggestionSource || '')
  }
  if (surface === 'story-arc') {
    const id = String(payload?.editingArcId || '')
    return id ? JSON.stringify(novel.value?.storyArcs?.find(arc => arc.id === id) || null) : String(payload?.suggestionSource || '')
  }
  const id = String(payload?.editingEventId || '')
  return id ? JSON.stringify(novel.value?.eventLog.find(event => event.id === id) || null) : ''
}
function plannerDraftConflict(item: Pick<EditorDraft, 'openedBaseline' | 'payload'>) {
  const surface = String(item.payload?.surface), source = currentPlannerSource(surface, item.payload)
  return item.openedBaseline === plannerDraftBaseline(surface, source) ? '' : '打开后来源已变化；恢复仍保留原基线，正式保存会由事务再次核对。'
}
async function restorePlannerDraft(item: EditorDraft) {
  if (item.novelId !== novelId.value || item.kind !== 'story-planner') return
  const payload = item.payload!, surface = String(payload.surface)
  try {
    if (!['chapter-plan', 'story-arc', 'event'].includes(surface)) throw new Error('剧情规划草稿类型无效')
    plannerDraftCapture[surface as 'chapter-plan' | 'story-arc' | 'event'] = false
    const session = recoverySessions.get(item.novelId + ':' + String(payload.surface))
    if (session && session.identity.scope === item.scope && session.identity.openedBaseline === item.openedBaseline
      && (session.running || session.pending || session.sequence > session.savedSequence)) await recovery.flushSession(session)
    const restored = recovery.restore(item)
    if (payload.surface === 'chapter-plan') {
      planForm.value = JSON.parse(JSON.stringify(payload.chapterPlan)) as typeof planForm.value
      editingPlanId.value = String(payload.editingPlanId || ''); editingPlanSuggestion.value = String(payload.suggestionId || '')
      planSuggestionSource.value = String(payload.suggestionSource || ''); planBaseline = String(payload.sourceBaseline || '')
      planFormSource = JSON.parse(JSON.stringify(payload.formSource || undefined)) as ChapterPlanDraft | undefined; planFormOwner = novelId.value
      showPlanModal.value = true
      plannerDraftCapture['chapter-plan'] = true
    } else if (payload.surface === 'story-arc') {
      arcForm.value = JSON.parse(JSON.stringify(payload.storyArc)) as typeof arcForm.value
      editingArcId.value = String(payload.editingArcId || ''); editingSuggestion.value = String(payload.suggestionId || ''); suggestionSource.value = String(payload.suggestionSource || '')
      arcSuggestedNodes.value = JSON.parse(JSON.stringify(payload.suggestedNodes || [])) as typeof arcSuggestedNodes.value; arcEditBaseline.value = String(payload.sourceBaseline || '')
      showArcModal.value = true
      plannerDraftCapture['story-arc'] = true
    } else if (payload.surface === 'event') {
      eventForm.value = JSON.parse(JSON.stringify(payload.event)) as typeof eventForm.value
      editingEventId.value = String(payload.editingEventId || ''); eventEditBaseline.value = String(payload.sourceBaseline || '')
      eventFormChanged.value = true; showEventModal.value = true
      plannerDraftCapture.event = true
    } else return
    recoverySessions.set(novelId.value + ':' + String(payload.surface), restored)
  } catch (error) { message.error(error instanceof Error ? error.message : '恢复草稿失败') }
}
async function discardPlannerDraft(item: EditorDraft) {
  try {
    const session = recoverySessions.get(item.novelId + ':' + String(item.payload?.surface))
    if (session && session.identity.id === item.id && (session.running || session.pending || session.sequence > session.savedSequence)) await recovery.flushSession(session)
    await recovery.discard(item)
    if (session?.identity.id === item.id) recoverySessions.delete(item.novelId + ':' + String(item.payload?.surface))
  } catch (error) { message.error(error instanceof Error ? error.message : '丢弃草稿失败') }
}
function closePlannerDraft(surface: 'chapter-plan' | 'story-arc' | 'event') {
  plannerDraftCapture[surface] = false
  const key = novelId.value + ':' + surface, timer = recoveryTimers.get(key)
  if (timer) { clearTimeout(timer); recoveryTimers.delete(key) }
  const session = recoverySessions.get(key)
  if (!session || plannerDisposed) return
  const metadata = surface === 'chapter-plan' ? { editingPlanId: editingPlanId.value, suggestionId: editingPlanSuggestion.value, suggestionSource: planSuggestionSource.value, sourceBaseline: planBaseline, formSource: planFormSource }
    : surface === 'story-arc' ? { editingArcId: editingArcId.value, suggestionId: editingSuggestion.value, suggestionSource: suggestionSource.value, sourceBaseline: arcEditBaseline.value, suggestedNodes: arcSuggestedNodes.value }
      : { editingEventId: editingEventId.value, sourceBaseline: eventEditBaseline.value }
  const value = surface === 'chapter-plan' ? planForm.value : surface === 'story-arc' ? arcForm.value : eventForm.value
  const scope = plannerScope(surface, metadata)
  if (session.identity.scope !== scope) {
    recoverySessions.delete(key)
    void recovery.flushSession(session).catch(() => undefined)
    return
  }
  try { recovery.queue(session, plannerDraftPayload(surface, metadata, value)) } catch { /* Keep the last valid durable checkpoint. */ }
  recoverySessions.delete(key)
  void recovery.flushSession(session).catch(() => undefined)
}
async function consumePlannerDraft(surface: string) {
  const key = novelId.value + ':' + surface, session = recoverySessions.get(key)
  if (!session) return
  try {
    const checkpoint = await recovery.flushSession(session)
    if (checkpoint && await recovery.consume(session, checkpoint)) recoverySessions.delete(key)
  } catch (error) {
    message.warning('正式资料已保存，但恢复草稿未能清理：' + (error instanceof Error ? error.message : String(error)))
  }
}
watch(novelId, async (_owner, previousOwner) => {
  if (!previousOwner) return
  for (const [key, timer] of recoveryTimers) { clearTimeout(timer); recoveryTimers.delete(key) }
  const sessions = [...recoverySessions]
  await Promise.allSettled(sessions.map(([, session]) => recovery.flushSession(session)))
  for (const [key, session] of sessions) if (recoverySessions.get(key) === session) recoverySessions.delete(key)
})
watch(() => route.query, query => { if (query.tab === 'scenes' && !workspaceReady.value) return }, { deep: true })
function currentPlanSource() {
  return novel.value ? chapterPlanningSourceVersion(novel.value, reconstructionWorkspaceStore.getStoryMemories(novelId.value), knowledgeStore.knowledgeBases) : ''
}
async function commitPlannerEdit(edit: ChapterPlanEdit) {
  const captured = cloneArcValue(edit)
  return reconstructionWorkspaceStore.transactStory(novelId.value, aggregate =>
    applyChapterPlanEdit(aggregate, captured, new Date().toISOString(), () => crypto.randomUUID(), knowledgeStore.knowledgeBases), result => !result.changed)
}
async function acceptPlanSuggestions() {
  if (planSaving.value || generatingPlans.value || showPlanModal.value || !planSuggestions.value.length) return
  planSaving.value = true
  try {
    await commitPlannerEdit({ action: 'create-batch', plans: planSuggestions.value.map(item => item.draft), planningSourceVersion: planSuggestionSource.value })
    planSuggestions.value = []
    message.success('已确认并保存章节计划'); offerChapterCreation()
  } catch (error) { message.error(error instanceof Error ? error.message : '计划建议保存失败') }
  finally { planSaving.value = false }
}
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
  if (planSaving.value) return
  plannerDraftCapture['chapter-plan'] = false
  editingPlanSuggestion.value = ''; planSaveError.value = ''
  planBaseline = plan ? JSON.stringify(plan) : ''
  planFormSource = plan ? cloneArcValue(plan) : undefined
  editingPlanId.value = plan?.id || ''
  planFormOwner = novelId.value
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
  const metadata = { horizon, editingPlanId: editingPlanId.value, suggestionId: '', suggestionSource: '', sourceBaseline: planBaseline, formSource: planFormSource }
  queuePlannerDraft('chapter-plan', metadata, planForm.value, planBaseline)
  plannerDraftCapture['chapter-plan'] = true
}
function openPlanSuggestion(id: string) {
  const suggestion = planSuggestions.value.find(item => item.id === id)
  if (!suggestion || planSaving.value) return
  openPlanModal({ ...suggestion.draft, id: '', createdAt: '', updatedAt: '' })
  editingPlanSuggestion.value = id
  const metadata = { editingPlanId: '', suggestionId: id, suggestionSource: planSuggestionSource.value, sourceBaseline: '', formSource: planFormSource }
  queuePlannerDraft('chapter-plan', metadata, planForm.value, planSuggestionSource.value)
}
async function submitPlan() {
  if (planSaving.value || !planForm.value.title.trim() || !planForm.value.objective.trim()) return
  planSaving.value = true; planSaveError.value = ''
  const data = {
    horizon: planForm.value.horizon,
    status: planForm.value.status,
    title: planForm.value.title.trim(),
    objective: planForm.value.objective.trim(),
    summary: planForm.value.summary.trim(),
    beats: planForm.value.beatsText.split(/\r?\n/).map(item => item.replace(/^[-*\d.、)\s]+/, '').trim()).filter(Boolean),
    targetChapterStart: Math.max(0, planForm.value.startChapter - 1),
    targetChapterEnd: Math.max(planForm.value.startChapter - 1, planForm.value.endChapter - 1),
    relatedArcIds: [...(planFormSource?.relatedArcIds || [])],
    relatedEventIds: [...(planFormSource?.relatedEventIds || [])],
    source: editingPlanSuggestion.value ? 'ai' as const : 'user' as const,
  }
  try {
    if (planFormOwner !== novelId.value) throw new Error('当前作品已经切换，请重新打开章节计划。')
    const suggestion = editingPlanSuggestion.value ? planSuggestions.value.find(item => item.id === editingPlanSuggestion.value) : undefined
    if (editingPlanSuggestion.value && !suggestion) throw new Error('这条建议已不存在，请重新打开。')
    if (editingPlanSuggestion.value) {
      suggestion!.draft = data
      await consumePlannerDraft('chapter-plan')
      plannerDraftCapture['chapter-plan'] = false
      showPlanModal.value = false
      message.success('建议已保存，核对完成后可确认加入规划。')
      return
    }
    if (editingPlanId.value) await commitPlannerEdit({ action: 'update', planId: editingPlanId.value, expectedPlan: planBaseline, updates: data })
    else await commitPlannerEdit({ action: 'create', data })
    await consumePlannerDraft('chapter-plan')
    plannerDraftCapture['chapter-plan'] = false
    showPlanModal.value = false
    message.success('章节计划已保存')
    offerChapterCreation()
  } catch (error) {
    planSaveError.value = error instanceof Error ? error.message : '章节计划保存失败'
    message.error(planSaveError.value)
  } finally { planSaving.value = false }
}
async function removePlan(planId: string) {
  try {
    if (await novelStore.deleteChapterPlanWithImpact(novelId.value, planId)) message.success('章节计划已删除')
  } catch (error) { message.error(error instanceof Error ? error.message : '章节计划删除失败') }
}

function openPlanVersionModal(plan: ChapterPlan) {
  planVersionOwner = novelId.value
  planVersionBaseline = JSON.stringify(plan)
  versionPlan.value = cloneArcValue(plan)
  selectedPlanVersionId.value = plan.versions?.[plan.versions.length - 1]?.id || ''
  showPlanVersionModal.value = true
}

async function restoreSelectedPlanVersion() {
  if (!versionPlan.value || !selectedPlanVersionId.value) return
  const plan = versionPlan.value
  const version = plan.versions?.find(item => item.id === selectedPlanVersionId.value)
  if (!version) return
  try {
    if (planVersionOwner !== novelId.value) throw new Error('当前作品已经切换，请重新打开版本记录。')
    const snapshot = JSON.parse(version.snapshot) as Partial<ChapterPlan>
    await commitPlannerEdit({ action: 'update', planId: plan.id, expectedPlan: planVersionBaseline, updates: {
      horizon: snapshot.horizon, title: String(snapshot.title || plan.title), objective: String(snapshot.objective || ''),
      summary: String(snapshot.summary || ''), beats: Array.isArray(snapshot.beats) ? snapshot.beats.map(String) : [],
      targetChapterStart: Number(snapshot.targetChapterStart) || 0, targetChapterEnd: Number(snapshot.targetChapterEnd) || 0,
      status: snapshot.status as ChapterPlan['status'],
    } })
    showPlanVersionModal.value = false
    versionPlan.value = null
    message.success('章节计划已恢复')
  } catch (error) { message.error(error instanceof Error ? error.message : '章节计划恢复失败')
  }
}

async function refreshPlan(plan: ChapterPlan) {
  if (regeneratingPlanId.value) return
  regeneratingPlanId.value = plan.id
  const nextChapter = Math.max(0, (novel.value?.chapters || []).length)
  const updates = createLocalChapterPlanRefresh(plan, nextChapter)
  try {
    await novelStore.updateChapterPlanWithImpact(novelId.value, plan.id, updates)
    message.success('已根据当前滚动位置局部刷新下一章计划，可继续编辑细节')
  } catch (error) { message.error(error instanceof Error ? error.message : '章节计划刷新失败') }
  finally { regeneratingPlanId.value = '' }
}

async function scanChapterState(chapterIndex?: number, startIndex = chapterIndex) {
  if (!novel.value || scanningState.value) return
  const chapter = chapterIndex === undefined ? latestCompletedChapter.value
    : [...novel.value.chapters].filter(item => item.chapterIndex <= chapterIndex
      && item.chapterIndex >= (startIndex ?? chapterIndex)
      && ['completed', 'reviewed', 'finalized', 'locked'].includes(item.status))
      .sort((a, b) => b.chapterIndex - a.chapterIndex)[0]
  if (!chapter) { message.warning('对应章节尚未完成，无法 AI 核对'); return }
  await runStateScan(chapter.id)
}

async function runStateScan(targetChapterId: string) {
  if (scanningState.value) return
  const targetNovelId = novelId.value
  const model = configStore.getModelForTask('review') || configStore.getModelForTask('writing') || undefined
  const controller = new AbortController()
  stateScanController = controller
  scanningState.value = true
  try {
    const added = await stateScans.scan(targetNovelId, targetChapterId, model, { signal: controller.signal })
    if (!plannerDisposed && targetNovelId === novelId.value) message.success(added ? '已保存 ' + added + ' 条状态提案' : '没有新增状态提案')
  } catch (error) {
    if (!plannerDisposed && targetNovelId === novelId.value) message.error(error instanceof Error ? error.message : '故事状态检查失败')
  } finally {
    scanningState.value = false
    if (stateScanController === controller) stateScanController = undefined
  }
}

const proposalTargetLabels: Record<StoryStateTargetType, string> = { story_arc: '故事弧线', arc_node: '弧线节点', event: '时间线事件', chapter_plan: '章节计划' }
const proposalStatusLabels: Record<string, string> = {
  active: '推进中', paused: '暂停', completed: '已完成', abandoned: '已放弃', pending: '待完成',
  planted: '已埋设', developing: '推进中', resolved: '已解决', unverified: '未核对', planned: '待执行', awaiting_review: '待核对', archived: '已归档',
}
function proposalTargetLabel(target: StoryStateTargetType) { return proposalTargetLabels[target] }
function proposalFieldLabel(field: StoryStateProposalField) { return field === 'create' ? '新增长线期待' : field === 'status' ? '状态变更' : '预计章节调整' }
function proposalValueLabel(proposal: StoryStateProposal) {
  if (proposal.field === 'create') return proposal.eventDraft?.description || proposal.reason
  if (proposal.field === 'targetChapter') return `第 ${Number(proposal.oldValue) + 1} 章 → 第 ${Number(proposal.newValue) + 1} 章`
  return `${proposalStatusLabels[proposal.oldValue] || proposal.oldValue} → ${proposalStatusLabels[proposal.newValue] || proposal.newValue}`
}
function proposalDisplayValue(proposal: StoryStateProposal, next: boolean) {
  if (proposal.field === 'create') return next ? (proposal.eventDraft?.description || proposal.reason) : '尚未记录'
  const value = next ? proposal.newValue : proposal.oldValue
  if (proposal.field === 'targetChapter') return value.trim() && Number.isFinite(Number(value)) ? '第 ' + (Number(value) + 1) + ' 章' : '尚未指定'
  return proposalStatusLabels[value] || value || '尚未记录'
}
const applyingProposalId = ref('')
async function acceptProposal(proposalId: string) {
  if (applyingProposalId.value) return
  applyingProposalId.value = proposalId
  try {
    if (await novelStore.applyStoryStateProposal(novelId.value, proposalId)) message.success('状态提案已应用')
    else message.warning('目标或来源章节已变化，请重新核对章节后再应用这条提案')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '状态提案保存失败，请重试')
  } finally {
    if (applyingProposalId.value === proposalId) applyingProposalId.value = ''
  }
}
async function rejectProposal(proposalId: string) {
  if (applyingProposalId.value) return
  applyingProposalId.value = proposalId
  try {
    if (await novelStore.rejectStoryStateProposal(novelId.value, proposalId)) message.success('状态提案已忽略')
  } catch (error) { message.error(error instanceof Error ? error.message : '忽略决定未保存，请重试') }
  finally { if (applyingProposalId.value === proposalId) applyingProposalId.value = '' }
}

const arcSuggestions = ref<Array<{ id: string; draft: StoryArcDraft; sourceVersion: string }>>([])
const arcDesignFields = [
  { key: 'goal', label: '剧情目标', characterOnly: false }, { key: 'conflict', label: '核心冲突', characterOnly: false },
  { key: 'expectedResolution', label: '预期收束', characterOnly: false }, { key: 'initialState', label: '人物初始状态', characterOnly: true },
  { key: 'desire', label: '渴望', characterOnly: true }, { key: 'fear', label: '恐惧', characterOnly: true },
  { key: 'falseBelief', label: '错误信念', characterOnly: true }, { key: 'finalState', label: '预期成长', characterOnly: true },
] as const
const arcSaving = ref(false)
const arcSaveError = ref('')
const lastArcImpact = ref<ArcEditImpact>()
const cloneArcValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
function handleExtractArcs() { return extractArcsFromOutline() }
async function extractArcsFromOutline(options: { onlyWhenEmpty?: boolean; silent?: boolean } = {}) {
  if (!novel.value?.outline || extractingArcs.value) return
  if (options.onlyWhenEmpty && (novel.value.storyArcs || []).length) return
  const model = configStore.getModelForTask('outline')
  if (!model) { message.warning('请先配置大纲模型'); return }
  const source = cloneArcValue(novel.value), sourceVersion = arcPlanningSourceVersion(source), owner = source.id
  extractingArcs.value = true
  try {
    const suggestions = await generateStoryArcDrafts(source, model)
    if (novelId.value !== owner) return
    const titles = new Set((novel.value.storyArcs || []).map(arc => arc.title.trim().toLowerCase()))
    arcSuggestions.value = suggestions.filter(item => !titles.has(item.title.trim().toLowerCase()))
      .map((draft, index) => ({ id: sourceVersion + ':' + index, draft, sourceVersion }))
    activeTab.value = 'arcs'
    message.info(arcSuggestions.value.length ? '弧线建议已生成，请逐条编辑并确认。' : '没有新的弧线建议。')
  } catch (error) { message.error(error instanceof Error ? error.message : '故事弧线提取失败') }
  finally { extractingArcs.value = false }
}
const showArcModal = ref(false)
const editingArcId = ref('')
const arcEditBaseline = ref('')
const editingSuggestion = ref('')
const suggestionSource = ref('')
const arcSuggestedNodes = ref<Array<{ title: string; description: string; targetChapter: number }>>([])
const arcForm = ref(emptyArcForm())
function emptyArcForm(): ArcDefinition {
  return { title: '', description: '', type: 'sub', importance: 3, status: 'active', reactivateAt: '', characterIds: [],
    goal: '', conflict: '', expectedResolution: '', dependencyArcIds: [], initialState: '', desire: '', fear: '', falseBelief: '', finalState: '', turningPointEventIds: [] }
}
function openArcModal(arc?: StoryArc) {
  if (arcSaving.value) return
  plannerDraftCapture['story-arc'] = false
  arc = novel.value?.storyArcs?.find(item => item.id === arc?.id)
  editingArcId.value = arc?.id || ''
  arcEditBaseline.value = arc ? JSON.stringify(arc) : ''
  editingSuggestion.value = ''; suggestionSource.value = ''; arcSuggestedNodes.value = []
  arcForm.value = { ...emptyArcForm(), ...(arc ? Object.fromEntries(ARC_CANON_FIELDS.map(field => [field, cloneArcValue(arc[field] ?? emptyArcForm()[field])])) : {}) }
  arcSaveError.value = ''; showArcModal.value = true
  const metadata = { editingArcId: editingArcId.value, suggestionId: editingSuggestion.value, suggestionSource: suggestionSource.value, sourceBaseline: arcEditBaseline.value, suggestedNodes: arcSuggestedNodes.value }
  queuePlannerDraft('story-arc', metadata, arcForm.value, suggestionSource.value || arcEditBaseline.value)
  plannerDraftCapture['story-arc'] = true
}
function openArcSuggestion(id: string) {
  const item = arcSuggestions.value.find(item => item.id === id)
  if (!item) return
  openArcModal()
  plannerDraftCapture['story-arc'] = false
  editingSuggestion.value = id; suggestionSource.value = item.sourceVersion
  const { draft } = item
  Object.assign(arcForm.value, { title: draft.title, description: draft.description, type: draft.type, importance: draft.importance,
    goal: draft.goal || '', conflict: draft.conflict || '', expectedResolution: draft.expectedResolution || '',
    initialState: draft.initialState || '', desire: draft.desire || '', fear: draft.fear || '', falseBelief: draft.falseBelief || '', finalState: draft.finalState || '',
    characterIds: novel.value!.characters.filter(character => draft.characterNames.some(name => name === character.name || character.aliases.includes(name))).map(character => character.id) })
  arcSuggestedNodes.value = cloneArcValue(draft.nodes)
  const metadata = { editingArcId: '', suggestionId: id, suggestionSource: item.sourceVersion, sourceBaseline: '', suggestedNodes: arcSuggestedNodes.value }
  queuePlannerDraft('story-arc', metadata, arcForm.value, item.sourceVersion)
  plannerDraftCapture['story-arc'] = true
}
async function saveArcEdit(edit: StoryArcEdit): Promise<boolean> {
  if (arcSaving.value) return false
  arcSaving.value = true; arcSaveError.value = ''
  try {
    lastArcImpact.value = await novelStore.commitStoryArcEdit(novelId.value, edit)
    message.success(`剧情变更已保存，实际需重审 ${lastArcImpact.value.reviewChapterIds.length} 章。`)
    return true
  } catch (error) { arcSaveError.value = error instanceof Error ? error.message : '保存失败，请重试'; message.error(arcSaveError.value); return false }
  finally { arcSaving.value = false }
}
async function submitArc() {
  const definition = cloneArcValue(arcForm.value)
  const success = await saveArcEdit(editingArcId.value
    ? { action: 'update', arcId: editingArcId.value, expectedArc: arcEditBaseline.value, definition }
    : { action: 'create', definition, nodes: arcSuggestedNodes.value.map(node => ({ ...node, targetChapter: node.targetChapter - 1 })), planningSourceVersion: suggestionSource.value || undefined })
  if (success) {
    await consumePlannerDraft('story-arc')
    plannerDraftCapture['story-arc'] = false
    showArcModal.value = false
    arcSuggestions.value = arcSuggestions.value.filter(item => item.id !== editingSuggestion.value)
    editingSuggestion.value = ''; editingArcId.value = ''
  }
}
async function removeArc(arcId: string) {
  const arc = novel.value?.storyArcs?.find(item => item.id === arcId)
  if (arc) await saveArcEdit({ action: 'delete', arcId, expectedArc: JSON.stringify(arc) })
}
const showNodeModal = ref(false)
const nodeArcId = ref('')
const editingNodeId = ref('')
const nodeEditBaseline = ref('')
const nodeForm = ref({ title: '', description: '', targetChapter: 1, prerequisiteNodeIds: [] as string[], consequenceEventIds: [] as string[] })
function openNodeModal(arcId: string, node?: StoryArcNode) {
  const arc = novel.value?.storyArcs?.find(item => item.id === arcId)
  if (!arc || arcSaving.value) return
  nodeArcId.value = arcId; editingNodeId.value = node?.id || ''; nodeEditBaseline.value = JSON.stringify(arc)
  nodeForm.value = node ? { title: node.title, description: node.description, targetChapter: node.targetChapter + 1, prerequisiteNodeIds: [...(node.prerequisiteNodeIds || [])], consequenceEventIds: [...(node.consequenceEventIds || [])] }
    : { title: '', description: '', targetChapter: Math.max(1, (novel.value?.chapters.length || 0) + 1), prerequisiteNodeIds: [], consequenceEventIds: [] }
  arcSaveError.value = ''; showNodeModal.value = true
}
async function submitNode() {
  const definition = { ...cloneArcValue(nodeForm.value), targetChapter: nodeForm.value.targetChapter - 1 }
  const success = await saveArcEdit(editingNodeId.value
    ? { action: 'update_node', arcId: nodeArcId.value, nodeId: editingNodeId.value, expectedArc: nodeEditBaseline.value, definition }
    : { action: 'add_node', arcId: nodeArcId.value, expectedArc: nodeEditBaseline.value, definition })
  if (success) showNodeModal.value = false
}
const showNodeStatusModal = ref(false)
const nodeStatus = ref<'pending' | 'completed' | 'abandoned'>('completed')
const sourceChapterId = ref<string | null>(null)
const sourceChapterSnapshot = ref<{ id: string; index: number; content: string; version: string }>()
const nodeEvidence = ref('')
function selectSourceChapter(id: string | null) {
  sourceChapterId.value = id
  const chapter = novel.value?.chapters.find(chapter => chapter.id === id)
  sourceChapterSnapshot.value = chapter ? { id: chapter.id, index: chapter.chapterIndex, content: chapter.content, version: buildAnalysisSourceVersionId(chapter.content) } : undefined
  nodeEvidence.value = ''
}
function toggleNode(arc: StoryArc, node: StoryArcNode) {
  if (arcSaving.value) return
  arc = novel.value?.storyArcs?.find(item => item.id === arc.id) || arc
  nodeArcId.value = arc.id; editingNodeId.value = node.id; nodeEditBaseline.value = JSON.stringify(arc)
  nodeStatus.value = node.status === 'completed' ? 'pending' : 'completed'
  selectSourceChapter(null); arcSaveError.value = ''; showNodeStatusModal.value = true
}
async function submitNodeStatus() {
  const source = sourceChapterSnapshot.value
  if (nodeStatus.value === 'completed' && !source) { arcSaveError.value = '请选择实际发生章节。'; return }
  const success = await saveArcEdit({ action: 'node_status', arcId: nodeArcId.value, nodeId: editingNodeId.value, expectedArc: nodeEditBaseline.value, status: nodeStatus.value,
    source: source && nodeStatus.value === 'completed' ? { kind: 'chapter', chapterId: source.id, chapterIndex: source.index, sourceVersionId: source.version, evidence: [{ quote: nodeEvidence.value }] } : undefined })
  if (success) showNodeStatusModal.value = false
}
async function removeNode(arcId: string, nodeId: string) {
  const arc = novel.value?.storyArcs?.find(item => item.id === arcId)
  if (arc) await saveArcEdit({ action: 'delete_node', arcId, nodeId, expectedArc: JSON.stringify(arc) })
}
const dependencyArcOptions = computed(() => arcLinkOptions.value.filter(item => item.value !== editingArcId.value))
const arcEventOptions = computed(() => (novel.value?.eventLog || []).map(event => ({ label: event.title, value: event.id })))
const prerequisiteNodeOptions = computed(() => (novel.value?.storyArcs || []).flatMap(arc => arc.nodes.filter(node => node.id !== editingNodeId.value).map(node => ({ label: arc.title + ' / ' + node.title, value: node.id }))))
const sourceChapterOptions = computed(() => (novel.value?.chapters || []).filter(chapter => chapter.content.trim()).map(chapter => ({ label: '第' + (chapter.chapterIndex + 1) + '章 ' + chapterTitleForDisplay(chapter.title, chapter.chapterIndex), value: chapter.id })))
const editingArcImpact = computed(() => novel.value && editingArcId.value ? analyzeStoryArcImpact(novel.value, editingArcId.value) : undefined)


const showEventModal = ref(false)
const editingEventId = ref('')
const eventForm = ref(emptyEventForm())
const eventFormChanged = ref(false)
const eventEditBaseline = ref('')
const eventSaving = ref(false)
const eventSaveError = ref('')
watch(planForm, () => {
  if (plannerDraftCapture['chapter-plan'] && showPlanModal.value) queueCurrentPlannerDraft('chapter-plan')
}, { deep: true, flush: 'sync' })
watch(arcForm, () => {
  if (plannerDraftCapture['story-arc'] && showArcModal.value) queueCurrentPlannerDraft('story-arc')
}, { deep: true, flush: 'sync' })
watch(eventForm, () => {
  if (plannerDraftCapture.event && showEventModal.value) {
    eventFormChanged.value = true
    queueCurrentPlannerDraft('event')
  }
}, { deep: true, flush: 'sync' })
function emptyEventForm() {
  return { title: '', description: '', type: '主线' as EventLogEntry['type'], status: 'developing' as NonNullable<EventLogEntry['status']>, chapter: Math.max(1, novel.value?.chapters.length || 1), targetChapter: null as number | null, storyTime: '', location: '', importance: 3 as 1 | 2 | 3 | 4 | 5, characters: '', relatedArcIds: [] as string[], evidence: '',
    scope: 'chapter' as NonNullable<EventLogEntry['scope']>, hintCount: 0, lastProgressChapter: null as number | null, resolvedChapter: null as number | null }
}
function openEventModal(event?: EventLogEntry) {
  plannerDraftCapture.event = false
  editingEventId.value = event?.id || ''
  eventEditBaseline.value = event ? JSON.stringify(event) : ''
  eventSaveError.value = ''
  eventForm.value = event ? {
    title: event.title, description: event.description, type: event.type, status: event.status || 'resolved',
    chapter: event.chapterIndex + 1, targetChapter: event.targetChapter !== undefined ? event.targetChapter + 1 : null,
    storyTime: event.storyTime || '', location: event.location || '', importance: event.importance || 3,
    characters: (event.characters || []).join('、'), relatedArcIds: [...(event.relatedArcIds || [])], evidence: event.evidence || '',
    scope: event.scope || 'chapter', hintCount: event.hintCount ?? 0,
    lastProgressChapter: event.lastProgressChapterIndex === undefined ? null : event.lastProgressChapterIndex + 1,
    resolvedChapter: event.resolvedChapterIndex === undefined ? null : event.resolvedChapterIndex + 1,
  } : emptyEventForm()
  showEventModal.value = true
  const metadata = { editingEventId: editingEventId.value, sourceBaseline: eventEditBaseline.value }
  queuePlannerDraft('event', metadata, eventForm.value, eventEditBaseline.value)
  plannerDraftCapture.event = true
}
function eventPayload() {
  return {
    title: eventForm.value.title.trim(), description: eventForm.value.description.trim(), type: eventForm.value.type,
    status: eventForm.value.status, chapterIndex: eventForm.value.chapter - 1,
    targetChapter: eventForm.value.targetChapter ? eventForm.value.targetChapter - 1 : undefined,
    storyTime: eventForm.value.storyTime.trim(), location: eventForm.value.location.trim(), importance: eventForm.value.importance,
    characters: eventForm.value.characters.split(/[,，、]/).map(value => value.trim()).filter(Boolean),
    relatedArcIds: eventForm.value.relatedArcIds, evidence: eventForm.value.evidence.trim(),
    scope: eventForm.value.scope, hintCount: eventForm.value.hintCount,
    lastProgressChapterIndex: eventForm.value.lastProgressChapter === null ? undefined : eventForm.value.lastProgressChapter - 1,
    resolvedChapterIndex: eventForm.value.status === 'resolved' && eventForm.value.resolvedChapter !== null ? eventForm.value.resolvedChapter - 1 : undefined,
  }
}
async function submitEvent() {
  if (eventSaving.value) return
  eventSaving.value = true
  eventSaveError.value = ''
  try {
    if (editingEventId.value) {
      await novelStore.saveEntityDefinition(novelId.value, 'event', editingEventId.value, eventEditBaseline.value, eventPayload())
      message.success('时间线事件已更新，已记录为作者全局设定')
    } else {
      await novelStore.addEvent(novelId.value, eventPayload())
      message.success('时间线事件已保存')
    }
    await consumePlannerDraft('event')
    plannerDraftCapture.event = false
    showEventModal.value = false
    eventFormChanged.value = false
    offerChapterCreation()
  } catch (error) {
    eventSaveError.value = error instanceof Error ? error.message : '事件保存失败，请重试'
    message.error(eventSaveError.value)
  } finally {
    eventSaving.value = false
  }
}
const deletingEvent = ref(false)
async function removeEvent(eventId: string) {
  if (deletingEvent.value) return false
  deletingEvent.value = true
  try {
    await novelStore.deleteEvent(novelId.value, eventId)
    message.success('事件已删除，已写章节需重新审核')
    return true
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除失败，请重试')
    return false
  } finally {
    deletingEvent.value = false
  }
}
</script>

<style scoped>
.arc-draft-panel, .arc-impact { padding: 18px; margin-bottom: 18px; }
.arc-draft-row { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--border-color); }
.arc-draft-row > div { flex: 1; min-width: 0; }
.arc-design-fields { display: grid; grid-template-columns: 100px 1fr; gap: 8px 12px; }
.arc-design-fields dt { color: var(--text-color-secondary); }
.arc-design-fields dd { margin: 0; white-space: pre-wrap; }
.arc-source-text { max-height: 280px; overflow: auto; white-space: pre-wrap; font-family: inherit; }
.suggested-node { padding: 12px 0; border-bottom: 1px solid var(--border-color); }
.entity-source-alert { color: var(--color-warning); font-size: 12px; line-height: 1.6; }
.entity-source-note { color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; }
.save-error { color: var(--color-error); }
.story-planner { max-width: 1180px; margin: 0 auto; padding-bottom: 56px; }
.story-planner.v3-embedded {
  max-width: 1280px;
  margin: 0 auto;
  padding: 8px 0 48px;
  --color-primary: var(--zhu);
  --color-primary-hover: var(--zhu);
  --color-primary-light: var(--zhu-soft);
  --color-accent: var(--dai);
  --color-accent-light: var(--dai-soft);
  --bg-color: var(--desk);
  --bg-color-secondary: var(--desk-2);
  --bg-color-card: var(--paper);
  --bg-color-paper: var(--paper);
  --bg-color-hover: var(--hover);
  --bg-color-tag: var(--panel-2);
  --text-color-primary: var(--ink);
  --text-color-secondary: var(--ink-2);
  --text-color-tertiary: var(--ink-3);
  --text-color-disabled: var(--ink-4);
  --text-color-inverse: var(--paper);
  --border-color: var(--line-2);
  --border-color-light: var(--line);
  --border-color-hover: var(--line-2);
  --shadow-md: var(--shadow-2);
  --shadow-card: var(--shadow-1);
  --font-family: var(--f-ui);
  --font-family-serif: var(--f-serif);
}
.planner-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.planner-header-compact { justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
.planner-header-compact:empty { display: none; }
.planner-header .page-title { margin: 0 0 4px; font-family: var(--font-family-serif); font-weight: 700; font-size: 26px; letter-spacing: 0.02em; line-height: 1.25; }
.header-actions { display: flex; gap: 8px; }
.page-subtitle { margin: 0; color: var(--text-color-tertiary); font-size: 14px; line-height: 1.5; }
.planner-summary {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px;
  margin-bottom: 8px; color: var(--text-color-tertiary); font-size: 12px;
}
.planner-overview { margin-bottom: 20px; }
.planner-summary span {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px;
  background: var(--bg-color-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.planner-summary strong {
  color: var(--text-color-primary); font-size: 20px; font-weight: 600; line-height: 1.2;
  font-family: var(--font-family-serif); font-variant-numeric: tabular-nums;
}
.planner-summary span:nth-child(5) strong,
.planner-summary span:nth-child(7) strong { color: var(--color-primary); }
.plan-board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; padding-top: 10px; }
.plan-lane {
  min-width: 0; padding: 12px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
}
.plan-lane-header { display: flex; min-height: 48px; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 2px 4px 10px; border-bottom: 1px solid var(--border-color); }
.plan-lane-header div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.plan-lane-header strong { color: var(--text-color-primary); font-family: var(--font-family-serif); font-size: 16px; font-weight: 700; }
.plan-lane-header span { color: var(--text-color-tertiary); font-size: 11px; }
.plan-list { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; }
.plan-card {
  min-width: 0; padding: 12px 14px;
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
  background: var(--bg-color-card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.plan-card:hover { border-color: var(--color-primary); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08); }
.version-dialog { display: grid; gap: 12px; }
.version-current { margin: 0; color: var(--text-color-secondary); }
.version-diff-list { display: grid; gap: 8px; max-height: 360px; overflow: auto; }
.version-diff-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 20px minmax(0, 1fr); gap: 8px; padding: 8px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); font-size: 13px; }
.version-diff-row span { overflow-wrap: anywhere; }
.plan-card-header, .plan-card-header > div, .proposal-header, .proposal-header > div { display: flex; align-items: center; gap: 7px; }
.plan-card-header, .proposal-header { justify-content: space-between; }
.plan-card h3 { margin: 8px 0 6px; color: var(--text-color-primary); font-family: var(--font-family-serif); font-size: 15px; font-weight: 600; line-height: 1.4; }
.plan-card p { margin: 6px 0; color: var(--text-color-secondary); font-size: 12px; line-height: 1.65; white-space: pre-wrap; }
.plan-card small { color: var(--text-color-tertiary); font-size: 11px; }
.plan-range { color: var(--color-primary); font-size: 11px; font-variant-numeric: tabular-nums; }
.plan-objective { display: block; color: var(--color-accent); font-size: 12px; font-weight: 500; line-height: 1.5; }
.plan-beats { margin: 8px 0 10px; padding-left: 18px; color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; }
.empty-plan { display: flex; min-height: 96px; align-items: center; justify-content: center; flex-direction: column; gap: 6px; border: 1px dashed var(--border-color); border-radius: var(--radius-md); background: transparent; color: var(--text-color-tertiary); cursor: pointer; }
.empty-plan:hover { border-color: var(--color-primary); color: var(--color-primary); }
.relay-section {
  margin-top: 14px; padding: 14px 18px 6px;
  background: var(--bg-color-card);
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.relay-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.relay-heading h3 { margin: 0; color: var(--text-color-primary); font-family: var(--font-family-serif); font-size: 16px; font-weight: 700; }
.relay-list { display: grid; }
.relay-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-width: 0; padding: 12px 0; border-top: 1px solid var(--border-color-light); }
.relay-main { display: grid; gap: 4px; min-width: 0; }
.relay-main strong { color: var(--text-color-primary); font-size: 13px; }
.relay-main span { color: var(--text-color-secondary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.relay-evidence { color: var(--text-color-tertiary) !important; }
.relay-actions { display: flex; flex-shrink: 0; gap: 6px; }
.proposal-list { display: flex; flex-direction: column; padding-top: 8px; }
.proposal-card { padding: 16px 0; border-bottom: 1px solid var(--border-color-light); }
.proposal-header { flex-wrap: wrap; }
.proposal-header strong { color: var(--text-color-primary); font-size: 14px; }
.proposal-header > span { color: var(--text-color-tertiary); font-size: 12px; }
.proposal-change { display: flex; align-items: center; gap: 10px; margin: 12px 0 8px; }
.proposal-change span { color: var(--text-color-tertiary); font-size: 12px; }
.proposal-change code { min-width: 0; padding: 4px 7px; border-radius: var(--radius-sm); background: var(--bg-color-secondary); color: var(--text-color-primary); font-family: inherit; font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.proposal-card p, .proposal-card blockquote { color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; }
.proposal-card blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--border-color); color: var(--text-color-tertiary); }
.proposal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.arc-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 14px; padding-top: 8px; }
.arc-card {
  min-width: 0; padding: 18px;
  border: 1px solid var(--border-color); border-radius: var(--radius-md);
  background: var(--bg-color-card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.arc-card-header, .arc-title-row, .timeline-heading, .timeline-heading > div, .memory-result-header { display: flex; align-items: center; gap: 8px; }
.arc-card-header, .timeline-heading { justify-content: space-between; }
.arc-title-row { min-width: 0; flex-wrap: wrap; }
.arc-title-row h3 { margin: 0; font-family: var(--font-family-serif); font-size: 17px; font-weight: 600; line-height: 1.35; color: var(--text-color-primary); }
.icon-actions { display: flex; flex-shrink: 0; }
.arc-description { min-height: 42px; margin: 12px 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.arc-meta, .timeline-meta { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--text-color-tertiary); font-size: 12px; font-variant-numeric: tabular-nums; }
.progress-track { height: 4px; margin: 10px 0 14px; overflow: hidden; background: var(--progress-track); border-radius: 2px; }
.progress-value { height: 100%; background: var(--color-primary); transition: width .2s ease; }
.node-list { border-top: 1px solid var(--border-color-light); }
.node-row { display: grid; grid-template-columns: 24px 64px minmax(0, 1fr) 28px; align-items: center; gap: 8px; min-height: 48px; border-bottom: 1px solid var(--border-color-light); }
.node-toggle { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--color-primary); cursor: pointer; }
.node-chapter { color: var(--color-primary); font-size: 12px; font-variant-numeric: tabular-nums; }
.node-content { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.node-content strong { color: var(--text-color-primary); font-size: 13px; }
.node-content span { overflow: hidden; color: var(--text-color-tertiary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.node-completed .node-content { opacity: .65; }
.node-completed .node-content strong { text-decoration: line-through; }
.node-empty { padding: 18px 0; color: var(--text-color-tertiary); font-size: 12px; text-align: center; }
.add-node-button { margin-top: 12px; }
.filter-bar, .memory-search { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 150px; gap: 10px; padding: 8px 0 18px; }
.memory-search { grid-template-columns: minmax(0, 1fr) auto; }
.memory-categories { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 8px; }
.memory-categories button { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-color-card); color: var(--text-color-secondary); padding: 7px 12px; cursor: pointer; }
.memory-categories button[aria-pressed="true"] { color: var(--color-primary); background: var(--color-primary-light); border-color: var(--color-primary); }
.memory-categories span { font-size: 11px; font-variant-numeric: tabular-nums; opacity: .75; }
.memory-excerpt { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.memory-path, .memory-state { color: var(--color-accent); }
.memory-path-detail { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; color: var(--color-accent); font-size: 13px; }
.memory-path-detail section { width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow-wrap: anywhere; }
.memory-path-detail section p { margin: 0 0 6px; font-size: 13px; }
.memory-path-detail section button { margin-right: 12px; }
.memory-path-detail span + span::before { content: '→'; margin-right: 6px; color: var(--text-color-tertiary); }
.memory-freshness-note { color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; }
.index-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0 4px; color: var(--text-color-tertiary); font-size: 12px; }
.timeline-list { position: relative; }
.timeline-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 18px; }
.timeline-marker { position: relative; padding-top: 18px; color: var(--color-primary); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.timeline-marker::after { position: absolute; top: 0; right: -14px; width: 1px; height: 100%; background: var(--border-color-light); content: ''; }
.timeline-marker i { position: absolute; z-index: 1; top: 22px; right: -18px; width: 9px; height: 9px; border: 2px solid var(--bg-color); border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }
.timeline-content { min-width: 0; padding: 14px 0 20px; border-bottom: 1px solid var(--border-color-light); }
.timeline-heading strong { font-family: var(--font-family-serif); font-size: 15px; font-weight: 600; line-height: 1.4; }
.timeline-content p { margin: 8px 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
.timeline-evidence { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--border-color); color: var(--text-color-tertiary); font-size: 12px; }
.character-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.memory-results { display: flex; flex-direction: column; }
.memory-workbench { display: grid; grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.memory-result { text-align: left; background: transparent; color: var(--text-color-primary); border: 0; cursor: pointer; padding: 16px 12px; }
.memory-result[aria-pressed="true"] { background: var(--color-primary-light); border-left: 3px solid var(--color-primary); }
.memory-detail { position: sticky; top: 0; min-width: 0; }
.memory-detail h3 { font-size: 24px; margin: 16px 0; }
.memory-detail p { font-family: var(--font-family-serif); font-size: 16px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.memory-detail small { display: block; margin-top: 24px; color: var(--text-color-tertiary); }
.memory-result { padding: 15px 0; border-bottom: 1px solid var(--border-color-light); }
.memory-result-header { flex-wrap: wrap; }
.memory-result-header strong { font-size: 14px; }
.memory-result-header span { margin-left: auto; color: var(--color-accent); font-size: 12px; font-variant-numeric: tabular-nums; }
.memory-result p { margin: 8px 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; }
.memory-result small { color: var(--text-color-tertiary); }
.memory-placeholder { display: flex; min-height: 280px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: var(--text-color-tertiary); text-align: center; }
.memory-placeholder strong { color: var(--text-color-secondary); }
.empty-block { padding: 70px 0; }
.form-modal { width: min(680px, calc(100vw - 32px)); }
:global(.form-modal.v3) {
  --bg-color-card: var(--paper); --bg-color-hover: var(--panel); --bg-color-secondary: var(--panel-2);
  --text-color-primary: var(--ink); --text-color-secondary: var(--ink-2); --text-color-tertiary: var(--ink-3);
  --border-color: var(--line); --border-color-light: var(--line-2);
  max-height: calc(100dvh - 48px); display: flex; flex-direction: column;
  background: var(--paper); color: var(--ink); border: 1px solid var(--line); box-shadow: var(--shadow-3);
}
:global(.form-modal.v3 .n-card-header), :global(.form-modal.v3 .n-card__footer) { flex-shrink: 0; }
:global(.form-modal.v3 .n-card-content) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
:global(.form-modal.v3 .n-card-header__main), :global(.form-modal.v3 .n-form-item-label) { color: var(--ink); }
:global(.form-modal.v3 .n-card__footer) { border-top: 1px solid var(--line); }
:global(.form-modal.v3 .n-input), :global(.form-modal.v3 .n-base-selection-label), :global(.form-modal.v3 .n-base-selection-tags) { background: var(--panel); color: var(--ink); }
:global(.form-modal.v3 .n-input input), :global(.form-modal.v3 .n-input textarea), :global(.form-modal.v3 .n-base-selection-input) { color: var(--ink); }
:global(.form-modal.v3 .n-input-number) { width: 100%; }
:global(.form-modal.v3 .n-button--primary-type) { background: var(--zhu); color: #fff8ef; }
.small-modal { width: min(480px, calc(100vw - 32px)); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.span-2 { grid-column: span 2; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.planner-tabs :deep(.n-tabs-nav) { overflow-x: auto; overflow-y: hidden; }
.planner-tabs :deep(.n-tabs-tab) { white-space: nowrap; }
@media (max-width: 720px) {
  .memory-workbench { grid-template-columns: 1fr; }
  .memory-results { max-height: 340px; overflow: auto; }
  .memory-detail { position: static; }
  .planner-header { align-items: stretch; flex-direction: column; }
  .header-actions { align-self: stretch; }
  .header-actions :deep(.n-button) { flex: 1; }
  .filter-bar, .memory-search, .form-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .timeline-row { grid-template-columns: 68px minmax(0, 1fr); gap: 12px; }
  .node-row { grid-template-columns: 24px 54px minmax(0, 1fr) 28px; }
  .plan-board { grid-template-columns: 1fr; }
  .relay-row { align-items: flex-start; flex-direction: column; gap: 8px; }
}
.planning-select-title { display: block; text-align: left; padding: 6px 0; border: 0; background: none; color: var(--text-color-primary); font: 600 20px/1.5 var(--font-family-serif); cursor: pointer; }
.plan-workbench { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; padding-top: 12px; align-items: start; }
.plan-board { min-width: 0; padding: 0; }
.plan-lane { padding: 12px; min-height: 450px; }
.plan-card { padding: 16px; }
.plan-card.selected, .arc-selector-card.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.plan-card .plan-beats, .plan-card .plan-objective { display: none; }
.plan-card .icon-actions { flex-wrap: wrap; justify-content: flex-end; }
.plan-selection-detail, .relay-selection { padding: 24px; min-width: 0; }
.plan-selection-detail h3, .relay-selection h3 { font-size: 24px; margin: 12px 0; }
.plan-selection-detail section, .relay-selection section { margin: 18px 0; padding: 18px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); }
.plan-selection-detail h4, .relay-selection h4 { font: 600 16px var(--font-family-serif); margin-bottom: 10px; }
.plan-selection-detail p, .relay-selection p { font-size: 14px; line-height: 1.8; color: var(--text-color-secondary); overflow-wrap: anywhere; }
.plan-selection-detail ol, .relay-selection ul { padding-left: 18px; font-size: 14px; line-height: 1.9; }
.closed-plans { margin-top: 18px; color: var(--text-color-secondary); }
.closed-plans button { display: block; margin: 8px 0; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-color-card); color: var(--text-color-primary); cursor: pointer; }
.relay-workbench { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 1.3fr) minmax(220px, 1fr); gap: 18px; align-items: start; padding-top: 12px; }
.relay-workbench .relay-section { padding: 20px; margin: 0; }
.relay-workbench .relay-row { align-items: flex-start; flex-direction: column; gap: 10px; }
.relay-workbench .relay-row.selected { padding: 12px; background: var(--color-primary-light); border-radius: var(--radius-sm); }
.relay-context { min-width: 0; display: grid; gap: 18px; }
.relay-detail-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.arc-workbench { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; padding-top: 12px; }
.arc-selector { display: grid; gap: 16px; min-width: 0; }
.arc-selector-card { width: 100%; min-width: 0; text-align: left; padding: 24px; cursor: pointer; color: var(--text-color-primary); }
.arc-selector-card > div:first-child { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.arc-selector-card h3 { font-size: 24px; }
.arc-selector-card p { margin: 16px 0; font-size: 14px; line-height: 1.8; color: var(--text-color-secondary); }
.arc-node-track { display: flex; gap: 6px; padding: 10px 0; overflow-x: auto; }
.arc-node-track span { display: grid; justify-items: center; align-content: start; gap: 6px; flex: 1 0 64px; color: var(--text-color-tertiary); }
.arc-node-track i { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--border-color-hover); border-radius: 50%; font-style: normal; }
.arc-node-track .completed i { background: var(--color-success); color: var(--text-color-inverse); }
.arc-selector-meta { font-size: 12px; color: var(--text-color-tertiary); }
.arc-related-characters { padding: 16px; margin: 16px 0; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); }
.arc-related-characters span { display: inline-block; margin: 8px 8px 0 0; padding: 3px 10px; border-radius: 20px; background: var(--color-accent-light); }
@media (max-width: 1350px) { .plan-workbench { grid-template-columns: minmax(0, 1fr); } .plan-selection-detail { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .plan-selection-detail section { margin: 0; } }
@media (max-width: 1100px) { .relay-workbench, .arc-workbench { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 650px) { .plan-selection-detail { display: block; } .plan-selection-detail section { margin-top: 14px; } .arc-selector-card { padding: 18px; } }
.timeline-workbench { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; align-items: start; }
.timeline-selection { min-width: 0; padding: 24px; }
.timeline-selection h3 { font-size: 20px; margin-bottom: 24px; }
.timeline-selection > h4 { font: 600 25px var(--font-family-serif); margin-bottom: 12px; }
.timeline-selection section { padding: 20px 0; border-bottom: 1px solid var(--border-color-light); }
.timeline-selection section h4 { font: 600 16px var(--font-family-serif); margin-bottom: 10px; }
.timeline-selection p, .timeline-selection blockquote { font-size: 14px; color: var(--text-color-secondary); line-height: 1.8; overflow-wrap: anywhere; }
.timeline-selection blockquote { border-left: 3px solid var(--border-color-hover); padding: 12px; background: var(--bg-color-hover); }
.timeline-row.selected .timeline-content { border-color: var(--color-primary); background: var(--color-primary-light); }
.timeline-content { padding: 24px; }
.timeline-heading .planning-select-title { display: inline; margin-left: 10px; }
.proposal-card { padding: 24px; }
.proposal-header strong { font: 600 23px var(--font-family-serif); }
.proposal-comparison { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr) 24px minmax(0, 1fr); gap: 16px; margin: 20px 0; align-items: stretch; }
.proposal-comparison section { border: 1px solid var(--border-color-light); border-radius: var(--radius-md); background: var(--bg-color-hover); padding: 18px; min-width: 0; }
.proposal-comparison h4 { font: 600 16px var(--font-family-serif); margin-bottom: 12px; }
.proposal-comparison code { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px var(--font-family); color: var(--text-color-primary); }
.proposal-comparison blockquote { margin: 0; border: 0; padding: 0; font-size: 14px; line-height: 1.8; }
.proposal-arrow { align-self: center; color: var(--text-color-tertiary); font-size: 24px; }
@media (max-width: 1100px) { .timeline-workbench { grid-template-columns: minmax(0, 1fr); } .proposal-comparison { grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr); } .proposal-evidence { grid-column: 1 / -1; } }
@media (max-width: 650px) { .proposal-comparison { grid-template-columns: minmax(0, 1fr); } .proposal-arrow { display: none; } .timeline-content { padding: 16px; } }
.plan-card-header { align-items: flex-start; gap: 8px; }
.plan-card-header > div:first-child { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.plan-card-header .plan-range { white-space: nowrap; margin: 0; }
.plan-card-menu { position: relative; flex: 0 0 auto; }
.plan-card-menu summary { cursor: pointer; list-style: none; padding: 0 4px; color: var(--text-color-secondary); font: 700 22px/1 var(--font-family); }
.plan-card-menu[open] .icon-actions { position: absolute; z-index: 10; right: 0; top: 28px; min-width: 160px; display: flex; flex-wrap: wrap; padding: 12px; background: var(--bg-color-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-md); }
.plan-lane-header strong { font: 600 20px var(--font-family-serif); }

.arc-workbench.source-only { grid-template-columns: minmax(0, 1fr); }
.arc-source-recovery h3 { font: 600 22px var(--font-family-serif); }
.arc-source-recovery > p { line-height: 1.8; }

.timeline-heading > div:first-child { min-width: 0; flex: 1; flex-wrap: wrap; }
.timeline-heading .planning-select-title { min-width: 0; max-width: 100%; margin-left: 0; overflow-wrap: anywhere; }
.timeline-heading .icon-actions { flex-shrink: 0; }
.timeline-selection > h4 { overflow-wrap: anywhere; }
</style>
