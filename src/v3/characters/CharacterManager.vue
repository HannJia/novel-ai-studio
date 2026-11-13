<template>
  <BookPage>
  <div class="characters-page" id="characters-page">
    <div class="chars-header">
      <h2 class="page-title">角色库</h2>
      <div class="header-actions">
        <n-button type="primary" :disabled="savingEdit" @click="startNewCharacter">+ 手动添加</n-button>
        <n-button @click="aiScanCharacters" :loading="scanning" :disabled="relationshipScanning || characterScanSaving || !!characterScanResult">
          AI 扫描角色
        </n-button>
        <n-button v-if="scanning || relationshipScanning" size="small" @click="cancelAnalysis">停止</n-button>
        <n-button size="small" @click="showRelationshipScan = true" :loading="relationshipScanning"
          :disabled="characters.length < 2 || scanning">
          补全关系
        </n-button>
      </div>
    </div>

    <EditorRecoveryPicker :drafts="recoverableDrafts" :busy="recoveryBusy || savingEdit || scanning || relationshipScanning"
      :conflict="recoveryConflict" @restore="restoreEditorInput" @discard="discardEditorInput" />
    <p v-if="recoveryPending" role="status">正在保存或等待重试的输入：{{ recoveryPending }} 份</p>
    <div v-for="failure in recoveryFailures" :key="failure.session.identity.id" class="entity-source-alert" role="alert">
      {{ failure.session.identity.scope }}（{{ failure.session.identity.novelId }}）：{{ failure.message }}
      <n-button size="small" @click="retryEditorInput">重试保存</n-button>
      <n-button size="small" @click="forkEditorInput(failure.session)">另存当前输入</n-button>
      <n-button size="small" @click="pendingInputDiscard = { session: failure.session, expected: failure.expected }">放弃未落盘输入</n-button>
    </div>
    <div v-if="pendingInputDiscard" class="paper-panel">
      放弃本地第 {{ pendingInputDiscard.expected.sequence }} 次输入？已落盘版本仍会保留。
      <n-button size="small" :disabled="recoveryBusy" @click="discardPendingEditorInput">确认放弃</n-button>
      <n-button size="small" :disabled="recoveryBusy" @click="pendingInputDiscard = null">保留</n-button>
    </div>
    <details v-if="recoveredPartial" class="paper-panel">
      <summary>已恢复未完成扫描（{{ recoveredPartial.kind === 'character-scan' ? '角色' : '关系' }}）</summary>
      <p>这些片段尚未形成可提交候选。可查看保留内容，再由作者点击扫描按钮重新请求。</p>
      <pre style="white-space: pre-wrap; max-height: 240px; overflow: auto">{{ recoveredPartial.payload?.rawOutput || '请求未返回可展示片段。' }}</pre>
    </details>
    <div v-if="characterScanResult" class="paper-panel" aria-label="角色扫描待保存结果">
      <p>已得到 {{ characterScanResult.candidates.length }} 条角色候选，保存后可在章节审核中核对。</p>
      <p v-if="characterScanError" role="alert">{{ characterScanError }}</p>
      <n-button :loading="characterScanSaving" :disabled="characterScanSaving" @click="saveScannedCharacters">重试保存角色候选</n-button>
      <n-button :disabled="characterScanSaving" @click="discardCurrentScan('character')">放弃本次候选</n-button>
    </div>

    <p v-if="characterHistoryLoading" role="status">正在读取人物关系…</p>
    <p v-if="characterHistoryError" class="entity-source-alert" role="alert">{{ characterHistoryError }} <n-button size="small" @click="loadCharacterHistory">重新读取</n-button></p>
    <div class="relationship-boundary">
      <label>关系回看至
        <select v-model="relationshipChapterId" aria-label="关系回看章节" :disabled="relationshipScanning">
          <option v-if="!relationshipChapters.length" value="">作者基础设定</option>
          <option v-for="chapter in relationshipChapters" :key="chapter.id" :value="chapter.id">第{{ chapter.chapterIndex + 1 }}章 {{ chapter.title }}</option>
        </select>
      </label>
      <span>显示章末有效关系；箭头表示方向。章节确认的变化优先于基础关系。</span>
    </div>
    <p v-for="item in relationshipProjection.invalid" :key="item.record.id" class="entity-source-alert" role="status">{{ item.record.summary }}：{{ item.issue }}，关系待核对。</p>
    <details v-if="novel" class="paper-panel" @toggle="loadCharacterHistory">
      <summary style="padding: 12px; cursor: pointer">知情与关系历史</summary>
      <p v-if="characterHistoryError" role="alert">{{ characterHistoryError }}</p>
      <p v-else-if="characterHistoryLoading">正在读取人物状态历史…</p>
      <CharacterStateHistory v-else :novel="novel" :records="reconstructionWorkspace.getCanonMutations(novelId)" />
    </details>

    <!-- 筛选栏 -->
    <details v-if="novel" class="paper-panel">
      <summary style="padding: 12px; cursor: pointer">人物变更影响</summary>
      <StoryImpactHistory :novel="novel" :reports="reconstructionWorkspace.getImpactReports(novelId)" root-kind="character"
        :workspace="{ creationDraft: reconstructionWorkspace.getCreationDraft(novelId), storyMemories: reconstructionWorkspace.getStoryMemories(novelId) }" />
    </details>
    <div class="filter-bar">
      <div class="character-view-tabs" role="group" aria-label="角色视图"><button type="button" :class="{ active: viewMode === 'grid' }" :aria-pressed="viewMode === 'grid'" @click="viewMode = 'grid'">列表</button><button type="button" :class="{ active: viewMode === 'graph' }" :aria-pressed="viewMode === 'graph'" @click="viewMode = 'graph'">关系图</button></div>
      <n-input v-model:value="searchText" placeholder="搜索角色..." size="small" clearable style="max-width:200px;" />
      <n-select v-model:value="statusFilter" :options="statusOptions" size="small" clearable placeholder="状态" style="width:100px;" />
    </div>

    <div class="character-workbench" :class="{ 'with-detail': showDetail && selectedChar }">
    <div class="character-main">
    <!-- 空状态 -->
    <div v-if="!characters.length && !scanning" class="empty-state paper-panel">
      <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
      <h3>还没有角色</h3>
      <p>手动添加角色，或让 AI 从已有章节中自动扫描提取角色信息</p>
    </div>

    <!-- AI 扫描中 -->
    <div v-if="scanning" class="scanning-hint paper-panel">
      <div class="ai-spinner"></div>
      <span>AI 正在扫描章节内容，提取角色信息...</span>
    </div>

    <!-- 角色卡片网格 -->
    <p v-if="characters.length && !filteredChars.length" class="graph-hint">没有匹配的角色</p>
    <div class="char-grid" v-if="viewMode === 'grid' && filteredChars.length > 0">
      <div
        v-for="char in filteredChars"
        :key="char.id"
        class="char-card paper-panel"
        tabindex="0"
        role="button"
        :aria-label="`${char.name}，${char.identity || '未知身份'}`"
        @click="selectChar(char)"
        @keydown.enter="selectChar(char)"
        @keydown.space.prevent="selectChar(char)"
        :class="{ 'char-card--selected': selectedId === char.id }"
      >
        <CharacterAvatar :character="char" :size="96" :era="inferredEra" />
        <div class="char-info">
          <h3 class="char-name">{{ char.name }}</h3>
          <span class="char-identity">{{ char.identity || '未知身份' }}</span>
          <span class="char-status" :class="`status-${char.status}`">{{ char.status }}</span>
        </div>
        <div class="char-tags" v-if="char.faction || char.powerLevel">
          <span class="char-tag" v-if="char.faction">{{ char.faction }}</span>
          <span class="char-tag" v-if="char.powerLevel">{{ char.powerLevel }}</span>
        </div>
        <span v-if="entityIssueIds.has(char.id)" class="entity-source-alert">资料待核对</span>
        <p v-if="char.description" class="char-description">{{ char.description }}</p>
      </div>
    </div>

    <!-- 角色关系图谱 -->
    <div v-if="viewMode === 'graph' && filteredChars.length > 0 && !characterHistoryLoading && !characterHistoryError" class="relationship-graph">
      <div class="graph-controls"><n-button size="small" :aria-pressed="graphFit" @click="graphFit = true">适应画布</n-button><n-button size="small" :aria-pressed="!graphFit" @click="graphFit = false">100%</n-button></div>
      <div class="graph-scroll">
        <canvas ref="graphCanvas" :width="graphSize.width" :height="graphSize.height"
          :style="{ width: graphFit ? `min(100%, ${graphSize.width}px, ${65 * graphSize.width / graphSize.height}vh)` : `${graphSize.width}px`, height: 'auto' }" role="img" aria-label="人物关系图，下方按钮可查看各角色" @click="onGraphClick"></canvas>
      </div>
      <p v-if="filteredChars.length < 2" class="graph-hint">当前仅显示一个角色</p>
      <p v-else-if="relationshipEdges.length === 0" class="graph-hint">
        当前角色之间尚无已确认关系
      </p>
      <div v-else class="graph-legend" aria-live="polite">
        <span>已显示 {{ relationshipEdges.length }} 条关系</span>
      </div>
      <ul class="relationship-readable" aria-label="有效人物关系">
        <li v-for="(edge, index) in relationshipEdges" :key="index">{{ edge.source.name }} → {{ edge.target.name }}｜{{ edge.dimensionLabel }}：{{ edge.relation }}
          <small>{{ edge.origin === 'chapter' ? '正文已确认' : '作者基础设定' }}</small>
          <n-button v-if="edge.chapterId" size="tiny" @click="openSourceChapter(edge.chapterId)">查看证据</n-button>
        </li>
      </ul>
      <div class="graph-node-links">
        <n-button v-for="char in filteredChars" :key="char.id" size="tiny" @click="selectChar(char)">{{ char.name }}</n-button>
      </div>
    </div>

    </div>
    <!-- 角色详情面板 -->
    <aside v-if="showDetail && selectedChar" class="character-detail paper-panel" aria-label="角色详情">
      <header class="character-detail-heading"><h3>{{ selectedChar.name }}</h3><button type="button" aria-label="关闭角色详情" @click="showDetail = false">×</button></header>
        <template v-if="selectedChar">
          <div class="detail-panel">
            <p v-if="entityIssueIds.has(selectedChar.id)" class="entity-source-alert" role="alert">资料含待核对字段；原值保留供核对，AI 仅使用有效字段。</p>
            <CharacterAvatar :character="selectedChar" :size="88" :era="inferredEra" style="margin: 0 auto 12px;" />

            <div class="detail-field">
              <label>别称</label>
              <p>{{ selectedChar.aliases.join('、') || '无' }}</p>
            </div>
            <div class="detail-field">
              <label>身份</label>
              <p>{{ selectedChar.identity || '未设定' }}</p>
            </div>
            <div class="detail-field">
              <label>性格</label>
              <p>{{ selectedChar.personality || '未设定' }}</p>
            </div>
            <div class="detail-field">
              <label>实力</label>
              <p>{{ selectedChar.powerLevel || '未设定' }}</p>
            </div>
            <div class="detail-field">
              <label>阵营</label>
              <p>{{ selectedChar.faction || '未设定' }}</p>
            </div>
            <div class="detail-field">
              <label>状态</label>
              <p>{{ selectedChar.status }}</p>
            </div>
            <div class="detail-field" v-if="selectedChar.description">
              <label>详细描述</label>
              <p>{{ selectedChar.description }}</p>
            </div>
            <div class="detail-field" v-if="selectedRelations.length > 0 && !characterHistoryLoading && !characterHistoryError">
              <label>人物关系</label>
              <div v-for="(r, index) in selectedRelations" :key="index" class="relation-item">
                <strong>{{ r.source.name }} → {{ r.target.name }}</strong>｜{{ r.dimensionLabel }}：{{ r.relation }}
              </div>
            </div>
            <div class="detail-field" v-if="selectedChar.events.length > 0">
              <label>关键事件</label>
              <ul>
                <li v-for="(e, i) in selectedChar.events" :key="i">{{ e }}</li>
              </ul>
            </div>

            <!-- 出场章节追踪 -->
            <div class="detail-field">
              <label>出场章节</label>
              <div v-if="getAppearances(selectedChar).length > 0" class="appearance-list">
                <span
                  v-for="ch in getAppearances(selectedChar)" :key="ch.id"
                  class="appear-tag"
                >第{{ ch.chapterIndex + 1 }}章</span>
              </div>
              <p v-else>暂无已确认变化，请在章节分析中核对并确认角色候选。</p>
            </div>

            <section class="detail-field" aria-label="人物认知事实卡">
              <label>人物认知 · 所选章节结束时</label>
              <p>角色知道、怀疑、明确不知情和误信均为角色态度，不自动代表客观事实。相似文字不自动归并。</p>
              <article v-for="state in selectedKnowledge" :key="state.id" class="memory-fact-card">
                <strong>{{ describeCharacterState(novel!, { kind: 'knowledge', after: state }) }}</strong>
                <blockquote v-for="ref in state.evidence" :key="ref.id">{{ ref.quote }}</blockquote>
                <n-button v-for="ref in state.evidence" :key="'source-' + ref.id" text @click="openSourceChapter(ref.sourceId)">查看来源章节</n-button>
              </article>
              <p v-if="!selectedKnowledge.length">未记录；不能推断该角色明确不知情。</p>
            </section>
            <EntitySourceHistory
              v-if="novel"
              :novel="novel"
              kind="character"
              :entity="selectedChar"
              @open-chapter="openSourceChapter"
            />

            <div class="detail-actions">
              <n-button size="small" @click="editChar(selectedChar)">编辑</n-button>
              <n-popconfirm @positive-click="removeChar(selectedChar.id)">
                <template #trigger>
                  <n-button size="small" type="error" quaternary :loading="deletingCharacter" :disabled="deletingCharacter">删除</n-button>
                </template>
                确定删除此角色？关联此人物的基础关系、剧情线、场景和事件需先解除；已写章节需重新审核。
              </n-popconfirm>
            </div>
          </div>
        </template>
    </aside>
    </div>

    <!-- 添加/编辑弹窗 -->
    <n-modal v-model:show="showAddModal" preset="card" title="编辑角色资料" :closable="!savingEdit" :mask-closable="!savingEdit" :close-on-esc="!savingEdit" style="width:min(1040px,calc(100vw - 32px));max-height:90vh;overflow-y:auto;">
      <p role="status">输入会暂存为未提交草稿。关闭后可从角色库选择恢复。</p>
      <div v-if="formConflict" class="entity-source-alert" role="alert">
        {{ formConflict }}
        <details><summary>查看最新正式资料</summary><pre style="white-space: pre-wrap">{{ latestFormSource }}</pre></details>
        <details><summary>查看此草稿打开时资料</summary><pre style="white-space: pre-wrap">{{ formSession?.identity.openedBaseline }}</pre></details>
        <n-button :disabled="savingEdit" @click="openLatestCharacter">保留此草稿，打开最新资料</n-button>
      </div>
      <div class="char-form" :inert="savingEdit">
        <div class="char-profile"><div class="char-fields">
        <div class="char-form-field">
        <label>姓名 *</label>
        <n-input v-model:value="form.name" size="small" placeholder="角色姓名" />
        </div>
        <div class="char-form-field">
        <label>别称（逗号分隔）</label>
        <n-input v-model:value="form.aliasesText" size="small" placeholder="如：林少侠, 小林" />
        </div>
        <div class="char-form-field">
        <label>身份</label>
        <n-input v-model:value="form.identity" size="small" placeholder="如：天衍宗外门弟子" />
        </div>
        <div class="char-form-field">
        <label>性格</label>
        <n-input v-model:value="form.personality" size="small" placeholder="如：沉稳内敛，心思缜密" />
        </div>
        <div class="char-form-field">
        <label>实力</label>
        <n-input v-model:value="form.powerLevel" size="small" placeholder="如：炼气一层" />
        </div>
        <div class="char-form-field">
        <label>阵营</label>
        <n-input v-model:value="form.faction" size="small" placeholder="如：天衍宗" />
        </div>
        <div class="char-form-field">
        <label>状态</label>
        <n-select v-model:value="form.status" :options="statusOptions" size="small" />
        </div>
        <div class="char-form-field">
        <label>描述</label>
        <n-input v-model:value="form.description" type="textarea" :rows="3" size="small" placeholder="角色详细描述" />
        </div>
        </div>
          <div class="avatar-preview">
            <div class="avatar-preview-box">
              <CharacterAvatar :character="formCharacter" :size="96" :era="inferredEra" />
              <div v-if="selectedAvatar" class="avatar-preview-label">{{ selectedAvatar.label }}</div>
            </div>
            <n-button size="small" @click="form.avatarId = ''">自动匹配</n-button>
          </div>
        </div>
        <div class="avatar-picker"><h3>内置水墨头像</h3><p class="avatar-help">按时代、性别与身份挑选，保存后应用到角色。</p>
          <div class="avatar-filters">
            <n-button-group size="tiny" role="group" aria-label="头像时代">
              <n-button :aria-pressed="avatarFilterEra === ''" :type="avatarFilterEra === '' ? 'primary' : 'default'" @click="avatarFilterEra = ''">全部</n-button>
              <n-button :aria-pressed="avatarFilterEra === 'ancient'" :type="avatarFilterEra === 'ancient' ? 'primary' : 'default'" @click="avatarFilterEra = 'ancient'">古代</n-button>
              <n-button :aria-pressed="avatarFilterEra === 'modern'" :type="avatarFilterEra === 'modern' ? 'primary' : 'default'" @click="avatarFilterEra = 'modern'">现代</n-button>
            </n-button-group>
            <n-button-group size="tiny" role="group" aria-label="头像性别">
              <n-button :aria-pressed="avatarFilterGender === ''" :type="avatarFilterGender === '' ? 'primary' : 'default'" @click="avatarFilterGender = ''">全部</n-button>
              <n-button :aria-pressed="avatarFilterGender === 'female'" :type="avatarFilterGender === 'female' ? 'primary' : 'default'" @click="avatarFilterGender = 'female'">女性</n-button>
              <n-button :aria-pressed="avatarFilterGender === 'male'" :type="avatarFilterGender === 'male' ? 'primary' : 'default'" @click="avatarFilterGender = 'male'">男性</n-button>
            </n-button-group>
            <n-button-group size="tiny" role="group" aria-label="头像身份">
              <n-button :aria-pressed="avatarFilterCategory === ''" :type="avatarFilterCategory === '' ? 'primary' : 'default'" @click="avatarFilterCategory = ''">全部</n-button>
              <n-button :aria-pressed="avatarFilterCategory === 'main'" :type="avatarFilterCategory === 'main' ? 'primary' : 'default'" @click="avatarFilterCategory = 'main'">主角女主</n-button>
              <n-button :aria-pressed="avatarFilterCategory === 'villain'" :type="avatarFilterCategory === 'villain' ? 'primary' : 'default'" @click="avatarFilterCategory = 'villain'">反派</n-button>
              <n-button :aria-pressed="avatarFilterCategory === 'support'" :type="avatarFilterCategory === 'support' ? 'primary' : 'default'" @click="avatarFilterCategory = 'support'">配角</n-button>
              <n-button :aria-pressed="avatarFilterCategory === 'profession'" :type="avatarFilterCategory === 'profession' ? 'primary' : 'default'" @click="avatarFilterCategory = 'profession'">职业人物</n-button>
            </n-button-group>
          </div>
          <div v-if="filteredAvatars.length === 0" class="avatar-empty">无匹配头像 (共 {{ characterAvatars.length }} 个)</div>
          <div v-else class="avatar-grid" role="group" aria-label="内置水墨头像">
            <button
              v-for="av in filteredAvatars"
              :key="av.id"
              type="button"
              class="avatar-tile"
              :class="{ 'avatar-tile--selected': form.avatarId === av.id }"
              :aria-label="av.label"
              :aria-pressed="form.avatarId === av.id"
              @click="form.avatarId = av.id"
            >
              <CharacterAvatar :character="{ id: 'tile', name: av.label, identity: av.role, avatarId: av.id, avatarColor: 'var(--dai)' }" :size="64" :era="av.era" /><span class="avatar-tile-label">{{ av.label }}</span>
            </button>
          </div>
          <div class="avatar-count">显示 {{ filteredAvatars.length }} / {{ characterAvatars.length }} 个头像</div>
        </div>
        <p v-if="editingId" class="entity-source-note">保存当前表单中填写的字段后，会作为作者全局设定写入并覆盖角色对应设定。</p>
        <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
        <section class="char-relationships"><label>基础人物关系</label><p>作为故事的基础设定。章节中确认的变化按发生位置覆盖这些关系；移除基础关系不会删除章节变化历史。</p>
        <p>保存设定后，全书 {{ novel?.chapters.filter(chapter => chapter.content.trim()).length || 0 }} 个已写章节的旧审核将失效，需要重新审核。</p>
        <div v-for="(relation, index) in form.relationships" :key="index" class="relationship-form-row">
          <n-select v-model:value="relation.targetId" :options="relationTargetOptions" placeholder="关联角色" />
          <n-select v-model:value="relation.dimension" :options="dimensionOptions" placeholder="关系维度" />
          <n-input v-if="relation.dimension === 'custom'" v-model:value="relation.dimensionName" placeholder="自定义维度名称" />
          <n-input v-model:value="relation.relation" placeholder="关系描述" />
          <n-button size="small" @click="form.relationships.splice(index, 1)">移除</n-button>
        </div>
        <n-button size="small" @click="form.relationships.push({ targetId: '', targetName: '', relation: '', dimension: '', dimensionName: '' })">添加关系</n-button></section>
      </div>
      <template #action>
        <n-button :disabled="savingEdit" @click="showAddModal = false">关闭，保留草稿</n-button>
        <n-button type="primary" :loading="savingEdit" @click="saveChar" :disabled="savingEdit || !form.name.trim() || !!formConflict">确认保存角色</n-button>
      </template>
    </n-modal>
    <n-modal v-model:show="showRelationshipScan" preset="card" title="从正文提取关系候选" :mask-closable="!relationshipScanning" :closable="!relationshipScanning" style="width: 680px; max-width: 95vw;">
      <p>逐段分析所选章节的完整正文，结果保存到章节审核，确认后才成为有效关系。</p>
      <label>分析章节
        <select v-model="relationshipChapterId" aria-label="关系分析章节" :disabled="relationshipScanning || !!relationshipResult">
          <option v-for="chapter in relationshipChapters" :key="chapter.id" :value="chapter.id">第{{ chapter.chapterIndex + 1 }}章 {{ chapter.title }}</option>
        </select>
      </label>
      <p v-if="!relationshipChapters.length">先创建并撰写章节；没有正文时可编辑作者基础关系。</p>
      <p role="status">{{ relationshipProgress }}</p>
      <p v-if="relationshipError" role="alert" class="entity-source-alert">{{ relationshipError }}</p>
      <p v-if="relationshipResult">已收到 {{ relationshipResult.candidates.length }} 条候选，等待成功保存。</p>
      <template #footer>
        <div class="detail-actions">
          <n-button v-if="relationshipScanning && analysisController" @click="cancelAnalysis">停止分析</n-button>
          <n-button :disabled="relationshipScanning" @click="showRelationshipScan = false">关闭</n-button>
          <n-button v-if="relationshipResult" :loading="relationshipScanning" @click="saveScannedRelationships">重试保存候选</n-button>
          <n-button v-if="relationshipResult" :disabled="relationshipScanning" @click="discardCurrentScan('relationship')">放弃未保存候选</n-button>
          <n-button v-else type="primary" :loading="relationshipScanning" :disabled="!relationshipChapter?.content.trim() || characterHistoryLoading || !!characterHistoryError" @click="aiScanRelationships">分析所选章节</n-button>
        </div>
      </template>
    </n-modal>
  </div>
  </BookPage>
