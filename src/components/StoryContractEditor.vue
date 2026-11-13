<template>
  <section class="story-contract" aria-label="作品契约">
    <header class="contract-heading"><div><h3>作品契约 · {{ form.title || '未命名作品' }}</h3><p>逐项编辑、确认后继续故事骨架。尚未决定的内容可以明确填写“暂不确定”。</p></div><span class="confirmation-count" role="status">已确认 {{ confirmedCount }} / 8</span></header>
    <ContractExplorationPanel :contract="form" :exploration="exploration" :disabled="busy" :flush="flush"
      @change="value => emit('change', clone(form), value)" @busy="setExploring" @adopt="adopt" />
    <form @submit.prevent="confirm">
      <div class="contract-grid">
        <fieldset v-for="card in contractCards" :key="card.id" :disabled="busy || exploring" :class="{ confirmed: contractCardConfirmed(form, card.id) }">
          <div class="card-heading"><h4>{{ card.title }}</h4><button type="button" :aria-label="`${contractCardConfirmed(form, card.id) ? '撤销确认' : '确认'}${card.title}`" :aria-pressed="contractCardConfirmed(form, card.id)" @click="toggle(card.id)">{{ contractCardConfirmed(form, card.id) ? '✓ 已确认' : '确认' }}</button></div>
          <button v-if="editingCard !== card.id" type="button" class="card-summary" :aria-label="'编辑' + card.title" @click="editingCard = card.id">{{ cardSummary(card.id) }}</button>
          <div v-else class="card-fields">
          <label v-for="key in card.fields" :key="key">{{ labels[key] }}
            <select v-if="key === 'format'" aria-label="作品形式" :value="form.format" @change="setField(key, ($event.target as HTMLSelectElement).value)"><option value="serial">连载</option><option value="complete">完结作品</option><option value="undecided">暂不确定</option></select>
            <input v-else-if="key === 'targetWordCountMin' || key === 'targetWordCountMax'" :aria-label="labels[key]" type="number" min="1" :value="form[key]" @input="setField(key, ($event.target as HTMLInputElement).value)" />
            <textarea v-else :aria-label="labels[key]" :value="Array.isArray(form[key]) ? (form[key] as string[]).join('\n') : form[key]" :rows="card.id === 'rules' ? 2 : 1" :placeholder="card.id === 'rules' ? '每行一条，也可填写暂无' : '填写方向或暂不确定'" @input="setField(key, ($event.target as HTMLTextAreaElement).value)"></textarea>
          </label>
          <button type="button" class="collapse-card" @click="editingCard = ''">收起编辑</button>
          </div>
        </fieldset>
      </div>
      <p v-if="adoptionError" role="alert" class="contract-issues">{{ adoptionError }}</p>
      <ul v-if="issues.length" class="contract-issues" role="status"><li v-for="issue in issues" :key="issue">{{ issue }}</li></ul>
      <footer class="contract-footer">
        <p>契约约束后续生成与审校。修改后会提示受影响的骨架与章纲。</p>
        <div class="contract-actions">
          <button v-if="cancelable" type="button" class="cancel" :disabled="busy || exploring" @click="emit('cancel')">取消契约修改</button>
          <button type="button" :disabled="busy || exploring" @click="emit('save', clone(form))">保存草稿</button>
          <button type="submit" :disabled="busy || exploring || issues.length > 0 || confirmedCount < 8" class="primary">确认契约并继续</button>
        </div>
      </footer>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createEmptyCreationDraft, validateCreationStage, type ContractExploration, type ContractSuggestion, type StoryContract } from '@/types/reconstruction'
import { adoptContractSuggestion, contractCards, contractCardConfirmed, materializeContractConfirmations, toggleContractCard } from '@/services/storyContract'
import ContractExplorationPanel from './ContractExplorationPanel.vue'

