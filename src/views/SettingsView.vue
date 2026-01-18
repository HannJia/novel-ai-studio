<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Plus, Search, Edit, Delete, Collection } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useWorldSettingStore } from '@/stores/worldSettingStore'
import type { WorldSetting, WorldSettingCategory } from '@/types'
import { SETTING_CATEGORY_MAP } from '@/types/worldSetting'

const route = useRoute()
const router = useRouter()
const bookId = route.params.bookId as string

// Store
const settingStore = useWorldSettingStore()

// 状态
const searchKeyword = ref('')
const filterCategory = ref<string>('')
const filterTag = ref<string>('')
const dialogVisible = ref(false)
const editMode = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref<string | null>(null)
const selectedSetting = ref<WorldSetting | null>(null)

// 表单数据
const formData = ref({
  name: '',
  category: 'other' as WorldSettingCategory,
  content: '',
  tags: [] as string[]
})

// 表单规则
const formRules: FormRules = {
  name: [
    { required: true, message: '请输入设定名称', trigger: 'blur' }
  ]
}

// 计算属性
const loading = computed(() => settingStore.loading)
const stats = computed(() => settingStore.stats)
const allTags = computed(() => settingStore.allTags)

const filteredSettings = computed(() => {
  let result = settingStore.settings

  if (filterCategory.value) {
    result = result.filter(s => s.category === filterCategory.value)
  }

  if (filterTag.value) {
    result = result.filter(s => s.tags?.includes(filterTag.value))
  }

  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(s =>
      s.name.toLowerCase().includes(keyword) ||
      s.content?.toLowerCase().includes(keyword)
    )
  }

  return result
})

const groupedSettings = computed(() => {
  const groups: Record<string, WorldSetting[]> = {}
  filteredSettings.value.forEach(s => {
    const category = s.category || 'other'
    if (!groups[category]) {
      groups[category] = []
    }
    groups[category].push(s)
  })
  return groups
})

// 方法
async function loadData() {
  if (!bookId) return
  await Promise.all([
    settingStore.fetchSettings(bookId),
    settingStore.fetchStats(bookId),
    settingStore.fetchAllTags(bookId)
  ])
}

function handleBack() {
  router.back()
}