</template>

<script setup lang="ts">
import BookPage from '@/v3/components/BookPage.vue'
import { fitGraphText, placeGraphLabel, type GraphBox } from '@/services/relationshipGraphLayout'
import { ref, shallowRef, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEditorRecovery, type EditorDraftSession, type PendingEditorDraftVersion } from '@/composables/useEditorRecovery'
import EditorRecoveryPicker from '@/components/EditorRecoveryPicker.vue'
import type { CharacterEditorPayload, EditorDraft, EditorDraftPayload } from '@/types/editorRecovery'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NButtonGroup, NInput, NSelect, NModal, NPopconfirm, useMessage } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { callAI } from '@/services/ai'
import { parseAiJsonArray } from '@/utils/aiJson'
import type { Character } from '@/types/novel'
import CharacterAvatar from '@/components/CharacterAvatar.vue'
import CharacterStateHistory from '@/components/CharacterStateHistory.vue'
import EntitySourceHistory from '@/components/EntitySourceHistory.vue'
import StoryImpactHistory from '@/components/StoryImpactHistory.vue'
import { projectCanonicalEntities } from '@/services/entityProvenance'
import { getRelationshipProjection } from '@/services/relationshipProjection'
import { describeCharacterState, getCharacterStateSnapshot } from '@/services/reconstructionCharacterState'
import { assertRelationshipDimension, relationshipDimension, relationshipDimensionOptions } from '@/services/characterMemoryIdentity'
import { requestRelationshipCandidates } from '@/services/relationshipExtraction'
import type { CandidateChange } from '@/types/reconstruction'
import { buildAnalysisSourceVersionId, buildChapterAnalysisCandidates } from '@/services/reconstructionCandidates'
import { captureCharacterScanBaseline, characterScanChapters } from '@/services/characterScanTransactions'
import { assertStructuredOutputComplete } from '@/services/aiDiagnostics'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { characterAvatars, resolveCharacterAvatar, inferAvatarEra } from '@/data/characterAvatars'
import type { CharacterAvatarEra, CharacterAvatarGender } from '@/data/characterAvatars'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const reconstructionWorkspace = useReconstructionWorkspaceStore()
const editorRecovery = useEditorRecovery()
const { failures: recoveryFailures, pendingCount: recoveryPending } = editorRecovery
const formSession = shallowRef<EditorDraftSession | null>(null)
let characterScanSession: EditorDraftSession | null = null
let relationshipScanSession: EditorDraftSession | null = null
const recoveryBusy = ref(false)
const pendingInputDiscard = shallowRef<{ session: EditorDraftSession; expected: PendingEditorDraftVersion } | null>(null)
const recoveredPartial = ref<EditorDraft | null>(null)
const characterHistoryLoading = ref(false), characterHistoryError = ref('')
async function loadCharacterHistory() {
  const bookId = novelId.value
  characterHistoryLoading.value = true
  characterHistoryError.value = ''
  try { await reconstructionWorkspace.hydrateFromPersistence(bookId) }
  catch (error) { if (novelId.value === bookId) characterHistoryError.value = '人物状态读取失败：' + (error instanceof Error ? error.message : String(error)) }
  finally { if (novelId.value === bookId) characterHistoryLoading.value = false }
}
const configStore = useConfigStore()
const themeStore = useThemeStore()
const msg = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
watch(novelId, () => { void loadCharacterHistory() }, { immediate: true })
const characters = computed(() => novel.value?.characters || [])
const entityIssueIds = computed(() => new Set(novel.value ? projectCanonicalEntities(novel.value).issues.filter(issue => issue.entityType === 'character').map(issue => issue.entityId) : []))

