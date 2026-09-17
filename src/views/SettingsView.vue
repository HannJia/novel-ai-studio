<template>
  <div class="page-container fade-in" id="settings-page">
    <div class="settings-header">
      <button class="back-btn" @click="returnToPreviousPage">
        <n-icon :size="20"><arrow-back-outline /></n-icon>
        <span>{{ returnPath ? '返回上页' : '返回书架' }}</span>
      </button>
      <h1 class="page-title">设置</h1>
    </div>

    <div class="settings-content">
      <!-- 模型配置 -->
      <section class="settings-section paper-panel">
        <div class="section-header">
          <h3>🤖 AI 模型配置</h3>
          <n-button type="primary" size="small" @click="openAddModel" id="add-model-btn">
            + 添加模型
          </n-button>
        </div>

        <!-- 模型列表 -->
        <div v-if="configStore.models.length === 0" class="empty-models">
          <p>还没有配置任何 AI 模型</p>
          <p class="hint">添加一个模型来开始使用 AI 功能</p>
        </div>
        <div v-else class="model-list">
          <div
            v-for="model in configStore.models"
            :key="model.id"
            class="model-card"
          >
            <div class="model-info">
              <div class="model-name">{{ model.modelName }}</div>
              <div v-if="model.name && model.name !== model.modelName" class="model-detail">备注：{{ model.name }}</div>
              <div class="model-detail">{{ maskKey(model.apiKey) }}</div>
              <div class="model-badges">
                <span v-if="configStore.assignments.outline === model.id" class="badge badge-outline">大纲</span>
                <span v-if="configStore.assignments.writing === model.id" class="badge badge-writing">写作</span>
                <span v-if="configStore.assignments.review === model.id" class="badge badge-review">审查</span>
                <span v-if="configStore.assignments.chat === model.id" class="badge badge-outline">对话 / 联网</span>
              </div>
            </div>
            <div class="model-actions">
              <n-button size="tiny" quaternary @click="testModel(model)" :loading="testingId === model.id">
                {{ testingId === model.id ? '测试中...' : '测试对话' }}
              </n-button>
              <n-button size="tiny" quaternary @click="editModel(model)" title="打开模型设置，单独测试搜索能力">
                <template #icon><n-icon><globe-outline /></n-icon></template>测试联网
              </n-button>
              <n-button size="tiny" quaternary @click="editModel(model)">编辑</n-button>
              <n-button size="tiny" quaternary type="error" @click="handleDeleteModel(model.id)">删除</n-button>
            </div>
          </div>
        </div>
      </section>

      <!-- 模型用途分配 -->
      <section v-if="configStore.models.length > 0" class="settings-section paper-panel">
        <h3>🎯 模型用途分配</h3>
        <p class="section-desc">为不同 AI 任务指定使用的模型</p>
        <div class="assignment-grid">
          <div class="assignment-item">
            <label>大纲生成</label>
            <n-select
              :value="configStore.assignments.outline"
              :options="modelOptions"
              @update:value="(v: string) => configStore.setAssignment('outline', v)"
              placeholder="选择模型"
            />
          </div>
          <div class="assignment-item">
            <label>正文写作</label>
            <n-select
              :value="configStore.assignments.writing"
              :options="modelOptions"
              @update:value="(v: string) => configStore.setAssignment('writing', v)"
              placeholder="选择模型"
            />
          </div>
          <div class="assignment-item">
            <label>章节审查</label>
            <n-select
              :value="configStore.assignments.review"
              :options="modelOptions"
              @update:value="(v: string) => configStore.setAssignment('review', v)"
              placeholder="选择模型"
            />
          </div>
          <div class="assignment-item chat-assignment">
            <label>对话 / 联网模型</label>
            <n-select
              :value="configStore.assignments.chat"
              :options="chatModelOptions"
              @update:value="(v: string) => configStore.setAssignment('chat', v)"
              aria-label="对话 / 联网模型"
              placeholder="默认跟随大纲模型"
            />
            <p class="assignment-hint">用于灵感对话和右下角对话窗口。联网开关只控制是否搜索；大纲生成、设定整理仍使用大纲模型。所选模型的接口需支持联网协议。</p>
          </div>
        </div>
      </section>

      <section class="settings-section paper-panel">
        <h3>AI 工作流</h3>
        <p class="section-desc">控制生成后的自动检查次数与后台 AI 调用量。章节结尾完整性检查在所有模式下都会保留。</p>
        <n-select
          :value="configStore.aiWorkflowMode"
          :options="workflowModeOptions"
          @update:value="configStore.setAiWorkflowMode"
        />
      </section>

      <section class="settings-section paper-panel security-section" :class="`security-${configStore.securityStatus.storage}`">
        <h3>密钥存储</h3>
        <p v-if="configStore.securityStatus.storage === 'encrypted'" class="section-desc">
          接口密钥已由操作系统安全存储加密后写入本机配置文件。
        </p>
        <p v-else-if="configStore.securityStatus.storage === 'local-development'" class="section-desc">
          当前是本机开发环境，接口密钥会保存在本机浏览器配置中，方便调试使用。不要在共享电脑或公开地址中使用此模式。
        </p>
        <p v-else class="section-desc">
          当前环境不提供系统加密。接口密钥只在本次应用会话中保留，关闭应用或浏览器标签后需要重新填写，持久化配置不会写入明文密钥。
        </p>
      </section>

      <!-- 真实向量记忆 -->
      <section class="settings-section paper-panel">
        <div class="section-header">
          <div>
            <h3>向量记忆</h3>
            <p class="section-desc section-desc-inline">连接 BGE-M3 等兼容接口的文本向量服务</p>
          </div>
          <n-switch :value="embeddingForm.enabled" @update:value="handleEmbeddingEnabledChange" />
        </div>
        <div v-if="embeddingForm.enabled" class="embedding-form">
          <div class="embedding-grid">
            <div class="form-item span-2">
              <label>向量服务接口地址</label>
              <n-input v-model:value="embeddingForm.baseUrl" placeholder="http://127.0.0.1:11434" />
            </div>
            <div class="form-item">
              <label>模型名称</label>
              <n-input v-model:value="embeddingForm.modelName" placeholder="bge-m3" />
            </div>
            <div class="form-item">
              <label>批量大小</label>
              <n-input-number v-model:value="embeddingForm.batchSize" :min="1" :max="64" />
            </div>
            <div class="form-item span-2">
              <label>接口密钥（本地服务可留空）</label>
              <n-input v-model:value="embeddingForm.apiKey" type="password" show-password-on="click" placeholder="可选" />
            </div>
          </div>
          <p class="privacy-note">启用后，章节摘要、角色、事件、弧线和已绑定知识条目会发送到该接口生成向量。</p>
          <div class="section-actions">
            <n-button :loading="testingEmbedding" @click="handleTestEmbedding">测试连接</n-button>
            <n-button type="primary" :disabled="!embeddingForm.baseUrl.trim() || !embeddingForm.modelName.trim()" @click="saveEmbedding">保存向量配置</n-button>
          </div>
        </div>
        <div v-else class="disabled-hint">未启用时继续使用本地混合检索，不影响现有写作功能。</div>
      </section>

      <!-- 写作 Skill -->
      <section class="settings-section paper-panel">
        <div class="section-header">
          <div>
            <h3>写作技能</h3>
            <p class="section-desc section-desc-inline">按任务自动注入的可复用写作规则</p>
          </div>
          <n-button type="primary" size="small" @click="openSkillModal()">添加技能</n-button>
        </div>
        <div class="skill-list">
          <div v-for="skill in configStore.skills" :key="skill.id" class="skill-row">
            <n-switch :value="skill.enabled" @update:value="value => configStore.updateSkill(skill.id, { enabled: value })" />
            <div class="skill-info">
              <div class="skill-name">
                <strong>{{ skill.name }}</strong>
                <n-tag size="small" :type="skill.builtIn ? 'info' : 'default'">{{ skill.builtIn ? '内置' : '自定义' }}</n-tag>
                <n-tag size="small">{{ skillTaskLabel(skill.task) }}</n-tag>
              </div>
              <p>{{ skill.description }}</p>
            </div>
            <div v-if="!skill.builtIn" class="model-actions">
              <n-button size="tiny" quaternary @click="openSkillModal(skill)">编辑</n-button>
              <n-button size="tiny" quaternary type="error" @click="handleDeleteSkill(skill.id)">删除</n-button>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section paper-panel">
        <h3>软件更新</h3>
        <AppUpdatePanel />
      </section>

      <!-- 关于 -->
      <section class="settings-section paper-panel about-section">
        <h3>📖 关于</h3>
        <p>AI 长篇小说写作软件 v{{ appVersion }}</p>
        <p class="hint">使用 Electron + Vue 3 + TypeScript 构建</p>
      </section>
    </div>

    <!-- 添加/编辑模型弹窗 -->
    <n-modal
      v-model:show="showAddModel"
      preset="dialog"
      :title="editingModel ? '编辑模型' : '添加模型'"
      style="width: min(520px, calc(100vw - 32px));"
      @update:show="handleModelModalVisibility"
    >
      <div class="model-form">
        <div class="form-item">
          <label>配置备注（选填）</label>
          <n-input v-model:value="modelForm.name" placeholder="如：主用接口 / 备用接口；留空使用模型 ID" />
          <p class="model-discovery-hint">仅用于区分配置，不改变实际模型。批量添加按各模型原始 ID 命名，不继承此备注。</p>
        </div>
        <div class="form-item">
          <label>接口地址</label>
          <n-input
            v-model:value="modelForm.baseUrl"
            placeholder="如：https://api.deepseek.com"
            @update:value="handleModelSourceChange"
          />
        </div>
        <div class="form-item">
          <label>接口密钥</label>
          <n-input
            v-model:value="modelForm.apiKey"
            type="password"
            show-password-on="click"
            :placeholder="editingModel ? '留空则保留当前接口密钥' : '填写服务商提供的接口密钥'"
            @update:value="handleModelSourceChange"
          />
          <p v-if="editingModel" class="model-discovery-hint">编辑模型时留空不会清除当前接口密钥；只有输入新密钥才会替换。</p>
        </div>
        <div class="form-item">
          <label>模型名称（原始 ID）</label>
          <n-input
            v-model:value="modelForm.modelName"
            placeholder="如：deepseek-chat / gpt-4o / qwen-max"
            @update:value="handleManualModelNameChange"
          />
          <div class="model-discovery-row">
            <n-button
              size="small"
              secondary
              :loading="modelDiscoveryLoading"
              :disabled="!modelForm.baseUrl.trim() || !modelForm.apiKey.trim()"
              @click="fetchAvailableModels"
            >
              {{ modelDiscoveryLoading ? '获取中...' : '获取模型' }}
            </n-button>
            <span v-if="availableModels.length" class="model-discovery-success">已获取 {{ availableModels.length }} 个模型，可多选</span>
            <span v-else class="model-discovery-hint">从兼容 OpenAI 的 /models 接口读取</span>
            <n-button
              v-if="availableModels.length > 1"
              size="small"
              quaternary
              @click="selectAllAvailableModels"
            >
              全选
            </n-button>
          </div>
          <n-select
            v-if="availableModelOptions.length"
            :value="selectedModelNames"
            :options="availableModelOptions"
            filterable
            clearable
            multiple
            @update:value="handleSelectedModelNamesChange"
            placeholder="从已获取的模型中选择，也可手动输入"
          />
          <p v-if="selectedModelNames.length > 1" class="model-discovery-hint">
            <template v-if="!editingModel">
              已选择 {{ selectedModelNames.length }} 个模型，可使用底部“批量添加”创建配置。
            </template>
            <template v-else>
              可点击“保存”更新当前配置，或使用“批量添加”创建选中的模型配置。
            </template>
          </p>
          <p v-if="modelDiscoveryError" class="model-discovery-error">{{ modelDiscoveryError }}</p>
        </div>
        <div class="form-item">
          <label>对话联网协议</label>
          <n-select v-model:value="modelForm.chatSearchProtocol" :options="chatSearchProtocolOptions" />
          <p class="model-discovery-hint">在灵感对话或右下角对话窗口开启“联网”时使用。接口密钥和模型列表不代表搜索权限；中转接口需支持所选协议。</p>
          <ModelSearchTest v-if="showAddModel" :model="searchTestModel" />
        </div>
        <div class="form-row">
          <div class="form-item">
            <label>随机程度</label>
            <n-input-number v-model:value="modelForm.temperature" :min="0" :max="2" :step="0.1" />
          </div>
          <div class="form-item">
            <label>采样范围</label>
            <n-input-number v-model:value="modelForm.topP" :min="0" :max="1" :step="0.1" />
          </div>
          <div class="form-item">
            <label>最大输出词元数</label>
            <n-input-number v-model:value="modelForm.maxTokens" :min="256" :max="128000" :step="256" />
          </div>
        </div>
      </div>
      <template #action>
        <n-button @click="closeModelModal">取消</n-button>
        <n-button
          v-if="selectedModelNames.length > 1"
          secondary
          type="primary"
          :disabled="!isBatchFormValid"
          @click="handleBatchSaveModels"
        >
          批量添加（{{ selectedModelNames.length }}）
        </n-button>
        <n-button
          v-if="editingModel || selectedModelNames.length <= 1"
          type="primary"
          :disabled="!isFormValid"
          @click="handleSaveModel"
        >
          {{ editingModel ? '保存' : '添加' }}
        </n-button>
      </template>
    </n-modal>

    <n-modal v-model:show="showSkillModal" preset="card" :title="editingSkill ? '编辑技能' : '添加技能'" style="width: min(620px, calc(100vw - 32px));">
      <div class="model-form">
        <div class="form-item">
          <label>名称</label>
          <n-input v-model:value="skillForm.name" placeholder="例如：悬疑线索控制" />
        </div>
        <div class="form-item">
          <label>适用任务</label>
          <n-select v-model:value="skillForm.task" :options="skillTaskOptions" />
        </div>
        <div class="form-item">
          <label>简要说明</label>
          <n-input v-model:value="skillForm.description" placeholder="说明这个技能解决什么问题" />
        </div>
        <div class="form-item">
          <label>执行规则</label>
          <n-input v-model:value="skillForm.instructions" type="textarea" :rows="8" placeholder="写给 AI 的明确规则；只写约束和方法，不要加入具体小说内容。" />
        </div>
      </div>
      <template #footer>
        <div class="section-actions">
          <n-button @click="showSkillModal = false">取消</n-button>
          <n-button type="primary" :disabled="!skillForm.name.trim() || !skillForm.instructions.trim()" @click="saveSkill">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import AppUpdatePanel from '@/components/AppUpdatePanel.vue'
