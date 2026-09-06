<template>
  <div v-if="novel" class="data-workspace page-container fade-in">
    <header class="data-header">
      <div>
        <h2 class="page-title">数据面板</h2>
        <p class="page-subtitle">全书状态、数值与变化记录</p>
      </div>
      <div class="header-actions">
        <n-dropdown trigger="click" :options="exportOptions" @select="exportDataPanels">
          <n-button secondary>
            <template #icon><n-icon><download-outline /></n-icon></template>
            导出
          </n-button>
        </n-dropdown>
        <n-button type="primary" @click="openEditor()">
          <template #icon><n-icon><add-outline /></n-icon></template>
          新建数据
        </n-button>
      </div>
    </header>

    <div class="data-summary">
      <span><strong>{{ dataPanels.length }}</strong> 个数据对象</span>
      <span><strong>{{ totalFieldCount }}</strong> 个字段</span>
      <span><strong>{{ pendingChangeCount }}</strong> 条待确认变更</span>
      <span><strong>{{ automationRuleCount }}</strong> 条自动规则</span>
    </div>

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
            :class="{ selected: selectedItemId === item.id }"
            @click="selectedItemId = item.id"
          >
            <div class="object-card-header">
              <div>
                <n-tag size="small">{{ item.category }}</n-tag>
                <h3>{{ item.name }}</h3>
              </div>
              <div class="icon-actions">
                <n-button quaternary circle size="small" title="编辑数据" @click.stop="openEditor(item)">
                  <template #icon><n-icon><create-outline /></n-icon></template>
                </n-button>
                <n-button v-if="item.versions?.length" quaternary circle size="small" title="查看历史版本" @click.stop="openVersionModal(item)">
                  <template #icon><n-icon><time-outline /></n-icon></template>
                </n-button>
                <n-popconfirm @positive-click="removeItem(item.id)">
                  <template #trigger>
                    <n-button quaternary circle size="small" title="删除数据" @click.stop>
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
                <small v-if="field.calculationError" role="alert" style="color: var(--color-error)">{{ field.calculationError }}（保留原值）</small>
              </div>
            </div>

            <div class="object-meta">
              <span v-if="item.relatedKeywords.length">{{ item.relatedKeywords.join('、') }}</span>
              <span>{{ item.lastMentionChapterIndex === undefined ? '尚未在正文出现' : `最近第 ${item.lastMentionChapterIndex + 1} 章` }}</span>
            </div>
          </article>
        </div>
        <n-empty v-else description="没有符合条件的数据对象" />
      </section>

      <aside class="timeline-section">
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
                <strong>第 {{ change.chapterIndex + 1 }} 章 · {{ change.fieldName }}</strong>
                <n-tag size="small" :type="changeStatusType(change.status)">{{ changeStatusLabel(change.status) }}</n-tag>
              </div>
              <p>{{ change.oldValue }} → {{ change.newValue }}</p>
              <small>{{ change.reason }}</small>
            </div>
          </div>
        </div>
        <n-empty v-else description="暂无变化记录" />
      </aside>
    </div>

    <n-modal v-model:show="showEditor" preset="card" :title="editingItemId ? '编辑数据' : '新建数据'" class="editor-modal">
      <n-form label-placement="top">
        <div class="form-grid">
          <n-form-item label="名称"><n-input v-model:value="form.name" placeholder="数据对象名称" /></n-form-item>
          <n-form-item label="分类"><n-select v-model:value="form.category" :options="categoryOptions" /></n-form-item>
          <n-form-item label="关联关键词" class="span-2"><n-input v-model:value="form.keywords" placeholder="用顿号或逗号分隔" /></n-form-item>
          <n-form-item label="字段与自动规则" class="span-2">
            <DataPanelFieldEditor v-model:fields="structuredFields" v-model:automation-text="form.automation" />
          </n-form-item>
        </div>
      </n-form>
      <template #footer>
        <div class="modal-actions">
          <n-button @click="showEditor = false">取消</n-button>
          <n-button type="primary" @click="saveItem">保存</n-button>
        </div>
      </template>
    </n-modal>

    <n-modal v-model:show="showVersionModal" preset="card" title="数据面板版本" class="editor-modal">
      <div v-if="versionItem" class="version-dialog">
        <p><strong>{{ versionItem.name }}</strong> · 当前版本</p>
        <n-select v-model:value="selectedVersionId" :options="versionOptions" />
        <n-button type="warning" :disabled="!selectedVersionId" @click="restoreVersion">恢复此版本</n-button>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NButton, NDropdown, NEmpty, NForm, NFormItem, NIcon, NInput, NModal,
  NPopconfirm, NSelect, NTag, useMessage,
} from 'naive-ui'
import { AddOutline, CreateOutline, DownloadOutline, TrashOutline, TimeOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import DataPanelFieldEditor from '@/components/data-panel/DataPanelFieldEditor.vue'
import {
  calculateDataPanelFieldValues,
  dataPanelsToMarkdown,
  filterDataPanelChanges,
  filterDataPanelItems,
  formatDataPanelAutomationRules,
  parseDataPanelFields,
  parseDataPanelAutomationRules,
} from '@/services/dataPanel'
import type { DataPanelCategory, DataPanelChange, DataPanelField, DataPanelItem } from '@/types/novel'

const route = useRoute()
const novelStore = useNovelStore()
const message = useMessage()
const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const dataPanels = computed(() => novel.value?.dataPanels || [])

const query = ref('')
const categoryFilter = ref('all')
const recentFilter = ref('all')
const selectedItemId = ref('')
const historyStatus = ref('all')
const historyField = ref('all')
const showEditor = ref(false)
const editingItemId = ref('')
const form = ref({ name: '', category: '自定义' as DataPanelCategory, keywords: '', automation: '' })
const structuredFields = ref<DataPanelField[]>([])
const showVersionModal = ref(false)
const versionItem = ref<DataPanelItem | null>(null)
const selectedVersionId = ref('')
const versionOptions = computed(() => (versionItem.value?.versions || []).slice().reverse().map(version => ({ label: `${version.label} · ${new Date(version.savedAt).toLocaleString('zh-CN')}`, value: version.id })))

const categoryOptions = ['角色', '作物', '资源', '建筑', '任务', '自定义'].map(value => ({ label: value, value }))
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

const totalFieldCount = computed(() => dataPanels.value.reduce((sum, item) => sum + item.fields.length, 0))
const pendingChangeCount = computed(() => (novel.value?.dataPanelChanges || []).filter(change => change.status === 'pending').length)
const automationRuleCount = computed(() => dataPanels.value.reduce(
  (sum, item) => sum + item.fields.reduce((fieldSum, field) => fieldSum + (field.automationRules?.length || 0), 0),
  0,
))
const latestChapterIndex = computed(() => Math.max(-1, ...(novel.value?.chapters || []).map(chapter => chapter.chapterIndex)))
const selectedItem = computed(() => dataPanels.value.find(item => item.id === selectedItemId.value))
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

function openEditor(item?: DataPanelItem) {
  editingItemId.value = item?.id || ''
  form.value = item
    ? {
        name: item.name,
        category: item.category,
        keywords: item.relatedKeywords.join('、'),
        automation: formatDataPanelAutomationRules(item.fields),
      }
    : { name: '', category: '自定义', keywords: '', automation: '' }
  structuredFields.value = item
    ? item.fields.map(field => ({ ...field, automationRules: field.automationRules?.map(rule => ({ ...rule })) }))
    : parseDataPanelFields('')
  showEditor.value = true
}

function openVersionModal(item: DataPanelItem) {
  versionItem.value = item
  selectedVersionId.value = item.versions?.[item.versions.length - 1]?.id || ''
  showVersionModal.value = true
}

function restoreVersion() {
  if (!versionItem.value || !selectedVersionId.value) return
  if (novelStore.restoreDataPanelVersion(novelId.value, versionItem.value.id, selectedVersionId.value)) {
    showVersionModal.value = false
    message.success('数据面板已恢复')
  } else {
    message.warning('历史版本不存在或已失效')
  }
}

function saveItem() {
  const name = form.value.name.trim()
  if (!name) {
    message.warning('请填写数据名称')
    return
  }
  const oldItem = dataPanels.value.find(item => item.id === editingItemId.value)
  let fields = calculateDataPanelFieldValues(structuredFields.value)
  const invalid = fields.find(field => field.calculationError)
  if (invalid) {
    message.error(`${invalid.name}：${invalid.calculationError}`)
    return
  }
  fields = parseDataPanelAutomationRules(form.value.automation, fields, oldItem?.fields)
  fields = fields.map(field => {
    const previous = oldItem?.fields.find(item => item.name === field.name)
    return previous ? { ...field, id: previous.id } : field
  })
  const payload = {
    name,
    category: form.value.category,
    relatedKeywords: splitKeywords(form.value.keywords),
    fields,
  }
  if (editingItemId.value) novelStore.updateDataPanelItem(novelId.value, editingItemId.value, payload)
  else novelStore.addDataPanelItem(novelId.value, payload)
  showEditor.value = false
  message.success('数据已保存')
}

function removeItem(itemId: string) {
  novelStore.deleteDataPanelItem(novelId.value, itemId)
  if (selectedItemId.value === itemId) selectedItemId.value = ''
  message.success('数据对象已删除')
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

.data-header { gap: 16px; }
.header-actions, .icon-actions, .modal-actions { gap: 8px; }
.modal-actions { justify-content: flex-end; }

.page-subtitle {
  margin: 4px 0 0;
  color: var(--text-color-tertiary);
  font-size: 13px;
}

.data-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 14px 0;
  color: var(--text-color-tertiary);
  font-size: 13px;
  border-bottom: 1px solid var(--border-color-light);
}

.data-summary strong { color: var(--text-color-primary); }

.filter-bar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 160px 160px;
  gap: 10px;
  padding: 16px 0;
}

