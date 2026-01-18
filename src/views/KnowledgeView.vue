<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, Upload, Search, Delete, Document, Refresh,
  FolderOpened, DocumentCopy
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'
import type { KnowledgeFile, KnowledgeSearchResult } from '@/types'
import * as knowledgeApi from '@/services/api/knowledgeApi'

const route = useRoute()
const router = useRouter()
const bookId = route.params.bookId as string

// 状态
const loading = ref(false)
const files = ref<KnowledgeFile[]>([])
const stats = ref<{
  totalCount: number
  totalSize: number
  indexedCount: number
  typeCount: Record<string, number>
} | null>(null)
const selectedFile = ref<KnowledgeFile | null>(null)
const fileContent = ref<string>('')
const searchQuery = ref('')
const searchResults = ref<KnowledgeSearchResult[]>([])
const searching = ref(false)
const indexing = ref(false)
const uploading = ref(false)

// 计算属性
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const fileTypeIcon = (type: string): string => {
  const icons: Record<string, string> = {
    txt: '📄',
    md: '📝',
    pdf: '📕',
    docx: '📘',
    epub: '📗'
  }
  return icons[type] || '📄'
}

// 方法
async function loadData() {
  loading.value = true
  try {
    const [fileList, fileStats] = await Promise.all([
      knowledgeApi.getKnowledgeFiles(bookId),
      knowledgeApi.getKnowledgeFileStats(bookId)
    ])
    files.value = fileList
    stats.value = fileStats
  } catch (e) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

function handleBack() {
  router.back()
}

async function handleUpload(uploadFile: UploadFile) {
  if (!uploadFile.raw) return

  uploading.value = true
  try {
    await knowledgeApi.uploadKnowledgeFile(uploadFile.raw, bookId)
    ElMessage.success('上传成功')
    await loadData()
  } catch (e) {
    ElMessage.error('上传失败')
  } finally {
    uploading.value = false
  }
}

async function handleSelectFile(file: KnowledgeFile) {
  selectedFile.value = file
  fileContent.value = ''

  try {
    const content = await knowledgeApi.getKnowledgeFileContent(file.id)
    fileContent.value = content
  } catch (e) {
    fileContent.value = '[无法读取文件内容]'
  }
}

async function handleDeleteFile(file: KnowledgeFile) {
  try {
    await ElMessageBox.confirm(
      `确定要删除文件"${file.originalName}"吗？此操作不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await knowledgeApi.deleteKnowledgeFile(file.id)
    if (selectedFile.value?.id === file.id) {
      selectedFile.value = null
      fileContent.value = ''
    }
    ElMessage.success('删除成功')
    await loadData()
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

async function handleIndexFile(file: KnowledgeFile) {
  indexing.value = true
  try {
    const chunkCount = await knowledgeApi.indexKnowledgeFile(file.id)
    ElMessage.success(`索引完成，共 ${chunkCount} 个文本块`)
    await loadData()
  } catch (e) {
    ElMessage.error('索引失败')
  } finally {
    indexing.value = false
  }
}

async function handleSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }

  searching.value = true
  try {
    searchResults.value = await knowledgeApi.searchKnowledge(bookId, searchQuery.value, 10)
  } catch (e) {
    ElMessage.error('搜索失败')
  } finally {
    searching.value = false
  }
}

async function handleIndexAll() {
  indexing.value = true
  let successCount = 0
  let failCount = 0

  for (const file of files.value) {
    if (!file.isIndexed) {
      try {
        await knowledgeApi.indexKnowledgeFile(file.id)
        successCount++
      } catch {
        failCount++
      }
    }
  }

  indexing.value = false
  await loadData()
  ElMessage.success(`索引完成：成功 ${successCount} 个，失败 ${failCount} 个`)
}

// 监听
watch(() => route.params.bookId, () => {
  loadData()
}, { immediate: true })

// 生命周期
onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="knowledge-view">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
        <h1>知识库</h1>
      </div>
      <div class="header-right">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".txt,.md,.pdf,.docx,.epub"
          :on-change="handleUpload"
        >
          <el-button type="primary" :icon="Upload" :loading="uploading">
            上传文件
          </el-button>
        </el-upload>
        <el-button :icon="Refresh" :loading="indexing" @click="handleIndexAll">
          索引全部
        </el-button>
      </div>
    </div>

    <!-- 统计栏 -->
    <div v-if="stats" class="stats-bar">
      <el-tag>文件: {{ stats.totalCount }}</el-tag>
      <el-tag type="success">已索引: {{ stats.indexedCount }}</el-tag>
      <el-tag type="info">总大小: {{ formatFileSize(stats.totalSize) }}</el-tag>
      <el-tag v-for="(count, type) in stats.typeCount" :key="type" type="warning">
        {{ type.toUpperCase() }}: {{ count }}
      </el-tag>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input
        v-model="searchQuery"
        placeholder="搜索知识库内容..."
        :prefix-icon="Search"
        clearable
        @keyup.enter="handleSearch"
        style="width: 400px"
      />
      <el-button type="primary" :loading="searching" @click="handleSearch">
        搜索
      </el-button>
    </div>

    <!-- 内容区 -->
    <div v-loading="loading" class="page-content">
      <div class="content-layout">
        <!-- 左侧文件列表 -->
        <div class="file-list">
          <div v-if="files.length === 0" class="empty-state">
            <el-empty :icon="FolderOpened" description="暂无文件，点击上方按钮上传" />
          </div>
          <div v-else class="file-items">
            <div
              v-for="file in files"
              :key="file.id"
              class="file-item"
              :class="{ 'is-selected': selectedFile?.id === file.id }"
              @click="handleSelectFile(file)"
            >
              <span class="file-icon">{{ fileTypeIcon(file.fileType) }}</span>
              <div class="file-info">
                <div class="file-name">{{ file.originalName }}</div>
                <div class="file-meta">
                  <span>{{ formatFileSize(file.fileSize) }}</span>
                  <el-tag v-if="file.isIndexed" type="success" size="small">已索引</el-tag>
                  <el-tag v-else type="info" size="small">未索引</el-tag>
                </div>
              </div>
              <div class="file-actions">
                <el-button
                  v-if="!file.isIndexed"
                  size="small"
                  :icon="DocumentCopy"
                  circle
                  :loading="indexing"
                  @click.stop="handleIndexFile(file)"
                />
                <el-button
                  size="small"
                  type="danger"
                  :icon="Delete"
                  circle
                  @click.stop="handleDeleteFile(file)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧内容/搜索结果 -->
        <div class="content-panel">
          <!-- 搜索结果 -->
          <template v-if="searchResults.length > 0">
            <div class="panel-header">
              <h3>搜索结果 ({{ searchResults.length }})</h3>
              <el-button size="small" @click="searchResults = []">清除结果</el-button>
            </div>
            <div class="search-results">
              <div
                v-for="(result, index) in searchResults"
                :key="index"
                class="search-result-item"
              >
                <div class="result-header">
                  <span class="result-filename">{{ result.filename }}</span>
                  <el-tag size="small">相关度: {{ result.score.toFixed(2) }}</el-tag>
                </div>
                <div class="result-content">{{ result.content }}</div>
              </div>
            </div>
          </template>

          <!-- 文件内容 -->
          <template v-else-if="selectedFile">
            <div class="panel-header">
              <h3>{{ selectedFile.originalName }}</h3>
              <div class="file-tags">
                <el-tag
                  v-for="tag in selectedFile.tags"
                  :key="tag"
                  size="small"
                  closable
                  @close="() => knowledgeApi.removeKnowledgeFileTag(selectedFile!.id, tag).then(loadData)"
                >
                  {{ tag }}
                </el-tag>
              </div>
            </div>
            <div class="file-content">
              <pre>{{ fileContent }}</pre>
            </div>
          </template>

          <!-- 空状态 -->
          <template v-else>
            <div class="empty-panel">
              <el-empty :icon="Document" description="选择一个文件查看内容，或搜索知识库" />
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.knowledge-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;

    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
  }

  .header-right {
    display: flex;
    gap: 12px;
  }
}

.stats-bar {
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.search-bar {
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.page-content {
  flex: 1;
  overflow: hidden;
}

.content-layout {
  display: flex;
  height: 100%;
}

.file-list {
  width: 350px;
  border-right: 1px solid var(--el-border-color-lighter);
  overflow-y: auto;
}

.content-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-items {
  padding: 12px;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);

    .file-actions {
      opacity: 1;
    }
  }

  &.is-selected {
    background: var(--el-color-primary-light-9);
    border: 1px solid var(--el-color-primary-light-5);
  }

  .file-icon {
    font-size: 24px;
    margin-right: 12px;
  }

  .file-info {
    flex: 1;
    min-width: 0;

    .file-name {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 4px;
    }

    .file-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  .file-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  h3 {
    margin: 0;
    font-size: 16px;
  }

  .file-tags {
    display: flex;
    gap: 4px;
  }
}

.file-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    line-height: 1.6;
  }
}

.search-results {
  flex: 1;
  padding: 16px 24px;
  overflow-y: auto;
}

.search-result-item {
  padding: 16px;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;

  .result-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    .result-filename {
      font-weight: 500;
      color: var(--el-color-primary);
    }
  }

  .result-content {
    font-size: 14px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
  }
}

.empty-state,
.empty-panel {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
</style>