import ModelSearchTest from '@/components/ModelSearchTest.vue'
import { ref, computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NIcon, NInput, NInputNumber, NSelect, NModal, NSwitch, NTag, useMessage, useDialog } from 'naive-ui'
import { ArrowBackOutline, GlobeOutline } from '@vicons/ionicons5'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { listAvailableModels, openAiV1BaseUrl, testConnection, type AvailableModel } from '@/services/ai'
import { testEmbeddingConnection } from '@/services/embeddings'
import { chatSearchProtocolOptions } from '@/services/chatSearch'
import type { ChatSearchProtocol } from '@/types/chat'
import type { WritingSkill, WritingSkillTask } from '@/types/skill'
import type { AiWorkflowMode } from '@/services/aiWorkflow'
import { version as appVersion } from '../../package.json'

const configStore = useConfigStore()
const message = useMessage()
const dialog = useDialog()
const route = useRoute()
const router = useRouter()

const returnPath = computed(() => {
  const candidate = String(route?.query?.returnTo || '')
  return candidate.startsWith('/') && candidate !== '/settings' ? candidate : ''
})

function returnToPreviousPage() {
  if (!router) return
  void router.push(returnPath.value || '/')
}

const showAddModel = ref(false)
const editingModel = ref<string | null>(null)
const testingId = ref<string | null>(null)
const availableModels = ref<AvailableModel[]>([])
const selectedModelNames = ref<string[]>([])
const modelDiscoveryLoading = ref(false)
const modelDiscoveryError = ref('')
let modelDiscoveryController: AbortController | null = null
const testingEmbedding = ref(false)
const showSkillModal = ref(false)
const editingSkill = ref<string | null>(null)

