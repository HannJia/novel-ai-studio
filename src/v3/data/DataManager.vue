<template>
  <BookPage>
  <div v-if="novel" class="data-workspace">
    <header class="data-header">
      <div>
        <h2 class="page-title">数据面板</h2>
        <p class="page-subtitle">全书状态、数值与变化记录</p>
      </div>
      <div class="header-actions">
        <n-dropdown trigger="click" :options="exportOptions" @select="exportDataPanels">
          <n-button tertiary>
            <template #icon><n-icon><download-outline /></n-icon></template>
            导出
          </n-button>
        </n-dropdown>
        <n-button type="primary" :disabled="dataSaving" @click="openEditor()">
          <template #icon><span style="font-size:16px">+</span></template>
          新建数据
        </n-button>
      </div>
    </header>

    <div v-if="referenceIssues.length" role="status" class="data-reference-warning">
      <strong>部分数据来源需要核对</strong>
      <p>缺少有效来源的字段保留历史，但不会作为有效事实提供给 AI。核对原文后可编辑并确认当前值；时间规则重新锚定后只累计新的时间区间。</p>
      <ul><li v-for="issue in referenceIssues" :key="issue">{{ issue }}</li></ul>
    </div>

    <div class="data-summary">
      <div class="summary-card">
        <strong>{{ dataPanels.length }}</strong>
        <span>数据对象</span>
      </div>
      <div class="summary-card">
        <strong>{{ totalFieldCount }}</strong>
        <span>字段</span>
      </div>
      <div class="summary-card">
        <strong>{{ pendingChangeCount }}</strong>
        <span>待确认变更</span>
      </div>
      <div class="summary-card">
        <strong>{{ automationRuleCount }}</strong>
        <span>自动规则</span>
      </div>
    </div>

    <section class="story-clock-panel">
      <div>
        <strong>故事时间</strong>
        <span class="story-clock-hint">按章节来源计算；当前有效来源 {{ validStoryTimeCount }} 条，旧值失效后需重新核对</span>
      </div>
      <div class="story-clock-controls">
        <span>故事起点</span>
        <n-input-number v-model:value="storyDayDraft" :disabled="dataSaving" :min="0" :max="100000000" :step="1" size="small" />
        <n-input v-model:value="storyLabelDraft" :disabled="dataSaving" placeholder="显示名称（可选）" size="small" />
        <n-button size="small" type="primary" :loading="dataSaving" @click="saveStoryClock">确认故事起点</n-button>
        <n-button size="small" :disabled="dataSaving" @click="reloadOriginTime">重新读取起点</n-button>
      </div>
      <p role="status">{{ originTime.known ? `已确认起点：故事日 ${originTime.endDay}` : '起点待核对；旧时钟数字不会自动成为已确认事实。' }}</p>
      <p>修改起点或替换章节时间会保留历史，并使依赖旧来源的相对时间待核对。</p>
      <div class="story-clock-controls">
        <n-select v-model:value="timeChapterId" :options="timeChapterOptions" :disabled="dataSaving" placeholder="选择要确认的章节" />
        <n-button size="small" :disabled="dataSaving || !timeChapterId" @click="reloadChapterTime">重新读取来源</n-button>
      </div>
      <template v-if="timeChapter">
        <p role="status">{{ selectedTime.known ? `已确认：故事日 ${selectedTime.startDay}–${selectedTime.endDay}` : `开始：${selectedTime.startDay ?? '未知'}；结束：未知。${selectedTime.reason}` }}</p>
        <div class="story-clock-controls">
          <n-select v-model:value="timeMode" :disabled="dataSaving" :options="timeModeOptions" />
          <template v-if="timeMode === 'absolute'">
            <span>开始日</span><n-input-number v-model:value="timeStart" :disabled="dataSaving" :min="0" placeholder="明确填写开始日" />
            <span>结束日</span><n-input-number v-model:value="timeEnd" :disabled="dataSaving" :min="0" placeholder="明确填写结束日" />
          </template>
          <template v-else><span>经过天数</span><n-input-number v-model:value="timeElapsed" :disabled="dataSaving" :min="0" placeholder="包括明确的 0 天" /></template>
          <n-input v-model:value="timeLabel" :disabled="dataSaving" placeholder="本章时间标签（可选）" />
        </div>
        <n-checkbox v-if="expectedTimeRecord" v-model:checked="replaceTime" :disabled="dataSaving">我已核对正文，明确替换本章原时间确认（保留历史）</n-checkbox>
        <n-button :loading="dataSaving" :disabled="timeChapter.status === 'locked' || (!!expectedTimeRecord && !replaceTime)" @click="saveChapterTime">确认本章时间</n-button>
        <n-button :disabled="dataSaving || !selectedTime.known" @click="queueChapterDataChanges">按本章结束日推算数据</n-button>
        <p>重新确认过的旧规则将从本章结束日重新累计；新的推算结果仍需逐项确认后写入。</p>
      </template>
      <details>
        <summary>时间来源历史（{{ storyTimeRecords.length }} 条）</summary>
        <ul><li v-for="record in storyTimeRecords.slice().reverse()" :key="record.id">
          {{ record.boundary === 'origin' ? '故事起点' : `确认时第 ${(record.chapterIndex ?? -1) + 1} 章` }} ·
          {{ record.startDay }}–{{ record.endDay }} · {{ record.label || '无标签' }} ·
          {{ timeStatusLabels[record.status] }} · {{ record.source === 'author' ? '作者确认' : record.source === 'canon' ? '作者接受候选' : '旧记录' }} · {{ record.confirmedAt }}
          <span v-if="record.invalidReason"> · {{ record.invalidReason }}</span>
        </li></ul>
      </details>
    </section>

    <div class="filter-bar">
      <n-input v-model:value="query" clearable placeholder="搜索名称、关键词或字段" />
      <n-select v-model:value="categoryFilter" :options="categoryFilterOptions" />
      <n-select v-model:value="recentFilter" :options="recentFilterOptions" />
    </div>

    <div class="data-layout">
      <section class="object-section">
        <div v-if="filteredItems.length" class="object-grid">
          <article
            v-for="item in filteredItems"
            :key="item.id"
            class="data-object-card"
            role="button"
            tabindex="0"
            :aria-label="`查看${item.name}的变化记录`"
            :class="{ selected: selectedItemId === item.id }"
            @click="selectedItemId = item.id"
            @keydown.enter.self.prevent="selectedItemId = item.id"
            @keydown.space.self.prevent="selectedItemId = item.id"
          >
            <div class="object-card-header">
              <div>
                <n-tag size="small">{{ item.category }}</n-tag>
                <h3>{{ item.name }}</h3>
              </div>
              <div class="icon-actions">
                <n-button quaternary circle size="small" title="编辑数据" :disabled="dataSaving" @click.stop="openEditor(item)">
                  <template #icon><n-icon><create-outline /></n-icon></template>
                </n-button>
                <n-button v-if="item.versions?.length" quaternary circle size="small" title="查看历史版本" :disabled="dataSaving" @click.stop="openVersionModal(item)">
                  <template #icon><n-icon><time-outline /></n-icon></template>
                </n-button>
                <n-popconfirm @positive-click="removeItem(item.id)">
                  <template #trigger>
                    <n-button quaternary circle size="small" title="删除数据" :disabled="dataSaving" @click.stop="prepareDelete(item.id)">
                      <template #icon><n-icon><trash-outline /></n-icon></template>
                    </n-button>
                  </template>
                  删除该数据对象及其全部变更记录？
                </n-popconfirm>
              </div>
            </div>

            <div class="field-table">
              <div v-for="field in item.fields" :key="field.id" class="field-row">
                <span>
                  {{ field.name }}
                  <small v-if="field.formula">公式</small>
                </span>
                <strong>{{ field.value }}{{ field.unit ? ` ${field.unit}` : '' }}</strong>
                <small v-if="field.calculationError" role="alert" style="color: var(--zhu)">{{ field.calculationError }}（保留原值）</small>
              </div>
            </div>

            <EquipmentSummary :item="item" :items="dataPanels" />
            <div class="object-meta">
              <span v-if="item.relatedKeywords.length">{{ item.relatedKeywords.join('、') }}</span>
              <span>{{ item.lastMentionChapterIndex === undefined ? '尚未在正文出现' : `最近第 ${item.lastMentionChapterIndex + 1} 章` }}</span>
            </div>
          </article>
        </div>
        <n-empty v-else description="没有符合条件的数据对象" />
      </section>

      <aside class="timeline-section">
        <section v-if="selectedItem" class="selected-data-detail">
          <div class="selected-data-title"><h3>{{ selectedItem.name }}</h3><n-tag size="small">{{ selectedItem.category }}</n-tag></div>
          <p v-if="selectedItem.relatedKeywords.length" class="selected-data-keywords">{{ selectedItem.relatedKeywords.join(' · ') }}</p>
          <div class="selected-data-header"><h4>基础信息</h4><n-button size="small" text :disabled="dataSaving" @click="openEditor(selectedItem)">编辑</n-button></div>
          <dl class="selected-data-fields"><div v-for="field in selectedItem.fields" :key="field.id"><dt>{{ field.name }}</dt><dd>{{ field.value }}{{ field.unit ? ' ' + field.unit : '' }}</dd></div></dl>
          <EquipmentSummary :item="selectedItem" :items="dataPanels" />
        </section>
        <div class="timeline-header">
          <div>
            <h3>变化时间线</h3>
            <span>{{ selectedItem?.name || '全部对象' }}</span>
          </div>
          <n-button v-if="selectedItemId" text @click="selectedItemId = ''">查看全部</n-button>
        </div>
        <div class="timeline-filters">
          <n-select v-model:value="historyStatus" size="small" :options="historyStatusOptions" />
          <n-select v-model:value="historyField" size="small" :options="historyFieldOptions" />
        </div>
        <div v-if="timelineChanges.length" class="change-timeline">
          <div v-for="change in timelineChanges" :key="change.id" class="timeline-entry">
            <div class="timeline-point"></div>
            <div>
              <div class="timeline-entry-header">
                <strong>第 {{ change.chapterIndex + 1 }} 章 · {{ change.itemName }} · {{ change.fieldName }}</strong>
                <n-tag size="small" :type="changeStatusType(change.status)">{{ changeStatusLabel(change.status) }}</n-tag>
              </div>
              <p>{{ change.oldValue }} → {{ change.newValue }}</p>
              <small>{{ change.reason }}</small>
              <div v-if="change.status === 'pending'" class="change-actions">
                <n-button size="tiny" type="primary" :disabled="dataSaving" @click="confirmChange(change.id)">应用</n-button>
                <n-button size="tiny" :disabled="dataSaving" @click="rejectChange(change.id)">忽略</n-button>
              </div>
            </div>
          </div>
        </div>
        <n-empty v-else description="暂无变化记录" />
      </aside>
    </div>

    <n-modal v-model:show="showEditor" preset="card" :title="editingItemId ? '编辑数据' : '新建数据'" class="editor-modal" :mask-closable="!dataSaving" :close-on-esc="!dataSaving" :closable="!dataSaving">
      <n-form label-placement="top" :disabled="dataSaving" :inert="dataSaving">
        <div class="form-grid">
          <n-form-item label="名称"><n-input v-model:value="form.name" placeholder="数据对象名称" /></n-form-item>
          <n-form-item label="分类"><n-select v-model:value="form.category" :options="categoryOptions" /></n-form-item>
          <n-form-item v-if="form.category === '装备' || form.category === '道具'" label="归属对象">
            <n-select v-model:value="form.ownerItemId" clearable :options="ownerOptions" placeholder="选择归属的角色或对象" />
          </n-form-item>
          <n-form-item v-if="form.category === '装备' || form.category === '道具'" label="装备状态">
            <n-select v-model:value="form.equipmentState" :options="equipmentStateOptions" />
          </n-form-item>
          <n-form-item label="关联关键词" class="span-2"><n-input v-model:value="form.keywords" placeholder="用顿号或逗号分隔" /></n-form-item>
          <n-form-item label="字段与自动规则" class="span-2">
            <DataPanelFieldEditor v-model:fields="structuredFields" v-model:automation-text="form.automation" />
          </n-form-item>
          <n-form-item v-if="form.category === '装备' || form.category === '道具'" class="span-2">
            <EquipmentFieldEditor v-model:fields="structuredFields" />
          </n-form-item>
        </div>
      </n-form>
      <template #footer>
        <div class="modal-actions">
          <n-button :disabled="dataSaving" @click="showEditor = false">取消</n-button>
          <n-button type="primary" :loading="dataSaving" @click="saveItem">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="showVersionModal" preset="card" title="数据面板版本" class="editor-modal" :mask-closable="!dataSaving" :close-on-esc="!dataSaving" :closable="!dataSaving">
      <div v-if="versionItem" class="version-dialog">
        <p><strong>{{ versionItem.name }}</strong> · 当前版本</p>
        <n-select v-model:value="selectedVersionId" :options="versionOptions" :disabled="dataSaving" />
        <n-button type="warning" :disabled="!selectedVersionId || dataSaving" :loading="dataSaving" @click="restoreVersion">恢复此版本</n-button>
      </div>
    </n-modal>
  </div>
  </BookPage>
