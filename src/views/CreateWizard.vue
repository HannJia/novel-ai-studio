<template>
  <div class="wizard-layout" id="create-wizard-page">
    <!-- 顶部固定区 -->
    <div class="wizard-top">
      <!-- 向导头部 -->
      <div class="wizard-header">
        <button class="back-btn" @click="handleBack" id="wizard-back-btn">
          <n-icon :size="20"><arrow-back-outline /></n-icon>
          <span>{{ choosingCreationOptions && previousCreationState ? '返回' : '返回书架' }}</span>
        </button>
        <h1 class="page-title">创建新书</h1>
        <n-button v-if="!choosingCreationOptions" quaternary :disabled="creating" @click="openCreationOptions">更换搭配</n-button>
        <n-button v-if="!choosingCreationOptions && setupMethod === 'inspiration' && reviewingInspiration"
          quaternary :disabled="creating" @click="reviewingInspiration = false">返回灵感对话</n-button>
      </div>
      <p v-if="!choosingCreationOptions" class="creation-combination" role="status">
        本书：{{ form.writingMode === 'ai' ? 'AI 模式' : '写作辅助' }} ＋ {{ setupMethod === 'inspiration' ? '灵感模式' : '自选设定' }}
      </p>

      <!-- 步骤指示器 -->
      <div v-if="showSettings" class="steps-indicator" id="wizard-steps">
        <div
          v-for="(step, index) in steps"
          :key="index"
          class="step-item"
          :class="{
            'step-active': currentStep === index,
            'step-completed': currentStep > index,
          }"
        >
          <div class="step-dot">
            <span v-if="currentStep > index">✓</span>
            <span v-else>{{ index + 1 }}</span>
          </div>
          <span class="step-label">{{ step }}</span>
        </div>
        <div class="step-line" :style="{ width: `${currentStep * 50}%` }"></div>
      </div>
    </div><!-- /wizard-top -->

    <!-- 可滚动内容区 -->
    <creation-mode-picker v-if="choosingCreationOptions"
      v-model:writing-mode="form.writingMode" v-model:setup-method="setupMethod"
      :disabled="creating" @start="startCreation" />
    <inspiration-chat v-show="showInspiration"
      :active="showInspiration" :form="form" @apply="applyInspiration" @history-change="handleInspirationHistoryChange" />
    <div v-show="showSettings" class="wizard-body">
      <div class="creation-writing-mode">
        <label>本书正文创作方式</label>
        <n-radio-group v-model:value="form.writingMode" name="new-book-writing-mode">
          <n-radio-button value="ai">AI 生成正文</n-radio-button>
          <n-radio-button value="manual">人工主笔辅助</n-radio-button>
        </n-radio-group>
      </div>
      <section class="reference-import-panel paper-panel">
        <div class="reference-import-header">
          <div>
            <h3 class="section-title">📋 参考小说设定</h3>
            <p class="import-hint">复制提示词给其他 AI 分析参考小说，再把返回的 JSON 粘贴回来一键填充设定。</p>
          </div>
          <div class="reference-import-actions">
            <n-button @click="copyReferencePrompt">复制分析提示词</n-button>
            <n-button type="primary" @click="showImportModal = true">粘贴 / 导入设定</n-button>
          </div>
        </div>
      </section>

      <n-modal v-model:show="showImportModal" preset="card" title="导入参考小说设定" style="width: 820px;">
        <template v-if="!previewData">
          <n-input
            v-model:value="importJsonText"
            type="textarea"
            :rows="14"
            placeholder="请粘贴其他 AI 返回的 JSON，可以包含 ```json 代码块。"
          />
        </template>
        <div v-else class="settings-preview">
          <div class="preview-section">
            <h4>基础信息</h4>
            <div class="preview-grid">
              <span class="preview-label">类型</span><span class="preview-value">{{ previewData.genreLabel || previewData.genre || '未识别' }} / {{ previewData.subGenreLabel || previewData.subGenre || '未识别' }}</span>
              <span class="preview-label">标签</span><span class="preview-value">{{ formatPreviewList(previewData.tags) }}</span>
              <span class="preview-label">目标字数</span><span class="preview-value">{{ previewData.targetWordCountMin || '-' }}~{{ previewData.targetWordCountMax || '-' }} 万字</span>
            </div>
          </div>
          <div class="preview-section">
            <h4>主角与世界观</h4>
            <div class="preview-grid">
              <span class="preview-label">主角背景</span><span class="preview-value">{{ previewData.settings?.protagonist?.background || '未填写' }}</span>
              <span class="preview-label">性格</span><span class="preview-value">{{ formatPreviewList(previewData.settings?.protagonist?.personality) }}</span>
              <span class="preview-label">金手指</span><span class="preview-value">{{ previewData.settings?.protagonist?.cheatDescription || '未填写' }}</span>
              <span class="preview-label">世界类型</span><span class="preview-value">{{ previewData.settings?.worldBuilding?.worldType || '未填写' }}</span>
              <span class="preview-label">特殊规则</span><span class="preview-value">{{ previewData.settings?.worldBuilding?.specialRules || '未填写' }}</span>
            </div>
          </div>
          <div class="preview-section">
            <h4>力量、冲突与爽点</h4>
            <div class="preview-grid">
              <span class="preview-label">力量体系</span><span class="preview-value">{{ previewData.settings?.powerSystem?.systemName || '未填写' }}</span>
              <span class="preview-label">等级划分</span><span class="preview-value">{{ previewData.settings?.powerSystem?.levelHierarchy || '未填写' }}</span>
              <span class="preview-label">主线矛盾</span><span class="preview-value">{{ previewData.settings?.coreConflict?.mainConflict || '未填写' }}</span>
              <span class="preview-label">核心悬念</span><span class="preview-value">{{ previewData.settings?.coreConflict?.coreSuspense || '未填写' }}</span>
              <span class="preview-label">爽点模式</span><span class="preview-value">{{ formatPreviewList(previewData.settings?.payoff?.patterns) }}</span>
            </div>
          </div>
          <div class="preview-section" v-if="previewData.settings?.otherSettings || previewData.antiPlagiarismNotes">
            <h4>其他与规避建议</h4>
            <p v-if="previewData.settings?.otherSettings" class="preview-paragraph">{{ previewData.settings.otherSettings }}</p>
            <p v-if="previewData.antiPlagiarismNotes" class="preview-paragraph">{{ formatAntiPlagiarismNotes(previewData.antiPlagiarismNotes) }}</p>
          </div>
        </div>
        <template #footer>
          <div class="import-modal-actions">
            <template v-if="!previewData">
              <n-button @click="showImportModal = false">取消</n-button>
              <n-button type="primary" @click="parseImportedSettings">解析并预览</n-button>
            </template>
            <template v-else>
              <n-button @click="previewData = null">重新粘贴</n-button>
              <n-button type="primary" @click="confirmImportSettings">确认导入并填充</n-button>
            </template>
          </div>
        </template>
      </n-modal>

    <!-- 第一页：类型 + 字数 + 风格 -->
    <div v-if="currentStep === 0" class="wizard-page" id="wizard-page-1">
      <div class="form-sections">
        <!-- 小说类型 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">📚 小说类型</h3>
          <div class="genre-grid">
            <button
              v-for="genre in genres"
              :key="genre.value"
              class="genre-btn"
              :class="{ 'genre-btn--active': form.genre === genre.value }"
              @click="selectGenre(genre.value)"
            >
              {{ genre.label }}
            </button>
          </div>

          <!-- 子类选择 -->
          <div v-if="selectedGenre" class="subgenre-section">
            <h4 class="subsection-title">选择子类</h4>
            <div class="genre-grid subgenre-grid">
              <button
                v-for="sub in selectedGenre.children"
                :key="sub.value"
                class="genre-btn sub-genre-btn"
                :class="{ 'genre-btn--active': form.subGenre === sub.value }"
                @click="form.subGenre = sub.value"
              >
                {{ sub.label }}
              </button>
            </div>
          </div>

          <!-- 题材标签 -->
          <div v-if="form.subGenre" class="tags-section">
            <h4 class="subsection-title">题材标签（可多选）</h4>
            <div class="tags-grid">
              <span
                v-for="tag in themeTags"
                :key="tag"
                class="tag-chip clickable"
                :class="{ active: form.tags.includes(tag) }"
                @click="toggleTag(tag)"
              >
                {{ tag }}
              </span>
            </div>
          </div>
        </section>

        <!-- 目标字数 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">📊 目标字数（万字）</h3>
          <div class="word-count-row">
            <n-input-number
              v-model:value="form.targetWordCountMin"
              :min="1"
              :max="form.targetWordCountMax || 500"
              placeholder="最少"
              class="word-input"
            />
            <span class="word-sep">~</span>
            <n-input-number
              v-model:value="form.targetWordCountMax"
              :min="form.targetWordCountMin || 1"
              :max="999"
              placeholder="最多"
              class="word-input"
            />
            <span class="word-unit">万字</span>
          </div>
        </section>

        <!-- 写作风格 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">🎨 写作风格</h3>
          <div class="style-dimensions">
            <div
              v-for="dim in styleDimensions"
              :key="dim.key"
              class="style-dimension"
            >
              <label class="dim-label">{{ dim.label }}</label>
              <div class="dim-options">
                <button
                  v-for="opt in dim.options"
                  :key="opt.value"
                  class="dim-btn"
                  :class="{ 'dim-btn--active': (form.writingStyle as any)[dim.key] === opt.value }"
                  @click="(form.writingStyle as any)[dim.key] = opt.value"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 第二页：核心设定 + 知识库 -->
    <div v-if="currentStep === 1" class="wizard-page" id="wizard-page-2">
      <div class="form-sections">
        <!-- 主角设定 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">🦸 主角设定</h3>
          <p class="section-hint">所有项均为可选，填写越详细 AI 生成质量越高</p>
          <div class="form-grid">
            <div class="form-item">
              <label>姓名</label>
              <n-input v-model:value="form.settings.protagonist.name" placeholder="主角姓名" />
            </div>
            <div class="form-item">
              <label>性别</label>
              <n-select
                v-model:value="form.settings.protagonist.gender"
                :options="[
                  { label: '男', value: '男' },
                  { label: '女', value: '女' },
                  { label: '其他', value: '其他' },
                ]"
                placeholder="选择性别"
              />
            </div>
            <div class="form-item">
              <label>年龄</label>
              <n-input v-model:value="form.settings.protagonist.age" placeholder="如 16 岁" />
            </div>
            <div class="form-item full-width">
              <label>身份背景</label>
              <n-input
                v-model:value="form.settings.protagonist.background"
                type="textarea"
                placeholder="出身、身世、初始处境等"
                :rows="2"
              />
            </div>
            <div class="form-item full-width">
              <label>性格特点</label>
              <div class="tags-grid compact">
                <span
                  v-for="tag in personalityTags"
                  :key="tag"
                  class="tag-chip clickable"
                  :class="{ active: form.settings.protagonist.personality.includes(tag) }"
                  @click="togglePersonality(tag)"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
            <div class="form-item full-width">
              <label>金手指 / 外挂</label>
              <n-input
                v-model:value="form.settings.protagonist.cheatDescription"
                type="textarea"
                placeholder="系统、传承、血脉等特殊能力"
                :rows="2"
              />
            </div>
          </div>
        </section>

        <!-- 世界观设定 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">🌍 世界观设定</h3>
          <div class="form-grid">
            <div class="form-item">
              <label>世界类型</label>
              <n-select
                v-model:value="form.settings.worldBuilding.worldType"
                :options="[
                  { label: '古代', value: '古代' },
                  { label: '现代', value: '现代' },
                  { label: '末世', value: '末世' },
                  { label: '星际', value: '星际' },
                  { label: '异世', value: '异世' },
                  { label: '混合', value: '混合' },
                ]"
                placeholder="选择世界类型"
              />
            </div>
            <div class="form-item">
              <label>世界规模</label>
              <n-select
                v-model:value="form.settings.worldBuilding.worldScale"
                :options="[
                  { label: '单大陆', value: '单大陆' },
                  { label: '多大陆', value: '多大陆' },
                  { label: '多星球', value: '多星球' },
                  { label: '多维度', value: '多维度' },
                ]"
                placeholder="选择世界规模"
              />
            </div>
            <div class="form-item">
              <label>社会结构</label>
              <n-input v-model:value="form.settings.worldBuilding.socialStructure" placeholder="宗门/王朝/帝国/家族/联邦" />
            </div>
            <div class="form-item full-width">
              <label>特殊规则</label>
              <n-input
                v-model:value="form.settings.worldBuilding.specialRules"
                type="textarea"
                placeholder="这个世界有什么特别的规则？"
                :rows="2"
              />
            </div>
          </div>
        </section>

        <!-- 力量体系 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">⚔️ 力量体系</h3>
          <div class="form-grid">
            <div class="form-item">
              <label>体系名称</label>
              <n-input v-model:value="form.settings.powerSystem.systemName" placeholder="修仙/斗气/超能力/魔法…" />
            </div>
            <div class="form-item full-width">
              <label>等级划分</label>
              <n-input
                v-model:value="form.settings.powerSystem.levelHierarchy"
                type="textarea"
                placeholder="如：练气→筑基→金丹→元婴→化神→合体→大乘→渡劫"
                :rows="2"
              />
            </div>
          </div>
        </section>

        <!-- 核心冲突 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">💥 核心冲突</h3>
          <div class="form-grid">
            <div class="form-item">
              <label>主线矛盾</label>
              <n-input v-model:value="form.settings.coreConflict.mainConflict" placeholder="复仇/崛起/拯救/探索…" />
            </div>
            <div class="form-item">
              <label>主要反派</label>
              <n-input v-model:value="form.settings.coreConflict.mainVillain" placeholder="反派设定描述" />
            </div>
            <div class="form-item full-width">
              <label>核心悬念</label>
              <n-input
                v-model:value="form.settings.coreConflict.coreSuspense"
                type="textarea"
                placeholder="贯穿全书的核心悬念是什么？"
                :rows="2"
              />
            </div>
          </div>
        </section>

        <!-- 感情线 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">💕 感情线</h3>
          <div class="form-grid">
            <div class="form-item">
              <label>感情类型</label>
              <n-select
                v-model:value="form.settings.romance.romanceType"
                :options="[
                  { label: '无感情线', value: '无感情线' },
                  { label: '单女主', value: '单女主' },
                  { label: '多女主', value: '多女主' },
                  { label: '后宫', value: '后宫' },
                ]"
                placeholder="选择感情类型"
              />
            </div>
            <div class="form-item">
              <label>发展节奏</label>
              <n-select
                v-model:value="form.settings.romance.developmentPace"
                :options="[
                  { label: '早期展开', value: '早期展开' },
                  { label: '中期发展', value: '中期发展' },
                  { label: '后期爆发', value: '后期爆发' },
                ]"
                placeholder="选择节奏"
              />
            </div>
            <div class="form-item full-width">
              <label>感情基调变化</label>
              <n-input
                v-model:value="form.settings.romance.toneChanges"
                placeholder="如：前期热烈→中期回避→后期释然"
              />
            </div>
          </div>
        </section>

        <!-- 爽点设计 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">🔥 爽点设计</h3>
          <div class="form-grid">
            <div class="form-item">
              <label>打脸频率</label>
              <n-select
                v-model:value="form.settings.payoff.faceSlapFrequency"
                :options="[
                  { label: '高频（几乎每章）', value: '高' },
                  { label: '中频', value: '中' },
                  { label: '低频（关键节点）', value: '低' },
                ]"
                placeholder="选择频率"
              />
            </div>
            <div class="form-item">
              <label>升级节奏</label>
              <n-select
                v-model:value="form.settings.payoff.levelUpPace"
                :options="[
                  { label: '快速升级', value: '快' },
                  { label: '适中', value: '中' },
                  { label: '慢热积累', value: '慢' },
                ]"
                placeholder="选择节奏"
              />
            </div>
            <div class="form-item full-width">
              <label>爽点模式（可多选）</label>
              <div class="tags-grid compact">
                <span
                  v-for="pattern in payoffPatterns"
                  :key="pattern"
                  class="tag-chip clickable"
                  :class="{ active: form.settings.payoff.patterns.includes(pattern) }"
                  @click="togglePayoffPattern(pattern)"
                >
                  {{ pattern }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- 结构设计 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">🏗️ 结构设计</h3>
          <div class="form-grid">
            <div class="form-item">
              <label>伏笔密度</label>
              <n-select
                v-model:value="form.settings.structure.foreshadowingDensity"
                :options="[
                  { label: '低（直白爽文，一两处提示即可）', value: '低' },
                  { label: '中等（常规网文，自然过渡）', value: '中等' },
                  { label: '高（偏悬疑色彩，伏笔较多）', value: '高' },
                  { label: '烧脑（草蛇灰线，线索极其隐蔽）', value: '烧脑' }
                ]"
                placeholder="选择伏笔密度"
              />
            </div>
          </div>
        </section>

        <!-- 其他设定 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">📝 其他设定</h3>
          <n-input
            v-model:value="form.settings.otherSettings"
            type="textarea"
            placeholder="任何额外的创意补充、特殊要求、参考作品等"
            :rows="4"
          />
        </section>

      </div>
    </div>

        <section class="form-section paper-panel knowledge-mount-section">
          <div class="knowledge-mount-header">
            <div>
              <h3 class="section-title">📚 挂载知识库</h3>
              <p class="section-hint">只读取本书勾选的资料，AI 自动写作和辅助写作都可以使用。每本小说的挂载关系独立保存。</p>
            </div>
            <n-switch v-model:value="form.knowledgeEnabled" />
          </div>
          <div v-if="form.knowledgeEnabled">
            <n-checkbox-group v-if="availableKnowledgeBases.length" v-model:value="selectedKnowledgeBaseIds">
              <div class="knowledge-mount-list">
                <n-checkbox v-for="kb in availableKnowledgeBases" :key="kb.id" :value="kb.id">
                  <span class="knowledge-mount-item">
                    <strong>{{ kb.name }}</strong>
                    <small>{{ kb.entries.length }} 条资料{{ kb.description ? ` · ${kb.description}` : '' }}</small>
                  </span>
                </n-checkbox>
              </div>
            </n-checkbox-group>
            <p v-else class="section-hint">书架还没有知识库，请先返回书架创建。</p>
          </div>
        </section>

    <!-- 底部操作栏 -->
    <div class="wizard-footer" id="wizard-footer">
      <n-button v-if="currentStep > 0" @click="currentStep--" size="large">
        上一步
      </n-button>
      <div class="footer-spacer"></div>
      <n-button
        v-if="currentStep < steps.length - 1"
        type="primary"
        size="large"
        :disabled="!canProceed"
        @click="currentStep++"
        id="wizard-next-btn"
      >
        下一步 →
      </n-button>
      <n-button
        v-else
        type="primary"
        size="large"
        :disabled="!canProceed || creating"
        :loading="creating"
        @click="handleCreate"
        id="wizard-create-btn"
      >
        ✨ 生成大纲
      </n-button>
      </div><!-- /wizard-footer -->
    </div><!-- /wizard-body -->
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  NButton, NIcon, NInput, NInputNumber, NSelect, NModal, NRadioButton, NRadioGroup, NSwitch, NCheckbox, NCheckboxGroup, useDialog, useMessage
} from 'naive-ui'
import { ArrowBackOutline } from '@vicons/ionicons5'
import { genres, themeTags } from '@/data/genres'
import { styleDimensions, personalityTags, payoffPatterns } from '@/data/styles'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import type { CreateWizardForm } from '@/types/novel'
import InspirationChat from '@/components/InspirationChat.vue'
import CreationModePicker from '@/components/CreationModePicker.vue'
import type { InspirationMessage } from '@/services/inspiration'