const embeddingForm = reactive({ ...configStore.embedding })
const skillTaskOptions = [
  { label: '全部 AI 任务', value: 'all' },
  { label: '大纲与规划', value: 'planning' },
  { label: '正文写作', value: 'writing' },
  { label: '章节审查', value: 'review' },
  { label: '结构化分析', value: 'analysis' },
]
const workflowModeOptions: Array<{ label: string; value: AiWorkflowMode }> = [
  { label: '均衡：完整生成、自检与结尾复核', value: 'balanced' },
  { label: '快速：减少计划、自检和后台调用', value: 'fast' },
  { label: '严谨：增加结尾补写与审查轮次', value: 'strict' },
]
const skillForm = reactive({ name: '', description: '', task: 'writing' as WritingSkillTask, instructions: '' })

// 模型表单
const modelForm = reactive({
  name: '',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4096,
  chatSearchProtocol: 'auto' as ChatSearchProtocol,
})
const searchTestModel = computed<ModelConfig>(() => ({
  ...modelForm,
  id: editingModel.value || 'search-test',
  apiKey: modelForm.apiKey.trim() || configStore.models.find(model => model.id === editingModel.value)?.apiKey || '',
}))

// 模型选项
const modelOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const model of configStore.models) counts.set(model.modelName, (counts.get(model.modelName) || 0) + 1)
  return configStore.models.map(model => ({
    label: counts.get(model.modelName)! > 1 && model.name && model.name !== model.modelName
      ? `${model.modelName}（备注：${model.name}）`
      : model.modelName,
    value: model.id,
  }))
})
const chatModelOptions = computed(() => [
  { label: '默认跟随大纲模型', value: '' },
  ...modelOptions.value,
])

