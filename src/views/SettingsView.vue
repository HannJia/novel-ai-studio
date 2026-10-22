<template>
  <div class="page-container fade-in" id="settings-page">


    <div class="settings-layout">
    <nav class="settings-nav" role="tablist" @keydown="handleSettingsNavKeydown" aria-label="设置导航">
    <div class="settings-header">
      <button v-if="!props.overlay" class="back-btn" @click="handleClose">
        <n-icon :size="20"><arrow-back-outline /></n-icon>
        <span>{{ returnPath ? '返回上页' : '返回书架' }}</span>
      </button>
      <h1 class="page-title">设置</h1>
    </div>
      <button
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="activeTab === 'cloud'"
        :tabindex="activeTab === 'cloud' ? 0 : -1"
        @click="activeTab = 'cloud'"
      ><n-icon :size="21"><cloud-outline /></n-icon><span>云同步</span></button>
      <button
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="activeTab === 'models'"
        :tabindex="activeTab === 'models' ? 0 : -1"
        @click="activeTab = 'models'"
      ><n-icon :size="21"><hardware-chip-outline /></n-icon><span>模型配置</span></button>
      <button
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="activeTab === 'workflow'"
        :tabindex="activeTab === 'workflow' ? 0 : -1"
        @click="activeTab = 'workflow'"
      ><n-icon :size="21"><git-network-outline /></n-icon><span>AI 工作流</span></button>
      <button
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="activeTab === 'retrieval'"
        :tabindex="activeTab === 'retrieval' ? 0 : -1"
        @click="activeTab = 'retrieval'"
      ><n-icon :size="21"><search-outline /></n-icon><span>语义检索</span></button>
      <button
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="activeTab === 'skills'"
        :tabindex="activeTab === 'skills' ? 0 : -1"
        @click="activeTab = 'skills'"
      ><n-icon :size="21"><document-text-outline /></n-icon><span>写作技能</span></button>
      <button
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="activeTab === 'about'"
        :tabindex="activeTab === 'about' ? 0 : -1"
        @click="activeTab = 'about'"
      ><n-icon :size="21"><information-circle-outline /></n-icon><span>关于与更新</span></button>
    </nav>
    <div class="settings-content">
      <section v-show="activeTab === 'cloud'" class="settings-section cloud-settings-section">
        <CloudSyncPanel />
      </section>
      <!-- 模型配置 -->
      <section v-show="activeTab === 'models'" class="settings-section paper-panel">
        <div class="section-header">
          <div><h2 class="section-title">模型配置</h2><p class="section-desc">统一管理写作、对话与语义检索模型。</p></div>
          <n-button type="primary" size="small" @click="openAddModel" id="add-model-btn">
            + 添加模型
          </n-button>
        </div>

        <div class="model-workbench">
          <div class="model-catalogue">
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
            :class="{ 'model-card--selected': editingModel === model.id && showAddModel }"
          >
            <div class="model-info">
              <button type="button" class="model-name model-select" :aria-label="`编辑模型 ${model.modelName}`" @click="editModel(model)">{{ model.modelName }}</button>
              <div v-if="model.name && model.name !== model.modelName" class="model-detail">备注：{{ model.name }}</div>
              <div class="model-detail">{{ maskKey(model.apiKey) }}</div>
              <div class="model-badges">
                <span class="badge" :class="model.kind === 'embedding' ? 'badge-vector' : 'badge-outline'">{{ model.kind === 'embedding' ? '向量模型' : '写作／对话' }}</span>
                <span v-if="configStore.assignments.outline === model.id" class="badge badge-outline">大纲</span>
                <span v-if="configStore.assignments.writing === model.id" class="badge badge-writing">写作</span>
                <span v-if="configStore.assignments.review === model.id" class="badge badge-review">审查</span>
                <span v-if="configStore.assignments.chat === model.id" class="badge badge-outline">对话 / 联网</span>
              </div>
            </div>
            <div class="model-actions">
              <n-button size="tiny" quaternary @click="testModel(model)" :loading="testingId === model.id">
                {{ testingId === model.id ? '测试中...' : model.kind === 'embedding' ? '测试向量' : '测试对话' }}
              </n-button>
              <n-button v-if="model.kind !== 'embedding'" size="tiny" quaternary @click="editModel(model)" title="打开模型设置，单独测试搜索能力">
                <template #icon><n-icon><globe-outline /></n-icon></template>测试联网
              </n-button>
              <n-button size="tiny" quaternary @click="editModel(model)">编辑</n-button>
              <n-button size="tiny" quaternary type="error" @click="handleDeleteModel(model.id)">删除</n-button>
            </div>
          </div>
        </div>
          </div>
    <section v-if="showAddModel" class="model-editor" aria-label="编辑模型配置">
      <div class="section-header">
        <h3>{{ editingModel ? '编辑配置' : '添加模型' }}</h3>
        <n-button size="small" quaternary @click="closeModelModal">收起</n-button>
      </div>
      <div class="model-form">
        <div class="form-item">
          <label>模型类型</label>
          <n-select v-model:value="modelForm.kind" :options="modelKindOptions" aria-label="模型类型" />
          <p class="model-discovery-hint">按接口实际支持的能力选择。向量模型用于语义检索。</p>
        </div>
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
        <details v-if="modelForm.kind !== 'embedding'" class="model-advanced">
          <summary>高级参数与联网测试</summary>
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
        </details>
      </div>
      <div class="model-editor-actions">
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
      </div>
    </section>

          <div v-else class="model-editor-empty"><h3>统一管理模型</h3><p>选择一个模型编辑配置，或添加新的写作、对话与向量模型。</p><n-button secondary @click="openAddModel">添加模型</n-button></div>
        </div>
      </section>

      <!-- 模型用途分配 -->
      <section v-show="activeTab === 'models' && configStore.models.length > 0" id="model-task-assignments" tabindex="-1" class="settings-section paper-panel">
        <h3 class="subsection-title">任务分配</h3>
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
          <div class="assignment-item embedding-assignment">
            <label>语义检索</label>
            <n-select :value="configStore.assignments.embedding || ''" :options="embeddingModelOptions" aria-label="语义检索模型" placeholder="选择向量模型" @update:value="(v: string) => configStore.setAssignment('embedding', v)" />
            <p class="assignment-hint">使用支持 Embedding 的向量模型。</p>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'workflow'" class="settings-section paper-panel">
        <h2 class="section-title">AI 工作流</h2>
        <p class="section-desc">控制生成后的自动检查次数与后台 AI 调用量。章节结尾完整性检查在所有模式下都会保留。</p>
        <div class="workflow-cards">
          <button
            v-for="mode in workflowModes"
            :key="mode.value"
            type="button"
            class="workflow-card"
            :class="{ 'workflow-card--active': configStore.aiWorkflowMode === mode.value }"
            @click="configStore.setAiWorkflowMode(mode.value)"
          >
            <span class="workflow-symbol"><n-icon :size="30"><component :is="mode.value === 'fast' ? FlashOutline : mode.value === 'strict' ? ShieldCheckmarkOutline : ScaleOutline" /></n-icon></span>
            <h4>{{ mode.title }}</h4>
            <p>{{ mode.description }}</p>
          </button>
        </div>
        <section class="workflow-preview paper-panel"><h3>{{ workflowModes.find(mode => mode.value === configStore.aiWorkflowMode)?.title }}模式的流程</h3><p>根据当前模式执行正文生成与检查，结果仍由作者查看。</p><div class="workflow-steps"><article v-for="(step, index) in workflowSteps" :key="step.title"><span class="workflow-step-number">{{ index + 1 }}</span><div><h4>{{ step.title }}</h4><p>{{ step.description }}</p></div></article></div><small aria-live="polite">结尾复核最多补写 <strong class="workflow-rounds-value">{{ workflowPolicy.endingContinuationAttempts }} 轮</strong>；内容审查最多处理 <strong class="workflow-rounds-value">{{ workflowPolicy.reviewRewriteCycles }} 轮</strong>。</small></section>
        <div class="setting-inline-toggle">
          <div>
            <strong>PDF 视觉识别</strong>
            <p class="section-desc">默认关闭。开启后，PDF 没有文字层的页面可以调用视觉模型，可能消耗额度；关闭时请使用本地 OCR。</p>
          </div>
          <n-switch :value="configStore.pdfVisionEnabled" aria-label="允许 PDF 视觉识别" @update:value="configStore.setPdfVisionEnabled" />
        </div>
      </section>

      <div v-show="activeTab === 'models'" class="security-section model-security-status" :class="`security-${configStore.securityStatus.storage}`">
        <p v-if="configStore.securityStatus.storage === 'encrypted'" class="security-status">
          接口密钥已由操作系统安全存储加密后写入本机配置文件。
        </p>
        <p v-else-if="configStore.securityStatus.storage === 'local-development'" class="security-status">
          API 密钥保存在当前浏览器的本地配置中；桌面版使用操作系统加密保存。如需跨设备同步，可在"云端配置"中单独开启。
        </p>
        <p v-else class="security-status">
          当前环境不提供系统加密。接口密钥只在本次应用会话中保留，关闭应用或浏览器标签后需要重新填写，持久化配置不会写入明文密钥。
        </p>
      </div>

      <!-- 语义检索复用任务分配，不重复保存连接信息 -->
      <section v-show="activeTab === 'retrieval'" class="settings-section paper-panel">
        <div class="section-header">
          <div>
            <h2 class="section-title">语义检索增强 <span class="optional-label">可选</span></h2>
            <p class="section-desc">按含义查找相关资料，为写作提供上下文。</p>
          </div>
          <n-switch :value="configStore.embedding.enabled" :disabled="!assignedEmbeddingModel" aria-label="启用语义检索增强" @update:value="handleEmbeddingEnabledChange" />
        </div>
        <div class="retrieval-model-status">
          <div>
            <span class="setting-label">当前向量模型</span>
            <strong>{{ assignedEmbeddingModel?.name || assignedEmbeddingModel?.modelName || '尚未分配' }}</strong>
            <p class="section-desc">{{ assignedEmbeddingModel?.modelName || '在模型配置的任务分配中选择向量模型，接口与密钥自动复用。' }}</p>
          </div>
          <n-button secondary @click="openTaskAssignments">前往任务分配</n-button>
        </div>
        <section class="retrieval-howto"><h3>使用方式</h3><div><article><strong>1 · 整理资料</strong><p>将设定与参考资料整理到知识库，并挂载到作品。</p></article><article><strong>2 · 建立索引</strong><p>在项目记忆中同步索引，按需生成资料向量。</p></article><article><strong>3 · 按需检索</strong><p>写作与检索时，根据问题寻找相关资料。</p></article></div></section>
        <details class="retrieval-advanced">
          <summary>高级设置</summary>
          <div class="form-item">
            <label>批量大小</label>
            <n-input-number v-model:value="embeddingForm.batchSize" :min="1" :max="64" aria-label="向量批量大小" />
          </div>
          <p class="section-desc">每次处理的资料分段数。切换向量服务或模型后，资料索引会在下次使用时更新。</p>
          <div class="section-actions">
            <n-button :loading="testingEmbedding" :disabled="!assignedEmbeddingModel" @click="handleTestEmbedding">测试连接</n-button>
            <n-button type="primary" @click="saveEmbedding">保存设置</n-button>
          </div>
        </details>
        <p v-if="!configStore.embedding.enabled" class="disabled-hint">当前使用本地混合检索，结构化记忆与故事时钟正常可用。</p>
      </section>

      <!-- 写作 Skill -->
      <section v-show="activeTab === 'skills'" class="settings-section paper-panel">
        <div class="section-header">
          <div>
            <h2 class="section-title">写作技能</h2>
            <p class="section-desc section-desc-inline">按任务自动注入的可复用写作规则</p>
          </div>
          <n-button type="primary" size="small" @click="openSkillModal()">添加技能</n-button>
        </div>
        <div class="skill-workbench">
        <div class="skill-list">
          <div v-for="skill in configStore.skills" :key="skill.id" class="skill-row" :class="{ selected: showSkillModal && editingSkill === skill.id }">
            <n-switch :value="skill.enabled" :aria-label="`启用${skill.name}`" @update:value="value => configStore.updateSkill(skill.id, { enabled: value })" />
            <div class="skill-info">
              <div class="skill-name">
                <button type="button" class="skill-select" @click="openSkillModal(skill)">{{ skill.name }}</button>
                <n-tag size="small" :type="skill.builtIn ? 'info' : 'default'">{{ skill.builtIn ? '内置' : '自定义' }}</n-tag>
                <n-tag size="small">{{ skillTaskLabel(skill.task) }}</n-tag>
              </div>
              <p>{{ skill.description }}</p>
            </div>
            <div class="model-actions">
              <n-button size="small" quaternary circle :title="`查看和编辑${skill.name}`" :aria-label="`查看和编辑${skill.name}`" @click="openSkillModal(skill)">
                <template #icon><n-icon><create-outline /></n-icon></template>
              </n-button>
              <n-button v-if="!skill.builtIn" size="tiny" quaternary type="error" @click="handleDeleteSkill(skill.id)">删除</n-button>
            </div>
          </div>
        </div>
          <section v-if="showSkillModal" class="skill-editor paper-panel" aria-label="编辑技能"><h3>{{ editingSkill ? '编辑技能' : '添加技能' }}</h3>
      <div class="model-form">
        <div class="form-item">
          <label>名称</label>
          <n-input v-model:value="skillForm.name" aria-label="技能名称" :maxlength="80" placeholder="例如：悬疑线索控制" />
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
          <n-input v-model:value="skillForm.instructions" aria-label="技能执行规则" type="textarea" :rows="8" :maxlength="1500" show-count />
        </div>
      </div>

        <div class="section-actions">
          <n-button v-if="configStore.skills.find(item => item.id === editingSkill)?.builtIn" @click="restoreSkill">恢复内置规则</n-button>
          <n-button @click="showSkillModal = false">取消</n-button>
          <n-button type="primary" :disabled="!skillForm.name.trim() || !skillForm.instructions.trim()" @click="saveSkill">保存</n-button>
        </div>

          </section>
          <div v-else class="skill-editor-empty">选择一项技能查看和编辑规则，或添加新的写作技能。</div>
        </div>
      </section>

      <!-- 关于 -->
      <section v-show="activeTab === 'about'" class="settings-section paper-panel about-section">
        <h2 class="section-title">关于墨笺</h2>
        <div class="about-brand"><span class="seal">墨</span><div><h3>墨笺</h3><p class="about-version">版本 v{{ appVersion }}</p></div></div>
        <p class="about-desc">本地优先的 AI 长篇小说写作工具。创作内容保存在本机，可按需开启云同步。</p>
        <div class="about-features"><article><span><n-icon :size="28"><create-outline /></n-icon></span><div><h4>作者主笔</h4><p>尊重创作意图，随时编辑故事与正文。</p></div></article><article><span><n-icon :size="28"><hardware-chip-outline /></n-icon></span><div><h4>AI 辅助</h4><p>为构思、写作与审查提供支持。</p></div></article><article><span><n-icon :size="28"><document-text-outline /></n-icon></span><div><h4>知识库与剧情记忆</h4><p>整理人物、世界观和情节，让长篇创作更连贯。</p></div></article></div>
        <section class="about-update" aria-labelledby="about-update-title"><h3 id="about-update-title" class="about-help-title">软件更新</h3><AppUpdatePanel /></section>
        <h3 class="about-help-title">信息与帮助</h3>
        <nav class="about-links" aria-label="信息与帮助">
          <a href="https://github.com/HannJia/novel-ai-studio" target="_blank" rel="noopener noreferrer"><strong>项目主页</strong><small>了解墨笺的更新动态与相关资源。</small><span aria-hidden="true">↗</span></a>
          <a href="https://github.com/HannJia/novel-ai-studio#readme" target="_blank" rel="noopener noreferrer"><strong>使用说明</strong><small>查看功能介绍与使用方法。</small><span aria-hidden="true">↗</span></a>
          <a href="https://github.com/HannJia/novel-ai-studio/issues" target="_blank" rel="noopener noreferrer"><strong>问题反馈</strong><small>提交使用中遇到的问题与建议。</small><span aria-hidden="true">↗</span></a>
        </nav>
        <p class="about-backup-note">项目备份可在书架导出。</p>
      </section>
    </div>
    </div>


  </div>