const router = useRouter()
const novelStore = useNovelStore()
const knowledgeStore = useKnowledgeStore()
const message = useMessage()
const dialog = useDialog()

const steps = ['类型 & 风格', '核心设定']
const currentStep = ref(0)
const showImportModal = ref(false)
const importJsonText = ref('')
const previewData = ref<Record<string, any> | null>(null)
const choosingCreationOptions = ref(true)
const setupMethod = ref<'inspiration' | 'custom' | null>(null)
const reviewingInspiration = ref(false)
const creating = ref(false)
const inspirationHistory = ref<InspirationMessage[]>([])
const previousCreationState = ref<{
  setupMethod: 'inspiration' | 'custom' | null
  reviewingInspiration: boolean
  currentStep: number
} | null>(null)
const showInspiration = computed(() => !choosingCreationOptions.value && setupMethod.value === 'inspiration' && !reviewingInspiration.value)
const showSettings = computed(() => !choosingCreationOptions.value && (setupMethod.value === 'custom' || reviewingInspiration.value))
const availableKnowledgeBases = computed(() => knowledgeStore.knowledgeBases)

function openCreationOptions() {
  if (choosingCreationOptions.value || creating.value) return
  previousCreationState.value = {
    setupMethod: setupMethod.value,
    reviewingInspiration: reviewingInspiration.value,
    currentStep: currentStep.value,
  }
  choosingCreationOptions.value = true
}