const availableModelOptions = computed(() => availableModels.value.map(model => ({
  label: model.ownedBy ? `${model.id} · ${model.ownedBy}` : model.id,
  value: model.id,
})))

// 表单是否有效
const isFormValid = computed(() =>
  Boolean(
    modelForm.baseUrl.trim()
    && modelForm.modelName.trim()
    && (modelForm.apiKey.trim() || (editingModel.value && configStore.models.some(model => model.id === editingModel.value && model.apiKey))),
  )
)
const isBatchFormValid = computed(() =>
  Boolean(modelForm.baseUrl.trim() && modelForm.apiKey.trim() && selectedModelNames.value.length > 1)
)

// 遮蔽 API Key
function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.substring(0, 4) + '****' + key.substring(key.length - 4)
}

// 编辑模型
function editModel(model: ModelConfig) {
  editingModel.value = model.id
  Object.assign(modelForm, {
    name: model.name,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    modelName: model.modelName,
    temperature: model.temperature,
    topP: model.topP,
    maxTokens: model.maxTokens,
    chatSearchProtocol: model.chatSearchProtocol || 'auto',
  })
  availableModels.value = []
  selectedModelNames.value = [model.modelName]
  modelDiscoveryError.value = ''
  showAddModel.value = true
}

function openAddModel() {
  resetForm()
  availableModels.value = []
  selectedModelNames.value = []
  modelDiscoveryError.value = ''
  showAddModel.value = true
}

