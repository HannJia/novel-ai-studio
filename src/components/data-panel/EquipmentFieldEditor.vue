<template>
  <section class="modifier-editor">
    <strong>属性加成</strong>
    <div v-for="field in fields" :key="field.id" class="modifier-row">
      <span>{{ field.name }}</span>
      <n-input :value="field.modifier?.attribute || ''" placeholder="角色基础字段名" size="small"
        @update:value="value => setModifier(field, value, field.modifier?.operation || 'flat')" />
      <n-select :value="field.modifier?.operation || 'none'" size="small" :options="operations"
        @update:value="value => setModifier(field, field.modifier?.attribute || field.name, value)" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { NInput, NSelect } from 'naive-ui'
import type { DataPanelField } from '@/types/novel'
const props = defineProps<{ fields: DataPanelField[] }>()
const emit = defineEmits<{ 'update:fields': [fields: DataPanelField[]] }>()
const operations = [
  { label: '不计入属性', value: 'none' }, { label: '固定数值', value: 'flat' }, { label: '基础值百分比', value: 'percent' },
]
function setModifier(field: DataPanelField, attribute: string, operation: string) {
  const modifier: DataPanelField['modifier'] = attribute.trim() && (operation === 'flat' || operation === 'percent')
    ? { attribute: attribute.trim(), operation } : undefined
  emit('update:fields', props.fields.map(candidate => candidate.id === field.id ? { ...candidate, modifier } : candidate))
}
</script>

<style scoped>
.modifier-editor { display: grid; gap: 8px; min-width: 0; }
.modifier-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 150px; gap: 8px; align-items: center; }
.modifier-row span { overflow-wrap: anywhere; }
@media (max-width: 560px) { .modifier-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .modifier-row > span { grid-column: 1 / -1; } }
</style>
