<script setup lang="ts">
import { ref } from 'vue'

// 模拟知识库数据
interface KnowledgeFile {
  id: string
  name: string
  type: 'document' | 'image'
  tags?: string[]
  preview?: string
}

const files = ref<KnowledgeFile[]>([
  {
    id: '1',
    name: '修炼体系.md',
    type: 'document'
  },
  {
    id: '2',
    name: '势力分布.md',
    type: 'document'
  },
  {
    id: '3',
    name: '荒塔.jpg',
    type: 'image',
    tags: ['荒凉', '高塔', '废墟', '神秘'],
    preview: ''
  }
])

const activeSection = ref<'documents' | 'images'>('images')

// 上传文件
function handleUpload(): void {
  // TODO: 实现文件上传
}
</script>

<template>
  <div class="knowledge-panel">
    <!-- 标题 -->
    <div class="panel-title">
      <el-icon><FolderOpened /></el-icon>
      <span>专属知识库</span>
    </div>

    <!-- 分类切换 -->
    <div class="section-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeSection === 'documents' }"
        @click="activeSection = 'documents'"
      >
        <el-icon><Document /></el-icon>
        设定文档
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeSection === 'images' }"
        @click="activeSection = 'images'"
      >
        <el-icon><Picture /></el-icon>
        视觉素材
      </button>
    </div>

    <!-- 文档列表 -->
    <div v-if="activeSection === 'documents'" class="file-list">
      <div
        v-for="file in files.filter(f => f.type === 'document')"
        :key="file.id"
        class="file-item"
      >
        <el-icon class="file-icon"><Document /></el-icon>
        <span class="file-name">{{ file.name }}</span>
      </div>
    </div>

    <!-- 图片素材列表 -->
    <div v-else class="image-list">
      <div
        v-for="file in files.filter(f => f.type === 'image')"
        :key="file.id"
        class="image-card"
      >
        <div class="image-preview">
          <el-icon><Picture /></el-icon>
          <span>预览</span>
        </div>
        <div class="image-info">
          <div class="image-name">{{ file.name }}</div>
          <div class="ai-recognition">
            <div class="recognition-label">
              <el-icon><MagicStick /></el-icon>
              AI识别:
            </div>
            <div class="recognition-tags">
              <el-tag
                v-for="tag in file.tags"
                :key="tag"
                size="small"
                type="info"
              >
                #{{ tag }}
              </el-tag>
            </div>
          </div>
          <el-button class="apply-btn" size="small" type="primary" text>
            <el-icon><MagicStick /></el-icon>
            融入描写
          </el-button>
        </div>
      </div>
    </div>

    <!-- 上传按钮 -->
    <button class="upload-btn" @click="handleUpload">
      <el-icon><Upload /></el-icon>
      上传{{ activeSection === 'documents' ? '文档' : '图片' }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.knowledge-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, $text-primary);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color, $border-lighter);

  .el-icon {
    font-size: 16px;
    color: var(--text-secondary, $text-secondary);
  }
}

.section-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background-color: var(--tab-bg, $light-bg-panel);
  border-radius: $border-radius-large;

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: none;
    border-radius: $border-radius-base;
    background: transparent;
    color: var(--text-secondary, $text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all $transition-duration-fast $transition-ease;

    .el-icon {
      font-size: 14px;
    }

    &:hover {
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-tab-bg, $bg-base);
      color: var(--text-primary, $text-primary);
      box-shadow: $light-card-shadow;
    }
  }
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: $border-radius-base;
  cursor: pointer;
  transition: background-color $transition-duration-fast;

  &:hover {
    background-color: var(--hover-bg, $light-bg-hover);
  }

  .file-icon {
    font-size: 16px;
    color: var(--text-secondary, $text-secondary);
  }

  .file-name {
    font-size: 13px;
    color: var(--text-primary, $text-primary);
  }
}

.image-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.image-card {
  background-color: var(--card-bg, $light-bg-panel);
  border-radius: $border-radius-card;
  overflow: hidden;

  .image-preview {
    height: 100px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.8);

    .el-icon {
      font-size: 32px;
    }

    span {
      font-size: 12px;
    }
  }

  .image-info {
    padding: 12px;

    .image-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, $text-primary);
      margin-bottom: 8px;
    }

    .ai-recognition {
      .recognition-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--text-secondary, $text-secondary);
        margin-bottom: 6px;

        .el-icon {
          font-size: 12px;
          color: $primary-color;
        }
      }

      .recognition-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;

        .el-tag {
          font-size: 10px;
          padding: 0 6px;
          height: 20px;
          line-height: 20px;
          background-color: var(--tag-bg, rgba($primary-color, 0.1));
          color: var(--tag-color, $primary-color);
          border: none;
        }
      }
    }

    .apply-btn {
      margin-top: 10px;
      width: 100%;
    }
  }
}

.upload-btn {
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
:global(html.dark) .knowledge-panel {
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --border-color: #{$dark-border-lighter};
  --tab-bg: #{$dark-bg-panel};
  --active-tab-bg: #{$dark-bg-card};
  --hover-bg: #{$dark-bg-hover};
  --card-bg: #{$dark-bg-panel};
  --tag-bg: rgba(#{$primary-color}, 0.2);
  --tag-color: #{lighten($primary-color, 10%)};
}
</style>
