<template>
  <div class="kb-page page-container fade-in" id="knowledge-base">
    <div class="kb-header">
      <div>
        <h2 class="page-title">{{ selectedKB?.name || '知识库' }}</h2>
        <p v-if="!selectedKBId" class="page-subtitle">全局设定资料与书籍挂载</p>
      </div>
      <div class="header-actions">
        <n-button v-if="!hasNovelContext" size="small" tertiary @click="router.push('/')">返回书架</n-button>
        <n-button size="small" type="primary" @click="showCreateModal = true">
          <template #icon><span style="font-size:16px">+</span></template>
          创建知识库
        </n-button>
      </div>
    </div>

    <!-- 知识库列表 -->
    <div v-if="!selectedKBId" class="kb-list">
      <div class="kb-list-toolbar">
        <span class="kb-library-count">共 {{ knowledgeBases.length }} 个知识库</span>
        <n-input v-model:value="libraryQuery" placeholder="搜索知识库、描述或条目..." clearable aria-label="搜索知识库" />
        <n-select v-model:value="librarySort" :options="librarySortOptions" aria-label="知识库排序" />
      </div>
      <div v-if="knowledgeBases.length === 0" class="empty-state paper-panel">
        <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
        <h3>还没有知识库</h3>
        <p>知识库可以存储世界观、人物、势力等设定信息，在 AI 写作时自动注入</p>
        <n-button type="primary" @click="showCreateModal = true">创建第一个知识库</n-button>
      </div>
      <div
        v-for="kb in filteredKnowledgeBases"
        :key="kb.id"
        class="kb-card paper-panel"
        role="button"
        tabindex="0"
        @click="selectKB(kb.id)"
        @keydown.enter.self.prevent="selectKB(kb.id)"
        @keydown.space.self.prevent="selectKB(kb.id)"
      >
        <div class="kb-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H3zM21 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6z" /></svg></div>
        <div class="kb-card-info">
          <h3>{{ kb.name }}</h3>
          <p>{{ kb.description || '暂无描述' }}</p>
          <p v-if="kb.summary" class="kb-summary-preview">摘要：{{ kb.summary.slice(0, 180) }}{{ kb.summary.length > 180 ? '...' : '' }}</p>
          <span class="kb-card-meta">{{ kb.entries.length }} 条目 · {{ kbActivityTime(kb) ? formatDate(new Date(kbActivityTime(kb)).toISOString()) : '暂无编辑记录' }}{{ hasNovelContext && isBound(kb.id) ? ' · 本书已挂载' : '' }}</span>
        </div>
        <div class="kb-card-actions">
        <n-button
          v-if="hasNovelContext"
          size="tiny"
          :type="isBound(kb.id) ? 'warning' : 'default'"
          @click.stop="toggleBind(kb.id)"
        >
          {{ isBound(kb.id) ? '已绑定' : '绑定小说' }}
        </n-button>
        <n-popconfirm @positive-click.stop="deleteKB(kb.id)">
          <template #trigger>
            <n-button size="tiny" quaternary type="error" @click.stop>删除</n-button>
          </template>
          确定删除此知识库？
        </n-popconfirm>
        </div>
      </div>
      <p v-if="knowledgeBases.length && !filteredKnowledgeBases.length" class="kb-no-results paper-panel">没有匹配的知识库，请尝试其他关键词。</p>
    </div>

    <!-- 知识库详情 -->
    <div v-else class="kb-detail">
      <div class="kb-detail-header">
        <n-button size="small" text @click="selectedKBId = ''">←  返回列表</n-button>
        <div class="detail-actions">
          <n-button size="small" tertiary @click="showImportModal = true">导入</n-button>
          <n-button size="small" tertiary :loading="summarizingKB" @click="summarizeSelectedKB">整理摘要</n-button>
          <n-button size="small" type="primary" @click="openAddEntry">
            <template #icon><span style="font-size:16px">+</span></template>
            添加条目
          </n-button>
        </div>
      </div>

      <section class="kb-summary-panel paper-panel">
        <div class="kb-summary-toolbar">
          <div>
            <h4>知识库摘要</h4>
            <p>摘要在书架层面维护，挂载到小说后 AI 优先读取摘要，再按问题读取相关条目。</p>
          </div>
          <n-select v-model:value="summaryLevel" :options="summaryLevelOptions" size="small" style="width:120px;" />
        </div>
        <p v-if="selectedKB?.summary" class="kb-summary-content">{{ selectedKB.summary }}</p>
        <p v-else class="empty-hint">还没有摘要，点击“整理摘要”生成。</p>
        <span v-if="selectedKB?.summaryUpdatedAt" class="kb-summary-time">上次整理：{{ formatDateTime(selectedKB.summaryUpdatedAt) }}</span>
      </section>

      <div class="kb-browser">
        <!-- 左侧分类列表（仅绑定现有 categoryFilter） -->
        <nav class="kb-category-rail" aria-label="条目分类">
          <button
            type="button"
            class="kb-category-item"
            :class="{ active: !categoryFilter }"
            @click="categoryFilter = null"
          >
            <span>全部</span>
            <span class="kb-category-count">{{ selectedKB?.entries.length ?? 0 }}</span>
          </button>
          <button
            v-for="cat in categoryOptions"
            :key="cat.value"
            type="button"
            class="kb-category-item"
            :class="{ active: categoryFilter === cat.value }"
            @click="categoryFilter = cat.value"
          >
            <span>{{ cat.label }}</span>
            <span class="kb-category-count">{{ countByCategory(cat.value) }}</span>
          </button>
        </nav>

        <div class="kb-entries">
          <!-- 筛选栏 -->
          <div class="filter-bar">
            <n-input v-model:value="searchQuery" placeholder="搜索条目..." size="small" clearable style="max-width:260px;" />
            <span class="entry-count">{{ filteredEntries.length }} 条</span>
          </div>

          <!-- 条目列表 -->
          <div class="entry-list">
            <div v-if="filteredEntries.length === 0" class="empty-hint">暂无条目</div>
            <div
              v-for="entry in filteredEntries"
              :key="entry.id"
              class="entry-card paper-panel"
              :class="{ 'entry-selected': selectedEntryId === entry.id }"
            >
              <div class="entry-header">
                <h4>{{ entry.title }}</h4>
                <span class="entry-cat">{{ categoryLabel(entry.category) }}</span>
              </div>
              <p class="entry-preview">{{ entry.content.substring(0, 120) }}{{ entry.content.length > 120 ? '...' : '' }}</p>
              <div class="entry-footer">
                <div class="entry-tags" v-if="entry.tags.length">
                  <span v-for="t in entry.tags" :key="t" class="tag-chip">{{ t }}</span>
                </div>
                <div class="entry-actions">
                  <n-button size="tiny" :aria-pressed="selectedEntryId === entry.id" @click="selectEntry(entry.id)">查看</n-button>
                  <n-button size="tiny" @click="editEntry(entry)">编辑</n-button>
                  <n-button size="tiny" type="error" quaternary @click="removeEntry(entry.id)">删除</n-button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧详情面板 -->
        <div v-if="selectedEntryId && selectedEntry" class="entry-detail-panel">
          <div class="entry-detail-header">
            <div class="entry-detail-title-group">
              <h3>{{ selectedEntry.title }}</h3>
              <span class="entry-detail-cat">{{ categoryLabel(selectedEntry.category) }}</span>
            </div>
          </div>
          <div class="entry-detail-content" v-html="renderMd(selectedEntry.content)"></div>
          <div class="entry-detail-meta">
            <div v-if="selectedEntry.tags.length" class="entry-detail-tags">
              <span v-for="t in selectedEntry.tags" :key="t" class="tag-chip">{{ t }}</span>
            </div>
            <div class="entry-detail-timestamps">
              <span>创建：{{ formatDateTime(selectedEntry.createdAt) }}</span>
              <span v-if="selectedEntry.updatedAt !== selectedEntry.createdAt">更新：{{ formatDateTime(selectedEntry.updatedAt) }}</span>
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

    <KnowledgeImportDialog v-model:show="showImportModal" :kb-id="selectedKBId" @imported="afterImport" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NSelect, NModal, NPopconfirm, useMessage } from 'naive-ui'
