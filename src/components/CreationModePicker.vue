<template>
  <section class="creation-mode-picker" aria-label="创建方式搭配">
    <p class="picker-intro">从一句话、已有大纲或空白开始，也可以先自选设定。都进入作品契约 → 骨架候选 → 规划确认，默认由作者主笔。</p>
    <fieldset class="choice-group writing-choice">
      <legend><span class="choice-number">1. </span>正文创作方式</legend>
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
    <fieldset class="choice-group origin-choice">
      <legend>2. 作品创建起点</legend>
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
    <slot name="input" />
    <div class="choice-actions">
      <p class="choice-summary" aria-live="polite">
        {{ writingMode === 'ai' ? 'AI 模式' : '作者主笔 · 写作辅助' }}
        ＋ {{ setupMethod ? creationSetupLabels[setupMethod] : '请选择创建起点' }}
      </p>
      <n-button type="primary" size="large" :disabled="disabled || !writingMode || !setupMethod"
        id="start-creation-btn" @click="emit('start')">
        {{ setupMethod === 'inspiration' ? '填写一句话灵感 →' : setupMethod === 'outline' ? '读取或粘贴大纲 →' : setupMethod === 'blank' ? '准备空白作品 →' : setupMethod === 'custom' ? '填写小说设定 →' : '选择后继续' }}
      </n-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui'
import { SparklesOutline, CreateOutline, BulbOutline, OptionsOutline } from '@vicons/ionicons5'
import { creationSetupLabels, type CreationSetupMethod } from '@/types/creationEntry'

defineProps<{
  writingMode?: 'ai' | 'manual'
  setupMethod: CreationSetupMethod | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:writingMode': [mode: 'ai' | 'manual']
  'update:setupMethod': [method: CreationSetupMethod]
  start: []
}>()
const writingOptions = [
  { value: 'manual' as const, label: '作者主笔 · 写作辅助', icon: CreateOutline, description: '默认由你写正文，按需使用 AI 提供思路、规划和审查。' },
  { value: 'ai' as const, label: 'AI 模式', icon: SparklesOutline, description: '允许 AI 生成候选正文，由你编辑、调整和确认。' },
]
const setupOptions = [
  { value: 'inspiration' as const, label: '一句话灵感', icon: BulbOutline, description: '写下一个想法即可开始契约，也可继续已有灵感讨论。' },
  { value: 'outline' as const, label: '已有大纲文件 / 粘贴', icon: OptionsOutline, description: '本地读取 TXT、Markdown、DOCX，预览编辑并保存为候选。' },
  { value: 'blank' as const, label: '空白模板', icon: CreateOutline, description: '无需模型或预设题材，从空白作品契约手工设计。' },
  { value: 'custom' as const, label: '自选设定', icon: OptionsOutline, description: '保留详细类型、人物、世界和风格设置，再确认作品契约。' },
]
</script>

<style scoped>
.creation-mode-picker { flex: 1; min-height: 0; overflow-y: auto; width: 100%; max-width: 1120px; box-sizing: border-box; margin: 0 auto; padding: 0 32px 32px; }
.picker-intro { margin: 0 0 32px; color: var(--text-color-secondary); font-size: 15px; line-height: 1.75; }
.choice-group { min-width: 0; margin: 0 0 32px; padding: 0; border: 0; }
.choice-group legend { margin-bottom: 16px; font-size: 18px; font-weight: 600; font-family: var(--font-family-serif); color: var(--text-color-primary); }
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.mode-option { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: start; gap: 12px; padding: 20px 18px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-color-card); cursor: pointer; transition: all 0.2s ease; }
.mode-option:hover { border-color: var(--color-accent); box-shadow: 0 2px 8px rgba(43, 42, 40, 0.08); }
.mode-option input { margin: 4px 0 0; accent-color: var(--color-primary); }
.mode-option.selected { border-color: var(--color-primary); background: var(--bg-color-card); box-shadow: 0 0 0 3px var(--color-primary-light); }
.mode-option:focus-within { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.mode-option strong { display: block; color: var(--text-color-primary); font-size: 16px; font-weight: 600; line-height: 1.5; }
.mode-option small { display: block; margin-top: 6px; color: var(--text-color-secondary); font-size: 13px; line-height: 1.7; }
.choice-actions { position: sticky; bottom: -32px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; background: var(--bg-color); border-top: 1px solid var(--border-color); }
.choice-summary { margin: 0; color: var(--text-color-secondary); font-size: 14px; line-height: 1.6; }
@media (max-width: 768px) {
  .creation-mode-picker { padding: 0 20px 20px; }
  .choice-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .mode-option { padding: 16px; }
  .choice-actions { bottom: -20px; padding: 16px 0; }
}
@media (max-width: 390px) {
  .creation-mode-picker { padding: 0 16px 16px; }
  .choice-actions :deep(.n-button) { width: 100%; }
}
</style>
