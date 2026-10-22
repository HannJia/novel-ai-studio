<template>
  <div
    class="editor-view"
    :class="{ 'editor-view--assistant-open': !assistantCollapsed }"
    id="chapter-editor-view"
    v-if="chapter"
  >
    <div class="editor-writing-column">
    <div class="editor-formatbar" role="toolbar" aria-label="写作工具">
        <button class="bottom-btn" @click="undo" title="撤销" aria-label="撤销"><n-icon :size="16"><arrow-undo-outline /></n-icon></button>
        <button class="bottom-btn" @click="redo" title="重做" aria-label="重做"><n-icon :size="16"><arrow-redo-outline /></n-icon></button>
        <div class="bottom-sep"></div>
        <button class="bottom-btn" @click="changeFontSize(-1)" title="缩小字体">A-</button>
        <span class="font-size-label">{{ fontSize }}px</span>
        <button class="bottom-btn" @click="changeFontSize(1)" title="放大字体">A+</button>
        <div class="bottom-sep"></div>
    </div>
    <!-- 顶部导航 -->
    <div class="editor-topbar">
      <div class="topbar-left">
        <span class="breadcrumb">《{{ novel?.title }}》</span>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-current">第 {{ chapter.chapterIndex + 1 }} 章</span>
      </div>
      <div class="topbar-center">
        <span
          class="story-days-control"
          title="默认由章节分析 AI 自动识别正文中的明确时间；输入框仅用于 AI 未识别或需要手动纠正时"
        >
          <span>{{ storyTimeStatus }}</span>
          <n-input-number
            v-model:value="chapterStoryDays"
            size="tiny"
            :min="0"
            :max="100000"
            :step="1"
            :disabled="isChapterLocked || aiWriting || completing"
            @update:value="updateChapterStoryDays"
          />
          天
        </span>
      </div>
      <div class="topbar-right">
        <button type="button" class="assistant-toggle" :aria-expanded="!assistantCollapsed" aria-controls="editor-assistant-pane" @click="toggleAssistant">AI 辅助</button>
        <button
          class="writing-mode-badge"
          :class="{ 'writing-mode-badge--ai': writingMode === 'ai' }"
          :title="writingMode === 'manual' ? '辅助写作：AI 只提供思路和审查，不修改正文。点击切换为 AI 自动写作' : 'AI 自动写作：AI 可以生成和修改正文。点击切换为辅助写作'"
          :disabled="aiWriting || completing"
          @click="toggleWritingMode"
        >
          {{ writingMode === 'manual' ? '辅助写作' : 'AI 自动写作' }}
        </button>
        <span class="word-count" title="去空白后计数，包含标点，沿用既有统计口径">{{ currentContentWordCount.toLocaleString() }} 字</span>
        <span class="save-status" :class="{ saved: !unsaved && !savingContent }">
          {{ savingContent ? '保存中…' : (unsaved ? '未保存' : '已保存') }}
        </span>
        <n-button v-if="chapter.versions?.length" size="tiny" quaternary @click="openChapterVersionModal">版本 {{ chapter.versions.length }}</n-button>
        <n-button
          type="primary"
          size="small"
          :disabled="chapterActionDisabled"
          :loading="completing"
          @click="handleChapterPrimaryAction"
        >
          {{ chapterActionLabel }}
        </n-button>
      </div>
    </div>

    <div class="length-controls" role="group" aria-label="章节篇幅控制">
      <span class="length-status" role="status" aria-live="polite">{{ chapterLengthStatusText }}</span>
      <n-button size="tiny" :disabled="aiWriting || completing || isChapterLocked" @click="openLengthSettings">篇幅设置</n-button>
      <n-button v-if="writingMode === 'ai' && content.trim() && chapterLengthInspection.status !== 'within'" size="tiny" :disabled="aiWriting || completing || isChapterLocked || !!pendingRevision" @click="calibrateChapterLength()">{{ chapterLengthInspection.status === 'long' ? '生成压缩候选' : '生成扩写候选' }}</n-button>
    </div>
    <n-modal v-model:show="showLengthSettings" preset="card" title="本书单章篇幅" style="width: min(460px, calc(100vw - 32px));">
      <p>沿用去空白、含标点的计数方式。修改后用于本书后续生成和完成检查，已有正文和字数保持不变。</p>
      <div class="length-settings">
        <label>最低字数<n-input-number v-model:value="lengthForm.minWords" :min="100" :max="20000" :precision="0" /></label>
        <label>目标字数<n-input-number v-model:value="lengthForm.targetWords" :min="100" :max="20000" :precision="0" /></label>
        <label>最高字数<n-input-number v-model:value="lengthForm.maxWords" :min="100" :max="20000" :precision="0" /></label>
        <n-button type="primary" :disabled="aiWriting || completing || isChapterLocked" @click="saveLengthSettings">保存篇幅设置</n-button>
      </div>
    </n-modal>

    <n-modal v-model:show="showChapterVersionModal" preset="card" title="正文历史版本" style="width: min(620px, calc(100vw - 32px));">
      <div class="chapter-version-dialog">
        <p>选择要恢复的正文快照。恢复前的当前正文会自动保留为新版本。</p>
        <n-select v-model:value="selectedChapterVersionId" :options="chapterVersionOptions" />
        <n-button type="warning" :disabled="!selectedChapterVersionId || isChapterLocked || aiWriting || completing" @click="restoreSelectedChapterVersion">恢复此版本</n-button>
      </div>
    </n-modal>

    <!-- 编辑区 -->
    <div class="editor-body">
      <!-- 纸张式编辑区 -->
      <div class="paper-editor">
        <div class="paper-sheet"><header class="paper-heading"><p>第 {{ chapter.chapterIndex + 1 }} 章</p>        <n-input
          :value="chapter.title"
          @update:value="updateChapterTitle"
          class="chapter-title-input"
          :readonly="isChapterLocked || aiWriting || completing"
          placeholder="章节标题"
          @blur="saveTitle"
        />
</header><div class="paper-content">
        <!-- 违禁词高亮层 -->
        <div
          v-if="highlightEnabled"
          class="highlight-overlay"
          aria-hidden="true"
          v-html="highlightedContent"
        ></div>
        <div
          v-if="writingMode === 'ai' && !content.trim()"
          class="ai-empty-generation"
          :class="{ 'ai-empty-generation--running': aiWriting }"
          role="status"
        >
          <template v-if="aiWriting">
            <span class="ai-empty-generation-spinner" aria-hidden="true">◌</span>
            <strong>{{ aiStatusText }}</strong>
          </template>
          <template v-else>
            <strong>本章尚未生成</strong>
            <n-button
              type="primary"
              size="small"
              :disabled="isChapterLocked || completing"
              @click="aiContinue"
            >
              生成章节
            </n-button>
          </template>
        </div>
        <textarea
          ref="textareaRef"
          v-model="content"
          class="editor-textarea"
          :class="{ 'has-overlay': highlightEnabled }"
          :readonly="isChapterLocked || aiWriting || completing"
          placeholder="正文"
          @input="onInput"
          @scroll="syncScroll"
          spellcheck="false"
        ></textarea>
        </div></div>
      </div>

      <!-- 右侧工具栏 -->
      <div class="side-toolbar">
        <button v-if="writingMode === 'ai'" class="tool-btn" title="AI 生成正文" aria-label="AI 生成正文" @click="aiContinue" :disabled="isChapterLocked || aiWriting || completing">
          <n-icon :size="18"><sparkles-outline /></n-icon>
        </button>
        <button class="tool-btn" title="违禁检测" aria-label="违禁检测" @click="checkBannedWords" :disabled="isChapterLocked || aiWriting || completing || !content">
          <n-icon :size="18"><warning-outline /></n-icon>
        </button>
        <button class="tool-btn" title="内容审查（6维度）" aria-label="内容审查" @click="contentReview" :disabled="isChapterLocked || aiWriting || completing || !content">
          <n-icon :size="18"><shield-checkmark-outline /></n-icon>
        </button>
        <button
          class="tool-btn"
          :class="{ 'tool-btn--active': highlightEnabled }"
          title="违禁词高亮"
          aria-label="违禁词高亮"
          @click="toggleHighlight"
        >
          <n-icon :size="18"><color-wand-outline /></n-icon>
        </button>
        <button
          class="tool-btn"
          :class="{ 'tool-btn--active': showBannedPanel }"
          title="违禁词面板"
          aria-label="违禁词面板"
          @click="showBannedPanel = !showBannedPanel"
        >
          <n-icon :size="18"><list-outline /></n-icon>
        </button>
        <button
          class="tool-btn"
          :class="{ 'tool-btn--active': dataPanelOpen }"
          title="数据面板"
          aria-label="数据面板"
          @click="dataPanelOpen = !dataPanelOpen"
        >
          <n-icon :size="18"><stats-chart-outline /></n-icon>
        </button>
      </div>

      <!-- 违禁词侧边面板 -->
      <div v-if="showBannedPanel" class="banned-panel">
        <div class="panel-header">
          <strong>违禁词</strong>
          <span class="panel-count">{{ liveScanResults.length }} 项</span>
        </div>
        <div class="panel-list">
          <div v-for="item in liveScanResults" :key="item.word.word" class="panel-item">
            <span class="panel-word" :class="item.word.level">
              <span class="banned-level" :class="item.word.level === 'must' ? 'banned-level--must' : 'banned-level--warn'" aria-hidden="true" /> {{ item.word.word }}
            </span>
            <span class="panel-count-num">×{{ item.count }}</span>
            <n-button
              v-if="item.word.suggestion"
              size="tiny"
              @click="replaceWord(item.word.word, item.word.suggestion!)"
            >
              → {{ item.word.suggestion }}
            </n-button>
          </div>
          <div v-if="liveScanResults.length === 0" class="panel-empty">无违禁词</div>
        </div>
      </div>

    </div>

    </div>
      <aside v-show="!assistantCollapsed" id="editor-assistant-pane" class="assistant-pane" aria-label="AI 辅助面板" @keydown.esc.stop="collapseAssistant">
        <header class="assistant-heading"><h2>✧ AI 助手</h2><button type="button" class="assistant-close" aria-label="收起辅助面板" @click="collapseAssistant">⌃</button></header>
        <div class="assistant-tabs" role="group" aria-label="辅助内容">
          <button v-if="writingMode === 'manual'" type="button" class="assistant-tab" :aria-pressed="activeAssistantTab === 'advisor'" @click="setAssistantTab('advisor')">顾问</button>
          <button type="button" class="assistant-tab" :aria-pressed="activeAssistantTab === 'review'" @click="setAssistantTab('review')">审查</button>
          <button type="button" class="assistant-tab" :aria-pressed="activeAssistantTab === 'chat'" @click="setAssistantTab('chat')">对话</button>
          <button type="button" class="assistant-tab" :aria-pressed="activeAssistantTab === 'data'" @click="setAssistantTab('data')">数据</button>
        </div>
        <div class="assistant-content">
          <div v-show="activeAssistantTab === 'chat'" ref="assistantChatElement" class="editor-chat-panel"></div>
          <div v-show="activeAssistantTab === 'advisor'" class="assistant-panel-wrapper">
    <WritingAdvisorSidebar
      v-if="writingMode === 'manual'"
      :open="writingAdvisorOpen"
      :persistent="writingMode === 'manual'"
      :analyzing="writingAdvisorAnalyzing"
      :error="writingAdvisorError"
      :stale="writingAdvisorStale"
      :result="writingAdvisorResult"
      :last-mode="writingAdvisorLastMode"
      :analyzing-modes="writingAdvisorAnalyzingModes"
      @open="writingAdvisorOpen = true"
      @close="closeWritingAdvisor"
      @stop="stopWritingAdvisor"
      @clear="clearWritingAdvisor"
      @analyze="analyzeWritingAdvice"
      @analyze-all="analyzeAllWritingAdvice"
      @select-mode="selectWritingAdvisorMode"
      @copy="copyWritingSuggestion"
      @promote-plan="promoteWritingSuggestionToPlan"
      @save-note="saveWritingSuggestionAsNote"
    />
          </div>
          <div v-show="activeAssistantTab === 'review'" class="assistant-panel-wrapper">
    <ChapterReviewSidebar
      :open="reviewPanelOpen"
      :has-content="hasReviewContent"
      :summary="chapter.summary"
      :loading="reviewLoading"
      :ending-check="endingCheckResult"
      :pending-revision="pendingRevision"
      :revision-loading="revisionLoading"
      :content-review="contentReviewResult"
      :rendered-content-review="renderBanned(contentReviewResult)"
      :editable-review="editableReviewText"
      :ai-writing="aiWriting"
      :completing="completing"
      :allow-rewrite="writingMode === 'ai'"
      :local-scan-results="localScanResults"
      :continuity-alerts="continuityAlerts"
      :banned-result="bannedResult"
      :rendered-banned-result="renderBanned(bannedResult)"
      :expanded="expandedSections"
      :review-status="currentReviewStatus"
      :coverage-status="reviewCoverageStatus"
      :action-label="chapterActionLabel"
      :action-disabled="chapterActionDisabled"
      :action-loading="completing"
      @proceed="handleChapterPrimaryAction"
      @toggle="reviewPanelOpen = !reviewPanelOpen"
      @close="collapseAssistant"
      @clear="closeReview"
      @approve-revision="approvePendingRevision"
      @reject-revision="rejectPendingRevision"
      @rewrite="handleReviewRepair"
      @replace-word="replaceWord"
      @replace-all="replaceAllSuggested"
      @toggle-section="toggleSection"
      @update-editable-review="value => editableReviewText = value"
    />
            <p v-if="!hasReviewContent && !chapter.summary && !reviewLoading" class="assistant-empty">审查结果会显示在这里。可使用工具栏的内容审查检查本章。</p>
          </div>
          <div v-show="activeAssistantTab === 'data'" class="assistant-panel-wrapper">
    <ChapterDataPanelSidebar
      :open="dataPanelOpen"
      :items="dataPanels"
      :pending-changes="pendingDataChanges"
      :filtered-history="filteredDataHistory"
      :history-count="novel?.dataPanelChanges?.length || 0"
      :selected-item-ids="selectedDataPanelIds"
      :selected-change-ids="selectedDataChangeIds"
      :selected-change-count="selectedPendingDataChanges.length"
      :all-pending-selected="allPendingDataChangesSelected"
      :drafts="dataChangeDrafts"
      :has-content="Boolean(content)"
      :scanning="scanningDataChanges"
      :history-chapter="dataHistoryChapter"
      :history-item="dataHistoryItem"
      :history-status="dataHistoryStatus"
      :history-keep-count="dataHistoryKeepCount"
      :history-keep-chapters="dataHistoryKeepChapters"
      :history-chapter-options="dataHistoryChapterOptions"
      :history-item-options="dataHistoryItemOptions"
      :history-status-options="dataHistoryStatusOptions"
      @close="collapseAssistant"
      @create="openDataItemModal()"
      @recommend="autoSelectRelatedData"
      @queue-rules="queueAutomaticDataChanges"
      @scan="scanDataPanelChanges()"
      @toggle-all-changes="toggleAllPendingDataChanges"
      @toggle-change="toggleDataChangeSelection"
      @apply-selected="applySelectedDataChanges"
      @reject-selected="rejectSelectedDataChanges"
      @apply-change="applyDataChange"
      @reject-change="rejectDataChange"
      @update-draft="(id, value) => dataChangeDrafts[id] = value"
      @toggle-item="toggleSelectedDataPanel"
      @edit="openDataItemModal"
      @delete="deleteDataItem"
      @cleanup="cleanupDataHistory"
      @update-history-chapter="value => dataHistoryChapter = value"
      @update-history-item="value => dataHistoryItem = value"
      @update-history-status="value => dataHistoryStatus = value"
      @update-history-keep-count="value => dataHistoryKeepCount = value"
      @update-history-keep-chapters="value => dataHistoryKeepChapters = value"
    />
          </div>
        </div>
      </aside>

    <ChapterAiStatus
      :writing="aiWriting"
      :writing-text="aiStatusText"
      :completing="completing"
      :completing-text="completingHint"
      :can-stop-completing="true"
      :background-text="backgroundTaskStatus"
      :background-pending="backgroundTaskPendingCount"
      @stop="stopAI"
    />



    <!-- 数据对象编辑弹窗 -->
    <n-modal v-model:show="showDataItemModal" preset="card" :title="editingDataItemId ? '编辑数据' : '新增数据'" style="width: 620px;">
      <div class="data-form">
        <label>名称</label>
        <n-input v-model:value="dataItemForm.name" placeholder="如：灵稻田、主角面板、金币库存" />
        <label>分类</label>
        <n-select v-model:value="dataItemForm.category" :options="dataCategoryOptions" />
        <template v-if="dataItemForm.category === '装备' || dataItemForm.category === '道具'">
          <label>归属对象</label>
          <n-select v-model:value="dataItemForm.ownerItemId" clearable :options="dataOwnerOptions" placeholder="选择归属的角色或对象" />
          <label>装备状态</label>
          <n-select v-model:value="dataItemForm.equipmentState" :options="equipmentStateOptions" />
        </template>
        <label>快速模板</label>
        <n-select :options="dataTemplateOptions" placeholder="选择模板填充字段" @update:value="applyDataTemplate" />
        <label>关联关键词（用顿号或逗号分隔）</label>
        <n-input v-model:value="dataItemForm.keywordsText" placeholder="如：灵稻、稻田、农田" />
        <label>字段与自动规则</label>
        <DataPanelFieldEditor v-model:fields="dataEditorFields" v-model:automation-text="dataItemForm.automationText" />
        <EquipmentFieldEditor v-if="dataItemForm.category === '装备' || dataItemForm.category === '道具'" v-model:fields="dataEditorFields" />
      </div>
      <template #footer>
        <div class="data-form-actions">
          <n-button @click="showDataItemModal = false">取消</n-button>
          <n-button type="primary" @click="saveDataItem">保存</n-button>
        </div>
      </template>
    </n-modal>





    <!-- 底部工具栏 -->
    <div class="editor-bottombar">
      <div class="bottom-tools">
        <span class="chapter-info">第 {{ chapter.chapterIndex + 1 }} 章 · {{ currentContentWordCount.toLocaleString() }} 字</span>
        <div class="bottom-sep"></div>
        <span class="chapter-info" v-if="novel">
          全书 {{ liveNovelWordCount.toLocaleString() }} / {{ novel.targetWordCountMin }}~{{ novel.targetWordCountMax }}万字
        </span>
      </div>
      <div class="bottom-right">
        <div class="progress-mini" v-if="novel && novel.targetWordCountMin > 0">
          <div
            class="progress-fill-mini"
            :style="{ width: Math.min(100, (liveNovelWordCount / (novel.targetWordCountMin * 10000)) * 100) + '%' }"
          ></div>
        </div>
        <div class="shortcut-hints">
          <kbd>Ctrl+S</kbd> 保存
          <template v-if="writingMode === 'ai'"><kbd>Ctrl+Enter</kbd> AI生成</template>
          <kbd>Esc</kbd> 停止
        </div>
      </div>
    </div>
  </div>

  <!-- 找不到章节 -->
  <div v-else class="page-container" style="display:flex;align-items:center;justify-content:center;min-height:50vh;">
    <div style="text-align:center;">
      <p>找不到该章节</p>
      <n-button @click="$router.back()">返回</n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { registerDraftSaver } from '@/services/appLifecycle'
