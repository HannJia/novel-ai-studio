<template>
  <details v-if="drafts.length" class="editor-recovery paper-panel">
    <summary>可恢复的未提交输入（{{ drafts.length }}）</summary>
    <p>选择载入后只填入编辑区。正式资料与作者批准状态保持原状。</p>
    <article v-for="draft in drafts" :key="draft.id">
      <strong>{{ label(draft) }}</strong> · 第 {{ draft.revision }} 版 · {{ draft.updatedAt }}
      <p v-if="conflict?.(draft)" role="status">{{ conflict(draft) }}</p>
      <details><summary>查看输入</summary><pre>{{ preview(draft) }}</pre></details>
      <button type="button" :disabled="busy" @click="$emit('restore', draft)">载入编辑区</button>
      <button type="button" :disabled="busy" @click="confirmId = draft.id">丢弃此版本</button>
      <span v-if="confirmId === draft.id">确定丢弃这份未提交输入？
        <button type="button" :disabled="busy" @click="$emit('discard', draft); confirmId = ''">确认丢弃</button>
        <button type="button" @click="confirmId = ''">保留</button>
      </span>
    </article>
  </details>
</template>
<script setup lang="ts">
defineOptions({ name: 'EditorRecoveryPicker' })
import { ref } from 'vue'
import type { EditorDraft } from '@/types/editorRecovery'
defineProps<{ drafts: EditorDraft[]; busy?: boolean; conflict?: (draft: EditorDraft) => string }>()
defineEmits<{ restore: [draft: EditorDraft]; discard: [draft: EditorDraft] }>()
const confirmId = ref('')
function label(draft: EditorDraft): string {
  const names: Record<string, string> = { 'character-form': '人物表单', 'character-scan': '角色扫描', 'relationship-scan': '关系扫描', 'chapter-form': '章节正文', 'event-form': '事件表单', 'event-causality': '事件因果决定', 'story-planner': '故事规划', 'scene-form': '场景表单', 'outline-form': '大纲表单' }
  return (names[draft.kind] || draft.scope) + (typeof draft.payload?.name === 'string' && draft.payload.name ? '：' + draft.payload.name : '')
}
function preview(draft: EditorDraft): string { return JSON.stringify(draft.payload, null, 2) }
</script>
<style scoped>
.editor-recovery { margin: 12px 0; padding: 12px; }
summary, button { cursor: pointer; }
article { border-top: 1px solid var(--line-2); padding: 12px 0; overflow-wrap: anywhere; }
button { margin: 8px 8px 0 0; }
pre { max-height: 240px; overflow: auto; white-space: pre-wrap; }
</style>
