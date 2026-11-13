<template>
  <section class="scene-recovery" aria-label="场景方案比较与恢复">
    <h3>场景多方案</h3>
    <p>选择只会打开编辑候选。确认并使用后，才替换正式场景。</p>
    <div class="option-grid">
      <article v-for="revision in heads" :key="revision.id">
        <h4>{{ revision.title || '未命名方案' }}</h4>
        <p>{{ revision.scenes.length }} 个场景 · {{ revision.complete ? '可核对确认' : '待手工补齐' }}</p>
        <p v-if="revision.baseline !== baseline">来源规划已变化，恢复后需重新核对基线。</p>
        <label><input v-model="comparison" type="checkbox" :value="revision.id" :disabled="comparison.length >= 3 && !comparison.includes(revision.id)" />加入比较（最多三项）</label>
        <button :disabled="busy" @click="emit('select', revision.id)">{{ selectedRevisionId === revision.id ? '重新打开此版本' : '选择并编辑' }}</button>
      </article>
    </div>
    <div v-if="compared.length" class="comparison" aria-label="场景方案对照">
      <article v-for="revision in compared" :key="revision.id">
        <h4>{{ revision.title }}</h4><p>{{ revision.instructions }}</p>
        <ol><li v-for="scene in revision.scenes" :key="scene.id"><strong>{{ scene.title }}</strong><p>{{ scene.purpose }}</p><p>冲突：{{ scene.conflict || '待补充' }}</p><p>结束：{{ scene.outputState }}</p></li></ol>
      </article>
    </div>
    <p v-if="!heads.length">手工保存或逐次生成后，可在这里比较方案。</p>
    <h3>未提交输入恢复</h3>
    <details v-for="editor in [...editors].reverse()" :key="editor.id">
      <summary>{{ editor.updatedAt }} · {{ editor.title || editor.chapter.title }} · {{ editor.scenes.length }} 个场景</summary>
      <p>章目标：{{ editor.chapter.objective }}</p><p>生成要求：{{ editor.instructions || '无' }}</p>
      <p v-if="editor.baseline !== baseline">保存时的规划与当前不同。恢复会保留原基线，不覆盖新规划。</p>
      <button :disabled="busy" @click="emit('restoreEditor', editor.id)">恢复这些输入</button>
      <button :disabled="busy" @click="emit('discardEditor', editor.id)">删除此恢复快照</button>
    </details>
    <h3>生成与中断记录</h3>
    <details v-for="attempt in [...attempts].reverse()" :key="attempt.id">
      <summary>{{ attempt.createdAt }} · {{ statuses[attempt.status] }} · {{ attempt.modelId }}</summary>
      <p v-if="attempt.parentAttemptId">来源请求：{{ attempt.parentAttemptId }}</p>
      <p v-if="attempt.error" role="status">{{ attempt.error }}</p>
      <pre>{{ attempt.output || '尚未收到输出' }}</pre>
      <details><summary>查看保存的请求与输入</summary><p>方案名称：{{ attempt.input.title }}</p><p>作者要求：{{ attempt.input.instructions }}</p><pre v-for="(message, index) in attempt.messages" :key="index">{{ message.role }}：{{ message.content }}</pre></details>
      <div class="actions">
        <button :disabled="busy" @click="emit('retry', attempt.id)">按当前规划重试为新请求</button>
        <button :disabled="busy || !attempt.output" @click="emit('continue', attempt.id)">参考部分输出继续为新请求</button>
        <button :disabled="busy || !attempt.output" @click="emit('recover', attempt.id)">恢复输出为待补齐输入</button>
      </div>
    </details>
    <h3>方案版本历史</h3>
    <details v-for="revision in [...revisions].reverse()" :key="revision.id">
      <summary>{{ revision.createdAt }} · {{ kinds[revision.kind] }} · {{ revision.title || '未命名方案' }}</summary>
      <p v-if="!revision.complete">此版本未完整；恢复后仍须手工补齐并保存。</p>
      <ol><li v-for="scene in revision.scenes" :key="scene.id"><strong>{{ scene.title }}</strong><p>{{ scene.purpose }} → {{ scene.outputState }}</p></li></ol>
      <p>版本 {{ revision.id }}<span v-if="revision.parentRevisionId"> · 原版本 {{ revision.parentRevisionId }}</span></p>
      <button :disabled="busy" @click="emit('restoreVersion', revision.id)">恢复为新方案</button>
    </details>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SceneEditorDraft, SceneGenerationAttempt, SceneOptionRevision, ScenePlanOption } from '@/types/planningRecovery'
const props = defineProps<{ options: ScenePlanOption[]; revisions: SceneOptionRevision[]; attempts: SceneGenerationAttempt[];
  editors: SceneEditorDraft[]; selectedRevisionId?: string; baseline: string; busy: boolean; scope: string }>()
const emit = defineEmits<{ select: [id: string]; restoreEditor: [id: string]; discardEditor: [id: string];
  retry: [id: string]; continue: [id: string]; recover: [id: string]; restoreVersion: [id: string] }>()
const comparison = ref<string[]>([])
watch(() => props.scope, () => { comparison.value = [] })
const heads = computed(() => props.options.flatMap(option => props.revisions.filter(revision => revision.id === option.revisionId)))
const compared = computed(() => props.revisions.filter(revision => comparison.value.includes(revision.id)))
const statuses = { queued: '请求已保存，尚未发出', running: '上次请求未结束，可明确恢复', completed: '完整返回', partial: '输出截断或不完整',
  failed: '失败', cancelled: '作者取消', interrupted: '离页或保存流程中断', conflict: '规划冲突，输出已保留' }
const kinds = { author: '作者保存', model: '模型候选', restored: '历史恢复' }
</script>
<style scoped>
.scene-recovery { display:grid; gap:12px; } .option-grid,.comparison { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
article,details { padding:14px; border:1px solid var(--line-2); border-radius:8px; min-width:0; background:var(--paper); } h4 { margin-top:0; font:600 15px var(--f-serif); }
input[type="checkbox"] { accent-color:var(--zhu); }
pre,p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; } pre { max-height:350px; overflow:auto; } summary,button { cursor:pointer; }
button { font:inherit; padding:8px; color:var(--ink); background:var(--desk); border:1px solid var(--line-2); border-radius:6px; margin:4px; }
.actions { display:flex; flex-wrap:wrap; } button:disabled { opacity:.5; cursor:default; }
</style>
