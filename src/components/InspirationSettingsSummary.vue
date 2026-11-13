<template>
  <aside class="inspiration-settings paper-panel" aria-label="已整理的设定">
    <header class="summary-heading"><span class="summary-mark"><n-icon :size="23"><document-text-outline /></n-icon></span><div><h2>已整理的设定</h2><p>保留已填写的内容，随时调整故事方向。</p></div></header>
    <div class="summary-fields">
      <button v-for="field in fields" :key="field.key" type="button" class="summary-field" :disabled="busy" :aria-label="`编辑${field.label}`" @click="openEdit(field.key)">
        <span class="field-symbol"><n-icon :size="23"><component :is="field.icon" /></n-icon></span>
        <span class="field-label">{{ field.label }}</span><strong :class="{ empty: !field.value }">{{ field.value || '待整理' }}</strong><n-icon class="field-pencil" :size="17"><create-outline /></n-icon>
      </button>
    </div>
    <div class="summary-tip"><n-icon :size="23"><bulb-outline /></n-icon><div><h3>完善设定</h3><p>继续讨论人物、背景与冲突，或先手动补充。点击下方按钮，从完整对话整理设定并检查。</p></div></div>
    <slot><n-button class="summary-extract" block type="primary" size="large" :loading="extracting" :disabled="busy || !canExtract" @click="emit('extract')"><template #icon><n-icon><document-text-outline /></n-icon></template>{{ extracting ? '整理中' : '整理设定并检查' }}</n-button></slot>
    <n-button block size="large" class="summary-history" :disabled="busy" @click="emit('history')"><template #icon><n-icon><time-outline /></n-icon></template>查看历史</n-button>
    <p class="summary-footnote">未整理的字段会保持为空，不会自动替你决定。</p>
    <n-modal :show="editing !== null" preset="card" :title="`编辑${fields.find(field => field.key === editing)?.label || '设定'}`" style="width:min(520px,calc(100vw - 32px))" @update:show="value => { if (!value) editing = null }">
      <n-select v-if="editing === 'genre'" v-model:value="draft" :options="genres.map(genre => ({ label: genre.label, value: genre.value }))" aria-label="故事类型" />
      <n-input v-else v-model:value="draft" :type="editing === 'protagonist' ? 'text' : 'textarea'" :rows="4" :maxlength="2000" aria-label="设定内容" />
      <template #footer><div class="summary-edit-actions"><n-button @click="editing = null">取消</n-button><n-button type="primary" @click="saveEdit">保存设定</n-button></div></template>
    </n-modal>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NIcon, NInput, NModal, NSelect } from 'naive-ui'
import { BookOutline, BulbOutline, CreateOutline, DocumentTextOutline, LinkOutline, LocationOutline, PersonOutline, TimeOutline } from '@vicons/ionicons5'
import { genres } from '@/data/genres'
import type { CreateWizardForm } from '@/types/novel'
const props = defineProps<{ form: CreateWizardForm; busy: boolean; extracting: boolean; canExtract: boolean }>()
const emit = defineEmits<{ extract: []; history: []; 'draft-change': [form: CreateWizardForm] }>()
type SummaryKey = 'genre' | 'protagonist' | 'world' | 'conflict'
const editing = ref<SummaryKey | null>(null)
const draft = ref('')
const fields = computed(() => [
  { key: 'genre' as const, label: '类型', value: genres.find(genre => genre.value === props.form.genre)?.label || props.form.genre, icon: BookOutline },
  { key: 'protagonist' as const, label: '主角', value: props.form.settings.protagonist.name, icon: PersonOutline },
  { key: 'world' as const, label: '故事舞台', value: props.form.settings.worldBuilding.worldType, icon: LocationOutline },
  { key: 'conflict' as const, label: '核心悬念', value: props.form.settings.coreConflict.coreSuspense, icon: LinkOutline },
])
function openEdit(key: SummaryKey) {
  editing.value = key
  draft.value = key === 'genre' ? props.form.genre : fields.value.find(field => field.key === key)?.value || ''
}
function saveEdit() {
  if (!editing.value || props.busy) return
  const form: CreateWizardForm = JSON.parse(JSON.stringify(props.form))
  if (editing.value === 'genre') { form.genre = draft.value; form.subGenre = '' }
  else if (editing.value === 'protagonist') form.settings.protagonist.name = draft.value.trim()
  else if (editing.value === 'world') form.settings.worldBuilding.worldType = draft.value.trim()
  else form.settings.coreConflict.coreSuspense = draft.value.trim()
  emit('draft-change', form)
  editing.value = null
}
</script>

<style scoped>
.inspiration-settings { display: flex; flex-direction: column; gap: 16px; min-width: 0; padding: 24px; }
.summary-heading { display: flex; align-items: flex-start; gap: 12px; }
.summary-heading h2 { font-size: 23px; margin: 0 0 6px; }
.summary-heading p, .summary-tip p { color: var(--ink-2); font-size: 13px; line-height: 1.75; }
.summary-mark, .field-symbol { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 44px; border-radius: 8px; background: var(--dai-soft); color: var(--dai); }
.summary-fields { display: grid; gap: 12px; margin-top: 10px; }
.summary-field { display: grid; grid-template-columns: 40px 62px minmax(0, 1fr) 17px; align-items: center; gap: 10px; min-height: 80px; padding: 12px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--paper); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
.summary-field:hover { border-color: var(--zhu); }
.summary-field strong { font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.field-label, .empty, .field-pencil { color: var(--ink-2); font-size: 13px; }
.summary-tip { display: flex; align-items: flex-start; gap: 12px; padding: 18px 14px; border: 1px solid var(--line); border-radius: 9px; margin-top: auto; }
.summary-tip > .n-icon { color: var(--jin); flex-shrink: 0; }
.summary-tip h3 { font-size: 16px; margin-bottom: 6px; }
.summary-footnote { color: var(--ink-3); font-size: 11px; }
.summary-edit-actions { display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 1100px) { .inspiration-settings { padding: 18px; } .summary-field { grid-template-columns: 32px minmax(0, 1fr) 17px; gap: 8px; } .field-label { grid-column: 2; } .summary-field strong { grid-column: 2; } .field-symbol { width: 32px; grid-row: span 2; } .field-pencil { grid-column: 3; grid-row: 1 / 3; } }
</style>
