<template>
  <Teleport v-if="route.meta?.shell === 'v3'" defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">{{ selectedKB?.name || '资料库' }}</span>
  </Teleport>
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
          <span v-if="kb.summary" class="summary-status kb-summary-status" :class="`summary-status-${getBaseSummaryStatus(kb)}`">摘要：{{ summaryStatusLabel(getBaseSummaryStatus(kb)) }}</span>
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
          <n-button size="small" tertiary :loading="summarizingKB" :disabled="baseSummaryBusy" @click="summarizeSelectedKB">整理摘要</n-button>
          <n-button size="small" type="primary" @click="openAddEntry">
            <template #icon><span style="font-size:16px">+</span></template>
            添加条目
          </n-button>
        </div>
      </div>

      <section class="kb-summary-panel paper-panel">
        <div class="summary-budget">
          <label>本次请求上限<n-input-number v-model:value="summaryBudget.requests" :min="1" :max="4096" :precision="0" :disabled="anySummaryRunning" aria-label="摘要请求上限" /></label>
          <label>本次 token 额度<n-input-number v-model:value="summaryBudget.tokens" :min="1" :max="50000000" :precision="0" :disabled="anySummaryRunning" aria-label="摘要 token 额度" /></label>
          <span>生成前检查完整处理额度；接口未报告用量时保守计入。导入批次共享此额度。</span>
          <n-button v-if="importSummaryRunning" size="small" @click="cancelSummary('import')">取消导入摘要</n-button>
        </div>
        <div class="kb-summary-toolbar">
          <div>
            <h4>知识库摘要</h4>
            <p>摘要在书架层面维护，挂载到小说后 AI 优先读取摘要，再按问题读取相关条目。</p>
          </div>
          <n-select v-model:value="summaryLevel" :options="summaryLevelOptions" size="small" style="width:120px;" :disabled="baseSummaryBusy" />
        </div>
        <div class="summary-status-row">
          <span class="summary-status" :class="`summary-status-${selectedKB ? getBaseSummaryStatus(selectedKB) : 'empty'}`">
            摘要状态：{{ selectedKB ? summaryStatusLabel(getBaseSummaryStatus(selectedKB)) : '空' }}
          </span>
          <span class="summary-status-hint">{{ selectedKB ? summaryStatusHint(getBaseSummaryStatus(selectedKB)) : '' }}</span>
        </div>
        <n-input
          v-model:value="baseSummaryDraft"
          type="textarea"
          :rows="5"
          aria-label="知识库摘要"
          placeholder="可手工填写摘要；保存后会以作者核对结果沿用。"
          :disabled="baseSummaryBusy"
          @focus="beginBaseSummaryEdit"
          @update:value="markBaseSummaryDirty"
        />
        <p class="summary-scope-hint">{{ basePlanHint }}</p>
        <p v-if="selectedKB?.summarySource?.coverage" class="summary-coverage">{{ coverageText(selectedKB.summarySource) }}</p>
        <div v-if="summaryProgress[baseJobKey]" class="summary-run-status" role="status">
          {{ progressText(summaryProgress[baseJobKey]) }}
          <n-button v-if="summarizingKB && ['extract', 'merge'].includes(summaryProgress[baseJobKey].phase)" size="small" @click="cancelSummary(baseJobKey)">取消整库整理</n-button>
        </div>
        <p v-if="baseSummaryError" class="summary-error" role="alert">
          {{ baseSummaryError }}
          <button type="button" @click="reloadBaseSummaryDraft">重新载入当前来源</button>
          <button v-if="baseSummaryErrorKind === 'ai'" type="button" @click="summarizeSelectedKB">重新整理</button>
        </p>
        <div class="summary-actions">
          <n-button size="small" :disabled="baseSummaryBusy || !baseSummaryDraft.trim()" @click="saveBaseSummaryDraft">
            {{ selectedKB?.summary ? '作者核对并沿用' : '保存并核对' }}
          </n-button>
        </div>
        <span v-if="selectedKB?.summaryUpdatedAt" class="kb-summary-time">上次整理：{{ formatDateTime(selectedKB.summaryUpdatedAt) }}</span>
        <div v-if="selectedKB?.summaryHistory?.length" class="summary-history">
          <strong>摘要历史（最近 {{ selectedKB.summaryHistory.length }} 条）</strong>
          <article v-for="history in selectedKB.summaryHistory" :key="history.id" class="summary-history-item">
            <div>{{ formatDateTime(history.savedAt) }} · {{ history.summarySource?.origin === 'ai' ? 'AI' : history.summarySource?.origin === 'author' ? '作者' : '未记录来源' }}{{ history.summaryLevel ? ` · ${summaryLevelLabel(history.summaryLevel)}` : '' }}</div>
            <p>{{ history.summary }}</p>
          </article>
        </div>
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
                <span class="summary-status entry-summary-status" :class="`summary-status-${getEntrySummaryStatus(selectedKBId, entry)}`">摘要：{{ summaryStatusLabel(getEntrySummaryStatus(selectedKBId, entry)) }}</span>
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
          <section class="entry-summary-editor">
            <div class="entry-summary-heading">
              <h4>条目摘要</h4>
              <span class="summary-status" :class="`summary-status-${getEntrySummaryStatus(selectedKBId, selectedEntry)}`">
                {{ summaryStatusLabel(getEntrySummaryStatus(selectedKBId, selectedEntry)) }}
              </span>
            </div>
            <p class="summary-status-hint">{{ summaryStatusHint(getEntrySummaryStatus(selectedKBId, selectedEntry)) }} 原文始终保留。</p>
            <n-input
              v-model:value="entrySummaryDraft"
              type="textarea"
              :rows="5"
              aria-label="条目摘要"
              placeholder="可手工填写摘要；保存后会以作者核对结果沿用。"
              :disabled="entrySummaryBusy(selectedEntry.id)"
              @focus="beginEntrySummaryEdit(selectedEntry.id)"
              @update:value="markEntrySummaryDirty"
            />
            <p class="summary-scope-hint">{{ entryPlanHint }}</p>
            <p v-if="selectedEntry.summarySource?.coverage" class="summary-coverage">{{ coverageText(selectedEntry.summarySource) }}</p>
            <div v-if="summaryProgress[entryJobKey]" class="summary-run-status" role="status">
              {{ progressText(summaryProgress[entryJobKey]) }}
              <n-button v-if="summarizingEntryIds.has(selectedEntry.id) && ['extract', 'merge'].includes(summaryProgress[entryJobKey].phase)" size="small" @click="cancelSummary(entryJobKey)">取消条目整理</n-button>
            </div>
            <p v-if="entrySummaryErrors[entrySummaryErrorKey(selectedKBId, selectedEntry.id)]" class="summary-error" role="alert">
              {{ entrySummaryErrors[entrySummaryErrorKey(selectedKBId, selectedEntry.id)] }}
              <button type="button" @click="reloadEntrySummaryDraft(selectedEntry.id)">重新载入当前来源</button>
              <button v-if="entrySummaryErrorKinds[entrySummaryErrorKey(selectedKBId, selectedEntry.id)] === 'ai'" type="button" @click="retryEntrySummary(selectedEntry.id)">重新整理</button>
            </p>
            <div class="summary-actions">
              <n-button size="small" :disabled="entrySummaryBusy(selectedEntry.id) || !entrySummaryDraft.trim()" @click="saveEntrySummaryDraft(selectedEntry.id)">
                {{ selectedEntry.summary ? '作者核对并沿用' : '保存并核对' }}
              </n-button>
              <n-button size="small" tertiary :loading="entrySummaryBusy(selectedEntry.id)" :disabled="entrySummaryBusy(selectedEntry.id)" @click="retryEntrySummary(selectedEntry.id)">重新整理摘要</n-button>
            </div>
            <div v-if="selectedEntry.summaryHistory?.length" class="summary-history">
              <strong>摘要历史（最近 {{ selectedEntry.summaryHistory.length }} 条）</strong>
              <article v-for="history in selectedEntry.summaryHistory" :key="history.id" class="summary-history-item">
                <div>{{ formatDateTime(history.savedAt) }} · {{ history.summarySource?.origin === 'ai' ? 'AI' : history.summarySource?.origin === 'author' ? '作者' : '未记录来源' }}{{ history.summaryLevel ? ` · ${summaryLevelLabel(history.summaryLevel)}` : '' }}</div>
                <p>{{ history.summary }}</p>
              </article>
            </div>
          </section>
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
    <n-modal
      :show="showEntryModal"
      preset="card"
      :title="editingEntryId ? '编辑条目' : '添加条目'"
      :closable="!entryFormBusy"
      :mask-closable="!entryFormBusy"
      :close-on-esc="!entryFormBusy"
      style="max-width:550px;"
      @update:show="setEntryModalShow"
    >
      <div class="form-group">
        <label>标题</label>
        <n-input v-model:value="entryForm.title" size="small" placeholder="条目标题" :disabled="entryFormBusy" />
        <label>分类</label>
        <n-select v-model:value="entryForm.category" :options="categoryOptions" size="small" :disabled="entryFormBusy" />
        <label>内容</label>
        <n-input v-model:value="entryForm.content" type="textarea" :rows="8" size="small" placeholder="条目内容（支持 Markdown）" :disabled="entryFormBusy" />
        <label>标签（逗号分隔）</label>
        <n-input v-model:value="entryForm.tagsText" size="small" placeholder="如：剑法,武技" :disabled="entryFormBusy" />
      </div>
      <template #action>
        <n-button :disabled="entryFormBusy" @click="setEntryModalShow(false)">取消</n-button>
        <n-button type="primary" :loading="entryFormBusy" :disabled="entryFormBusy || !entryForm.title.trim()" @click="saveEntry">保存</n-button>
      </template>
    </n-modal>

    <KnowledgeImportDialog v-model:show="showImportModal" :kb-id="selectedKBId" @imported="afterImport" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NInputNumber, NSelect, NModal, NPopconfirm, useMessage } from 'naive-ui'
