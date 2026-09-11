<template>
  <button v-if="open" class="review-toggle-btn data-panel-toggle-btn" title="收起数据面板" @click="emit('close')">▶</button>
  <transition name="slide-right">
    <div v-if="open" class="review-sidebar data-panel-sidebar">
      <div class="review-sidebar-header">
        <div class="review-header-title"><strong>数据面板</strong></div>
        <button class="close-btn" title="关闭数据面板" @click="emit('close')">✕</button>
      </div>
      <div class="review-sidebar-body">
        <div class="data-panel-actions">
          <n-button size="small" type="primary" @click="emit('create')">新增数据</n-button>
          <n-button size="small" @click="emit('recommend')">按章节计划推荐</n-button>
          <n-button size="small" :disabled="!items.length" @click="emit('queue-rules')">推算规则</n-button>
          <n-button size="small" :disabled="!hasContent || scanning" @click="emit('scan')">{{ scanning ? '扫描中...' : '扫描变更' }}</n-button>
        </div>

        <section v-if="pendingChanges.length" class="review-section">
          <div class="review-section-title data-change-section-title">
            <label><input type="checkbox" :checked="allPendingSelected" @change="emit('toggle-all-changes')" />待确认变更（{{ pendingChanges.length }}）</label>
            <span class="batch-change-actions">
              <n-button size="tiny" type="primary" :disabled="!selectedChangeCount" @click.stop="emit('apply-selected')">批量应用</n-button>
              <n-button size="tiny" :disabled="!selectedChangeCount" @click.stop="emit('reject-selected')">批量忽略</n-button>
            </span>
          </div>
          <div class="data-change-list">
            <div v-for="change in pendingChanges" :key="change.id" class="data-change-card">
              <label class="data-change-title">
                <input type="checkbox" :checked="selectedChangeIds.has(change.id)" @change="emit('toggle-change', change.id)" />
                <strong>{{ change.itemName }} · {{ change.fieldName }} <span class="confidence-badge">明确</span></strong>
              </label>
              <div class="change-values">{{ change.oldValue }} → {{ change.newValue }}</div>
              <n-input v-if="!change.mutation" size="small" :value="drafts[change.id] ?? change.newValue" placeholder="可编辑后再应用" @update:value="value => emit('update-draft', change.id, value)" />
              <p>{{ change.reason }}</p>
              <div class="change-actions">
                <n-button size="tiny" type="primary" @click="emit('apply-change', change.id)">应用</n-button>
                <n-button size="tiny" @click="emit('reject-change', change.id)">忽略</n-button>
              </div>
            </div>
          </div>
        </section>

        <details v-if="historyCount" class="data-history-section">
          <summary>变更历史（{{ filteredHistory.length }}）</summary>
          <div class="data-history-filters">
            <n-select size="small" :value="historyChapter" :options="historyChapterOptions" @update:value="value => emit('update-history-chapter', value)" />
            <n-select size="small" :value="historyItem" :options="historyItemOptions" @update:value="value => emit('update-history-item', value)" />
            <n-select size="small" :value="historyStatus" :options="historyStatusOptions" @update:value="value => emit('update-history-status', value)" />
          </div>
          <div v-if="filteredHistory.length" class="data-history-list">
            <div v-for="change in filteredHistory.slice(0, 100)" :key="`history-${change.id}`" class="data-history-row">
              <div><strong>{{ change.itemName }} · {{ change.fieldName }}</strong><span class="history-status">{{ statusLabel(change.status) }}</span></div>
              <span>第 {{ change.chapterIndex + 1 }} 章：{{ change.oldValue }} → {{ change.newValue }}</span>
            </div>
          </div>
          <div v-else class="panel-empty">没有符合筛选条件的记录。</div>
          <div class="data-history-cleanup">
            <span>保留最近</span>
            <n-input-number size="small" :value="historyKeepCount" :min="0" :max="10000" @update:value="value => emit('update-history-keep-count', value || 0)" />
            <n-popconfirm @positive-click="emit('cleanup', 'count')"><template #trigger><n-button size="tiny">条记录</n-button></template>清理更早的已处理记录？待确认记录会保留。</n-popconfirm>
            <n-input-number size="small" :value="historyKeepChapters" :min="1" :max="10000" @update:value="value => emit('update-history-keep-chapters', value || 1)" />
            <n-popconfirm @positive-click="emit('cleanup', 'chapters')"><template #trigger><n-button size="tiny">章记录</n-button></template>清理更早章节的已处理记录？待确认记录会保留。</n-popconfirm>
            <n-popconfirm @positive-click="emit('cleanup', 'all')"><template #trigger><n-button size="tiny" type="error" ghost>清空已处理</n-button></template>清空全部已应用和已忽略记录？待确认记录会保留。</n-popconfirm>
          </div>
        </details>

        <div v-if="!items.length" class="panel-empty">暂无数据，适合记录角色面板、作物成长、资源库存等。</div>
        <div v-for="item in items" :key="item.id" class="data-item-card">
          <div class="data-item-header">
            <label class="data-item-title"><input type="checkbox" :checked="selectedItemIds.has(item.id)" @change="emit('toggle-item', item.id)" /><span>{{ categoryIcon(item.category) }} {{ item.name }}</span></label>
            <div class="data-item-actions">
              <n-button size="tiny" @click="emit('edit', item)">编辑</n-button>
              <n-button size="tiny" quaternary type="error" @click="emit('delete', item.id)">删除</n-button>
            </div>
          </div>
          <div class="data-field-list">
            <div v-for="field in item.fields" :key="field.id" class="data-field-row">
              <span>{{ field.name }}<small v-if="field.type && field.type !== 'text'">{{ field.type }}</small><small v-if="field.formula">= {{ field.formula }}</small><small v-for="rule in field.automationRules || []" :key="rule.id">{{ getDataPanelRuleLabel(rule, field) }}</small></span>
              <strong>{{ field.value }}{{ field.unit ? ` ${field.unit}` : '' }}</strong>
              <small v-if="field.calculationError" role="alert" style="color: var(--color-error)">{{ field.calculationError }}（保留原值）</small>
            </div>
          </div>
          <EquipmentSummary :item="item" :items="items" />
          <div v-if="item.relatedKeywords.length" class="data-keywords">关键词：{{ item.relatedKeywords.join('、') }}</div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { NButton, NInput, NInputNumber, NPopconfirm, NSelect } from 'naive-ui'
