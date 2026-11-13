<template>
  <section class="outline-import" aria-label="已有大纲文件或粘贴">
    <h3>已有大纲</h3>
    <p>选择本地 UTF-8 TXT、Markdown（.md / .markdown）或 DOCX，文件最多 10 MB，文字最多 50 万字符。DOCX 只提取文字，图片、样式和批注不作为大纲。读取在本机完成。</p>
    <label>选择大纲文件<input type="file" accept=".txt,.md,.markdown,.docx" :disabled="disabled" @change="chooseFile" /></label>
    <p v-if="reading" role="status">正在读取文件；你仍可编辑，迟到结果不会替换新输入。</p>
    <p v-if="modelValue?.source === 'file'">来源：{{ modelValue.fileName }} · {{ modelValue.format?.toUpperCase() }} · {{ modelValue.fileBytes }} 字节</p>
    <p v-else>来源：作者粘贴或手写</p>
    <label>大纲文字预览与编辑<textarea :value="modelValue?.text || ''" rows="14" :disabled="disabled" aria-label="导入大纲文字"
      placeholder="在这里粘贴大纲，也可先选择文件，再修改读出的文字。" @input="editText(($event.target as HTMLTextAreaElement).value)"></textarea></label>
    <p>{{ modelValue?.text.length || 0 }} / 500000 字符。保存的是候选，作品契约、骨架和正式规划仍需分别确认。</p>
    <details v-if="modelValue?.source === 'file'"><summary>文件原始提取文字（保留来源）</summary><pre>{{ modelValue.originalText.slice(0, 12000) }}</pre><p v-if="modelValue.originalText.length > 12000">此处只预览前 12000 字符，完整原文随候选保存。</p></details>
    <div class="actions"><button :disabled="disabled || reading || !modelValue?.text.trim()" @click="save">保存这份大纲候选</button>
      <button v-if="modelValue?.source === 'file'" :disabled="disabled" @click="usePastedSource">将当前文字另存为粘贴来源</button></div>
    <p v-if="saved" role="status">候选已确认留存，点击下方创建后与作品一起落盘。</p>
    <p v-else role="status">请先保存当前候选，再创建作品；读取文件本身不会创建或批准规划。</p>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { CreationOutlineInput } from '@/types/creationEntry'
import { assertCreationOutlineInput } from '@/services/creationEntryInput'
import { readCreationOutlineFile } from '@/services/creationOutlineFile'
const props = defineProps<{ modelValue?: CreationOutlineInput; disabled?: boolean; saved: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: CreationOutlineInput]; save: [value: CreationOutlineInput]; reading: [value: boolean] }>()
const reading = ref(false), error = ref(''), notice = ref('')
let request = 0, inputRevision = 0, disposed = false
watch(() => props.modelValue, () => { inputRevision++ }, { deep: true, flush: 'sync' })
watch(() => props.disabled, value => { if (value) request++ }, { flush: 'sync' })
function editText(text: string) {
  inputRevision++; error.value = ''; notice.value = ''
  const prior = props.modelValue
  emit('update:modelValue', prior ? { ...prior, text, savedAt: undefined } : { source: 'paste', originalText: '', text, capturedAt: new Date().toISOString() })
}
async function chooseFile(event: Event) {
  const control = event.target as HTMLInputElement, file = control.files?.[0]
  control.value = ''
  if (!file || props.disabled) return
  const ticket = ++request, revision = inputRevision
  reading.value = true; emit('reading', true); error.value = ''; notice.value = ''
  try {
    const value = await readCreationOutlineFile(file)
    if (disposed || ticket !== request || props.disabled) return
    if (revision !== inputRevision) { notice.value = '文件已读取，但你已修改输入，本次结果未替换。需要时请重新选择该文件。'; return }
    emit('update:modelValue', value)
  } catch (cause) { if (!disposed && ticket === request) error.value = '读取失败，当前输入已保留：' + (cause instanceof Error ? cause.message : '无法读取文件') }
  finally { if (!disposed && ticket === request) { reading.value = false; emit('reading', false) } }
}
function usePastedSource() {
  request++; inputRevision++; reading.value = false; emit('reading', false)
  emit('update:modelValue', { source: 'paste', text: props.modelValue?.text || '', originalText: '', capturedAt: new Date().toISOString() })
}
function save() {
  if (!props.modelValue || props.disabled || reading.value) return
  try {
    const value: CreationOutlineInput = { ...props.modelValue,
      originalText: props.modelValue.source === 'paste' && !props.modelValue.originalText ? props.modelValue.text : props.modelValue.originalText, savedAt: new Date().toISOString() }
    assertCreationOutlineInput(value, 'outline', true)
    emit('update:modelValue', value); emit('save', value); error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '大纲候选无法保存' }
}
onBeforeUnmount(() => { disposed = true; request++; emit('reading', false) })
</script>
<style scoped>
.outline-import { display:grid; gap:12px; } h3,p { margin:0; } p { line-height:1.7; } label { display:grid; gap:8px; }
textarea { width:100%; box-sizing:border-box; resize:vertical; font:inherit; padding:12px; color:var(--text-color-primary); background:var(--bg-color); border:1px solid var(--border-color); border-radius:6px; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto; } .actions { display:flex; flex-wrap:wrap; gap:10px; }
button { cursor:pointer; font:inherit; padding:10px; border:1px solid var(--border-color); border-radius:6px; color:var(--text-color-primary); background:var(--bg-color); } button:disabled { opacity:.5; cursor:default; }
</style>