import { ref, computed, inject, onActivated, onDeactivated, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { editorAssistantHostKey } from '@/services/editorAssistantHost'
import { NButton, NIcon, NInput, NInputNumber, NModal, NSelect, useDialog, useMessage } from 'naive-ui'
import { SparklesOutline, WarningOutline, ShieldCheckmarkOutline, ColorWandOutline, ListOutline, StatsChartOutline, ArrowUndoOutline, ArrowRedoOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { callAI } from '@/services/ai'
import { buildChapterPrompt, buildBannedWordsCheckPrompt, buildChapterSelfCheckPrompt } from '@/services/prompts'
import { augmentWritingContextWithVectorMemory, buildWritingContext, buildReviewContext, buildChapterFactCard } from '@/services/context'
import { chapterBackgroundQueue } from '@/services/aiTaskQueue'
import { syncSemanticIndexForNovel } from '@/services/semanticIndex'
import { generateStoryStateProposalDrafts } from '@/services/storyPlanning'
import { escapeHtml } from '@/utils/markdown'
import { countNovelWords } from '@/utils/format'
import { parseAiJsonObject } from '@/utils/aiJson'
import { builtInBannedWords, scanBannedWords, type BannedWordEntry } from '@/data/bannedWords'
import DataPanelFieldEditor from '@/components/data-panel/DataPanelFieldEditor.vue'
import ChapterDataPanelSidebar from '@/components/chapter-editor/ChapterDataPanelSidebar.vue'
import ChapterReviewSidebar from '@/components/chapter-editor/ChapterReviewSidebar.vue'
import ChapterAiStatus from '@/components/chapter-editor/ChapterAiStatus.vue'
import WritingAdvisorSidebar from '@/components/chapter-editor/WritingAdvisorSidebar.vue'
import { useChapterAiGeneration } from '@/composables/useChapterAiGeneration'
import { chapterOutputTokenBudget } from '@/services/chapterGeneration'
import { inspectChapterLength, resolveChapterLengthPolicy } from '@/services/chapterLength'
import { requestChapterLengthRepair } from '@/services/chapterLengthRepair'
import { requestCoveredContentReview } from '@/services/chapterReview'
import { isReviewCoverageComplete } from '@/services/chapterReviewAcceptance'
import { reviewCoverageLabel, type StoredReviewCoverage } from '@/services/chapterReviewCoverage'
import { useChapterEndingCheck, type ChapterEndingCheck } from '@/composables/useChapterEndingCheck'
import { useDataPanelSelection } from '@/composables/useDataPanelSelection'
import { useChapterAnalysis } from '@/composables/useChapterAnalysis'
import { getAiWorkflowPolicy } from '@/services/aiWorkflow'
import { finishAiActivity, startAiActivity } from '@/services/aiActivity'
import { useWritingAdvisor } from '@/composables/useWritingAdvisor'
import { scanContinuity, type ContinuityAlert } from '@/services/continuity'
import type { WritingAdviceSuggestion } from '@/services/writingAdvisor'
import { isPlaceholderChapterTitle, requestChapterMetadata } from '@/services/chapterMetadata'
import { contentReviewVerdict, extractActionableReview, reviewNeedsRewrite } from '@/services/contentReview'
import { requestChapterRepair, type ChapterRepairMode } from '@/services/chapterRepair'
import {
  calculateDataPanelFieldValues,
  formatDataPanelAutomationRules,
  parseDataPanelFields,
  parseDataPanelAutomationRules,
} from '@/services/dataPanel'
import type { DataPanelCategory, DataPanelField, DataPanelItem, ChapterRevision, EquipmentState } from '@/types/novel'
import EquipmentFieldEditor from '@/components/data-panel/EquipmentFieldEditor.vue'
import { equipmentStateOptions, equipmentSnapshot, formatEquipmentTotals } from '@/services/dataPanelEquipment'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const message = useMessage()
const dialog = useDialog()

// Each keyed, cached editor owns one chapter even while another route is active.
const novelId = ref(route.params.novelId as string)
const chapterId = ref(route.params.chapterId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const writingMode = computed(() => novel.value?.writingMode || 'manual')
const chapter = computed(() => novel.value?.chapters.find(c => c.id === chapterId.value))
const isChapterLocked = computed(() => chapter.value?.status === 'locked')

const content = ref('')
const unsaved = ref(false)
const savingContent = ref(false)
const aiDrafting = ref(false)
const aiWriting = ref(false)
const aiStatusText = ref('AI 正在续写...')
const reviewLoading = ref(false)
const completing = ref(false)
const completingHint = ref('')
let completionController: AbortController | null = null
const lastMetadataSignature = ref('')
const lastMemorySignature = ref('')
const navigatingChapter = ref(false)
const readyForNextChapter = computed(() => !!chapter.value
  && ['finalized', 'locked'].includes(chapter.value.status)
  && (chapter.value.status === 'locked' || chapterLengthInspection.value.status === 'within')
  && chapter.value.content === content.value)
const followingChapter = computed(() => chapter.value
  ? novel.value?.chapters.find(item => item.chapterIndex === chapter.value!.chapterIndex + 1) : undefined)
const chapterActionLabel = computed(() => completing.value ? '正在完成本章'
  : readyForNextChapter.value ? (followingChapter.value ? '进入下一章' : writingMode.value === 'ai' ? '生成下一章' : '新建下一章')
    : chapter.value?.status === 'completed' ? '继续完成本章' : '完成本章')
const chapterActionDisabled = computed(() => aiWriting.value || completing.value || savingContent.value
  || navigatingChapter.value || !!pendingRevision.value)
const backgroundTaskStatus = ref('')
const backgroundTaskPendingCount = ref(0)
const bannedResult = ref('')
const contentReviewResult = ref('')
const editableReviewText = ref('')
const lastContentReviewSignature = ref('')
const lastEndingCheckSignature = ref('')
const reviewCoverage = ref<StoredReviewCoverage>()
const reviewCoverageStatus = computed(() => {
  const coverage = reviewCoverage.value
  if (!coverage) return ''
  const stale = coverage.signature !== getChapterContextSignature()
  const prefix = coverage.signature.startsWith('batch-review') ? '批量审查记录，完成本章时会重新核查：' : stale ? '上次检查（正文或设定已变化）：' : ''
  return `${prefix}${reviewCoverageLabel(coverage)}${coverage.error ? `。${coverage.error}` : ''}`
})
const currentReviewStatus = computed(() => {
  if (reviewLoading.value) return '内容审查中'
  if (!contentReviewResult.value) return ''
  const signature = lastContentReviewSignature.value || chapter.value?.contentReviewSignature || ''
  if (!signature.startsWith('review-v3:')) return '原审查记录待重新验证'
  if (signature !== getChapterContextSignature()) {
    return '正文或设定已修改，原审查结果待更新'
  }
  if (!isReviewCoverageComplete(reviewCoverage.value, signature, content.value)) return '审查覆盖未完成，不能判定全文通过'
  return ({ passed: '当前正文审查已通过', 'changes-required': '当前正文需要修改', unknown: '审查结果待确认' })[
    contentReviewVerdict(contentReviewResult.value)]
})
const endingCheckResult = ref<ChapterEndingCheck | null>(null)
const pendingRevision = ref<ChapterRevision | null>(null)
const revisionLoading = ref(false)
const localScanResults = ref<{ word: BannedWordEntry; count: number; positions: number[] }[]>([])
const continuityAlerts = ref<ContinuityAlert[]>([])
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const highlightEnabled = ref(false)
const showBannedPanel = ref(false)
const dataPanelOpen = ref(false)
const showDataItemModal = ref(false)
const editingDataItemId = ref('')
const dataChangeDrafts = ref<Record<string, string>>({})
const dataHistoryChapter = ref('all')
const dataHistoryItem = ref('all')
const dataHistoryStatus = ref('all')
const dataHistoryKeepCount = ref(100)
const dataHistoryKeepChapters = ref(20)
const manualDataPanelSelection = ref(new Map<string, boolean>())
const dataItemForm = ref({
  name: '',
  category: '自定义' as DataPanelCategory,
  keywordsText: '',
  fieldsText: '',
  automationText: '',
  ownerItemId: '',
  equipmentState: 'stored' as EquipmentState,
})
const dataEditorFields = ref<DataPanelField[]>([])
const chapterStoryDays = ref(0)
const storyTimeStatus = computed(() => {
  if (chapter.value?.storyDay !== undefined) return '已记录 · 本章经过'
  return chapterStoryDays.value > 0 ? '手动兜底' : '等待AI识别'
})
watch(() => chapter.value?.storyDaysElapsed, value => {
  chapterStoryDays.value = value || 0
})
const dataCategoryOptions = [
  { label: '角色', value: '角色' },
  { label: '作物', value: '作物' },
  { label: '资源', value: '资源' },
  { label: '建筑', value: '建筑' },
  { label: '任务', value: '任务' },
  { label: '装备', value: '装备' },
  { label: '道具', value: '道具' },
  { label: '自定义', value: '自定义' },
]
const dataTemplateOptions = [
  { label: '作物成长', value: 'crop' },
  { label: '预估窗口', value: 'forecast' },
  { label: '资源库存', value: 'resource' },
  { label: '建筑进度', value: 'building' },
  { label: '任务倒计时', value: 'task' },
  { label: '角色面板', value: 'character' },
]
const reviewPanelOpen = ref(false)
const assistantCollapsed = ref(false)
const chatTabOpen = ref(false)
const assistantChatElement = ref<HTMLElement | null>(null)
const registerAssistantChatHost = inject(editorAssistantHostKey, undefined)
watch(assistantChatElement, (host, previous) => {
  if (previous) registerAssistantChatHost?.(previous, false)
  if (host) registerAssistantChatHost?.(host, true)
}, { flush: 'post' })
onActivated(() => { if (assistantChatElement.value) registerAssistantChatHost?.(assistantChatElement.value, true) })
onDeactivated(() => { if (assistantChatElement.value) registerAssistantChatHost?.(assistantChatElement.value, false) })
onUnmounted(() => { if (assistantChatElement.value) registerAssistantChatHost?.(assistantChatElement.value, false) })

watch(dataPanelOpen, open => {
  if (open) {
    chatTabOpen.value = false
    reviewPanelOpen.value = false
    assistantCollapsed.value = false
  }
}, { flush: 'sync' })

watch(reviewPanelOpen, open => {
  if (open) {
    chatTabOpen.value = false
    dataPanelOpen.value = false
    assistantCollapsed.value = false
  }
}, { flush: 'sync' })

const activeAssistantTab = computed(() => {
  if (chatTabOpen.value) return 'chat'
  if (dataPanelOpen.value) return 'data'
  if (reviewPanelOpen.value) return 'review'
  if (writingMode.value === 'manual') return 'advisor'
  return 'review'
})

function collapseAssistant() {
  assistantCollapsed.value = true
  document.querySelector<HTMLButtonElement>('.assistant-toggle')?.focus()
}

function toggleAssistant() {
  if (!assistantCollapsed.value) collapseAssistant()
  else setAssistantTab(activeAssistantTab.value)
}

function setAssistantTab(tab: 'advisor' | 'review' | 'data' | 'chat') {
  chatTabOpen.value = tab === 'chat'
  if (tab === 'chat') {
    reviewPanelOpen.value = false
    dataPanelOpen.value = false
    assistantCollapsed.value = false
  }
  if (tab === 'advisor') {
    reviewPanelOpen.value = false
    dataPanelOpen.value = false
    assistantCollapsed.value = false
  } else if (tab === 'review') {
    reviewPanelOpen.value = true
    dataPanelOpen.value = false
    assistantCollapsed.value = false
  } else if (tab === 'data') {
    dataPanelOpen.value = true
    reviewPanelOpen.value = false
    assistantCollapsed.value = false
  }
}

if (typeof window !== 'undefined') {
  assistantCollapsed.value = window.innerWidth <= 1000
}
const showChapterVersionModal = ref(false)
const selectedChapterVersionId = ref('')
const expandedSections = ref({
  summary: false,
  contentReview: true,
  localScan: true,
  aiReview: true,
  continuity: true,
})
const fontSize = ref(18)
let autoSaveTimer: ReturnType<typeof setInterval> | null = null

// 是否有审查内容
const hasReviewContent = computed(() =>
  !!(bannedResult.value || contentReviewResult.value || reviewCoverage.value || localScanResults.value.length > 0 || continuityAlerts.value.length > 0 || pendingRevision.value || endingCheckResult.value)
)
const chapterVersionOptions = computed(() => (chapter.value?.versions || []).slice().reverse().map(version => ({
  label: `${version.label} · ${new Date(version.savedAt).toLocaleString('zh-CN')}`,
  value: version.id,
})))
const dataPanels = computed(() => novel.value?.dataPanels || [])
const dataOwnerOptions = computed(() => dataPanels.value
  .filter(item => item.id !== editingDataItemId.value && item.category === '角色')
  .map(item => ({ label: `${item.name}（${item.category}）`, value: item.id })))
const { scanningDataChanges, analyzeChapterStructure, scanDataPanelChanges } = useChapterAnalysis({
  currentNovelId: novelId,
  currentChapterId: chapterId,
  currentContent: content,
  currentPanels: dataPanels,
  onInfo: info => message.info(info),
  onWarning: warning => message.warning(warning),
  onDataChangesDetected: result => {
    if (result.novelId === novelId.value) dataPanelOpen.value = true
  },
})
const currentContentWordCount = computed(() => countNovelWords(content.value))
const liveNovelWordCount = computed(() => {
  if (!novel.value || !chapter.value) return currentContentWordCount.value
  return novel.value.currentWordCount - chapter.value.wordCount + currentContentWordCount.value
})
const pendingDataChanges = computed(() => (novel.value?.dataPanelChanges || []).filter(c => c.status === 'pending'))
const {
  selectedItemIds: selectedDataPanelIds,
  selectedChangeIds: selectedDataChangeIds,
  selectedItems: selectedDataPanels,
  selectedChanges: selectedPendingDataChanges,
  allChangesSelected: allPendingDataChangesSelected,
  toggleItem: toggleDataPanelSelection,
  toggleChange: toggleDataChangeSelection,
  toggleAllChanges: toggleAllPendingDataChanges,
  clearChange: clearDataChangeSelection,
  clearItem: clearDataPanelSelection,
} = useDataPanelSelection(dataPanels, pendingDataChanges)
const dataHistoryChapterOptions = computed(() => [
  { label: '全部章节', value: 'all' },
  ...[...new Set((novel.value?.dataPanelChanges || []).map(change => change.chapterIndex))]
    .sort((a, b) => b - a)
    .map(index => ({ label: `第 ${index + 1} 章`, value: String(index) })),
])
const dataHistoryItemOptions = computed(() => [
  { label: '全部对象', value: 'all' },
  ...dataPanels.value.map(item => ({ label: item.name, value: item.id })),
])
const dataHistoryStatusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待确认', value: 'pending' },
  { label: '已应用', value: 'accepted' },
  { label: '已忽略', value: 'rejected' },
]
const filteredDataHistory = computed(() => (novel.value?.dataPanelChanges || [])
  .filter(change => dataHistoryChapter.value === 'all' || change.chapterIndex === Number(dataHistoryChapter.value))
  .filter(change => dataHistoryItem.value === 'all' || change.itemId === dataHistoryItem.value)
  .filter(change => dataHistoryStatus.value === 'all' || change.status === dataHistoryStatus.value)
)
const chapterLengthPolicy = computed(() => resolveChapterLengthPolicy(novel.value?.chapterLengthPolicy))
const chapterLengthInspection = computed(() => inspectChapterLength(content.value, chapterLengthPolicy.value))
const chapterLengthStatusText = computed(() => {
  const policy = chapterLengthPolicy.value
  const result = chapterLengthInspection.value
  const state = result.status === 'short' ? `还差 ${result.deficit} 字` : result.status === 'long' ? `超出 ${result.excess} 字` : '篇幅达标'
  return `${state} · 目标 ${policy.targetWords} 字，允许 ${policy.minWords}–${policy.maxWords} 字 · 含标点，不含空白`
})
const showLengthSettings = ref(false)
const lengthForm = ref<{ minWords: number | null; targetWords: number | null; maxWords: number | null }>({ ...chapterLengthPolicy.value })
function openLengthSettings() {
  lengthForm.value = { ...chapterLengthPolicy.value }
  showLengthSettings.value = true
}
async function saveLengthSettings() {
  if (!novel.value || aiWriting.value || completing.value || isChapterLocked.value) return
  const { minWords, targetWords, maxWords } = lengthForm.value
  if ([minWords, targetWords, maxWords].some(value => value === null || !Number.isInteger(value) || value < 100 || value > 20000)
    || minWords! > targetWords! || targetWords! > maxWords!) {
    message.warning('请填写 100–20000 的整数，并满足最低 ≤ 目标 ≤ 最高')
    return
  }
  const previous = novel.value.chapterLengthPolicy
  novelStore.setChapterLengthPolicy(novelId.value, { minWords: minWords!, targetWords: targetWords!, maxWords: maxWords! })
  try {
    await novelStore.saveNovelNow(novelId.value)
    showLengthSettings.value = false
    message.success('本书篇幅设置已保存')
  } catch {
    novel.value.chapterLengthPolicy = previous
    message.error('篇幅设置保存失败，请重试')
  }
}
const aiWorkflowPolicy = computed(() => getAiWorkflowPolicy(configStore.aiWorkflowMode))
const { chapterEndingPasses, requestChapterEndingCheck, generateEndingContinuation } = useChapterEndingCheck()
const { beginGeneration, stopGeneration, getGenerationSignal, generateWritingPlan, streamAppend } = useChapterAiGeneration({
  content,
  writing: aiWriting,
  statusText: aiStatusText,
  lengthPolicy: chapterLengthPolicy,
  onWarning: warning => message.warning(warning),
  onChunk: () => {
    unsaved.value = true
    nextTick(() => {
      if (textareaRef.value) textareaRef.value.scrollTop = textareaRef.value.scrollHeight
    })
  },
})

const {
  open: writingAdvisorOpen,
  analyzing: writingAdvisorAnalyzing,
  error: writingAdvisorError,
  stale: writingAdvisorStale,
  result: writingAdvisorResult,
  lastMode: writingAdvisorLastMode,
  analyzingModes: writingAdvisorAnalyzingModes,
  selectMode: selectWritingAdvisorMode,
  analyze: analyzeWritingAdvice,
  analyzeAll: analyzeAllWritingAdvice,
  stop: stopWritingAdvisor,
  close: closeWritingAdvisor,
  clear: clearWritingAdvisor,
} = useWritingAdvisor({
  currentNovel: novel,
  currentChapter: chapter,
  currentContent: content,
  textarea: textareaRef,
  embeddingConfig: configStore.embedding,
  onInfo: info => message.info(info),
  onWarning: warning => message.warning(warning),
})

function toggleWritingMode() {
  if (aiWriting.value || completing.value) return
  const nextMode = writingMode.value === 'manual' ? 'ai' : 'manual'
  novelStore.setWritingMode(novelId.value, nextMode)
  message.info(nextMode === 'manual'
    ? '已切换为辅助写作'
    : '已切换为 AI 自动写作')
}

function updateChapterStoryDays(value: number | null) {
  chapterStoryDays.value = Math.max(0, Number(value) || 0)
  if (chapter.value && !isChapterLocked.value) {
    novelStore.updateChapter(novelId.value, chapterId.value, { storyDaysElapsed: chapterStoryDays.value })
  }
}

watch(writingMode, mode => {
  if (mode !== 'ai') return
  for (const scope of ['paragraph', 'scene', 'chapter'] as const) stopWritingAdvisor(scope)
  closeWritingAdvisor()
})

function openChapterVersionModal() {
  selectedChapterVersionId.value = chapter.value?.versions?.[chapter.value.versions.length - 1]?.id || ''
  showChapterVersionModal.value = true
}

async function restoreSelectedChapterVersion() {
  if (!selectedChapterVersionId.value) return
  if (novelStore.restoreChapterVersion(novelId.value, chapterId.value, selectedChapterVersionId.value)) {
    if (chapter.value) content.value = chapter.value.content
    showChapterVersionModal.value = false
    endingCheckResult.value = null
    lastEndingCheckSignature.value = ''
    unsaved.value = false
    message.success('正文历史版本已恢复')
    await novelStore.saveNovelNow(novelId.value)
  } else {
    message.warning('历史版本不存在或章节已锁定')
  }
}

async function copyWritingSuggestion(suggestion: WritingAdviceSuggestion) {
  const text = `${suggestion.title}\n${suggestion.approach}${suggestion.nextBeat ? `\n下一拍：${suggestion.nextBeat}` : ''}`
  try {
    await navigator.clipboard.writeText(text)
    message.success('思路已复制')
  } catch {
    message.warning('复制失败，请手动选择文本')
  }
}

function promoteWritingSuggestionToPlan(suggestion: WritingAdviceSuggestion) {
  if (!novel.value || !chapter.value) return
  const targetChapter = chapter.value.chapterIndex + 1
  dialog.info({
    title: '转为下一章计划',
    content: `将把“${suggestion.title}”保存为第 ${targetChapter + 1} 章的章节计划，不会修改正文。`,
    positiveText: '保存计划',
    negativeText: '取消',
    onPositiveClick: () => {
      const plan = novelStore.addChapterPlan(novel.value!.id, {
        horizon: 'next',
        title: suggestion.title,
        objective: suggestion.storyEffect || suggestion.approach,
        summary: suggestion.approach,
        beats: suggestion.nextBeat ? [suggestion.nextBeat] : [],
        targetChapterStart: targetChapter,
        targetChapterEnd: targetChapter,
        relatedArcIds: [],
        relatedEventIds: [],
        status: 'planned',
        source: 'ai',
      })
      if (plan) message.success('已保存为下一章计划')
    },
  })
}

function saveWritingSuggestionAsNote(suggestion: WritingAdviceSuggestion) {
  if (!novel.value || !chapter.value) return
  const noteContent = [suggestion.approach, suggestion.nextBeat ? `下一拍：${suggestion.nextBeat}` : '', suggestion.risk ? `注意：${suggestion.risk}` : ''].filter(Boolean).join('\n')
  const note = novelStore.addSceneNote(novel.value.id, chapter.value.id, { title: suggestion.title, content: noteContent, source: 'ai' })
  if (note) message.success('已保存为场景笔记')
}

function getContentSignature(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${text.length}:${hash >>> 0}`
}

const reviewContextSignature = computed(() => {
  if (!novel.value || !chapter.value) return ''
  const book = novel.value
  const current = chapter.value
  const source = {
    settings: book.settings, style: book.writingStyle, outline: book.outline, lengthPolicy: chapterLengthPolicy.value,
    volume: book.volumes.find(item => item.volumeIndex === current.volumeIndex),
    plans: (book.chapterPlans || []).filter(item => item.targetChapterStart <= current.chapterIndex && item.targetChapterEnd >= current.chapterIndex)
      .map(item => [item.id, item.title, item.objective, item.summary, item.beats, item.relatedArcIds, item.relatedEventIds]),
    characters: book.characters.map(item => [item.name, item.identity, item.personality, item.powerLevel, item.faction, item.description]),
    previous: book.chapters.filter(item => item.chapterIndex < current.chapterIndex)
      .map(item => [item.id, item.summary, item.chapterIndex === current.chapterIndex - 1 ? item.content.slice(-4000) : '']),
    events: book.eventLog.filter(item => item.chapterIndex < current.chapterIndex)
      .map(item => [item.id, item.title, item.description, item.type, item.status]),
    data: book.dataPanels.map(item => [item.id, item.name, item.fields, item.ownerItemId, item.equipmentState]),
    knowledge: (book.knowledgeBaseIds || []).map(id => [
      id, useKnowledgeStore().getKB(id)?.entries.map(entry => [entry.id, entry.updatedAt]),
    ]),
  }
  return getContentSignature(JSON.stringify(source))
})

function getChapterContextSignature(text = content.value): string {
  return `review-v3:${getContentSignature(text)}:${reviewContextSignature.value}`
}

async function loadPendingRevision() {
  if (!chapter.value) {
    pendingRevision.value = null
    return
  }
  const revisions = await novelStore.getChapterRevisions(chapter.value.id)
  pendingRevision.value = revisions.find(revision => revision.status === 'pending') || null
  if (pendingRevision.value) reviewPanelOpen.value = true
}

async function approvePendingRevision() {
  if (!pendingRevision.value) return
  if (aiWriting.value || completing.value || isChapterLocked.value || revisionLoading.value) return
  if (writingMode.value === 'manual' && pendingRevision.value.source !== 'user') {
    message.info('请切换为 AI 自动写作后再确认 AI 正文修订')
    return
  }
  if (inspectChapterLength(pendingRevision.value.proposedContent, chapterLengthPolicy.value).status !== 'within') {
    message.warning('候选稿不符合当前篇幅设置，请调整设置或拒绝后重新生成；原稿未改动')
    return
  }
  revisionLoading.value = true
  const targetNovelId = novelId.value
  const targetChapterId = chapterId.value
  try {
    const applied = await novelStore.acceptChapterRevision(targetNovelId, targetChapterId, pendingRevision.value.id)
    if (!applied || applied.status !== 'accepted') throw new Error('候选修订未能写入，请重新检查')
    if (novelId.value !== targetNovelId || chapterId.value !== targetChapterId) return
    if (chapter.value) {
      content.value = chapter.value.content
      unsaved.value = false
      lastContentReviewSignature.value = ''
    }
    pendingRevision.value = null
    endingCheckResult.value = null
    message.success('修订已确认并写入正文')
  } catch (err: any) {
    message.warning(err?.message || '修订已过期，请重新生成')
    await loadPendingRevision()
  } finally {
    revisionLoading.value = false
  }
}

async function rejectPendingRevision() {
  if (!pendingRevision.value) return
  revisionLoading.value = true
  try {
    await novelStore.rejectChapterRevision(pendingRevision.value.id)
    pendingRevision.value = null
    endingCheckResult.value = null
    message.info('已拒绝正文修订')
  } finally {
    revisionLoading.value = false
  }
}

// Length adjustment creates a reviewed proposal; the author sees its final diff before applying.
async function calibrateChapterLength(options: { keepCompleting?: boolean; activityParentId?: string } = {}) {
  if (!novel.value || !chapter.value || isChapterLocked.value || pendingRevision.value || !content.value.trim()) return
  if ((aiWriting.value || completing.value) && !options.keepCompleting) return
  if (writingMode.value !== 'ai') return
  if (chapterLengthInspection.value.status === 'within') return
  const model = configStore.getModelForTask('writing')
  if (!model) { message.warning('请先配置写作模型'); return }
  if (!(await saveContent())) return
  const sourceNovelId = novelId.value
  const sourceChapterId = chapterId.value
  const source = content.value
  const signature = getChapterContextSignature()
  const policy = { ...chapterLengthPolicy.value }
  const activity = options.activityParentId ? null : startAiActivity('调整章节篇幅')
  const parentId = options.activityParentId || activity?.id
  let failure: unknown
  beginGeneration()
  const signal = options.keepCompleting ? completionController!.signal : getGenerationSignal()
  const ensureCurrent = () => {
    signal.throwIfAborted()
    assertChapterSnapshot(sourceNovelId, sourceChapterId, source)
    if (signature !== getChapterContextSignature()) throw new Error('正文、设定或篇幅设置已变化，未应用旧候选')
  }
  try {
    aiStatusText.value = '正在生成篇幅调整候选，原稿保留...'
    if (options.keepCompleting) completingHint.value = aiStatusText.value
    const ctx = buildWritingContext(novel.value, chapter.value)
    const candidate = await requestChapterLengthRepair({
      model, source, policy, factCard: buildChapterFactCard(novel.value, chapter.value, ctx),
      guidance: ctx.chapterGuidance, signal, activityParentId: parentId,
    })
    ensureCurrent()
    const reviewModel = configStore.getModelForTask('review') || model
    aiStatusText.value = '正在检查调整后的结尾和内容...'
    if (options.keepCompleting) completingHint.value = aiStatusText.value
    reviewLoading.value = true
    reviewPanelOpen.value = true
    const ending = await requestChapterEndingCheck(reviewModel, candidate, ctx.chapterGuidance, '', signal, parentId)
    ensureCurrent()
    const report = await requestContentReview(reviewModel, { candidateContent: candidate, signal, activityParentId: parentId })
    ensureCurrent()
    const merged = [buildLocalConsistencyReviewBlock(candidate), report].filter(Boolean).join('\n\n')
    const passed = chapterEndingPasses(ending) && contentReviewVerdict(merged) === 'passed'
    const revision = await novelStore.proposeChapterRevision(sourceNovelId, sourceChapterId, candidate, 'review',
      `篇幅调整：${countNovelWords(source)} → ${countNovelWords(candidate)} 字。${passed ? '结尾与内容复检通过' : '复检仍有待处理问题'}。${passed ? '' : `${ending.reason}\n${merged}\n`}请检查最终差异，确认写入后再完成本章。`)
    ensureCurrent()
    if (!revision) throw new Error('未能保存篇幅候选，原稿未改动')
    pendingRevision.value = revision
    message.info('已生成篇幅调整候选，请检查最终差异并确认；原稿保留')
  } catch (error: any) {
    failure = error
    if (error?.name !== 'AbortError') message.error('篇幅调整未完成：' + (error?.message || String(error)))
  } finally {
    reviewLoading.value = false
    aiWriting.value = false
    if (activity) finishAiActivity(activity, failure)
  }
}

function splitKeywords(text: string): string[] {
  return text.split(/[、,，\n]/).map(s => s.trim()).filter(Boolean)
}

function calculateFields(fields: DataPanelItem['fields']): DataPanelItem['fields'] {
  return calculateDataPanelFieldValues(fields)
}

function applyDataTemplate(template: string) {
  const templates: Record<string, { category: DataPanelCategory; fields: string; keywords: string; automation?: string }> = {
    crop: {
      category: '作物',
      fields: '已成长=0=天=days\n成熟周期=100=天=days\n额外成熟度=0=%=percent\n成熟度=0=%=formula=已成长/成熟周期*100+额外成熟度\n剩余成熟=100=天=formula=成熟周期*(100-成熟度)/100',
      keywords: '成熟、采收、生长、药圃、灵草',
      automation: '已成长｜经过 1 天 +1（基于：故事时间）',
    },
    forecast: {
      category: '作物',
      fields: '观察日=0=天=days\n最早达成日=0=天=days\n最迟达成日=0=天=days\n趋势方向=持平==text\n预估窗口=0-0=天=text',
      keywords: '峰值、最迟、最早、加快、放缓、预估、可采标准',
    },
    resource: {
      category: '资源',
      fields: '当前库存=0==number\n本章收入=0==number\n本章支出=0==number\n单位=灵石==text',
      keywords: '库存、资源、灵石、收入、支出',
    },
    building: {
      category: '建筑',
      fields: '已完成=0=%=percent\n剩余进度=100=%=formula=100-已完成\n预计剩余=0=天=countdown',
      keywords: '建造、修缮、进度、完工',
    },
    task: {
      category: '任务',
      fields: '剩余天数=0=天=countdown\n已过天数=0=天=days\n截止天数=0=天=days',
      keywords: '期限、倒计时、任务、截止',
      automation: '已过天数｜每章 +1\n剩余天数｜每章 -1',
    },
    character: {
      category: '角色',
      fields: '境界=凡人==text\n灵石=0=块=number\n位置=未知==text\n状态=活跃==text',
      keywords: '境界、实力、位置、状态、灵石',
    },
  }
  const selected = templates[template]
  if (!selected) return
  dataItemForm.value.category = selected.category
  dataItemForm.value.fieldsText = selected.fields
  dataEditorFields.value = parseDataPanelFields(selected.fields)
  dataItemForm.value.automationText = selected.automation || ''
  if (!dataItemForm.value.keywordsText) dataItemForm.value.keywordsText = selected.keywords
}

function openDataItemModal(item?: DataPanelItem) {
  if (item) {
    editingDataItemId.value = item.id
    dataItemForm.value = {
      name: item.name,
      category: item.category,
      keywordsText: item.relatedKeywords.join('、'),
      fieldsText: '',
      automationText: formatDataPanelAutomationRules(item.fields),
      ownerItemId: item.ownerItemId || '',
      equipmentState: item.equipmentState || 'stored',
    }
    dataEditorFields.value = item.fields.map(field => ({
      ...field,
      automationRules: field.automationRules?.map(rule => ({ ...rule })),
    }))
  } else {
    editingDataItemId.value = ''
    dataItemForm.value = { name: '', category: '自定义', keywordsText: '', fieldsText: '', automationText: '', ownerItemId: '', equipmentState: 'stored' }
    dataEditorFields.value = []
  }
  showDataItemModal.value = true
}

function saveDataItem() {
  if (!novel.value || !dataItemForm.value.name.trim()) {
    message.warning('请填写数据名称')
    return
  }
  const oldItem = editingDataItemId.value
    ? dataPanels.value.find(item => item.id === editingDataItemId.value)
    : undefined
  const parsedFields = calculateFields(dataEditorFields.value)
  const invalidFormula = parsedFields.find(field => field.calculationError)
  if (invalidFormula) {
    message.error(`${invalidFormula.name}：${invalidFormula.calculationError}`)
    return
  }
  const fields = parseDataPanelAutomationRules(
    dataItemForm.value.automationText,
    parsedFields,
    oldItem?.fields,
  )
  const relatedKeywords = splitKeywords(dataItemForm.value.keywordsText)
  if (editingDataItemId.value) {
    const mergedFields = fields.map(field => {
      const oldField = oldItem?.fields.find(f => f.name === field.name)
      return oldField ? { ...field, id: oldField.id } : field
    })
    novelStore.updateDataPanelItem(novelId.value, editingDataItemId.value, {
      name: dataItemForm.value.name.trim(),
      category: dataItemForm.value.category,
      fields: mergedFields,
      relatedKeywords,
      ownerItemId: dataItemForm.value.ownerItemId || undefined,
      equipmentState: dataItemForm.value.equipmentState,
    })
  } else {
    novelStore.addDataPanelItem(novelId.value, {
      name: dataItemForm.value.name.trim(),
      category: dataItemForm.value.category,
      fields,
      relatedKeywords,
      ownerItemId: dataItemForm.value.ownerItemId || undefined,
      equipmentState: dataItemForm.value.equipmentState,
    })
  }
  showDataItemModal.value = false
  message.success('数据已保存')
}

function deleteDataItem(itemId: string) {
  novelStore.deleteDataPanelItem(novelId.value, itemId)
  clearDataPanelSelection(itemId)
  manualDataPanelSelection.value.delete(itemId)
  message.success('数据已删除')
}

function toggleSelectedDataPanel(itemId: string) {
  toggleDataPanelSelection(itemId)
  const overrides = new Map(manualDataPanelSelection.value)
  overrides.set(itemId, selectedDataPanelIds.value.has(itemId))
  manualDataPanelSelection.value = overrides
}

function autoSelectRelatedData() {
  if (!chapter.value) return
  const recommendations = getRecommendedDataPanelIds()
  const next = new Set(selectedDataPanelIds.value)
  const overrides = new Map(manualDataPanelSelection.value)
  for (const id of recommendations) {
    next.add(id)
    overrides.set(id, true)
  }
  selectedDataPanelIds.value = next
  manualDataPanelSelection.value = overrides
  message.success(recommendations.length ? `已根据章节计划推荐 ${recommendations.length} 个数据对象` : '章节计划中未匹配到数据对象')
}

function selectRelatedDataForGeneration() {
  const recommendations = new Set(getRecommendedDataPanelIds())
  selectedDataPanelIds.value = new Set(dataPanels.value
    .filter(item => manualDataPanelSelection.value.get(item.id) ?? recommendations.has(item.id))
    .map(item => item.id))
}

function getRecommendedDataPanelIds(): string[] {
  if (!chapter.value || !novel.value) return []
  const planText = getCurrentChapterPlanText()
  const source = `${chapter.value.title}\n${planText}\n${content.value}`
  return dataPanels.value
    .filter(item => {
      const keywords = [item.name, ...item.relatedKeywords].filter(Boolean)
      return keywords.some(keyword => source.includes(keyword))
        || item.lastMentionChapterIndex === chapter.value!.chapterIndex - 1
    })
    .map(item => item.id)
}

function getCurrentChapterPlanText(): string {
  if (!chapter.value || !novel.value) return ''
  return (novel.value.chapterPlans || []).filter(plan =>
    plan.status !== 'archived'
    && chapter.value!.chapterIndex >= plan.targetChapterStart
    && chapter.value!.chapterIndex <= plan.targetChapterEnd
  )
    .map(plan => [plan.title, plan.objective, plan.summary, ...plan.beats].join('\n'))
    .join('\n')
}

function formatSelectedDataPanels(limit = 1200) {
  if (selectedDataPanels.value.length === 0) return ''
  const lines = selectedDataPanels.value.map(item => {
    const fieldLines = item.fields.map(field => {
      const type = field.type && field.type !== 'text' ? `（${field.type}${field.formula ? `:${field.formula}` : ''}）` : ''
      return `  - ${field.name}${type}：${field.value}${field.unit ? ` ${field.unit}` : ''}`
    }).join('\n')
    return `- ${item.name}（${equipmentSnapshot(item, dataPanels.value)}）\n${fieldLines}\n${formatEquipmentTotals(dataPanels.value, item.id)}`
  })
  const context = `\n\n【本章关联数据面板（已确认事实，只能参考，不要擅自修改）】\n${lines.join('\n')}`
  return context.length > limit ? context.slice(0, limit) : context
}

function applyDataChange(changeId: string) {
  const applied = novelStore.applyDataPanelChange(novelId.value, changeId, dataChangeDrafts.value[changeId])
  if (!applied) {
    message.warning('当前数据已变化，未覆盖现有值；请重新扫描或检查这条变更')
    return
  }
  delete dataChangeDrafts.value[changeId]
  clearDataChangeSelection(changeId)
  message.success('数据变更已应用')
}

function rejectDataChange(changeId: string) {
  novelStore.rejectDataPanelChange(novelId.value, changeId)
  delete dataChangeDrafts.value[changeId]
  clearDataChangeSelection(changeId)
  message.success('已忽略该变更')
}

function applySelectedDataChanges() {
  const ids = selectedPendingDataChanges.value.map(change => change.id)
  const count = novelStore.applyDataPanelChanges(novelId.value, ids, dataChangeDrafts.value)
  for (const id of ids) delete dataChangeDrafts.value[id]
  clearDataChangeSelection()
  if (count) message.success(`已批量应用 ${count} 条数据变更`)
  if (count < ids.length) message.warning(`${ids.length - count} 条变更因当前值已变化而保留待确认`)
}

function rejectSelectedDataChanges() {
  const ids = selectedPendingDataChanges.value.map(change => change.id)
  const count = novelStore.rejectDataPanelChanges(novelId.value, ids)
  for (const id of ids) delete dataChangeDrafts.value[id]
  clearDataChangeSelection()
  if (count) message.success(`已批量忽略 ${count} 条数据变更`)
}

function cleanupDataHistory(mode: 'all' | 'count' | 'chapters') {
  const cleanup = mode === 'all'
    ? { mode } as const
    : { mode, value: mode === 'count' ? dataHistoryKeepCount.value : dataHistoryKeepChapters.value }
  const removed = novelStore.cleanupDataPanelChanges(novelId.value, cleanup)
  message.success(removed ? `已清理 ${removed} 条已处理记录` : '没有需要清理的记录')
}

function queueAutomaticDataChanges() {
  if (!chapter.value) return
  const source = `${chapter.value.title}\n${getCurrentChapterPlanText()}\n${content.value}`
  const count = novelStore.queueAutomaticDataPanelChanges(novelId.value, chapter.value.chapterIndex, source)
  if (count) {
    dataPanelOpen.value = true
    message.info(`已生成 ${count} 条自动推算结果，请确认后写入`)
  } else {
    message.info('当前章节没有需要推算的新结果')
  }
}

function toggleSection(key: keyof typeof expandedSections.value) {
  expandedSections.value[key] = !expandedSections.value[key]
}

function changeFontSize(delta: number) {
  fontSize.value = Math.max(12, Math.min(24, fontSize.value + delta))
  if (textareaRef.value) {
    textareaRef.value.style.fontSize = fontSize.value + 'px'
  }
  const overlay = document.querySelector('.highlight-overlay') as HTMLElement
  if (overlay) overlay.style.fontSize = fontSize.value + 'px'
}

// 实时违禁词扫描（debounced，避免每次击键都全量扫描）
const liveScanResults = ref<ReturnType<typeof scanBannedWords>>([])
let scanTimer: ReturnType<typeof setTimeout> | null = null
let continuityTimer: ReturnType<typeof setTimeout> | null = null
watch(() => content.value, () => {
  if (scanTimer) clearTimeout(scanTimer)
  if (continuityTimer) clearTimeout(continuityTimer)
  scanTimer = setTimeout(() => {
    if (!content.value) { liveScanResults.value = []; return }
    liveScanResults.value = scanBannedWords(content.value, builtInBannedWords)
  }, 500)
  continuityTimer = setTimeout(() => {
    if (!content.value || !novel.value || !chapter.value) { continuityAlerts.value = []; return }
    continuityAlerts.value = scanContinuity(novel.value, chapter.value, content.value)
  }, 900)
})

// 高亮内容（HTML overlay）
const highlightedContent = computed(() => {
  if (!content.value || !highlightEnabled.value) return ''
  let html = content.value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // 标记违禁词
  for (const item of liveScanResults.value) {
    const word = item.word.word
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const color = item.word.level === 'must' ? '#ff4d4f' : '#faad14'
    html = html.replace(
      new RegExp(escaped, 'g'),
      `<mark style="background:${color}33;color:${color};border-bottom:2px solid ${color};border-radius:2px;">${word}</mark>`
    )
  }
  return html + '\n'
})

function syncScroll() {
  const overlay = document.querySelector('.highlight-overlay') as HTMLElement
  if (overlay && textareaRef.value) {
    overlay.scrollTop = textareaRef.value.scrollTop
    overlay.scrollLeft = textareaRef.value.scrollLeft
  }
}

function toggleHighlight() {
  highlightEnabled.value = !highlightEnabled.value
}

// 加载内容
onMounted(() => {
  if (chapter.value) {
    content.value = chapter.value.content
    chapterStoryDays.value = chapter.value.storyDaysElapsed || 0
    endingCheckResult.value = null
    pendingRevision.value = null
    bannedResult.value = chapter.value.bannedReview || ''
    contentReviewResult.value = chapter.value.contentReview || ''
    editableReviewText.value = extractActionableReview(chapter.value.contentReview || '')
    lastContentReviewSignature.value = chapter.value.contentReviewSignature || ''
    reviewCoverage.value = chapter.value.contentReviewCoverage
    reviewPanelOpen.value = hasReviewContent.value
    void loadPendingRevision()
    // 如果是新章节（内容为空），延迟 600ms 后自动续写
    if (writingMode.value === 'ai' && !content.value && configStore.getModelForTask('writing')) {
      setTimeout(() => {
        if (content.value || pendingRevision.value || aiWriting.value) return
        message.info('新章节已创建，AI 开始续写...')
        aiContinue()
      }, 600)
    }
  }
  // 自动保存定时器（每 5 秒）
  autoSaveTimer = setInterval(() => {
    if (unsaved.value && !savingContent.value) {
      void saveContent()
    }
  }, 5000)
  const unsubscribeQueue = chapterBackgroundQueue.subscribe(() => {
    backgroundTaskPendingCount.value = chapterBackgroundQueue.pendingCount
    if (chapterBackgroundQueue.status === 'running') {
      backgroundTaskStatus.value = `后台处理中：${chapterBackgroundQueue.currentTaskName}（剩余 ${chapterBackgroundQueue.pendingCount}）`
    } else if (chapterBackgroundQueue.status === 'pending') {
      backgroundTaskStatus.value = `后台任务等待中（剩余 ${chapterBackgroundQueue.pendingCount}）`
    } else if (chapterBackgroundQueue.status === 'failed') {
      backgroundTaskStatus.value = '后台任务失败，已继续处理后续任务'
    } else if (chapterBackgroundQueue.status === 'completed') {
      backgroundTaskStatus.value = '后台审查和分析已完成'
      setTimeout(() => {
        if (chapterBackgroundQueue.pendingCount === 0) backgroundTaskStatus.value = ''
      }, 3000)
    }
  })
  onUnmounted(unsubscribeQueue)
  // 注册快捷键
  window.addEventListener('keydown', handleKeydown)
})

onDeactivated(() => window.removeEventListener('keydown', handleKeydown))
onActivated(() => window.addEventListener('keydown', handleKeydown))

const unregisterDraftSaver = registerDraftSaver(async () => {
  if (!unsaved.value) return
  if (!(await saveContent()) || unsaved.value) throw new Error('正文尚未保存完成，请稍后重试。')
})

onUnmounted(() => {
  completionController?.abort(new DOMException('编辑器已关闭', 'AbortError'))
  unregisterDraftSaver()
  if (autoSaveTimer) clearInterval(autoSaveTimer)
  if (scanTimer) clearTimeout(scanTimer)
  if (continuityTimer) clearTimeout(continuityTimer)
  stopGeneration()
  window.removeEventListener('keydown', handleKeydown)
  // 离开时保存
  if (unsaved.value) void saveContent()
})

// 快捷键处理
function handleKeydown(e: KeyboardEvent) {
  // Ctrl+S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    void saveContent().then(saved => {
      if (saved) message.success('已保存')
      else if (!aiDrafting.value) message.warning('保存失败，内容仍标记为未保存')
    })
  }
  // Ctrl+Enter AI 续写
    if (writingMode.value === 'ai' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    if (!aiWriting.value && !completing.value) {
      aiContinue()
    }
  }
  // Escape 停止 AI
  if (e.key === 'Escape') {
    if (aiWriting.value || completing.value) {
      stopAI()
    }
  }
}

// 监听内容变化
function onInput() {
  if (isChapterLocked.value) return
  unsaved.value = true
  lastContentReviewSignature.value = ''
  if (chapter.value) chapter.value.reviewRewriteBlockedSignature = ''
  endingCheckResult.value = null
}

function isDefaultChapterTitle(title: string): boolean {
  return /^第[一二三四五六七八九十百千万\d]+章$/.test(title.trim())
}

function extractLeadingChapterHeading(text: string): { title: string; body: string } | null {
  const normalized = text.replace(/^\uFEFF/, '')
  const match = normalized.match(/^\s*(?:#{1,6}\s*)?(第[一二三四五六七八九十百千万\d]+\s*[章节回]?[：:、.\s-]*[^\n]{0,24})\s*\n+/)
  if (!match) return null
  const title = match[1]
    .replace(/\*\*/g, '')
    .replace(/[《》「」“”"'`]/g, '')
    .replace(/^第[一二三四五六七八九十百千万\d]+\s*[章节回]?[：:、.\s-]*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const body = normalized.slice(match[0].length).replace(/^\s*\n+/, '')
  if (!title || !body.trim()) return null
  return { title, body }
}

function normalizeGeneratedChapterHeading() {
  if (!chapter.value || !content.value) return
  const extracted = extractLeadingChapterHeading(content.value)
  if (!extracted) return
  content.value = extracted.body
  const currentTitle = chapter.value.title.trim()
  if (isDefaultChapterTitle(currentTitle) || extracted.title.startsWith(currentTitle)) {
    novelStore.updateChapter(novelId.value, chapterId.value, { title: extracted.title })
  }
  unsaved.value = true
}

// 保存内容
async function saveContent(): Promise<boolean> {
  if (!chapter.value || isChapterLocked.value || savingContent.value) return false
  if (writingMode.value === 'ai') normalizeGeneratedChapterHeading()
  if (aiDrafting.value) {
    unsaved.value = true
    return false
  }
  const contentSnapshot = content.value
  const contentSignature = getContentSignature(content.value)
  const reviewSignature = getChapterContextSignature()
  const shouldKeepReviewSignature = lastContentReviewSignature.value === reviewSignature
    || chapter.value.contentReviewSignature === reviewSignature
  const updated = novelStore.updateChapter(novelId.value, chapterId.value, {
    content: content.value,
    contentReviewSignature: shouldKeepReviewSignature ? reviewSignature : '',
    reviewRewriteBlockedSignature: chapter.value.reviewRewriteBlockedSignature === contentSignature
      ? contentSignature
      : '',
    status: content.value === chapter.value.content && ['completed', 'finalized', 'locked'].includes(chapter.value.status)
      ? chapter.value.status : content.value.length > 0 ? 'writing' : 'draft',
  })
  if (!updated) return false
  lastContentReviewSignature.value = shouldKeepReviewSignature ? reviewSignature : ''
  savingContent.value = true
  unsaved.value = true
  try {
    await novelStore.saveNovelNow(novelId.value)
    if (content.value === contentSnapshot) unsaved.value = false
    return true
  } catch (err) {
    unsaved.value = true
    console.error('Chapter save failed', err)
    return false
  } finally {
    savingContent.value = false
  }
}

// 保存标题
function updateChapterTitle(title: string) {
  if (!chapter.value || isChapterLocked.value || aiWriting.value) return
  if (novelStore.updateChapter(novelId.value, chapterId.value, { title })) unsaved.value = true
}

async function saveTitle() {
  if (!chapter.value || isChapterLocked.value || savingContent.value) return
  const contentSnapshot = content.value
  const updated = novelStore.updateChapter(novelId.value, chapterId.value, {
    title: chapter.value.title,
  })
  if (!updated) return
  savingContent.value = true
  unsaved.value = true
  try {
    await novelStore.saveNovelNow(novelId.value)
    if (content.value === contentSnapshot) unsaved.value = false
  } catch (err) {
    console.error('Chapter title save failed', err)
  } finally {
    savingContent.value = false
  }
}

async function ensureGeneratedDraftEnding(
  writingModel: import('@/stores/config').ModelConfig,
  factCard: string,
  writingPlan: string,
  chapterGuidance: string,
  activityParentId?: string,
): Promise<ChapterEndingCheck> {
  const reviewModel = configStore.getModelForTask('review') || writingModel
  const signal = getGenerationSignal()
  const maxAttempts = 1
  aiStatusText.value = 'AI 正在检查章节结尾是否完整...'
  async function checkCurrentEnding() {
    const signature = getChapterContextSignature()
    const result = await requestChapterEndingCheck(reviewModel, content.value, chapterGuidance, writingPlan, signal, activityParentId)
    signal.throwIfAborted()
    if (signature !== getChapterContextSignature()) throw new Error('正文或设定已变化，未采纳旧版本的结尾检查')
    return result
  }
  let check = await checkCurrentEnding()
  if (!chapterEndingPasses(check) && aiWriting.value) {
    aiStatusText.value = `章节结尾尚未收束，AI 正在补完当前剧情节拍（第 1/${maxAttempts} 次）...`
    const signature = getChapterContextSignature()
    const continuation = await generateEndingContinuation(
      writingModel,
      content.value,
      check,
      chapterGuidance,
      writingPlan,
      factCard,
      signal,
      activityParentId,
    )
    signal.throwIfAborted()
    if (signature !== getChapterContextSignature()) throw new Error('正文或设定已变化，未写入旧版本的收尾')
    if (continuation) {
      content.value = `${content.value.replace(/\s+$/, '')}\n\n${continuation}`
      unsaved.value = true
      check = await checkCurrentEnding()
    }
  }
  return check
}

async function gateChapterEndingBeforeStatusChange(
  writingModel: import('@/stores/config').ModelConfig,
  reviewModel: import('@/stores/config').ModelConfig,
  activityParentId?: string,
): Promise<boolean> {
  if (!novel.value || !chapter.value) return false
  const sourceNovelId = novelId.value
  const sourceChapterId = chapterId.value
  const sourceContent = content.value
  const ctx = buildWritingContext(novel.value, chapter.value)
  const chapterGuidance = ctx.chapterGuidance
  const factCard = buildChapterFactCard(novel.value, chapter.value, ctx)
  const contentSignature = getChapterContextSignature()
  if (
    endingCheckResult.value
    && lastEndingCheckSignature.value === contentSignature
    && chapterEndingPasses(endingCheckResult.value)
  ) {
    return true
  }

  completingHint.value = '1/4 检查章节结尾...'
  const initialCheck = await requestChapterEndingCheck(reviewModel, content.value, chapterGuidance, '', completionController?.signal, activityParentId)
  assertChapterSnapshot(sourceNovelId, sourceChapterId, sourceContent)
  if (contentSignature !== getChapterContextSignature()) throw new Error('设定已变化，请重新检查本章')
  endingCheckResult.value = initialCheck
  lastEndingCheckSignature.value = contentSignature
  if (chapterEndingPasses(initialCheck)) return true

  reviewPanelOpen.value = true
  if (writingMode.value === 'manual') {
    message.warning(`本章结尾检查未通过：${initialCheck.openAction || initialCheck.reason || '当前剧情节拍尚未收束'}。辅助写作模式不会自动修改正文，请手动调整后再完成本章`)
    return false
  }

  let proposedContent = content.value
  let proposalCheck = initialCheck
  for (let attempt = 0; attempt < 2 && !chapterEndingPasses(proposalCheck); attempt++) {
    completingHint.value = `章节结尾不完整，正在生成自然收尾修订（第 ${attempt + 1}/2 次）...`
    const continuation = await generateEndingContinuation(
      writingModel,
      proposedContent,
      proposalCheck,
      chapterGuidance,
      '',
      factCard,
      completionController?.signal,
      activityParentId,
    )
    assertChapterSnapshot(sourceNovelId, sourceChapterId, sourceContent)
    if (!continuation) break
    if (contentSignature !== getChapterContextSignature()) throw new Error('设定已变化，未使用旧版本的收尾')
    proposedContent = `${proposedContent.replace(/\s+$/, '')}\n\n${continuation}`
    if (inspectChapterLength(proposedContent, chapterLengthPolicy.value).status !== 'within') {
      proposedContent = await requestChapterLengthRepair({
        model: writingModel, source: proposedContent, policy: chapterLengthPolicy.value,
        factCard, guidance: chapterGuidance, signal: completionController?.signal, activityParentId,
      })
      assertChapterSnapshot(sourceNovelId, sourceChapterId, sourceContent)
      if (contentSignature !== getChapterContextSignature()) throw new Error('正文或设定已变化，未使用旧版本的收尾候选')
    }
    proposalCheck = await requestChapterEndingCheck(reviewModel, proposedContent, chapterGuidance, '', completionController?.signal, activityParentId)
    assertChapterSnapshot(sourceNovelId, sourceChapterId, sourceContent)
  }

  const issue = initialCheck.openAction || initialCheck.reason || '当前剧情节拍尚未收束'
  if (proposedContent !== content.value) {
    const proposalStatus = chapterEndingPasses(proposalCheck) ? '已通过结尾复检' : '仍需人工检查'
    const revision = await novelStore.proposeChapterRevision(
      novelId.value,
      chapterId.value,
      proposedContent,
      'review',
      `章节结尾不完整：${issue}。AI 已生成自然收尾，${proposalStatus}，请确认后写入。`,
    )
    if (revision) pendingRevision.value = revision
  }

  message.warning(`本章暂不能完成：${issue}。${proposedContent !== content.value ? '已生成自然收尾 Diff，请先确认。' : '请按结尾检查建议完成当前剧情节拍。'}`)
  return false
}

async function selfCheckDraft(
  model: import('@/stores/config').ModelConfig,
  factCard: string,
  writingPlan: string,
  activityParentId?: string,
) {
  if (isChapterLocked.value || !novel.value || !chapter.value || !content.value.trim()) return
  aiStatusText.value = 'AI 正在自检本章设定一致性...'
  try {
    const result = await callAI({
      model,
      skillTask: 'review',
      messages: buildChapterSelfCheckPrompt(novel.value, factCard, writingPlan, content.value),
      maxTokens: Math.min(model.maxTokens || 1200, 1200),
      noAutomaticRetry: true,
      signal: getGenerationSignal(),
      taskName: '一致性自检',
      activityParentId,
    })
    const parsed = parseAiJsonObject<{
      needsRevision?: boolean
      severity?: string
      issues?: string[]
    }>(result.content)
    if (parsed?.needsRevision) {
      message.warning(`自检发现 ${parsed.issues?.length || 1} 处待核对事项，将在完成本章时统一审查，原文保留`)
    }
  } catch (error) {
    getGenerationSignal().throwIfAborted()
    message.warning('AI 自检失败，已保留当前正文')
  }
}

function aiContinue() {
  if (writingMode.value !== 'ai') {
    message.info('当前为人工主笔辅助模式；如需 AI 续写，请先切换正文创作方式')
    return
  }
  if (!chapter.value || !novel.value || isChapterLocked.value) return
  if (currentContentWordCount.value >= chapterLengthPolicy.value.minWords) {
    message.info(`本章已达到 ${chapterLengthPolicy.value.minWords} 字，请先点击“完成本章”进行收束和审查`)
    return
  }
  selectRelatedDataForGeneration()
  void runAiContinue()
}

// AI 续写
async function runAiContinue() {
  if (writingMode.value !== 'ai') {
    message.info('当前为人工主笔辅助模式；如需 AI 续写，请先切换正文创作方式')
    return
  }
  if (isChapterLocked.value || !novel.value || !chapter.value || aiWriting.value || aiDrafting.value || completing.value) return
  if (pendingRevision.value) {
    message.info('请先处理当前待确认的正文修订')
    return
  }
  const model = configStore.getModelForTask('writing')
  if (!model) {
    message.warning('请先在设置页面配置 AI 模型')
    return
  }
  const writingModel = model
  let draftEndingCheck: ChapterEndingCheck | null = null
  const generationActivity = startAiActivity('AI 生成章节')
  let generationFailure: unknown
  aiDrafting.value = true

  aiStatusText.value = 'AI 正在生成中...'
  beginGeneration()

  try {
    // 使用上下文窗口管理器组装上下文
    let ctx = buildWritingContext(novel.value, chapter.value)
    ctx = await augmentWritingContextWithVectorMemory(novel.value, chapter.value, ctx, configStore.embedding)
    aiStatusText.value = 'AI 正在整理本章事实卡...'
    const factCard = buildChapterFactCard(novel.value, chapter.value, ctx)
    let writingPlan = ''
    if (aiWorkflowPolicy.value.createWritingPlan) {
      aiStatusText.value = 'AI 正在制定本章写作计划...'
      writingPlan = await generateWritingPlan(writingModel, novel.value, factCard, ctx.chapterGuidance, generationActivity.id)
    }
    const dataPanelContext = formatSelectedDataPanels()

    async function generateOnce() {
      const messages = buildChapterPrompt(
        novel.value!,
        ctx.outlineContext,
        ctx.chapterGuidance || `第${chapter.value!.chapterIndex + 1}章`,
        ctx.previousSummary,
        ctx.lastParagraph,
        content.value,
        factCard,
        writingPlan,
      )
      if (dataPanelContext) {
        messages[messages.length - 1].content += dataPanelContext
      }

      const existingWordCount = countNovelWords(content.value)
      const remainingWords = Math.max(0, chapterLengthPolicy.value.targetWords - existingWordCount)
      const dynamicMaxTokens = chapterOutputTokenBudget(writingModel.maxTokens, remainingWords)

      await streamAppend(writingModel, messages, dynamicMaxTokens, {
        activityParentId: generationActivity.id,
        taskName: '正文生成',
      })
    }

    async function ensureMinimumWords() {
      let noProgressAttempts = 0
      while (countNovelWords(content.value) < chapterLengthPolicy.value.minWords && aiWriting.value) {
        const beforeWords = countNovelWords(content.value)
        aiStatusText.value = `当前 ${countNovelWords(content.value)} 字，AI 正在自动补足到 ${chapterLengthPolicy.value.minWords} 字以上...`
        await generateOnce()
        saveContent()
        const afterWords = countNovelWords(content.value)
        noProgressAttempts = afterWords > beforeWords ? 0 : noProgressAttempts + 1
        if (noProgressAttempts >= 2) {
          throw new Error(`AI 连续两次没有生成有效正文，当前仅 ${afterWords} 字，请稍后重试`)
        }
      }
    }

    aiStatusText.value = 'AI 正在生成正文...'
    await generateOnce()
    saveContent()

    await ensureMinimumWords()

    const wc = countNovelWords(content.value)
    if (wc < chapterLengthPolicy.value.minWords) {
      message.warning(`当前仅 ${wc} 字，低于 ${chapterLengthPolicy.value.minWords} 字最低标准，请继续生成后再完成本章`)
      return
    }

    getGenerationSignal().throwIfAborted()
    if (aiWorkflowPolicy.value.selfCheckDraft) {
      await selfCheckDraft(writingModel, factCard, writingPlan, generationActivity.id)
    }

    draftEndingCheck = await ensureGeneratedDraftEnding(
      writingModel,
      factCard,
      writingPlan,
      ctx.chapterGuidance,
      generationActivity.id,
    )
    getGenerationSignal().throwIfAborted()
    endingCheckResult.value = draftEndingCheck
    lastEndingCheckSignature.value = getChapterContextSignature()
    if (chapterEndingPasses(draftEndingCheck)) {
      if (chapterLengthInspection.value.status === 'long') message.warning('结尾检查通过，但正文超过篇幅上限；已保留草稿，请生成压缩候选后再完成本章')
      else message.success('AI 续写完成，章节结尾完整性检查已通过')
    } else {
      message.warning(`AI 续写已完成，但结尾复检仍未通过：${draftEndingCheck.openAction || draftEndingCheck.reason}`)
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') generationFailure = err
    if (err.name !== 'AbortError') {
      message.error('AI 续写失败：' + err.message)
    } else {
      saveContent()
      const wc = countNovelWords(content.value)
      if (wc < chapterLengthPolicy.value.minWords) {
        message.warning(`当前仅 ${wc} 字，低于 ${chapterLengthPolicy.value.minWords} 字最低标准，请继续生成`)
      } else {
        message.info(`已停止生成，当前 ${wc} 字；未把目标字数当作章节结束依据`)
      }
    }
  } finally {
    aiDrafting.value = false
    aiWriting.value = false
    if (content.value && !isChapterLocked.value) {
      await saveContent()
    }
    finishAiActivity(generationActivity, generationFailure)
  }
}

function stopAI() {
  if (completing.value) {
    completingHint.value = '正在停止，等待当前操作结束...'
    completionController?.abort(new DOMException('已停止完成流程', 'AbortError'))
    stopGeneration()
    return
  }
  stopGeneration()
}

// --- 完成章节的子步骤 ---

function assertChapterSnapshot(sourceNovelId: string, sourceChapterId: string, sourceContent: string) {
  if (completionController?.signal.aborted) throw completionController.signal.reason
  if (novelId.value !== sourceNovelId || chapterId.value !== sourceChapterId || content.value !== sourceContent
    || chapter.value?.content !== sourceContent) {
    throw new Error('章节或正文已变化，已停止处理旧版本，请重新完成本章')
  }
}

async function generateChapterCompletion(
  model: import('@/stores/config').ModelConfig,
  activityParentId?: string,
) {
  completingHint.value = '3/4 整理章节总结...'
  const sourceNovelId = novelId.value
  const sourceChapterId = chapterId.value
  const sourceContent = content.value
  const currentTitle = chapter.value!.title
  const metadata = await requestChapterMetadata({
    model,
    chapterContent: content.value,
    chapterTitle: currentTitle,
    chapterIndex: chapter.value!.chapterIndex + 1,
    activityParentId,
    signal: completionController?.signal,
  })
  assertChapterSnapshot(sourceNovelId, sourceChapterId, sourceContent)
  const updates: { title?: string; summary?: string } = {}
  updates.summary = metadata.summary
  if (isPlaceholderChapterTitle(currentTitle) && metadata.title) updates.title = metadata.title
  if (Object.keys(updates).length > 0) {
    novelStore.updateChapter(novelId.value, chapterId.value, updates)
  }
}

interface BannedReviewTarget {
  novelId: string
  chapterId: string
  content: string
}

async function reviewBannedWords(
  model: import('@/stores/config').ModelConfig,
  target?: BannedReviewTarget,
  activityParentId?: string,
) {
  const targetNovelId = target?.novelId || novelId.value
  const targetChapterId = target?.chapterId || chapterId.value
  const targetContent = target?.content ?? content.value
  if (!targetContent.trim()) return
  const isCurrentChapter = () => targetNovelId === novelId.value && targetChapterId === chapterId.value
  if (isCurrentChapter()) {
    message.info('正在自动进行违禁词审查...')
    bannedResult.value = ''
  }
  let result = ''
  const reviewMessages = buildBannedWordsCheckPrompt(targetContent)
  await callAI({
    model,
    skillTask: 'review',
    messages: reviewMessages,
    stream: true,
    activityParentId,
    onChunk: (chunk) => { result += chunk },
  })
  novelStore.updateChapter(targetNovelId, targetChapterId, { bannedReview: result })
  if (isCurrentChapter()) {
    bannedResult.value = result
    message.success('违禁审查完成')
  }
}

function isValidContentReviewText(reviewText: string): boolean {
  return contentReviewVerdict(reviewText) !== 'unknown'
}

async function requestContentReview(
  model: import('@/stores/config').ModelConfig,
  options: { liveUpdate?: boolean; activityParentId?: string; candidateContent?: string; signal?: AbortSignal; onCoverage?: (coverage: StoredReviewCoverage) => void } = {},
): Promise<string> {
  const targetContent = options.candidateContent ?? content.value
  const reviewModel = configStore.getModelForTask('review') || model
  const sourceNovelId = novelId.value
  const sourceChapterId = chapterId.value
  const sourceContent = content.value
  const contextSignature = getChapterContextSignature()
  const targetSignature = getChapterContextSignature(targetContent)
  const signal = options.signal || completionController?.signal || getGenerationSignal()
  const ensureCurrent = () => {
    signal.throwIfAborted()
    assertChapterSnapshot(sourceNovelId, sourceChapterId, sourceContent)
    if (contextSignature !== getChapterContextSignature()) throw new Error('设定已变化，已跳过旧版本的审查结果')
  }
  return requestCoveredContentReview({
    source: targetContent, chapterIndex: chapter.value!.chapterIndex, model: reviewModel,
    buildContext: text => buildReviewContext(novel.value!, chapter.value!, text),
    ensureCurrent, signal, activityParentId: options.activityParentId,
    onRetry: () => message.warning('内容审查返回为空或格式不完整，正在自动重试...'),
    onChunk: report => {
      if (options.liveUpdate && chapterId.value === sourceChapterId) contentReviewResult.value = report
    },
    onProgress: progress => {
    const coverage = { ...progress, signature: targetSignature }
    options.onCoverage?.(coverage)
    if (options.candidateContent === undefined && novelId.value === sourceNovelId && chapterId.value === sourceChapterId) {
      reviewCoverage.value = coverage
      novelStore.updateChapter(sourceNovelId, sourceChapterId, { contentReviewCoverage: coverage })
      if (completing.value) completingHint.value = '2/4 ' + reviewCoverageLabel(coverage)
    }
    },
  })
}

function saveContentReviewResult(reviewText: string) {
  const localReviewBlock = buildLocalConsistencyReviewBlock(content.value)
  const mergedReviewText = [localReviewBlock, reviewText].filter(Boolean).join('\n\n---\n\n')
  contentReviewResult.value = mergedReviewText
  editableReviewText.value = extractActionableReview(mergedReviewText)
  const reviewSignature = getChapterContextSignature()
  lastContentReviewSignature.value = reviewSignature
  novelStore.updateChapter(novelId.value, chapterId.value, {
    contentReview: mergedReviewText,
    contentReviewSignature: reviewSignature,
  })
}

async function reviewContentConsistency(
  model: import('@/stores/config').ModelConfig,
  activityParentId?: string,
): Promise<string> {
  completingHint.value = '2/4 审查章节内容...'
  const previousReview = contentReviewResult.value
  const previousEditableReview = editableReviewText.value
  const previousSignature = lastContentReviewSignature.value
  contentReviewResult.value = ''
  reviewLoading.value = true
  reviewPanelOpen.value = true
  try {
    const reviewText = await requestContentReview(model, { activityParentId, liveUpdate: true })
    saveContentReviewResult(reviewText)
    await novelStore.saveNovelNow(novelId.value)
    return contentReviewResult.value
  } catch (error) {
    contentReviewResult.value = previousReview
    editableReviewText.value = previousEditableReview
    lastContentReviewSignature.value = previousSignature
    throw error
  } finally {
    reviewLoading.value = false
  }
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (value === '十') return 10
  const tenIndex = value.indexOf('十')
  if (tenIndex >= 0) {
    const left = value.slice(0, tenIndex)
    const right = value.slice(tenIndex + 1)
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0)
  }
  return digits[value] ?? null
}

function relativeDayOffset(label: string | undefined): number {
  if (!label || label === '今日' || label === '今天' || label === '当天' || label === '当日') return 0
  if (label === '明日' || label === '明天' || label === '次日' || label === '翌日' || label === '第二天') return 1
  if (label === '后日' || label === '后天') return 2
  return 0
}

function parseForecastWindow(text: string): { min: number; max: number } | null {
  const dayRange = text.match(/([一二两三四五六七八九十\d]+)[日天]到([一二两三四五六七八九十\d]+)[日天]/)
  if (dayRange) {
    const min = parseChineseNumber(dayRange[1])
    const max = parseChineseNumber(dayRange[2])
    if (min !== null && max !== null) return { min, max }
  }

  const halfDay = text.match(/([一二两三四五六七八九十\d]+)日半/)
  if (halfDay) {
    const value = parseChineseNumber(halfDay[1])
    if (value !== null) return { min: value + 0.5, max: value + 0.5 }
  }

  const relative = text.match(/(最早|最迟|顶多|至多)?(今日|今天|当天|当日|明日|明天|次日|翌日|第二天|后日|后天)/)
  if (relative) {
    const offset = relativeDayOffset(relative[2])
    return { min: offset, max: offset }
  }

  const single = text.match(/([一二两三四五六七八九十\d]+)[日天](?:内|左右|之内|就会|会|到)?/)
  if (single) {
    const value = parseChineseNumber(single[1])
    if (value !== null) return { min: value, max: value }
  }

  return null
}

function buildTrendForecastFindings(text: string): string[] {
  const findings: string[] = []
  const sentencePattern = /[^。！？\n]*(?:峰值|可采标准|成熟|采收)[^。！？\n]*(?:。|！|？|$)/g
  const forecasts: Array<{ evidence: string; index: number; day: number; maxAbsDay: number; hasAcceleration: boolean }> = []
  let match: RegExpExecArray | null

  while ((match = sentencePattern.exec(text))) {
    const evidence = match[0].trim()
    const window = parseForecastWindow(evidence)
    if (!window) continue
    const prefix = text.slice(Math.max(0, match.index - 180), match.index)
    const nearby = `${prefix}${evidence}`
    const dayLabel = nearby.match(/(第二日清晨|第二天清晨|次日清晨|翌日清晨|明日清晨|当天|当日|今日|今天|后日|后天)/)?.[1]
    const currentDay = dayLabel?.startsWith('第二') ? 2 : relativeDayOffset(dayLabel)
    forecasts.push({
      evidence,
      index: match.index,
      day: currentDay,
      maxAbsDay: currentDay + window.max,
      hasAcceleration: /更快|加快|变快|超出预期|比[^。！？\n]{0,20}还要快|速度[^。！？\n]{0,12}快/.test(nearby),
    })
  }

  for (let i = 1; i < forecasts.length; i++) {
    const prev = forecasts[i - 1]
    const current = forecasts[i]
    const accelerationContext = prev.hasAcceleration || current.hasAcceleration
    if (accelerationContext && current.maxAbsDay > prev.maxAbsDay) {
      findings.push(`1. [设定冲突检测] 生长趋势加快但峰值预估上限反而外扩
   - 原文证据一：「${prev.evidence}」
   - 原文证据二：「${current.evidence}」
   - 问题原因：前序预估折算最迟为第 ${prev.maxAbsDay} 日，后续预估折算最迟为第 ${current.maxAbsDay} 日；正文同时出现“更快/加快/超出预期”等趋势信号时，最迟达成日应收紧或持平，不能向后外扩。
   - 修改建议：将后续预估改为不晚于第 ${prev.maxAbsDay} 日的窗口，例如“一日内、顶多一日半”，或删除“更快/超出预期”的趋势判断。`)
    }
  }

  return findings
}

function buildLocalConsistencyReviewBlock(text: string): string {
  const findings: string[] = []
  const basePattern = /距月底(?:采收)?还有([一二两三四五六七八九十\d]+)[日天]/g
  let baseMatch: RegExpExecArray | null

  while ((baseMatch = basePattern.exec(text))) {
    const baseRemaining = parseChineseNumber(baseMatch[1])
    if (baseRemaining === null) continue

    const afterBase = text.slice(baseMatch.index + baseMatch[0].length, baseMatch.index + baseMatch[0].length + 900)
    const currentDayMatch = afterBase.match(/(次日|翌日|第二天|明日|明天|今日|今天|当天|当日|后日|后天)[\s\S]{0,260}?((?:今日|今天|当天|当日|明日|明天|次日|翌日|第二天|后日|后天)?)[^。！？\n]{0,80}?离月底还有(?:整整)?([一二两三四五六七八九十\d]+)[日天]/)
    if (!currentDayMatch) continue

    const currentOffset = relativeDayOffset(currentDayMatch[1])
    const targetOffset = relativeDayOffset(currentDayMatch[2])
    const claimedRemaining = parseChineseNumber(currentDayMatch[3])
    if (claimedRemaining === null) continue

    const expectedRemaining = baseRemaining - currentOffset - targetOffset
    if (expectedRemaining >= 0 && expectedRemaining !== claimedRemaining) {
      findings.push(`1. [剧情连贯性] 相对时间剩余天数自相矛盾
   - 原文证据：「${baseMatch[0]}」；后文「${currentDayMatch[0]}」
   - 问题原因：以“${baseMatch[0]}”为基准，${currentDayMatch[1]}再计算“${currentDayMatch[2] || '当前'}”后，离月底应剩 ${expectedRemaining} 天，而正文写成 ${claimedRemaining} 天。
   - 修改建议：统一时间轴，改为“离月底还有${expectedRemaining}天”，或调整前文基准天数。`)
    }
  }

  findings.push(...buildTrendForecastFindings(text))

  if (findings.length === 0) return ''
  return `## 本地硬伤预检（必须修改）
${findings.join('\n\n')}`
}

function getReusableContentReview(currentSignature: string): string {
  const existingReview = contentReviewResult.value || chapter.value?.contentReview || ''
  if (!existingReview) return ''

  const existingSignature = lastContentReviewSignature.value || chapter.value?.contentReviewSignature || ''
  if (existingSignature === currentSignature && isValidContentReviewText(existingReview)
    && isReviewCoverageComplete(reviewCoverage.value, currentSignature, content.value)) return existingReview

  return ''
}

async function handleChapterPrimaryAction() {
  if (chapterActionDisabled.value) return
  try {
    if (readyForNextChapter.value) await nextChapter()
    else await completeChapter()
  } catch (error) {
    completing.value = false
    message.error(error instanceof Error ? error.message : String(error))
  }
}

async function completeChapter() {
  if (isChapterLocked.value || !chapter.value || !novel.value) return
  if (aiWriting.value || aiDrafting.value || completing.value) {
    message.info('请等待当前 AI 任务完成后，再完成本章')
    return
  }
  if (pendingRevision.value) {
    reviewPanelOpen.value = true
    message.info('请先处理当前待确认的正文修订')
    return
  }
  if (!(await saveContent())) return

  const currentWordCount = countNovelWords(content.value)
  if (currentWordCount < chapterLengthPolicy.value.minWords) {
    message.warning(`当前仅 ${currentWordCount} 字，低于 ${chapterLengthPolicy.value.minWords} 字最低标准，请继续生成后再完成本章`)
    return
  }

  completing.value = true
  const writingModel = configStore.getModelForTask('writing')
  const reviewModel = configStore.getModelForTask('review') || writingModel
  if (!writingModel || !reviewModel) {
    completing.value = false
    message.warning('请先配置写作和审查模型')
    return
  }

  const completionActivity = startAiActivity('完成本章')
  const controller = new AbortController()
  completionController = controller
  const targetNovelId = novelId.value
  const targetChapterId = chapterId.value
  let completionFailure: unknown
  let succeeded = false
  try {
    if (chapterLengthInspection.value.status === 'long') {
      if (writingMode.value === 'ai') await calibrateChapterLength({ keepCompleting: true, activityParentId: completionActivity.id })
      else message.warning(`当前正文超出最高 ${chapterLengthPolicy.value.maxWords} 字，请压缩正文或调整本书篇幅设置后再完成`)
      return
    }
    if (!(await gateChapterEndingBeforeStatusChange(writingModel, reviewModel, completionActivity.id))) return

    completingHint.value = '2/4 审查章节内容...'
    const currentSignature = getContentSignature(content.value)
    let reviewText = getReusableContentReview(getChapterContextSignature())
    if (reviewText) {
      completingHint.value = '2/4 已复用当前正文的审查结果'
    } else {
      reviewText = await reviewContentConsistency(reviewModel, completionActivity.id)
    }

    let reviewRewriteCycle = 0
    const maxReviewRewriteCycles = writingMode.value === 'ai' ? 1 : 0
    const rewriteAlreadyBlocked = chapter.value.reviewRewriteBlockedSignature === currentSignature
    if (reviewText && reviewNeedsRewrite(reviewText) && rewriteAlreadyBlocked) {
      reviewPanelOpen.value = true
      message.warning('当前这版正文已达到自动重写上限，请先修改正文或重新生成后再进行审查')
      return
    }
    while (reviewText && reviewNeedsRewrite(reviewText) && reviewRewriteCycle < maxReviewRewriteCycles) {
      reviewRewriteCycle += 1
      completingHint.value = `2/4 尝试局部修正（${reviewRewriteCycle}/${maxReviewRewriteCycles}）...`
      const rewriteOk = await rewriteFromReview(reviewText, {
        keepCompleting: true,
        model: writingModel,
        activityParentId: completionActivity.id,
      })
      if (!(await saveContent())) throw new Error('正文尚未保存，请重试')
      if (controller.signal.aborted) throw controller.signal.reason

      const revisedWordCount = countNovelWords(content.value)
      if (!rewriteOk) {
        reviewPanelOpen.value = true
        return
      }
      if (inspectChapterLength(content.value, chapterLengthPolicy.value).status !== 'within') {
        const rangeText = revisedWordCount < chapterLengthPolicy.value.minWords
          ? `低于 ${chapterLengthPolicy.value.minWords} 字最低标准`
          : revisedWordCount > chapterLengthPolicy.value.maxWords
            ? `超过 ${chapterLengthPolicy.value.maxWords} 字硬上限`
            : '重写失败'
        message.warning(`自动重写后为 ${revisedWordCount} 字，${rangeText}，本章暂不完成`)
        reviewPanelOpen.value = true
        return
      }

      if (!(await gateChapterEndingBeforeStatusChange(writingModel, reviewModel, completionActivity.id))) return
      completingHint.value = `2/4 复审修改后的正文（${reviewRewriteCycle}/${maxReviewRewriteCycles}）...`
      reviewText = getReusableContentReview(getChapterContextSignature())
        || await reviewContentConsistency(reviewModel, completionActivity.id)
    }

    if (reviewText && reviewNeedsRewrite(reviewText)) {
      if (writingMode.value === 'manual') {
        message.warning('审查发现需要修改的问题，请根据审查面板手动修正正文后再完成本章')
        reviewPanelOpen.value = true
        return
      }
      const blockedSignature = getContentSignature(content.value)
      novelStore.updateChapter(novelId.value, chapterId.value, {
        reviewRewriteBlockedSignature: blockedSignature,
      })
      await novelStore.saveNovelNow(novelId.value)
      message.warning(`已达到 ${maxReviewRewriteCycles} 轮自动审查/重写上限，复审仍有需要修改的问题，本章暂不完成，请查看审查面板`)
      reviewPanelOpen.value = true
      return
    }

    if (controller.signal.aborted) throw controller.signal.reason
    if (novelId.value !== targetNovelId || chapterId.value !== targetChapterId) {
      throw new Error('章节已切换，请返回原章节继续完成')
    }
    const approvedContent = content.value
    if (inspectChapterLength(approvedContent, chapterLengthPolicy.value).status !== 'within') throw new Error('最终正文篇幅未达标，请调整后重新完成')
    if (!getReusableContentReview(getChapterContextSignature())) throw new Error('最终正文审查未完整覆盖，请重新审查')
    assertChapterSnapshot(targetNovelId, targetChapterId, approvedContent)
    const approvedSignature = getContentSignature(approvedContent)
    const manuallyEnteredDays = Math.max(0, Number(chapterStoryDays.value) || 0)
    const storyTimeAlreadyApplied = chapter.value.storyDay !== undefined
    novelStore.updateChapter(novelId.value, chapterId.value, {
      status: 'completed',
      ...(manuallyEnteredDays > 0 ? { storyDaysElapsed: manuallyEnteredDays } : {}),
    })
    if (manuallyEnteredDays > 0 && !storyTimeAlreadyApplied) {
      novelStore.advanceStoryClock(novelId.value, manuallyEnteredDays, chapter.value.chapterIndex)
    }
    await novelStore.saveNovelNow(targetNovelId)
    assertChapterSnapshot(targetNovelId, targetChapterId, approvedContent)
    if (lastMetadataSignature.value !== approvedSignature) {
      await generateChapterCompletion(writingModel, completionActivity.id)
      lastMetadataSignature.value = approvedSignature
      await novelStore.saveNovelNow(targetNovelId)
    }

    completingHint.value = '4/4 更新章节记忆...'
    assertChapterSnapshot(targetNovelId, targetChapterId, approvedContent)
    if (lastMemorySignature.value !== approvedSignature) {
      const applied = await analyzeChapterStructure(reviewModel, {
        target: { novelId: targetNovelId, chapterId: targetChapterId },
        replaceExistingAiTimeline: true,
        activityParentId: completionActivity.id,
        signal: controller.signal,
      })
      assertChapterSnapshot(targetNovelId, targetChapterId, approvedContent)
      if (!applied) throw new Error('章节记忆未返回有效结果，已保留审查结果，可继续完成本章')
      lastMemorySignature.value = approvedSignature
      novelStore.queueAutomaticDataPanelChanges(targetNovelId, chapter.value.chapterIndex,
        `${chapter.value.title}\n${getCurrentChapterPlanText()}\n${approvedContent}`)
      await novelStore.saveNovelNow(targetNovelId)
    }
    completingHint.value = '4/4 保存记忆与完成状态...'
    const kbStore = useKnowledgeStore()
    await syncSemanticIndexForNovel(novel.value, kbStore.knowledgeBases, configStore.embedding)
    assertChapterSnapshot(targetNovelId, targetChapterId, approvedContent)
    if (inspectChapterLength(approvedContent, chapterLengthPolicy.value).status !== 'within') throw new Error('篇幅设置已变化，最终正文未达标，请重新完成')
    novelStore.completeChapterPlans(targetNovelId, chapter.value.chapterIndex)
    novelStore.ensureNextChapterPlan(targetNovelId, chapter.value.chapterIndex)
    novelStore.updateChapter(targetNovelId, targetChapterId, { status: 'finalized' })
    try {
      await novelStore.saveNovelNow(targetNovelId)
    } catch (error) {
      novelStore.updateChapter(targetNovelId, targetChapterId, { status: 'completed' })
      throw error
    }
    succeeded = true
    message.success('本章已完成，记忆已更新，可以进入下一章')

    const completedNovelId = targetNovelId
    const completedChapterId = targetChapterId
    const completedContent = approvedContent
    const runExtendedBackgroundChecks = aiWorkflowPolicy.value.runExtendedBackgroundChecks
    if (runExtendedBackgroundChecks && content.value.length > 200) {
      chapterBackgroundQueue.enqueue('违禁词审查', async () => {
        await reviewBannedWords(reviewModel, {
          novelId: completedNovelId,
          chapterId: completedChapterId,
          content: completedContent,
        }, completionActivity.id)
      })
    }
    if (runExtendedBackgroundChecks && (novel.value.storyArcs?.length || 0) + (novel.value.eventLog?.length || 0) + (novel.value.chapterPlans?.length || 0) > 0) {
      chapterBackgroundQueue.enqueue('故事状态提案', async () => {
        const currentNovel = novelStore.getNovel(completedNovelId)
        const completedChapter = currentNovel?.chapters.find(item => item.id === completedChapterId)
        if (!currentNovel || !completedChapter) return
        const drafts = await generateStoryStateProposalDrafts(currentNovel, completedChapter, reviewModel, completionActivity.id)
        for (const draft of drafts) novelStore.addStoryStateProposal(completedNovelId, draft)
      })
    }
  } catch (err: any) {
    completionFailure = err
    if (succeeded) message.warning('本章已完成，附加后台任务未能启动')
    else if (controller.signal.aborted) message.info('已停止完成流程，已保存的检查结果会在下次继续使用')
    else message.error('本章尚未完成：' + (err?.message || String(err)))
  } finally {
    completing.value = false
    completingHint.value = ''
    aiWriting.value = false
    if (completionController === controller) completionController = null
    finishAiActivity(completionActivity, completionFailure || (!succeeded ? new Error('本章尚有待处理事项') : undefined))
  }
}

async function checkBannedWords() {
  const model = configStore.getModelForTask('review')
  if (!model) {
    message.warning('请先在设置页配置 AI 模型')
    return
  }
  if (!content.value) return

  // 先做本地词库扫描
  localScanResults.value = scanBannedWords(content.value, builtInBannedWords)
  bannedResult.value = ''
  aiWriting.value = true
  try {
    let result = ''
    const messages = buildBannedWordsCheckPrompt(content.value)
    await callAI({
      model,
      skillTask: 'review',
      messages,
      stream: true,
      onChunk: (chunk) => { result += chunk },
    })
    bannedResult.value = result
    message.success('违禁检测完成')
  } catch (err: any) {
    message.error('违禁检测失败：' + err.message)
  } finally {
    aiWriting.value = false
  }
}

// 全维度内容审查（手动触发）
async function contentReview() {
  if (!novel.value || !chapter.value || aiWriting.value || completing.value || isChapterLocked.value) return
  const model = configStore.getModelForTask('review')
  if (!model) {
    message.warning('请先在设置页配置 AI 模型')
    return
  }
  if (!content.value || content.value.length < 100) {
    message.warning('正文内容不足，无法进行审查')
    return
  }
  if (!(await saveContent())) return

  const previousReview = contentReviewResult.value
  const previousEditableReview = editableReviewText.value
  const previousSignature = lastContentReviewSignature.value
  contentReviewResult.value = ''
  reviewLoading.value = true
  reviewPanelOpen.value = true
  aiStatusText.value = 'AI 正在审查内容...'
  beginGeneration()
  message.info('正在进行全维度内容审查...')

  try {
    const reviewText = await requestContentReview(model, { liveUpdate: true })
    saveContentReviewResult(reviewText)
    await novelStore.saveNovelNow(novelId.value)
    message.success('内容审查完成')
  } catch (err: any) {
    contentReviewResult.value = previousReview
    editableReviewText.value = previousEditableReview
    lastContentReviewSignature.value = previousSignature
    message.error('内容审查失败：' + err.message)
  } finally {
    aiWriting.value = false
    reviewLoading.value = false
  }
}

function handleReviewRepair(review: string, mode: ChapterRepairMode = 'targeted') {
  if (mode === 'full') {
    dialog.warning({
      title: '整章修订',
      content: '将额外生成并检查一份完整修订稿。检查通过后替换正文，原稿保留在版本记录中。',
      positiveText: '生成并检查', negativeText: '取消',
      onPositiveClick: () => { void rewriteFromReview(review || undefined, { mode }) },
    })
  } else void rewriteFromReview(review || undefined, { mode })
}

// Validate a separate candidate before applying it through the revision API.
async function rewriteFromReview(
  selectedIssues?: string,
  options: {
    keepCompleting?: boolean
    model?: import('@/stores/config').ModelConfig
    activityParentId?: string
    mode?: ChapterRepairMode
  } = {},
): Promise<boolean> {
  if (!novel.value || !chapter.value || isChapterLocked.value || pendingRevision.value) return false
  if ((aiWriting.value || completing.value) && !options.keepCompleting) return false
  if (writingMode.value !== 'ai') {
    message.info('辅助写作模式不会自动修改正文，请根据审查报告手动调整')
    return false
  }
  const model = options.model || configStore.getModelForTask('writing')
  if (!model) {
    message.warning('请先在设置页面配置 AI 模型')
    return false
  }

  const reviewRef = selectedIssues || contentReviewResult.value
  if (!reviewRef) {
    message.info('没有审查报告可参考')
    return false
  }

  if (!(await saveContent())) return false
  const sourceNovelId = novelId.value
  const sourceChapterId = chapterId.value
  const originalContent = content.value
  const originalSignature = getChapterContextSignature()
  const mode = options.mode || 'targeted'
  const rewriteActivity = options.activityParentId ? null : startAiActivity(mode === 'full' ? '整章修订' : '局部修正')
  const rewriteParentId = options.activityParentId || rewriteActivity?.id
  let rewriteFailure: unknown
  aiStatusText.value = mode === 'full' ? '正在生成整章修订候选稿...' : '正在生成局部修正候选稿...'
  if (options.keepCompleting) completingHint.value = aiStatusText.value
  beginGeneration()
  const signal = getGenerationSignal()
  function ensureSourceUnchanged() {
    signal.throwIfAborted()
    assertChapterSnapshot(sourceNovelId, sourceChapterId, originalContent)
    if (getChapterContextSignature() !== originalSignature) throw new Error('设定已变化，修订未写入，请重新审查')
  }

  try {
    let ctx = buildWritingContext(novel.value, chapter.value)
    ctx = await augmentWritingContextWithVectorMemory(novel.value, chapter.value, ctx, configStore.embedding)
    ensureSourceUnchanged()
    const candidate = await requestChapterRepair({
      model, source: originalContent, review: reviewRef,
      lengthPolicy: chapterLengthPolicy.value,
      factCard: buildChapterFactCard(novel.value, chapter.value, ctx),
      guidance: ctx.chapterGuidance || '', mode, signal, activityParentId: rewriteParentId,
    })
    ensureSourceUnchanged()
    if (inspectChapterLength(candidate, chapterLengthPolicy.value).status !== 'within') {
      throw new Error(`候选修订不在 ${chapterLengthPolicy.value.minWords}–${chapterLengthPolicy.value.maxWords} 字范围，原文未改动`)
    }
    const reviewModel = configStore.getModelForTask('review') || model
    aiStatusText.value = '正在检查候选修订，原文保留...'
    if (options.keepCompleting) completingHint.value = aiStatusText.value
    reviewLoading.value = true
    reviewPanelOpen.value = true
    const ending = await requestChapterEndingCheck(reviewModel, candidate, ctx.chapterGuidance, '', signal, rewriteParentId)
    ensureSourceUnchanged()
    let candidateCoverage: StoredReviewCoverage | undefined
    const review = chapterEndingPasses(ending)
      ? await requestContentReview(reviewModel, { candidateContent: candidate, signal, activityParentId: rewriteParentId,
        onCoverage: coverage => { candidateCoverage = coverage },
      }) : ''
    ensureSourceUnchanged()
    const mergedReview = [buildLocalConsistencyReviewBlock(candidate), review].filter(Boolean).join('\n\n---\n\n')
    const passed = chapterEndingPasses(ending) && !reviewNeedsRewrite(mergedReview)
    const revision = await novelStore.proposeChapterRevision(sourceNovelId, sourceChapterId, candidate, 'review',
      passed ? '修订已通过结尾与内容检查' : '候选修订仍有待确认问题，原文未改动')
    if (revision && novelId.value === sourceNovelId && chapterId.value === sourceChapterId) pendingRevision.value = revision
    ensureSourceUnchanged()
    if (!revision) throw new Error('未能保存修订记录，原文未改动')
    if (!passed) {
      pendingRevision.value = revision
      message.warning('候选修订尚未通过检查，已保留原文，请查看待确认修订')
      return false
    }
    const applied = await novelStore.acceptChapterRevision(sourceNovelId, sourceChapterId, revision.id)
    if (!applied || applied.status !== 'accepted') throw new Error('修订未写入，请稍后重试')
    if (novelId.value !== sourceNovelId || chapterId.value !== sourceChapterId) return false
    if (chapter.value.content !== candidate) throw new Error('正文已被其他操作修改，未覆盖当前内容')
    pendingRevision.value = null
    content.value = candidate
    unsaved.value = false
    reviewCoverage.value = candidateCoverage
    novelStore.updateChapter(sourceNovelId, sourceChapterId, { contentReviewCoverage: candidateCoverage })
    endingCheckResult.value = ending
    lastEndingCheckSignature.value = getChapterContextSignature()
    saveContentReviewResult(review)
    await novelStore.saveNovelNow(sourceNovelId)
    message.success('修订已通过检查并写入，原稿已保留在版本记录中')
    return true
  } catch (err: any) {
    rewriteFailure = err
    if (err.name !== 'AbortError') message.error('修订未完成：' + err.message)
    return false
  } finally {
    reviewLoading.value = false
    if (!options.keepCompleting) {
      aiWriting.value = false
    }
    if (rewriteActivity) finishAiActivity(rewriteActivity, rewriteFailure)
  }
}

function renderBanned(text: string): string {
  return escapeHtml(text)
    .replace(/✅/g, '<span style="color:var(--color-success)">✅</span>')
    .replace(/⚠️/g, '<span style="color:var(--color-warning)">⚠️</span>')
    .replace(/❌/g, '<span style="color:var(--color-error)">❌</span>')
    .replace(/## (\d+\..*)/g, '<strong style="display:block;margin-top:8px;">$1</strong>')
    .replace(/\n/g, '<br>')
}

// 关闭审查报告
function closeReview() {
  bannedResult.value = ''
  contentReviewResult.value = ''
  editableReviewText.value = ''
  lastContentReviewSignature.value = ''
  novelStore.updateChapter(novelId.value, chapterId.value, {
    bannedReview: '',
    contentReview: '',
    contentReviewSignature: '',
  })
  localScanResults.value = []
}

// 替换单个违禁词
function replaceWord(word: string, replacement: string) {
  content.value = content.value.split(word).join(replacement)
  unsaved.value = true
  // 重新扫描
  localScanResults.value = scanBannedWords(content.value, builtInBannedWords)
  message.success(`已将「${word}」替换为「${replacement}」`)
}

// 一键替换所有有建议的违禁词
function replaceAllSuggested() {
  let count = 0
  for (const item of localScanResults.value) {
    if (item.word.suggestion) {
      content.value = content.value.split(item.word.word).join(item.word.suggestion)
      count += item.count
    }
  }
  unsaved.value = true
  localScanResults.value = scanBannedWords(content.value, builtInBannedWords)
  message.success(`已替换 ${count} 处违禁词`)
}

// 生成下一章
async function nextChapter() {
  if (!novel.value || !chapter.value || !readyForNextChapter.value || chapterActionDisabled.value) return
  navigatingChapter.value = true
  const sourceNovelId = novelId.value
  const sourceChapterId = chapterId.value
  try {
    await novelStore.saveNovelNow(sourceNovelId)
    if (novelId.value !== sourceNovelId || chapterId.value !== sourceChapterId) return
    const next = followingChapter.value || novelStore.addChapter(sourceNovelId, {})
    if (!next) throw new Error('创建下一章失败')
    await novelStore.saveNovelNow(sourceNovelId)
    reviewPanelOpen.value = false
    await router.push(`/workspace/${sourceNovelId}/editor/${next.id}`)
  } catch (error) {
    message.error('无法进入下一章：' + (error instanceof Error ? error.message : String(error)))
  } finally {
    navigatingChapter.value = false
  }
}

// 简易撤销/重做（浏览器原生）
function undo() {
  document.execCommand('undo')
}

function redo() {
  document.execCommand('redo')
}
</script>

<style scoped>
.length-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 16px;
  min-height: 36px;
  border-bottom: 1px solid var(--border-color-light);
  background: var(--bg-color-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.length-status {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.length-controls :deep(.n-button) { flex-shrink: 0; }
.length-settings { display: grid; gap: 12px; }
.length-settings label { display: grid; gap: 5px; }
.editor-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 顶部导航 */
.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 8px 20px;
  background: var(--bg-color-header);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  transition: background-color var(--transition-normal);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-color-tertiary);
}

.breadcrumb-sep { font-size: 11px; }

.breadcrumb-current {
  color: var(--text-color-secondary);
  font-weight: 500;
}

.topbar-center {
  flex: 1;
  max-width: 300px;
  margin: 0 20px;
}

.story-days-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  font-size: 11px;
  color: var(--text-color-tertiary);
}

.story-days-control :deep(.n-input-number) { width: 92px; max-width: 100%; }

.chapter-title-input :deep(input) {
  text-align: center;
  font-family: var(--font-family-serif);
  font-weight: 700;
  font-size: 16px;
  border: none !important;
  background: transparent !important;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.writing-mode-badge {
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--color-accent-light);
  color: var(--color-accent);
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}

.writing-mode-badge:hover:not(:disabled) {
  filter: brightness(.97);
}

.writing-mode-badge:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.writing-mode-badge--ai {
  border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.word-count {
  font-size: 13px;
  color: var(--text-color-tertiary);
  font-variant-numeric: tabular-nums;
}

.save-status {
  font-size: 12px;
  color: var(--color-warning);
  font-weight: 500;
}

.save-status.saved {
  color: var(--color-success);
}

/* 编辑区 */
.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  gap: 0;
}

.paper-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  position: relative;
  padding: 36px 24px;
  overflow-y: auto;
}