function startCreation() {
  if (!setupMethod.value || !form.writingMode || creating.value) return
  choosingCreationOptions.value = false
  previousCreationState.value = null
  currentStep.value = 0
  if (setupMethod.value === 'inspiration') reviewingInspiration.value = false
}

function applyInspiration(settings: CreateWizardForm, history: InspirationMessage[]) {
  if (!showInspiration.value || creating.value) return
  // Preparing settings never chooses who writes the prose. Keep the author's
  // current choice even if a response carries an older/different writing mode.
  Object.assign(form, settings, { writingMode: form.writingMode })
  inspirationHistory.value = history
  reviewingInspiration.value = true
  currentStep.value = 0
  message.success('设定已整理，请检查并确认')
}

function handleInspirationHistoryChange(history: InspirationMessage[]) {
  inspirationHistory.value = history
}

const hasInspirationDraft = computed(() =>
  setupMethod.value === 'inspiration' && inspirationHistory.value.some(item => item.role === 'user'),
)

function confirmLeave(): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    dialog.warning({
      title: '退出创建？',
      content: '灵感对话已自动保存到历史会话。确定退出创建页面吗？',
      positiveText: '退出创建',
      negativeText: '继续编辑',
      onPositiveClick: () => finish(true),
      onNegativeClick: () => finish(false),
      onClose: () => finish(false),
    })
  })
}

