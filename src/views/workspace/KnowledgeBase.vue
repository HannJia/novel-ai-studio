<template>
  <div class="kb-page page-container fade-in" id="knowledge-base">
    <div class="kb-header">
      <h2 class="page-title">知识库</h2>
      <div class="header-actions">
        <n-button size="small" type="primary" @click="showCreateModal = true">
          + 创建知识库
        </n-button>
      </div>
    </div>

    <!-- 知识库列表 -->
    <div v-if="!selectedKBId" class="kb-list">
      <div v-if="knowledgeBases.length === 0" class="empty-state paper-panel">
        <div class="empty-icon">📚</div>
        <h3>还没有知识库</h3>
        <p>知识库可以存储世界观、人物、势力等设定信息，在 AI 写作时自动注入</p>
        <n-button type="primary" @click="showCreateModal = true">创建第一个知识库</n-button>
      </div>
      <div
        v-for="kb in knowledgeBases"
        :key="kb.id"
        class="kb-card paper-panel"
        @click="selectKB(kb.id)"
      >
        <div class="kb-card-icon">📚</div>
        <div class="kb-card-info">
          <h3>{{ kb.name }}</h3>
          <p>{{ kb.description || '暂无描述' }}</p>
          <span class="kb-card-meta">{{ kb.entries.length }} 条目 · {{ formatDate(kb.createdAt) }}</span>
        </div>
        <n-button
          size="tiny"
          :type="isBound(kb.id) ? 'warning' : 'default'"
          @click.stop="toggleBind(kb.id)"
        >
          {{ isBound(kb.id) ? '✅ 已绑定' : '🔗 绑定小说' }}
        </n-button>
        <n-popconfirm @positive-click.stop="deleteKB(kb.id)">
          <template #trigger>
            <n-button size="tiny" quaternary type="error" @click.stop>删除</n-button>
          </template>
          确定删除此知识库？
        </n-popconfirm>
      </div>
    </div>

    <!-- 知识库详情 -->
    <div v-else class="kb-detail">
      <div class="kb-detail-header">
        <n-button size="small" text @click="selectedKBId = ''">←  返回列表</n-button>
        <h3>{{ selectedKB?.name }}</h3>
        <div class="detail-actions">
          <n-button size="small" @click="showImportModal = true">📥 导入</n-button>
          <n-button size="small" type="primary" @click="openAddEntry">+ 添加条目</n-button>
        </div>
      </div>

      <!-- 筛选栏 -->
      <div class="filter-bar">
        <n-input v-model:value="searchQuery" placeholder="搜索条目..." size="small" clearable style="max-width:220px;" />
        <n-select
          v-model:value="categoryFilter"
          :options="categoryOptions"
          size="small"
          clearable
          placeholder="分类"
          style="width:140px;"
        />
        <span class="entry-count">{{ filteredEntries.length }} 条</span>
      </div>

      <!-- 条目列表 -->
      <div class="entry-list">
        <div v-if="filteredEntries.length === 0" class="empty-hint">暂无条目</div>
        <div
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="entry-card paper-panel"
        >
          <div class="entry-header">
            <span class="entry-cat">{{ getCategoryIcon(entry.category) }} {{ entry.category }}</span>
            <h4>{{ entry.title }}</h4>
          </div>
          <p class="entry-preview">{{ entry.content.substring(0, 120) }}{{ entry.content.length > 120 ? '...' : '' }}</p>
          <div class="entry-footer">
            <div class="entry-tags" v-if="entry.tags.length">
              <span v-for="t in entry.tags" :key="t" class="tag-chip">{{ t }}</span>
            </div>
            <div class="entry-actions">
              <n-button size="tiny" @click="editEntry(entry)">编辑</n-button>
              <n-button size="tiny" type="error" quaternary @click="removeEntry(entry.id)">删除</n-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建知识库弹窗 -->
    <n-modal v-model:show="showCreateModal" preset="card" title="创建知识库" style="max-width:400px;">
      <div class="form-group">
        <label>名称</label>
        <n-input v-model:value="createForm.name" size="small" placeholder="如：仙侠世界设定" />
        <label>描述</label>
        <n-input v-model:value="createForm.description" size="small" placeholder="简要描述此知识库的用途" />
      </div>
      <template #action>
        <n-button @click="showCreateModal = false">取消</n-button>
        <n-button type="primary" :disabled="!createForm.name.trim()" @click="doCreateKB">创建</n-button>
      </template>
    </n-modal>

    <!-- 添加/编辑条目弹窗 -->
    <n-modal v-model:show="showEntryModal" preset="card" :title="editingEntryId ? '编辑条目' : '添加条目'" style="max-width:550px;">
      <div class="form-group">
        <label>标题</label>
        <n-input v-model:value="entryForm.title" size="small" placeholder="条目标题" />
        <label>分类</label>
        <n-select v-model:value="entryForm.category" :options="categoryOptions" size="small" />
        <label>内容</label>
        <n-input v-model:value="entryForm.content" type="textarea" :rows="8" size="small" placeholder="条目内容（支持 Markdown）" />
        <label>标签（逗号分隔）</label>
        <n-input v-model:value="entryForm.tagsText" size="small" placeholder="如：剑法,武技" />
      </div>
      <template #action>
        <n-button @click="showEntryModal = false">取消</n-button>
        <n-button type="primary" :disabled="!entryForm.title.trim()" @click="saveEntry">保存</n-button>
      </template>
    </n-modal>

    <!-- 导入弹窗 -->
    <n-modal v-model:show="showImportModal" preset="card" title="导入内容" style="max-width:550px;">
      <div class="form-group">
        <label>分类</label>
        <n-select v-model:value="importCategory" :options="categoryOptions" size="small" />

        <label>上传文件（支持 .txt / .md / .docx / .epub / .pdf）</label>
        <div class="file-upload-area">
          <input
            ref="fileInputRef"
            type="file"
            accept=".txt,.md,.markdown,.docx,.epub,.pdf"
            @change="handleFileUpload"
            style="display:none;"
          />
          <n-button size="small" @click="($refs.fileInputRef as HTMLInputElement)?.click()">
            📁 选择文件
          </n-button>
          <span v-if="uploadFileName" class="file-name">{{ uploadFileName }}</span>
        </div>

        <label>文本内容（按 ## 标题 或 --- 分割为条目）</label>
        <n-input v-model:value="importText" type="textarea" :rows="10" size="small" placeholder="粘贴内容或上传文件..." />
      </div>
      <template #action>
        <n-button @click="showImportModal = false">取消</n-button>
        <n-button type="primary" :disabled="!importText.trim()" @click="doImport">导入</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NInput, NSelect, NModal, NPopconfirm, useMessage } from 'naive-ui'