import { useKnowledgeStore, kbCategories, knowledgeSummaryEditVersion, type KBEntry, type KnowledgeBase } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { createKnowledgeSummaryBudget, planKnowledgeSummary, generateKnowledgeSummary, estimateKnowledgeSummaryTokens, DEFAULT_SUMMARY_REQUESTS, DEFAULT_SUMMARY_TOKENS, type KnowledgeSummaryBudget, type KnowledgeSummaryProgress } from '@/services/knowledgeSummary'
import type { KnowledgeSummarySource } from '@/types/knowledge'
import KnowledgeImportDialog from '@/components/KnowledgeImportDialog.vue'
import { renderMd } from '@/utils/markdown'
import {
  baseSourceVersion,
  entrySourceVersion,
  getBaseSummaryStatus,
  getEntrySummaryStatus,
  type KnowledgeSummaryStatus,
} from '@/services/knowledgeSources'

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
const entrySummarySavingIds = ref(new Set<string>())
const baseSummarySaving = ref(false)
const entryFormBusy = ref(false)
const baseSummaryDraft = ref('')
const entrySummaryDraft = ref('')
const entrySummaryErrors = ref<Record<string, string>>({})
const entrySummaryErrorKinds = ref<Record<string, 'save' | 'ai'>>({})
const baseSummaryError = ref('')
const baseSummaryErrorKind = ref<'save' | 'ai' | ''>('')
type SummaryEditBaseline = { targetId: string; sourceVersion: string; summaryVersion: string }
const entrySummaryBaseline = ref<SummaryEditBaseline | null>(null)
const baseSummaryBaseline = ref<SummaryEditBaseline | null>(null)
const entrySummaryDraftDirty = ref(false)
const baseSummaryDraftDirty = ref(false)
const entryEditorSession = ref(0)
const baseEditorSession = ref(0)
const summaryLevel = ref<NonNullable<KnowledgeBase['summaryLevel']>>('standard')
const summaryLevelOptions = [
  { label: '简略', value: 'brief' },
  { label: '标准', value: 'standard' },
  { label: '详细', value: 'detailed' },
]
const baseSummaryBusy = computed(() => summarizingKB.value || baseSummarySaving.value)
const summaryBudget = ref({ requests: DEFAULT_SUMMARY_REQUESTS, tokens: DEFAULT_SUMMARY_TOKENS })
const summaryProgress = ref<Record<string, KnowledgeSummaryProgress>>({})
const summaryControllers = new Map<string, AbortController>()
const importSummaryRunning = ref(false)
const anySummaryRunning = computed(() => summarizingKB.value || summarizingEntryIds.value.size > 0 || importSummaryRunning.value)
const entryJobKey = computed(() => 'entry:' + entrySummaryErrorKey(selectedKBId.value, selectedEntryId.value))
const baseJobKey = computed(() => 'base:' + selectedKBId.value)
function cancelSummary(key: string) { summaryControllers.get(key)?.abort(new Error('作者已取消摘要整理')) }
onBeforeUnmount(() => { for (const controller of summaryControllers.values()) controller.abort(new Error('已离开资料页，摘要整理停止')) })

