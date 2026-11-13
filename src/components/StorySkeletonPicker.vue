<template>
  <section class="skeleton-picker" aria-label="选择和编辑故事骨架">
    <header class="sk-head">
      <div>
        <h3>比较故事骨架</h3>
        <p>点击单元格逐行挑选字段，勾选关键节点，可以混合不同方案；“整列选用”采用整套方案。混合只生成新的可编辑候选，保存作者版本并确认后才成为正式故事方向。</p>
      </div>
      <div class="toolbar"><n-button :disabled="busy" @click="emit('create')">手写新方案</n-button><n-button :disabled="busy" @click="emit('regenerate')">重新生成候选</n-button></div>
    </header>

    <div v-if="skeletons.length" class="comparison" tabindex="0" aria-label="方案对照表，可横向滚动">
      <table :style="{ '--columns': skeletons.length }">
        <caption class="sr-only">方案字段与关键节点对照</caption>
        <thead>
          <tr>
            <th scope="col" class="corner"><span class="sr-only">内容</span></th>
            <th v-for="item in skeletons" :key="item.id" scope="col" class="colh">
              <button type="button" class="col-title" :disabled="busy" :aria-pressed="selectedId === item.id" @click="emit('select', item.id)">{{ item.title || '未命名方案' }}</button>
              <span class="col-tags">
                <span v-if="selectedId === item.id" class="sk-tag edit">编辑中</span>
                <span v-if="item.id === confirmedId" class="sk-tag ok">正式方向</span>
                <span v-if="item.complete === false" class="sk-tag warn">未完整，需作者补齐保存</span>
              </span>
              <button type="button" class="col-all" :disabled="busy || !item.revisionId" :aria-label="'整列选用：' + (item.title || '未命名方案')" @click="pickColumn(item)">整列选用</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="field in fields" :key="field.key">
            <th scope="row" class="rh">{{ field.label }}</th>
            <td v-for="item in skeletons" :key="item.id" :class="{ pick: isFieldPicked(field.key, item) }">
              <button type="button" class="cell" :disabled="busy || !item.revisionId" :aria-pressed="isFieldPicked(field.key, item)" :aria-label="field.label + ' · ' + (item.title || '未命名方案')" @click="toggleField(field.key, item)">{{ item[field.key] || '未填写' }}</button>
            </td>
          </tr>
          <tr>
            <th scope="row" class="rh">关键节点<small>按勾选顺序混合</small></th>
            <td v-for="item in skeletons" :key="item.id" class="beats-cell">
              <label v-for="beat in item.beats" :key="beat.id" class="compare-beat" :class="{ pick: hasBeat(item, beat.id) }">
                <input type="checkbox" :disabled="busy || !item.revisionId" :checked="hasBeat(item, beat.id)" @change="toggleBeat(item, beat.id)" />
                <strong>{{ beat.title || '未命名节点' }}</strong><span>{{ beat.description }}</span>
              </label>
              <p v-if="!item.beats.length" class="empty-beats">暂无关键节点</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="skeletons.length" class="mix" aria-label="混合方案">
      <div class="mix-main">
        <b class="mix-title">混合方案</b>
        <ul class="mix-seq" aria-label="各字段已选来源">
          <li v-for="field in fields" :key="field.key" :class="{ empty: !sourceName(fieldSources[field.key]) }">{{ field.label }} · {{ sourceName(fieldSources[field.key]) || '未选' }}</li>
        </ul>
        <ol v-if="beatSources.length" class="mixed-beats" aria-label="混合后的关键节点顺序">
          <li v-for="(source, index) in beatSources" :key="source.targetBeatId">
            <span>{{ beatLabel(source) }}</span>
            <button type="button" :disabled="busy || index === 0" :aria-label="'上移：' + beatLabel(source)" @click="moveMixedBeat(index, -1)">上移</button>
            <button type="button" :disabled="busy || index === beatSources.length - 1" :aria-label="'下移：' + beatLabel(source)" @click="moveMixedBeat(index, 1)">下移</button>
          </li>
        </ol>
      </div>
      <div class="mix-side">
        <span v-if="mixCounts" class="mix-counts">{{ mixCounts }}</span>
        <span v-if="mixHint" class="mix-hint" role="status">{{ mixHint }}</span>
        <n-button type="primary" :disabled="busy || !canMix || dirty" @click="mix">组合为新的可编辑候选</n-button>
      </div>
    </div>

    <div v-if="selected" class="skeleton-edit" :key="selected.id">
      <h4>编辑：{{ selected.title || '未命名方案' }}</h4><p v-if="dirty" class="dirty-note" role="status">输入已暂存；请保存作者版本后再切换或确认。</p>
      <label v-for="field in fields" :key="field.key">{{ field.label }}<textarea :value="selected[field.key]" :aria-label="field.label" :disabled="busy" :rows="field.key === 'title' ? 1 : 3" @input="update(field.key, ($event.target as HTMLTextAreaElement).value)"></textarea></label>
      <h4>关键节点</h4>
      <div v-for="(beat, index) in selected.beats" :key="beat.id" class="beat-edit">
        <select :value="beat.kind" :disabled="busy" :aria-label="'节点' + (index + 1) + '类型'" @change="updateBeat(index, 'kind', ($event.target as HTMLSelectElement).value)"><option v-for="kind in kinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option></select>
        <input :aria-label="'节点' + (index + 1) + '名称'" :value="beat.title" :disabled="busy" @input="updateBeat(index, 'title', ($event.target as HTMLInputElement).value)" />
        <textarea :aria-label="'节点' + (index + 1) + '内容'" :value="beat.description" :disabled="busy" rows="2" @input="updateBeat(index, 'description', ($event.target as HTMLTextAreaElement).value)"></textarea>
        <div class="beat-actions"><button type="button" :disabled="busy || index === 0" @click="moveBeat(index, -1)">上移</button><button type="button" :disabled="busy || index === selected.beats.length - 1" @click="moveBeat(index, 1)">下移</button><button type="button" :disabled="busy" @click="removeBeat(index)">移除节点</button></div>
      </div>
      <n-button :disabled="busy" @click="addBeat">添加关键节点</n-button>
    </div>
    <footer><p v-if="!selected">选择一个方案，或手写新方案。</p><template v-else><n-button :disabled="busy" @click="emit('save')">{{ selected.complete === false ? '已核对补齐，保存作者版本' : '保存作者版本' }}</n-button><n-button type="primary" :disabled="busy || dirty || !canConfirm" @click="emit('confirm')">确认此方案为正式方向</n-button></template></footer>
  </section>