const searchText = ref('')
const statusFilter = ref<string | null>(null)
const selectedId = ref('')
const showDetail = ref(false)
const showAddModal = ref(false)
const savingEdit = ref(false)
const saveError = ref('')
const scanning = ref(false)
const characterScanSaving = ref(false), characterScanError = ref('')
const characterScanResult = ref<{ novelId: string; baseline: string; candidates: CandidateChange[] } | null>(null)
let libraryMounted = true
const relationshipScanning = ref(false)
const editingId = ref('')
const editBaseline = ref('')
const viewMode = ref<'grid' | 'graph'>('grid')
const graphCanvas = ref<HTMLCanvasElement | null>(null)
const atlasImages = ref<Map<string, HTMLImageElement>>(new Map())
const avatarFilterEra = ref<CharacterAvatarEra | ''>('')
const avatarFilterGender = ref<CharacterAvatarGender | ''>('')
const avatarFilterCategory = ref<'' | 'main' | 'villain' | 'support' | 'profession'>('')
const showRelationshipScan = ref(false)
const relationshipChapterId = ref('')
const relationshipProgress = ref('')
const relationshipError = ref('')
const relationshipResult = ref<{ chapterId: string; sourceVersion: string; characterBaseline: string; candidates: CandidateChange[] } | null>(null)
const relationshipChapters = computed(() => (novel.value?.chapters || []).slice().sort((a, b) => a.chapterIndex - b.chapterIndex))
const relationshipChapter = computed(() => relationshipChapters.value.find(chapter => chapter.id === relationshipChapterId.value))
watch(relationshipChapters, chapters => {
  if (!chapters.some(chapter => chapter.id === relationshipChapterId.value)) relationshipChapterId.value = chapters[chapters.length - 1]?.id || ''
}, { immediate: true })
const relationshipProjection = computed(() => novel.value ? getRelationshipProjection(novel.value,
  reconstructionWorkspace.getCanonMutations(novelId.value), relationshipChapter.value?.chapterIndex) : { edges: [], invalid: [] })