import { useKnowledgeStore, kbCategories, type KBEntry, type KnowledgeBase } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import KnowledgeImportDialog from '@/components/KnowledgeImportDialog.vue'
import { parseAiJsonObject } from '@/utils/aiJson'
import { renderMd } from '@/utils/markdown'

const route = useRoute()
const router = useRouter()
const kbStore = useKnowledgeStore()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const msg = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const hasNovelContext = computed(() => Boolean(route.params.novelId))

const knowledgeBases = computed(() => kbStore.knowledgeBases)
const selectedKBId = ref('')
const selectedKB = computed(() => kbStore.getKB(selectedKBId.value))
const searchQuery = ref('')
const categoryFilter = ref<string | null>(null)
const libraryQuery = ref('')
const librarySort = ref<'recent' | 'name'>('recent')
const librarySortOptions = [{ label: '最近编辑', value: 'recent' }, { label: '名称', value: 'name' }]
function kbActivityTime(kb: KnowledgeBase) {
  const time = (value: string | undefined) => {
    const parsed = value ? Date.parse(value) : NaN
    return Number.isFinite(parsed) ? parsed : 0
  }
  return kb.entries.reduce((latest, entry) => Math.max(latest, time(entry.updatedAt)), Math.max(time(kb.createdAt), time(kb.summaryUpdatedAt)))
}
const filteredKnowledgeBases = computed(() => {
  const query = libraryQuery.value.trim().toLowerCase()
  return knowledgeBases.value.filter(kb => !query || kb.name.toLowerCase().includes(query)
    || kb.description.toLowerCase().includes(query) || kb.entries.some(entry => entry.title.toLowerCase().includes(query)))
    .sort((a, b) => librarySort.value === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : kbActivityTime(b) - kbActivityTime(a))
})
const selectedEntryId = ref('')
const selectedEntry = computed(() => {
  if (!selectedEntryId.value || !selectedKB.value) return null
  return selectedKB.value.entries.find(e => e.id === selectedEntryId.value) || null
})

