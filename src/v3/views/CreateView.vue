<template>
  <Teleport defer to="#v3-crumb"><router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">新建作品</span><span class="m-tag jin">创建中</span></Teleport>
  <div class="create-bridge">
    <div class="create-in">
      <ol class="create-steps" aria-label="作品创建进度">
        <li v-for="(step, index) in steps" :key="step" :class="{ current: index === 0 }" :aria-current="index === 0 ? 'step' : undefined"><i>{{ index + 1 }}</i><span>{{ step }}</span></li>
      </ol>
      <header class="create-heading"><h1>怎样开始这部作品？</h1><p>四种起点进入同一套结构化流程：契约 → 骨架 → 分卷 → 章节 → 场景。正文由谁来写，另外选择。</p></header>
      <CreateWizard appearance="v3" />
      <section class="creation-principles" aria-label="创作流程说明">
        <div><b>聊天负责探索</b><span>对话用来提问、发散，不自动批准设定</span></div>
        <div><b>卡片负责确认</b><span>契约与规划可编辑，明确确认后生效</span></div>
        <div><b>结构负责记忆</b><span>卷、章、场景、人物与伏笔都有来源</span></div>
        <div><b>作者决定入典</b><span>故事变化逐条确认，整章通过门槛后定稿</span></div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import CreateWizard from '@/views/CreateWizard.vue'
defineOptions({ name: 'V3CreateView' })
const steps = ['起点', '作品契约', '故事骨架', '分卷大纲', '开始写作']
</script>

