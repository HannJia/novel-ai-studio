<template>
  <n-modal :show="show" preset="card" title="存入知识库" class="save-chat-knowledge"
    style="width: min(640px, calc(100vw - 32px));" :closable="!saving" :mask-closable="!saving"
    :close-on-esc="!saving" @update:show="value => { if (!saving) emit('update:show', value) }">
    <div class="knowledge-draft-form">
      <label>目标知识库</label>
      <n-select v-model:value="target" :options="options" :disabled="saving || Boolean(pending)"
        aria-label="目标知识库" />
      <template v-if="target === NEW_BASE">
        <label>新知识库名称</label>
        <n-input v-model:value="name" :maxlength="100" :disabled="saving || Boolean(pending)" aria-label="新知识库名称" />
      </template>
      <label>条目标题</label>
      <n-input v-model:value="title" :maxlength="180" :disabled="saving || Boolean(pending)" aria-label="条目标题" />
      <label>分类</label>
      <n-select v-model:value="category" :options="kbCategories" :disabled="saving || Boolean(pending)" aria-label="条目分类" />
      <label>内容</label>
      <n-input v-model:value="draft" type="textarea" :rows="10" :disabled="saving || Boolean(pending)" aria-label="知识条目内容" />
      <label>标签</label>
      <n-input v-model:value="tags" placeholder="用逗号分隔" :disabled="saving || Boolean(pending)" aria-label="知识条目标签" />
      <p v-if="error" class="knowledge-save-error" role="alert">{{ error }}</p>
    </div>
    <template #action>
      <n-button :disabled="saving" @click="emit('update:show', false)">取消</n-button>
      <n-button type="primary" :loading="saving" :disabled="!canSave" @click="save">
        <template #icon><n-icon><save-outline /></n-icon></template>{{ pending ? '重试保存' : '确认保存' }}
      </n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NIcon, NInput, NModal, NSelect } from 'naive-ui'
import { SaveOutline } from '@vicons/ionicons5'
import { kbCategories, useKnowledgeStore } from '@/stores/knowledge'

const props = defineProps<{ show: boolean; content: string; preferredIds?: string[] }>()
const emit = defineEmits<{
  'update:show': [show: boolean]
  saved: [result: { kbId: string; kbName: string; entryId: string; title: string }]
}>()
const store = useKnowledgeStore()
const NEW_BASE = '__new_knowledge_base__'
const target = ref(NEW_BASE)
const name = ref('')
const title = ref('')
const category = ref('其他')
const draft = ref('')
const tags = ref('')
const saving = ref(false)
let active = true
onBeforeUnmount(() => { active = false })
const error = ref('')
const pending = ref<{ kbId: string; entryId: string; title: string } | null>(null)
const options = computed(() => [
  ...store.knowledgeBases.map(base => ({ label: base.name, value: base.id })),
  { label: '新建知识库', value: NEW_BASE },
])
const canSave = computed(() => !saving.value && (Boolean(pending.value)
  || Boolean(title.value.trim() && draft.value.trim() && (target.value !== NEW_BASE || name.value.trim()))))

watch(() => props.show, show => {
  if (!show) return
  target.value = props.preferredIds?.find(id => store.getKB(id)) || NEW_BASE
  name.value = ''
  title.value = props.content.split('\n').map(line => line.replace(/^[#*\s]+|[*\s]+$/g, '')).find(Boolean)?.slice(0, 180) || ''
  draft.value = props.content
  category.value = '其他'
  tags.value = ''
  error.value = ''
  pending.value = null
}, { immediate: true })

async function save() {
  if (!canSave.value) return
  saving.value = true
  error.value = ''
  try {
    if (!pending.value) {
      if (draft.value.length > 100_000) throw new Error('条目超过 10 万字符，请拆分后保存。')
      let kb = store.getKB(target.value)
      if (target.value === NEW_BASE) {
        if (store.knowledgeBases.some(base => base.name === name.value.trim())) throw new Error('已有同名知识库，请选择该库或修改名称。')
        kb = store.createKB(name.value.trim())
      }
      if (!kb) throw new Error('目标知识库已不存在，请重新选择。')
      const entry = store.addEntry(kb.id, {
        title: title.value.trim(), content: draft.value.trim(), category: category.value, summary: '',
        tags: tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).slice(0, 20),
      })
      if (!entry) throw new Error('未能创建条目，请重试。')
      pending.value = { kbId: kb.id, entryId: entry.id, title: entry.title }
    }
    await store.flushPendingSaves()
    if (!active) return
    const kb = store.getKB(pending.value.kbId)
    if (!kb?.entries.some(entry => entry.id === pending.value!.entryId)) throw new Error('条目已被移除，请重新保存。')
    emit('saved', { ...pending.value, kbName: kb.name })
    emit('update:show', false)
  } catch (cause) {
    error.value = pending.value
      ? '条目已加入本次会话，但写入本机失败。请重试保存，不会重复创建条目。'
      : cause instanceof Error ? cause.message : '保存失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.knowledge-draft-form { display: grid; gap: 8px; min-width: 0; }
.knowledge-draft-form label { font-size: 13px; color: var(--text-color-secondary); }
.knowledge-save-error { color: var(--color-error); overflow-wrap: anywhere; margin: 0; }
</style>