onBeforeRouteLeave(async () => {
  if (creating.value || !hasInspirationDraft.value) return true
  return confirmLeave()
})

const referenceAnalysisPrompt = `你是一名资深网文策划编辑。请根据我提供的参考小说资料，自动识别这本小说的类型、世界观、主角设定、力量体系、核心冲突、爽点结构和写作风格，并整理成适合导入“AI 小说写作软件”的新书创建配置。
重要：不要联网搜索，不要调用 web_search、browser、插件、函数或任何外部工具；只能基于我粘贴的资料和你的类型经验进行推断，并以普通文本返回一个完整 JSON 对象。

我可能只会提供以下任意一种资料：
- 书名
- 小说简介
- 目录
- 前几章正文
- TXT 文件内容
- 片段摘录

即使资料不完整，也请你根据网文类型规律合理推断。不要要求我补充大量资料。

分类可选范围：
- 玄幻：东方玄幻、异世大陆、异术超能、远古神话、转世重生、西方奇幻、王朝争霸、高武世界
- 仙侠：幻想修仙、修真文明、古典仙侠、现代修仙
- 武侠：传统武侠、武侠幻想、国术无双
- 都市：都市生活、都市异能、商战职场、娱乐明星、神医、鉴宝、都市修真、神豪
- 现实：时代叙事、家庭伦理、社会乡土
- 历史：架空历史、秦汉三国、两晋隋唐、两宋元明、清史民国、上古先秦、外国历史
- 军事：军旅生涯、军事战争、战争幻想、抗战烽火、特种兵、谍战风云
- 游戏：电子竞技、虚拟网游、游戏异界、游戏生涯
- 科幻：星际文明、末世危机、超级科技、时空穿梭、进化变异、古武机甲、未来世界
- 悬疑：侦探推理、诡秘悬疑、探险异闻、恐怖惊悚
- 体育：篮球运动、足球运动、其他运动、体育赛事
- 轻小说：原生幻想、二次元、衍生同人、校园日常
- 诸天：诸天无限、综漫、影视同人
- 其他：种田经营、灵气复苏、系统流、重生、穿越

目标字数要求：
- targetWordCountMin 和 targetWordCountMax 单位是“万字”。
- 请根据题材常见篇幅给出合理范围，不要因为参考作品已写很多字就照抄超长篇幅。
- 普通新书建议 80~150 万字；长篇升级流建议 150~250 万字；只有明确需要超长连载时才写 300 万字以上。
- 最大值和最小值的差距必须控制在 20 万字以内。

重要要求：
1. 你不是复刻原作，而是提炼“类型结构”和“创作模式”。
2. 不要照搬原作的人物名、地名、势力名、道具名、特殊能力名、剧情桥段。
3. 所有专有名词都要改写成通用、原创的新设定。
4. 保留可以借鉴的：题材类型、节奏结构、爽点模式、冲突类型、成长路径、世界观逻辑。
5. 如果提供了小说平台，平台只用于辅助判断类型风格、读者偏好、节奏和文风，不要照搬该平台爆款套路，也不要把分析结果写成模板化设定。
6. 不要把“神秘老者/隐藏高人/隐藏身份/幕后大能/古修遗物/残魂传承”当作默认替代设定；只有参考资料明确以这类结构为核心，且用户希望保留该结构时，才可抽象改写。
7. 输出结果必须适合创作一本文风/类型相似但不侵权的新书。
8. 最终严格只输出 JSON，不要 Markdown 代码块，不要解释文字。
9. writingStyle 必须从以下 value 中选择，不要自造英文枚举：
- narrativePov: first-person / third-limited / third-omniscient / multi-pov
- toneStyle: hot-blooded / humorous / dark / classical / modern / healing / epic / calm-calculated
- descriptionDensity: detailed / balanced / concise
- dialogueStyle: crisp / colloquial / classical-chinese / humorous-retort / formal / restrained
- combatStyle: explosive / strategic / realistic / elegant / tactical
- pacingControl: fast / normal / slow / slow-burn
- emotionExpression: restrained / intense / nuanced

请输出以下 JSON 结构：
{
  "genreLabel": "必须从以下大类中选择一个：玄幻、仙侠、武侠、都市、现实、历史、军事、游戏、科幻、悬疑、体育、轻小说、诸天、其他",
  "subGenreLabel": "必须从所选大类的子类中选择一个，仙侠只能选：幻想修仙、修真文明、古典仙侠、现代修仙",
  "tags": ["题材标签，必须尽量从以下可选项中选择：长生、种田、系统、重生、穿越、无敌、打脸、扮猪吃老虎、后宫、单女主、无女主、群像、日常、轻松、暗黑、争霸、宗门、家族、学院、副本、诸天流、救赎、复仇、经商、基建、慢热、爽文"],
  "targetWordCountMin": 100,
  "targetWordCountMax": 120,
  "writingStyle": {
    "narrativePov": "third-limited",
    "toneStyle": "hot-blooded",
    "descriptionDensity": "balanced",
    "dialogueStyle": "colloquial",
    "combatStyle": "explosive",
    "pacingControl": "normal",
    "emotionExpression": "nuanced"
  },
  "settings": {
    "protagonist": {
      "name": "",
      "gender": "",
      "age": "",
      "background": "",
      "personality": [],
      "initialPower": "",
      "cheatDescription": "",
      "romanceTendency": ""
    },
    "supportingCharacters": [],
    "worldBuilding": {
      "worldType": "",
      "worldScale": "",
      "socialStructure": "",
      "techLevel": "",
      "specialRules": ""
    },
    "powerSystem": {
      "systemName": "",
      "levelHierarchy": "",
      "combatStyleDesc": "",
      "auxiliarySystems": ""
    },
    "coreConflict": {
      "mainConflict": "",
      "mainVillain": "",
      "factionConflicts": "",
      "coreSuspense": ""
    },
    "romance": {
      "romanceType": "",
      "developmentPace": "",
      "toneChanges": "",
      "emotionalConflict": ""
    },
    "payoff": {
      "faceSlapFrequency": "",
      "levelUpPace": "",
      "patterns": []
    },
    "structure": {
      "foreshadowingDensity": "中等"
    },
    "otherSettings": ""
  }
}

【参考小说资料】
请在这里粘贴
书名：
小说平台：
小说简介：
目录：
前几章正文：
TXT 内容或任意片段摘录：
资料可以不完整，请自动分析和推断。`

