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
      <n-button v-else-if="activeTab === 'proposals'" :loading="scanningState" :disabled="!latestCompletedChapter" type="primary" @click="scanChapterState()">
        检查最新章节
      </n-button>
    </header>

    <section class="planner-overview" aria-label="规划概览"><div class="planner-summary">
      <span><strong>{{ activeArcCount }}</strong> 条活跃弧线</span>
      <span><strong>{{ pendingNodeCount }}</strong> 个待完成节点</span>
      <span><strong>{{ unresolvedEventCount }}</strong> 个待推进事件</span>
      <span><strong>{{ activePlanCount }}</strong> 条进行中计划</span>
      <span><strong>{{ awaitingPlans.length }}</strong> 条计划待核对</span>
      <span><strong>{{ openPromises.length }}</strong> 条未兑现期待</span>
      <span><strong>{{ pendingProposalCount }}</strong> 条待审状态提案</span>
      <span><strong>{{ memoryRecordCount }}</strong> 条可检索记忆</span>
    </div></section>

    <n-tabs v-model:value="activeTab" type="line" class="planner-tabs">
      <n-tab-pane display-directive="show:lazy" name="volumes" tab="分卷规划">
        <VolumeOutline
          embedded
          :chapter-plan-confirmed="Boolean(novel?.chapterPlanConfirmed)"
          @confirmed="confirmVolumesAndGeneratePlans"
        />
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="plans" tab="章节计划">
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
          <section v-if="relayChapter"><h4>关联章节</h4><strong>第 {{ relayChapter.chapterIndex + 1 }} 章 · {{ relayChapter.title }}</strong><p>{{ relayChapter.summary || '本章尚未整理摘要，可打开章节查看正文。' }}</p><n-button text type="primary" @click="router.push(`/workspace/${novelId}/editor/${relayChapter.id}`)">查看章节</n-button></section>
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
                <span>第 {{ event.chapterIndex + 1 }} 章提出 · {{ event.lastProgressChapterIndex === undefined ? '尚未记录后续推进' : `最近第 ${event.lastProgressChapterIndex + 1} 章推进` }}</span>
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
        <div v-if="sortedArcs.length" class="arc-workbench">
          <div class="arc-selector"><button v-for="arc in sortedArcs" :key="arc.id" type="button" class="arc-selector-card paper-panel" :class="{ selected: selectedArc?.id === arc.id }" :aria-pressed="selectedArc?.id === arc.id" @click="selectedArcId = arc.id"><div><h3>{{ arc.title }}</h3><n-tag size="small" :type="arcTypeColor(arc.type)">{{ arcTypeLabel(arc.type) }}</n-tag></div><p>{{ arc.description || '暂未填写弧线描述' }}</p><div class="arc-node-track"><span v-for="node in arc.nodes" :key="node.id" :class="{ completed: node.status === 'completed' }"><i>{{ node.status === 'completed' ? '✓' : '·' }}</i><small>{{ node.title }}</small></span></div><span class="arc-selector-meta">{{ completedNodeCount(arc) }}/{{ arc.nodes.length }} 个节点已完成 · {{ arcStatusLabel(arc.status) }}</span></button></div>
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
                <span v-if="event.resolvedChapterIndex !== undefined">第 {{ event.resolvedChapterIndex + 1 }} 章兑现</span>
                <span v-if="event.relatedArcIds?.length">关联：{{ event.relatedArcIds.map(id => novel?.storyArcs?.find(arc => arc.id === id)?.title).filter(Boolean).join('、') }}</span>
              </div>
              <blockquote v-if="event.evidence" class="timeline-evidence">原文：{{ event.evidence }}</blockquote>
              <div v-if="event.characters?.length" class="character-tags">
                <n-tag v-for="name in event.characters" :key="name" size="small" round>{{ name }}</n-tag>
              </div>
            </div>
          </article>
        </div><aside v-if="selectedEvent" class="timeline-selection paper-panel"><h3>事件记录</h3><h4>{{ selectedEvent.title }}</h4><n-tag :type="eventStatusColor(selectedEvent.status)">{{ eventStatusLabel(selectedEvent.status) }}</n-tag><section><h4>提出章节</h4><p>{{ eventChapterLabel(selectedEvent.chapterIndex) }}</p><n-button v-if="selectedEventChapter" text @click="router.push(`/workspace/${novelId}/editor/${selectedEventChapter.id}`)">查看章节 →</n-button></section><section><h4>事件说明</h4><p>{{ selectedEvent.description || '暂无说明' }}</p></section><section v-if="selectedEvent.relatedArcIds?.length"><h4>关联弧线</h4><p>{{ selectedEvent.relatedArcIds.map(id => sortedArcs.find(arc => arc.id === id)?.title).filter(Boolean).join('、') || '暂无对应弧线' }}</p></section><section v-if="selectedEvent.evidence"><h4>原文依据</h4><blockquote>{{ selectedEvent.evidence }}</blockquote></section><section v-if="selectedEvent.storyTime || selectedEvent.location"><h4>时间与地点</h4><p>{{ [selectedEvent.storyTime, selectedEvent.location].filter(Boolean).join(' · ') }}</p></section><n-button @click="openEventModal(selectedEvent)">编辑事件</n-button></aside></div>
        <n-empty v-else description="没有符合条件的事件" class="empty-block" />
      </n-tab-pane>

      <n-tab-pane display-directive="show:lazy" name="memory" tab="项目记忆">
        <div class="index-status">
          <span v-if="memoryIndexInfo.recordCount">
            {{ memoryIndexInfo.provider === 'remote' ? '真实向量' : '本地索引' }} ·
            {{ memoryIndexInfo.model }} · {{ memoryIndexInfo.recordCount }} 条 · {{ memoryIndexInfo.dimensions }} 维
          </span>
          <span v-else>尚未建立持久化记忆索引</span>
          <n-button text type="primary" :loading="memoryIndexing" :disabled="memorySearching" @click="rebuildMemoryIndex">同步索引</n-button>
        </div>
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
            <small>{{ item.citation }}</small>
          </button>
          <n-button v-if="!searched && browsableMemory.length > memoryBrowseLimit" @click="memoryBrowseLimit += 100">加载更多记忆</n-button>
        </div>
        <article v-if="selectedMemory" class="memory-detail paper-panel">
          <n-tag size="small">{{ sourceLabel(selectedMemory.sourceType) }}</n-tag>
          <h3>{{ selectedMemory.title }}</h3>
          <p>{{ selectedMemory.content }}</p>
          <small>{{ selectedMemory.citation }}</small>
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
          <n-form-item label="关联弧线"><n-select v-model:value="eventForm.relatedArcIds" multiple clearable :options="arcLinkOptions" placeholder="可选" /></n-form-item>
          <n-form-item label="正文证据" class="span-2"><n-input v-model:value="eventForm.evidence" type="textarea" :rows="2" placeholder="可记录原文，便于后续核对" /></n-form-item>
          <n-form-item label="事件描述" class="span-2"><n-input v-model:value="eventForm.description" type="textarea" :rows="4" /></n-form-item>
        </div>
      </n-form>
      <template #footer><div class="modal-actions"><n-button @click="showEventModal = false">取消</n-button><n-button type="primary" :disabled="!eventForm.title.trim() || !eventForm.description.trim()" @click="submitEvent">保存</n-button></div></template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const planningTabs = new Set(['volumes', 'plans', 'relay', 'arcs', 'timeline', 'memory', 'proposals'])
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
const selectedMemoryId = ref('')
const selectedMemory = computed(() => displayedMemory.value.find(item => item.id === selectedMemoryId.value) || displayedMemory.value[0])
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
]
const timelineTypeOptions = [{ label: '全部类型', value: 'all' }, ...eventTypeOptions]
const timelineStatusOptions = [{ label: '全部状态', value: 'all' }, ...eventStatusOptions]
const memorySourceOptions = [
  { label: '全部', value: 'all' }, { label: '章节', value: 'chapter' },
  { label: '角色', value: 'character' }, { label: '事件', value: 'event' },
  { label: '故事弧线', value: 'story_arc' }, { label: '章节计划', value: 'chapter_plan' }, { label: '知识库', value: 'knowledge' },
  { label: '数据面板', value: 'data_panel' },
] satisfies Array<{ label: string; value: 'all' | SemanticSourceType }>