.data-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 24px;
  align-items: start;
}

.object-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.data-object-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-md);
  background: var(--bg-color-card);
  cursor: pointer;
}

.data-object-card.selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary-light);
}

.object-card-header { align-items: flex-start; gap: 8px; }
.object-card-header h3 { margin: 8px 0 0; font-size: 15px; }

.field-table { margin: 12px 0; border-top: 1px solid var(--border-color-light); }
.field-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-color-light);
  color: var(--text-color-secondary);
  font-size: 13px;
}
.field-row small { margin-left: 4px; color: var(--color-primary); }
.object-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--text-color-tertiary); font-size: 11px; }
.object-meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.object-meta span:last-child { flex-shrink: 0; }

.timeline-section {
  position: sticky;
  top: 16px;
  padding-left: 20px;
  border-left: 1px solid var(--border-color-light);
}
.timeline-header h3 { margin: 0 0 4px; font-size: 16px; }
.timeline-header span { color: var(--text-color-tertiary); font-size: 12px; }
.timeline-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; }
.change-timeline { display: flex; flex-direction: column; }
.timeline-entry { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; padding-bottom: 16px; }
.timeline-point { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 13px 0 -3px var(--border-color); }
.timeline-entry-header { gap: 8px; }
.timeline-entry p { margin: 5px 0; color: var(--color-primary); font-weight: 600; }
.timeline-entry small { display: block; color: var(--text-color-tertiary); line-height: 1.5; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.span-2 { grid-column: 1 / -1; }
.editor-modal { width: min(680px, calc(100vw - 32px)); }

@media (max-width: 1050px) {
  .data-layout { grid-template-columns: 1fr; }
  .timeline-section { position: static; padding: 20px 0 0; border-left: 0; border-top: 1px solid var(--border-color-light); }
}

@media (max-width: 720px) {
  .data-header { align-items: flex-start; flex-direction: column; }
  .filter-bar, .object-grid, .form-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
}
</style>