function handleCreate() {
  editMode.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function handleEdit(setting: WorldSetting) {
  editMode.value = true
  editingId.value = setting.id
  formData.value = {
    name: setting.name,
    category: setting.category,
    content: setting.content || '',
    tags: [...(setting.tags || [])]
  }
  dialogVisible.value = true
}

function handleSelect(setting: WorldSetting) {
  selectedSetting.value = setting
}

async function handleDelete(setting: WorldSetting) {
  try {
    await ElMessageBox.confirm(
      `确定要删除设定"${setting.name}"吗？此操作不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await settingStore.deleteSetting(setting.id)
    if (selectedSetting.value?.id === setting.id) {
      selectedSetting.value = null
    }
    await settingStore.fetchStats(bookId)
    ElMessage.success('删除成功')
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

async function handleSubmit() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
    submitting.value = true

    if (editMode.value && editingId.value) {
      await settingStore.updateSetting(editingId.value, {
        name: formData.value.name,
        category: formData.value.category,
        content: formData.value.content,
        tags: formData.value.tags
      })
      ElMessage.success('保存成功')
    } else {
      await settingStore.createSetting({
        bookId: bookId,
        name: formData.value.name,
        category: formData.value.category,
        content: formData.value.content,
        tags: formData.value.tags
      })
      ElMessage.success('创建成功')
    }

    await settingStore.fetchStats(bookId)
    await settingStore.fetchAllTags(bookId)
    dialogVisible.value = false
  } catch (e) {
    if (e instanceof Error) {
      ElMessage.error(e.message)
    }
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  formData.value = {
    name: '',
    category: 'other',
    content: '',
    tags: []
  }
}

function getCategoryLabel(category: string): string {
  return SETTING_CATEGORY_MAP[category as WorldSettingCategory] || '其他'
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    power_system: '⚡',
    item: '🔮',
    location: '🏰',
    organization: '🏛️',
    other: '📝'
  }
  return icons[category] || '📝'
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
  <div class="settings-view">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
        <h1>设定百科</h1>
      </div>
      <div class="header-right">
        <el-button type="primary" :icon="Plus" @click="handleCreate">
          新建设定
        </el-button>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索设定..."
        :prefix-icon="Search"
        clearable
        style="width: 200px"
      />
      <el-select
        v-model="filterCategory"
        placeholder="分类筛选"
        clearable
        style="width: 140px"
      >
        <el-option label="力量体系" value="power_system" />
        <el-option label="物品道具" value="item" />
        <el-option label="地点场景" value="location" />
        <el-option label="组织势力" value="organization" />
        <el-option label="其他" value="other" />
      </el-select>
      <el-select
        v-model="filterTag"
        placeholder="标签筛选"
        clearable
        style="width: 140px"
      >
        <el-option v-for="tag in allTags" :key="tag" :label="tag" :value="tag" />
      </el-select>
    </div>

    <!-- 统计 -->
    <div v-if="stats" class="stats-bar">
      <el-tag type="danger">力量体系: {{ stats.power_system }}</el-tag>
      <el-tag type="warning">物品道具: {{ stats.item }}</el-tag>
      <el-tag type="success">地点场景: {{ stats.location }}</el-tag>
      <el-tag type="info">组织势力: {{ stats.organization }}</el-tag>
      <el-tag>其他: {{ stats.other }}</el-tag>
      <el-tag effect="dark">总计: {{ stats.total }}</el-tag>
    </div>

    <!-- 内容区 -->
    <div v-loading="loading" class="page-content">
      <div class="content-layout">
        <!-- 左侧列表 -->
        <div class="settings-list">
          <div v-if="filteredSettings.length === 0" class="empty-state">
            <el-empty description="暂无设定，点击上方按钮创建" />
          </div>
          <div v-else class="settings-groups">
            <div
              v-for="(items, category) in groupedSettings"
              :key="category"
              class="setting-group"
            >
              <div class="group-header">
                <span class="group-icon">{{ getCategoryIcon(category) }}</span>
                <span class="group-title">{{ getCategoryLabel(category) }}</span>
                <el-badge :value="items.length" type="info" />
              </div>
              <div class="group-items">
                <div
                  v-for="setting in items"
                  :key="setting.id"
                  class="setting-item"
                  :class="{ 'is-selected': selectedSetting?.id === setting.id }"
                  @click="handleSelect(setting)"
                >
                  <div class="item-name">{{ setting.name }}</div>
                  <div class="item-tags">
                    <el-tag
                      v-for="tag in (setting.tags || []).slice(0, 2)"
                      :key="tag"
                      size="small"
                      type="info"
                    >
                      {{ tag }}
                    </el-tag>
                  </div>
                  <div class="item-actions">
                    <el-button
                      :icon="Edit"
                      size="small"
                      circle
                      @click.stop="handleEdit(setting)"
                    />
                    <el-button
                      :icon="Delete"
                      size="small"
                      circle
                      type="danger"
                      @click.stop="handleDelete(setting)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧详情 -->
        <div class="setting-detail">
          <template v-if="selectedSetting">
            <div class="detail-header">
              <h2>{{ selectedSetting.name }}</h2>
              <el-tag>{{ getCategoryLabel(selectedSetting.category) }}</el-tag>
            </div>
            <div class="detail-tags">
              <el-tag
                v-for="tag in selectedSetting.tags"
                :key="tag"
                type="info"
                closable
                @close="() => settingStore.removeTag(selectedSetting!.id, tag)"
              >
                {{ tag }}
              </el-tag>
            </div>
            <div class="detail-content">
              <pre>{{ selectedSetting.content || '暂无内容' }}</pre>
            </div>
            <div class="detail-meta">
              <span>创建于: {{ new Date(selectedSetting.createdAt).toLocaleString('zh-CN') }}</span>
              <span>更新于: {{ new Date(selectedSetting.updatedAt).toLocaleString('zh-CN') }}</span>
            </div>
          </template>
          <template v-else>
            <div class="empty-detail">
              <el-empty :icon="Collection" description="选择一个设定查看详情" />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editMode ? '编辑设定' : '新建设定'"
      width="600px"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-width="80px"
      >
        <el-form-item label="名称" prop="name">
          <el-input v-model="formData.name" placeholder="设定名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="formData.category" style="width: 100%">
            <el-option label="力量体系" value="power_system" />
            <el-option label="物品道具" value="item" />
            <el-option label="地点场景" value="location" />
            <el-option label="组织势力" value="organization" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="formData.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入标签后按回车"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="内容">
          <el-input
            v-model="formData.content"
            type="textarea"
            :rows="10"
            placeholder="详细描述这个设定..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ editMode ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
.settings-view {
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
}

.toolbar {
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.stats-bar {
  display: flex;
  gap: 8px;
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

.settings-list {
  width: 400px;
  border-right: 1px solid var(--el-border-color-lighter);
  overflow-y: auto;
}

.setting-detail {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.settings-groups {
  padding: 16px;
}

.setting-group {
  margin-bottom: 24px;

  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    .group-icon {
      font-size: 18px;
    }

    .group-title {
      font-weight: 600;
    }
  }
}

.setting-item {
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);

    .item-actions {
      opacity: 1;
    }
  }

  &.is-selected {
    background: var(--el-color-primary-light-9);
    border: 1px solid var(--el-color-primary-light-5);
  }

  .item-name {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-tags {
    display: flex;
    gap: 4px;
    margin-right: 12px;
  }

  .item-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;

  h2 {
    margin: 0;
    font-size: 24px;
  }
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}

.detail-content {
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    line-height: 1.6;
  }
}

.detail-meta {
  display: flex;
  gap: 24px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.empty-state,
.empty-detail {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}
</style>