let analysisController: AbortController | null = null
let graphPositions: Array<{ x: number; y: number; char: Character }> = []
const graphFit = ref(true)
const graphRings = computed(() => {
  const rings: Array<{ radius: number; count: number }> = []
  let remaining = Math.max(0, filteredChars.value.length - 1)
  let radius = 230
  while (remaining > 0) {
    const count = Math.min(remaining, Math.floor(2 * Math.PI * radius / 220))
    rings.push({ radius, count })
    remaining -= count
    radius += 210
  }
  return rings
})
const graphSize = computed(() => {
  const diameter = 2 * ((graphRings.value[graphRings.value.length - 1]?.radius || 0) + 140)
  return { width: Math.max(760, diameter), height: Math.max(600, diameter) }
})

function analysisSnapshot() {
  return JSON.stringify({ id: novelId.value, outline: novel.value?.outline, characters: characters.value, chapters: novel.value?.chapters })
}
function cancelAnalysis() {
  if (!analysisController) return
  analysisController?.abort()
  analysisController = null
  scanning.value = relationshipScanning.value = false
}
onBeforeUnmount(() => { libraryMounted = false; cancelAnalysis() })
watch(novelId, () => {
  cancelAnalysis(); formSession.value = null; characterScanSession = relationshipScanSession = null; recoveredPartial.value = null
  characterScanResult.value = null; characterScanError.value = ''; showRelationshipScan.value = false
  relationshipResult.value = null; showDetail.value = false; showAddModal.value = false
}, { flush: 'sync' })

const statusOptions = [
  { label: '活跃', value: '活跃' },
  { label: '退场', value: '退场' },
  { label: '死亡', value: '死亡' },
  { label: '失踪', value: '失踪' },
  { label: '待核对', value: '待核对' },
]

const form = ref({
  name: '', aliasesText: '', identity: '', personality: '',
  powerLevel: '', faction: '', status: '活跃' as Character['status'],
  description: '',
  relationships: [] as Array<Character['relationships'][number] & { dimension: string; dimensionName?: string }>,
  avatarId: '' as string,
})