.editor-textarea {
  width: 100%;
  max-width: 720px;
  min-height: 100%;
  padding: 48px 56px;
  background: var(--bg-color-paper);
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-paper);
  font-family: var(--font-family-serif);
  font-size: 18px;
  line-height: 1.85;
  letter-spacing: 0.02em;
  color: var(--text-color-primary);
  resize: none;
  outline: none;
  transition: background-color var(--transition-normal), box-shadow var(--transition-normal);
}

.editor-textarea::placeholder {
  color: var(--text-color-disabled);
}

.ai-empty-generation {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: min(420px, calc(100% - 48px));
  padding: 28px 24px;
  transform: translate(-50%, -50%);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-color-paper) 92%, transparent);
  color: var(--text-color-secondary);
  text-align: center;
  pointer-events: none;
}

.ai-empty-generation:not(.ai-empty-generation--running) {
  pointer-events: auto;
}

.ai-empty-generation strong {
  color: var(--text-color-primary);
  font-size: 15px;
}

.ai-empty-generation-spinner {
  display: inline-block;
  color: var(--color-primary);
  font-size: 30px;
  line-height: 1;
  animation: ai-empty-spin 1s linear infinite;
}

@keyframes ai-empty-spin {
  to { transform: rotate(360deg); }
}

/* 右侧工具栏 */
.side-toolbar {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: var(--bg-color-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  z-index: 10;
}

.assistant-pane { width: 320px; flex: 0 0 320px; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-color-card); border-left: 1px solid var(--border-color); z-index: 20; }
.assistant-tabs { display: flex; flex-shrink: 0; min-height: 42px; border-bottom: 1px solid var(--border-color); }
.assistant-tab { flex: 1; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-color-secondary); cursor: pointer; }
.assistant-tab[aria-pressed="true"] { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
.assistant-toggle, .assistant-close { border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 4px 10px; background: var(--bg-color-card); color: var(--text-color-secondary); cursor: pointer; }
.assistant-close { border: 0; font-size: 22px; }
.assistant-content, .assistant-panel-wrapper { flex: 1; min-height: 0; overflow: auto; }
.assistant-panel-wrapper { height: 100%; }
.assistant-pane :deep(.advisor-header p) { line-height: 1.7; }
.assistant-empty { padding: 24px; color: var(--text-color-tertiary); line-height: 1.8; }
.assistant-pane :deep(.advisor-sidebar), .assistant-pane :deep(.review-sidebar) { position: static; width: 100%; height: 100%; max-width: 100%; border: 0; box-shadow: none; transform: none; }
.assistant-pane :deep(.advisor-toggle-btn), .assistant-pane :deep(.review-toggle-btn), .assistant-pane :deep(.close-btn) { display: none; }
.editor-view--assistant-open .side-toolbar { right: 336px; }
.paper-sheet { display: flex; flex: 1; min-width: 0; max-width: 720px; position: relative; min-height: 100%; }
@media (max-width: 1000px) {
  .assistant-pane { position: absolute; inset: 0 0 0 auto; width: min(360px, 100%); box-shadow: var(--shadow-lg); }
  .editor-view--assistant-open .side-toolbar { right: 16px; }
}
@media (max-width: 1100px) {
  .editor-topbar { flex-wrap: wrap; gap: 8px; }
  .topbar-right { flex-wrap: wrap; }
  .topbar-left { display: none; }
  .topbar-center { margin: 0; min-width: 120px; }
}


.tool-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tool-btn:hover:not(:disabled) {
  background: var(--bg-color-hover);
  color: var(--color-primary);
}

.tool-btn:focus-visible,
.bottom-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* AI 写入提示 */
.ai-writing-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px;
  background: var(--color-accent-light);
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 500;
}