const props = defineProps<{ contract: StoryContract; exploration?: ContractExploration; busy?: boolean; cancelable?: boolean; flush?: () => Promise<void> }>()
const emit = defineEmits<{ save: [contract: StoryContract]; confirm: [contract: StoryContract]; cancel: []; change: [contract: StoryContract, exploration?: ContractExploration]; exploring: [busy: boolean] }>()
const clone = (value: StoryContract): StoryContract => JSON.parse(JSON.stringify(value))
const form = ref(materializeContractConfirmations(clone(props.contract)))
const exploring = ref(false)
const adoptionError = ref('')
const editingCard = ref('')
watch(() => props.contract, value => {
  const next = materializeContractConfirmations(clone(value))
  if (JSON.stringify(form.value) !== JSON.stringify(next)) form.value = next
})
const labels = {
  title: '作品名称', genre: '作品类型', subGenre: '子类型', audience: '目标读者', format: '作品形式', targetWordCountMin: '最少字数', targetWordCountMax: '最多字数', pacingDirection: '篇章节奏',
  pointOfView: '叙事视角', tense: '叙述时态', styleDirection: '文风方向', coreTheme: '核心主题', readerPromise: '读者承诺',
  protagonistPremise: '主角初始状态', protagonistGoal: '主角核心欲望', protagonistFear: '主角核心恐惧', centralConflict: '主线冲突', endingDirection: '结局方向',
  romanceDirection: '感情线方向', worldRules: '世界规则', forbiddenTopics: '禁用内容', authorPreferences: '作者偏好',
}
function changed() { adoptionError.value = ''; emit('change', clone(form.value)) }
function setField(key: keyof typeof labels, text: string) {
  let value: string | string[] | number | undefined = text
  if (key === 'targetWordCountMin' || key === 'targetWordCountMax') value = text === '' ? undefined : Number(text)
  if (['worldRules', 'forbiddenTopics', 'authorPreferences'].includes(key)) value = text.split('\n')
  if (JSON.stringify(form.value[key]) === JSON.stringify(value)) return
  Object.assign(form.value, { [key]: value })
  const card = contractCards.find(card => card.fields.includes(key))!
  form.value.cardConfirmations = form.value.cardConfirmations?.filter(item => item.cardId !== card.id)
  changed()
}
function cardSummary(cardId: string): string {
  return contractCards.find(card => card.id === cardId)!.fields.map(key => {
    const value = form.value[key]
    if (key === 'format') return { serial: '连载', complete: '完结作品', undecided: '形式暂不确定' }[form.value.format]
    if (key === 'targetWordCountMin' || key === 'targetWordCountMax') return value ? `${labels[key]} ${value} 字` : ''
    return Array.isArray(value) ? value.filter(Boolean).join('、') : value
  }).filter(Boolean).join(' · ') || '点击填写，或明确标记暂不确定。'
}
function toggle(cardId: string) {
  form.value = toggleContractCard(form.value, cardId, new Date().toISOString())
  editingCard.value = ''; changed()
}
function adopt(suggestion: ContractSuggestion) {
  try { form.value = adoptContractSuggestion(form.value, suggestion); changed() }
  catch (error) { adoptionError.value = error instanceof Error ? error.message : '建议采用失败' }
}
function setExploring(value: boolean) { exploring.value = value; emit('exploring', value) }
function confirm() {
  if (!props.busy && !exploring.value && !issues.value.length && confirmedCount.value === 8) emit('confirm', clone(form.value))
}
const confirmedCount = computed(() => contractCards.filter(card => contractCardConfirmed(form.value, card.id)).length)
const issues = computed(() => validateCreationStage({ ...createEmptyCreationDraft({ id: 'validation', now: '' }), contract: form.value }))
</script>
<style scoped>
.story-contract { --c-line: var(--line, var(--border-color-light, #ddd)); --c-paper: var(--paper, var(--bg-color-card, #fff)); --c-ink: var(--ink, var(--text-color-primary, #222)); --c-ink3: var(--ink-3, var(--text-color-secondary, #666)); --c-zhu: var(--zhu, var(--color-primary, #b8321f)); --c-jin: var(--jin, var(--color-warning, #a87a1e)); --c-serif: var(--f-serif, var(--font-family-serif, serif));
  display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px 20px; align-items: stretch; width: 100%; color: var(--c-ink); }
form { display: contents; }
.contract-heading { grid-column: 1 / -1; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.story-contract > :deep(.explore) { grid-column: 1; grid-row: 2; align-self: stretch; height: auto; min-height: 0; contain: size; }
h3 { margin: 0 0 4px; font: 600 18px var(--c-serif); }
header p, footer p { margin: 0; color: var(--c-ink3); font-size: 12px; line-height: 1.7; }
.confirmation-count { flex-shrink: 0; border: 1px solid var(--c-line); border-radius: 20px; padding: 4px 9px; color: var(--c-jin); font-size: 11px; }
.contract-grid { grid-column: 2; grid-row: 2; align-self: stretch; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
fieldset { min-width: 0; margin: 0; padding: 14px 16px; border: 1px solid var(--c-line); border-radius: 10px; background: var(--c-paper); }
fieldset.confirmed { border-color: color-mix(in srgb, var(--qing, #527465) 45%, var(--c-line)); }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
h4 { margin: 0; color: var(--c-ink3); font-size: 12px; font-weight: 600; letter-spacing: .1em; }
.card-heading button { height: 26px; padding: 0 8px; font-size: 11px; }
.card-summary { display: block; width: 100%; min-height: 54px; height: auto; padding: 0; border: 0; border-radius: 4px; background: transparent; text-align: left; overflow-wrap: anywhere; font: 15px/1.7 var(--c-serif); }
.card-summary:hover { background: var(--panel-2, #f4f2ee); }
.collapse-card { height: 24px; margin-top: 8px; padding: 0; border: 0; font-size: 11px; color: var(--c-ink3); }
.confirmed .card-heading button { color: var(--qing, #527465); }
label { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; color: var(--c-ink3); font-size: 10px; }
textarea, input, select { box-sizing: border-box; width: 100%; padding: 3px 0; border: 0; border-bottom: 1px solid transparent; border-radius: 0; background: transparent; color: var(--c-ink); font: 14px/1.7 var(--c-serif); }
textarea { min-height: 30px; resize: vertical; }
textarea:focus, input:focus, select:focus { outline: none; border-bottom-color: var(--c-zhu); }
textarea::placeholder { color: var(--ink-4, #999); font-size: 12px; }
select, input { min-height: 28px; font-family: inherit; font-size: 13px; }
.contract-issues { grid-column: 2; margin: 0; padding: 10px 14px 10px 30px; border-radius: 8px; background: color-mix(in srgb, var(--c-jin) 10%, var(--c-paper)); color: var(--c-jin); font-size: 12px; line-height: 1.8; }
.contract-footer { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; box-sizing: border-box; padding: 14px; border: 1px solid var(--c-line); border-radius: 10px; background: var(--panel, var(--c-paper)); }
.contract-actions { display: flex; flex-shrink: 0; gap: 8px; }
button { height: 32px; padding: 0 12px; border: 1px solid var(--c-line); border-radius: 6px; background: var(--c-paper); color: var(--c-ink); font-family: inherit; font-size: 12px; cursor: pointer; }
button.primary { border-color: var(--c-zhu); background: var(--c-zhu); color: #fff; }
button.cancel { background: transparent; color: var(--c-ink3); }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--c-zhu); outline-offset: 2px; }
@media (max-width: 1100px) { .story-contract { grid-template-columns: minmax(0, 1fr); } .story-contract > :deep(.explore) { height: 360px; contain: none; } .contract-grid { grid-column: 1; grid-row: 3; } .contract-issues, .contract-footer { grid-column: 1; } }
@media (max-width: 680px) { .contract-grid { grid-template-columns: minmax(0, 1fr); } header, .contract-footer { flex-wrap: wrap; } .contract-actions { width: 100%; flex-wrap: wrap; } .contract-footer button { flex: 1 1 auto; } }
</style>
