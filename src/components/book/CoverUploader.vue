<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadCover, deleteCover } from '@/services/api/fileApi'

const props = defineProps<{
  modelValue?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const uploading = ref(false)
const dragOver = ref(false)

const coverUrl = computed(() => props.modelValue || '')

const hasImage = computed(() => !!coverUrl.value)

async function handleFileSelect(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    await uploadFile(file)
  }
  // 清空input，允许重复选择同一文件
  target.value = ''
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  dragOver.value = false

  const file = event.dataTransfer?.files?.[0]
  if (file) {
    await uploadFile(file)
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  dragOver.value = true
}

function handleDragLeave(): void {
  dragOver.value = false
}

async function uploadFile(file: File): Promise<void> {
  // 验证文件类型
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件')
    return
  }

  // 验证文件大小（最大5MB）
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error('图片大小不能超过5MB')
    return
  }

  uploading.value = true
  try {
    const result = await uploadCover(file)
    emit('update:modelValue', result.url)
    ElMessage.success('封面上传成功')
  } catch (e) {
    ElMessage.error('上传失败: ' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    uploading.value = false
  }
}

async function handleRemove(): Promise<void> {
  if (!coverUrl.value) return

  try {
    // 提取文件名
    const filename = coverUrl.value.split('/').pop()
    if (filename) {
      await deleteCover(filename)
    }
    emit('update:modelValue', '')
    ElMessage.success('封面已删除')
  } catch (e) {
    // 即使删除失败也清空URL
    emit('update:modelValue', '')
  }
}
</script>

<template>
  <div
    class="cover-uploader"
    :class="{ 'has-image': hasImage, 'drag-over': dragOver }"
    @drop="handleDrop"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
  >
    <!-- 有封面时显示 -->
    <div v-if="hasImage" class="cover-preview">
      <img :src="coverUrl" alt="封面" />
      <div class="cover-actions">
        <el-button type="danger" size="small" circle @click="handleRemove">
          <el-icon><Delete /></el-icon>
        </el-button>
        <label class="change-btn">
          <el-button type="primary" size="small" circle>
            <el-icon><Edit /></el-icon>
          </el-button>
          <input
            type="file"
            accept="image/*"
            @change="handleFileSelect"
            style="display: none"
          />
        </label>
      </div>
    </div>

    <!-- 无封面时显示上传区域 -->
    <label v-else class="upload-area">
      <div v-if="uploading" class="uploading">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>上传中...</span>
      </div>
      <div v-else class="upload-placeholder">
        <el-icon class="upload-icon"><Plus /></el-icon>
        <span class="upload-text">点击或拖拽上传封面</span>
        <span class="upload-hint">支持 JPG、PNG，最大 5MB</span>
      </div>
      <input
        type="file"
        accept="image/*"
        @change="handleFileSelect"
        :disabled="uploading"
        style="display: none"
      />
    </label>
  </div>
</template>

<style scoped lang="scss">
.cover-uploader {
  width: 160px;
  height: 220px;
  min-height: 220px;
  border-radius: 8px;
  overflow: hidden;
  background-color: #f5f7fa;
  border: 2px dashed #dcdfe6;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;

  &.drag-over {
    border-color: #409eff;
    background-color: #ecf5ff;
  }

  &.has-image {
    border-style: solid;
    border-color: transparent;
  }
}

.cover-preview {
  width: 100%;
  height: 100%;
  position: relative;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-actions {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background-color: rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  &:hover .cover-actions {
    opacity: 1;
  }

  .change-btn {
    cursor: pointer;
  }
}

.upload-area {
  width: 100%;
  height: 100%;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  flex: 1;

  &:hover {
    border-color: #409eff;
    background-color: #ecf5ff;
  }
}

.uploading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #409eff;

  .el-icon {
    font-size: 32px;
  }
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  text-align: center;

  .upload-icon {
    font-size: 32px;
    color: #c0c4cc;
  }

  .upload-text {
    font-size: 13px;
    color: #606266;
  }

  .upload-hint {
    font-size: 11px;
    color: #909399;
  }
}

// 深色主题适配
:global(html.dark) {
  .cover-uploader {
    background-color: #1e1e1e;
    border-color: #4c4d4f;

    &.drag-over {
      border-color: #409eff;
      background-color: #1a2a3a;
    }
  }

  .upload-area:hover {
    background-color: #1a2a3a;
  }

  .upload-placeholder {
    .upload-icon {
      color: #5a5e66;
    }
    .upload-text {
      color: #a3a6ad;
    }
    .upload-hint {
      color: #5a5e66;
    }
  }
}
</style>