</template>

<script setup lang="ts">
import BookPage from '@/v3/components/BookPage.vue'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton, NDropdown, NEmpty, NForm, NFormItem, NIcon, NInput, NInputNumber, NModal,
  NPopconfirm, NSelect, NTag, NCheckbox, useMessage,
} from 'naive-ui'
import { CreateOutline, DownloadOutline, TrashOutline, TimeOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import DataPanelFieldEditor from '@/components/data-panel/DataPanelFieldEditor.vue'
import EquipmentFieldEditor from '@/components/data-panel/EquipmentFieldEditor.vue'
import EquipmentSummary from '@/components/data-panel/EquipmentSummary.vue'
import { equipmentStateOptions } from '@/services/dataPanelEquipment'
import { projectDataPanelReferences } from '@/services/dataPanelReference'
import {
  calculateDataPanelFieldValues,
  dataPanelsToMarkdown,
  filterDataPanelChanges,
  filterDataPanelItems,
  formatDataPanelAutomationRules,
  parseDataPanelFields,
  parseDataPanelAutomationRules,
} from '@/services/dataPanel'
import type { DataPanelCategory, DataPanelChange, DataPanelField, DataPanelItem, EquipmentState } from '@/types/novel'
import { storyTimeHistory, projectStoryTime, projectStoryTimeOrigin, storyTimeSourceVersion, type StoryTimeProjection } from '@/services/storyTime'

const route = useRoute()
const novelStore = useNovelStore()
const message = useMessage()
const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const referenceIssues = computed(() => novel.value ? projectDataPanelReferences(novel.value).issues : [])
const dataPanels = computed(() => novel.value?.dataPanels || [])
const storyTimeRecords = computed(() => novel.value ? storyTimeHistory(novel.value) : [])
const validStoryTimeCount = computed(() => storyTimeRecords.value.filter(record => record.status === 'current').length)
const originTime = computed<StoryTimeProjection>(() => novel.value ? projectStoryTimeOrigin(novel.value) : { known: false })
const timeChapterId = ref('')
const timeChapter = computed(() => novel.value?.chapters.find(chapter => chapter.id === timeChapterId.value))
const timeChapterOptions = computed(() => (novel.value?.chapters || []).slice().sort((a, b) => a.chapterIndex - b.chapterIndex)
  .map(chapter => ({ value: chapter.id, label: `第 ${chapter.chapterIndex + 1} 章 ${chapter.title}` })))
const selectedTime = computed<StoryTimeProjection>(() => novel.value && timeChapter.value ? projectStoryTime(novel.value, timeChapter.value) : { known: false })
const timeMode = ref<'absolute' | 'relative'>('absolute')
const timeModeOptions = [{ value: 'absolute', label: '绝对时间（独立锚点）' }, { value: 'relative', label: '相对紧邻前章推进' }]
const timeStart = ref<number | null>(null), timeEnd = ref<number | null>(null), timeElapsed = ref<number | null>(null)
const timeLabel = ref(''), replaceTime = ref(false), expectedTimeRecord = ref<string | undefined>()
const timeBaseline = ref('')
let timeDraftSource: { novelId: string; chapterId: string; chapterIndex: number; content: string; version: string } | undefined
const timeStatusLabels = { current: '有效', invalid: '待核对', superseded: '已替代', unverified: '来源未核对' }
function reloadChapterTime() {
  if (!novel.value || !timeChapter.value) { timeDraftSource = undefined; return }
  const chapter = timeChapter.value, projection = selectedTime.value
  const record = storyTimeRecords.value.find(row => row.id === projection.recordId)
  timeMode.value = record?.kind === 'relative' ? 'relative' : 'absolute'
  timeDraftSource = { novelId: novel.value.id, chapterId: chapter.id, chapterIndex: chapter.chapterIndex, content: chapter.content, version: storyTimeSourceVersion(chapter.content) }
  timeStart.value = projection.startDay ?? null; timeEnd.value = projection.endDay ?? null
  timeElapsed.value = projection.elapsedDays ?? null; timeLabel.value = projection.label || ''
  expectedTimeRecord.value = projection.recordId; replaceTime.value = false
  timeBaseline.value = novelStore.captureDataClockBaseline(novel.value.id)
}
watch([novelId, timeChapterId], reloadChapterTime)
watch(() => [novel.value?.id, route.query.chapterId], () => {
  timeChapterId.value = typeof route.query.chapterId === 'string' ? route.query.chapterId : ''
}, { immediate: true })

const query = ref('')
const categoryFilter = ref('all')
const recentFilter = ref('all')
const selectedItemId = ref('')
const historyStatus = ref('all')
const historyField = ref('all')
const showEditor = ref(false)
const dataSaving = ref(false)
const dataConflictMessage = '正文来源或当前数据已变化，请重新核对/分析'
const editingNovelId = ref('')
const expectedEditBaseline = ref('')
const originalFields = ref<DataPanelField[]>([])
const expectedVersionBaseline = ref('')
const versionNovelId = ref('')
const deleteBaselines = new Map<string, string>()
const editingItemId = ref('')
const form = ref({ name: '', category: '自定义' as DataPanelCategory, keywords: '', automation: '', ownerItemId: '', equipmentState: 'stored' as EquipmentState })
const structuredFields = ref<DataPanelField[]>([])
const storyDayDraft = ref<number | null>(null)
const storyLabelDraft = ref('')
const expectedClock = ref('')
const showVersionModal = ref(false)
const versionItem = ref<DataPanelItem | null>(null)
const selectedVersionId = ref('')
const versionOptions = computed(() => (versionItem.value?.versions || []).slice().reverse().map(version => ({ label: `${version.label} · ${new Date(version.savedAt).toLocaleString('zh-CN')}`, value: version.id })))

const categoryOptions = ['角色', '作物', '资源', '建筑', '任务', '装备', '道具', '自定义'].map(value => ({ label: value, value }))
const categoryFilterOptions = [{ label: '全部分类', value: 'all' }, ...categoryOptions]
const recentFilterOptions = [
  { label: '全部出现记录', value: 'all' },
  { label: '最近 5 章', value: '5' },
  { label: '最近 20 章', value: '20' },
  { label: '尚未出现', value: 'never' },
]
const historyStatusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '待确认', value: 'pending' },
  { label: '已应用', value: 'accepted' },
  { label: '已忽略', value: 'rejected' },
]
const exportOptions = [
  { label: '导出 JSON', key: 'json' },
  { label: '导出 Markdown', key: 'markdown' },
]
const ownerOptions = computed(() => dataPanels.value
  .filter(item => item.id !== editingItemId.value && item.category === '角色')
  .map(item => ({ label: `${item.name}（${item.category}）`, value: item.id })))