function handleModelSourceChange() {
  if (!availableModels.value.length) return
  availableModels.value = []
  selectedModelNames.value = []
  modelDiscoveryError.value = ''
}

async function fetchAvailableModels() {
  modelDiscoveryController?.abort()
  const controller = new AbortController()
  modelDiscoveryController = controller
  modelDiscoveryLoading.value = true
  modelDiscoveryError.value = ''
  try {
    const models = await listAvailableModels({
      baseUrl: modelForm.baseUrl,
      apiKey: modelForm.apiKey,
    }, controller.signal)
    if (controller.signal.aborted) return
    availableModels.value = models
    if (models.length === 0) {
      modelDiscoveryError.value = '接口返回了空模型列表，请确认地址和密钥对应的服务。'
      return
    }
    const currentModelName = modelForm.modelName.trim()
    const initialModelName = models.some(model => model.id === currentModelName) ? currentModelName : models[0].id
    selectedModelNames.value = [initialModelName]
    modelForm.modelName = initialModelName
    message.success(`已获取 ${models.length} 个可用模型，请选择模型名称`)
  } catch (error: unknown) {
    if (controller.signal.aborted) return
    modelDiscoveryError.value = error instanceof Error ? error.message : '获取模型失败，请检查接口地址和接口密钥'
  } finally {
    if (modelDiscoveryController === controller) {
      modelDiscoveryController = null
      modelDiscoveryLoading.value = false
    }
  }
}

