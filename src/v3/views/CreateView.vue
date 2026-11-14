<template>
  <Teleport defer to="#v3-crumb"><router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">新建作品</span><span class="m-tag jin">创建中</span></Teleport>
  <div class="create-page">
    <div class="create-in">
      <ol class="create-steps" aria-label="作品创建进度">
        <li v-for="(step, index) in steps" :key="step" :class="{ current: index === 0 }" :aria-current="index === 0 ? 'step' : undefined"><i>{{ index + 1 }}</i><span>{{ step }}</span></li>
      </ol>
      <header class="create-heading"><h1>怎样开始这部作品？</h1><p>四种起点进入同一套结构化流程：契约 → 骨架 → 分卷 → 章节 → 场景。正文由谁来写，另外选择。</p></header>
      <CreateWizard />
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
import CreateWizard from '@/v3/create/CreationWizard.vue'
defineOptions({ name: 'V3CreateView' })
const steps = ['起点', '作品契约', '故事骨架', '分卷大纲', '开始写作']
</script>

<style scoped>

.create-page {
  position: absolute; inset: 0; overflow: auto; background: var(--desk); color: var(--ink);
}
.create-in { max-width: 1240px; padding: 32px 40px 60px; margin: 0 auto; }
.create-page:has(.discussing-inspiration) { overflow: hidden; }
.create-page:has(.discussing-inspiration) .create-in {
  display: flex; flex-direction: column; height: 100%; padding-bottom: 24px;
}
.create-page:has(.discussing-inspiration) .create-steps,
.create-page:has(.discussing-inspiration) .create-heading { flex-shrink: 0; }
.create-steps { display: flex; align-items: center; list-style: none; margin: 0 0 26px; padding: 0; gap: 14px; }
.create-steps li { display: flex; align-items: center; gap: 10px; color: var(--ink-4); font-size: 13px; white-space: nowrap; }
.create-steps li:not(:last-child)::after { content: ''; width: clamp(24px, 6vw, 90px); height: 1px; background: var(--line-2); margin-left: 4px; }
.create-steps i { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border: 1px solid var(--line-2); border-radius: 50%; font: 600 12px var(--f-num); }
.create-steps .current { color: var(--zhu); font-weight: 600; }.create-steps .current i { background: var(--zhu); border-color: var(--zhu); color: white; box-shadow: 0 0 0 5px var(--zhu-soft); }
.create-heading h1 { font: 600 26px/1.4 var(--f-serif); margin: 0 0 6px; }.create-heading p { margin: 0 0 22px; color: var(--ink-3); font-size: 13px; }
.creation-principles { display: none; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 26px; border: 1px solid var(--line); border-radius: var(--r-m); overflow: hidden; }
.create-in:has(.choosing-options) .creation-principles { display: grid; }.creation-principles > div { padding: 14px 16px; background: var(--panel); color: var(--ink-3); font-size: 12px; border-right: 1px solid var(--line); }.creation-principles > div:last-child { border: 0; }
.creation-principles b { display: block; color: var(--ink); font: 600 15px/1.5 var(--f-serif); margin-bottom: 2px; }
.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-link:hover { color: var(--zhu); }.crumb-sep { margin: 0 7px; color: var(--ink-4); }
@media (max-width: 1100px) { .create-in { padding: 26px 24px 44px; }.create-steps { justify-content: space-between; gap: 8px; }.create-steps li:not(:last-child)::after { width: 24px; margin-left: 0; }.create-steps li { gap: 7px; font-size: 12px; } }
@media (max-width: 700px) { .create-in { padding: 22px 16px 36px; }.create-steps { align-items: flex-start; gap: 4px; }.create-steps li { flex: 1; flex-direction: column; gap: 7px; position: relative; font-size: 10px; }.create-steps li:not(:last-child)::after { position: absolute; left: calc(50% + 20px); width: calc(100% - 40px); top: 13px; }.create-heading h1 { font-size: 23px; }.creation-principles { grid-template-columns: repeat(2, minmax(0, 1fr)); }.creation-principles > div { border-bottom: 1px solid var(--line); }.creation-principles > div:nth-child(2) { border-right: 0; }.creation-principles > div:nth-child(3) { border-bottom: 0; } }
@media (max-width: 850px) {
  .create-page:has(.discussing-inspiration) .create-heading { display: none; }
  .create-page:has(.discussing-inspiration) .create-steps { margin-bottom: 18px; }
}
@media (max-height: 800px) {
  .create-page:has(.discussing-inspiration) .create-in { padding-top: 20px; padding-bottom: 16px; }
  .create-page:has(.discussing-inspiration) .create-steps { margin-bottom: 18px; }
  .create-page:has(.discussing-inspiration) .create-heading { display: none; }
}

</style>