.ai-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-primary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 底部工具栏 */
.editor-bottombar {
  display: flex;
  align-items: center;
  padding: 6px 20px;
  background: var(--bg-color-header);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.bottom-tools {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bottom-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-color-secondary);
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.bottom-btn:hover {
  background: var(--bg-color-hover);
}

.bottom-sep {
  width: 1px;
  height: 20px;
  background: var(--border-color-light);
  margin: 0 6px;
}

.chapter-info {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-left: 8px;
}

.font-size-label {
  font-size: 11px;
  color: var(--text-color-tertiary);
  min-width: 32px;
  text-align: center;
}

.bottom-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.progress-mini {
  width: 60px;
  height: 4px;
  border-radius: 2px;
  background: var(--progress-track);
  overflow: hidden;
}

.progress-fill-mini {
  height: 100%;
  border-radius: 2px;
  background: var(--progress-fill);
  transition: width 0.3s;
}

.shortcut-hints {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--text-color-disabled);
  margin-left: auto;
}

.shortcut-hints kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 10px;
  font-family: var(--font-family-mono);
  border: 1px solid var(--border-color-light);
  border-radius: 3px;
  background: var(--bg-color-secondary);
  margin-right: 2px;
}

/* 违禁词检测面板 */
.banned-result {
  font-size: 14px;
  line-height: 1.7;
  flex-shrink: 0;
  max-height: 200px;
  overflow-y: auto;
}

