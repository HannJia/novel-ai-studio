<template>
  <div class="field-editor">
    <n-radio-group v-model:value="mode" size="small">
      <n-radio-button value="structured">结构化编辑</n-radio-button>
      <n-radio-button value="advanced">高级文本</n-radio-button>
    </n-radio-group>
    <p v-for="field in formulaErrors" :key="field.id" role="alert" class="formula-error">{{ field.name }}：{{ field.calculationError }}</p>

    <template v-if="mode === 'structured'">
      <section class="editor-section">
        <div class="section-heading">
          <strong>字段</strong>
          <n-button size="tiny" @click="addField">添加字段</n-button>
        </div>
        <div v-if="fields.length" class="field-list">
          <div v-for="field in fields" :key="field.id" class="field-row">
            <n-input size="small" :value="field.name" placeholder="字段名" @update:value="value => updateField(field.id, { name: value })" />
            <n-input size="small" :value="field.value" placeholder="当前值" @update:value="value => updateField(field.id, { value })" />
            <n-input size="small" :value="field.unit" placeholder="单位" @update:value="value => updateField(field.id, { unit: value })" />
            <n-select size="small" :value="field.type || 'text'" :options="fieldTypeOptions" @update:value="value => updateField(field.id, { type: value })" />
            <n-input v-if="field.type === 'formula'" size="small" :value="field.formula" placeholder="如：总周期-已成长" @update:value="value => updateField(field.id, { formula: value, autoCalculate: true })" />
            <span v-else class="formula-placeholder">-</span>
            <n-button quaternary circle size="small" title="删除字段" @click="removeField(field.id)">
              <template #icon><n-icon><trash-outline /></n-icon></template>
            </n-button>
          </div>
        </div>
        <n-empty v-else size="small" description="还没有字段" />
      </section>

      <section class="editor-section">
        <div class="section-heading">
          <strong>自动规则</strong>
          <n-button size="tiny" :disabled="!fields.length" @click="addRule">添加规则</n-button>
        </div>
        <div v-if="rules.length" class="rule-list">
          <div v-for="rule in rules" :key="rule.id" class="rule-row">
            <n-select size="small" :value="rule.fieldName" :options="fieldOptions" @update:value="value => updateRule(rule.id, { fieldName: value })" />
            <n-select size="small" :value="rule.trigger" :options="triggerOptions" @update:value="value => updateRule(rule.id, { trigger: value })" />
            <n-input-number v-if="rule.trigger === 'elapsed_days'" size="small" :value="rule.interval" :min="1" @update:value="value => updateRule(rule.id, { interval: value || 1 })" />
            <n-input v-if="rule.trigger === 'per_chapter'" size="small" :value="rule.schedule" placeholder="+5, +4" @update:value="value => updateRule(rule.id, { schedule: value })" />
            <n-input-number v-else size="small" :value="rule.amount" @update:value="value => updateRule(rule.id, { amount: value || 0 })" />
            <n-select v-if="rule.trigger === 'elapsed_days'" size="small" clearable :value="rule.sourceFieldName" :options="fieldOptions" placeholder="基于字段" @update:value="value => updateRule(rule.id, { sourceFieldName: value || '' })" />
            <span v-else class="formula-placeholder">-</span>
            <n-button quaternary circle size="small" title="删除规则" @click="removeRule(rule.id)">
              <template #icon><n-icon><trash-outline /></n-icon></template>
            </n-button>
          </div>
        </div>
        <n-empty v-else size="small" description="还没有自动规则" />
      </section>
    </template>

    <template v-else>
      <label>字段文本</label>
      <n-input v-model:value="advancedFieldsText" type="textarea" :rows="8" placeholder="字段名=值=单位=类型=公式" @blur="applyAdvancedFields" />
      <label>自动规则文本</label>
      <n-input :value="automationText" type="textarea" :rows="5" placeholder="字段名｜每章 +1" @update:value="value => emit('update:automationText', value)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NIcon, NInput, NInputNumber, NRadioButton, NRadioGroup, NSelect } from 'naive-ui'
import { TrashOutline } from '@vicons/ionicons5'
import { calculateDataPanelFieldValues, createDataPanelId, formatDataPanelFields, parseDataPanelFields } from '@/services/dataPanel'
import type { DataPanelAutomationRule, DataPanelField, DataPanelFieldType } from '@/types/novel'

interface RuleRow {
  id: string
  fieldName: string
  trigger: DataPanelAutomationRule['trigger']
  amount: number
  interval: number
  schedule: string
  sourceFieldName: string
}

const props = defineProps<{ fields: DataPanelField[]; automationText: string }>()
const emit = defineEmits<{
  'update:fields': [fields: DataPanelField[]]
  'update:automationText': [value: string]
}>()

const mode = ref<'structured' | 'advanced'>('structured')
const formulaErrors = computed(() => calculateDataPanelFieldValues(props.fields).filter(field => field.calculationError))
const advancedFieldsText = ref('')
const rules = ref<RuleRow[]>([])
const fieldTypeOptions: Array<{ label: string; value: DataPanelFieldType }> = [
  { label: '文本', value: 'text' }, { label: '数字', value: 'number' }, { label: '百分比', value: 'percent' },
  { label: '天数', value: 'days' }, { label: '倒计时', value: 'countdown' }, { label: '公式', value: 'formula' },
]
const triggerOptions = [
  { label: '每章变化', value: 'per_chapter' },
  { label: '每次出现', value: 'on_mention' },
  { label: '经过天数', value: 'elapsed_days' },
]
const fieldOptions = computed(() => props.fields.map(field => ({ label: field.name || '未命名字段', value: field.name })))

