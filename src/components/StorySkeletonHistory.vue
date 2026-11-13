<template>
  <section class="skeleton-history paper-panel" aria-label="骨架版本与生成恢复">
    <h3>版本与生成记录</h3><p>恢复会建立新的候选。原版本和原始输出保留；再次确认前不会改变正式方向。</p>
    <details v-for="attempt in [...attempts].reverse()" :key="attempt.id">
      <summary>{{ attempt.createdAt }} · {{ statusLabel(attempt.status) }} · {{ attempt.modelId }}</summary>
      <p v-if="attempt.parentAttemptId">来源请求：{{ attempt.parentAttemptId }}</p><p v-if="attempt.error" role="status">{{ attempt.error }}</p>
      <pre>{{ attempt.output || '尚未收到输出' }}</pre>
      <details><summary>查看请求输入</summary><pre v-for="(item, index) in attempt.messages" :key="index">{{ item.role }}：{{ item.content }}</pre></details>
      <div class="actions"><button :disabled="busy" @click="emit('retry', attempt.id)">按当前设定重试为新请求</button><button :disabled="busy || !attempt.output" @click="emit('continue', attempt.id)">依据部分输出续作完整候选</button><button :disabled="busy || !attempt.output" @click="emit('recover', attempt.id)">恢复输出为待补齐草稿</button></div>
    </details>
    <details v-for="version in [...history].reverse()" :key="version.id">
      <summary>{{ version.createdAt }} · {{ kindLabel(version.kind) }} · {{ version.snapshot.title || '未命名方案' }}</summary>
      <dl><template v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ version.snapshot[field.key] }}</dd></template></dl>
      <ol><li v-for="beat in version.snapshot.beats" :key="beat.id"><strong>{{ beat.title }}</strong><p>{{ beat.description }}</p></li></ol>
      <p>版本：{{ version.id }}<span v-if="version.parentRevisionId"> · 原版本：{{ version.parentRevisionId }}</span><span v-if="version.attemptId"> · 请求：{{ version.attemptId }}</span></p>
      <ul v-if="version.sources.length"><li v-for="(source, index) in version.sources" :key="index">{{ source.field }} ← {{ source.revisionId }}<span v-if="source.beatId"> / {{ source.beatId }}</span></li></ul>
      <p v-if="version.snapshot.complete === false">此版本未完整，恢复后仍须核对补齐并保存。</p>
      <button :disabled="busy" @click="emit('restore', version.id)">恢复为新的可编辑候选</button>
    </details>
    <p v-if="!history.length && !attempts.length">保存候选或发起生成后将在这里保留记录。</p>
  </section>
</template>
<script setup lang="ts">
import type { SkeletonGenerationAttempt, SkeletonRevision } from '@/types/reconstruction'
defineProps<{ history: SkeletonRevision[]; attempts: SkeletonGenerationAttempt[]; busy?: boolean }>()
const emit = defineEmits<{ restore: [id: string]; retry: [id: string]; continue: [id: string]; recover: [id: string] }>()
const fields = [{ key: 'premise', label: '故事前提' }, { key: 'logline', label: '一句话主线' }, { key: 'promise', label: '读者承诺' }, { key: 'ending', label: '结局方向' }] as const
const statusLabel = (status: SkeletonGenerationAttempt['status']) => ({ queued: '待发出', running: '未结束（离页或重开后可恢复）', completed: '已完整返回', partial: '未完整返回', failed: '失败', cancelled: '已取消', interrupted: '已中断', conflict: '基线冲突，输出已保留' }[status])
const kindLabel = (kind: SkeletonRevision['kind']) => ({ legacy: '原有候选', model: '模型候选', author: '作者保存', mixed: '手工混合', restored: '历史恢复', confirmed: '作者确认', import: '大纲提取' }[kind])
</script>
<style scoped>
.skeleton-history { width:100%; max-width:1100px; padding:24px; box-sizing:border-box; } details { border-top:1px solid var(--border-color); padding:12px 0; } summary { cursor:pointer; } pre, dd, li p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; } pre { max-height:360px; overflow:auto; } .actions { display:flex; flex-wrap:wrap; gap:12px; } button { cursor:pointer; padding:8px; } p { color:var(--text-color-secondary); }
</style>
