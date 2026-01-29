<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, List, Share } from '@element-plus/icons-vue'
import CharacterList from '@/components/character/CharacterList.vue'
import CharacterEdit from '@/components/character/CharacterEdit.vue'
import RelationshipGraph from '@/components/character/RelationshipGraph.vue'
import type { Character } from '@/types'

const route = useRoute()
const router = useRouter()
const bookId = route.params.bookId as string

// 状态
const viewMode = ref<'list' | 'edit' | 'graph'>('list')
const selectedCharacterId = ref<string | null>(null)

// 方法
function handleBack() {
  router.back()
}

function handleSelectCharacter(character: Character) {
  selectedCharacterId.value = character.id
  viewMode.value = 'edit'
}

function handleBackToList() {
  viewMode.value = 'list'
  selectedCharacterId.value = null
}

function handleCharacterSaved() {
  // 保存后可以选择是否返回列表
}

function switchToList() {
  viewMode.value = 'list'
  selectedCharacterId.value = null
}

function switchToGraph() {
  viewMode.value = 'graph'
  selectedCharacterId.value = null
}

function handleGraphNodeSelect(character: Character) {
  selectedCharacterId.value = character.id
  viewMode.value = 'edit'
}
</script>

<template>
  <div class="character-view">
    <!-- 列表视图 -->
    <template v-if="viewMode === 'list'">
      <div class="page-header">
        <div class="header-left">
          <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
          <h1>角色管理</h1>
        </div>
        <div class="header-right">
          <el-button-group>
            <el-button type="primary" :icon="List">列表视图</el-button>
            <el-button :icon="Share" @click="switchToGraph">关系图</el-button>
          </el-button-group>
        </div>
      </div>
      <div class="page-content">
        <CharacterList
          :book-id="bookId"
          @select="handleSelectCharacter"
        />
      </div>
    </template>

    <!-- 关系图视图 -->
    <template v-else-if="viewMode === 'graph'">
      <div class="page-header">
        <div class="header-left">
          <el-button :icon="ArrowLeft" @click="handleBack">返回</el-button>
          <h1>角色关系图</h1>
        </div>
        <div class="header-right">
          <el-button-group>
            <el-button :icon="List" @click="switchToList">列表视图</el-button>
            <el-button type="primary" :icon="Share">关系图</el-button>
          </el-button-group>
        </div>
      </div>
      <div class="page-content graph-content">
        <RelationshipGraph
          :book-id="bookId"
          @select-node="handleGraphNodeSelect"
        />
      </div>
    </template>

    <!-- 编辑视图 -->
    <template v-else-if="viewMode === 'edit' && selectedCharacterId">
      <CharacterEdit
        :character-id="selectedCharacterId"
        :book-id="bookId"
        @back="handleBackToList"
        @saved="handleCharacterSaved"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
// ==========================================
// 角色管理页面样式 - Gemini 3 Pro 设计方案
// ==========================================

.character-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-base, $dark-bg-base);
}

// ==========================================
// 页面头部
// ==========================================
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: $spacing-base $spacing-xl;
  background-color: var(--bg-surface, $dark-bg-surface);
  border-bottom: 1px solid var(--border-base, $dark-border-base);
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: $spacing-base;

    h1 {
      margin: 0;
      font-size: $font-size-extra-large;
      font-weight: 600;
      color: var(--text-primary, $dark-text-primary);
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: $spacing-md;
  }
}

// ==========================================
// 页面内容
// ==========================================
.page-content {
  flex: 1;
  overflow: hidden;
  padding: $spacing-xl;

  &.graph-content {
    padding: 0;
  }
}

// ==========================================
// 按钮组样式覆盖
// ==========================================
:deep(.el-button-group) {
  .el-button {
    border-color: var(--border-base, $dark-border-base);

    &:not(.is-active):not([type="primary"]) {
      background-color: var(--bg-elevated, $dark-bg-elevated);
      color: var(--text-secondary, $dark-text-secondary);

      &:hover {
        background-color: var(--bg-hover, $dark-bg-hover);
        color: var(--text-primary, $dark-text-primary);
      }
    }
  }
}
</style>