// Background aggregate publications must not replace the author's clock draft
// or silently advance the baseline against which that draft will be saved.
function reloadOriginTime() {
  const id = novel.value?.id
  if (!id) return
  storyDayDraft.value = novel.value?.storyClock?.origin?.day ?? novel.value?.storyClock?.currentDay ?? null
  storyLabelDraft.value = novel.value?.storyClock?.origin?.label || ''
  expectedClock.value = novelStore.captureDataClockBaseline(id)
}
watch(() => novel.value?.id, reloadOriginTime, { immediate: true })

const totalFieldCount = computed(() => dataPanels.value.reduce((sum, item) => sum + item.fields.length, 0))
const pendingChangeCount = computed(() => (novel.value?.dataPanelChanges || []).filter(change => change.status === 'pending').length)
const automationRuleCount = computed(() => dataPanels.value.reduce(
  (sum, item) => sum + item.fields.reduce((fieldSum, field) => fieldSum + (field.automationRules?.length || 0), 0),
  0,
))
const latestChapterIndex = computed(() => Math.max(-1, ...(novel.value?.chapters || []).map(chapter => chapter.chapterIndex)))
const selectedItem = computed(() => dataPanels.value.find(item => item.id === selectedItemId.value))
let initialDataSelection = false
watch(() => dataPanels.value.map(item => item.id), ids => {
  if (!initialDataSelection && ids.length) { selectedItemId.value = ids[0]; initialDataSelection = true }
  else if (selectedItemId.value && !ids.includes(selectedItemId.value)) selectedItemId.value = ids[0] || ''
}, { immediate: true })
const filteredItems = computed(() => {
  const recent = recentFilter.value === 'all' || recentFilter.value === 'never'
    ? recentFilter.value
    : Number(recentFilter.value)
  return filterDataPanelItems(dataPanels.value, {
    query: query.value,
    category: categoryFilter.value,
    recent,
    latestChapterIndex: latestChapterIndex.value,
  })
})
const historyFieldOptions = computed(() => [
  { label: '全部字段', value: 'all' },
  ...((selectedItem.value?.fields || []).map(field => ({ label: field.name, value: field.id }))),
])
const timelineChanges = computed(() => filterDataPanelChanges(novel.value?.dataPanelChanges || [], {
  itemId: selectedItemId.value || undefined,
  status: historyStatus.value as DataPanelChange['status'] | 'all',
  fieldId: historyField.value === 'all' ? undefined : historyField.value,
}))