<style scoped>
.create-bridge {
  position: absolute; inset: 0; overflow: auto; background: var(--desk); color: var(--ink);
  --bg: var(--desk); --bg-color: var(--desk); --bg-color-card: var(--paper); --bg-color-secondary: var(--panel); --bg-color-hover: var(--hover);
  --text-color-primary: var(--ink); --text-color-secondary: var(--ink-2); --text-color-tertiary: var(--ink-3);
  --border-color: var(--line); --border-color-light: var(--line-2); --color-primary: var(--zhu); --color-primary-light: var(--zhu-soft); --color-accent: var(--qing);
  --font-family: var(--f-ui); --font-family-serif: var(--f-serif);
}
.create-in { max-width: 1240px; padding: 32px 40px 60px; margin: 0 auto; }
.create-steps { display: flex; align-items: center; list-style: none; margin: 0 0 26px; padding: 0; gap: 14px; }
.create-steps li { display: flex; align-items: center; gap: 10px; color: var(--ink-4); font-size: 13px; white-space: nowrap; }
.create-steps li:not(:last-child)::after { content: ''; width: clamp(24px, 6vw, 90px); height: 1px; background: var(--line-2); margin-left: 4px; }
.create-steps i { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border: 1px solid var(--line-2); border-radius: 50%; font: 600 12px var(--f-num); }
.create-steps .current { color: var(--zhu); font-weight: 600; }.create-steps .current i { background: var(--zhu); border-color: var(--zhu); color: white; box-shadow: 0 0 0 5px var(--zhu-soft); }
.create-heading h1 { font: 600 26px/1.4 var(--f-serif); margin: 0 0 6px; }.create-heading p { margin: 0 0 22px; color: var(--ink-3); font-size: 13px; }
.create-bridge :deep(.wizard-layout) { height: auto; min-height: 0; overflow: visible; background: transparent; }
.create-bridge :deep(.wizard-top) { max-width: none; padding: 0; }.create-bridge :deep(.choosing-options .wizard-top) { display: none; }
.create-bridge :deep(.wizard-header) { gap: 12px; margin-bottom: 18px; }.create-bridge :deep(.wizard-header .page-title) { display: none; }.create-bridge :deep(.back-btn) { color: var(--ink-3); }
.create-bridge :deep(.steps-indicator) { justify-content: flex-start; gap: 24px; padding: 0 0 16px; }.create-bridge :deep(.step-item) { color: var(--ink-3); }
.create-bridge :deep(.step-dot) { background: var(--paper); border-color: var(--line-2); }.create-bridge :deep(.step-active .step-dot), .create-bridge :deep(.step-completed .step-dot) { border-color: var(--zhu); background: var(--zhu); color: white; }
.create-bridge :deep(.creation-mode-picker) { display: flex; flex-direction: column; max-width: none; overflow: visible; padding: 0; }
.create-bridge :deep(.picker-intro) { display: none; }.create-bridge :deep(.choice-group) { margin: 0; }
.create-bridge :deep(.origin-choice) { order: 1; }.create-bridge :deep(.origin-choice legend) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.create-bridge :deep(.origin-choice .choice-grid) { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.create-bridge :deep(.origin-choice .mode-option) { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 24px; position: relative; }
.create-bridge :deep(.mode-option) { border-color: var(--line); border-radius: var(--r-m); background: var(--paper); transition: border-color .2s, box-shadow .2s; }
.create-bridge :deep(.mode-option:hover) { border-color: var(--ink-3); box-shadow: var(--shadow-1); }
.create-bridge :deep(.mode-option.selected) { border-color: var(--zhu); box-shadow: 0 0 0 3px var(--zhu-soft); }
.create-bridge :deep(.origin-choice .mode-option > input) { position: absolute; top: 14px; right: 14px; accent-color: var(--zhu); }
.create-bridge :deep(.origin-choice .n-icon) { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; background: var(--panel-2); color: var(--ink-2); }
.create-bridge :deep(.origin-choice .n-icon svg) { width: 22px; height: 22px; }
.create-bridge :deep(.origin-choice strong) { color: var(--ink); font: 600 17px/1.5 var(--f-serif); }.create-bridge :deep(.mode-option small) { color: var(--ink-3); font-size: 12px; line-height: 1.7; }
.create-bridge :deep(.origin-choice .mode-option:last-child) { grid-column: 1 / -1; grid-template-columns: 30px minmax(0, 1fr); padding: 12px 18px; align-items: center; gap: 12px; }
.create-bridge :deep(.origin-choice .mode-option:last-child .n-icon) { width: 30px; height: 30px; }.create-bridge :deep(.origin-choice .mode-option:last-child > span) { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
.create-bridge :deep(.origin-choice .mode-option:last-child strong) { font-size: 14px; }.create-bridge :deep(.origin-choice .mode-option:last-child small) { margin: 0; }
.create-bridge :deep(.origin-seed) { order: 2; padding: 18px 20px; margin-top: 22px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.create-bridge :deep(.origin-seed label) { display: block; font-size: 12px; color: var(--ink-3); margin-bottom: 8px; }
.create-bridge :deep(.origin-seed textarea) { width: 100%; resize: vertical; min-height: 68px; border: 0; outline: 0; background: transparent; color: var(--ink); font: 18px/1.8 var(--f-serif); }
.create-bridge :deep(.origin-seed p) { margin: 10px 0 0; font-size: 11px; color: var(--ink-3); line-height: 1.6; }
.create-bridge :deep(.choice-number) { display: none; }.create-bridge :deep(.writing-choice) { order: 3; margin-top: 22px; }.create-bridge :deep(.writing-choice legend) { margin-bottom: 8px; font: 600 12px var(--f-ui); color: var(--ink-3); }
.create-bridge :deep(.writing-choice .choice-grid) { gap: 10px; }.create-bridge :deep(.writing-choice .mode-option) { grid-template-columns: auto minmax(0, 1fr); gap: 10px; padding: 10px 14px; }
.create-bridge :deep(.writing-choice .n-icon) { display: none; }.create-bridge :deep(.writing-choice strong) { font-size: 12px; }.create-bridge :deep(.writing-choice small) { margin-top: 3px; font-size: 11px; }
.create-bridge :deep(.choice-actions) { order: 4; position: static; padding: 16px 0 0; margin-top: 16px; border-color: var(--line); background: transparent; }.create-bridge :deep(.choice-summary) { color: var(--ink-3); font-size: 12px; }
.create-bridge :deep(#start-creation-btn) { height: 34px; padding: 0 14px; border: 1px solid var(--ink); border-radius: 6px; background: var(--ink); color: var(--paper); font: 13px var(--f-ui); }
.create-bridge :deep(#start-creation-btn .n-button__border), .create-bridge :deep(#start-creation-btn .n-button__state-border) { border: 0; }
.create-bridge :deep(.wizard-body) { max-width: none; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 16px; padding: 0 0 28px; overflow: visible; }
.create-bridge :deep(.form-section), .create-bridge :deep(.wizard-current-settings), .create-bridge :deep(.reference-import-panel), .create-bridge :deep(.knowledge-mount-section) { border-color: var(--line); border-radius: 8px; background: var(--paper); box-shadow: var(--shadow-1); }
.create-bridge :deep(.form-section) { padding: 20px; }.create-bridge :deep(.creation-entry-body) { padding: 0 0 28px; overflow: visible; }
.create-bridge :deep(.creation-entry-panel) { max-width: none; border-color: var(--line); border-radius: var(--r-m); background: var(--paper); box-shadow: var(--shadow-1); }
.create-bridge :deep(.wizard-footer) { border-color: var(--line); background: var(--panel); }
.creation-principles { display: none; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 26px; border: 1px solid var(--line); border-radius: var(--r-m); overflow: hidden; }
.create-in:has(.choosing-options) .creation-principles { display: grid; }.creation-principles > div { padding: 14px 16px; background: var(--panel); color: var(--ink-3); font-size: 12px; border-right: 1px solid var(--line); }.creation-principles > div:last-child { border: 0; }
.creation-principles b { display: block; color: var(--ink); font: 600 15px/1.5 var(--f-serif); margin-bottom: 2px; }
.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-link:hover { color: var(--zhu); }.crumb-sep { margin: 0 7px; color: var(--ink-4); }
@media (max-width: 1100px) { .create-in { padding: 26px 24px 44px; }.create-bridge :deep(.origin-choice .choice-grid) { grid-template-columns: minmax(0, 1fr); gap: 12px; }.create-bridge :deep(.origin-choice .mode-option) { grid-template-columns: 44px minmax(0, 1fr); padding: 18px 22px; gap: 16px; }.create-bridge :deep(.origin-choice .mode-option:last-child) { grid-template-columns: 30px minmax(0, 1fr); }.create-bridge :deep(.wizard-body) { grid-template-columns: minmax(0, 1fr); }.create-steps { justify-content: space-between; gap: 8px; }.create-steps li:not(:last-child)::after { width: 24px; margin-left: 0; }.create-steps li { gap: 7px; font-size: 12px; } }
@media (max-width: 700px) { .create-in { padding: 22px 16px 36px; }.create-steps { align-items: flex-start; gap: 4px; }.create-steps li { flex: 1; flex-direction: column; gap: 7px; position: relative; font-size: 10px; }.create-steps li:not(:last-child)::after { position: absolute; left: calc(50% + 20px); width: calc(100% - 40px); top: 13px; }.create-heading h1 { font-size: 23px; }.creation-principles { grid-template-columns: repeat(2, minmax(0, 1fr)); }.creation-principles > div { border-bottom: 1px solid var(--line); }.creation-principles > div:nth-child(2) { border-right: 0; }.creation-principles > div:nth-child(3) { border-bottom: 0; }.create-bridge :deep(.writing-choice .choice-grid) { grid-template-columns: minmax(0, 1fr); } }
</style>