.banned-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border: none;
  border-radius: 50%;
  background: var(--bg-color-hover);
  cursor: pointer;
  color: var(--text-color-tertiary);
}

.close-btn:hover {
  background: var(--border-color);
}

/* 审查报告 */
.review-report {
  font-size: 14px;
  line-height: 1.7;
  flex-shrink: 0;
  max-height: 280px;
  overflow-y: auto;
}

.scan-section {
  margin-bottom: 12px;
}

.scan-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color-secondary);
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color-light);
}

.scan-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scan-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-color-secondary);
  font-size: 13px;
}

.scan-word {
  font-weight: 600;
}

.scan-word.must {
  color: #e53935;
}

.scan-word.platform {
  color: #f9a825;
}

.scan-cat {
  font-size: 11px;
  color: var(--text-color-tertiary);
  padding: 1px 6px;
  background: var(--bg-color);
  border-radius: 8px;
}

.scan-count {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-left: auto;
  margin-right: 4px;
}

.ai-review-section {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color-light);
}

/* 违禁词高亮 overlay */
.paper-editor {
  position: relative;
}

.highlight-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 48px 56px;
  border: 1px solid transparent;
  font-family: var(--font-family-serif);
  font-size: 18px;
  line-height: 1.85;
  letter-spacing: 0.02em;
  color: transparent;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
  pointer-events: none;
  z-index: 1;
}