watch(selectedItemId, () => { historyField.value = 'all' })

function splitKeywords(value: string): string[] {
  return value.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean)
}

async function runDataMutation(action: () => Promise<boolean>): Promise<boolean> {
  if (dataSaving.value) return false
  dataSaving.value = true
  try {
    return await action()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '数据保存失败，请重试')
    return false
  } finally {
    dataSaving.value = false
  }
}

function saveStoryClock() {
  return runDataMutation(async () => {
    if (!novel.value) return false
    if (storyDayDraft.value === null) throw new Error('请明确填写故事起点，包括 0。')
    const targetNovelId = novelId.value
    const clock = await novelStore.setStoryClock(targetNovelId, storyDayDraft.value, storyLabelDraft.value, expectedClock.value)
    if (!clock) { message.warning(dataConflictMessage); return false }
    if (novelId.value === targetNovelId) {
      storyDayDraft.value = clock.origin?.day ?? clock.currentDay
      storyLabelDraft.value = clock.origin?.label || ''
      expectedClock.value = novelStore.captureDataClockBaseline(targetNovelId)
    }
    message.success('故事起点已确认，依赖旧来源的章节需要重新核对')
    return true
  })
}

function saveChapterTime() {
  return runDataMutation(async () => {
    const source = timeDraftSource
    if (!source || source.novelId !== novelId.value || source.chapterId !== timeChapterId.value) return false
    if (expectedTimeRecord.value && !replaceTime.value) throw new Error('请明确确认替换原时间记录。')
    if (timeMode.value === 'absolute' && (timeStart.value === null || timeEnd.value === null)
      || timeMode.value === 'relative' && timeElapsed.value === null) throw new Error('请明确填写时间数值，包括 0。')
    const clock = await novelStore.confirmChapterStoryTime(source.novelId, {
      chapterId: source.chapterId, chapterIndex: source.chapterIndex, content: source.content,
      expectedSourceVersionId: source.version, expectedRecordId: expectedTimeRecord.value, replace: replaceTime.value,
      mode: timeMode.value, startDay: timeStart.value ?? undefined, endDay: timeEnd.value ?? undefined,
      elapsedDays: timeElapsed.value ?? undefined, label: timeLabel.value,
    }, timeBaseline.value)
    if (!clock) return false
    if (source.novelId === novelId.value && source.chapterId === timeChapterId.value) reloadChapterTime()
    message.success('本章时间已确认，相关审核及依赖时间需要重新核对')
    return true
  })
}