import { getDataPanelRuleLabel } from '@/services/dataPanel'
import type { DataPanelChange, DataPanelItem } from '@/types/novel'
import EquipmentSummary from '@/components/data-panel/EquipmentSummary.vue'

defineProps<{
  open: boolean
  items: DataPanelItem[]
  pendingChanges: DataPanelChange[]
  filteredHistory: DataPanelChange[]
  historyCount: number
  selectedItemIds: Set<string>
  selectedChangeIds: Set<string>
  selectedChangeCount: number
  allPendingSelected: boolean
  drafts: Record<string, string>
  hasContent: boolean
  scanning: boolean
  historyChapter: string
  historyItem: string
  historyStatus: string
  historyKeepCount: number
  historyKeepChapters: number
  historyChapterOptions: Array<{ label: string; value: string }>
  historyItemOptions: Array<{ label: string; value: string }>
  historyStatusOptions: Array<{ label: string; value: string }>
}>()

const emit = defineEmits<{
  close: []; create: []; recommend: []; 'queue-rules': []; scan: []; 'toggle-all-changes': []
  'toggle-change': [id: string]; 'apply-selected': []; 'reject-selected': []
  'apply-change': [id: string]; 'reject-change': [id: string]; 'update-draft': [id: string, value: string]
  'toggle-item': [id: string]; edit: [item: DataPanelItem]; delete: [id: string]
  cleanup: [mode: 'all' | 'count' | 'chapters']
  'update-history-chapter': [value: string]; 'update-history-item': [value: string]; 'update-history-status': [value: string]
  'update-history-keep-count': [value: number]; 'update-history-keep-chapters': [value: number]
}>()

function statusLabel(status: DataPanelChange['status']) { return status === 'pending' ? '待确认' : status === 'accepted' ? '已应用' : '已忽略' }
function categoryIcon(category: string) {
  return ({ 角色: '人', 作物: '苗', 资源: '数', 建筑: '筑', 任务: '任', 装备: '装', 道具: '具', 自定义: '值' } as Record<string, string>)[category] || '值'
}
</script>

<style scoped>
.review-toggle-btn { position: fixed; right: 430px; top: 50%; z-index: 31; width: 26px; height: 48px; border: 1px solid var(--border-color); border-right: 0; background: var(--bg-color-card); cursor: pointer; }
.review-sidebar { position: fixed; top: 0; right: 0; z-index: 30; width: min(430px, 92vw); height: 100vh; display: flex; flex-direction: column; background: var(--bg-color-card); border-left: 1px solid var(--border-color); box-shadow: var(--shadow-lg); }
.review-sidebar-header, .data-item-header, .data-change-section-title, .data-history-row > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.review-sidebar-header { min-height: 54px; padding: 0 16px; border-bottom: 1px solid var(--border-color-light); }
.close-btn { border: 0; background: none; color: var(--text-color-tertiary); cursor: pointer; font-size: 16px; }
.review-sidebar-body { flex: 1; overflow: auto; padding: 14px; }
.data-panel-actions, .batch-change-actions, .change-actions, .data-item-actions, .data-history-cleanup { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
.review-section, .data-history-section, .data-item-card { margin-top: 12px; padding: 12px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); }
.data-change-list, .data-history-list { display: grid; gap: 8px; margin-top: 9px; }
.data-change-card, .data-history-row { padding: 9px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); }
.data-change-title { display: flex; gap: 7px; align-items: center; }
.change-values { margin: 7px 0; color: var(--color-primary); font-weight: 600; }
.data-change-card p, .data-history-row > span { margin: 7px 0; color: var(--text-color-tertiary); font-size: 12px; }
.confidence-badge, .history-status, .data-field-row small { margin-left: 5px; padding: 1px 5px; border-radius: 3px; background: var(--bg-color-secondary); color: var(--text-color-tertiary); font-size: 10px; }
.data-history-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 10px 0; }
.data-history-cleanup { margin-top: 10px; }
.data-history-cleanup :deep(.n-input-number) { width: 82px; }
.data-item-card { background: var(--bg-color); }
.data-item-title { display: flex; gap: 7px; align-items: center; min-width: 0; }
.data-field-list { margin-top: 8px; }
.data-field-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid var(--border-color-light); }
.data-field-row > span { min-width: 0; overflow-wrap: anywhere; }
.data-keywords, .panel-empty { margin-top: 8px; color: var(--text-color-tertiary); font-size: 12px; }
.slide-right-enter-active, .slide-right-leave-active { transition: transform .2s ease, opacity .2s ease; }
.slide-right-enter-from, .slide-right-leave-to { transform: translateX(100%); opacity: 0; }
@media (max-width: 560px) {
  .review-toggle-btn { right: calc(92vw); }
  .data-history-filters { grid-template-columns: 1fr; }
}
</style>