// 表单数据
const form = reactive<CreateWizardForm>({
  writingMode: 'manual',
  knowledgeEnabled: false,
  knowledgeBaseIds: [],
  genre: '',
  subGenre: '',
  tags: [],
  targetWordCountMin: 80,
  targetWordCountMax: 120,
  writingStyle: novelStore.defaultWritingStyle(),
  settings: novelStore.defaultSettings(),
})

const selectedKnowledgeBaseIds = computed<string[]>({
  get: () => form.knowledgeBaseIds || [],
  set: value => { form.knowledgeBaseIds = value },
})

// 当前选中的大类
const selectedGenre = computed(() =>
  genres.find(g => g.value === form.genre) || null
)

// 是否可以进入下一步
const canProceed = computed(() => {
  const genre = genres.find(item => item.value === form.genre)
  return Boolean(genre?.children.some(item => item.value === form.subGenre))
    && form.targetWordCountMin >= 1 && form.targetWordCountMax >= form.targetWordCountMin && form.targetWordCountMax <= 999
})

// 选择大类
function selectGenre(value: string) {
  form.genre = value
  form.subGenre = '' // 重置子类
}

// 切换题材标签
function toggleTag(tag: string) {
  const index = form.tags.indexOf(tag)
  if (index === -1) {
    form.tags.push(tag)
  } else {
    form.tags.splice(index, 1)
  }
}