function captureCharacterForm(): CharacterEditorPayload {
  return { ...form.value, relationships: form.value.relationships.map(row => ({
    targetId: row.targetId || '', targetName: row.targetName || '', relation: row.relation || '',
    dimension: row.dimension || '', dimensionName: row.dimensionName || '',
  })) }
}
watch(form, () => {
  if (!showAddModal.value || !formSession.value) return
  try { editorRecovery.queue(formSession.value, captureCharacterForm()) }
  catch (error) { saveError.value = error instanceof Error ? error.message : String(error) }
}, { deep: true, flush: 'sync' })
const recoverableDrafts = computed(() => reconstructionWorkspace.getEditorDrafts(novelId.value)
  .filter(draft => ['character-form', 'character-scan', 'relationship-scan'].includes(draft.kind))
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
function currentDraftBaseline(draft: Pick<EditorDraft, 'novelId' | 'kind' | 'targetId'>): string {
  const book = novelStore.getNovel(draft.novelId)
  if (!book) return '作品已不存在'
  if (draft.kind === 'character-form') return draft.targetId
    ? JSON.stringify(book.characters.find(character => character.id === draft.targetId) || null) : JSON.stringify(book.characters)
  if (draft.kind === 'character-scan') return captureCharacterScanBaseline(book)
  const chapter = book.chapters.find(row => row.id === draft.targetId)
  return JSON.stringify({ chapterId: draft.targetId, sourceVersion: chapter ? buildAnalysisSourceVersionId(chapter.content) : '', characterBaseline: JSON.stringify(book.characters) })
}
function recoveryConflict(draft: Pick<EditorDraft, 'novelId' | 'kind' | 'targetId' | 'openedBaseline'>): string {
  return currentDraftBaseline(draft) === draft.openedBaseline ? '' : '来源资料已变化。原基线和输入仍保留，请与最新资料核对；旧输入不能直接覆盖正式内容。'
}
const formConflict = computed(() => formSession.value ? recoveryConflict(formSession.value.identity) : '')
const latestFormSource = computed(() => formSession.value ? currentDraftBaseline(formSession.value.identity) : '')
function startNewCharacter() {
  resetForm()
  formSession.value = editorRecovery.begin({ novelId: novelId.value, kind: 'character-form', scope: 'character:new', openedBaseline: JSON.stringify(characters.value) })
  showAddModal.value = true
}
function openLatestCharacter() {
  const current = characters.value.find(character => character.id === editingId.value)
  if (current) editChar(current)
  else startNewCharacter()
}
async function retryEditorInput() {
  try { await editorRecovery.retryAll() } catch (error) { msg.error(error instanceof Error ? error.message : String(error)) }
}
async function discardPendingEditorInput() {
  const request = pendingInputDiscard.value
  if (!request) return
  recoveryBusy.value = true
  try {
    await editorRecovery.discardPending(request.session, request.expected)
    if (formSession.value === request.session) { formSession.value = null; showAddModal.value = false }
    if (characterScanSession === request.session) { characterScanSession = null; characterScanResult.value = null }
    if (relationshipScanSession === request.session) { relationshipScanSession = null; relationshipResult.value = null }
    pendingInputDiscard.value = null
  } catch (error) { msg.error(error instanceof Error ? error.message : String(error)) }
  finally { recoveryBusy.value = false }
}
async function forkEditorInput(session: EditorDraftSession) {
  try {
    const next = await editorRecovery.fork(session)
    if (formSession.value === session) formSession.value = next
    if (characterScanSession === session) characterScanSession = next
    if (relationshipScanSession === session) relationshipScanSession = next
    msg.success('当前输入已另存，原始基线与已有版本保留')
  } catch (error) { msg.error(error instanceof Error ? error.message : String(error)) }
}
function restoreEditorInput(draft: EditorDraft) {
  try {
    if (draft.novelId !== novelId.value) throw new Error('请在草稿所属作品中恢复。')
    const session = editorRecovery.restore(draft)
    if (draft.kind === 'character-form') {
      resetForm()
      const payload = JSON.parse(JSON.stringify(draft.payload)) as CharacterEditorPayload
      form.value = { ...payload, status: payload.status as Character['status'] }
      editingId.value = draft.targetId || ''
      editBaseline.value = draft.openedBaseline
      formSession.value = session
      showAddModal.value = true
    } else if (draft.payload?.state === 'ready') {
      const candidates = JSON.parse(JSON.stringify(draft.payload.candidates)) as CandidateChange[]
      if (draft.kind === 'character-scan') {
        characterScanSession = session
        characterScanResult.value = { novelId: draft.novelId, baseline: draft.openedBaseline, candidates }
        characterScanError.value = recoveryConflict(draft)
      } else {
        relationshipScanSession = session
        const payload = draft.payload
        relationshipChapterId.value = payload.chapterId as string
        relationshipResult.value = { chapterId: payload.chapterId as string, sourceVersion: payload.sourceVersion as string,
          characterBaseline: payload.characterBaseline as string, candidates }
        relationshipError.value = recoveryConflict(draft)
        showRelationshipScan.value = true
      }
    } else recoveredPartial.value = draft
  } catch (error) { msg.error(error instanceof Error ? error.message : String(error)) }
}
async function discardEditorInput(draft: EditorDraft) {
  recoveryBusy.value = true
  try {
    await editorRecovery.discard(draft)
    if (formSession.value?.identity.id === draft.id && !formSession.value.running
      && formSession.value.sequence === formSession.value.savedSequence) { formSession.value = null; showAddModal.value = false }
    if (characterScanSession?.identity.id === draft.id) { characterScanSession = null; characterScanResult.value = null }
    if (relationshipScanSession?.identity.id === draft.id) { relationshipScanSession = null; relationshipResult.value = null }
    if (recoveredPartial.value?.id === draft.id) recoveredPartial.value = null
  } catch (error) { msg.error(error instanceof Error ? error.message : String(error)) }
  finally { recoveryBusy.value = false }
}
async function discardCurrentScan(kind: 'character' | 'relationship') {
  const session = kind === 'character' ? characterScanSession : relationshipScanSession
  if (!session) return
  try {
    const checkpoint = await editorRecovery.flushSession(session)
    if (checkpoint) await discardEditorInput(checkpoint)
  } catch (error) { msg.error(error instanceof Error ? error.message : String(error)) }
}

const formCharacter = computed(() => ({
  id: editingId.value || 'preview',
  name: form.value.name || '预览',
  identity: form.value.identity,
  avatarId: form.value.avatarId || undefined,
  avatarColor: 'var(--dai)',
}))

const inferredEra = computed<CharacterAvatarEra>(() => {
  if (!novel.value) return 'ancient'
  const worldText = [novel.value.genre, novel.value.subGenre, novel.value.genreLabel, novel.value.settings?.worldBuilding?.worldType].filter(Boolean).join(' ')
  return inferAvatarEra(worldText)
})

const filteredAvatars = computed(() => {
  let list = characterAvatars
  if (avatarFilterEra.value) list = list.filter(av => av.era === avatarFilterEra.value)
  if (avatarFilterGender.value) list = list.filter(av => av.gender === avatarFilterGender.value)
  if (avatarFilterCategory.value === 'main') list = list.filter(av => av.category === 'heroine' || av.category === 'protagonist')
  else if (avatarFilterCategory.value === 'profession') list = list.filter(av => !['heroine', 'protagonist', 'villain', 'support'].includes(av.category))
  else if (avatarFilterCategory.value) list = list.filter(av => av.category === avatarFilterCategory.value)
  return list
})

const selectedAvatar = computed(() => {
  if (!form.value.avatarId) return null
  return characterAvatars.find(av => av.id === form.value.avatarId) || null
})

const filteredChars = computed(() => {
  let list = viewMode.value === 'graph' && novel.value
    ? projectCanonicalEntities(novel.value, relationshipChapter.value ? relationshipChapter.value.chapterIndex + 1 : undefined).characters
      .filter(character => !relationshipChapter.value || character.firstAppearChapter <= relationshipChapter.value.chapterIndex)
    : characters.value
  if (searchText.value) {
    const q = searchText.value.toLowerCase()
    list = list.filter(c => c.name.toLowerCase().includes(q) || c.identity.toLowerCase().includes(q) || c.aliases.some(a => a.toLowerCase().includes(q)))
  }
  if (statusFilter.value) {
    list = list.filter(c => c.status === statusFilter.value)
  }
  return list
})

const selectedChar = computed(() => characters.value.find(c => c.id === selectedId.value))
const relationTargetOptions = computed(() => characters.value.filter(char => char.id !== editingId.value).map(char => ({ label: char.name, value: char.id })))
const selectedRelations = computed(() => relationshipProjection.value.edges.filter(edge => edge.source.id === selectedId.value || edge.target.id === selectedId.value))
const dimensionOptions = [...relationshipDimensionOptions, { value: 'custom', label: '自定义维度' }]
const selectedKnowledge = computed(() => novel.value ? getCharacterStateSnapshot(novel.value, reconstructionWorkspace.getCanonMutations(novelId.value), relationshipChapter.value?.chapterIndex ?? -1, 'through').knowledge.filter(state => state.characterId === selectedId.value) : [])
const relationshipEdges = computed(() => {
  const ids = new Set(filteredChars.value.map(char => char.id))
  return relationshipProjection.value.edges.filter(edge => ids.has(edge.source.id) && ids.has(edge.target.id))
})

function selectChar(char: Character) {
  selectedId.value = char.id
  showDetail.value = true
}
watch([() => route.query?.character, characters], () => {
  const target = characters.value.find(character => character.id === route.query?.character)
  if (target) { searchText.value = ''; statusFilter.value = null; selectChar(target) }
}, { immediate: true })

function openSourceChapter(chapterId: string) {
  router.push(`/write/${novelId.value}/${chapterId}`)
}

function editChar(char: Character) {
  formSession.value = null
  avatarFilterEra.value = ''
  avatarFilterGender.value = ''
  avatarFilterCategory.value = ''
  editingId.value = char.id
  editBaseline.value = JSON.stringify(char)
  saveError.value = ''
  form.value = {
    name: char.name,
    aliasesText: char.aliases.join('、'),
    identity: char.identity,
    personality: char.personality,
    powerLevel: char.powerLevel,
    faction: char.faction,
    status: char.status,
    description: char.description,
    relationships: char.relationships.map(relation => {
      const dimension = relationshipDimension((relation as { dimension?: string }).dimension)
      return { ...relation, dimension: dimension.startsWith('custom:') ? 'custom' : dimension, dimensionName: dimension.startsWith('custom:') ? dimension.slice(7) : '' }
    }),
    avatarId: char.avatarId || '',
  }
  formSession.value = editorRecovery.begin({ novelId: novelId.value, kind: 'character-form', scope: 'character:' + char.id,
    targetId: char.id, openedBaseline: editBaseline.value })
  showDetail.value = false
  showAddModal.value = true
}

async function saveChar() {
  if (savingEdit.value) return
  const session = formSession.value
  if (!session || session.identity.novelId !== novelId.value) return
  try {
    const keys = new Set<string>()
    for (const relation of form.value.relationships) {
      const dimension = assertRelationshipDimension(relation.dimension === 'custom' ? 'custom:' + (relation.dimensionName || '').trim() : relation.dimension)
      const key = JSON.stringify([relation.targetId, dimension])
      if (keys.has(key)) throw new Error('同方向同维度只能保留一条基础关系；不同维度可以并存。')
      keys.add(key)
    }
  } catch (cause) { saveError.value = (cause as Error).message; msg.error(saveError.value); return }
  if (form.value.relationships.some(relation => !relation.relation.trim() || !characters.value.some(character => character.id === relation.targetId)
    || relation.targetId === editingId.value)) {
    saveError.value = '请为每条基础关系选择有效的其他角色并填写关系；空行请先移除。'
    msg.error(saveError.value)
    return
  }
  savingEdit.value = true
  saveError.value = ''
  try {
    editorRecovery.queue(session, captureCharacterForm())
    const checkpoint = await editorRecovery.flushSession(session)
    if (!checkpoint) throw new Error('表单尚未保存，请重试暂存。')
    await reconstructionWorkspace.commitCharacterEditorDraft(checkpoint)
    if (libraryMounted && formSession.value === session && novelId.value === session.identity.novelId) {
      if (!session.running && session.sequence === session.savedSequence && session.version.operationId === checkpoint.lastOperationId) {
        resetForm()
        showAddModal.value = false
        msg.success('角色已保存，匹配版本的表单草稿已清理')
      } else msg.info('已确认的版本已保存；之后的新输入仍保留，请核对后另存草稿。')
    }
  } catch (error) {
    if (libraryMounted && formSession.value === session) {
      saveError.value = error instanceof Error ? error.message : '角色保存失败，请重试'
      msg.error(saveError.value)
    }
  } finally {
    savingEdit.value = false
  }
}

const deletingCharacter = ref(false)
async function removeChar(id: string) {
  if (deletingCharacter.value) return false
  deletingCharacter.value = true
  try {
    await novelStore.deleteCharacter(novelId.value, id)
    showDetail.value = false
    if (selectedId.value === id) selectedId.value = ''
    msg.success('已删除，已写章节需重新审核')
    return true
  } catch (error) {
    msg.error(error instanceof Error ? error.message : '删除失败，请重试')
    return false
  } finally {
    deletingCharacter.value = false
  }
}

function resetForm() {
  formSession.value = null
  editingId.value = ''
  editBaseline.value = ''
  saveError.value = ''
  form.value = { name: '', aliasesText: '', identity: '', personality: '', powerLevel: '', faction: '', status: '活跃', description: '', relationships: [], avatarId: '' }
  avatarFilterEra.value = ''
  avatarFilterGender.value = ''
  avatarFilterCategory.value = ''
}

// AI 扫描角色
async function aiScanCharacters() {
  if (!novel.value || scanning.value || relationshipScanning.value || characterScanSaving.value || characterScanResult.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.error('未配置 AI 模型'); return }
  if (!novel.value.chapters.some(c => c.content.length > 100)) {
    msg.warning('请先写一些章节内容，AI 才能扫描角色')
    return
  }

  scanning.value = true
  const request = new AbortController()
  analysisController = request
  const source = JSON.parse(JSON.stringify(novel.value)) as typeof novel.value
  const baseline = captureCharacterScanBaseline(source)
  const bookId = novelId.value
  const scanSession = editorRecovery.begin({ novelId: bookId, kind: 'character-scan', scope: 'character:scan', openedBaseline: baseline })
  characterScanSession = scanSession
  let result = '', scanPersisted = false
  characterScanError.value = ''
  try {
    editorRecovery.queue(scanSession, { state: 'partial', rawOutput: '', candidates: [] })
    await editorRecovery.flushSession(scanSession)
    request.signal.throwIfAborted()
    if (analysisController !== request || novelId.value !== bookId) return
    // 收集前 5 章内容做扫描
    const sourceChapters = characterScanChapters(source)
    const chapTexts = sourceChapters
      .map(c => `【${c.title}；chapterId=${c.id}】\n${c.content.substring(0, 1000)}`)
      .join('\n\n---\n\n')

    const messages = [{
      role: 'system' as const,
      content: '你是一个小说角色分析助手。请从章节内容中提取所有出场角色信息。',
    }, {
      role: 'user' as const,
      content: `请从以下章节中提取所有出场角色，以 JSON 数组格式返回。

${chapTexts}

【输出格式】
只输出 JSON 数组，不要其他内容。每个角色必须有上方的 chapterId 和该章节展示内容中连续出现的 evidence 原句；不确定的字段留空，不得从推测补充：
[
  {
    "name": "角色名",
    "chapterId": "来源章节ID",
    "evidence": "该章展示内容中的原文连续引文",
    "identity": "身份",
    "personality": "性格",
    "powerLevel": "实力",
    "faction": "阵营",
    "description": "简介",
    "relationships": [
      { "targetName": "另一个已出场角色", "relation": "关系描述" }
    ]
  }
]`,
    }]

    const response = await callAI({ model: { ...model }, messages, signal: request.signal, noAutomaticRetry: true, skillTask: 'planning', stream: true, onChunk: (c) => {
      if (request.signal.aborted) return
      result += c
      editorRecovery.queue(scanSession, { state: 'partial', rawOutput: result, candidates: [] })
    } })
    if (analysisController !== request || request.signal.aborted) return
    result = response.content || result
    editorRecovery.queue(scanSession, { state: 'partial', rawOutput: result, candidates: [] })
    if (novelId.value !== bookId || !novel.value || baseline !== captureCharacterScanBaseline(novel.value)) { msg.warning('资料已变化，请重新扫描'); return }
    assertStructuredOutputComplete(response, '角色扫描')

    const parsed = parseAiJsonArray<any>(response.content || result)
    if (parsed.length > 0) {
      const candidates = sourceChapters.flatMap(chapter => buildChapterAnalysisCandidates(source, chapter, buildAnalysisSourceVersionId(chapter.content), {
        characters: parsed.filter(item => item && item.chapterId === chapter.id && typeof item.name === 'string' && item.name.trim()
          && typeof item.evidence === 'string' && item.evidence.trim() && chapter.content.slice(0, 1000).includes(item.evidence)
          && chapter.content.indexOf(item.evidence) === chapter.content.lastIndexOf(item.evidence)),
      })).map(candidate => ({ ...candidate, id: candidate.id + ':library-scan:' + buildAnalysisSourceVersionId(candidate.proposedValue) }))
      if (!candidates.length) { msg.warning('没有可核对的角色原文证据，请到具体章节重新分析'); return }
      characterScanResult.value = { novelId: bookId, baseline, candidates }
      editorRecovery.queue(scanSession, JSON.parse(JSON.stringify({ state: 'ready', rawOutput: result, candidates })) as EditorDraftPayload)
      await editorRecovery.flushSession(scanSession)
      scanPersisted = true
    } else {
      msg.warning('AI 返回格式异常，请手动添加')
    }
  } catch (err: any) {
    if (!request.signal.aborted) msg.error(err.message || 'AI 扫描失败')
  } finally {
    if (scanSession.latest?.state === 'partial') {
      try { editorRecovery.queue(scanSession, { ...scanSession.latest, outcome: request.signal.aborted ? 'interrupted' : 'incomplete' }) }
      catch { /* At capacity, retain the already queued partial payload and still release the request. */ }
    }
    if (analysisController === request) cancelAnalysis()
  }
  if (scanPersisted && libraryMounted && novelId.value === bookId && characterScanResult.value && characterScanSession === scanSession) await saveScannedCharacters()
}

async function saveScannedCharacters() {
  const result = characterScanResult.value
  const session = characterScanSession
  if (!result || result.novelId !== novelId.value || characterScanSaving.value || scanning.value) return
  characterScanSaving.value = true
  characterScanError.value = ''
  try {
    if (!session) throw new Error('请先恢复对应扫描草稿。')
    const checkpoint = await editorRecovery.flushSession(session)
    if (!checkpoint) throw new Error('扫描结果尚未落盘，请重试保存草稿。')
    const added = await reconstructionWorkspace.saveCharacterScanCandidates(result.novelId, result.baseline, result.candidates, checkpoint)
    if (!libraryMounted || novelId.value !== result.novelId || characterScanResult.value !== result) return
    characterScanResult.value = null
    characterScanSession = null
    msg.success(added ? '已保存 ' + added + ' 条角色候选，请在章节审核中确认后入库' : '这些角色候选已保存，原有作者决定保持不变')
    openSourceChapter(result.candidates[0].chapterId!)
  } catch (error) {
    if (libraryMounted && novelId.value === result.novelId && characterScanResult.value === result) {
      characterScanError.value = error instanceof Error ? error.message : '角色候选保存失败，请重试'
      msg.error(characterScanError.value)
    }
  } finally { characterScanSaving.value = false }
}

async function saveScannedRelationships() {
  if (!relationshipResult.value || relationshipScanning.value) return
  const result = relationshipResult.value, bookId = novelId.value
  const session = relationshipScanSession
  relationshipScanning.value = true
  relationshipError.value = ''
  try {
    if (!session || session.identity.novelId !== bookId) throw new Error('请先恢复对应关系扫描草稿。')
    const checkpoint = await editorRecovery.flushSession(session)
    if (!checkpoint) throw new Error('关系扫描结果尚未落盘，请重试保存草稿。')
    const count = await reconstructionWorkspace.saveRelationshipCandidates(bookId, result.chapterId, result.sourceVersion, result.characterBaseline, result.candidates, checkpoint)
    if (!libraryMounted || novelId.value !== bookId || relationshipResult.value !== result) return
    relationshipResult.value = null
    relationshipScanSession = null
    showRelationshipScan.value = false
    msg.success('已保存 ' + count + ' 条关系候选，请在章节审核中确认')
    openSourceChapter(result.chapterId)
  } catch (error) {
    if (novelId.value === bookId) relationshipError.value = error instanceof Error ? error.message : '候选保存失败，请重试'
  } finally { relationshipScanning.value = false }
}
async function aiScanRelationships() {
  if (!novel.value || !relationshipChapter.value?.content.trim() || relationshipScanning.value || scanning.value || relationshipResult.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.error('未配置 AI 模型'); return }
  const request = new AbortController(), bookId = novelId.value
  const source = JSON.parse(JSON.stringify(novel.value)) as typeof novel.value
  const chapter = source.chapters.find(row => row.id === relationshipChapterId.value)!
  const snapshot = analysisSnapshot()
  const scanPayload = { chapterId: chapter.id, sourceVersion: buildAnalysisSourceVersionId(chapter.content), characterBaseline: JSON.stringify(source.characters) }
  const scanSession = editorRecovery.begin({ novelId: bookId, kind: 'relationship-scan', scope: 'relationship:scan:' + chapter.id,
    targetId: chapter.id, openedBaseline: JSON.stringify(scanPayload) })
  relationshipScanSession = scanSession
  let scanPersisted = false
  const ensureCurrent = () => {
    request.signal.throwIfAborted()
    if (analysisController !== request || novelId.value !== bookId || snapshot !== analysisSnapshot()) throw new Error('正文或角色资料已变化，请重新扫描关系。')
  }
  analysisController = request
  relationshipScanning.value = true
  relationshipResult.value = null
  relationshipError.value = ''
  relationshipProgress.value = '准备分析完整章节…'
  try {
    editorRecovery.queue(scanSession, { ...scanPayload, state: 'partial', rawOutput: '', candidates: [] })
    await editorRecovery.flushSession(scanSession)
    ensureCurrent()
    const candidates = await requestRelationshipCandidates({ novel: source, chapter, model, signal: request.signal, ensureCurrent,
      onProgress: (completed, total) => { relationshipProgress.value = '已检查 ' + completed + '/' + total + ' 段原文' } })
    ensureCurrent()
    if (!candidates.length) { msg.info('本章未发现有明确证据的人物关系变化'); return }
    relationshipResult.value = { chapterId: chapter.id, sourceVersion: buildAnalysisSourceVersionId(chapter.content), characterBaseline: JSON.stringify(source.characters), candidates }
    editorRecovery.queue(scanSession, JSON.parse(JSON.stringify({ ...scanPayload, state: 'ready', rawOutput: '', candidates })) as EditorDraftPayload)
    await editorRecovery.flushSession(scanSession)
    scanPersisted = true
  } catch (error) {
    if (!request.signal.aborted && novelId.value === bookId) relationshipError.value = error instanceof Error ? error.message : '关系分析失败'
  } finally {
    if (scanSession.latest?.state === 'partial') {
      try { editorRecovery.queue(scanSession, { ...scanSession.latest, outcome: request.signal.aborted ? 'interrupted' : 'incomplete' }) }
      catch { /* The prior partial draft remains available even if terminal metadata exceeds capacity. */ }
    }
    if (analysisController === request) { analysisController = null; relationshipScanning.value = false }
  }
  if (scanPersisted && libraryMounted && novelId.value === bookId && relationshipScanSession === scanSession && relationshipResult.value && !request.signal.aborted) await saveScannedRelationships()
}

// 角色出场追踪
function getAppearances(char: Character) {
  if (!novel.value) return []
  return novel.value.chapters.filter(ch => {
    const text = ch.content || ''
    return text.includes(char.name) || char.aliases.some(a => text.includes(a))
  })
}

// 关系图谱绘制
function drawRelationshipGraph() {
  const canvas = graphCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const chars = filteredChars.value
  const n = chars.length
  const cx = w / 2
  const cy = h / 2
  const focusIndex = Math.max(0, chars.findIndex(char => char.id === selectedId.value))
  const positions: { x: number; y: number }[] = Array.from({ length: n }, () => ({ x: cx, y: cy }))
  const others = chars.map((_, index) => index).filter(index => index !== focusIndex)
  let offset = 0
  for (const ring of graphRings.value) {
    for (let index = 0; index < ring.count; index++) {
      const angle = 2 * Math.PI * index / ring.count - Math.PI / 2
      positions[others[offset++]] = { x: cx + ring.radius * Math.cos(angle), y: cy + ring.radius * Math.sin(angle) }
    }
  }
  graphPositions = positions.map((position, index) => ({ ...position, char: chars[index] }))
  const styles = getComputedStyle(canvas)
  const textColor = styles.getPropertyValue('--text-color-primary').trim() || '#333'
  const surface = styles.getPropertyValue('--bg-color-card').trim() || '#fff'

  ctx.strokeStyle = '#9aa4b2'
  ctx.lineWidth = 1.5
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'

  const occupiedLabels: GraphBox[] = positions.map((point, index) => {
    const radius = index === focusIndex ? 52 : 40
    return { x: point.x - 86, y: point.y - radius - 6, width: 172, height: radius * 2 + 62 }
  })
  for (const edge of relationshipEdges.value) {
    const i = chars.findIndex(char => char.id === edge.source.id)
    const j = chars.findIndex(char => char.id === edge.target.id)
    if (i >= 0 && j >= 0) {
        const p1 = positions[i]
        const p2 = positions[j]
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.strokeStyle = '#9aa4b2'
        ctx.lineWidth = 2
        ctx.stroke()
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
        const radius = j === focusIndex ? 56 : 44
        const tip = { x: p2.x - Math.cos(angle) * radius, y: p2.y - Math.sin(angle) * radius }
        ctx.beginPath()
        ctx.moveTo(tip.x - Math.cos(angle - 0.45) * 12, tip.y - Math.sin(angle - 0.45) * 12)
        ctx.lineTo(tip.x, tip.y)
        ctx.lineTo(tip.x - Math.cos(angle + 0.45) * 12, tip.y - Math.sin(angle + 0.45) * 12)
        ctx.stroke()
        const label = fitGraphText(edge.dimensionLabel + '：' + edge.relation, 150, text => ctx.measureText(text).width)
        const box = placeGraphLabel(p1, p2, ctx.measureText(label).width + 14, occupiedLabels, { x: w, y: h })
        if (box && label) {
          ctx.fillStyle = surface
          ctx.fillRect(box.x, box.y, box.width, box.height)
          ctx.fillStyle = textColor
          ctx.fillText(label, box.x + box.width / 2, box.y + 14)
          occupiedLabels.push(box)
        }
    }
  }

  for (let i = 0; i < n; i++) {
    const char = chars[i]
    const p = positions[i]
    const nodeRadius = i === focusIndex ? 52 : 40
    const avatar = resolveCharacterAvatar(char, { era: inferredEra.value })
    if (avatar) {
      const img = atlasImages.value.get(avatar.src)
      if (img && img.complete && img.naturalWidth > 0) {
        const tileW = img.naturalWidth / 4
        const tileH = img.naturalHeight / 4
        const sx = avatar.col * tileW
        const sy = avatar.row * tileH
        ctx.save()
        ctx.beginPath()
        ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI)
        ctx.clip()
        ctx.drawImage(img, sx, sy, tileW, tileH, p.x - nodeRadius, p.y - nodeRadius, nodeRadius * 2, nodeRadius * 2)
        ctx.restore()
        ctx.beginPath()
        ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI)
        ctx.strokeStyle = styles.getPropertyValue(i === focusIndex ? '--color-primary' : '--color-accent').trim()
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI)
        ctx.fillStyle = char.avatarColor || '#e0e0e0'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(char.name[0] || '?', p.x, p.y + 5)
      }
    } else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, nodeRadius, 0, 2 * Math.PI)
      ctx.fillStyle = char.avatarColor || '#e0e0e0'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(char.name[0] || '?', p.x, p.y + 5)
    }
    ctx.fillStyle = textColor
    ctx.font = '600 17px serif'
    const name = fitGraphText(char.name, 156, text => ctx.measureText(text).width)
    const nameWidth = ctx.measureText(name).width
    ctx.fillStyle = surface
    ctx.fillRect(p.x - nameWidth / 2 - 3, p.y + nodeRadius + 8, nameWidth + 6, 22)
    ctx.fillStyle = textColor
    ctx.fillText(name, p.x, p.y + nodeRadius + 26)
    ctx.font = '12px sans-serif'
    const identity = fitGraphText(char.identity || '', 156, text => ctx.measureText(text).width)
    ctx.fillStyle = surface
    ctx.fillRect(p.x - 84, p.y + nodeRadius + 30, 168, 21)
    ctx.fillStyle = textColor
    ctx.fillText(identity, p.x, p.y + nodeRadius + 46)
  }
}