function planHint(entryId?: string) {
  const kb = selectedKB.value
  if (!kb) return ''
  try {
    const plan = planKnowledgeSummary(kb, entryId, entryId ? 'standard' : summaryLevel.value)
    const chars = plan.chunks.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0)
    const model = configStore.getModelForTask('review')
    const tokens = model ? estimateKnowledgeSummaryTokens(plan, model, configStore.getSkillPrompt('analysis')) : undefined
    return '全文分批读取：' + chars + ' 字，' + plan.chunks.length + ' 段，预计 ' + plan.plannedRequests + ' 次请求'
      + (tokens === undefined ? '；配置模型后可估算 token 额度。' : '，保守额度 ' + tokens.toLocaleString() + ' token。')
      + ' 摘要仍可能遗漏细节，原文保留供检索核对。'
  } catch (error) { return error instanceof Error ? error.message : '资料暂不能整理' }
}
const basePlanHint = computed(() => planHint())
const entryPlanHint = computed(() => selectedEntry.value ? planHint(selectedEntry.value.id) : '')
function progressText(progress: KnowledgeSummaryProgress) {
  const phase = { extract: '分段提取', merge: '逐层合并', complete: '处理完成', failed: '已停止', cancelled: '已取消' }[progress.phase]
  return phase + ' · 已读 ' + progress.completedChunks + '/' + progress.totalChunks + ' 段 · 请求 ' + progress.completedRequests + '/' + progress.plannedRequests
    + ' · ' + (progress.usageEstimated ? '保守计入 ' : '接口报告 ') + (progress.inputTokens + progress.outputTokens).toLocaleString() + ' token'
}
function coverageText(source?: KnowledgeSummarySource) {
  const coverage = source?.coverage
  return coverage ? '上次生成完整读取 ' + coverage.sources.length + ' 个条目、' + coverage.leafCount + ' 段原文，使用 ' + coverage.requestCount + ' 次请求；'
    + (coverage.usageEstimated ? '保守计入 ' : '接口报告 ') + (coverage.inputTokens + coverage.outputTokens).toLocaleString() + ' token。' : ''
}