function queueChapterDataChanges() {
  return runDataMutation(async () => {
    const chapter = timeChapter.value
    if (!chapter || !selectedTime.value.known) return false
    const count = await novelStore.queueAutomaticDataPanelChanges(novelId.value, chapter.chapterIndex, chapter.content)
    message.info(count ? `已生成 ${count} 条数据推算，请确认后写入` : '已按本章结束日处理可用规则，当前没有新的数据提案')
    return true
  })
}

function openEditor(item?: DataPanelItem) {
  if (dataSaving.value) return
  editingNovelId.value = novelId.value
  expectedEditBaseline.value = novelStore.captureDataPanelEditBaseline(novelId.value, item?.id)
  editingItemId.value = item?.id || ''
  form.value = item
    ? {
        name: item.name,
        category: item.category,
        keywords: item.relatedKeywords.join('、'),
        automation: formatDataPanelAutomationRules(item.fields),
        ownerItemId: item.ownerItemId || '',
        equipmentState: item.equipmentState || 'stored',
      }
    : { name: '', category: '自定义', keywords: '', automation: '', ownerItemId: '', equipmentState: 'stored' }
  originalFields.value = JSON.parse(JSON.stringify(item?.fields || []))
  structuredFields.value = item ? JSON.parse(JSON.stringify(originalFields.value)) : parseDataPanelFields('')
  showEditor.value = true
}