function handleSelectedModelNamesChange(value: string[]) {
  selectedModelNames.value = value
  modelForm.modelName = value[0] || ''
}

function handleManualModelNameChange(value: string) {
  modelForm.modelName = value
  const trimmed = value.trim()
  if (!trimmed || selectedModelNames.value.some(modelName => modelName !== trimmed)) {
    selectedModelNames.value = trimmed ? [trimmed] : []
  }
}

function selectAllAvailableModels() {
  selectedModelNames.value = availableModels.value.map(model => model.id)
  modelForm.modelName = selectedModelNames.value[0] || ''
}

// 保存模型
function handleSaveModel() {
  if (!isFormValid.value) return
  const modelName = modelForm.modelName.trim()
  const existingModel = editingModel.value
    ? configStore.models.find(model => model.id === editingModel.value)
    : null
  const apiKey = modelForm.apiKey.trim() || existingModel?.apiKey || ''
  if (!apiKey) return
  const config = { ...modelForm, apiKey, name: modelForm.name.trim() || modelName, modelName }
  if (editingModel.value) {
    configStore.updateModel(editingModel.value, config)
    message.success('模型配置已更新')
  } else {
    configStore.addModel(config)
    message.success('模型已添加')
  }
  closeModelModal()
  resetForm()
}

function modelConfigKey(baseUrl: string, modelName: string, apiKey: string) {
  return `${openAiV1BaseUrl(baseUrl).toLowerCase()}::${modelName.trim()}::${apiKey.trim()}`
}