function summaryStatusLabel(status: KnowledgeSummaryStatus) {
  return ({ empty: '未填写', current: '当前', unverified: '待核对', stale: '来源已失效' } satisfies Record<KnowledgeSummaryStatus, string>)[status]
}

function entrySummaryErrorKey(kbId: string, entryId: string) {
  return `${kbId}:${entryId}`
}

function summaryStatusHint(status: KnowledgeSummaryStatus) {
  return ({
    empty: '还没有摘要，可以手工填写或整理。',
    current: '摘要对应当前资料，可继续沿用。',
    unverified: '摘要存在，但还没有可验证的来源记录；作者核对后才会用于写作。',
    stale: '资料已经修改，旧摘要保留供参考；作者核对或重新整理后才会重新用于写作。',
  } satisfies Record<KnowledgeSummaryStatus, string>)[status]
}

function summaryLevelLabel(level: NonNullable<KnowledgeBase['summaryLevel']>) {
  return summaryLevelOptions.find(option => option.value === level)?.label || level
}

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

watch(() => [selectedKBId.value, selectedEntry.value?.id], () => {
  entryEditorSession.value++
  const entry = selectedEntry.value
  entrySummaryDraft.value = entry?.summary || ''
  entrySummaryDraftDirty.value = false
  entrySummaryBaseline.value = entry ? {
    targetId: entry.id,
    sourceVersion: entrySourceVersion(selectedKBId.value, entry),
    summaryVersion: knowledgeSummaryEditVersion(entry),
  } : null
}, { immediate: true })

watch(() => selectedKBId.value, () => {
  baseEditorSession.value++
  const kb = selectedKB.value
  baseSummaryDraft.value = kb?.summary || ''
  baseSummaryDraftDirty.value = false
  baseSummaryBaseline.value = kb ? {
    targetId: kb.id,
    sourceVersion: baseSourceVersion(kb),
    summaryVersion: knowledgeSummaryEditVersion(kb),
  } : null
}, { immediate: true })

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
  const kb = kbStore.getKB(id)
  summaryLevel.value = kb?.summaryLevel || 'standard'
  baseSummaryDraft.value = kb?.summary || ''
  baseSummaryError.value = ''
  baseSummaryErrorKind.value = ''
}

function beginEntrySummaryEdit(entryId: string) {
  const entry = kbStore.getKB(selectedKBId.value)?.entries.find(item => item.id === entryId)
  if (!entry) return
  const draftShowsCurrentSummary = !entrySummaryDraftDirty.value
    && entrySummaryDraft.value.trim() === (entry.summary || '').trim()
  if (draftShowsCurrentSummary || !entrySummaryBaseline.value || entrySummaryBaseline.value.targetId !== entry.id) {
    entrySummaryBaseline.value = {
      targetId: entry.id,
      sourceVersion: entrySourceVersion(selectedKBId.value, entry),
      summaryVersion: knowledgeSummaryEditVersion(entry),
    }
  }
}