const showCreateModal = ref(false)
const showEntryModal = ref(false)
const showImportModal = ref(false)
const editingEntryId = ref('')

// 标签里可能带 emoji 前缀，界面只显示文字
const categoryOptions = kbCategories.map(c => ({ label: categoryText(c.label), value: c.value }))

function categoryText(label: string) {
  return label.replace(/^[^\p{L}\p{N}]+/u, '').trim() || label
}

// 条目分类显示中文名（旧数据可能存的是 value 或中文名）
function categoryLabel(cat: string) {
  const match = kbCategories.find(c => c.value === cat || categoryText(c.label) === cat)
  return match ? categoryText(match.label) : cat
}

const createForm = ref({ name: '', description: '' })
const entryForm = ref({ title: '', category: '其他', content: '', tagsText: '' })
const summarizingEntryIds = ref(new Set<string>())
const summarizingKB = ref(false)
const summaryLevel = ref<NonNullable<KnowledgeBase['summaryLevel']>>('standard')
const summaryLevelOptions = [
  { label: '简略', value: 'brief' },
  { label: '标准', value: 'standard' },
  { label: '详细', value: 'detailed' },
]
const validCategories = new Set(kbCategories.map(item => item.value))

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

function selectEntry(id: string) {
  selectedEntryId.value = id
}

// Auto-select first visible entry when filters or KB change
watch([filteredEntries, selectedKBId], ([entries, kbId]) => {
  if (!kbId) {
    selectedEntryId.value = ''
    return
  }
  // If current selection is no longer visible, select first visible entry
  const currentVisible = entries.some(e => e.id === selectedEntryId.value)
  if (!currentVisible && entries.length > 0) {
    selectedEntryId.value = entries[0].id
  } else if (entries.length === 0) {
    selectedEntryId.value = ''
  }
}, { immediate: true })

function selectKB(id: string) {
  selectedKBId.value = id
  summaryLevel.value = kbStore.getKB(id)?.summaryLevel || 'standard'
}

// 分类栏计数，仅用于展示
function countByCategory(cat: string) {
  return selectedKB.value?.entries.filter(e => e.category === cat).length ?? 0
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
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
  // After deletion, auto-select first visible entry
  if (selectedEntryId.value === id) {
    const remaining = filteredEntries.value
    selectedEntryId.value = remaining.length > 0 ? remaining[0].id : ''
  }
}

async function afterImport(result: { kbId: string; entryIds: string[]; summarize: boolean }) {
  msg.success(`已导入 ${result.entryIds.length} 个条目`)
  if (!result.summarize) return
  const pending = [...result.entryIds]
  // Limit requests when a scanned document imports hundreds of pages.
  await Promise.all([0, 1].map(async () => {
    while (pending.length) {
      const id = pending.shift()!
      const entry = kbStore.getKB(result.kbId)?.entries.find(item => item.id === id)
      if (entry && !entry.summary) await autoSummarizeEntry(result.kbId, id, entry.content)
    }
  }))
}