.editor-textarea.has-overlay {
  position: relative;
  z-index: 2;
  background: transparent;
  color: var(--text-color-primary);
}

.tool-btn--active {
  background: var(--color-primary-light) !important;
  color: var(--color-primary) !important;
}

/* 违禁词侧边面板 */
.banned-panel {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color-light);
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  height: 100%;
  overflow-y: auto;
}

.panel-header {
  padding: 12px;
  border-bottom: 1px solid var(--border-color-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.panel-count {
  font-size: 11px;
  color: var(--text-color-tertiary);
}

.panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.panel-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
  font-size: 12px;
}

.panel-item:hover {
  background: var(--bg-color-hover);
}

.panel-word {
  flex: 1;
}

.panel-count-num {
  font-size: 10px;
  color: var(--text-color-tertiary);
  min-width: 20px;
}

.panel-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-color-tertiary);
  font-size: 13px;
}

/* ── 右侧审查面板 ────────────────────────── */
.review-toggle-btn {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 50;
  width: 28px;
  padding: 12px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  writing-mode: vertical-lr;
  transition: all 0.2s ease;
  box-shadow: -2px 0 8px rgba(0,0,0,0.15);
}

.review-toggle-btn:hover {
  width: 32px;
  background: var(--color-primary-dark, #d84315);
}

.review-toggle-btn.is-open {
  right: 380px;
}

.review-toggle-label {
  font-size: 12px;
  letter-spacing: 2px;
}

.review-sidebar {
  position: fixed;
  right: 0;
  top: 52px;
  bottom: 0;
  width: 380px;
  background: var(--bg-color-card);
  border-left: 1px solid var(--border-color-light);
  box-shadow: -4px 0 16px rgba(0,0,0,0.08);
  z-index: 40;
  display: flex;
  flex-direction: column;
  transition: background-color var(--transition-normal);
}

.review-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-light);
  flex-shrink: 0;
}