const characterOptions = computed(() => (novel.value?.characters || []).map(character => ({ label: character.name, value: character.id })))
const sortedArcs = computed(() => [...(novel.value?.storyArcs || [])].sort((a, b) => b.importance - a.importance || a.createdAt.localeCompare(b.createdAt)))
const arcLinkOptions = computed(() => sortedArcs.value.map(arc => ({ label: arc.title, value: arc.id })))
const selectedArcId = ref('')
const selectedArc = computed(() => sortedArcs.value.find(arc => arc.id === selectedArcId.value) || sortedArcs.value[0])
const relayArcs = computed(() => sortedArcs.value.filter(arc => arc.status === 'active' || arc.status === 'paused'))
const openPromises = computed(() => (novel.value?.eventLog || [])
  .filter(event => event.type === '伏笔' && event.status !== 'resolved' && event.status !== 'abandoned')
  .sort((a, b) => (b.lastProgressChapterIndex ?? b.chapterIndex) - (a.lastProgressChapterIndex ?? a.chapterIndex)))
const activeArcCount = computed(() => sortedArcs.value.filter(arc => arc.status === 'active').length)
const pendingNodeCount = computed(() => sortedArcs.value.reduce((sum, arc) => sum + arc.nodes.filter(node => node.status === 'pending').length, 0))
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
const memoryRecords = computed(() => novel.value ? buildSemanticRecords(novel.value, knowledgeStore.knowledgeBases) : [])
const memoryCategoryCounts = computed(() => {
  const counts: Record<string, number> = { all: memoryRecords.value.length }
  for (const record of memoryRecords.value) counts[record.sourceType] = (counts[record.sourceType] || 0) + 1
  return counts
})
const memoryBrowseLimit = ref(100)
const browsableMemory = computed(() => memoryRecords.value.filter(item => memorySource.value === 'all' || item.sourceType === memorySource.value).map(item => ({ ...item, citation: `${sourceLabel(item.sourceType)} · ${item.title}` })))
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
const selectedEventChapter = computed(() => selectedEvent.value ? novel.value?.chapters.find(chapter => chapter.chapterIndex === selectedEvent.value!.chapterIndex) : undefined)
function eventStatusColor(status: EventLogEntry['status']) { return status === 'resolved' ? 'success' : status === 'developing' ? 'info' : status === 'abandoned' ? 'default' : 'warning' }

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
  if (!query || memorySearching.value || memoryIndexing.value || !novel.value) return
  const source = memorySource.value
  const requestId = ++memoryRequestId
  const bookId = novelId.value
  searched.value = true
  memoryResults.value = []
  memorySearching.value = true
  try {
    // Incremental synchronization also handles edits and a changed embedding
    // provider when an index already exists. Unchanged vectors are reused.
    await syncSemanticIndexForNovel(novel.value, knowledgeStore.knowledgeBases, configStore.embedding, false)
    await refreshMemoryIndexInfo()
    if (requestId !== memoryRequestId) return
    const results = await queryPersistedSemanticEvidence(
      bookId,
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
watch([memoryQuery, memorySource, novelId], () => {
  memoryRequestId++
  searched.value = false
  memoryResults.value = []
  selectedMemoryId.value = ''
  memoryBrowseLimit.value = 100
})

onMounted(() => { void refreshMemoryIndexInfo() })

onBeforeUnmount(() => {
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
    if (added) offerChapterCreation()
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
    offerChapterCreation()
    return
  }
  message.info('分卷规划已确认，正在生成首批章节计划')
  await generatePlans()
  if ((novel.value?.chapterPlans || []).length) {
    novelStore.setChapterPlanConfirmed(novelId.value, true)
    offerChapterCreation()
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
  offerChapterCreation()
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

async function scanChapterState(chapterIndex?: number, startIndex = chapterIndex) {
  if (!novel.value || scanningState.value) return
  const chapter = chapterIndex === undefined ? latestCompletedChapter.value
    : [...novel.value.chapters].filter(item => item.chapterIndex <= chapterIndex
      && item.chapterIndex >= (startIndex ?? chapterIndex)
      && ['completed', 'reviewed', 'finalized', 'locked'].includes(item.status))
      .sort((a, b) => b.chapterIndex - a.chapterIndex)[0]
  if (!chapter) { message.warning('对应章节尚未完成，无法 AI 核对'); return }
  const model = configStore.getModelForTask('review') || configStore.getModelForTask('writing')
  if (!model) { message.warning('请先配置审查模型'); return }
  scanningState.value = true
  try {
    const drafts = await generateStoryStateProposalDrafts(novel.value, chapter, model)
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
  planted: '已埋设', developing: '推进中', resolved: '已解决', planned: '待执行', awaiting_review: '待核对', archived: '已归档',
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
    if (createdCount) offerChapterCreation()
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
  return { title: '', description: '', type: '主线' as EventLogEntry['type'], status: 'developing' as NonNullable<EventLogEntry['status']>, chapter: Math.max(1, novel.value?.chapters.length || 1), targetChapter: null as number | null, storyTime: '', location: '', importance: 3 as 1 | 2 | 3 | 4 | 5, characters: '', relatedArcIds: [] as string[], evidence: '' }
}
function openEventModal(event?: EventLogEntry) {
  editingEventId.value = event?.id || ''
  eventForm.value = event ? {
    title: event.title, description: event.description, type: event.type, status: event.status || 'resolved',
    chapter: event.chapterIndex + 1, targetChapter: event.targetChapter !== undefined ? event.targetChapter + 1 : null,
    storyTime: event.storyTime || '', location: event.location || '', importance: event.importance || 3,
    characters: (event.characters || []).join('、'), relatedArcIds: [...(event.relatedArcIds || [])], evidence: event.evidence || '',
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
    relatedArcIds: eventForm.value.relatedArcIds, evidence: eventForm.value.evidence.trim(),
    resolvedChapterIndex: eventForm.value.status === 'resolved' ? eventForm.value.chapter - 1 : undefined,
    scope: 'chapter' as const, hintCount: 0, source: 'user' as const,
  }
}
function submitEvent() {
  if (editingEventId.value) novelStore.updateEvent(novelId.value, editingEventId.value, eventPayload())
  else novelStore.addEvent(novelId.value, eventPayload())
  showEventModal.value = false
  message.success('时间线事件已保存')
  offerChapterCreation()
}
function removeEvent(eventId: string) { novelStore.deleteEvent(novelId.value, eventId); message.success('事件已删除') }
</script>

<style scoped>
.story-planner { max-width: 1180px; margin: 0 auto; padding-bottom: 56px; }
.planner-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
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
</style>