// AI 自动总结知识库条目
async function autoSummarizeEntry(kbId: string, entryId: string, content: string) {
  const model = configStore.getModelForTask('review')
  if (!model || content.length < 20) return
  if (summarizingEntryIds.value.has(entryId)) return
  summarizingEntryIds.value = new Set(summarizingEntryIds.value).add(entryId)
  try {
    const parts: string[] = []
    for (let start = 0; start < content.length; start += 6000) {
      let part = ''
      await callAI({
        model,
        skillTask: 'analysis',
        messages: [
          { role: 'system', content: '你是知识库整理专家。提取资料中的事实、时间、人物、地点、因果关系、规则和关键数字，去掉重复内容，不得编造。' },
          { role: 'user', content: `这是长资料第 ${Math.floor(start / 6000) + 1} 段，请整理成可复用摘要：\n\n${content.slice(start, start + 6000)}` },
        ],
        stream: true,
        onChunk: chunk => { part += chunk },
      })
      if (part.trim()) parts.push(part.trim())
    }
    if (!parts.length) return
    let summary = parts.join('\n')
    if (parts.length > 1) {
      let consolidated = ''
      await callAI({
        model,
        skillTask: 'analysis',
        messages: [
          { role: 'system', content: '你是知识库总编。合并分段摘要，去重并按主题整理，只保留资料中明确出现的事实。' },
          { role: 'user', content: `请将以下分段摘要合并为一份统一摘要，控制在 6000 字以内：\n\n${summary.slice(0, 18000)}` },
        ],
        stream: true,
        onChunk: chunk => { consolidated += chunk },
      })
      if (consolidated.trim()) summary = consolidated.trim()
    }
    let category = ''
    try {
      const result = await callAI({
        model,
        skillTask: 'analysis',
        maxTokens: 120,
        messages: [
          { role: 'system', content: `你是知识库分类器。只输出 JSON：{"category":"分类"}。分类只能是：${kbCategories.map(item => item.value).join('、')}。` },
          { role: 'user', content: `请根据标题和资料摘要选择最合适的一个分类：\n${summary.slice(0, 3500)}` },
        ],
      })
      const parsed = parseAiJsonObject<{ category?: string }>(result.content)
      if (parsed?.category && validCategories.has(parsed.category)) category = parsed.category
    } catch {
      // 分类失败不影响摘要保存
    }
    const current = kbStore.getKB(kbId)?.entries.find(entry => entry.id === entryId)
    if (current?.content === content) kbStore.updateEntry(kbId, entryId, { summary: summary.slice(0, 12000), ...(category ? { category } : {}) })
  } catch {
    // 总结失败时静默处理，用户可手动重新触发
  } finally {
    const next = new Set(summarizingEntryIds.value)
    next.delete(entryId)
    summarizingEntryIds.value = next
  }
}

async function summarizeSelectedKB() {
  const kb = selectedKB.value
  const model = configStore.getModelForTask('review')
  if (!kb || !model || summarizingKB.value) return
  if (!kb.entries.length) {
    msg.warning('请先添加或导入资料')
    return
  }
  summarizingKB.value = true
  try {
    const source = kb.entries.map(entry =>
      `【${entry.category}】${entry.title}\n${(entry.summary || entry.content).slice(0, 3000)}`,
    ).join('\n\n').slice(0, 30000)
    const detail = summaryLevel.value === 'brief'
      ? '控制在 800 字以内，只保留最重要的主题、时间、人物、地点、规则和关键数字。'
      : summaryLevel.value === 'detailed'
        ? '控制在 6000 字以内，按主题整理，并完整保留重要时间线、人物关系、地点、制度、事件和数字。'
        : '控制在 2500 字以内，按主题整理，保留重要时间线、人物关系、地点、制度、事件和数字。'
    let summary = ''
    await callAI({
      model,
      skillTask: 'analysis',
      messages: [
        { role: 'system', content: '你是知识库总编。只根据提供的资料整理摘要，不得补充资料外的事实。' },
        { role: 'user', content: `请整理知识库“${kb.name}”的统一摘要。\n${detail}\n使用清晰的小标题和列表，方便后续 AI 写作快速理解。\n\n${source}` },
      ],
      stream: true,
      onChunk: chunk => { summary += chunk },
    })
    if (!summary.trim()) throw new Error('AI 没有返回摘要')
    kbStore.updateSummary(kb.id, summary.trim(), summaryLevel.value)
    msg.success('知识库摘要已更新')
  } catch (error) {
    msg.error(error instanceof Error ? error.message : '摘要整理失败')
  } finally {
    summarizingKB.value = false
  }
}

