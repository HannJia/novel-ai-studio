<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAiStore, useUiStore } from '@/stores'
import { AI_PROVIDER_MAP, AI_SCENE_TYPE_MAP } from '@/types'
import type { AIProvider, AIConfig, AISceneType } from '@/types'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const aiStore = useAiStore()
const uiStore = useUiStore()

const activeTab = ref('ai')
const showConfigDialog = ref(false)
const isEditing = ref(false)
const editingConfigId = ref<string | null>(null)
const testing = ref(false)
const testingConfigId = ref<string | null>(null)

// AI场景配置
const useUnified = ref(true)
const unifiedConfigId = ref<string | undefined>(undefined)
const sceneConfigs = ref<Record<AISceneType, string | undefined>>({
  creative: undefined,
  review: undefined,
  vision: undefined,
  analysis: undefined
})
const sceneTypes: AISceneType[] = ['creative', 'review', 'vision', 'analysis']

// 所有可用的AI配置
const availableConfigs = computed(() => aiStore.configs)

// 加载场景配置
function loadSceneConfig() {
  const config = aiStore.sceneConfig
  useUnified.value = config.useUnified
  unifiedConfigId.value = config.unifiedConfigId
  sceneConfigs.value = { ...config.sceneConfigs } as Record<AISceneType, string | undefined>
}

// 保存场景配置
function saveSceneConfig() {
  aiStore.updateSceneConfig({
    useUnified: useUnified.value,
    unifiedConfigId: unifiedConfigId.value,
    sceneConfigs: { ...sceneConfigs.value }
  })
  ElMessage.success('场景配置已保存')
}

const providerOptions = Object.entries(AI_PROVIDER_MAP).map(([value, label]) => ({
  value: value as AIProvider,
  label
}))

// 根据提供商获取默认基础 URL
const providerBaseUrls: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com',
  qianwen: 'https://dashscope.aliyuncs.com/api/v1',
  wenxin: 'https://aip.baidubce.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434',
  custom: 'https://api.code-relay.com/v1'
}

// 根据提供商获取默认模型列表
const providerModels: Record<string, string[]> = {
  openai: ['gpt-4-turbo-preview', 'gpt-4', 'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gemini-3-pro-preview'],
  claude: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  qianwen: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
  wenxin: ['ernie-bot-4', 'ernie-bot-turbo', 'ernie-bot'],
  zhipu: ['glm-4', 'glm-4v', 'glm-3-turbo'],
  gemini: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
  ollama: ['llama2', 'mistral', 'codellama'],
  custom: ['gemini-3-pro-preview', 'gpt-4-turbo-preview', 'gpt-4', 'claude-3-sonnet']
}

const configForm = ref({
  name: '',
  provider: 'openai' as AIProvider,
  apiKey: '',
  baseUrl: '',
  model: '',
  maxTokens: 4096,
  temperature: 0.7,
  topP: 1.0,
  isDefault: false
})

onMounted(async () => {
  await aiStore.fetchConfigs()
  loadSceneConfig()
})

function goHome(): void {
  router.push('/')
}

function handleAddConfig(): void {
  isEditing.value = false
  editingConfigId.value = null
  resetConfigForm()
  showConfigDialog.value = true
}

function handleEditConfig(config: AIConfig): void {
  isEditing.value = true
  editingConfigId.value = config.id
  configForm.value = {
    name: config.name,
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || '',
    model: config.model,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topP: config.topP,
    isDefault: config.isDefault
  }
  showConfigDialog.value = true
}