function handleBatchSaveModels() {
  if (!isBatchFormValid.value) return
  const selected = availableModels.value.filter(model => selectedModelNames.value.includes(model.id))
  if (selected.length < 2) {
    message.warning('请至少选择两个模型后再批量添加')
    return
  }

  const baseUrl = modelForm.baseUrl.trim()
  const apiKey = modelForm.apiKey.trim()
  const existing = new Set(configStore.models.map(model => modelConfigKey(model.baseUrl, model.modelName, model.apiKey)))
  let added = 0
  let skipped = 0

  for (const model of selected) {
    const key = modelConfigKey(baseUrl, model.id, apiKey)
    if (existing.has(key)) {
      skipped += 1
      continue
    }
    configStore.addModel({
      name: model.id,
      baseUrl,
      apiKey,
      modelName: model.id,
      temperature: modelForm.temperature,
      topP: modelForm.topP,
      maxTokens: modelForm.maxTokens,
      chatSearchProtocol: modelForm.chatSearchProtocol,
    })
    existing.add(key)
    added += 1
  }

  if (added) {
    message.success(`已添加 ${added} 个模型${skipped ? `，跳过 ${skipped} 个重复配置` : ''}`)
  } else {
    message.info('所选模型都已存在，未新增配置')
  }
  closeModelModal()
  resetForm()
}

function closeModelModal() {
  modelDiscoveryController?.abort()
  modelDiscoveryController = null
  modelDiscoveryLoading.value = false
  showAddModel.value = false
}

function handleModelModalVisibility(visible: boolean) {
  if (!visible) {
    modelDiscoveryController?.abort()
    modelDiscoveryController = null
    modelDiscoveryLoading.value = false
  }
  showAddModel.value = visible
}

// 删除模型
function handleDeleteModel(id: string) {
  dialog.warning({
    title: '确认删除',
    content: '确定要删除这个模型配置吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      configStore.deleteModel(id)
      message.success('模型已删除')
    },
  })
}

// 测试连接
async function testModel(model: ModelConfig) {
  testingId.value = model.id
  const result = await testConnection(model)
  testingId.value = null
  if (result.ok) {
    message.success(result.message)
  } else {
    message.error(result.message)
  }
}

// 重置表单
function resetForm() {
  editingModel.value = null
  selectedModelNames.value = []
  Object.assign(modelForm, {
    name: '',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 4096,
    chatSearchProtocol: 'auto',
  })
}

function saveEmbedding() {
  configStore.updateEmbeddingConfig({
    enabled: embeddingForm.enabled,
    baseUrl: embeddingForm.baseUrl.trim(),
    apiKey: embeddingForm.apiKey.trim(),
    modelName: embeddingForm.modelName.trim(),
    batchSize: Math.min(64, Math.max(1, Math.round(embeddingForm.batchSize || 16))),
  })
  message.success('向量记忆配置已保存')
}

function handleEmbeddingEnabledChange(enabled: boolean) {
  embeddingForm.enabled = enabled
  configStore.updateEmbeddingConfig({ enabled })
}

async function handleTestEmbedding() {
  if (!embeddingForm.baseUrl.trim() || !embeddingForm.modelName.trim()) {
    message.warning('请先填写接口地址和模型名称')
    return
  }
  testingEmbedding.value = true
  try {
    const result = await testEmbeddingConnection({ ...embeddingForm, enabled: true })
    message.success(`连接成功：${result.dimensions} 维，${result.latency} ms`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '向量服务连接失败')
  } finally {
    testingEmbedding.value = false
  }
}

function skillTaskLabel(task: WritingSkillTask) {
  return skillTaskOptions.find(option => option.value === task)?.label || task
}

function openSkillModal(skill?: WritingSkill) {
  editingSkill.value = skill?.id || null
  Object.assign(skillForm, skill ? {
    name: skill.name,
    description: skill.description,
    task: skill.task,
    instructions: skill.instructions,
  } : { name: '', description: '', task: 'writing', instructions: '' })
  showSkillModal.value = true
}

function saveSkill() {
  const data = {
    name: skillForm.name.trim(),
    description: skillForm.description.trim(),
    task: skillForm.task,
    instructions: skillForm.instructions.trim(),
  }
  if (editingSkill.value) configStore.updateSkill(editingSkill.value, data)
  else configStore.addSkill(data)
  showSkillModal.value = false
  message.success('技能已保存')
}

