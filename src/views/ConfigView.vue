<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAiStore, useUiStore } from '@/stores'
import { AI_PROVIDER_MAP } from '@/types'
import type { AIProvider, AIConfig } from '@/types'
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
.config-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: $bg-page;
}

.config-header {
  height: $header-height;
  padding: 0 24px;
  display: flex;
  align-items: center;
  background-color: $bg-base;
  border-bottom: 1px solid $border-light;

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;

    h1 {
      font-size: 18px;
      font-weight: 600;
    }
  }
}

.config-content {
  flex: 1;
  overflow: hidden;
}

.config-tabs {
  height: 100%;

  :deep(.el-tabs__header) {
    width: 160px;
    background-color: $bg-base;
  }

  :deep(.el-tabs__content) {
    padding: 24px;
    height: 100%;
    overflow-y: auto;
  }
}

.tab-content {
  max-width: 800px;

  h2 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 24px;
  }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;

  h2 {
    margin-bottom: 0;
  }
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: $text-secondary;
}

.empty-state {
  padding: 48px;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background-color: $bg-base;
  border: 1px solid $border-light;
  border-radius: $border-radius-base;
  transition: all 0.2s ease;

  &:hover {
    border-color: $primary-color;
  }

  &.is-default {
    border-color: $success-color;
    background-color: rgba($success-color, 0.02);
  }
}

.config-info {
  flex: 1;

  .config-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;

    h3 {
      font-size: 15px;
      font-weight: 600;
    }
  }

  .config-detail {
    font-size: 13px;
    color: $text-regular;
    margin-bottom: 4px;

    .divider {
      margin: 0 8px;
      color: $border-light;
    }
  }

  .config-params {
    font-size: 12px;
    color: $text-secondary;
  }
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-form {
  max-width: 500px;
}

.about-info {
  p {
    margin-bottom: 8px;
    color: $text-regular;
  }
}

.form-tip {
  font-size: 12px;
  color: $text-secondary;
  margin-top: 4px;
}
</style>