function markEntrySummaryDirty() {
  entrySummaryDraftDirty.value = true
}

function beginBaseSummaryEdit() {
  const kb = selectedKB.value
  if (!kb) return
  const draftShowsCurrentSummary = !baseSummaryDraftDirty.value
    && baseSummaryDraft.value.trim() === (kb.summary || '').trim()
  if (draftShowsCurrentSummary || !baseSummaryBaseline.value || baseSummaryBaseline.value.targetId !== kb.id) {
    baseSummaryBaseline.value = {
      targetId: kb.id,
      sourceVersion: baseSourceVersion(kb),
      summaryVersion: knowledgeSummaryEditVersion(kb),
    }
  }
}

function markBaseSummaryDirty() {
  baseSummaryDraftDirty.value = true
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

async function saveEntry() {
  if (entryFormBusy.value) return
  const kbId = selectedKBId.value
  const data = {
    title: entryForm.value.title.trim(),
    category: entryForm.value.category,
    content: entryForm.value.content,
    tags: entryForm.value.tagsText.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
  }
  entryFormBusy.value = true
  let saved = false
  try {
    let entryId = editingEntryId.value
    if (entryId) {
      kbStore.updateEntry(kbId, entryId, data)
    } else {
      const newEntry = kbStore.addEntry(kbId, { ...data, summary: '' })
      entryId = newEntry?.id || ''
      editingEntryId.value = entryId
    }
    if (!entryId) throw new Error('资料已不存在')
    await kbStore.flushPendingSaves()
    msg.success('资料已保存；摘要可由作者核对或点击重新整理')
    saved = Boolean(entryId)
  } catch (error) {
    msg.error((error instanceof Error ? error.message : '资料保存失败') + '，表单已保留')
  } finally {
    entryFormBusy.value = false
  }
  if (saved) {
    setEntryModalShow(false)
  }
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
  msg.success('已导入 ' + result.entryIds.length + ' 个条目')
  if (!result.summarize) return
  if (importSummaryRunning.value) { msg.warning('已有导入摘要任务，请稍后手动整理新资料'); return }
  const controller = new AbortController()
  summaryControllers.set('import', controller)
  importSummaryRunning.value = true
  let completed = 0
  try {
    const budget = createKnowledgeSummaryBudget(summaryBudget.value.requests, summaryBudget.value.tokens)
    for (const id of result.entryIds) {
      controller.signal.throwIfAborted()
      const entry = kbStore.getKB(result.kbId)?.entries.find(item => item.id === id)
      if (!entry || !entry.content.trim()) continue
      if (!await autoSummarizeEntry(result.kbId, id, true, { budget, controller })) {
        msg.warning('本批摘要未全部完成，已保存 ' + completed + ' 个条目；剩余资料可稍后继续整理')
        return
      }
      completed++
    }
    msg.success('本批摘要已保存 ' + completed + ' 个条目')
  } catch (error) {
    msg.warning((error instanceof Error ? error.message : '批次已停止') + '；已保存 ' + completed + ' 个条目')
  } finally {
    importSummaryRunning.value = false
    summaryControllers.delete('import')
  }
}

// AI 自动总结知识库条目
async function autoSummarizeEntry(kbId: string, entryId: string, notifyUnavailable = false, batch?: { budget: KnowledgeSummaryBudget; controller: AbortController }): Promise<boolean> {
  const model = configStore.getModelForTask('review')
  const sourceKB = kbStore.getKB(kbId)
  const sourceEntry = sourceKB?.entries.find(entry => entry.id === entryId)
  if (!sourceEntry || !model || !sourceEntry.content.trim()) {
    if (notifyUnavailable && !model) {
      const message = '未配置可用模型，可以手工填写并核对摘要。'
      const errorKey = entrySummaryErrorKey(kbId, entryId)
      entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: message }
      entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'ai' }
      msg.warning(message)
    }
    return false
  }
  if (summarizingEntryIds.value.has(entryId)) return false
  // Capture every request input before the first await. Later edits must make
  // the versioned save reject this result instead of being overwritten.
  const sourceSnapshot = JSON.parse(JSON.stringify(sourceEntry)) as KBEntry
  const jobKey = 'entry:' + entrySummaryErrorKey(kbId, entryId)
  const controller = batch?.controller || new AbortController()
  summaryControllers.set(jobKey, controller)
  const expectedSourceVersion = entrySourceVersion(kbId, sourceSnapshot)
  const expectedSummaryVersion = knowledgeSummaryEditVersion(sourceSnapshot)
  const editorSession = selectedKBId.value === kbId && selectedEntryId.value === entryId ? entryEditorSession.value : -1
  summarizingEntryIds.value = new Set(summarizingEntryIds.value).add(entryId)
  const errorKey = entrySummaryErrorKey(kbId, entryId)
  entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: '' }
  try {
    const plan = planKnowledgeSummary(sourceKB!, entryId)
    const result = await generateKnowledgeSummary(plan, {
      model, budget: batch?.budget || createKnowledgeSummaryBudget(summaryBudget.value.requests, summaryBudget.value.tokens),
      instructions: configStore.getSkillPrompt('analysis'), signal: controller.signal,
      isCurrent: () => {
        const current = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
        return Boolean(current && entrySourceVersion(kbId, current) === expectedSourceVersion && knowledgeSummaryEditVersion(current) === expectedSummaryVersion)
      },
      onProgress: progress => { summaryProgress.value = { ...summaryProgress.value, [jobKey]: progress } },
    })
    controller.signal.throwIfAborted()
    await kbStore.saveEntrySummary(kbId, entryId, expectedSourceVersion, expectedSummaryVersion, result.summary, 'ai', result.coverage)
    const committed = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
    if (editorSession >= 0 && selectedKBId.value === kbId && selectedEntryId.value === entryId
      && entryEditorSession.value === editorSession && !entrySummaryDraftDirty.value && committed) {
      entrySummaryDraft.value = committed.summary
      entrySummaryBaseline.value = {
        targetId: committed.id,
        sourceVersion: entrySourceVersion(kbId, committed),
        summaryVersion: knowledgeSummaryEditVersion(committed),
      }
    }
    msg.success('条目摘要已更新')
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : '摘要整理失败'
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '资料或摘要已在整理期间变化，迟到的 AI 结果已拒绝，请重新核对。'
      : `${message}，可点击“重新整理摘要”重试。`
    entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: visibleMessage }
    entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'ai' }
    if (summaryProgress.value[jobKey]) summaryProgress.value[jobKey].phase = controller.signal.aborted ? 'cancelled' : 'failed'
    msg.error(visibleMessage)
    return false
  } finally {
    summaryControllers.delete(jobKey)
    const next = new Set(summarizingEntryIds.value)
    next.delete(entryId)
    summarizingEntryIds.value = next
  }
}

