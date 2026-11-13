<template>
  <Teleport defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link>
    <span class="crumb-sep">/</span>
    <span class="crumb-book">{{ novel?.title || '新建作品' }}</span>
    <span class="crumb-sep">/</span>
    <span class="crumb-current">创作流程</span>
  </Teleport>

  <div class="creation-flow">
    <header class="flow-head">
      <div>
        <div class="flow-kicker">CREATE · {{ novel?.genreLabel || '新作品' }}</div>
        <h1>作品创作流程</h1>
        <p v-if="novel">《{{ novel.title }}》的设定、骨架与大纲会在这里逐步确认。</p>
      </div>
    </header>

    <ol class="flow-steps" aria-label="作品创建进度">
      <li v-for="(step, index) in steps" :key="step" :class="{ done: index < activeStep, active: index === activeStep }"
        :data-step="index" :aria-current="index === activeStep ? 'step' : undefined">
        <span class="flow-step-number">{{ index < activeStep ? '✓' : index + 1 }}</span>
        <span class="flow-step-label">{{ step }}</span>
      </li>
    </ol>

    <div v-if="novel" class="flow-content">
      <CreationPlanning v-if="planningAccepted" />
      <GenerateOutline v-else @step="activeSurfaceStep = $event" />
    </div>
    <section v-else class="flow-missing m-panel" role="alert">
      <p>找不到这部作品，可能已移入回收站。</p>
      <router-link class="m-btn zhu" to="/">返回书架</router-link>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import GenerateOutline from '@/views/GenerateOutline.vue'
import CreationPlanning from './CreationPlanning.vue'

defineOptions({ name: 'V3CreateFlowView' })

const steps = ['起点', '作品契约', '故事骨架', '分卷大纲', '开始写作']
const route = useRoute()
const novels = useNovelStore()
const workspace = useReconstructionWorkspaceStore()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const novel = computed(() => novels.getNovel(novelId.value))
const creationDraft = computed(() => workspace.getCreationDraft(novelId.value))
const activeSurfaceStep = ref<number>()
const planningAccepted = computed(() => route.query?.edit !== 'direction' && Boolean(creationDraft.value?.acceptedOutline
  && creationDraft.value.approval.contract === 'approved' && creationDraft.value.approval.skeleton === 'approved'))
const activeStep = computed(() => {
  if (!planningAccepted.value && activeSurfaceStep.value !== undefined) return activeSurfaceStep.value
  if (planningAccepted.value && novel.value?.chapterPlanConfirmed && creationDraft.value?.approval['chapter-outline'] === 'approved') return 4
  switch (creationDraft.value?.stage) {
    case 'contract': return 1
    case 'skeleton': return 2
    case 'volume-outline':
    case 'chapter-outline':
    case 'scene-outline': return 3
    case 'ready': return 4
    default: return 0
  }
})
onMounted(() => { if (novelId.value) void workspace.hydrateFromPersistence(novelId.value).catch(() => undefined) })
</script>

<style scoped>
.creation-flow { position: absolute; inset: 0; overflow: auto; padding: 28px 40px 60px; background: var(--desk); color: var(--ink); }
.flow-head { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.flow-kicker { color: var(--zhu); font-size: 11px; }
.flow-head h1 { margin: 4px 0; font: 600 25px/1.4 var(--f-serif); }
.flow-head p { margin: 0; color: var(--ink-3); font-size: 13px; }
.flow-steps { max-width: 1160px; margin: 4px auto 26px; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); list-style: none; }
.flow-steps li { position: relative; isolation: isolate; display: flex; align-items: center; gap: 9px; min-width: 0; color: var(--ink-4); font-size: 12px; }
.flow-steps li::after { content: ''; position: absolute; z-index: 0; top: 12px; left: 34px; right: 10px; height: 1px; background: var(--line); pointer-events: none; }
.flow-steps li:last-child::after { display: none; }
.flow-steps li.done, .flow-steps li.active { color: var(--ink-2); }
.flow-steps li.active { color: var(--zhu); font-weight: 600; }
.flow-step-number { position: relative; z-index: 2; width: 24px; height: 24px; border: 1px solid var(--line-2); border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--paper); font: 11px var(--f-num); }
.flow-step-label { position: relative; z-index: 2; padding: 0 8px; background-color: var(--desk); box-shadow: 0 0 0 2px var(--desk); white-space: nowrap; }
.flow-steps li.done .flow-step-number { border-color: var(--qing); background: var(--qing-soft); color: var(--qing); }
.flow-steps li.active .flow-step-number { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.flow-content { max-width: 1160px; margin: 0 auto; }
.flow-content :deep(.generate-page) { width: 100%; height: auto; min-height: 0; padding: 20px 0 48px; overflow: visible; align-items: stretch; gap: 18px; color: var(--ink); }
.flow-content :deep(.generate-animation) { display: none; }
.flow-content :deep(.generate-header) { max-width: 100%; text-align: left; }
.flow-content :deep(.generate-header h2) { margin: 0; color: var(--ink); font: 600 20px/1.5 var(--f-serif); }
.flow-content :deep(.generate-header p) { color: var(--ink-3); }
.flow-content :deep(.structured-plan-status) { width: fit-content; max-width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--ink-3); }
.flow-content :deep(.generate-page.outline-ready) { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(280px, .8fr); align-items: start; gap: 16px; max-width: none; padding: 20px 0 48px; margin: 0; overflow: visible; }
.flow-content :deep(.outline-ready .generate-header) { grid-column: 1 / -1; }
.flow-content :deep(.generate-page.choosing-skeleton) { display: flex; flex-direction: column; align-items: stretch; }
.flow-content :deep(.outline-ready .generate-header h2) { font-size: 23px; }
.flow-content :deep(.outline-ready .output-container) { min-height: 460px; border-color: var(--line); border-radius: 8px; background: var(--paper); }
.flow-content :deep(.outline-ready .generate-actions) { position: sticky; top: 16px; align-self: start; padding: 20px; border-color: var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }
.flow-content :deep(.paper-panel) { border-color: var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }
.flow-missing { max-width: 620px; margin: 56px auto; padding: 24px; text-align: center; }
.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-link:hover { color: var(--zhu); }.crumb-sep { color: var(--ink-4); }.crumb-book { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }.crumb-current { color: var(--ink); font-weight: 600; }
@media (max-width: 900px) {
  .creation-flow { padding: 20px 20px 40px; }
  .flow-content :deep(.generate-page.outline-ready) { grid-template-columns: minmax(0, 1fr); }
  .flow-content :deep(.outline-ready .generate-actions) { position: static; }
}
@media (max-width: 580px) {
  .creation-flow { padding: 16px 14px 32px; }
  .flow-head { align-items: flex-start; }
  .flow-head h1 { font-size: 21px; }
  .flow-steps { grid-template-columns: repeat(5, minmax(64px, 1fr)); overflow-x: auto; gap: 8px; }
  .flow-steps li { flex-direction: column; align-items: flex-start; gap: 5px; font-size: 10px; }
  .flow-steps li::after { top: 12px; left: 31px; right: 4px; }
  .flow-step-number { width: 22px; height: 22px; }
}
</style>
