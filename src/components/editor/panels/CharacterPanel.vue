<script setup lang="ts">
import { ref } from 'vue'

// 模拟角色数据
interface Character {
  id: string
  name: string
  type: 'protagonist' | 'supporting' | 'antagonist'
  realm: string
  status: string
  location: string
}

const characters = ref<Character[]>([
  {
    id: '1',
    name: '林枫',
    type: 'protagonist',
    realm: '金丹期',
    status: '轻伤',
    location: '秘境深处'
  },
  {
    id: '2',
    name: '苏雨晴',
    type: 'supporting',
    realm: '筑基后期',
    status: '正常',
    location: '宗门'
  }
])

const searchQuery = ref('')

const typeLabel = (type: string) => {
  const map: Record<string, string> = {
    protagonist: '主',
    supporting: '配',
    antagonist: '反'
  }
  return map[type] || '其他'
}

const typeClass = (type: string) => {
  return `type-${type}`
}
</script>

<template>
  <div class="character-panel">
    <!-- 搜索框 -->
    <div class="search-box">
      <el-input
        v-model="searchQuery"
        placeholder="搜索角色..."
        :prefix-icon="Search"
        clearable
        size="small"
      />
    </div>

    <!-- 角色卡片列表 -->
    <div class="character-list">
      <div
        v-for="char in characters"
        :key="char.id"
        class="character-card"
      >
        <div class="card-header">
          <div class="char-avatar">
            <el-icon><User /></el-icon>
          </div>
          <div class="char-info">
            <div class="char-name">
              {{ char.name }}
              <el-tag class="type-tag" :class="typeClass(char.type)" size="small">
                {{ typeLabel(char.type) }}
              </el-tag>
            </div>
            <div class="char-realm">{{ char.realm }}</div>
          </div>
        </div>
        <div class="card-body">
          <div class="stat-row">
            <span class="stat-label">状态</span>
            <span class="stat-value" :class="{ warning: char.status !== '正常' }">
              {{ char.status }}
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label">位置</span>
            <span class="stat-value">{{ char.location }}</span>
          </div>
        </div>
        <div class="card-actions">
          <el-button text size="small">
            <el-icon><Edit /></el-icon>
            编辑
          </el-button>
          <el-button text size="small">
            <el-icon><Clock /></el-icon>
            历史
          </el-button>
        </div>
      </div>
    </div>

    <!-- 添加角色按钮 -->
    <button class="add-character-btn">
      <el-icon><Plus /></el-icon>
      添加角色
    </button>
  </div>
</template>

<style scoped lang="scss">
.character-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-box {
  :deep(.el-input__wrapper) {
    border-radius: $border-radius-large;
    background-color: var(--input-bg, $light-bg-panel);
    box-shadow: none;
    border: 1px solid transparent;

    &:hover, &.is-focus {
      border-color: $primary-color;
    }
  }
}

.character-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.character-card {
  background-color: var(--card-bg, $light-bg-panel);
  border-radius: $border-radius-card;
  padding: 14px;
  transition: all $transition-duration-fast $transition-ease;

  &:hover {
    box-shadow: var(--card-shadow, $light-card-shadow);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;

    .char-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, $primary-color, $accent-purple);
      display: flex;
      align-items: center;
      justify-content: center;

      .el-icon {
        font-size: 20px;
        color: #fff;
      }
    }

    .char-info {
      flex: 1;

      .char-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary, $text-primary);

        .type-tag {
          font-size: 10px;
          padding: 0 6px;
          height: 18px;
          line-height: 18px;
          border: none;

          &.type-protagonist {
            background-color: rgba($primary-color, 0.15);
            color: $primary-color;
          }

          &.type-supporting {
            background-color: rgba($success-color, 0.15);
            color: $success-color;
          }

          &.type-antagonist {
            background-color: rgba($danger-color, 0.15);
            color: $danger-color;
          }
        }
      }

      .char-realm {
        font-size: 12px;
        color: var(--text-secondary, $text-secondary);
        margin-top: 2px;
      }
    }
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background-color: var(--body-bg, rgba(0, 0, 0, 0.02));
    border-radius: $border-radius-base;

    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;

      .stat-label {
        color: var(--text-secondary, $text-secondary);
      }

      .stat-value {
        color: var(--text-primary, $text-primary);

        &.warning {
          color: $warning-color;
        }
      }
    }
  }

  .card-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color, $border-lighter);

    .el-button {
      flex: 1;
      color: var(--text-secondary, $text-secondary);

      &:hover {
        color: $primary-color;
      }
    }
  }
}

.add-character-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  border: 1px dashed var(--border-color, $border-light);
  border-radius: $border-radius-large;
  background: transparent;
  color: var(--text-secondary, $text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all $transition-duration-fast $transition-ease;

  &:hover {
    border-color: $primary-color;
    color: $primary-color;
    background-color: rgba($primary-color, 0.05);
  }
}

// 深色主题适配
:global(html.dark) .character-panel {
  --input-bg: #{$dark-bg-panel};
  --card-bg: #{$dark-bg-panel};
  --card-shadow: none;
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --body-bg: rgba(255, 255, 255, 0.03);
  --border-color: #{$dark-border-lighter};
}
</style>
