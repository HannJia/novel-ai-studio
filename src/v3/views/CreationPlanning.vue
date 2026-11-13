<template>
  <section v-if="novel" class="creation-planning">
    <template v-if="!ready || editing">
      <VolumeOutline compact :chapter-plan-confirmed="ready" />
      <div class="planning-note"><V3Icon name="info" size="s" /><span>卷与章节均为创作计划。先核对当前卷与章纲，场景可在写到该章前设计。</span></div>
      <div class="chapter-planning-head"><div><h2>当前章节计划</h2><p>{{ plans.length }} 条已保存计划 · 预计章节数不会自动变成正文</p></div><button type="button" class="m-btn" @click="showPlanner = !showPlanner">{{ showPlanner ? '收起编辑' : '编辑章节计划' }}</button></div>
      <ol v-if="plans.length" class="plan-preview"><li v-for="plan in plans" :key="plan.id"><span>第 {{ plan.targetChapterStart + 1 }}{{ plan.targetChapterEnd !== plan.targetChapterStart ? '–' + (plan.targetChapterEnd + 1) : '' }} 章</span><strong>{{ plan.title }}</strong><p>{{ plan.objective }}</p></li></ol>
      <p v-else class="empty">尚未建立章纲，可在下方手动添加；AI 生成由你主动发起。</p>
      <div v-if="showPlanner" class="planning-editor"><StoryPlanner :initial-tab="plannerTab" :initial-selection="plannerSelection" @navigate="target => { plannerTab = target.tab; plannerSelection = target.selection }" /></div>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <div class="planning-actions"><button type="button" class="m-btn zhu" :disabled="busy || ready || !novel.volumes.length || !plans.length" @click="confirmPlanning">{{ busy ? '保存中…' : ready ? '规划已确认' : '确认分卷与章节计划' }}</button><button v-if="ready" type="button" class="m-btn" @click="editing = false">返回开始写作</button></div>
    </template>
    <section v-else class="ready-card">
      <div class="ready-seal">墨</div><h1>结构已就绪</h1>
      <p>《{{ novel.title }}》</p><p>{{ novel.volumes.length }} 卷 · {{ plans.length }} 条章节计划 · {{ novel.chapters.length }} 章正文 · {{ novel.characters.length }} 位人物</p>
      <p class="ready-note">故事方向与规划已保存。开始写作只建立空白章，不会生成正文或决定故事变化。</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <div class="ready-actions"><button type="button" class="m-btn pri lg" :disabled="busy" @click="startWriting"><V3Icon name="pen" size="s" />{{ busy ? '保存中…' : novel.chapters.length ? '打开写作台' : '开始写第一章' }}</button><router-link class="m-btn lg" :to="'/plan/' + novel.id">查看结构</router-link></div>
      <button type="button" class="edit-again" @click="editing = true">返回检查分卷与章纲</button>
      <router-link class="edit-again direction-link" :to="{ path: '/generate/' + novel.id, query: { edit: 'direction' } }">检查契约与骨架</router-link>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNovelStore } from '@/stores/novel'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import VolumeOutline from '@/v3/planning/VolumePlanner.vue'
import StoryPlanner from '@/v3/planning/PlanningWorkbench.vue'
import V3Icon from '../components/V3Icon.vue'
import type { Chapter } from '@/types/novel'
const route = useRoute(), router = useRouter(), novels = useNovelStore(), workspace = useReconstructionWorkspaceStore()
const novel = computed(() => novels.getNovel(String(route.params.novelId)))
const plans = computed(() => [...(novel.value?.chapterPlans || [])].filter(plan => plan.status !== 'archived').sort((a, b) => a.targetChapterStart - b.targetChapterStart))
const ready = computed(() => Boolean(novel.value?.chapterPlanConfirmed && plans.value.length
  && workspace.getCreationDraft(novel.value.id)?.approval['chapter-outline'] === 'approved'))