// 切换性格标签
function togglePersonality(tag: string) {
  const arr = form.settings.protagonist.personality
  const index = arr.indexOf(tag)
  if (index === -1) {
    arr.push(tag)
  } else {
    arr.splice(index, 1)
  }
}

// 切换爽点模式
function togglePayoffPattern(pattern: string) {
  const arr = form.settings.payoff.patterns
  const index = arr.indexOf(pattern)
  if (index === -1) {
    arr.push(pattern)
  } else {
    arr.splice(index, 1)
  }
}

async function copyReferencePrompt() {
  try {
    await navigator.clipboard.writeText(referenceAnalysisPrompt)
    message.success('分析提示词已复制')
  } catch {
    message.error('复制失败，请手动复制')
  }
}

function extractJson(text: string): string {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)```/i)
  if (codeBlock) return codeBlock[1].trim()
  const objectMatch = text.match(/\{[\s\S]*\}/)
  return objectMatch ? objectMatch[0] : text.trim()
}

function findGenreByLabel(label: string) {
  return genres.find(g => g.label === label || g.value === label)
}

function findSubGenreByLabel(genreValue: string, label: string) {
  const genre = genres.find(g => g.value === genreValue)
  if (!genre) return undefined
  const normalizedLabel = label.replace(/小说|类|文/g, '').trim()
  return genre.children.find(s => {
    const normalizedSubLabel = s.label.replace(/小说|类|文/g, '').trim()
    return s.label === label || s.value === label || normalizedSubLabel === normalizedLabel || s.label.includes(normalizedLabel) || normalizedLabel.includes(s.label)
  })
}

function normalizeTagText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[《》「」『』“”"'、，,。；;：:\s]/g, '')
    .replace(/小说|题材|类型|标签|流|文/g, '')
    .trim()
}

function findThemeTagByText(value: string): string | undefined {
  const normalized = normalizeTagText(value)
  if (!normalized) return undefined
  const exact = themeTags.find(tag => tag === value || normalizeTagText(tag) === normalized)
  if (exact) return exact

  const aliasMap: Record<string, string[]> = {
    长生: ['长生', '永生', '寿命', '不老', '长寿'],
    种田: ['种田', '经营', '农场', '灵田', '资源经营'],
    系统: ['系统', '面板', '金手指', '外挂'],
    重生: ['重生', '回到过去', '再来一次'],
    穿越: ['穿越', '异世', '魂穿', '身穿'],
    无敌: ['无敌', '碾压', '开局无敌'],
    打脸: ['打脸', '反转', '装逼'],
    扮猪吃老虎: ['扮猪吃虎', '藏拙', '低调', '伪装弱小'],
    后宫: ['后宫', '多女主'],
    单女主: ['单女主', '一女主', '唯一女主'],
    无女主: ['无女主', '无cp', '无感情线'],
    群像: ['群像', '多主角', '众生相'],
    日常: ['日常', '生活流'],
    轻松: ['轻松', '轻喜剧', '诙谐'],
    暗黑: ['暗黑', '黑暗', '压抑'],
    争霸: ['争霸', '势力', '战争', '宗门战争'],
    宗门: ['宗门', '门派', '修仙门派'],
    家族: ['家族', '世家'],
    学院: ['学院', '学宫', '书院'],
    副本: ['副本', '秘境', '试炼'],
    诸天流: ['诸天', '无限', '万界'],
    救赎: ['救赎', '治愈'],
    复仇: ['复仇', '报仇'],
    经商: ['经商', '商业', '商战'],
    基建: ['基建', '建设', '发展领地'],
    慢热: ['慢热', '凡人流', '苦修', '稳健成长', '草根成长'],
    爽文: ['爽文', '爽点', '快节奏'],
  }

  for (const [tag, aliases] of Object.entries(aliasMap)) {
    if (!themeTags.includes(tag)) continue
    if (aliases.some(alias => normalized.includes(normalizeTagText(alias)) || normalizeTagText(alias).includes(normalized))) {
      return tag
    }
  }
  return undefined
}

function inferThemeTags(data: Record<string, any>): string[] {
  const imported = Array.isArray(data.tags) ? data.tags.filter((v: unknown) => typeof v === 'string') as string[] : []
  const source = [
    ...imported,
    data.genreLabel,
    data.subGenreLabel,
    data.genre,
    data.subGenre,
    data.settings?.worldBuilding?.worldType,
    data.settings?.worldBuilding?.socialStructure,
    data.settings?.worldBuilding?.specialRules,
    data.settings?.powerSystem?.systemName,
    data.settings?.powerSystem?.levelHierarchy,
    data.settings?.coreConflict?.mainConflict,
    data.settings?.coreConflict?.coreSuspense,
    data.settings?.payoff?.faceSlapFrequency,
    data.settings?.payoff?.levelUpPace,
    ...(Array.isArray(data.settings?.payoff?.patterns) ? data.settings.payoff.patterns : []),
    data.settings?.otherSettings,
  ].filter(Boolean).join(' ')

  const matched = new Set<string>()
  for (const item of imported) {
    const tag = findThemeTagByText(item)
    if (tag) matched.add(tag)
  }
  for (const tag of themeTags) {
    if (source.includes(tag)) matched.add(tag)
  }
  for (const token of source.split(/[、，,。\s/；;：:]+/).filter(Boolean)) {
    const tag = findThemeTagByText(token)
    if (tag) matched.add(tag)
  }

  if (form.genre === 'xianxia' && matched.size === 0) {
    matched.add('慢热')
    matched.add('宗门')
  }
  return Array.from(matched).slice(0, 8)
}

function getFallbackSubGenre(genreValue: string, data: Record<string, any>) {
  const genre = genres.find(g => g.value === genreValue)
  if (!genre) return undefined
  const text = [data.subGenreLabel, data.subGenre, data.genreLabel, data.genre, data.settings?.worldBuilding?.worldType, data.settings?.powerSystem?.systemName, data.settings?.otherSettings]
    .filter(Boolean)
    .join(' ')
  if (genreValue === 'xianxia') {
    if (/现代|都市/.test(text)) return genre.children.find(s => s.label === '现代修仙')
    if (/文明|宗门|修真/.test(text)) return genre.children.find(s => s.label === '修真文明')
    if (/古典|传统/.test(text)) return genre.children.find(s => s.label === '古典仙侠')
    return genre.children.find(s => s.label === '幻想修仙')
  }
  return genre.children[0]
}

function assignString(target: Record<string, any>, source: Record<string, any>, key: string) {
  if (typeof source[key] === 'string' && source[key].trim()) target[key] = source[key].trim()
}

function mergeObject(target: Record<string, any>, source: unknown) {
  if (!source || typeof source !== 'object') return
  for (const [key, value] of Object.entries(source as Record<string, any>)) {
    if (Array.isArray(value)) {
      target[key] = value.filter(v => typeof v === 'string')
    } else if (typeof value === 'string' && value.trim()) {
      target[key] = value.trim()
    }
  }
}

function formatPreviewList(value: unknown): string {
  if (Array.isArray(value)) {
    const list = value.filter(v => typeof v === 'string' && v.trim())
    return list.length ? list.join('、') : '未填写'
  }
  if (typeof value === 'string' && value.trim()) return value.trim()
  return '未填写'
}

function formatAntiPlagiarismNotes(value: unknown): string {
  if (Array.isArray(value)) return formatPreviewList(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}：${formatPreviewList(item)}`)
      .join('；')
  }
  return '未填写'
}