import { useKnowledgeStore, kbCategories, type KBEntry } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { readKnowledgeFile } from '@/services/knowledgeImport'

const route = useRoute()
const kbStore = useKnowledgeStore()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const msg = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))

const knowledgeBases = computed(() => kbStore.knowledgeBases)
const selectedKBId = ref('')
const selectedKB = computed(() => kbStore.getKB(selectedKBId.value))
const searchQuery = ref('')
const categoryFilter = ref<string | null>(null)

const showCreateModal = ref(false)
const showEntryModal = ref(false)
const showImportModal = ref(false)
const editingEntryId = ref('')

const categoryOptions = kbCategories.map(c => ({ label: c.label, value: c.value }))

const createForm = ref({ name: '', description: '' })
const entryForm = ref({ title: '', category: '其他', content: '', tagsText: '' })
const importCategory = ref('其他')
const importText = ref('')
const uploadFileName = ref('')

const filteredEntries = computed(() => {
  if (!selectedKB.value) return []
  let list = selectedKB.value.entries
  if (categoryFilter.value) {
    list = list.filter(e => e.category === categoryFilter.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q)
    )
  }
  return list
})

function selectKB(id: string) { selectedKBId.value = id }

function getCategoryIcon(cat: string) {
  return kbCategories.find(c => c.value === cat)?.icon || '📝'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}

function doCreateKB() {
  kbStore.createKB(createForm.value.name.trim(), createForm.value.description.trim())
  createForm.value = { name: '', description: '' }
  showCreateModal.value = false
  msg.success('知识库已创建')
}

async function deleteKB(id: string) {
  try {
    for (const book of novelStore.novels) {
      if (book.knowledgeBaseIds.includes(id)) novelStore.unbindKnowledgeBase(book.id, id)
    }
    await novelStore.flushPendingSaves()
    await kbStore.deleteKB(id)
    msg.success('已删除')
  } catch (error) { msg.error(error instanceof Error ? error.message : '删除失败，请重试') }
}

function openAddEntry() {
  editingEntryId.value = ''
  entryForm.value = { title: '', category: '其他', content: '', tagsText: '' }
  showEntryModal.value = true
}

function editEntry(entry: KBEntry) {
  editingEntryId.value = entry.id
  entryForm.value = {
    title: entry.title,
    category: entry.category,
    content: entry.content,
    tagsText: entry.tags.join('、'),
  }
  showEntryModal.value = true
}

function saveEntry() {
  const data = {
    title: entryForm.value.title.trim(),
    category: entryForm.value.category,
    content: entryForm.value.content,
    summary: '',
    tags: entryForm.value.tagsText.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
  }
  if (editingEntryId.value) {
    kbStore.updateEntry(selectedKBId.value, editingEntryId.value, data)
    msg.success('条目已更新')
    // 重新生成总结
    autoSummarizeEntry(selectedKBId.value, editingEntryId.value, data.content)
  } else {
    const newEntry = kbStore.addEntry(selectedKBId.value, data)
    msg.success('条目已添加')
    if (newEntry) {
      autoSummarizeEntry(selectedKBId.value, newEntry.id, data.content)
    }
  }
  showEntryModal.value = false
}

function removeEntry(id: string) {
  kbStore.deleteEntry(selectedKBId.value, id)
  msg.success('已删除')
}