function handleDeleteSkill(id: string) {
  dialog.warning({
    title: '删除技能',
    content: '确定删除这个自定义技能？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      configStore.deleteSkill(id)
      message.success('技能已删除')
    },
  })
}
</script>

<style scoped>
.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: var(--space-xl);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.back-btn:hover {
  color: var(--text-color-primary);
  background: var(--bg-color-hover);
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  max-width: 800px;
}

.settings-section {
  padding: var(--space-lg);
}

.settings-section h3 {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: var(--space-md);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.section-header h3 {
  margin-bottom: 0;
}

.section-desc {
  font-size: 13px;
  color: var(--text-color-tertiary);
  margin-top: -8px;
  margin-bottom: var(--space-md);
}

.section-desc-inline { margin: 4px 0 0; }
.embedding-form { display: flex; flex-direction: column; gap: 12px; }
.embedding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.embedding-grid .form-item { display: flex; flex-direction: column; gap: 5px; }
.embedding-grid label { color: var(--text-color-secondary); font-size: 13px; font-weight: 500; }
.span-2 { grid-column: span 2; }
.privacy-note, .disabled-hint { color: var(--text-color-tertiary); font-size: 12px; line-height: 1.6; }
.section-actions { display: flex; justify-content: flex-end; gap: 8px; }
.skill-list { display: flex; flex-direction: column; }
.skill-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 66px; border-top: 1px solid var(--border-color-light); }
.skill-info { min-width: 0; }
.skill-name { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.skill-name strong { color: var(--text-color-primary); font-size: 14px; }
.skill-info p { margin-top: 4px; color: var(--text-color-tertiary); font-size: 12px; }

.empty-models {
  text-align: center;
  padding: var(--space-xl) 0;
  color: var(--text-color-tertiary);
}

.empty-models .hint {
  font-size: 13px;
  margin-top: 4px;
}

/* 模型列表 */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.model-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-color);
  border: 1px solid var(--border-color-light);
  transition: border-color var(--transition-fast);
  gap: 12px;
}

.model-card:hover {
  border-color: var(--border-color-hover);
}

.model-info {
  min-width: 0;
  overflow-wrap: anywhere;
}

.model-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
}

.model-detail {
  font-size: 12px;
  color: var(--text-color-tertiary);
  margin-top: 2px;
}

.model-badges {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}

.badge {
  padding: 1px 8px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
}

.badge-outline {
  background: rgba(32, 128, 240, 0.1);
  color: #2080F0;
}

.badge-writing {
  background: rgba(24, 160, 88, 0.1);
  color: #18A058;
}

.badge-review {
  background: rgba(240, 160, 32, 0.1);
  color: #F0A020;
}

.model-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 用途分配 */
.assignment-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
}

.assignment-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.chat-assignment { grid-column: 1 / -1; }
.assignment-hint { margin: 0; color: var(--text-color-tertiary); font-size: 12px; line-height: 1.6; }

.assignment-item label {
  font-size: 13px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

/* 弹窗表单 */
.model-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-top: var(--space-sm);
}

.model-form .form-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-form label {
  font-size: 13px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

.model-discovery-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.model-discovery-hint,
.model-discovery-success,
.model-discovery-error {
  font-size: 11px;
  line-height: 1.5;
}

.model-discovery-hint { color: var(--text-color-tertiary); }
.model-discovery-success { color: var(--color-success); }
.model-discovery-error { margin: 0; color: var(--color-error); }

.form-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
}

.about-section p {
  font-size: 14px;
  color: var(--text-color-secondary);
}

.about-section .hint {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

@media (max-width: 680px) {
  .model-card { flex-direction: column; align-items: stretch; }
  .model-actions { flex-wrap: wrap; }
  .embedding-grid, .form-row, .assignment-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .skill-row { grid-template-columns: auto minmax(0, 1fr); padding: 10px 0; }
  .skill-row .model-actions { grid-column: 2; }
}
</style>