function loadAtlasImage(src: string) {
  if (atlasImages.value.has(src)) return
  const img = new Image()
  img.onload = () => {
    if (viewMode.value === 'graph') nextTick(drawRelationshipGraph)
  }
  img.onerror = () => {
    atlasImages.value.delete(src)
  }
  img.src = src
  atlasImages.value.set(src, img)
}

function preloadAllAtlases() {
  const srcs = new Set(characterAvatars.map(av => av.src))
  srcs.forEach(src => loadAtlasImage(src))
}

function onGraphClick(event: MouseEvent) {
  const canvas = graphCanvas.value
  if (!canvas) return
  const bounds = canvas.getBoundingClientRect()
  const x = (event.clientX - bounds.left) * canvas.width / bounds.width
  const y = (event.clientY - bounds.top) * canvas.height / bounds.height
  const node = graphPositions.find(position => Math.hypot(position.x - x, position.y - y) <= (position.char.id === selectedId.value || (!selectedId.value && position.char.id === filteredChars.value[0]?.id) ? 52 : 40))
  if (node) selectChar(node.char)
}

// 监听视图切换绘制图谱
watch(viewMode, (val) => {
  if (val === 'graph') {
    preloadAllAtlases()
    nextTick(() => drawRelationshipGraph())
  }
})