function openVersionModal(item: DataPanelItem) {
  if (dataSaving.value) return
  versionNovelId.value = novelId.value
  expectedVersionBaseline.value = novelStore.captureDataPanelEditBaseline(novelId.value, item.id)
  versionItem.value = item
  selectedVersionId.value = item.versions?.[item.versions.length - 1]?.id || ''
  showVersionModal.value = true
}

function restoreVersion() {
  return runDataMutation(async () => {
    if (!versionItem.value || !selectedVersionId.value) return false
    if (versionNovelId.value !== novelId.value) { message.warning(dataConflictMessage); return false }
    const restored = await novelStore.restoreDataPanelVersion(versionNovelId.value, versionItem.value.id, selectedVersionId.value, expectedVersionBaseline.value)
    if (!restored) { message.warning(dataConflictMessage); return false }
    showVersionModal.value = false
    message.success('数据面板已恢复')
    return true
  })
}

function saveItem() {
  return runDataMutation(async () => {
    if (editingNovelId.value !== novelId.value) { message.warning(dataConflictMessage); return false }
    const name = form.value.name.trim()
    if (!name) {
      message.warning('请填写数据名称')
      return false
    }
    let fields = calculateDataPanelFieldValues(structuredFields.value)
    const invalid = fields.find(field => field.calculationError)
    if (invalid) {
      message.error(`${invalid.name}：${invalid.calculationError}`)
      return false
    }
    fields = parseDataPanelAutomationRules(form.value.automation, fields, originalFields.value)
    fields = fields.map(field => {
      const previous = originalFields.value.find(item => item.name === field.name)
      return previous ? { ...field, id: previous.id } : field
    })
    const payload = {
      name,
      category: form.value.category,
      relatedKeywords: splitKeywords(form.value.keywords),
      ownerItemId: form.value.ownerItemId || undefined,
      equipmentState: form.value.equipmentState,
      fields,
    }
    const saved = editingItemId.value
      ? await novelStore.updateDataPanelItem(editingNovelId.value, editingItemId.value, payload, expectedEditBaseline.value)
      : await novelStore.addDataPanelItem(editingNovelId.value, payload, expectedEditBaseline.value)
    if (!saved) { message.warning(dataConflictMessage); return false }
    showEditor.value = false
    message.success('数据已保存')
    return true
  })
}

