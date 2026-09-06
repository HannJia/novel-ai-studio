<template>
  <section class="creation-mode-picker" aria-label="创建方式搭配">
    <p class="picker-intro">先选正文由谁写，再选如何准备设定。两组可以自由搭配，都能继续生成大纲与章节计划。</p>
    <fieldset class="choice-group">
      <legend>1. 正文创作方式</legend>
      <div class="choice-grid">
        <label v-for="option in writingOptions" :key="option.value" class="mode-option"
          :class="{ selected: writingMode === option.value }">
          <input type="radio" name="creation-writing-mode" :value="option.value"
            :checked="writingMode === option.value" :disabled="disabled"
            @change="emit('update:writingMode', option.value)" />
          <n-icon :size="22"><component :is="option.icon" /></n-icon>
          <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
        </label>
      </div>
    </fieldset>
    <fieldset class="choice-group">
      <legend>2. 设定准备方式</legend>
      <div class="choice-grid">
        <label v-for="option in setupOptions" :key="option.value" class="mode-option"
          :class="{ selected: setupMethod === option.value }">
          <input type="radio" name="creation-setup-method" :value="option.value"
            :checked="setupMethod === option.value" :disabled="disabled"
            @change="emit('update:setupMethod', option.value)" />
          <n-icon :size="22"><component :is="option.icon" /></n-icon>
          <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
        </label>
      </div>
    </fieldset>
    <div class="choice-actions">
      <p class="choice-summary" aria-live="polite">
        {{ writingMode === 'ai' ? 'AI 模式' : '写作辅助' }}
        ＋ {{ setupMethod === 'inspiration' ? '灵感模式' : setupMethod === 'custom' ? '自选设定' : '请选择设定准备方式' }}
      </p>
      <n-button type="primary" size="large" :disabled="disabled || !writingMode || !setupMethod"
        id="start-creation-btn" @click="emit('start')">
        {{ setupMethod === 'inspiration' ? '开始灵感对话 →' : setupMethod === 'custom' ? '填写小说设定 →' : '选择后继续' }}
      </n-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui'
import { SparklesOutline, CreateOutline, BulbOutline, OptionsOutline } from '@vicons/ionicons5'

defineProps<{
  writingMode?: 'ai' | 'manual'
  setupMethod: 'inspiration' | 'custom' | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:writingMode': [mode: 'ai' | 'manual']
  'update:setupMethod': [method: 'inspiration' | 'custom']
  start: []
}>()
const writingOptions = [
  { value: 'ai' as const, label: 'AI 模式', icon: SparklesOutline, description: '允许 AI 生成正文，你可以编辑、调整和审查。' },
  { value: 'manual' as const, label: '写作辅助', icon: CreateOutline, description: '正文由你亲自写，AI 提供思路、规划和审查。' },
]
const setupOptions = [
  { value: 'inspiration' as const, label: '灵感模式', icon: BulbOutline, description: '先与 AI 聊想法，整理并检查设定后再生成大纲。' },
  { value: 'custom' as const, label: '自选设定', icon: OptionsOutline, description: '直接填写或导入小说设定，再由 AI 生成大纲。' },
]
</script>

<style scoped>
.creation-mode-picker { flex: 1; min-height: 0; overflow-y: auto; width: 100%; max-width: 840px; box-sizing: border-box; margin: 0 auto; padding: 0 24px 24px; }
.picker-intro { margin: 0 0 24px; color: var(--text-color-secondary); font-size: 14px; line-height: 1.7; }
.choice-group { min-width: 0; margin: 0 0 24px; padding: 0; border: 0; }
.choice-group legend { margin-bottom: 12px; font-size: 16px; font-weight: 600; color: var(--text-color-primary); }
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.mode-option { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: start; gap: 10px; padding: 18px 16px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-color-card); cursor: pointer; }
.mode-option input { margin: 4px 0 0; accent-color: var(--color-primary); }
.mode-option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.mode-option:focus-within { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.mode-option strong { display: block; color: var(--text-color-primary); font-size: 15px; line-height: 1.5; }
.mode-option small { display: block; margin-top: 6px; color: var(--text-color-secondary); font-size: 12px; line-height: 1.7; }
.choice-actions { position: sticky; bottom: -24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0; background: var(--bg-color); border-top: 1px solid var(--border-color-light); }
.choice-summary { margin: 0; color: var(--text-color-secondary); font-size: 13px; line-height: 1.6; }
@media (max-width: 600px) {
  .creation-mode-picker { padding: 0 16px 16px; }
  .choice-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .mode-option { padding: 14px; }
  .choice-actions { bottom: -16px; }
  .choice-actions :deep(.n-button) { width: 100%; }
}
</style>