onBeforeUnmount(() => {
  atlasImages.value.forEach(img => {
    img.onload = null
    img.onerror = null
  })
  atlasImages.value.clear()
})

watch(filteredChars, () => {
  graphPositions = []
  if (viewMode.value === 'graph') {
    nextTick(() => drawRelationshipGraph())
  }
}, { deep: true })
watch(relationshipEdges, () => { if (viewMode.value === 'graph') nextTick(drawRelationshipGraph) }, { deep: true })
watch(() => themeStore.currentTheme, () => { if (viewMode.value === 'graph') nextTick(drawRelationshipGraph) })
watch(inferredEra, () => { if (viewMode.value === 'graph') nextTick(drawRelationshipGraph) })
watch(selectedId, () => { if (viewMode.value === 'graph') nextTick(drawRelationshipGraph) })
</script>

<style scoped>
.entity-source-alert { color: var(--jin); background: var(--paper); padding: 6px 8px; border-radius: 6px; font-size: 12px; line-height: 1.6; }
.relationship-boundary { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin: 12px 0; font-size: 13px; line-height: 1.7; }
.relationship-boundary select, label select { max-width: 100%; color: var(--ink); background: var(--paper); border: 1px solid var(--line-2); border-radius: 6px; padding: 6px; }
.relationship-readable { display: grid; gap: 8px; padding: 12px 24px; line-height: 1.7; overflow-wrap: anywhere; }
.relationship-readable small { margin: 0 8px; color: var(--ink-2); }
.chars-header {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 12px;
  margin-bottom: var(--space-lg);
}
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.filter-bar {
  display: flex; gap: 12px; margin-bottom: var(--space-md); align-items: center;
}

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 40vh; gap: 12px; text-align: center;
}
.empty-icon { font-size: 48px; }
.empty-icon { color: var(--ink-3); width: 220px; }
.empty-state h3 { font-family: var(--f-serif); font-size: 18px; color: var(--ink); }
.empty-state p { font-size: 14px; color: var(--ink-3); }