function parseImportedSettings() {
  try {
    previewData.value = JSON.parse(extractJson(importJsonText.value))
  } catch {
    message.error('JSON 解析失败，请确认复制的是完整 JSON')
  }
}

function applyImportedData(data: Record<string, any>) {
  if (typeof data.genre === 'string') form.genre = data.genre
  else if (typeof data.genreLabel === 'string') {
    const genre = findGenreByLabel(data.genreLabel)
    if (genre) form.genre = genre.value
  }

  if (typeof data.subGenre === 'string') form.subGenre = data.subGenre
  else if (typeof data.subGenreLabel === 'string' && form.genre) {
    const sub = findSubGenreByLabel(form.genre, data.subGenreLabel) || getFallbackSubGenre(form.genre, data)
    if (sub) form.subGenre = sub.value
  } else if (form.genre) {
    const sub = getFallbackSubGenre(form.genre, data)
    if (sub) form.subGenre = sub.value
  }

  form.tags = inferThemeTags(data)
  if (typeof data.targetWordCountMin === 'number') form.targetWordCountMin = data.targetWordCountMin
  if (typeof data.targetWordCountMax === 'number') form.targetWordCountMax = data.targetWordCountMax

  mergeObject(form.writingStyle as Record<string, any>, data.writingStyle)

  const settings = data.settings || {}
  mergeObject(form.settings.protagonist, settings.protagonist)
  mergeObject(form.settings.worldBuilding, settings.worldBuilding)
  mergeObject(form.settings.powerSystem, settings.powerSystem)
  mergeObject(form.settings.coreConflict, settings.coreConflict)
  mergeObject(form.settings.romance, settings.romance)
  mergeObject(form.settings.payoff, settings.payoff)
  mergeObject(form.settings.structure, settings.structure)
  if (Array.isArray(settings.supportingCharacters)) form.settings.supportingCharacters = settings.supportingCharacters
  assignString(form.settings, settings, 'otherSettings')
}

function confirmImportSettings() {
  if (!previewData.value) return
  applyImportedData(previewData.value)
  showImportModal.value = false
  importJsonText.value = ''
  previewData.value = null
  message.success('设定已导入，可继续微调')
}

// 返回书架
function handleBack() {
  if (choosingCreationOptions.value && previousCreationState.value) {
    const previous = previousCreationState.value
    setupMethod.value = previous.setupMethod
    reviewingInspiration.value = previous.reviewingInspiration
    currentStep.value = previous.currentStep
    choosingCreationOptions.value = false
    previousCreationState.value = null
    return
  }
  router.push('/')
}

// 创建小说
async function handleCreate() {
  if (!showSettings.value || !canProceed.value || creating.value) return
  creating.value = true
  try {
    const novel = novelStore.addNovel(form)
    // Keep accepted inspiration as source material, not assistant chat turns.
    novelStore.setInspirationHistory(novel.id, inspirationHistory.value.map((item, index) => ({
      ...item, id: `inspiration-${novel.id}-${index}`, timestamp: new Date().toISOString(),
    })))
    await novelStore.saveNovelNow(novel.id)
    message.success('小说已创建，正在跳转到大纲生成...')
    await router.push(`/generate/${novel.id}`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创建失败')
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.reference-import-panel {
  margin-bottom: var(--space-lg);
}

.knowledge-mount-section { margin-top: var(--space-lg); }
.knowledge-mount-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.knowledge-mount-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin-top: 12px; }
.knowledge-mount-item { display: inline-flex; flex-direction: column; gap: 2px; }
.knowledge-mount-item small { color: var(--text-color-tertiary); font-size: 12px; line-height: 1.5; }
@media (max-width: 680px) {
  .knowledge-mount-list { grid-template-columns: minmax(0, 1fr); }
}

.settings-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 4px;
}

.preview-section {
  padding: 14px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-md);
  background: var(--bg-color-secondary);
}