function confirmChange(id: string) {
  return runDataMutation(async () => {
    if (!await novelStore.applyDataPanelChange(novelId.value, id)) { message.warning(dataConflictMessage); return false }
    message.success('数据记忆已应用')
    return true
  })
}

function rejectChange(id: string) {
  return runDataMutation(async () => {
    if (!await novelStore.rejectDataPanelChange(novelId.value, id)) { message.warning(dataConflictMessage); return false }
    message.success('已忽略该变更')
    return true
  })
}

function prepareDelete(itemId: string) {
  if (dataSaving.value) return
  deleteBaselines.set(`${novelId.value}:${itemId}`, novelStore.captureDataPanelEditBaseline(novelId.value, itemId))
}

function removeItem(itemId: string) {
  return runDataMutation(async () => {
    const targetNovelId = novelId.value
    const key = `${targetNovelId}:${itemId}`
    const baseline = deleteBaselines.get(key) ?? novelStore.captureDataPanelEditBaseline(targetNovelId, itemId)
    if (!await novelStore.deleteDataPanelItem(targetNovelId, itemId, baseline)) { message.warning(dataConflictMessage); return false }
    deleteBaselines.delete(key)
    if (novelId.value === targetNovelId && selectedItemId.value === itemId) selectedItemId.value = ''
    message.success('数据对象已删除')
    return true
  })
}

function changeStatusLabel(status: DataPanelChange['status']): string {
  return status === 'pending' ? '待确认' : status === 'accepted' ? '已应用' : '已忽略'
}

function changeStatusType(status: DataPanelChange['status']): 'warning' | 'success' | 'default' {
  return status === 'pending' ? 'warning' : status === 'accepted' ? 'success' : 'default'
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function exportDataPanels(key: string) {
  if (!novel.value) return
  if (key === 'json') {
    download(
      `${novel.value.title}-数据面板.json`,
      JSON.stringify({ title: novel.value.title, dataPanels: novel.value.dataPanels, changes: novel.value.dataPanelChanges }, null, 2),
      'application/json;charset=utf-8',
    )
  } else {
    download(`${novel.value.title}-数据面板.md`, dataPanelsToMarkdown(novel.value), 'text/markdown;charset=utf-8')
  }
  message.success('数据面板已导出')
}
</script>

<style scoped>
.data-reference-warning { margin: 16px 0; padding: 16px; border: 1px solid var(--line-2); border-left: 3px solid var(--dai); border-radius: var(--r-s); }
.data-reference-warning p, .data-reference-warning ul { margin: 8px 0 0; font-size: 13px; line-height: 1.6; }
.data-header,
.header-actions,
.object-card-header,
.icon-actions,
.timeline-header,
.timeline-entry-header,
.modal-actions {
  display: flex;
  align-items: center;
}

.data-header,
.object-card-header,
.timeline-header,
.timeline-entry-header {
  justify-content: space-between;
}

.data-header { gap: 16px; flex-wrap: wrap; }
.header-actions, .icon-actions, .modal-actions { gap: 8px; }
.modal-actions { justify-content: flex-end; }
.change-actions { display: flex; gap: 8px; margin-top: 8px; }

.data-header { margin-bottom: 16px; }
.data-header .page-title { margin: 0; font-family: var(--f-serif); font-weight: 700; letter-spacing: 0.04em; }

.page-subtitle {
  margin: 6px 0 0;
  color: var(--ink-3);
  font-size: 13px;
}

.data-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
  gap: 12px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--paper);
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-1);
}

.story-clock-panel {
  display: grid;
  align-items: stretch;
  gap: 16px;
  margin: 12px 0 4px;
  padding: 14px 18px;
  border: 1px solid var(--line-2);
  border-left: 3px solid var(--dai);
  border-radius: var(--r-l);
  background: var(--paper);
  box-shadow: var(--shadow-1);
}

.story-clock-panel > div:first-child {
  display: grid;
  gap: 4px;
}

.story-clock-panel > div:first-child > strong {
  font-family: var(--f-serif);
  font-size: 16px;
  color: var(--ink);
}

.story-clock-hint {
  color: var(--ink-3);
  font-size: 12px;
}