.review-sidebar-header strong {
  font-size: 15px;
}

.review-sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.review-sidebar-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--border-color-light);
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}

.review-section {
  margin-bottom: 12px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.review-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: var(--bg-color-hover);
  user-select: none;
  transition: background 0.15s ease;
}

.review-section-title:hover {
  background: var(--bg-color);
}

.toggle-icon {
  font-size: 10px;
  color: var(--text-color-tertiary);
}

.review-section-content {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.revision-meta {
  margin: 0 0 8px;
  color: var(--text-color-secondary);
  font-size: 12px;
}

.revision-diff {
  max-height: 260px;
  overflow: auto;
  margin: 0 0 10px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg-color-hover);
  border: 1px solid var(--border-color-light);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.data-panel-sidebar {
  width: 360px;
}

.data-panel-toggle-btn {
  right: 360px;
}

.data-panel-actions,
.data-form-actions,
.change-actions,
.data-item-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.data-panel-actions {
  margin-bottom: 12px;
}

.data-change-section-title,
.data-change-section-title label,
.data-change-title,
.batch-change-actions {
  display: flex;
  align-items: center;
}

.data-change-section-title {
  justify-content: space-between;
  gap: 8px;
}

.data-change-section-title label,
.data-change-title,
.batch-change-actions {
  gap: 6px;
}

.data-change-list,
.data-field-list,
.data-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.data-change-card,
.data-item-card {
  padding: 12px;
}

.change-values {
  margin: 6px 0;
  color: var(--color-primary);
  font-weight: 700;
}

.data-change-card p,
.data-keywords {
  color: var(--text-color-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.data-item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}

.data-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.data-field-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--text-color-secondary);
}