.preview-section h4 {
  margin-bottom: 10px;
  font-size: 15px;
  color: var(--text-color-primary);
}

.preview-grid {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px 12px;
}

.preview-label {
  color: var(--text-color-tertiary);
  font-size: 13px;
}

.preview-value,
.preview-paragraph {
  color: var(--text-color-secondary);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.reference-import-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
}

.reference-import-actions,
.import-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.import-hint {
  margin-top: 6px;
  color: var(--text-color-tertiary);
  font-size: 13px;
}

.wizard-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: var(--space-lg);
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

/* 步骤指示器 */
.steps-indicator {
  display: flex;
  align-items: center;
  gap: 40px;
  padding: 16px 24px;
  background: var(--bg-color-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--space-xl);
  position: relative;
  overflow: hidden;
  transition: background-color var(--transition-normal);
}

.step-line {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--color-primary), var(--color-primary-suppl));
  border-radius: 100px;
  transition: width 0.4s ease;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 1;
}

.step-dot {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 600;
  background: var(--bg-color-secondary);
  color: var(--text-color-tertiary);
  transition: all var(--transition-normal);
}

.step-active .step-dot {
  background: var(--color-primary);
  color: var(--text-color-inverse);
  box-shadow: 0 2px 8px rgba(255, 77, 46, 0.3);
}

.step-completed .step-dot {
  background: var(--color-success);
  color: white;
}

.step-label {
  font-size: 14px;
  color: var(--text-color-tertiary);
  font-weight: 500;
  transition: color var(--transition-normal);
}

.step-active .step-label {
  color: var(--text-color-primary);
  font-weight: 600;
}

.step-completed .step-label {
  color: var(--color-success);
}

/* 表单区域 */
.wizard-page {
  animation: fadeIn 0.3s ease;
}

.form-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  padding-bottom: 100px; /* 留出底部操作栏空间 */
}

.form-section {
  padding: var(--space-lg);
}

.section-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-color-primary);
  margin-bottom: var(--space-md);
}

.section-hint {
  font-size: 13px;
  color: var(--text-color-tertiary);
  margin-top: -8px;
  margin-bottom: var(--space-md);
}

.subsection-title {
  font-size: 14px;
  color: var(--text-color-secondary);
  margin: var(--space-md) 0 var(--space-sm);
  font-weight: 500;
}

/* 类型选择网格 */
.genre-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.genre-btn {
  padding: 8px 18px;
  border: 1px solid var(--border-color);
  border-radius: 100px;
  background: var(--bg-color);
  color: var(--text-color-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.genre-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.genre-btn--active {
  background: var(--color-primary) !important;
  color: var(--text-color-inverse) !important;
  border-color: var(--color-primary) !important;
  font-weight: 600;
}

.sub-genre-btn {
  font-size: 13px;
  padding: 6px 14px;
}

.subgenre-section {
  animation: fadeIn 0.3s ease;
}

/* 标签网格 */
.tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tags-grid.compact {
  gap: 6px;
}

.tags-section {
  animation: fadeIn 0.3s ease;
}

/* 字数输入 */
.word-count-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.word-input {
  width: 140px;
}

.word-sep {
  font-size: 18px;
  color: var(--text-color-tertiary);
}

.word-unit {
  font-size: 14px;
  color: var(--text-color-secondary);
}

/* 风格维度 */
.style-dimensions {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.style-dimension {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.dim-label {
  min-width: 80px;
  font-size: 14px;
  color: var(--text-color-secondary);
  padding-top: 6px;
  font-weight: 500;
  flex-shrink: 0;
}

.dim-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dim-btn {
  padding: 5px 14px;
  border: 1px solid var(--border-color);
  border-radius: 100px;
  background: transparent;
  color: var(--text-color-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.dim-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.dim-btn--active {
  background: var(--color-primary) !important;
  color: var(--text-color-inverse) !important;
  border-color: var(--color-primary) !important;
  font-weight: 500;
}

/* 表单网格 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-item.full-width {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 13px;
  color: var(--text-color-secondary);
  font-weight: 500;
}

/* 底部操作栏 */
.wizard-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 16px 0;
  background: var(--bg-color-header);
  border-top: 1px solid var(--border-color-light);
  backdrop-filter: blur(12px);
  z-index: 10;
  margin-top: var(--space-xl);
  transition: background-color var(--transition-normal);
}

.footer-spacer {
  flex: 1;
}

/* ========= 向导布局 ========= */
.wizard-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.wizard-top {
  flex-shrink: 0;
  padding: var(--space-xl) var(--space-xl) 0;
}

.wizard-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 var(--space-xl) 80px;
}
.creation-combination { margin: -8px 0 16px; color: var(--text-color-secondary); font-size: 13px; line-height: 1.6; }
.creation-writing-mode { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-bottom: 20px; }
.wizard-layout > :deep(.inspiration-chat) { padding: 0 24px; box-sizing: border-box; }
.wizard-header { flex-wrap: wrap; }
@media (max-width: 640px) {
  .wizard-top { padding: 16px 16px 0; }
  .wizard-body { padding: 0 16px 24px; }
  .steps-indicator { padding: 12px; gap: 16px; }
  .reference-import-header { flex-direction: column; align-items: stretch; }
  .reference-import-actions { flex-wrap: wrap; }
  .form-grid { grid-template-columns: minmax(0, 1fr); }
  .style-dimension { flex-direction: column; gap: 4px; }
  .word-count-row { flex-wrap: wrap; }
}
</style>