// 知识库绑定
function isBound(kbId: string) {
  return novel.value?.knowledgeBaseIds?.includes(kbId) || false
}

function toggleBind(kbId: string) {
  if (!hasNovelContext.value) return
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: var(--space-lg);
}
.kb-header .page-title { font-family: var(--font-family-serif); font-weight: 700; letter-spacing: 0.04em; margin: 0; }
.page-subtitle { margin: 6px 0 0; color: var(--text-color-tertiary); font-size: 13px; }
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 40vh; gap: 12px; text-align: center;
}
.empty-icon { width: 220px; color: var(--border-color); }
.empty-state h3 { font-family: var(--font-family-serif); font-size: 18px; color: var(--text-color-primary); }
.empty-state p { font-size: 14px; color: var(--text-color-tertiary); max-width: 360px; }

/* 知识库卡片 */
.kb-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}
.kb-list > .empty-state { grid-column: 1 / -1; }
.kb-list-toolbar { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; }
.kb-library-count { margin-right: auto; color: var(--text-color-secondary); }
.kb-list-toolbar :deep(.n-input) { width: min(100%, 300px); }
.kb-list-toolbar :deep(.n-select) { width: 130px; }
.kb-no-results { grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-color-secondary); }
@media (max-width: 1100px) { .kb-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 650px) { .kb-list { grid-template-columns: 1fr; } }

.kb-card {
  display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: start; gap: 16px;
  padding: 24px; cursor: pointer;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}