watch(() => props.fields, fields => {
  advancedFieldsText.value = formatDataPanelFields(fields)
}, { immediate: true, deep: true })

watch(() => props.automationText, text => {
  rules.value = parseRules(text)
}, { immediate: true })

function updateField(id: string, updates: Partial<DataPanelField>) {
  const next = props.fields.map(field => field.id === id ? { ...field, ...updates } : field)
  emit('update:fields', next)
}

function addField() {
  emit('update:fields', [...props.fields, {
    id: createDataPanelId(), name: '', value: '', unit: '', note: '', type: 'text', formula: '', autoCalculate: false,
  }])
}

function removeField(id: string) {
  const removed = props.fields.find(field => field.id === id)?.name
  emit('update:fields', props.fields.filter(field => field.id !== id))
  if (removed) {
    rules.value = rules.value.filter(rule => rule.fieldName !== removed)
    emitRules()
  }
}

function applyAdvancedFields() {
  emit('update:fields', parseDataPanelFields(advancedFieldsText.value))
}

function addRule() {
  rules.value.push({
    id: createDataPanelId(), fieldName: props.fields[0]?.name || '', trigger: 'per_chapter', amount: 1,
    interval: 1, schedule: '+1', sourceFieldName: '',
  })
  emitRules()
}

function updateRule(id: string, updates: Partial<RuleRow>) {
  rules.value = rules.value.map(rule => rule.id === id ? { ...rule, ...updates } : rule)
  emitRules()
}

function removeRule(id: string) {
  rules.value = rules.value.filter(rule => rule.id !== id)
  emitRules()
}

function emitRules() {
  emit('update:automationText', rules.value.map(rule => {
    if (rule.trigger === 'per_chapter') return `${rule.fieldName}｜每章 ${rule.schedule || signed(rule.amount)}`
    if (rule.trigger === 'on_mention') return `${rule.fieldName}｜每次出现 ${signed(rule.amount)}`
    const source = rule.sourceFieldName ? `（基于：${rule.sourceFieldName}）` : ''
    return `${rule.fieldName}｜经过 ${Math.max(1, rule.interval)} 天 ${signed(rule.amount)}${source}`
  }).join('\n'))
}

function signed(value: number) { return value >= 0 ? `+${value}` : String(value) }

function parseRules(text: string): RuleRow[] {
  const parsed: RuleRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const [fieldName = '', spec = ''] = line.split(/[|｜]/).map(value => value.trim())
    if (!fieldName || !spec) continue
    const elapsed = spec.match(/经过\s*(\d+(?:\.\d+)?)\s*天(?:后)?\s*([+-]?\s*\d+(?:\.\d+)?)/)
    const source = spec.match(/基于\s*[:：]\s*([^）)]+)/)?.[1]?.trim() || ''
    if (elapsed) {
      parsed.push({ id: createDataPanelId(), fieldName, trigger: 'elapsed_days', amount: Number(elapsed[2].replace(/\s/g, '')), interval: Number(elapsed[1]), schedule: '', sourceFieldName: source })
      continue
    }
    const mention = spec.match(/每次出现\s*([+-]?\s*\d+(?:\.\d+)?)/)
    if (mention) {
      parsed.push({ id: createDataPanelId(), fieldName, trigger: 'on_mention', amount: Number(mention[1].replace(/\s/g, '')), interval: 1, schedule: '', sourceFieldName: '' })
      continue
    }
    const chapter = spec.match(/每章\s*(.+)/)
    if (chapter) {
      const first = chapter[1].match(/[+-]?\s*\d+(?:\.\d+)?/)?.[0] || '0'
      parsed.push({ id: createDataPanelId(), fieldName, trigger: 'per_chapter', amount: Number(first.replace(/\s/g, '')), interval: 1, schedule: chapter[1].trim(), sourceFieldName: '' })
    }
  }
  return parsed
}
</script>

<style scoped>
.field-editor { display: grid; gap: 14px; min-width: 0; }
.formula-error { color: var(--color-error); margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.editor-section { display: grid; gap: 8px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; }
.field-list, .rule-list { display: grid; gap: 8px; }
.field-row { display: grid; grid-template-columns: 1.2fr 1fr 80px 120px 1.2fr 34px; gap: 6px; align-items: center; min-width: 0; }
.rule-row { display: grid; grid-template-columns: 1fr 120px 100px 1fr 34px; gap: 6px; align-items: center; min-width: 0; }
.formula-placeholder { text-align: center; color: var(--text-color-tertiary); }
.field-editor > label { font-size: 13px; font-weight: 600; color: var(--text-color-secondary); }
@media (max-width: 720px) {
  .field-row, .rule-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); padding-bottom: 10px; border-bottom: 1px solid var(--border-color-light); }
  .field-row > :last-child, .rule-row > :last-child { justify-self: end; }
}
</style>