.scanning-hint {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 40px; font-size: 14px; color: var(--dai);
  border: 1px solid var(--line-2); border-left: 3px solid var(--dai);
}

/* 角色网格 */
.char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-md);
}

@media (min-width: 1280px) {
  .char-grid { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
}
@media (min-width: 1440px) {
  .char-grid { grid-template-columns: repeat(3, 1fr); }
}

.char-card {
  cursor: pointer;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 14px;
  align-items: start;
  padding: 16px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast), background-color var(--motion-fast);
}
.char-card:hover,
.char-card:focus-visible { border-color: var(--ink-3); box-shadow: var(--shadow-2); outline: none; }
.char-card--selected {
  border-color: var(--zhu);
  background: var(--zhu-soft);
  box-shadow: inset 3px 0 0 var(--zhu);
}

.char-info { grid-row: span 2; }

.char-info { margin-bottom: 8px; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.char-name { font-family: var(--f-serif); font-size: 16px; font-weight: 700; color: var(--ink); margin-bottom: 2px; }
.char-identity { font-size: 12px; color: var(--ink-3); display: block; margin-bottom: 6px; }
.char-status {
  font-size: 11px; padding: 1px 8px; border-radius: 100px;
  display: inline-block;
  border: 1px solid currentColor;
}
.status-活跃 { color: var(--qing); background: color-mix(in srgb, var(--qing) 9%, transparent); }
.status-退场 { color: var(--jin); background: color-mix(in srgb, var(--jin) 9%, transparent); }
.status-死亡 { color: var(--zhu); background: color-mix(in srgb, var(--zhu) 9%, transparent); }
.status-失踪 { color: var(--dai); background: var(--dai-soft); }
.status-待核对 { color: var(--jin); background: color-mix(in srgb, var(--jin) 9%, transparent); }

.char-tags { grid-column: 2; display: flex; gap: 4px; flex-wrap: wrap; }
.char-tag {
  font-size: 11px; padding: 1px 8px; border-radius: var(--r-s);
  border: 1px solid var(--line-2);
  background: var(--panel-2); color: var(--ink-2);
}

/* 详情面板 */
.detail-panel { display: flex; flex-direction: column; gap: 14px; }

.detail-field {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.detail-field:last-of-type { border-bottom: 0; }
.detail-field label { font-family: var(--f-serif); font-size: 13px; font-weight: 700; color: var(--ink); display: block; margin-bottom: 4px; }
.detail-field p { font-size: 13px; color: var(--ink-2); line-height: 1.6; margin: 0; }
.relation-item { grid-column: 1 / -1; font-size: 13px; padding: 8px 0; border-bottom: 1px solid var(--line); line-height: 1.75; overflow-wrap: anywhere; }
.detail-field ul { margin: 0; padding-left: 16px; font-size: 13px; color: var(--ink-2); }
.detail-actions { display: flex; gap: 8px; margin-top: 8px; }

/* 表单 */
.char-form { display: flex; flex-direction: column; gap: 8px; }
.entity-source-note { margin: 4px 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.save-error { margin: 4px 0; color: var(--zhu); font-size: 13px; line-height: 1.6; }
.char-form label { font-size: 12px; font-weight: 600; color: var(--ink-2); }

/* AI 旋转器 */
.ai-spinner {
  width: 20px; height: 20px; border: 2px solid var(--line);
  border-top-color: var(--zhu); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 关系图谱 */
.relationship-graph {
  position: relative;
  padding: 16px;
  margin-top: var(--space-md);
}

.graph-scroll { overflow: auto; max-height: 65vh; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-l); }
.graph-scroll canvas { display: block; margin-inline: auto; max-width: none; }
.relationship-graph canvas {
  display: block;
  margin: 0 auto;
  height: auto;
  border: 0;
  background: var(--paper);
}
.graph-legend, .graph-node-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; font-size: 12px; }
.relationship-form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px; align-items: center; }
.memory-fact-card { display: grid; gap: 8px; padding: 12px; margin-bottom: 10px; border: 1px solid var(--line-2); border-radius: 8px; overflow-wrap: anywhere; line-height: 1.7; }
.relationship-review-row { display: grid; gap: 6px; margin-bottom: 12px; }

.char-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.char-form-field { display: grid; align-content: start; gap: 6px; min-width: 0; }
@media (max-width: 600px) { .char-fields { grid-template-columns: 1fr; } }
.avatar-picker { display: flex; flex-direction: column; gap: 12px; }
.avatar-preview { display: flex; align-items: center; gap: 12px; }
.avatar-preview-box { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.avatar-preview-label { font-size: 11px; color: var(--ink-3); text-align: center; }
.avatar-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.avatar-empty { padding: 24px; text-align: center; color: var(--ink-3); font-size: 13px; border: 1px dashed var(--line-2); border-radius: var(--r-m); }
.avatar-count { font-size: 12px; color: var(--ink-3); text-align: center; }
.avatar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}
@media (min-width: 480px) {
  .avatar-grid { grid-template-columns: repeat(8, 1fr); }
}
.avatar-tile {
  border: 2px solid var(--line-2);
  border-radius: var(--r-m);
  padding: 4px;
  background: var(--paper);
  cursor: pointer;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.avatar-tile:hover,
.avatar-tile:focus-visible {
  border-color: var(--ink-3);
  box-shadow: var(--shadow-1);
  outline: none;
}
.avatar-tile--selected {
  border-color: var(--zhu);
  box-shadow: 0 0 0 2px var(--zhu-soft);
}

.graph-hint {
  text-align: center;
  color: var(--ink-3);
  font-size: 13px;
  margin-top: 8px;
}

/* 出场追踪 */
.appearance-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.appear-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 100px;
  background: var(--zhu-soft);
  color: var(--zhu);
}
.char-card:focus-visible, .avatar-tile:focus-visible { outline: 2px solid var(--dai); outline-offset: 3px; }
@media (max-width: 768px) { .char-grid { grid-template-columns: minmax(0, 1fr); } }
.character-workbench { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 24px; }
.character-workbench.with-detail { grid-template-columns: minmax(0, 1fr) 320px; }
.character-main { min-width: 0; }
.character-view-tabs { display: flex; gap: 24px; margin-right: auto; }
.character-view-tabs button { border: 0; border-bottom: 2px solid transparent; background: none; padding: 10px 16px; color: var(--ink-2); font: inherit; cursor: pointer; }
.character-view-tabs button.active { color: var(--zhu); border-color: var(--zhu); font-weight: 600; }
.filter-bar { flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
.char-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.char-card { display: flex; position: relative; flex-direction: column; align-items: flex-start; min-width: 0; min-height: 260px; padding: 20px; gap: 10px; }
.char-card :deep(.character-avatar), .character-detail :deep(.character-avatar) { border-radius: 50%; border: 2px solid var(--ink-3); }
.char-info { margin: 0; gap: 6px; }
.char-name { font-size: 22px; }
.char-identity { font-size: 14px; margin: 0; overflow-wrap: anywhere; }
.char-status { position: absolute; right: 14px; top: 22px; }
.char-tags { gap: 6px; }
.char-description { border-top: 1px solid var(--line); padding-top: 12px; font-size: 14px; line-height: 1.8; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.character-detail { min-width: 0; padding: 24px; position: sticky; top: 0; max-height: calc(100dvh - 120px); overflow-y: auto; }
.character-detail-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.character-detail-heading h3 { font-size: 24px; }
.character-detail-heading button { border: 0; background: none; color: var(--ink-2); font-size: 26px; cursor: pointer; }
.character-detail .detail-field { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; }
.character-detail .detail-field p { overflow-wrap: anywhere; }
.character-detail .detail-actions { margin-top: auto; padding-top: 16px; }
@media (max-width: 1350px) { .character-workbench.with-detail .char-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .character-workbench.with-detail { grid-template-columns: minmax(0, 1fr); } .character-detail { position: static; max-height: none; } .char-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 650px) { .char-grid, .character-workbench.with-detail .char-grid { grid-template-columns: minmax(0, 1fr); } .character-detail { padding: 18px; } }
.graph-controls { display: flex; justify-content: flex-end; gap: 8px; padding-bottom: 12px; }
.char-form { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.2fr); gap: 28px; }
.char-profile { min-width: 0; display: flex; flex-direction: column-reverse; justify-content: flex-end; gap: 20px; }
.char-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.char-form-field:last-child { grid-column: 1 / -1; }
.avatar-preview { justify-content: center; padding: 16px; border-bottom: 1px solid var(--line); }
.avatar-preview-box { gap: 8px; }
.avatar-picker { min-width: 0; }
.avatar-picker h3 { font: 600 22px var(--f-serif); margin: 0; }
.avatar-help { color: var(--ink-3); font-size: 12px; margin: 0; }
.avatar-filters { flex-direction: column; align-items: flex-start; }
.avatar-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); max-height: 390px; gap: 8px; }
.avatar-tile { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 8px 3px; }
.avatar-tile-label { font-size: 11px; color: var(--ink-2); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.char-relationships { grid-column: 1 / -1; display: grid; gap: 10px; border-top: 1px solid var(--line); padding-top: 16px; }
@media (max-width: 760px) { .char-form { grid-template-columns: 1fr; gap: 20px; } .avatar-grid { max-height: 320px; grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