</template>

<script setup lang="ts">
import CloudSyncPanel from '@/components/CloudSyncPanel.vue'
import AppUpdatePanel from '@/components/AppUpdatePanel.vue'
import ModelSearchTest from '@/components/ModelSearchTest.vue'
import { ref, computed, reactive, nextTick, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NIcon, NInput, NInputNumber, NSelect, NSwitch, NTag, useMessage, useDialog } from 'naive-ui'
import { CloudOutline, HardwareChipOutline, GitNetworkOutline, SearchOutline, DocumentTextOutline, InformationCircleOutline, ArrowBackOutline, GlobeOutline, CreateOutline, FlashOutline, ShieldCheckmarkOutline, ScaleOutline } from '@vicons/ionicons5'
import { getAiWorkflowPolicy } from '@/services/aiWorkflow'
import { createBuiltInSkills } from '@/data/skills'
import { useConfigStore, type ModelConfig } from '@/stores/config'
import { listAvailableModels, openAiV1BaseUrl, testConnection, type AvailableModel } from '@/services/ai'
import { testEmbeddingConnection } from '@/services/embeddings'
import { chatSearchProtocolOptions } from '@/services/chatSearch'
import type { ChatSearchProtocol } from '@/types/chat'
import type { WritingSkill, WritingSkillTask } from '@/types/skill'
import { version as appVersion } from '../../package.json'