const busy = ref(false), error = ref(''), editing = ref(false), showPlanner = ref(false)
const plannerTab = ref('plans'), plannerSelection = ref('')
async function confirmPlanning() {
  const n = novel.value
  if (!n || busy.value) return
  if (!n.volumes.length || !plans.value.length) { error.value = '请先保存分卷与至少一条章节计划。'; showPlanner.value = true; return }
  busy.value = true; error.value = ''
  try {
    await novels.commitChapterPlanEdit(n.id, { action: 'confirm-planning', expectedVolumes: JSON.stringify(n.volumes), expectedPlans: JSON.stringify(n.chapterPlans), confirmCreation: true })
    editing.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
async function startWriting() {
  const n = novel.value, draft = n && workspace.getCreationDraft(n.id)
  if (!n || busy.value || !ready.value || draft?.approval.contract !== 'approved' || draft?.approval.skeleton !== 'approved') return
  busy.value = true; error.value = ''
  try {
    let first: Chapter | undefined = [...n.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)[0]
    if (!first) {
      const plan = plans.value.find(row => row.targetChapterStart === 0)
      const approvedPlan = draft.chapterPlans.find(row => row.id === 'chapter-plan:' + plan?.id)
      const volume = n.volumes.find(row => 'volume:' + row.id === approvedPlan?.volumeId)
        || [...n.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex)[0]
      // Reuse an existing empty chapter on retry if the durable save failed.
      first = novels.addChapter(n.id, { title: plan?.title || '第一章', volumeIndex: volume?.volumeIndex ?? 0 }) || undefined
    }
    if (!first) throw new Error('章节未能创建，请重试。')
    await novels.saveNovelNow(n.id)
    await router.push('/write/' + n.id + '/' + first.id)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
</script>

<style scoped>
.creation-planning { min-width: 0; }.planning-note { display:flex; align-items:flex-start; gap:10px; padding:14px 16px; margin:16px 0 24px; border:1px solid var(--line); border-radius:8px; color:var(--ink-3); font-size:12px; }
.chapter-planning-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }.chapter-planning-head h2 { margin:0; font:600 18px var(--f-serif); }.chapter-planning-head p,.empty { font-size:12px; color:var(--ink-3); }
.plan-preview { list-style:none; padding:0; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }.plan-preview li { padding:14px 16px; border:1px solid var(--line); background:var(--paper); border-radius:10px; }.plan-preview span { font:11px var(--f-num); color:var(--ink-3); }.plan-preview strong { display:block; font:600 16px var(--f-serif); margin:5px 0; }.plan-preview p { margin:0; font-size:13px; color:var(--ink-2); overflow-wrap:anywhere; }
.planning-editor { padding:16px; background:var(--paper); border:1px solid var(--line); border-radius:10px; margin-top:16px; }.planning-actions { display:flex; gap:12px; margin-top:24px; }.error { color:var(--zhu); font-size:13px; }
.ready-card { max-width:620px; margin:20px auto; padding:40px; text-align:center; border:1px solid var(--line); border-radius:10px; background:var(--paper); }.ready-seal { margin:0 auto 18px; display:grid; place-items:center; width:56px; height:56px; border:2px solid var(--zhu); border-radius:4px; color:var(--zhu); font:32px/1 var(--f-serif); }.ready-card h1 { margin:0 0 8px; font:600 26px var(--f-serif); }.ready-card p { margin:0 0 12px; font-size:13px; color:var(--ink-3); }.ready-card .ready-note { font-size:12px; line-height:1.8; margin-bottom:20px; }.ready-actions { display:flex; justify-content:center; flex-wrap:wrap; gap:8px; }.edit-again { margin-top:20px; font-size:12px; color:var(--ink-3); text-decoration:underline; }
.direction-link { display:inline-block; margin-left:16px; }
@media(max-width:1000px){ .plan-preview { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:600px){ .plan-preview { grid-template-columns:1fr; }.ready-card { padding:28px 18px; }.chapter-planning-head { align-items:flex-start; flex-wrap:wrap; }.planning-actions { flex-wrap:wrap; } }
</style>
