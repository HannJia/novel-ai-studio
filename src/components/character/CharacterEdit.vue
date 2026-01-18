<template>
  <div class="character-edit">
    <!-- 头部 -->
    <div class="character-edit__header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" @click="$emit('back')">返回</el-button>
        <h3>{{ character?.name || '角色详情' }}</h3>
        <el-tag :type="typeTagType">{{ typeLabel }}</el-tag>
      </div>
      <div class="header-right">
        <el-button type="primary" :loading="saving" @click="handleSave">
          保存更改
        </el-button>
      </div>
    </div>

    <!-- 内容区 -->
    <div v-if="character" v-loading="loading" class="character-edit__content">
      <el-tabs v-model="activeTab" type="border-card">
        <!-- 基本信息 -->
        <el-tab-pane label="基本信息" name="basic">
          <el-form label-width="100px" class="edit-form">
            <el-form-item label="角色名">
              <el-input v-model="editData.name" placeholder="角色名" />
            </el-form-item>
            <el-form-item label="角色类型">
              <el-select v-model="editData.type" style="width: 100%">
                <el-option label="主角" value="protagonist" />
                <el-option label="配角" value="supporting" />
                <el-option label="反派" value="antagonist" />
                <el-option label="其他" value="other" />
              </el-select>
            </el-form-item>
            <el-form-item label="别名">
              <el-select
                v-model="editData.aliases"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="输入别名后按回车"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 角色档案 -->
        <el-tab-pane label="角色档案" name="profile">
          <el-form label-width="100px" class="edit-form">
            <el-row :gutter="20">
              <el-col :span="12">
                <el-form-item label="性别">
                  <el-input v-model="editData.profile.gender" />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="年龄">
                  <el-input v-model="editData.profile.age" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="外貌特征">
              <el-input
                v-model="editData.profile.appearance"
                type="textarea"
                :rows="3"
                placeholder="描述角色的外貌特征..."
              />
            </el-form-item>
            <el-form-item label="性格特点">
              <el-input
                v-model="editData.profile.personality"
                type="textarea"
                :rows="3"
                placeholder="描述角色的性格特点..."
              />
            </el-form-item>
            <el-form-item label="背景故事">
              <el-input
                v-model="editData.profile.background"
                type="textarea"
                :rows="4"
                placeholder="角色的背景故事..."
              />
            </el-form-item>
            <el-form-item label="能力技能">
              <el-input
                v-model="editData.profile.abilities"
                type="textarea"
                :rows="3"
                placeholder="角色的能力或技能..."
              />
            </el-form-item>
            <el-form-item label="目标动机">
              <el-input
                v-model="editData.profile.goals"
                type="textarea"
                :rows="3"
                placeholder="角色的目标或动机..."
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 角色状态 -->
        <el-tab-pane label="当前状态" name="state">
          <el-form label-width="100px" class="edit-form">
            <el-form-item label="存活状态">
              <el-switch
                v-model="editData.state.isAlive"
                active-text="存活"
                inactive-text="已故"
              />
            </el-form-item>
            <el-form-item label="当前位置">
              <el-input v-model="editData.state.location" placeholder="角色当前所在位置" />
            </el-form-item>
            <el-form-item label="实力等级">
              <el-input v-model="editData.state.powerLevel" placeholder="当前实力等级" />
            </el-form-item>
            <el-form-item label="持有物品">
              <el-select
                v-model="editData.state.items"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="输入物品名后按回车"
                style="width: 100%"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 角色关系 -->
        <el-tab-pane label="角色关系" name="relationships">
          <div class="relationships-panel">
            <div class="relationships-header">
              <el-button type="primary" size="small" @click="addRelationship">
                添加关系
              </el-button>
            </div>
            <el-table :data="editData.state.relationships" border>
              <el-table-column label="关系对象" min-width="120">
                <template #default="{ row, $index }">
                  <el-select
                    v-model="row.targetId"
                    placeholder="选择角色"
                    filterable
                    @change="(val: string) => handleTargetChange($index, val)"
                  >
                    <el-option
                      v-for="c in otherCharacters"
                      :key="c.id"
                      :label="c.name"
                      :value="c.id"
                    />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="关系类型" min-width="100">
                <template #default="{ row }">
                  <el-input v-model="row.relation" placeholder="如：师父、恋人" />
                </template>
              </el-table-column>
              <el-table-column label="关系描述" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.description" placeholder="详细描述" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80">
                <template #default="{ $index }">
                  <el-button
                    type="danger"
                    size="small"
                    :icon="Delete"
                    circle
                    @click="removeRelationship($index)"
                  />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <!-- 状态历史 -->
        <el-tab-pane label="状态历史" name="history">
          <el-timeline v-if="editData.state.stateHistory?.length">
            <el-timeline-item
              v-for="(change, index) in editData.state.stateHistory"
              :key="index"
              :timestamp="formatTimestamp(change.timestamp)"
              placement="top"
            >
              <el-card>
                <p><strong>第{{ change.chapterOrder }}章</strong></p>
                <p>
                  <el-tag size="small">{{ change.field }}</el-tag>
                  {{ change.oldValue }} → {{ change.newValue }}
                </p>
                <p class="change-reason">{{ change.reason }}</p>
              </el-card>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无状态变更记录" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ArrowLeft, Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useCharacterStore } from '@/stores/characterStore'
