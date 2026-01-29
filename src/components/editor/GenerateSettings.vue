<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAiStore } from '@/stores'
import { AI_SCENE_TYPE_MAP } from '@/types'
import type { AISceneType } from '@/types'

const aiStore = useAiStore()

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

// 本地状态
const useUnified = ref(true)
const unifiedConfigId = ref<string | undefined>(undefined)
const sceneConfigs = ref<Record<AISceneType, string | undefined>>({
  creative: undefined,
  review: undefined,
  vision: undefined,
  analysis: undefined
})

// 生成参数
const chapterWordRange = ref<[number, number]>([2000, 4000])
const continueWordRange = ref<[number, number]>([300, 800])
const temperature = ref(0.7)

// 所有可用的AI配置
const availableConfigs = computed(() => aiStore.configs)

// 初始化时加载配置
watch(() => props.visible, (val) => {
  if (val) {
    loadConfig()
  }
})

// 加载配置
function loadConfig() {
  const config = aiStore.sceneConfig
  useUnified.value = config.useUnified
  unifiedConfigId.value = config.unifiedConfigId
  sceneConfigs.value = { ...config.sceneConfigs } as Record<AISceneType, string | undefined>

  const params = aiStore.generateParams
  chapterWordRange.value = [...params.chapterWordRange]
  continueWordRange.value = [...params.continueWordRange]
  temperature.value = params.temperature
}

// 保存配置
function saveConfig() {
  aiStore.updateSceneConfig({
    useUnified: useUnified.value,
    unifiedConfigId: unifiedConfigId.value,
    sceneConfigs: { ...sceneConfigs.value }
  })

  aiStore.updateGenerateParams({
    chapterWordRange: [...chapterWordRange.value] as [number, number],
    continueWordRange: [...continueWordRange.value] as [number, number],
    temperature: temperature.value
  })

  closeDialog()
}

// 恢复默认
function resetToDefault() {
  useUnified.value = true
  unifiedConfigId.value = aiStore.defaultConfig?.id
  sceneConfigs.value = {
    creative: undefined,
    review: undefined,
    vision: undefined,
    analysis: undefined
  }
  chapterWordRange.value = [2000, 4000]
  continueWordRange.value = [300, 800]
  temperature.value = 0.7
}

// 关闭弹窗
function closeDialog() {
  emit('update:visible', false)
}

// 获取配置名称
function getConfigName(configId: string | undefined): string {
  if (!configId) return '未选择'
  const config = availableConfigs.value.find(c => c.id === configId)
  return config?.name || '未知配置'
}

// 场景类型列表
const sceneTypes: AISceneType[] = ['creative', 'review', 'vision', 'analysis']
</script>

<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="emit('update:visible', $event)"
    title="生成设置"
    width="560px"
    class="generate-settings-dialog"
    :close-on-click-modal="false"
  >
    <div class="settings-content">
      <!-- 生成参数 -->
      <div class="settings-section">
        <div class="section-header">
          <el-icon><Setting /></el-icon>
          <span>生成参数</span>
        </div>

        <div class="section-body">
          <!-- 章节生成字数 -->
          <div class="param-item">
            <label>章节生成字数</label>
            <div class="range-inputs">
              <el-input-number
                v-model="chapterWordRange[0]"
                :min="500"
                :max="chapterWordRange[1] - 100"
                :step="100"
                size="small"
                controls-position="right"
              />
              <span class="range-sep">~</span>
              <el-input-number
                v-model="chapterWordRange[1]"
                :min="chapterWordRange[0] + 100"
                :max="10000"
                :step="100"
                size="small"
                controls-position="right"
              />
              <span class="range-unit">字</span>
            </div>
          </div>

          <!-- 续写字数 -->
          <div class="param-item">
            <label>续写字数</label>
            <div class="range-inputs">
              <el-input-number
                v-model="continueWordRange[0]"
                :min="100"
                :max="continueWordRange[1] - 50"
                :step="50"
                size="small"
                controls-position="right"
              />
              <span class="range-sep">~</span>
              <el-input-number
                v-model="continueWordRange[1]"
                :min="continueWordRange[0] + 50"
                :max="3000"
                :step="50"
                size="small"
                controls-position="right"
              />
              <span class="range-unit">字</span>
            </div>
          </div>

          <!-- 创意温度 -->
          <div class="param-item">
            <label>创意温度</label>
            <div class="slider-input">
              <el-slider
                v-model="temperature"
                :min="0"
                :max="1"
                :step="0.1"
                :show-tooltip="false"
              />
              <span class="slider-value">{{ temperature }}</span>
            </div>
            <div class="param-hint">
              较低值更保守稳定，较高值更有创意但可能不稳定
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="resetToDefault">恢复默认</el-button>
        <el-button @click="closeDialog">取消</el-button>
        <el-button type="primary" @click="saveConfig">保存设置</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped lang="scss">
.settings-content {
  max-height: 60vh;
  overflow-y: auto;
}

.settings-section {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);

  .el-icon {
    font-size: 18px;
    color: var(--el-color-primary, #409eff);
  }
}

.section-body {
  padding-left: 26px;
}

.config-mode {
  .radio-label {
    font-size: 14px;
    font-weight: 500;
  }

  .unified-select {
    margin-top: 12px;
    margin-left: 24px;
  }
}

.config-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;

  .model-name {
    font-size: 12px;
    color: var(--text-secondary, #a3a3a3);
  }
}

.divider-text {
  font-size: 12px;
  color: var(--text-muted, #737373);
}

.scene-configs {
  margin-top: 12px;
  margin-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scene-config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background-color: var(--bg-surface, #1a1a1a);
  border-radius: 8px;
}

.scene-info {
  display: flex;
  align-items: center;
  gap: 10px;

  .scene-icon {
    font-size: 20px;
  }

  .scene-text {
    display: flex;
    flex-direction: column;
    gap: 2px;

    .scene-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, #f5f5f5);
    }

    .scene-desc {
      font-size: 11px;
      color: var(--text-secondary, #a3a3a3);
    }
  }
}

.param-item {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }

  > label {
    display: block;
    font-size: 13px;
    color: var(--el-text-color-regular, #606266);
    margin-bottom: 8px;
  }

  .param-hint {
    margin-top: 6px;
    font-size: 11px;
    color: var(--el-text-color-secondary, #909399);
  }
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;

  :deep(.el-input-number) {
    width: 100px;
  }

  .range-sep {
    color: var(--text-secondary, #a3a3a3);
  }

  .range-unit {
    font-size: 13px;
    color: var(--text-secondary, #a3a3a3);
  }
}

.slider-input {
  display: flex;
  align-items: center;
  gap: 16px;

  .el-slider {
    flex: 1;
  }

  .slider-value {
    min-width: 40px;
    text-align: right;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary, #f5f5f5);
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

// 弹窗样式覆盖
:global(.generate-settings-dialog) {
  .el-dialog__header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-base, #333);
  }

  .el-dialog__body {
    padding: 20px;
  }

  .el-dialog__footer {
    padding: 16px 20px;
    border-top: 1px solid var(--border-base, #333);
  }
}
</style>
