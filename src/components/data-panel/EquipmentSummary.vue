<template>
  <div class="equipment-summary">
    <p v-if="item.category === '装备' || item.category === '道具'">{{ equipmentSnapshot(item, items) }}</p>
    <p v-for="field in item.fields.filter(field => field.modifier)" :key="field.id">
      {{ field.name }} → {{ field.modifier?.attribute }} · {{ field.modifier?.operation === 'flat' ? '固定加成' : '基础百分比加成' }}
    </p>
    <div v-for="row in totals" :key="row.attribute" class="effective-attribute">
      <div><strong>{{ row.attribute }} · 生效值</strong><strong>{{ row.total ?? '待补基础值' }}</strong></div>
      <small>基础 {{ row.base ?? '未记录' }} · 固定 {{ row.flat }} · 基础加成 {{ row.percent }}%</small>
      <small>{{ row.sources.join('、') }}</small>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DataPanelItem } from '@/types/novel'
import { equipmentSnapshot, getEquipmentAttributeTotals } from '@/services/dataPanelEquipment'
const props = defineProps<{ item: DataPanelItem; items: DataPanelItem[] }>()
const totals = computed(() => getEquipmentAttributeTotals(props.items, props.item.id))
</script>

<style scoped>
.equipment-summary { min-width: 0; font-size: 12px; color: var(--text-color-secondary); overflow-wrap: anywhere; }
.equipment-summary p { margin: 6px 0; }
.effective-attribute { padding: 8px 0; border-top: 1px solid var(--border-color-light); }
.effective-attribute > div { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.effective-attribute small { display: block; margin-top: 3px; }
</style>