.story-clock-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.story-clock-controls > .n-select { min-width: 220px; flex: 1; }
.story-clock-controls > .n-input-number { width: 160px; }
.story-clock-controls > .n-input { min-width: 180px; flex: 1; }
.story-clock-panel p { margin: 0; color: var(--ink-2); }
.story-clock-panel details { overflow-wrap: anywhere; }

.story-clock-controls > span {
  color: var(--ink-2);
  font-size: 13px;
}

@media (max-width: 760px) {
  .story-clock-panel {
    align-items: stretch;
    flex-direction: column;
  }

  .story-clock-controls {
    justify-content: flex-start;
  }
}

.summary-card strong {
  color: var(--ink);
  font-family: var(--f-serif);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.summary-card span {
  color: var(--ink-3);
  font-size: 12px;
}
.summary-card:nth-child(3) strong { color: var(--zhu); }

.filter-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 160px) minmax(0, 160px);
  gap: 10px;
  padding: 16px 0;
}
@media (max-width: 640px) {
  .filter-bar { grid-template-columns: 1fr; }
}

.data-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 24px;
  align-items: start;
}

.object-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 14px;
}

.data-object-card {
  min-width: 0;
  padding: 16px 18px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  background: var(--paper);
  box-shadow: var(--shadow-1);
  cursor: pointer;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

.data-object-card:hover { border-color: var(--ink-3); box-shadow: var(--shadow-2); }
.data-object-card:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }

.data-object-card.selected {
  border-color: var(--zhu);
  background: linear-gradient(var(--zhu-soft), var(--zhu-soft)), var(--paper);
  box-shadow: 0 0 0 1px var(--zhu);
}

.object-card-header { align-items: flex-start; gap: 8px; }
.object-card-header h3 { margin: 8px 0 0; font-family: var(--f-serif); font-size: 17px; font-weight: 700; color: var(--ink); }

.field-table { margin: 12px 0; border-top: 1px solid var(--line-2); }
.field-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
  color: var(--ink-2);
  font-size: 13px;
}
.field-row strong {
  color: var(--zhu);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.field-row small { margin-left: 4px; padding: 0 4px; border-radius: var(--r-s); background: var(--dai-soft); color: var(--dai); font-size: 11px; }
.object-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--ink-3); font-size: 11px; }
.object-meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.object-meta span:last-child { flex-shrink: 0; }

.timeline-section {
  position: sticky;
  top: 16px;
  padding: 16px 18px;
  background: var(--paper);
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-1);
}
.timeline-header h3 { margin: 0 0 4px; font-family: var(--f-serif); font-size: 17px; font-weight: 700; }
.timeline-header span { color: var(--ink-3); font-size: 12px; }
.timeline-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; }
.change-timeline { display: flex; flex-direction: column; }
.timeline-entry { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; padding-bottom: 16px; }
.timeline-point { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--zhu); box-shadow: 0 13px 0 -3px var(--line-2); }
.timeline-entry-header { gap: 8px; }
.timeline-entry-header strong { font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
.timeline-entry p { margin: 5px 0; color: var(--zhu); font-weight: 600; font-variant-numeric: tabular-nums; }
.timeline-entry small { display: block; color: var(--ink-3); line-height: 1.5; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.span-2 { grid-column: 1 / -1; }
.editor-modal { width: min(680px, calc(100vw - 32px)); }

@media (max-width: 1050px) {
  .data-layout { grid-template-columns: 1fr; }
  .timeline-section { position: static; }
}

@media (max-width: 720px) {
  .data-header { align-items: flex-start; flex-direction: column; }
  .data-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-bar, .object-grid, .form-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
}

.data-summary { display: flex; flex-wrap: wrap; gap: 20px; margin: 8px 0 16px; }
.summary-card { display: inline-flex; flex-direction: row; align-items: baseline; gap: 6px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.summary-card strong { font-size: 17px; }
.data-layout { grid-template-columns: minmax(0, 1fr) minmax(300px, 36%); }
.object-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.selected-data-detail { padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid var(--line-2); }
.selected-data-title { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.selected-data-title h3 { font-size: 25px; }
.selected-data-keywords { margin: 12px 0; color: var(--ink-2); font-size: 13px; }
.selected-data-header { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 8px; }
.selected-data-fields { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.selected-data-fields > div { display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 1.2fr); padding: 10px; border-bottom: 1px solid var(--line); gap: 12px; font-size: 13px; }
.selected-data-fields > div:last-child { border-bottom: 0; }
.selected-data-fields dt { color: var(--ink-2); }
.selected-data-fields dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 1200px) { .object-grid { grid-template-columns: 1fr; } }
@media (max-width: 1000px) { .data-layout { grid-template-columns: 1fr; } .object-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .timeline-section { position: static; } }
@media (max-width: 650px) { .object-grid { grid-template-columns: 1fr; } }
</style>