async function summarizeSelectedKB() {
  const kb = selectedKB.value
  const model = configStore.getModelForTask('review')
  if (!kb || summarizingKB.value) return
  if (!model) {
    baseSummaryError.value = '未配置可用模型，可以手工填写并核对摘要。'
    baseSummaryErrorKind.value = 'ai'
    msg.warning(baseSummaryError.value)
    return
  }
  if (!kb.entries.length) {
    msg.warning('请先添加或导入资料')
    return
  }
  summarizingKB.value = true
  baseSummaryError.value = ''
  // Keep an independent request snapshot. The selected KB, level, source
  // text, and version guards must not be reconstructed after AI awaits.
  const sourceSnapshot = JSON.parse(JSON.stringify(kb)) as KnowledgeBase
  const requestKbId = sourceSnapshot.id
  const requestLevel = summaryLevel.value
  const expectedSourceVersion = baseSourceVersion(sourceSnapshot)
  const expectedSummaryVersion = knowledgeSummaryEditVersion(sourceSnapshot)
  const editorSession = baseEditorSession.value
  const jobKey = 'base:' + requestKbId
  const controller = new AbortController()
  summaryControllers.set(jobKey, controller)
  try {
    const plan = planKnowledgeSummary(sourceSnapshot, undefined, requestLevel)
    const result = await generateKnowledgeSummary(plan, {
      model, budget: createKnowledgeSummaryBudget(summaryBudget.value.requests, summaryBudget.value.tokens),
      instructions: configStore.getSkillPrompt('analysis'), signal: controller.signal,
      isCurrent: () => {
        const current = kbStore.getKB(requestKbId)
        return Boolean(current && baseSourceVersion(current) === expectedSourceVersion && knowledgeSummaryEditVersion(current) === expectedSummaryVersion)
      },
      onProgress: progress => { summaryProgress.value = { ...summaryProgress.value, [jobKey]: progress } },
    })
    controller.signal.throwIfAborted()
    await kbStore.saveBaseSummary(requestKbId, expectedSourceVersion, expectedSummaryVersion, result.summary, requestLevel, 'ai', result.coverage)
    const committed = kbStore.getKB(requestKbId)
    if (selectedKBId.value === requestKbId && baseEditorSession.value === editorSession
      && !baseSummaryDraftDirty.value && committed) {
      baseSummaryDraft.value = committed.summary || result.summary
      baseSummaryBaseline.value = {
        targetId: committed.id,
        sourceVersion: baseSourceVersion(committed),
        summaryVersion: knowledgeSummaryEditVersion(committed),
      }
    }
    msg.success('知识库摘要已更新')
  } catch (error) {
    const message = error instanceof Error ? error.message : '摘要整理失败'
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '知识库资料或摘要已在整理期间变化，迟到的 AI 结果已拒绝，请重新核对。'
      : `${message}，可点击“重新整理”重试。`
    if (summaryProgress.value[jobKey]) summaryProgress.value[jobKey].phase = controller.signal.aborted ? 'cancelled' : 'failed'
    if (selectedKBId.value === requestKbId && baseEditorSession.value === editorSession) {
      baseSummaryError.value = visibleMessage
      baseSummaryErrorKind.value = 'ai'
    }
    msg.error(visibleMessage)
  } finally {
    summaryControllers.delete(jobKey)
    summarizingKB.value = false
  }
}

