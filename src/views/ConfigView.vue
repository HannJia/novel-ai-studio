<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAiStore, useUiStore } from '@/stores'
import { AI_PROVIDER_MAP } from '@/types'
import type { AIProvider } from '@/types'

const router = useRouter()
const aiStore = useAiStore()
const uiStore = useUiStore()

const activeTab = ref('ai')
const showAddConfigDialog = ref(false)

const providerOptions = Object.entries(AI_PROVIDER_MAP).map(([value, label]) => ({
  value: value as AIProvider,
  label
}))

const newConfigForm = ref({
  name: '',
  provider: 'openai' as AIProvider,
  apiKey: '',
  baseUrl: '',
  model: '',
  maxTokens: 4096,
  temperature: 0.7,
  topP: 1.0
})

function goHome(): void {
  router.push('/')
}

function handleAddConfig(): void {
  showAddConfigDialog.value = true
}

async function submitConfig(): Promise<void> {
  // TODO: 保存配置
  showAddConfigDialog.value = false
}

function resetConfigForm(): void {
  newConfigForm.value = {
    name: '',
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    model: '',
    maxTokens: 4096,
    temperature: 0.7,
    topP: 1.0
  }
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

            <div v-if="aiStore.configs.length === 0" class="empty-state">
              <el-empty description="还没有AI配置，点击上方按钮添加">
                <el-button type="primary" @click="handleAddConfig">添加配置</el-button>
              </el-empty>
            </div>

            <div v-else class="config-list">
              <div
                v-for="config in aiStore.configs"
                :key="config.id"
                class="config-card"
              >
                <div class="config-info">
                  <h3>{{ config.name }}</h3>
                  <p>{{ AI_PROVIDER_MAP[config.provider] }} - {{ config.model }}</p>
                </div>
                <div class="config-actions">
                  <el-tag v-if="config.isDefault" type="success">默认</el-tag>
                  <el-button text size="small">编辑</el-button>
                  <el-button text size="small" type="danger">删除</el-button>
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
                <el-radio-group v-model="uiStore.themeMode" @change="uiStore.setThemeMode">
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

    <!-- 添加AI配置对话框 -->
    <el-dialog
      v-model="showAddConfigDialog"
      title="添加AI配置"
      width="500px"
      @close="resetConfigForm"
    >
      <el-form :model="newConfigForm" label-width="100px">
        <el-form-item label="配置名称" required>
          <el-input v-model="newConfigForm.name" placeholder="如：GPT-4创作" />
        </el-form-item>
        <el-form-item label="AI提供商" required>
          <el-select v-model="newConfigForm.provider" placeholder="请选择">
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
            v-model="newConfigForm.apiKey"
            type="password"
            show-password
            placeholder="请输入API Key"
          />
        </el-form-item>
        <el-form-item label="API地址">
          <el-input v-model="newConfigForm.baseUrl" placeholder="留空使用默认地址" />
        </el-form-item>
        <el-form-item label="模型名称" required>
          <el-input v-model="newConfigForm.model" placeholder="如：gpt-4" />
        </el-form-item>
        <el-form-item label="最大Token">
          <el-input-number v-model="newConfigForm.maxTokens" :min="256" :max="128000" />
        </el-form-item>
        <el-form-item label="Temperature">
          <el-slider v-model="newConfigForm.temperature" :min="0" :max="2" :step="0.1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddConfigDialog = false">取消</el-button>
        <el-button type="primary" @click="submitConfig">保存</el-button>
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
  padding: 16px;
  background-color: $bg-base;
  border: 1px solid $border-light;
  border-radius: $border-radius-base;

  h3 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  p {
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
</style>