.field-type-badge,
.confidence-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.field-formula {
  margin-left: 6px;
  color: var(--text-color-tertiary);
  font-size: 11px;
}

.field-rule {
  display: block;
  margin-top: 3px;
  color: var(--color-primary);
  font-size: 11px;
}

.confidence-possible {
  background: rgba(240, 160, 32, 0.12);
  color: var(--color-warning);
}

.data-form label {
  font-size: 13px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

.data-history-section {
  margin: 12px 0;
  padding: 10px 0;
  border-top: 1px solid var(--border-color-light);
  border-bottom: 1px solid var(--border-color-light);
}

.data-history-section summary {
  cursor: pointer;
  color: var(--text-color-primary);
  font-size: 13px;
  font-weight: 600;
}

.data-history-filters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 10px 0;
}

.data-history-filters > :last-child {
  grid-column: 1 / -1;
}

.data-history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.data-history-row {
  padding: 8px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  color: var(--text-color-tertiary);
  font-size: 11px;
}

.data-history-row > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
  color: var(--text-color-secondary);
}

.history-status {
  flex-shrink: 0;
  color: var(--text-color-tertiary);
}

.status-pending { color: var(--color-warning); }
.status-accepted { color: var(--color-success); }

.data-history-cleanup {
  display: grid;
  grid-template-columns: auto minmax(70px, 1fr) auto;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--text-color-tertiary);
  font-size: 11px;
}

.data-history-cleanup > :last-child {
  grid-column: 1 / -1;
  justify-self: start;
}

@media (max-width: 700px) {
  .editor-topbar {
    flex-wrap: wrap;
    min-height: auto;
  }

  .topbar-center {
    order: 3;
    flex-basis: 100%;
    max-width: none;
    margin: 8px 0 0;
  }
  .paper-editor { padding: 16px 12px; }
  .editor-textarea, .highlight-overlay { padding: 24px 20px; }
  .side-toolbar { position: static; transform: none; flex-direction: row; justify-content: center; flex-wrap: wrap; border-radius: 0; box-shadow: none; flex-shrink: 0; }
  .editor-body { flex-wrap: wrap; }
  .paper-editor { flex-basis: 100%; min-height: 0; height: calc(100% - 48px); }
  .side-toolbar { width: 100%; height: 48px; }
  .editor-bottombar { padding: 6px 8px; gap: 4px; flex-wrap: wrap; }
}

/* 面板滑入/滑出动画 */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.review-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.review-loading-hint {
  text-align: center;
  padding: 24px;
  color: var(--text-color-tertiary);
  font-size: 13px;
}

.rewrite-actions {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-color-light);
}

.rewrite-hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-bottom: 8px;
}

.editable-review {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  font-family: var(--font-family);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-primary);
  background: var(--bg-color);
  resize: vertical;
  outline: none;
  min-height: 60px;
}

.editable-review:focus {
  border-color: var(--color-primary);
}

.rewrite-btn-group {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
/* Writing workspace: reading column and full-height assistant share the frame. */
.editor-view { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; position: relative; background: var(--bg-color-paper); }
.editor-view--assistant-open { grid-template-columns: minmax(0, 1fr) clamp(330px, 26vw, 420px); }
.editor-writing-column { grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.editor-formatbar { display: flex; align-items: center; gap: 14px; min-height: 48px; padding: 8px 28px; background: var(--bg-color-card); border-bottom: 1px solid var(--border-color-light); flex-shrink: 0; }
.editor-topbar { min-height: 76px; padding: 14px 28px; gap: 12px; background: var(--bg-color-paper); flex-wrap: wrap; }
.topbar-left { display: flex; min-width: 0; font-size: 14px; }
.breadcrumb { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topbar-center { flex: 0 1 auto; max-width: none; margin: 0; }
.story-days-control { justify-content: flex-start; margin: 0; }
.topbar-right { margin-left: auto; gap: 10px; flex-wrap: wrap; }
.length-controls { background: var(--bg-color-paper); padding-inline: 28px; border-bottom: 1px solid var(--border-color-light); }
.editor-body { min-height: 0; }
.paper-editor { padding: 32px clamp(24px, 4vw, 64px); background: var(--bg-color-paper); }
.paper-sheet { width: 100%; max-width: 900px; min-height: 0; display: flex; flex-direction: column; }
.paper-heading { text-align: center; padding: 0 0 28px; flex-shrink: 0; }
.paper-heading > p { font-size: 12px; color: var(--text-color-tertiary); letter-spacing: .15em; margin: 0 0 8px; }
.chapter-title-input { width: 100%; --n-border: none !important; --n-border-hover: none !important; --n-border-focus: none !important; --n-color: transparent !important; --n-color-focus: transparent !important; }
.chapter-title-input :deep(input) { text-align: center; font: 600 32px var(--font-family-serif); line-height: 1.5; height: auto; }
.paper-content { flex: 1; min-height: 0; position: relative; display: flex; }
.editor-textarea, .highlight-overlay { padding: 4px 0 32px; border: 0; border-radius: 0; box-shadow: none; max-width: none; line-height: 2; }
.editor-textarea { min-height: 100%; background: transparent; }
.editor-bottombar { grid-column: 1; grid-row: 2; }
.assistant-pane { grid-column: 2; grid-row: 1 / -1; width: auto; min-width: 0; height: 100%; background: var(--bg-color-card); }
.assistant-heading { display: flex; align-items: center; justify-content: space-between; padding: 22px 22px 10px; flex-shrink: 0; }
.assistant-heading h2 { font: 600 24px var(--font-family-serif); }
.assistant-heading h2::first-letter { color: var(--color-accent); }
.assistant-tabs { margin: 0 18px; }
.assistant-tab { font-size: 14px; padding: 12px 4px; }
.assistant-pane :deep(.review-sidebar-header) { min-height: 54px; border: 0; padding: 16px 20px 0; font: 600 21px var(--font-family-serif); }
.assistant-pane :deep(.review-sidebar-body) { padding: 10px 20px 20px; }
.assistant-pane :deep(.review-section-title) { background: transparent; padding: 12px; }
.editor-chat-panel { height: 100%; min-height: 0; }
.editor-view--assistant-open .side-toolbar { right: 12px; }
@media (max-width: 1200px) { .editor-topbar { padding: 12px 20px; } .topbar-right { gap: 6px; } .topbar-left { flex-basis: 100%; } }
@media (max-width: 1000px) {
  .editor-view--assistant-open { grid-template-columns: minmax(0, 1fr); }
  .assistant-pane { position: absolute; grid-area: auto; inset: 0 0 0 auto; width: min(420px, 100%); height: 100%; box-shadow: var(--shadow-lg); }
}
@media (max-width: 700px) {
  .editor-topbar { padding: 10px 12px; } .topbar-center { order: 0; margin: 0; flex-basis: auto; }
  .editor-formatbar { padding: 6px 12px; } .paper-editor { padding: 24px 20px; height: calc(100% - 48px); }
  .chapter-title-input :deep(input) { font-size: 26px; } .paper-heading { padding-bottom: 18px; }
  .editor-textarea, .highlight-overlay { padding: 4px 0 24px; }
}
</style>