function entrySummaryBusy(entryId: string) {
  return summarizingEntryIds.value.has(entryId) || entrySummarySavingIds.value.has(entryId)
}

async function saveEntrySummaryDraft(entryId: string) {
  const kbId = selectedKBId.value
  const session = entryEditorSession.value
  const entry = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
  if (!entry) return
  const summary = entrySummaryDraft.value.trim()
  if (!summary) {
    msg.warning('摘要不能为空')
    return
  }
  const draftShowsCurrentSummary = !entrySummaryDraftDirty.value
    && entrySummaryDraft.value.trim() === (entry.summary || '').trim()
  const baseline = draftShowsCurrentSummary || entrySummaryBaseline.value?.targetId !== entry.id
    ? {
        targetId: entry.id,
        sourceVersion: entrySourceVersion(kbId, entry),
        summaryVersion: knowledgeSummaryEditVersion(entry),
      }
    : entrySummaryBaseline.value
  entrySummaryBaseline.value = baseline
  entrySummarySavingIds.value = new Set(entrySummarySavingIds.value).add(entryId)
  const errorKey = entrySummaryErrorKey(kbId, entryId)
  try {
    await kbStore.saveEntrySummary(kbId, entryId, baseline.sourceVersion, baseline.summaryVersion, summary, 'author')
    const committed = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
    if (selectedKBId.value === kbId && selectedEntryId.value === entryId && entryEditorSession.value === session) {
      entrySummaryDraft.value = committed?.summary || summary
      entrySummaryDraftDirty.value = false
      if (committed) {
        entrySummaryBaseline.value = {
          targetId: committed.id,
          sourceVersion: entrySourceVersion(kbId, committed),
          summaryVersion: knowledgeSummaryEditVersion(committed),
        }
      }
    }
    entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: '' }
    entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'save' }
    msg.success('条目摘要已保存并核对')
  } catch (error) {
    const message = error instanceof Error ? error.message : '摘要保存失败'
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '资料或摘要已发生变化，摘要未保存，请重新核对。'
      : `${message}，表单内容已保留。`
    entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: visibleMessage }
    entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'save' }
    msg.error(visibleMessage)
  } finally {
    const next = new Set(entrySummarySavingIds.value)
    next.delete(entryId)
    entrySummarySavingIds.value = next
  }
}