const configStore = useConfigStore()
const message = useMessage()
const dialog = useDialog()
const route = useRoute()
const router = useRouter()
const props = defineProps<{ overlay?: boolean }>()

const activeTab = ref('cloud')

function handleSettingsNavKeydown(event: KeyboardEvent) {
  const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.settings-nav-item'))
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  if (index < 0 || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.click()
  buttons[next]?.focus()
}

async function openTaskAssignments() {
  activeTab.value = 'models'
  await nextTick()
  const target = document.getElementById('model-task-assignments')
  target?.scrollIntoView?.({ block: 'nearest' })
  target?.focus()
}

const emit = defineEmits<{
  close: []
}>()

const returnPath = computed(() => {
  const candidate = String(route?.query?.returnTo || '')
  return candidate.startsWith('/') && candidate !== '/settings' ? candidate : ''
})

function returnToPreviousPage() {
  if (!router) return
  void router.push(returnPath.value || '/')
}

function handleClose() {
  if (props.overlay) {
    emit('close')
    return
  }
  returnToPreviousPage()
}

const showAddModel = ref(false)
const editingModel = ref<string | null>(null)
const testingId = ref<string | null>(null)
const availableModels = ref<AvailableModel[]>([])
const selectedModelNames = ref<string[]>([])
const modelDiscoveryLoading = ref(false)
const modelDiscoveryError = ref('')
let modelDiscoveryController: AbortController | null = null
onBeforeUnmount(() => modelDiscoveryController?.abort())
const testingEmbedding = ref(false)
const showSkillModal = ref(false)
const editingSkill = ref<string | null>(null)

const embeddingForm = reactive({ batchSize: configStore.embedding.batchSize })
const assignedEmbeddingModel = computed(() => configStore.getModelForTask('embedding'))
watch(() => configStore.embedding.batchSize, value => { embeddingForm.batchSize = value })
const modelKindOptions = [{ label: '写作／对话', value: 'chat' }, { label: '向量模型（Embedding）', value: 'embedding' }]
const embeddingModelOptions = computed(() => [
  { label: '暂不分配', value: '' },
  ...configStore.models.filter(model => model.kind === 'embedding').map(model => ({ label: model.name || model.modelName, value: model.id })),
])
const skillTaskOptions = [
  { label: '全部 AI 任务', value: 'all' },
  { label: '大纲与规划', value: 'planning' },
  { label: '正文写作', value: 'writing' },
  { label: '章节审查', value: 'review' },
  { label: '结构化分析', value: 'analysis' },
]
const workflowModes = [
  { value: 'fast' as const, title: '精简', description: '减少计划、自检和后台调用，更快完成写作任务' },
  { value: 'balanced' as const, title: '均衡', description: '完整生成、自检与结尾复核，平衡质量与效率' },
  { value: 'strict' as const, title: '严谨', description: '增加结尾补写与审查轮次，加强完整性检查' },
]
const workflowPolicy = computed(() => getAiWorkflowPolicy(configStore.aiWorkflowMode))
const workflowSteps = computed(() => [
  ...(workflowPolicy.value.createWritingPlan ? [{ title: '拟定计划', description: '结合设定与前文安排本章推进。' }] : []),
  { title: '生成正文', description: '依据任务与上下文生成初稿。' },
  ...(workflowPolicy.value.selfCheckDraft ? [{ title: '自检', description: '检查明显问题并校正正文。' }] : []),
  { title: '结尾复核', description: '检查章尾完整性，再进入后续审查。' },
])
const skillForm = reactive({ name: '', description: '', task: 'writing' as WritingSkillTask, instructions: '' })

// 模型表单
const modelForm = reactive({
  kind: 'chat' as 'chat' | 'embedding',
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
  return configStore.models.filter(model => model.kind !== 'embedding').map(model => ({
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
    && (modelForm.kind === 'embedding' || modelForm.apiKey.trim() || (editingModel.value && configStore.models.some(model => model.id === editingModel.value && model.apiKey))),
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
  activeTab.value = 'models'
  editingModel.value = model.id
  Object.assign(modelForm, {
    kind: model.kind || 'chat',
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
  activeTab.value = 'models'
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
  if (!apiKey && modelForm.kind !== 'embedding') return
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
      kind: modelForm.kind,
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
  try {
    if (model.kind === 'embedding') {
      const result = await testEmbeddingConnection({ enabled: true, baseUrl: model.baseUrl, apiKey: model.apiKey, modelName: model.modelName, batchSize: 1 })
      message.success(`连接成功：${result.dimensions} 维，${result.latency} ms`)
    } else {
      const result = await testConnection(model)
      if (result.ok) message.success(result.message)
      else message.error(result.message)
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '连接测试失败')
  } finally {
    testingId.value = null
  }
}

// 重置表单
function resetForm() {
  editingModel.value = null
  selectedModelNames.value = []
  Object.assign(modelForm, {
    kind: 'chat',
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
    batchSize: Math.min(64, Math.max(1, Math.round(embeddingForm.batchSize || 16))),
  })
  message.success('向量记忆配置已保存')
}

function handleEmbeddingEnabledChange(enabled: boolean) {
  configStore.updateEmbeddingConfig({ enabled })
}

async function handleTestEmbedding() {
  if (!assignedEmbeddingModel.value) {
    message.warning('请先在任务分配中选择向量模型')
    return
  }
  testingEmbedding.value = true
  try {
    const result = await testEmbeddingConnection({ ...configStore.embedding, enabled: true })
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
watch(activeTab, tab => {
  if (tab === 'skills' && !showSkillModal.value && configStore.skills.length) openSkillModal(configStore.skills[0])
})

async function saveSkill() {
  const data = {
    name: skillForm.name.trim(),
    description: skillForm.description.trim(),
    task: skillForm.task,
    instructions: skillForm.instructions.trim(),
  }
  if (editingSkill.value) configStore.updateSkill(editingSkill.value, data)
  else configStore.addSkill(data)
  try {
    await configStore.saveConfig()
    showSkillModal.value = false
    message.success('技能已保存')
  } catch { message.error('技能保存失败，请重试保存。') }
}
function restoreSkill() {
  const original = createBuiltInSkills().find(item => item.id === editingSkill.value)
  if (!original) return
  dialog.warning({ title: '恢复内置规则？', content: '替换当前编辑框中的规则，点击保存后生效。', positiveText: '恢复', negativeText: '取消',
    onPositiveClick: () => Object.assign(skillForm, { name: original.name, description: original.description, task: original.task, instructions: original.instructions }) })
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

.settings-layout {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  width: 100%;
  max-width: 1440px;
}

.settings-nav {
  position: sticky;
  top: 0;
  flex: 0 0 176px;
  flex-direction: column;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color-light);
  width: 176px;
}

.settings-nav-item {
  padding: 13px 16px;
  text-align: left;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.settings-nav-item:hover {
  color: var(--text-color-primary);
  background: var(--bg-color-hover);
}

.settings-nav-item[aria-selected="true"] {
  color: var(--color-primary);
  background: var(--bg-color-card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.settings-nav-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .settings-layout { flex-direction: column; gap: 18px; }
  .settings-nav {
    position: static;
    flex: none;
    flex-direction: row;
    max-width: 100%;
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .settings-nav::-webkit-scrollbar {
    height: 4px;
  }
}

.settings-content {
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  max-width: none;
}

.settings-section {
  padding: var(--space-lg);
}
.cloud-settings-section { padding: 0; }
.about-brand { display: flex; align-items: center; gap: 16px; margin: 20px 0; }
.about-brand > .seal { width: 52px; height: 56px; font-size: 32px; }
.about-brand h3 { font-size: 30px; }
.about-features { display: grid; gap: 12px; margin: 24px 0; color: var(--text-color-secondary); }
.about-links { display: grid; margin-top: 24px; }
.about-links a { display: flex; justify-content: space-between; padding: 16px 0; border-top: 1px solid var(--border-color-light); }

.section-title {
  font-family: var(--font-family-serif);
  font-size: 28px;
  font-weight: 600;
  margin-bottom: var(--space-lg);
  color: var(--text-color-primary);
}

.subsection-title {
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
.setting-inline-toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:16px; padding-top:16px; border-top:1px solid var(--border-color-light); }
.setting-inline-toggle strong { font-size:13px; }
.setting-inline-toggle .section-desc { margin:4px 0 0; }
@media (max-width:600px) { .setting-inline-toggle { align-items:flex-start; } }
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
  flex-wrap: wrap;
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
  background: var(--color-accent-light);
  color: var(--color-info);
}

.badge-writing {
  background: rgba(24, 160, 88, 0.1);
  color: var(--color-success);
}

.badge-review {
  background: rgba(240, 160, 32, 0.1);
  color: var(--color-warning);
}

.model-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 用途分配 */
.assignment-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-md);
}

.assignment-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.chat-assignment { grid-column: auto; }
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

.about-version {
  font-family: var(--font-family-mono);
  font-size: 15px;
  color: var(--text-color-secondary);
  margin: 8px 0;
}

.about-desc {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color-secondary);
  margin-top: 16px;
}

.workflow-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.workflow-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 2px solid var(--border-color-light);
  border-radius: var(--radius-md);
  background: var(--bg-color);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.workflow-card:hover {
  border-color: var(--border-color-hover);
  background: var(--bg-color-hover);
}

.workflow-card--active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.workflow-card h4 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color-primary);
  margin: 0;
}

.workflow-card p {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-color-secondary);
  margin: 0;
}

.workflow-card:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.security-status {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-tertiary);
  padding: 12px;
  background: var(--bg-color-card);
  border-radius: var(--radius-sm);
  margin: 0;
}

@media (max-width: 680px) {
  .workflow-cards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .model-card { flex-direction: column; align-items: stretch; }
  .model-actions { flex-wrap: wrap; }
  .embedding-grid, .form-row, .assignment-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .skill-row { grid-template-columns: auto minmax(0, 1fr); padding: 10px 0; }
  .skill-row .model-actions { grid-column: 2; }
}
.model-workbench { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 24px; align-items: start; }
.model-catalogue { min-width: 0; }
.model-catalogue .model-card { flex-direction: column; align-items: stretch; padding: 16px; }
.model-card--selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.model-select { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.model-editor { min-width: 0; padding: 20px; background: var(--bg-color-paper); border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); }
.model-editor .model-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.model-editor .model-form > .form-item:nth-child(n+3), .model-advanced { grid-column: 1 / -1; }
.model-advanced summary { cursor: pointer; color: var(--text-color-secondary); padding: 8px 0; }
.model-advanced .form-row { margin-top: 14px; }
.section-header .section-title { margin-bottom: 0; }
.model-editor h3 { font-size: 21px; }
.model-editor-empty { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 16px; min-height: 300px; padding: 28px; border: 1px dashed var(--border-color); border-radius: var(--radius-lg); }
.model-editor-empty p { color: var(--text-color-secondary); }
.model-editor-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.model-security-status { margin-top: -12px; }
.model-security-status .security-status { background: none; padding: 0 4px; }
.badge-vector { color: var(--color-accent); background: var(--color-accent-light); }
.optional-label { font: 12px var(--font-family); color: var(--text-color-secondary); padding: 3px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); vertical-align: middle; }
.retrieval-model-status { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 0; }
.retrieval-model-status strong { display: block; margin-top: 8px; overflow-wrap: anywhere; }
.setting-label { font-size: 13px; color: var(--text-color-secondary); }
.retrieval-advanced { border-top: 1px solid var(--border-color-light); padding-top: 16px; }
.retrieval-advanced summary { cursor: pointer; color: var(--text-color-secondary); }
.retrieval-advanced .form-item { max-width: 240px; margin: 20px 0 12px; }
.workflow-card { font-family: var(--font-family); }
.workflow-card h4 { font-family: var(--font-family-serif); font-size: 20px; }
@media (max-width: 1100px) {
  .model-workbench { grid-template-columns: 1fr; }
  .model-editor-empty { min-height: 150px; }
  .assignment-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .retrieval-model-status { align-items: flex-start; flex-direction: column; gap: 12px; }
  .model-editor { padding: 16px; }
  .model-editor .model-form { grid-template-columns: 1fr; }
  .assignment-grid { grid-template-columns: 1fr; }
}

.settings-nav-item { display: flex; align-items: center; gap: 14px; }
.settings-nav-item[aria-selected="true"] { border-left: 3px solid var(--color-primary); background: var(--color-primary-light); }
.skill-workbench { display: grid; grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.3fr); gap: 24px; align-items: start; }
.skill-list { gap: 12px; }
.skill-row { position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; padding: 18px; border: 1px solid var(--border-color); border-radius: 9px; background: var(--bg-color-paper); gap: 12px; }
.skill-row.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.skill-info { flex: 1; min-width: 100px; }
.skill-select { font: 600 20px var(--font-family-serif); color: var(--text-color-primary); border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; }
.skill-row .model-actions { flex-basis: 100%; justify-content: flex-end; }
.skill-editor { padding: 24px; min-width: 0; }
.skill-editor h3 { font-size: 23px; margin-bottom: 24px; }
.skill-editor .section-actions { margin-top: 20px; }
.skill-editor-empty { padding: 32px; color: var(--text-color-secondary); border: 1px dashed var(--border-color); border-radius: 9px; }
@media (max-width: 1000px) { .skill-workbench { grid-template-columns: 1fr; } .skill-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .skill-list { grid-template-columns: 1fr; } .settings-nav-item { gap: 8px; } }
.settings-header { display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 8px; margin: 0 0 22px; padding: 8px 12px; }
.settings-header .page-title { font-size: 22px; }
.settings-header .back-btn { font-size: 12px; padding: 0; }
.settings-nav { border: 0; box-shadow: none; background: none; }
.skill-row { position: relative; align-items: flex-start; padding: 22px; }
.skill-row :deep(.n-switch) { order: 2; margin-left: auto; }
.skill-info { min-width: 0; }
.skill-select { font-size: 22px; }
.skill-info p { margin-top: 10px; font-size: 14px; line-height: 1.7; }
.skill-row .model-actions { position: absolute; right: 16px; bottom: 12px; }
.skill-editor { padding: 24px; }
.skill-editor h3 { font-size: 25px; margin-bottom: 24px; }
@media (max-width: 760px) { .settings-header { display: none; } .skill-row { padding: 16px; } }
.workflow-card { position: relative; min-height: 180px; display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 8px 18px; padding: 24px; align-content: start; }
.workflow-symbol { grid-row: span 2; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; background: var(--color-accent-light); color: var(--color-accent); }
.workflow-card--active .workflow-symbol { color: var(--color-primary); background: var(--color-primary-light); }
.workflow-card h4 { font-size: 22px; }
.workflow-card p { line-height: 1.8; font-size: 14px; }
.workflow-preview { margin-top: 20px; padding: 24px; }
.workflow-preview h3, .retrieval-howto h3 { font-size: 23px; margin-bottom: 10px; }
.workflow-preview > p, .workflow-preview > small, .retrieval-howto p { font-size: 14px; line-height: 1.8; color: var(--text-color-secondary); }
.workflow-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; margin: 22px 0; }
.workflow-steps article { display: flex; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); }
.workflow-step-number { flex: 0 0 30px; display: grid; place-items: center; height: 30px; border-radius: 50%; background: var(--color-accent-light); color: var(--color-accent); }
.workflow-steps h4 { font-size: 16px; margin-bottom: 6px; }
.workflow-steps p { font-size: 13px; color: var(--text-color-secondary); }
.retrieval-howto { padding: 24px 0; margin-top: 20px; border-top: 1px solid var(--border-color-light); }
.retrieval-howto > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.retrieval-howto article { padding: 12px 0; }
.retrieval-howto strong { font-size: 16px; }
@media (max-width: 900px) { .workflow-card { min-height: 140px; grid-template-columns: 48px minmax(0, 1fr); padding: 18px; } .workflow-symbol { width: 48px; height: 48px; } .retrieval-howto > div { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
.about-brand { padding: 4px 0; margin: 12px 0; }
.about-brand .seal { width: 56px; height: 64px; font-size: 38px; }
.about-brand h3 { font-size: 34px; }
.about-desc { font: 600 18px/1.7 var(--font-family-serif); max-width: none; }
.about-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; padding: 18px 0; margin: 18px 0; border-top: 1px solid var(--border-color-light); }
.about-features article { display: flex; gap: 12px; align-items: flex-start; }
.about-features article > span { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 50%; background: var(--bg-color-hover); }
.about-features h4 { font: 600 18px var(--font-family-serif); margin-bottom: 6px; }
.about-features p { font-size: 14px; margin: 0; }
.about-help-title { font-size: 24px; padding: 20px 0 10px; border-top: 1px solid var(--border-color-light); }
.about-links a { display: grid; grid-template-columns: 140px minmax(0, 1fr) 24px; align-items: center; color: var(--text-color-primary); }
.about-links small { color: var(--text-color-secondary); font-size: 14px; }
.about-backup-note { margin-top: 20px; font-size: 13px; color: var(--text-color-secondary); }
@media (max-width: 650px) { .about-links a { grid-template-columns: minmax(0, 1fr) 24px; gap: 6px; } .about-links small { grid-column: 1; grid-row: 2; } .about-links a > span { grid-column: 2; grid-row: 1 / 3; } }
.workflow-rounds-value { color: var(--color-primary); font-size: 17px; font-variant-numeric: tabular-nums; margin: 0 3px; }
.about-update { margin: 16px 0; padding: 16px 0 0; border-top: 1px solid var(--border-color-light); }
.about-update > .about-help-title { border: 0; padding: 0 0 12px; }
@media (max-width: 900px) { .about-features { grid-template-columns: 1fr; gap: 16px; } }
</style>
