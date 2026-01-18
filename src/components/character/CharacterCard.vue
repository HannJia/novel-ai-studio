<template>
  <div class="character-card" :class="{ 'is-selected': selected }" @click="$emit('click')">
    <!-- 角色头像/类型标识 -->
    <div class="character-card__avatar" :class="typeClass">
      <span class="avatar-text">{{ character.name.charAt(0) }}</span>
    </div>

    <!-- 角色信息 -->
    <div class="character-card__info">
      <div class="info-header">
        <h4 class="character-name">{{ character.name }}</h4>
        <el-tag :type="typeTagType" size="small">{{ typeLabel }}</el-tag>
      </div>

      <!-- 别名 -->
      <div v-if="character.aliases?.length" class="character-aliases">
        <el-tag
          v-for="alias in character.aliases.slice(0, 3)"
          :key="alias"
          size="small"
          type="info"
        >
          {{ alias }}
        </el-tag>
        <el-tag v-if="character.aliases.length > 3" size="small" type="info">
          +{{ character.aliases.length - 3 }}
        </el-tag>
      </div>

      <!-- 基本信息摘要 -->
      <div class="character-summary">
        <span v-if="character.profile?.gender" class="summary-item">
          {{ character.profile.gender }}
        </span>
        <span v-if="character.profile?.age" class="summary-item">
          {{ character.profile.age }}
        </span>
      </div>

      <!-- 性格摘要 -->
      <p v-if="character.profile?.personality" class="character-personality">
        {{ truncate(character.profile.personality, 50) }}
      </p>

      <!-- 状态指示 -->
      <div class="character-status">
        <el-tag
          :type="character.state?.isAlive === false ? 'danger' : 'success'"
          size="small"
          effect="plain"
        >
          {{ character.state?.isAlive === false ? '已故' : '存活' }}
        </el-tag>
        <span v-if="character.state?.powerLevel" class="power-level">
          {{ character.state.powerLevel }}
        </span>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="character-card__actions">
      <el-button
        :icon="Edit"
        circle
        size="small"
        @click.stop="$emit('edit', character)"
      />
      <el-button
        :icon="Delete"
        circle
        size="small"
        type="danger"
        @click.stop="$emit('delete', character)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Edit, Delete } from '@element-plus/icons-vue'
import type { Character, CharacterType } from '@/types'
import { CHARACTER_TYPE_MAP } from '@/types/character'

// Props
const props = defineProps<{
  character: Character
  selected?: boolean
}>()

// Emits
defineEmits<{
  click: []
  edit: [character: Character]
  delete: [character: Character]
}>()

// 计算属性
const typeClass = computed(() => `type-${props.character.type}`)

const typeLabel = computed(() => {
  return CHARACTER_TYPE_MAP[props.character.type as CharacterType] || '其他'
})

const typeTagType = computed(() => {
  const typeMap: Record<string, 'danger' | 'warning' | 'info' | ''> = {
    protagonist: 'danger',
    supporting: 'warning',
    antagonist: 'info',
    other: ''
  }
  return typeMap[props.character.type] || ''
})

// 工具函数
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}
</script>

<style scoped lang="scss">
.character-card {
  display: flex;
  padding: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--el-color-primary-light-5);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);

    .character-card__actions {
      opacity: 1;
    }
  }

  &.is-selected {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  &__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-right: 12px;

    .avatar-text {
      color: white;
      font-size: 18px;
      font-weight: bold;
    }

    &.type-protagonist {
      background: linear-gradient(135deg, #f56c6c, #e6a23c);
    }

    &.type-supporting {
      background: linear-gradient(135deg, #e6a23c, #67c23a);
    }

    &.type-antagonist {
      background: linear-gradient(135deg, #909399, #303133);
    }

    &.type-other {
      background: linear-gradient(135deg, #409eff, #67c23a);
    }
  }

  &__info {
    flex: 1;
    min-width: 0;

    .info-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .character-name {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--el-text-color-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .character-aliases {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }

    .character-summary {
      display: flex;
      gap: 12px;
      margin-bottom: 8px;
      font-size: 13px;
      color: var(--el-text-color-secondary);

      .summary-item {
        &::before {
          content: '·';
          margin-right: 4px;
        }

        &:first-child::before {
          content: '';
          margin-right: 0;
        }
      }
    }

    .character-personality {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--el-text-color-regular);
      line-height: 1.5;
    }

    .character-status {
      display: flex;
      align-items: center;
      gap: 8px;

      .power-level {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }
    }
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
}
</style>