function doImport() {
  const count = kbStore.importFromText(selectedKBId.value, importText.value, importCategory.value)
  importText.value = ''
  uploadFileName.value = ''
  showImportModal.value = false
  msg.success(`已导入 ${count} 个条目，AI 正在自动总结...`)
  // 为所有没有 summary 的条目自动生成总结
  const kb = kbStore.getKB(selectedKBId.value)
  if (kb) {
    for (const entry of kb.entries) {
      if (!entry.summary && entry.content) {
        autoSummarizeEntry(selectedKBId.value, entry.id, entry.content)
      }
    }
  }
}

// AI 自动总结知识库条目
async function autoSummarizeEntry(kbId: string, entryId: string, content: string) {
  const model = configStore.getModelForTask('review')
  if (!model || content.length < 20) return
  try {
    let summary = ''
    await callAI({
      model,
      skillTask: 'analysis',
      messages: [
        {
          role: 'system' as const,
          content: '你是一个精炼的文本总结专家。你需要对给定的小说设定/世界观/知识库内容进行简洁准确的总结，提取核心信息和关键数据。总结应保留所有重要的数值、名称、关系和规则，便于后续写作参考。'
        },
        {
          role: 'user' as const,
          content: `请对以下内容进行总结，保留核心设定和关键数据：\n\n${content}`
        }
      ],
      stream: true,
      onChunk: (c) => { summary += c },
    })
    kbStore.updateEntry(kbId, entryId, { summary })
  } catch {
    // 总结失败时静默处理，用户可手动重新触发
  }
}

// 文件上传处理
async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadFileName.value = file.name
  try {
    importText.value = await readKnowledgeFile(file)
    if (importText.value.trim()) msg.success(`已读取文件：${file.name}`)
    else msg.warning('未提取到文本，扫描版 PDF 暂不支持 OCR')
  } catch (err: any) {
    msg.error(`文件解析失败: ${err.message}`)
  } finally { input.value = '' }
}

// 知识库绑定
function isBound(kbId: string) {
  return novel.value?.knowledgeBaseIds?.includes(kbId) || false
}

function toggleBind(kbId: string) {
  if (isBound(kbId)) {
    novelStore.unbindKnowledgeBase(novelId.value, kbId)
    msg.success('已解绑知识库')
  } else {
    novelStore.bindKnowledgeBase(novelId.value, kbId)
    msg.success('已绑定知识库，AI 写作时将自动注入相关知识')
  }
}
</script>

<style scoped>
.kb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-lg);
}
.header-actions { display: flex; gap: 8px; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 40vh; gap: 12px; text-align: center;
}
.empty-icon { font-size: 48px; }
.empty-state h3 { font-size: 18px; color: var(--text-color-primary); }
.empty-state p { font-size: 14px; color: var(--text-color-tertiary); max-width: 360px; }

/* 知识库卡片 */
.kb-list { display: flex; flex-direction: column; gap: var(--space-md); }

.kb-card {
  display: flex; align-items: center; gap: 16px;
  padding: 16px; cursor: pointer;
  transition: all var(--transition-fast);
}
.kb-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }

.kb-card-icon { font-size: 32px; }
.kb-card-info { flex: 1; }
.kb-card-info h3 { font-size: 16px; font-weight: 600; color: var(--text-color-primary); margin-bottom: 2px; }
.kb-card-info p { font-size: 13px; color: var(--text-color-tertiary); margin: 0; }
.kb-card-meta { font-size: 11px; color: var(--text-color-disabled); }

/* 知识库详情 */
.kb-detail-header {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: var(--space-md);
}
.kb-detail-header h3 { flex: 1; font-size: 18px; }
.detail-actions { display: flex; gap: 8px; }

.filter-bar {
  display: flex; gap: 12px; margin-bottom: var(--space-md); align-items: center;
}
.entry-count { font-size: 12px; color: var(--text-color-tertiary); margin-left: auto; }

/* 条目列表 */
.entry-list { display: flex; flex-direction: column; gap: var(--space-sm); }

.entry-card { padding: 12px 16px; }
.entry-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.entry-cat {
  font-size: 11px; padding: 2px 8px; border-radius: 100px;
  background: var(--bg-color-secondary); color: var(--text-color-tertiary);
}
.entry-header h4 { font-size: 14px; font-weight: 600; color: var(--text-color-primary); margin: 0; }
.entry-preview { font-size: 13px; color: var(--text-color-secondary); line-height: 1.6; margin: 0 0 8px; }

.entry-footer { display: flex; align-items: center; justify-content: space-between; }
.entry-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag-chip {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: var(--color-primary-light); color: var(--color-primary);
}
.entry-actions { display: flex; gap: 4px; }

.empty-hint { text-align: center; color: var(--text-color-tertiary); padding: 40px; font-size: 14px; }

/* 表单 */
.form-group { display: flex; flex-direction: column; gap: 8px; }
.form-group label { font-size: 12px; font-weight: 600; color: var(--text-color-secondary); }

.file-upload-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-name {
  font-size: 12px;
  color: var(--text-color-tertiary);
}
</style>