async function handleDeleteConfig(config: AIConfig): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定要删除配置"${config.name}"吗？`,
      '删除确认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    )
    const success = await aiStore.deleteConfig(config.id)
    if (success) {
      ElMessage.success('配置已删除')
    } else {
      ElMessage.error(aiStore.error || '删除失败')
    }
  } catch {
    // 用户取消
  }
}

async function handleSetDefault(config: AIConfig): Promise<void> {
  if (config.isDefault) return
  const success = await aiStore.setDefault(config.id)
  if (success) {
    ElMessage.success('已设为默认配置')
  } else {
    ElMessage.error(aiStore.error || '设置失败')
  }
}

async function handleTestConnection(config: AIConfig): Promise<void> {
  testing.value = true
  testingConfigId.value = config.id
  try {
    const connected = await aiStore.testConnection(config.id)
    if (connected) {
      ElMessage.success('连接成功！')
    } else {
      ElMessage.error('连接失败，请检查配置')
    }
  } finally {
    testing.value = false
    testingConfigId.value = null
  }
}

function handleThemeChange(val: string | number | boolean | undefined): void {
  if (typeof val === 'string') {
    uiStore.setThemeMode(val as 'light' | 'dark' | 'auto')
  }
}

async function submitConfig(): Promise<void> {
  if (!configForm.value.name.trim()) {
    ElMessage.warning('请输入配置名称')
    return
  }
  if (!configForm.value.apiKey.trim() || configForm.value.apiKey.includes('****')) {
    if (!isEditing.value) {
      ElMessage.warning('请输入API Key')
      return
    }
  }
  if (!configForm.value.model.trim()) {
    ElMessage.warning('请输入或选择模型')
    return
  }

  if (isEditing.value && editingConfigId.value) {
    // 更新配置
    const result = await aiStore.updateConfig(editingConfigId.value, {
      name: configForm.value.name,
      provider: configForm.value.provider,
      apiKey: configForm.value.apiKey,
      baseUrl: configForm.value.baseUrl || undefined,
      model: configForm.value.model,
      maxTokens: configForm.value.maxTokens,
      temperature: configForm.value.temperature,
      topP: configForm.value.topP,
      isDefault: configForm.value.isDefault
    })
    if (result) {
      ElMessage.success('配置已更新')
      showConfigDialog.value = false
    } else {
      ElMessage.error(aiStore.error || '更新失败')
    }
  } else {
    // 创建新配置
    const result = await aiStore.createConfig({
      name: configForm.value.name,
      provider: configForm.value.provider,
      apiKey: configForm.value.apiKey,
      baseUrl: configForm.value.baseUrl || undefined,
      model: configForm.value.model,
      maxTokens: configForm.value.maxTokens,
      temperature: configForm.value.temperature,
      topP: configForm.value.topP,
      isDefault: configForm.value.isDefault
    })
    if (result) {
      ElMessage.success('配置已添加')
      showConfigDialog.value = false
    } else {
      ElMessage.error(aiStore.error || '添加失败')
    }
  }
}

function resetConfigForm(): void {
  configForm.value = {
    name: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1.0,
    isDefault: false
  }
}

function onProviderChange(provider: AIProvider): void {
  configForm.value.baseUrl = providerBaseUrls[provider] || ''
  configForm.value.model = ''
}

function getCurrentModelOptions(): string[] {
  return providerModels[configForm.value.provider] || []
}
</script>

<template>
  <div class="config-view">
    <header class="config-header">
      <div class="header-left">
        <el-button text @click="goHome">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
        <h1>软件设置</h1>
      </div>
    </header>

    <main class="config-content">
      <el-tabs v-model="activeTab" tab-position="left" class="config-tabs">
        <!-- AI配置 -->
        <el-tab-pane label="AI配置" name="ai">
          <div class="tab-content">
            <div class="section-header">
              <h2>AI模型配置</h2>
              <el-button type="primary" @click="handleAddConfig">
                <el-icon><Plus /></el-icon>
                添加配置
              </el-button>
            </div>

            <div v-if="aiStore.loading && aiStore.configs.length === 0" class="loading-state">
              <el-icon class="is-loading"><Loading /></el-icon>
              <span>加载中...</span>
            </div>

            <div v-else-if="aiStore.configs.length === 0" class="empty-state">
              <el-empty description="还没有AI配置，点击上方按钮添加">
                <el-button type="primary" @click="handleAddConfig">添加配置</el-button>
              </el-empty>
            </div>

            <div v-else class="config-list">
              <div
                v-for="config in aiStore.configs"
                :key="config.id"
                class="config-card"
                :class="{ 'is-default': config.isDefault }"
              >
                <div class="config-info">
                  <div class="config-title">
                    <h3>{{ config.name }}</h3>
                    <el-tag v-if="config.isDefault" type="success" size="small">默认</el-tag>
                  </div>
                  <p class="config-detail">
                    <span class="provider">{{ AI_PROVIDER_MAP[config.provider] }}</span>
                    <span class="divider">|</span>
                    <span class="model">{{ config.model }}</span>
                  </p>
                  <p class="config-params">
                    MaxTokens: {{ config.maxTokens }} · Temperature: {{ config.temperature }}
                  </p>
                </div>
                <div class="config-actions">
                  <el-button
                    v-if="!config.isDefault"
                    size="small"
                    @click="handleSetDefault(config)"
                  >
                    设为默认
                  </el-button>
                  <el-button
                    size="small"
                    :loading="testing && testingConfigId === config.id"
                    @click="handleTestConnection(config)"
                  >
                    测试连接
                  </el-button>
                  <el-button size="small" @click="handleEditConfig(config)">编辑</el-button>
                  <el-button size="small" type="danger" @click="handleDeleteConfig(config)">
                    删除
                  </el-button>
                </div>
              </div>
            </div>

            <!-- AI场景配置 -->
            <div class="section-header" style="margin-top: 32px;">
              <h2>AI场景配置</h2>
              <el-button type="primary" @click="saveSceneConfig">
                <el-icon><Check /></el-icon>
                保存配置
              </el-button>
            </div>

            <div class="scene-config-section">
              <!-- 统一模式 -->
              <div class="config-mode">
                <el-radio-group v-model="useUnified">
                  <el-radio :value="true">
                    <span class="radio-label">统一使用默认模型</span>
                  </el-radio>
                </el-radio-group>

                <div v-if="useUnified" class="unified-hint">
                  <el-tag v-if="aiStore.defaultConfig" type="success">
                    当前默认模型：{{ aiStore.defaultConfig.name }}
                  </el-tag>
                  <span v-else class="no-default-hint">请先在上方设置一个默认模型</span>
                </div>
              </div>

              <el-divider>
                <span class="divider-text">或分别配置</span>
              </el-divider>

              <!-- 分场景模式 -->
              <div class="config-mode">
                <el-radio-group v-model="useUnified">
                  <el-radio :value="false">
                    <span class="radio-label">分别配置不同场景</span>
                  </el-radio>
                </el-radio-group>

                <div v-if="!useUnified" class="scene-configs">
                  <div class="scene-hint">
                    <el-icon><InfoFilled /></el-icon>
                    <span>未配置的场景及全局场景将使用"创作"模型</span>
                  </div>
                  <div
                    v-for="sceneType in sceneTypes"
                    :key="sceneType"
                    class="scene-config-item"
                  >
                    <div class="scene-info">
                      <span class="scene-icon">{{ AI_SCENE_TYPE_MAP[sceneType].icon }}</span>
                      <div class="scene-text">
                        <span class="scene-label">
                          {{ AI_SCENE_TYPE_MAP[sceneType].label }}
                          <el-tag v-if="sceneType === 'creative'" size="small" type="warning">默认/全局</el-tag>
                        </span>
                        <span class="scene-desc">{{ AI_SCENE_TYPE_MAP[sceneType].description }}</span>
                      </div>
                    </div>
                    <el-select
                      v-model="sceneConfigs[sceneType]"
                      placeholder="选择配置"
                      size="small"
                      style="width: 200px"
                      clearable
                    >
                      <el-option
                        v-for="config in availableConfigs"
                        :key="config.id"
                        :label="config.name"
                        :value="config.id"
                      />
                    </el-select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 编辑器设置 -->
        <el-tab-pane label="编辑器" name="editor">
          <div class="tab-content">
            <h2>编辑器设置</h2>

            <el-form label-width="120px" class="settings-form">
              <el-form-item label="字体大小">
                <el-slider
                  v-model="uiStore.fontSize"
                  :min="12"
                  :max="24"
                  :step="1"
                  show-input
                />
              </el-form-item>

              <el-form-item label="行高">
                <el-slider
                  v-model="uiStore.lineHeight"
                  :min="1.2"
                  :max="2.5"
                  :step="0.1"
                  show-input
                />
              </el-form-item>

              <el-form-item label="编辑器宽度">
                <el-slider
                  v-model="uiStore.editorWidth"
                  :min="600"
                  :max="1200"
                  :step="50"
                  show-input
                />
              </el-form-item>

              <el-form-item label="显示字数">
                <el-switch v-model="uiStore.showWordCount" />
              </el-form-item>

              <el-form-item label="显示行号">
                <el-switch v-model="uiStore.showLineNumbers" />
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 外观设置 -->
        <el-tab-pane label="外观" name="appearance">
          <div class="tab-content">
            <h2>外观设置</h2>

            <el-form label-width="120px" class="settings-form">
              <el-form-item label="主题模式">
                <el-radio-group v-model="uiStore.themeMode" @change="handleThemeChange">
                  <el-radio value="light">浅色</el-radio>
                  <el-radio value="dark">深色</el-radio>
                  <el-radio value="auto">跟随系统</el-radio>
                </el-radio-group>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <!-- 关于 -->
        <el-tab-pane label="关于" name="about">
          <div class="tab-content">
            <h2>关于 NovelAI Studio</h2>
            <div class="about-info">
              <p><strong>版本：</strong>1.0.0</p>
              <p><strong>描述：</strong>个人AI辅助小说创作工具</p>
              <p class="mt-16">支持多书籍管理、多AI接入、智能创作与逻辑审查</p>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </main>

    <!-- 添加/编辑AI配置对话框 -->
    <el-dialog
      v-model="showConfigDialog"
      :title="isEditing ? '编辑AI配置' : '添加AI配置'"
      width="560px"
      @close="resetConfigForm"
    >
      <el-form :model="configForm" label-width="100px">
        <el-form-item label="配置名称" required>
          <el-input v-model="configForm.name" placeholder="如：GPT-4创作" />
        </el-form-item>

        <el-form-item label="AI提供商" required>
          <el-select
            v-model="configForm.provider"
            placeholder="请选择"
            @change="onProviderChange"
          >
            <el-option
              v-for="option in providerOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="API Key" required>
          <el-input
            v-model="configForm.apiKey"
            type="password"
            show-password
            :placeholder="isEditing ? '留空保持不变' : '请输入API Key'"
          />
        </el-form-item>

        <el-form-item label="API地址">
          <el-input v-model="configForm.baseUrl" placeholder="留空使用默认地址" />
          <div class="form-tip">
            默认地址：{{ providerBaseUrls[configForm.provider] || '无' }}
          </div>
        </el-form-item>

        <el-form-item label="模型名称" required>
          <el-select
            v-if="getCurrentModelOptions().length > 0"
            v-model="configForm.model"
            filterable
            allow-create
            placeholder="选择或输入模型名称"
          >
            <el-option
              v-for="model in getCurrentModelOptions()"
              :key="model"
              :label="model"
              :value="model"
            />
          </el-select>
          <el-input v-else v-model="configForm.model" placeholder="请输入模型名称" />
        </el-form-item>

        <el-form-item label="最大Token">
          <el-input-number v-model="configForm.maxTokens" :min="256" :max="128000" :step="256" />
        </el-form-item>

        <el-form-item label="Temperature">
          <el-slider
            v-model="configForm.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            show-input
            :show-input-controls="false"
          />
          <div class="form-tip">控制输出的随机性，值越大创造性越强</div>
        </el-form-item>

        <el-form-item label="Top P">
          <el-slider
            v-model="configForm.topP"
            :min="0"
            :max="1"
            :step="0.05"
            show-input
            :show-input-controls="false"
          />
        </el-form-item>

        <el-form-item label="设为默认">
          <el-switch v-model="configForm.isDefault" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showConfigDialog = false">取消</el-button>
        <el-button type="primary" @click="submitConfig" :loading="aiStore.loading">
          {{ isEditing ? '保存' : '添加' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped lang="scss">
// ==========================================
// AI 配置页面样式 - Gemini 3 Pro 设计方案
// ==========================================

.config-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-base, $dark-bg-base);
}

// ==========================================
// 页面头部
// ==========================================
.config-header {
  height: $header-height;
  padding: 0 $spacing-xl;
  display: flex;
  align-items: center;
  background-color: var(--bg-surface, $dark-bg-surface);
  border-bottom: 1px solid var(--border-base, $dark-border-base);
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: $spacing-base;

    h1 {
      font-size: $font-size-large;
      font-weight: 600;
      color: var(--text-primary, $dark-text-primary);
    }
  }
}

// ==========================================
// 配置内容
// ==========================================
.config-content {
  flex: 1;
  overflow: hidden;
}

.config-tabs {
  height: 100%;

  :deep(.el-tabs__header) {
    width: 180px;
    background-color: var(--bg-surface, $dark-bg-surface);
    border-right: 1px solid var(--border-base, $dark-border-base);
    margin-right: 0;

    .el-tabs__item {
      height: 48px;
      line-height: 48px;
      color: var(--text-secondary, $dark-text-secondary);
      transition: all $transition-duration-fast $transition-timing;

      &:hover {
        color: var(--text-primary, $dark-text-primary);
      }

      &.is-active {
        color: $primary-color;
        background-color: rgba($primary-color, 0.1);
      }
    }
  }

  :deep(.el-tabs__content) {
    padding: $spacing-xl $spacing-xxl;
    height: 100%;
    overflow-y: auto;
    background-color: var(--bg-base, $dark-bg-base);
  }
}

// ==========================================
// Tab 内容区
// ==========================================
.tab-content {
  max-width: 900px;

  h2 {
    font-size: $font-size-large;
    font-weight: 600;
    margin-bottom: $spacing-xl;
    color: var(--text-primary, $dark-text-primary);
  }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $spacing-xl;

  h2 {
    margin-bottom: 0;
  }
}

// ==========================================
// 加载和空状态
// ==========================================
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
  padding: $spacing-xxxl;
  color: var(--text-secondary, $dark-text-secondary);

  .el-icon {
    font-size: 24px;
    color: $primary-color;
  }
}

.empty-state {
  padding: $spacing-xxxl;
}

// ==========================================
// 配置卡片列表
// ==========================================
.config-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
}

.config-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $spacing-base $spacing-lg;
  background-color: var(--card-bg, $dark-bg-surface);
  border: 1px solid var(--border-base, $dark-border-base);
  border-radius: $border-radius-lg;
  transition: all $transition-duration $transition-timing;

  &:hover {
    border-color: rgba($primary-color, 0.5);
    box-shadow: var(--card-shadow, $dark-card-shadow);
  }

  &.is-default {
    border-color: rgba($success-color, 0.5);
    background-color: rgba($success-color, 0.05);

    &:hover {
      border-color: $success-color;
    }
  }
}

.config-info {
  flex: 1;

  .config-title {
    display: flex;
    align-items: center;
    gap: $spacing-sm;
    margin-bottom: $spacing-xs;

    h3 {
      font-size: $font-size-base;
      font-weight: 600;
      color: var(--text-primary, $dark-text-primary);
    }
  }

  .config-detail {
    font-size: $font-size-small;
    color: var(--text-secondary, $dark-text-secondary);
    margin-bottom: $spacing-xs;

    .provider {
      color: $primary-color;
    }

    .divider {
      margin: 0 $spacing-sm;
      color: var(--border-base, $dark-border-base);
    }

    .model {
      font-family: $font-family-mono;
      font-size: $font-size-extra-small;
    }
  }

  .config-params {
    font-size: $font-size-extra-small;
    color: var(--text-muted, $dark-text-muted);
    font-family: $font-family-mono;
  }
}

.config-actions {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  flex-shrink: 0;
}

// ==========================================
// 设置表单
// ==========================================
.settings-form {
  max-width: 600px;

  :deep(.el-form-item__label) {
    color: var(--text-secondary, $dark-text-secondary);
  }

  :deep(.el-slider) {
    padding-right: 60px;
  }
}

// ==========================================
// 关于页面
// ==========================================
.about-info {
  p {
    margin-bottom: $spacing-sm;
    color: var(--text-secondary, $dark-text-secondary);
    line-height: 1.6;

    strong {
      color: var(--text-primary, $dark-text-primary);
    }
  }

  .mt-16 {
    margin-top: $spacing-base;
  }
}

// ==========================================
// AI场景配置样式
// ==========================================
.scene-config-section {
  background-color: var(--card-bg, $dark-bg-surface);
  border: 1px solid var(--border-base, $dark-border-base);
  border-radius: $border-radius-lg;
  padding: $spacing-lg;
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

  .unified-hint {
    margin-top: 12px;
    margin-left: 24px;

    .no-default-hint {
      color: var(--el-color-warning);
      font-size: 13px;
    }
  }
}

.scene-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background-color: rgba(var(--el-color-primary-rgb, 249, 115, 22), 0.1);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary, $dark-text-secondary);
  margin-bottom: 12px;

  .el-icon {
    color: var(--el-color-primary);
  }
}

.config-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;

  .model-name {
    font-size: 12px;
    color: var(--text-secondary, $dark-text-secondary);
  }
}

.divider-text {
  font-size: 12px;
  color: var(--text-muted, $dark-text-muted);
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
  padding: 12px 16px;
  background-color: var(--bg-surface, $dark-bg-base);
  border-radius: 8px;
  border: 1px solid var(--border-base, $dark-border-base);
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
      color: var(--text-primary, $dark-text-primary);
    }

    .scene-desc {
      font-size: 11px;
      color: var(--text-secondary, $dark-text-secondary);
    }
  }
}

// ==========================================
// 表单提示
// ==========================================
.form-tip {
  font-size: $font-size-extra-small;
  color: var(--text-muted, $dark-text-muted);
  margin-top: $spacing-xs;
}

// ==========================================
// 对话框样式覆盖
// ==========================================
:deep(.el-dialog) {
  border-radius: $border-radius-lg;
  background-color: var(--dialog-bg, $dark-bg-surface);
  border: 1px solid var(--border-base, $dark-border-base);

  .el-dialog__header {
    padding: $spacing-base $spacing-lg;
    border-bottom: 1px solid var(--border-base, $dark-border-base);

    .el-dialog__title {
      color: var(--text-primary, $dark-text-primary);
    }
  }

  .el-dialog__body {
    padding: $spacing-lg;
  }

  .el-dialog__footer {
    padding: $spacing-base $spacing-lg;
    border-top: 1px solid var(--border-base, $dark-border-base);
  }
}
</style>
