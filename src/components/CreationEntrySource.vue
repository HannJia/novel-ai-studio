<template>
  <section class="creation-entry-source paper-panel" aria-label="创建输入来源">
    <h3>创建起点：{{ creationSetupLabels[input.method] }}</h3>
    <p>以下是创建时保存的作者输入，供核对来源；契约、骨架及规划须逐步确认。</p>
    <p v-if="input.idea" class="source-text">{{ input.idea }}</p>
    <p v-if="input.includeDiscussion">创建时选择的灵感讨论已保存在本书灵感存档。</p>
    <template v-if="input.outline">
      <p>来源：{{ input.outline.source === 'file' ? input.outline.fileName : '作者粘贴或手写' }} · 保存于 {{ input.outline.savedAt }}</p>
      <details><summary>查看创建时保存的大纲候选</summary><textarea :value="input.outline.text" readonly rows="12" aria-label="创建时大纲候选"></textarea></details>
      <details v-if="input.outline.source === 'file'"><summary>查看文件原始提取文字</summary><textarea :value="input.outline.originalText" readonly rows="12" aria-label="大纲文件原文"></textarea></details>
      <p>继续修改请使用下方“编辑大纲”；创建时的原文和候选会保留。</p>
    </template>
    <p v-else-if="input.method === 'blank'">从空白契约开始；无需配置模型即可手工保存和编辑。</p>
  </section>
</template>
<script setup lang="ts">
import { creationSetupLabels, type CreationEntryInput } from '@/types/creationEntry'
defineProps<{ input: CreationEntryInput }>()
</script>
<style scoped>
.creation-entry-source { width:100%; max-width:1000px; padding:24px; box-sizing:border-box; } p { line-height:1.7; } .source-text { white-space:pre-wrap; overflow-wrap:anywhere; }
textarea { box-sizing:border-box; width:100%; margin:12px 0; padding:10px; resize:vertical; font:inherit; color:var(--ink); background:var(--desk); border:1px solid var(--line-2); }
summary { cursor:pointer; }
</style>