.kb-card:hover { transform: translateY(-1px); border-color: var(--border-color-hover); box-shadow: var(--shadow-hover); }
.kb-card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.kb-card-info { min-width: 0; overflow-wrap: anywhere; }
.kb-card-actions { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.kb-card-icon {
  flex-shrink: 0;
  width: 64px; height: 72px;
  display: grid; place-items: center;
  font-family: var(--font-family-serif); font-size: 18px;
  color: var(--color-primary); background: var(--bg-color-hover);
  border-radius: var(--radius-sm);
}
.kb-card-icon svg { width: 32px; height: 32px; }
.kb-card:nth-of-type(3n) .kb-card-icon { color: var(--color-info); }
.kb-card:nth-of-type(3n + 1) .kb-card-icon { color: var(--color-success); }
.kb-card-info { flex: 1; min-width: 0; }
.kb-card-info h3 {
  font-family: var(--font-family-serif); font-size: 18px; font-weight: 700;
  color: var(--text-color-primary); margin: 0 0 6px; letter-spacing: 0.02em;
}
.kb-card-info p { font-size: 13px; color: var(--text-color-tertiary); margin: 0; line-height: 1.6; }
.kb-summary-preview {
  color: var(--text-color-secondary) !important; line-height: 1.6;
  margin-top: 6px !important;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.kb-card-meta {
  display: inline-block; margin-top: 8px;
  font-size: 12px; color: var(--text-color-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 知识库详情 */
.kb-detail-header {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-bottom: var(--space-md);
}
.kb-detail-header h3 {
  flex: 1; margin: 0;
  font-family: var(--font-family-serif); font-size: 24px; font-weight: 700;
  color: var(--text-color-primary); letter-spacing: 0.03em;
}
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }

/* 左侧分类 + 中间列表 + 右侧详情 */
.kb-browser {
  display: grid;
  grid-template-columns: 140px 280px minmax(0, 1fr);
  gap: var(--space-lg);
  align-items: start;
}

.kb-category-rail {
  position: sticky; top: 0;
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px;
  background: var(--bg-color-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.kb-category-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px;
  font: inherit; font-size: 13px; text-align: left;
  color: var(--text-color-secondary);
  background: transparent;
  border: none; border-left: 2px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.kb-category-item:hover { background: var(--bg-color-hover); color: var(--text-color-primary); }
.kb-category-item.active {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-left-color: var(--color-primary);
  font-weight: 600;
}
.kb-category-item:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.kb-category-count { font-size: 12px; color: var(--text-color-tertiary); font-variant-numeric: tabular-nums; }
.kb-category-item.active .kb-category-count { color: var(--color-primary); }
.kb-entries { min-width: 0; }

.filter-bar {
  display: flex; gap: 12px; margin-bottom: var(--space-md); align-items: center;
}
.entry-count { flex-shrink: 0; white-space: nowrap; font-size: 12px; color: var(--text-color-tertiary); margin-left: auto; font-variant-numeric: tabular-nums; }
.kb-summary-panel .empty-hint { padding: 12px 0; }

/* 条目列表 */
.entry-list { display: flex; flex-direction: column; gap: 10px; }

.entry-card {
  padding: 16px 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.entry-card:hover { border-color: var(--border-color-hover); }
.entry-card.entry-selected {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.entry-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.entry-cat {
  flex-shrink: 0;
  font-size: 11px; padding: 1px 8px; border-radius: var(--radius-sm);
  background: var(--color-accent-light); color: var(--color-accent);
}
.entry-header h4 {
  font-family: var(--font-family-serif); font-size: 17px; font-weight: 700;
  color: var(--text-color-primary); margin: 0; letter-spacing: 0.01em;
}
.entry-preview { font-size: 13px; color: var(--text-color-secondary); line-height: 1.7; margin: 0 0 8px; }

.entry-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.entry-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag-chip {
  font-size: 11px; padding: 1px 6px; border-radius: var(--radius-sm);
  background: var(--color-primary-light); color: var(--color-primary);
}
.entry-actions { display: flex; gap: 4px; margin-left: auto; }

.empty-hint { text-align: center; color: var(--text-color-tertiary); padding: 40px; font-size: 14px; }

.kb-summary-panel {
  margin-bottom: var(--space-lg); padding: 16px 18px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.kb-summary-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.kb-summary-toolbar h4 { margin: 0 0 4px; font-family: var(--font-family-serif); font-size: 16px; color: var(--text-color-primary); }

/* Entry detail panel */
.entry-detail-panel {
  position: sticky;
  top: 0;
  padding: 20px 24px;
  background: var(--bg-color-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

.entry-detail-header {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.entry-detail-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.entry-detail-panel h3 {
  font-family: var(--font-family-serif);
  font-size: 22px;
  font-weight: 700;
  color: var(--text-color-primary);
  margin: 0;
  letter-spacing: 0.02em;
}

.entry-detail-cat {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  background: var(--color-accent-light);
  color: var(--color-accent);
}

.entry-detail-content {
  font-size: 16px;
  line-height: 1.85;
  color: var(--text-color-primary);
  overflow-wrap: break-word;
}

.entry-detail-content :deep(h1),
.entry-detail-content :deep(h2),
.entry-detail-content :deep(h3),
.entry-detail-content :deep(h4),
.entry-detail-content :deep(h5),
.entry-detail-content :deep(h6) {
  font-family: var(--font-family-serif);
  margin-top: 1.5em;
  margin-bottom: 0.6em;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.entry-detail-content :deep(p) {
  margin: 0.8em 0;
}

.entry-detail-content :deep(ul),
.entry-detail-content :deep(ol) {
  margin: 0.8em 0;
  padding-left: 1.8em;
}

.entry-detail-content :deep(li) {
  margin: 0.4em 0;
}

.entry-detail-content :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  padding: 2px 6px;
  background: var(--bg-color-hover);
  border-radius: var(--radius-sm);
}

.entry-detail-content :deep(pre) {
  background: var(--bg-color-hover);
  padding: 12px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 1em 0;
}

.entry-detail-content :deep(blockquote) {
  margin: 1em 0;
  padding-left: 16px;
  border-left: 3px solid var(--border-color);
  color: var(--text-color-secondary);
}

.entry-detail-meta {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.entry-detail-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.entry-detail-timestamps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-color-tertiary);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .kb-browser {
    grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1fr);
  }
  .kb-category-rail {
    grid-row: 1;
    grid-column: 1 / -1;
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .kb-entries {
    grid-row: 2;
    grid-column: 1;
  }
  .entry-detail-panel {
    grid-row: 2;
    grid-column: 2;
    position: static;
    max-height: none;
  }
}

@media (max-width: 700px) {
  .kb-browser {
    grid-template-columns: 1fr;
  }
  .kb-entries, .entry-detail-panel { grid-row: auto; grid-column: 1; }
  .entry-list {
    max-height: 320px;
    overflow-y: auto;
  }
}
.kb-summary-toolbar p { margin: 0; color: var(--text-color-tertiary); font-size: 12px; line-height: 1.6; }
.kb-summary-content { margin: 14px 0 0; white-space: pre-wrap; color: var(--text-color-secondary); line-height: 1.7; font-size: 13px; }
.kb-summary-time { display: block; margin-top: 10px; color: var(--text-color-disabled); font-size: 11px; }

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
