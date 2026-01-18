<template>
  <div class="character-list">
    <!-- 头部操作栏 -->
    <div class="character-list__header">
      <div class="header-left">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索角色..."
          :prefix-icon="Search"
          clearable
          style="width: 200px"
          @input="handleSearch"
        />
        <el-select
          v-model="filterType"
          placeholder="角色类型"
          clearable
          style="width: 120px; margin-left: 12px"
          @change="handleFilterChange"
        >
          <el-option label="主角" value="protagonist" />
          <el-option label="配角" value="supporting" />
          <el-option label="反派" value="antagonist" />
          <el-option label="其他" value="other" />
        </el-select>
      </div>
      <div class="header-right">
        <el-button type="primary" :icon="Plus" @click="handleCreate">
          新建角色
        </el-button>
      </div>
    </div>

    <!-- 角色统计 -->
    <div v-if="stats" class="character-list__stats">
      <el-tag type="danger">主角: {{ stats.protagonist }}</el-tag>
      <el-tag type="warning">配角: {{ stats.supporting }}</el-tag>
      <el-tag type="info">反派: {{ stats.antagonist }}</el-tag>
      <el-tag>其他: {{ stats.other }}</el-tag>
      <el-tag type="success">总计: {{ stats.total }}</el-tag>
    </div>

    <!-- 角色列表 -->
    <div v-loading="loading" class="character-list__content">
      <div v-if="filteredCharacters.length === 0" class="empty-state">
        <el-empty description="暂无角色，点击上方按钮创建" />
      </div>
      <div v-else class="character-grid">
        <CharacterCard
          v-for="character in filteredCharacters"
          :key="character.id"
          :character="character"
          @click="handleSelect(character)"
          @edit="handleEdit(character)"
          @delete="handleDelete(character)"
        />
      </div>
    </div>

    <!-- 新建/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editMode ? '编辑角色' : '新建角色'"
      width="600px"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="formData"
        :rules="formRules"
        label-width="80px"
      >
        <el-form-item label="角色名" prop="name">
          <el-input v-model="formData.name" placeholder="请输入角色名" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="formData.type" placeholder="选择角色类型" style="width: 100%">
            <el-option label="主角" value="protagonist" />
            <el-option label="配角" value="supporting" />
            <el-option label="反派" value="antagonist" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="别名">
          <el-select
            v-model="formData.aliases"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入别名后按回车添加"
            style="width: 100%"
          />
        </el-form-item>
        <el-divider content-position="left">基本信息</el-divider>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="性别">
              <el-input v-model="formData.profile.gender" placeholder="如：男、女" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="年龄">
              <el-input v-model="formData.profile.age" placeholder="如：25岁" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="外貌">
          <el-input
            v-model="formData.profile.appearance"
            type="textarea"
            :rows="2"
            placeholder="描述角色的外貌特征"
          />
        </el-form-item>
        <el-form-item label="性格">
          <el-input
            v-model="formData.profile.personality"
            type="textarea"
            :rows="2"
            placeholder="描述角色的性格特点"
          />
        </el-form-item>
        <el-form-item label="背景">
          <el-input
            v-model="formData.profile.background"
            type="textarea"
            :rows="2"
            placeholder="角色的背景故事"
          />
        </el-form-item>
        <el-form-item label="能力">
          <el-input
            v-model="formData.profile.abilities"
            type="textarea"
            :rows="2"
            placeholder="角色的能力或技能"
          />
        </el-form-item>
        <el-form-item label="目标">
          <el-input
            v-model="formData.profile.goals"
            type="textarea"
            :rows="2"
            placeholder="角色的目标或动机"
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

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, CharacterProfile } from '@/types'
import CharacterCard from './CharacterCard.vue'

// Props
const props = defineProps<{
  bookId: string
}>()

// Emits
const emit = defineEmits<{
  select: [character: Character]
}>()

// Store
const characterStore = useCharacterStore()

// 状态
const searchKeyword = ref('')
const filterType = ref('')
const dialogVisible = ref(false)
const editMode = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref<string | null>(null)

// 表单数据
const formData = ref({
  name: '',
  type: 'other' as const,
  aliases: [] as string[],
  profile: {
    gender: '',
    age: '',
    appearance: '',
    personality: '',
    background: '',
    abilities: '',
    goals: '',
    extra: {}
  } as CharacterProfile
})

// 表单规则
const formRules: FormRules = {
  name: [
    { required: true, message: '请输入角色名', trigger: 'blur' }
  ],
  type: [
    { required: true, message: '请选择角色类型', trigger: 'change' }
  ]
}

// 计算属性
const loading = computed(() => characterStore.loading)
const stats = computed(() => characterStore.stats)

const filteredCharacters = computed(() => {
  let result = characterStore.characters

  if (filterType.value) {
    result = result.filter(c => c.type === filterType.value)
  }

  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(c =>
      c.name.toLowerCase().includes(keyword) ||
      c.aliases?.some(a => a.toLowerCase().includes(keyword))
    )
  }

  return result
})

// 方法
async function loadData() {
  if (!props.bookId) return
  await Promise.all([
    characterStore.fetchCharacters(props.bookId),
    characterStore.fetchStats(props.bookId)
  ])
}

function handleSearch() {
  // 搜索功能通过computed实现，这里可以添加防抖逻辑
}

function handleFilterChange() {
  // 筛选功能通过computed实现
}

function handleSelect(character: Character) {
  emit('select', character)
}

function handleCreate() {
  editMode.value = false
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function handleEdit(character: Character) {
  editMode.value = true
  editingId.value = character.id
  formData.value = {
    name: character.name,
    type: character.type,
    aliases: [...(character.aliases || [])],
    profile: {
      gender: character.profile?.gender || '',
      age: character.profile?.age || '',
      appearance: character.profile?.appearance || '',
      personality: character.profile?.personality || '',
      background: character.profile?.background || '',
      abilities: character.profile?.abilities || '',
      goals: character.profile?.goals || '',
      extra: character.profile?.extra || {}
    }
  }
  dialogVisible.value = true
}

async function handleDelete(character: Character) {
  try {
    await ElMessageBox.confirm(
      `确定要删除角色"${character.name}"吗？此操作不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await characterStore.deleteCharacter(character.id)
    await characterStore.fetchStats(props.bookId)
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
      await characterStore.updateCharacter(editingId.value, {
        name: formData.value.name,
        type: formData.value.type,
        aliases: formData.value.aliases,
        profile: formData.value.profile
      })
      ElMessage.success('保存成功')
    } else {
      await characterStore.createCharacter({
        bookId: props.bookId,
        name: formData.value.name,
        type: formData.value.type,
        aliases: formData.value.aliases,
        profile: formData.value.profile
      })
      ElMessage.success('创建成功')
    }

    await characterStore.fetchStats(props.bookId)
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
    type: 'other',
    aliases: [],
    profile: {
      gender: '',
      age: '',
      appearance: '',
      personality: '',
      background: '',
      abilities: '',
      goals: '',
      extra: {}
    }
  }
}

// 监听bookId变化
watch(() => props.bookId, () => {
  loadData()
}, { immediate: true })

// 生命周期
onMounted(() => {
  loadData()
})
</script>

<style scoped lang="scss">
.character-list {
  height: 100%;
  display: flex;
  flex-direction: column;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    .header-left {
      display: flex;
      align-items: center;
    }
  }

  &__stats {
    padding: 12px 16px;
    display: flex;
    gap: 8px;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  &__content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }
}

.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 300px;
}
</style>