async function saveBaseSummaryDraft() {
  const kb = selectedKB.value
  const kbId = kb?.id || ''
  const session = baseEditorSession.value
  const summary = baseSummaryDraft.value.trim()
  if (!kb || !summary) {
    msg.warning('摘要不能为空')
    return
  }
  const draftShowsCurrentSummary = !baseSummaryDraftDirty.value
    && baseSummaryDraft.value.trim() === (kb.summary || '').trim()
  const baseline = draftShowsCurrentSummary || baseSummaryBaseline.value?.targetId !== kb.id
    ? {
        targetId: kb.id,
        sourceVersion: baseSourceVersion(kb),
        summaryVersion: knowledgeSummaryEditVersion(kb),
      }
    : baseSummaryBaseline.value
  baseSummaryBaseline.value = baseline
  const level = summaryLevel.value
  baseSummarySaving.value = true
  try {
    await kbStore.saveBaseSummary(kbId, baseline.sourceVersion, baseline.summaryVersion, summary, level, 'author')
    const committed = kbStore.getKB(kbId)
    if (selectedKBId.value === kbId && baseEditorSession.value === session) {
      baseSummaryDraft.value = committed?.summary || summary
      baseSummaryDraftDirty.value = false
      if (committed) {
        baseSummaryBaseline.value = {
          targetId: committed.id,
          sourceVersion: baseSourceVersion(committed),
          summaryVersion: knowledgeSummaryEditVersion(committed),
        }
      }
    }
    if (selectedKBId.value === kbId && baseEditorSession.value === session) {
      baseSummaryError.value = ''
      baseSummaryErrorKind.value = 'save'
    }
    msg.success('知识库摘要已保存并核对')
  } catch (error) {
    const message = error instanceof Error ? error.message : '摘要保存失败'
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '知识库资料或摘要已发生变化，摘要未保存，请重新核对。'
      : `${message}，表单内容已保留。`
    if (selectedKBId.value === kbId && baseEditorSession.value === session) {
      baseSummaryError.value = visibleMessage
      baseSummaryErrorKind.value = 'save'
    }
    msg.error(visibleMessage)
  } finally {
    baseSummarySaving.value = false
  }
}

function reloadEntrySummaryDraft(entryId: string) {
  const entry = kbStore.getKB(selectedKBId.value)?.entries.find(item => item.id === entryId)
  if (!entry) return
  entrySummaryDraft.value = entry.summary || ''
  entrySummaryDraftDirty.value = false
  entrySummaryBaseline.value = {
    targetId: entry.id,
    sourceVersion: entrySourceVersion(selectedKBId.value, entry),
    summaryVersion: knowledgeSummaryEditVersion(entry),
  }
  const errorKey = entrySummaryErrorKey(selectedKBId.value, entryId)
  entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: '' }
  entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'save' }
}

function reloadBaseSummaryDraft() {
  const kb = selectedKB.value
  if (!kb) return
  baseSummaryDraft.value = kb.summary || ''
  baseSummaryDraftDirty.value = false
  baseSummaryBaseline.value = {
    targetId: kb.id,
    sourceVersion: baseSourceVersion(kb),
    summaryVersion: knowledgeSummaryEditVersion(kb),
  }
  baseSummaryError.value = ''
  baseSummaryErrorKind.value = ''
}

function retryEntrySummary(entryId: string) {
  void autoSummarizeEntry(selectedKBId.value, entryId, true)
}

function setEntryModalShow(show: boolean) {
  if (!show && entryFormBusy.value) return
  showEntryModal.value = show
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
.summary-budget { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 20px; }
.summary-budget label { display: grid; gap: 6px; width: 180px; font-size: 12px; }
.summary-budget > span { flex-basis: 100%; color: var(--text-color-tertiary); font-size: 12px; }
.summary-run-status, .summary-coverage { margin: 10px 0; font-size: 12px; line-height: 1.8; color: var(--text-color-secondary); }
.summary-run-status { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
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
.kb-summary-status { margin-top: 6px; }
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
.entry-summary-status { margin-left: auto; }
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

.summary-status-row,
.entry-summary-heading,
.summary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-status-row { margin: 12px 0 8px; }
.summary-status {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  white-space: nowrap;
}
.summary-status-empty { color: var(--text-color-tertiary); background: var(--bg-color-hover); }
.summary-status-current { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); }
.summary-status-unverified { color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 12%, transparent); }
.summary-status-stale { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 12%, transparent); }
.summary-status-hint,
.summary-scope-hint {
  margin: 6px 0;
  color: var(--text-color-tertiary);
  font-size: 12px;
  line-height: 1.6;
}
.summary-scope-hint { font-size: 11px; }
.summary-error {
  margin: 8px 0;
  color: var(--color-error);
  font-size: 12px;
  line-height: 1.6;
}
.summary-error button {
  margin-left: 6px;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  text-decoration: underline;
  cursor: pointer;
}
.summary-actions { margin-top: 8px; }
.summary-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  color: var(--text-color-secondary);
  font-size: 12px;
}
.summary-history-item {
  padding: 8px 10px;
  background: var(--bg-color-hover);
  border-radius: var(--radius-sm);
}
.summary-history-item > div { color: var(--text-color-tertiary); font-size: 11px; }
.summary-history-item p { margin: 4px 0 0; white-space: pre-wrap; line-height: 1.6; }
.entry-summary-editor {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}
.entry-summary-heading h4 { margin: 0; font-family: var(--font-family-serif); color: var(--text-color-primary); }
.entry-summary-editor :deep(.n-input) { margin-top: 8px; }

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