import type { Character, CharacterType, CharacterRelationship, CharacterStateChange } from '@/types'
import { CHARACTER_TYPE_MAP } from '@/types/character'

// Props
const props = defineProps<{
  characterId: string
  bookId: string
}>()

// Emits
const emit = defineEmits<{
  back: []
  saved: [character: Character]
}>()

// Store
const characterStore = useCharacterStore()

// 状态
const loading = ref(false)
const saving = ref(false)
const activeTab = ref('basic')
const character = ref<Character | null>(null)

// 编辑数据
const editData = ref({
  name: '',
  type: 'other' as CharacterType,
  aliases: [] as string[],
  profile: {
    gender: '',
    age: '',
    appearance: '',
    personality: '',
    background: '',
    abilities: '',
    goals: '',
    extra: {} as Record<string, string>
  },
  state: {
    isAlive: true,
    location: '',
    powerLevel: '',
    relationships: [] as CharacterRelationship[],
    items: [] as string[],
    lastUpdatedChapter: 0,
    stateHistory: [] as CharacterStateChange[]
  }
})

// 计算属性
const typeLabel = computed(() => {
  return CHARACTER_TYPE_MAP[editData.value.type] || '其他'
})

const typeTagType = computed(() => {
  const typeMap: Record<string, 'danger' | 'warning' | 'info' | ''> = {
    protagonist: 'danger',
    supporting: 'warning',
    antagonist: 'info',
    other: ''
  }
  return typeMap[editData.value.type] || ''
})

const otherCharacters = computed(() => {
  return characterStore.characters.filter(c => c.id !== props.characterId)
})

// 方法
async function loadCharacter() {
  loading.value = true
  try {
    character.value = await characterStore.fetchCharacter(props.characterId)
    if (character.value) {
      editData.value = {
        name: character.value.name,
        type: character.value.type,
        aliases: [...(character.value.aliases || [])],
        profile: {
          gender: character.value.profile?.gender || '',
          age: character.value.profile?.age || '',
          appearance: character.value.profile?.appearance || '',
          personality: character.value.profile?.personality || '',
          background: character.value.profile?.background || '',
          abilities: character.value.profile?.abilities || '',
          goals: character.value.profile?.goals || '',
          extra: { ...(character.value.profile?.extra || {}) }
        },
        state: {
          isAlive: character.value.state?.isAlive !== false,
          location: character.value.state?.location || '',
          powerLevel: character.value.state?.powerLevel || '',
          relationships: [...(character.value.state?.relationships || [])],
          items: [...(character.value.state?.items || [])],
          lastUpdatedChapter: character.value.state?.lastUpdatedChapter || 0,
          stateHistory: [...(character.value.state?.stateHistory || [])]
        }
      }
    }
  } catch (e) {
    ElMessage.error('加载角色失败')
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    const updated = await characterStore.updateCharacter(props.characterId, {
      name: editData.value.name,
      type: editData.value.type,
      aliases: editData.value.aliases,
      profile: editData.value.profile,
      state: editData.value.state
    })
    ElMessage.success('保存成功')
    emit('saved', updated)
  } catch (e) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}

function addRelationship() {
  editData.value.state.relationships.push({
    targetId: '',
    targetName: '',
    relation: '',
    description: ''
  })
}

function removeRelationship(index: number) {
  editData.value.state.relationships.splice(index, 1)
}

function handleTargetChange(index: number, targetId: string) {
  const target = characterStore.getCharacterById(targetId)
  if (target) {
    editData.value.state.relationships[index].targetName = target.name
  }
}

function formatTimestamp(timestamp: string): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

// 监听
watch(() => props.characterId, () => {
  if (props.characterId) {
    loadCharacter()
  }
}, { immediate: true })
</script>

<style scoped lang="scss">
.character-edit {
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
      gap: 12px;

      h3 {
        margin: 0;
        font-size: 18px;
      }
    }
  }

  &__content {
    flex: 1;
    padding: 16px;
    overflow-y: auto;
  }
}

.edit-form {
  max-width: 800px;
}

.relationships-panel {
  .relationships-header {
    margin-bottom: 16px;
  }
}

.change-reason {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin: 4px 0 0;
}
</style>