</template>
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { NButton } from 'naive-ui'
import type { PlotSkeleton, SkeletonField, SkeletonSourceSelection, StoryBeat } from '@/types/reconstruction'
import { skeletonCompletionIssues } from '@/services/creationDraft'
const props = defineProps<{ skeletons: PlotSkeleton[]; selectedId?: string; confirmedId?: string; busy?: boolean; dirty?: boolean; hasOutline?: boolean }>()
const emit = defineEmits<{ select: [id: string]; edit: [skeleton: PlotSkeleton]; confirm: []; save: []; create: []; regenerate: []; mix: [sources: SkeletonSourceSelection[]] }>()
const selected = computed(() => props.skeletons.find(item => item.id === props.selectedId))
const fields = [{ key: 'title', label: '方案名称' }, { key: 'premise', label: '故事前提' }, { key: 'logline', label: '一句话主线' }, { key: 'promise', label: '读者承诺' }, { key: 'ending', label: '结局方向' }] as const
const kinds: { value: StoryBeat['kind']; label: string }[] = [{ value: 'opening', label: '开端' }, { value: 'inciting', label: '引发事件' }, { value: 'turning_point', label: '转折' }, { value: 'midpoint', label: '中点' }, { value: 'low_point', label: '低谷' }, { value: 'climax', label: '高潮' }, { value: 'resolution', label: '结局' }, { value: 'custom', label: '其他' }]
const fieldSources = reactive<Record<SkeletonField, string>>({ title: '', premise: '', logline: '', promise: '', ending: '' })
const beatSources = ref<SkeletonSourceSelection[]>([])
const missingFields = computed(() => fields.filter(field => !props.skeletons.some(item => item.revisionId === fieldSources[field.key])).length)
const canMix = computed(() => missingFields.value === 0 && beatSources.value.length > 0)
const canConfirm = computed(() => selected.value && !skeletonCompletionIssues(selected.value).length)
const mixHint = computed(() => {
  if (props.dirty) return '请先保存当前作者版本，再组合新的候选。'
  if (canMix.value) return ''
  const need = [missingFields.value ? `为 ${missingFields.value} 个字段选择来源` : '', beatSources.value.length ? '' : '至少勾选一个关键节点'].filter(Boolean)
  return '还需' + need.join('，并') + '。'
})
const mixCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const source of [...fields.map(field => ({ revisionId: fieldSources[field.key] })), ...beatSources.value]) {
    const name = sourceName(source.revisionId)
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts].map(([name, count]) => `${name}×${count}`).join(' · ')
})
function sourceName(revisionId: string) { return revisionId ? props.skeletons.find(item => item.revisionId === revisionId)?.title || '历史方案' : '' }
function isFieldPicked(key: SkeletonField, item: PlotSkeleton) { return !!item.revisionId && fieldSources[key] === item.revisionId }
function toggleField(key: SkeletonField, item: PlotSkeleton) { if (item.revisionId) fieldSources[key] = isFieldPicked(key, item) ? '' : item.revisionId }
// 整列选用：五个字段和该方案全部关键节点都取自这一列，原有的其他来源被替换。
function pickColumn(item: PlotSkeleton) {
  if (!item.revisionId) return
  for (const field of fields) fieldSources[field.key] = item.revisionId
  beatSources.value = item.beats.map(beat => ({ revisionId: item.revisionId!, field: 'beat' as const, beatId: beat.id, targetBeatId: crypto.randomUUID() }))
}
function update(key: SkeletonField, value: string) { if (selected.value) emit('edit', { ...selected.value, [key]: value, approval: 'draft' }) }
function updateBeat(index: number, key: 'title' | 'description' | 'kind', value: string) {
  if (selected.value) emit('edit', { ...selected.value, approval: 'draft', beats: selected.value.beats.map((beat, i) => i === index ? { ...beat, [key]: value } as StoryBeat : beat) })
}
function addBeat() { if (selected.value) emit('edit', { ...selected.value, approval: 'draft', beats: [...selected.value.beats, { id: crypto.randomUUID(), title: '', description: '', kind: 'custom', relatedPlotlineIds: [], relatedCharacterIds: [] }] }) }
function removeBeat(index: number) { if (selected.value) emit('edit', { ...selected.value, approval: 'draft', beats: selected.value.beats.filter((_, i) => i !== index) }) }
function moveBeat(index: number, delta: number) { if (!selected.value) return; const beats = [...selected.value.beats]; const [beat] = beats.splice(index, 1); beats.splice(index + delta, 0, beat); emit('edit', { ...selected.value, approval: 'draft', beats }) }
function hasBeat(item: PlotSkeleton, beatId: string) { return beatSources.value.some(source => source.revisionId === item.revisionId && source.beatId === beatId) }
function toggleBeat(item: PlotSkeleton, beatId: string) {
  if (!item.revisionId) return
  if (hasBeat(item, beatId)) beatSources.value = beatSources.value.filter(source => source.revisionId !== item.revisionId || source.beatId !== beatId)
  else beatSources.value.push({ revisionId: item.revisionId, field: 'beat', beatId, targetBeatId: crypto.randomUUID() })
}
function moveMixedBeat(index: number, delta: number) { const [source] = beatSources.value.splice(index, 1); beatSources.value.splice(index + delta, 0, source) }
function beatLabel(source: SkeletonSourceSelection) { const skeleton = props.skeletons.find(item => item.revisionId === source.revisionId); return (skeleton?.title || '历史方案') + ' / ' + (skeleton?.beats.find(item => item.id === source.beatId)?.title || '历史节点') }
function mix() { emit('mix', [...fields.map(field => ({ field: field.key, revisionId: fieldSources[field.key] })), ...beatSources.value]) }
</script>
<style scoped>
/* 本组件同时出现在新界面和旧界面：优先用新界面的纸色变量，旧界面没有时退回其变量。 */
.skeleton-picker { --sk-line: var(--line, var(--border-color, #ddd)); --sk-line2: var(--line-2, var(--border-color, #ccc)); --sk-paper: var(--paper, var(--bg-color-card, #fff)); --sk-panel: var(--panel, var(--bg-color, #f6f6f6)); --sk-ink: var(--ink, var(--text-color-primary, #222)); --sk-ink3: var(--ink-3, var(--text-color-secondary, #666)); --sk-ink4: var(--ink-4, var(--text-color-tertiary, #999)); --sk-zhu: var(--zhu, var(--color-primary, #b8321f)); --sk-zhu-soft: var(--zhu-soft, var(--color-primary-light, #f6e6e2)); --sk-jin: var(--jin, #a87a1e); --sk-qing: var(--qing, #3f7a64); --sk-serif: var(--f-serif, var(--font-family-serif, serif));
  width: 100%; box-sizing: border-box; color: var(--sk-ink); }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.sk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.sk-head h3 { margin: 0 0 3px; font: 600 18px var(--sk-serif); letter-spacing: .06em; }
.sk-head p { margin: 0; color: var(--sk-ink3); font-size: 12px; line-height: 1.7; }
.toolbar { display: flex; flex-wrap: wrap; flex: none; gap: 8px; }

.comparison { overflow-x: auto; max-width: 100%; border: 1px solid var(--sk-line); border-radius: 10px; background: var(--sk-paper); }
.comparison:focus-visible { outline: 2px solid var(--sk-zhu); outline-offset: 2px; }
table { width: 100%; min-width: calc(120px + var(--columns, 3) * 220px); border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 13px; }
th, td { padding: 0; border-right: 1px solid var(--sk-line); border-bottom: 1px solid var(--sk-line); vertical-align: top; text-align: left; font-weight: normal; }
th:last-child, td:last-child { border-right: 0; }
tbody tr:last-child > * { border-bottom: 0; }
.corner, .rh { width: 120px; background: var(--sk-panel); }
.rh { position: sticky; left: 0; z-index: 1; padding: 12px 14px; color: var(--sk-ink3); font-size: 12px; font-weight: 600; letter-spacing: .08em; }
.rh small { display: block; margin-top: 4px; font-weight: 400; letter-spacing: 0; }
/* 表头单元格保持 table-cell，内部元素各占一行，避免把 th 改成 flex 后破坏列宽对齐。 */
.colh { padding: 12px 14px; background: var(--sk-panel); }
.colh > * { display: block; }
.col-title { display: block; padding: 0; border: 0; background: none; color: var(--sk-ink); font: 600 16px var(--sk-serif); text-align: left; cursor: pointer; }
.col-title[aria-pressed="true"] { color: var(--sk-zhu); }
.col-title:hover:not(:disabled) { text-decoration: underline; }
.colh > .col-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.colh > .col-tags:empty { display: none; }
.colh > .col-all { width: fit-content; }
.sk-tag { padding: 1px 7px; border: 1px solid var(--sk-line2); border-radius: 4px; color: var(--sk-ink3); font-size: 11px; font-weight: 500; }
.sk-tag.edit { border-color: var(--sk-zhu); color: var(--sk-zhu); }
.sk-tag.ok { border-color: var(--sk-qing); color: var(--sk-qing); }
.sk-tag.warn { border-color: var(--sk-jin); color: var(--sk-jin); }
.col-all { padding: 3px 9px; border: 1px solid var(--sk-line2); border-radius: 5px; background: var(--sk-paper); color: var(--sk-ink); font-size: 12px; cursor: pointer; }
.col-all:hover:not(:disabled) { border-color: var(--sk-zhu); color: var(--sk-zhu); }
.cell { position: relative; display: block; width: 100%; min-height: 48px; padding: 12px 34px 12px 14px; border: 0; background: none; color: var(--sk-ink); font: 14px/1.65 var(--sk-serif); text-align: left; white-space: pre-wrap; overflow-wrap: anywhere; cursor: pointer; }
.cell:hover:not(:disabled) { background: var(--sk-panel); }
.cell:focus-visible { outline: 2px solid var(--sk-zhu); outline-offset: -2px; }
td.pick { background: var(--sk-zhu-soft); box-shadow: inset 3px 0 0 var(--sk-zhu); }
td.pick .cell::after { content: '✓'; position: absolute; top: 10px; right: 12px; color: var(--sk-zhu); font-weight: 700; }
button:disabled { cursor: not-allowed; opacity: .5; }
.beats-cell { padding: 10px 12px; }
.compare-beat { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; margin: 0 0 6px; padding: 8px 10px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; }
.compare-beat:hover { background: var(--sk-panel); }
.compare-beat.pick { border-color: var(--sk-zhu); background: var(--sk-zhu-soft); }
.compare-beat input { grid-row: span 2; margin-top: 3px; accent-color: var(--sk-zhu); }
.compare-beat strong { font: 600 13px var(--sk-serif); }
.compare-beat span { color: var(--sk-ink3); font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.empty-beats { margin: 4px 2px; color: var(--sk-ink4); font-size: 12px; }

.mix { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px 20px; margin: 14px 0 0; padding: 14px 18px; border: 1px solid var(--sk-line); border-radius: 10px; background: var(--sk-paper); }
.mix-main { display: flex; flex: 1 1 360px; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; }
.mix-title { font: 600 15px var(--sk-serif); }
.mix-seq { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.mix-seq li { padding: 3px 9px; border-radius: 4px; background: var(--sk-panel); font-size: 12px; }
.mix-seq li.empty { color: var(--sk-ink4); }
.mixed-beats { flex-basis: 100%; display: grid; gap: 4px; margin: 0; padding-left: 20px; color: var(--sk-ink3); font-size: 12px; }
.mixed-beats li { display: list-item; }
.mixed-beats span { margin-right: 8px; }
.mixed-beats button { margin-right: 4px; padding: 1px 7px; border: 1px solid var(--sk-line2); border-radius: 4px; background: var(--sk-paper); color: var(--sk-ink3); font-size: 11px; cursor: pointer; }
.mix-side { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px; margin-left: auto; }
.mix-counts { color: var(--sk-ink3); font-size: 12px; }
.mix-hint { max-width: 320px; color: var(--sk-jin); font-size: 12px; line-height: 1.6; }

.skeleton-edit { display: grid; gap: 10px; margin-top: 18px; padding: 18px 20px; border: 1px solid var(--sk-line); border-radius: 10px; background: var(--sk-paper); }
.skeleton-edit h4 { margin: 4px 0 0; font: 600 15px var(--sk-serif); }
.skeleton-edit label { display: grid; gap: 6px; color: var(--sk-ink3); font-size: 12px; }
.dirty-note { margin: 0; color: var(--sk-jin); font-size: 12px; }
.beat-edit { display: grid; gap: 8px; padding: 12px; border: 1px dashed var(--sk-line2); border-radius: 8px; }
.beat-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.beat-actions button { padding: 3px 9px; border: 1px solid var(--sk-line2); border-radius: 5px; background: var(--sk-paper); color: var(--sk-ink); font-size: 12px; cursor: pointer; }
textarea, .beat-edit input, select { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--sk-line2); border-radius: 6px; background: var(--sk-paper); color: var(--sk-ink); font: inherit; }
textarea { resize: vertical; }
footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 16px 0 0; }
footer p { margin: 0; color: var(--sk-ink3); font-size: 12px; }

@media (max-width: 680px) {
  .sk-head { flex-direction: column; }
  .mix-side { margin-left: 0; justify-content: flex-start; }
}
</style>
