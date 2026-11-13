<template>
  <div class="wizard-layout" :class="{ 'choosing-options': choosingCreationOptions }" id="create-wizard-page">
    <!-- 顶部固定区 -->
    <div v-if="!choosingCreationOptions" class="wizard-top">
      <!-- 向导头部 -->
      <div class="wizard-header">
        <button class="back-btn" @click="handleBack" id="wizard-back-btn">
          <n-icon :size="20"><arrow-back-outline /></n-icon>
          <span>{{ choosingCreationOptions && previousCreationState ? '返回' : '返回书架' }}</span>
        </button>
        <span v-if="!choosingCreationOptions && setupMethod" class="creation-combination" role="status">{{ form.writingMode === 'ai' ? 'AI 模式' : '作者主笔' }} · {{ creationSetupLabels[setupMethod] }}</span>
        <n-button v-if="!choosingCreationOptions" quaternary :disabled="creating" @click="openCreationOptions">更换搭配</n-button>
        <n-button v-if="!choosingCreationOptions && setupMethod === 'inspiration' && reviewingInspiration"
          quaternary :disabled="creating" @click="reviewingInspiration = false">返回灵感对话</n-button>
        <n-button v-if="showInspiration" quaternary :disabled="creating" @click="discussingInspiration = false">保留讨论，返回创建输入</n-button>
      </div>

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
            <n-icon v-if="currentStep > index" :size="15" aria-hidden="true"><checkmark-outline /></n-icon>
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
      :disabled="creating" @start="startCreation">
      <template v-if="setupMethod === 'inspiration'" #input>
        <section class="origin-seed">
          <label for="origin-idea">一句话灵感</label>
          <textarea id="origin-idea" v-model="ideaSentence" :disabled="creating" maxlength="4000" rows="2" aria-label="起点灵感草稿" placeholder="一个人物、一个冲突或一个场景，就可以作为起点……" />
          <p>先记下想法，下一步可继续编辑或展开对话。继续不会自动调用模型，也不会批准任何故事事实。</p>
        </section>
      </template>
    </creation-mode-picker>
    <div v-if="showEntry && !discussingInspiration" class="creation-entry-body">
      <CreationEntrySource v-if="creationCheckpoint" :input="creationCheckpoint" />
      <section class="paper-panel creation-entry-panel">
        <h2>{{ setupMethod ? creationSetupLabels[setupMethod] : '' }}</h2>
        <p>保存创建输入后，依次编辑作品契约、比较骨架候选并确认规划。此处不会生成正文或批准故事事实。</p>
        <label>作品名称（可稍后填写）<n-input v-model:value="form.workingTitle" :disabled="creating || !!createdNovelId" placeholder="可在作品契约中继续修改" aria-label="新作品名称" /></label>
        <template v-if="setupMethod === 'inspiration'">
          <label>一句话灵感<n-input v-model:value="ideaSentence" type="textarea" :rows="4" :maxlength="4000" :disabled="creating || !!createdNovelId" aria-label="一句话灵感" placeholder="一个人物、一个冲突或一个场景，就可以作为起点" /></label>
          <n-checkbox v-model:checked="includeInspirationHistory" :disabled="creating || !!createdNovelId || !inspirationHistory.length">一并保存当前灵感讨论（{{ inspirationHistory.length }} 条）</n-checkbox>
          <n-button :disabled="creating || !!createdNovelId" @click="openInspirationDiscussion">继续已有讨论 / 展开灵感对话</n-button>
          <p>一句话即可开始，不要求先调用模型整理设定。选用讨论时，创建会保存当前选择的讨论记录。</p>
        </template>
        <CreationOutlineInput v-if="setupMethod === 'outline'" v-model="outlineInput" :saved="outlineSaved"
          :disabled="creating || !!createdNovelId" @save="saveOutlineInput" @reading="outlineReading = $event" />
        <p v-if="setupMethod === 'blank'">创建空白作品契约：类型、主题、冲突和大纲保持未填写。无需配置模型，可先手工保存草稿。</p>
        <section class="entry-origin">
          <h3>故事时间起点（可暂不确定）</h3>
          <label>起始故事日<n-input-number v-model:value="storyOriginDay" :min="0" :max="100000000" :step="0.01"
            :disabled="creating || !!createdNovelId" aria-label="创建起始故事日" placeholder="留空表示未知；0 也须明确填写" /></label>
          <label>起点名称（随起始日保存）<n-input v-model:value="storyOriginLabel" :disabled="creating || !!createdNovelId" /></label>
          <p role="status">{{ storyOriginDay === null ? '未填写起始日：创建后保持未知，不自动确认故事日 0。' : `创建时确认作者填写的故事日 ${storyOriginDay}` }}</p>
          <p v-if="storyOriginDay === null && storyOriginLabel.trim()" role="alert">请填写对应的起始日，或清除起点名称以保持未知。</p>
        </section>
        <n-button type="primary" size="large" :loading="creating" :disabled="creating || (!createdNovelId && (!canProceed || outlineReading))" @click="handleCreate" id="entry-create-btn">{{ createdNovelId ? '打开已创建的作品' : '保存输入并创建，进入作品契约' }}</n-button>
        <p v-if="createdNovelId" role="status">作品和输入已保存；再次点击只会打开这部作品。</p>
      </section>
    </div>
    <inspiration-chat v-show="showInspiration"
      :active="showInspiration" :form="form" @apply="applyInspiration" @draft-change="updateInspirationDraft" @history-change="handleInspirationHistoryChange" />
    <div v-show="showSettings" class="wizard-body">



      <n-modal v-model:show="showImportModal" preset="card" title="导入参考小说设定" style="width: min(820px, calc(100vw - 32px));">
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
        <section class="form-section paper-panel"><h3 class="section-title">作品名称（可稍后填写）</h3><n-input v-model:value="form.workingTitle" :disabled="creating || !!createdNovelId" placeholder="在作品契约中继续确认" /></section>
        <!-- 小说类型 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">小说类型</h3>
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
          <h3 class="section-title">目标字数（万字）</h3>
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
          <h3 class="section-title">写作风格</h3>
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
          <h3 class="section-title">主角设定</h3>
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
          <h3 class="section-title">世界观设定</h3>
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
          <h3 class="section-title">力量体系</h3>
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

      </div>
    </div>
    <div v-if="currentStep === 2" class="wizard-page" id="wizard-page-3"><div class="form-sections">
        <!-- 核心冲突 -->
        <section class="form-section paper-panel">
          <h3 class="section-title">核心冲突</h3>
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
          <h3 class="section-title">感情线</h3>
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
          <h3 class="section-title">爽点设计</h3>
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
          <h3 class="section-title">结构设计</h3>
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
          <h3 class="section-title">其他设定</h3>
          <n-input
            v-model:value="form.settings.otherSettings"
            type="textarea"
            placeholder="任何额外的创意补充、特殊要求、参考作品等"
            :rows="4"
          />
        </section>

      </div>
    </div>



<aside class="wizard-overview"><section class="wizard-current-settings paper-panel"><h2>本书设定</h2><p>根据当前选择整理，随填写即时更新。</p><dl><div><dt>小说类型</dt><dd>{{ selectedGenre?.label || '尚未选择' }}<small>{{ selectedGenre?.children.find(sub => sub.value === form.subGenre)?.label }}</small></dd></div><div><dt>目标字数</dt><dd>{{ form.targetWordCountMin }} 万 — {{ form.targetWordCountMax }} 万字</dd></div><div><dt>写作风格</dt><dd>{{ currentStyleSummary || '尚未选择' }}</dd></div><div v-if="form.settings.protagonist.name"><dt>主角</dt><dd>{{ form.settings.protagonist.name }}</dd></div><div v-if="form.settings.coreConflict.coreSuspense"><dt>核心悬念</dt><dd>{{ form.settings.coreConflict.coreSuspense }}</dd></div></dl></section>      <section class="reference-import-panel paper-panel">
        <div class="reference-import-header">
          <div>
            <h3 class="section-title">参考小说设定</h3>
            <p class="import-hint">复制提示词给其他 AI 分析参考小说，再把返回的 JSON 粘贴回来一键填充设定。</p>
          </div>
          <div class="reference-import-actions">
            <n-button @click="copyReferencePrompt">复制分析提示词</n-button>
            <n-button type="primary" @click="showImportModal = true">粘贴 / 导入设定</n-button>
          </div>
        </div>
      </section>        <section class="form-section paper-panel knowledge-mount-section">
          <div class="knowledge-mount-header">
            <div>
              <h3 class="section-title">挂载知识库</h3>
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
        <section class="form-section paper-panel">
          <h3 class="section-title">故事时间起点</h3>
          <p class="section-hint">故事日是本书的时间坐标。留空保持未知；只有明确填写后创建，才保存作者起点来源，之后可在数据面板纠正。</p>
          <div class="form-item">
            <label>起始故事日</label>
            <n-input-number v-model:value="storyOriginDay" :min="0" :max="100000000" :step="0.01"
              :disabled="creating || !!createdNovelId" aria-label="起始故事日" placeholder="明确填写，包括 0" />
          </div>
          <div class="form-item">
            <label>起点名称（可选）</label>
            <n-input v-model:value="storyOriginLabel" :disabled="creating || !!createdNovelId" placeholder="例如：玄历三年春，抵达当天" />
          </div>
          <p role="status">{{ storyOriginDay === null ? '未填写：起点保持未知，不补 0。若填写起点名称，也请填写对应故事日。' : `创建时将确认：故事日 ${storyOriginDay}${storyOriginLabel.trim() ? ` · ${storyOriginLabel.trim()}` : ''}` }}</p>
        </section>
      </aside>
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
        :disabled="(!createdNovelId && !canProceed) || creating"
        :loading="creating"
        @click="handleCreate"
        id="wizard-create-btn"
      >
        {{ createdNovelId ? '打开已创建的作品' : '保存输入并创建，进入作品契约' }}
      </n-button>
      </div><!-- /wizard-footer -->
    </div><!-- /wizard-body -->
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  NButton, NIcon, NInput, NInputNumber, NSelect, NModal, NSwitch, NCheckbox, NCheckboxGroup, useDialog, useMessage
} from 'naive-ui'
import { ArrowBackOutline, CheckmarkOutline } from '@vicons/ionicons5'
import { genres, themeTags } from '@/data/genres'
import { styleDimensions, personalityTags, payoffPatterns } from '@/data/styles'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { prepareStoryCreation } from '@/services/storyCreation'
import type { CreateWizardForm } from '@/types/novel'
import InspirationChat from '@/components/InspirationChat.vue'
import CreationModePicker from '@/v3/create/CreationModePicker.vue'
import CreationOutlineInput from '@/components/CreationOutlineInput.vue'
import CreationEntrySource from '@/components/CreationEntrySource.vue'
import { creationSetupLabels, type CreationSetupMethod, type CreationOutlineInput as OutlineInput, type CreationEntryInput } from '@/types/creationEntry'
import { assertCreationEntryInput, creationOutlineInputSignature } from '@/services/creationEntryInput'
import type { InspirationMessage } from '@/services/inspiration'


const router = useRouter()
const novelStore = useNovelStore()
const knowledgeStore = useKnowledgeStore()
const reconstructionWorkspaceStore = useReconstructionWorkspaceStore()
const message = useMessage()
const dialog = useDialog()

const steps = ['类型与风格', '主角与世界', '冲突与确认']
const currentStep = ref(0)
const showImportModal = ref(false)
const importJsonText = ref('')
const previewData = ref<Record<string, any> | null>(null)
const choosingCreationOptions = ref(true)
const setupMethod = ref<CreationSetupMethod | null>(null)
const reviewingInspiration = ref(false)
const discussingInspiration = ref(false)
const ideaSentence = ref(''), includeInspirationHistory = ref(false)
const outlineInput = ref<OutlineInput>(), savedOutlineInput = ref<OutlineInput>(), outlineReading = ref(false)
const outlineSaved = computed(() => !!savedOutlineInput.value && creationOutlineInputSignature(outlineInput.value) === creationOutlineInputSignature(savedOutlineInput.value))
const creationCheckpoint = computed<CreationEntryInput | undefined>(() => {
  if (!setupMethod.value) return undefined
  if (setupMethod.value === 'outline') return savedOutlineInput.value ? { method: 'outline', outline: savedOutlineInput.value, savedAt: savedOutlineInput.value.savedAt || savedOutlineInput.value.capturedAt } : undefined
  const savedAt = new Date().toISOString()
  if (setupMethod.value === 'inspiration' && ideaSentence.value.trim()) return { method: 'inspiration', idea: ideaSentence.value, includeDiscussion: includeInspirationHistory.value, savedAt }
  if (setupMethod.value === 'blank') return { method: 'blank', savedAt }
  return undefined
})
const creationId = crypto.randomUUID()
let committedCreation: ReturnType<typeof prepareStoryCreation> | undefined
const creating = ref(false)
const createdNovelId = ref('')
const inspirationHistory = ref<InspirationMessage[]>([])
const previousCreationState = ref<{
  setupMethod: CreationSetupMethod | null
  reviewingInspiration: boolean
  discussingInspiration: boolean
  currentStep: number
} | null>(null)
const showEntry = computed(() => !choosingCreationOptions.value && !!setupMethod.value && setupMethod.value !== 'custom' && !reviewingInspiration.value)
const showInspiration = computed(() => showEntry.value && setupMethod.value === 'inspiration' && discussingInspiration.value)
const showSettings = computed(() => !choosingCreationOptions.value && (setupMethod.value === 'custom' || reviewingInspiration.value))
const availableKnowledgeBases = computed(() => knowledgeStore.knowledgeBases)

function openCreationOptions() {
  if (choosingCreationOptions.value || creating.value) return
  previousCreationState.value = {
    setupMethod: setupMethod.value,
    reviewingInspiration: reviewingInspiration.value,
    discussingInspiration: discussingInspiration.value,
    currentStep: currentStep.value,
  }
  choosingCreationOptions.value = true
}

function startCreation() {
  if (!setupMethod.value || !form.writingMode || creating.value) return
  choosingCreationOptions.value = false
  previousCreationState.value = null
  currentStep.value = 0
  reviewingInspiration.value = false; discussingInspiration.value = false
}
function openInspirationDiscussion() { discussingInspiration.value = true; includeInspirationHistory.value = true }
function saveOutlineInput(value: OutlineInput) { savedOutlineInput.value = JSON.parse(JSON.stringify(value)) }

function updateInspirationDraft(settings: CreateWizardForm) {
  if (!showInspiration.value || creating.value) return
  Object.assign(form, settings, { writingMode: form.writingMode })
}

function applyInspiration(settings: CreateWizardForm, history: InspirationMessage[]) {
  if (!showInspiration.value || creating.value) return
  // Preparing settings never chooses who writes the prose. Keep the author's
  // current choice even if a response carries an older/different writing mode.
  Object.assign(form, settings, { writingMode: form.writingMode })
  inspirationHistory.value = history
  includeInspirationHistory.value = true
  reviewingInspiration.value = true
  currentStep.value = 0
  message.success('设定已整理，请检查并确认')
}

function handleInspirationHistoryChange(history: InspirationMessage[]) {
  inspirationHistory.value = history
}

const hasCreationInput = computed(() => !createdNovelId.value && (!!outlineInput.value?.text.trim() || !!ideaSentence.value.trim()
  || setupMethod.value === 'inspiration' && includeInspirationHistory.value && inspirationHistory.value.some(item => item.role === 'user')))

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
      content: '本页的创建输入尚未随作品保存。灵感对话可在历史会话中继续；本页填写或导入的大纲尚未创建入库。确定退出吗？',
      positiveText: '退出创建',
      negativeText: '继续编辑',
      onPositiveClick: () => finish(true),
      onNegativeClick: () => finish(false),
      onClose: () => finish(false),
    })
  })
}

onBeforeRouteLeave(async () => {
  if (creating.value || !hasCreationInput.value) return true
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
// Author-owned inputs stay separate from AI/imported settings. They enter the
// creation aggregate only when the author clicks the final create action.
const storyOriginDay = ref<number | null>(null)
const storyOriginLabel = ref('')
const form = reactive<CreateWizardForm>({
  workingTitle: '',
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
const currentStyleSummary = computed(() => styleDimensions.map(dimension => dimension.options.find(option => option.value === (form.writingStyle as unknown as Record<string, string>)[dimension.key])?.label).filter(Boolean).slice(0, 4).join('、'))

// 是否可以进入下一步
const canProceed = computed(() => {
  const genre = genres.find(item => item.value === form.genre)
  const timeValid = storyOriginDay.value === null ? !storyOriginLabel.value.trim()
    : typeof storyOriginDay.value === 'number' && Number.isFinite(storyOriginDay.value) && storyOriginDay.value >= 0 && storyOriginDay.value <= 100000000
  if (!timeValid) return false
  if (setupMethod.value === 'blank') return true
  if (setupMethod.value === 'outline') return outlineSaved.value && !outlineReading.value
  if (setupMethod.value === 'inspiration') return !!ideaSentence.value.trim()
    || includeInspirationHistory.value && inspirationHistory.value.some(item => item.role === 'user' && item.content.trim())
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
    discussingInspiration.value = previous.discussingInspiration
    currentStep.value = previous.currentStep
    choosingCreationOptions.value = false
    previousCreationState.value = null
    return
  }
  router.push('/')
}

// 创建小说
async function handleCreate() {
  if ((!showSettings.value && !showEntry.value) || !setupMethod.value || (!createdNovelId.value && !canProceed.value) || creating.value) return
  creating.value = true
  try {
    if (!createdNovelId.value) {
      const now = new Date().toISOString()
      const input: CreationEntryInput = { method: setupMethod.value, savedAt: now,
        ...(setupMethod.value === 'inspiration' ? { idea: ideaSentence.value, includeDiscussion: includeInspirationHistory.value } : {}),
        ...(setupMethod.value === 'outline' ? { outline: savedOutlineInput.value } : {}) }
      assertCreationEntryInput(input)
      const prepared = prepareStoryCreation({ ...form, creationInput: input,
        storyTimeOrigin: storyOriginDay.value === null ? undefined : { day: storyOriginDay.value, label: storyOriginLabel.value.trim() } },
        includeInspirationHistory.value ? inspirationHistory.value : [], setupMethod.value, now, creationId)
      await reconstructionWorkspaceStore.persistInitialCreation(prepared.novel, prepared.workspace)
      // Commit identity before publishing or navigating: a retry must reuse this saved novel.
      committedCreation = prepared
      createdNovelId.value = prepared.novel.id
      message.success('小说已创建，请检查并确认作品契约')
    }
    if (committedCreation) {
      novelStore.publishCreatedNovel(committedCreation.novel)
      reconstructionWorkspaceStore.publishCreatedWorkspace(committedCreation.novel.id, committedCreation.workspace)
    }
    const failure = await router.push('/generate/' + createdNovelId.value)
    if (failure) throw new Error('页面未能打开，请点击“打开已创建的作品”重试。')
  } catch (error) {
    const detail = error instanceof Error ? error.message : '操作失败'
    message.error(createdNovelId.value ? '作品已经保存，打开失败：' + detail : '创建失败：' + detail)
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>

.creation-entry-panel h2,.creation-entry-panel h3,.creation-entry-panel p { margin:0; }
.creation-entry-panel p { line-height:1.8; } .creation-entry-panel label,.entry-origin { display:grid; gap:10px; }
@media(max-width:680px) { .creation-entry-body { padding:0 16px 20px; } .creation-entry-panel { padding:16px; } }
.reference-import-panel {
  margin-bottom: var(--space-lg);
}

.knowledge-mount-section { margin-top: var(--space-lg); }
.knowledge-mount-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.knowledge-mount-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin-top: 12px; }
.knowledge-mount-item { display: inline-flex; flex-direction: column; gap: 2px; }
.knowledge-mount-item small { color: var(--ink-3); font-size: 12px; line-height: 1.5; }
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
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--panel);
}

.preview-section h4 {
  font-family: var(--f-serif);
  margin-bottom: 10px;
  font-size: 15px;
  color: var(--ink);
}

.preview-grid {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px 12px;
}

.preview-label {
  color: var(--ink-3);
  font-size: 13px;
}

.preview-value,
.preview-paragraph {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
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
  color: var(--ink-3);
  font-size: 13px;
}

.back-btn:hover {
  color: var(--ink);
  background: var(--hover);
}

/* 步骤指示器 */

.step-active .step-dot {
  background: var(--zhu);
  border-color: var(--zhu);
  color: var(--paper);
  box-shadow: 0 0 0 4px var(--zhu-soft);
}

.step-completed .step-dot {
  background: var(--dai);
  border-color: var(--dai);
  color: var(--paper);
}

.step-label {
  font-size: 14px;
  color: var(--ink-3);
  font-weight: 500;
  transition: color var(--motion-normal);
}

.step-active .step-label {
  color: var(--ink);
  font-weight: 600;
}

.step-completed .step-label {
  color: var(--dai);
}

/* 表单区域 */

.section-title {
  font-family: var(--f-serif);
  font-size: 20px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 16px;
}

.section-hint {
  font-size: 13px;
  color: var(--ink-3);
  margin-top: -8px;
  margin-bottom: var(--space-md);
}

.subsection-title {
  font-size: 14px;
  color: var(--ink-2);
  margin: var(--space-md) 0 var(--space-sm);
  font-weight: 500;
}

/* 类型选择网格 */
.genre-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.genre-btn:hover {
  border-color: var(--zhu);
  color: var(--zhu);
  background: var(--zhu-soft);
}

.genre-btn--active {
  background: var(--zhu-soft) !important;
  color: var(--zhu) !important;
  border-color: var(--zhu) !important;
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
  color: var(--ink-3);
}

.word-unit {
  font-size: 14px;
  color: var(--ink-2);
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
  color: var(--ink-2);
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
  border: 1px solid var(--line-2);
  border-radius: 100px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.dim-btn:hover {
  border-color: var(--zhu);
  color: var(--zhu);
}

.dim-btn--active {
  background: var(--zhu-soft) !important;
  color: var(--zhu) !important;
  border-color: var(--zhu) !important;
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
  color: var(--ink-2);
  font-weight: 500;
}

/* 底部操作栏 */

.footer-spacer {
  flex: 1;
}

/* ========= 向导布局 ========= */
.creation-combination { padding: 5px 12px; border: 1px solid var(--line-2); border-radius: 20px; color: var(--zhu); background: var(--hover); font-size: 13px; line-height: 1.6; }
.creation-writing-mode { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-bottom: 20px; }
.wizard-layout > :deep(.inspiration-chat) { padding: 0 24px; box-sizing: border-box; }
@media (max-width: 1440px) {
  .wizard-top, .wizard-footer { padding-left: 24px; padding-right: 24px; }
  .wizard-body { padding: 0 24px 80px; }
  .form-sections { max-width: 960px; }
}
@media (max-width: 768px) {
  .wizard-top { padding: 20px 20px 0; }
  .wizard-body { padding: 0 20px 24px; }
  .wizard-footer { padding: 16px 0; margin-top: 24px; }
  .steps-indicator { padding: 16px 20px; gap: 24px; }
  .form-section { padding: 20px 24px; }
  .reference-import-header { flex-direction: column; align-items: stretch; }
  .reference-import-actions { flex-wrap: wrap; }
  .form-grid { grid-template-columns: minmax(0, 1fr); }
  .style-dimension { flex-direction: column; gap: 4px; }
  .word-count-row { flex-wrap: wrap; }
}
@media (max-width: 390px) {
  .wizard-top { padding: 16px 16px 0; }
  .wizard-body { padding: 0 16px 20px; }
  .wizard-footer { padding: 12px 0; flex-wrap: wrap; }
  .steps-indicator { padding: 12px 16px; gap: 16px; }
  .form-section { padding: 16px 20px; }
  .wizard-footer :deep(.n-button) { flex: 1 1 100%; }
}
.step-line {
  transition: width 0.4s ease;
  border-radius: 100px;
  background: var(--zhu);
  height: 3px;
  left: 0;
  bottom: 0;
  position: absolute; display: none; }
.wizard-page {
  animation: fadeIn 0.3s ease; grid-column: 1; min-width: 0; max-width: none; width: 100%; margin: 0; }
.form-sections {
  margin: 0 auto;
  padding-bottom: 100px;
  flex-direction: column;
  display: flex; max-width: none; gap: 20px; }
.wizard-overview { grid-column: 2; grid-row: 1; display: grid; gap: 20px; min-width: 0; position: sticky; top: 0; }
.wizard-current-settings { padding: 28px; }
.wizard-current-settings h2 { font-size: 25px; margin-bottom: 8px; }
.wizard-current-settings > p { font-size: 13px; color: var(--ink-2); margin-bottom: 20px; }
.wizard-current-settings dl { border: 1px solid var(--line); border-radius: var(--r-m); padding: 8px 18px; }
.wizard-current-settings dl div { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 12px; padding: 18px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
.wizard-current-settings dl div:last-child { border-bottom: 0; }
.wizard-current-settings dt { color: var(--ink-2); }
.wizard-current-settings dd { margin: 0; overflow-wrap: anywhere; }
.wizard-current-settings small { display: block; color: var(--ink-3); margin-top: 4px; }
.reference-import-panel, .knowledge-mount-section { margin: 0; padding: 24px; }
.reference-import-header {
  justify-content: space-between; display: flex; flex-direction: column; align-items: stretch; gap: 18px; }
.reference-import-actions { flex-direction: column-reverse; }
.genre-btn {
  transition: all var(--motion-fast);
  cursor: pointer;
  font-size: 14px;
  color: var(--ink-2);
  background: var(--desk);
  border: 1px solid var(--line-2);
  padding: 8px 18px; border-radius: var(--r-m); min-height: 40px; }
@media (max-width: 1000px) { .wizard-body { grid-template-columns: minmax(0, 1fr); } .wizard-overview { grid-column: 1; grid-row: auto; position: static; } .steps-indicator { justify-content: flex-start; } }
@media (max-width: 650px) { .wizard-top { padding: 20px 16px 0; } .wizard-body { padding: 0 16px; } .wizard-header .page-title { font-size: 28px; } .steps-indicator { gap: 16px; padding: 0 0 20px; flex-wrap: wrap; } .step-item { gap: 8px; } .form-section, .wizard-current-settings { padding: 20px; } }
.wizard-layout {
  flex-direction: column;
  display: flex; height: auto; min-height: 0; overflow: visible; background: transparent; }
.wizard-top { margin: 0 auto; width: 100%;
  flex-shrink: 0;
  box-sizing: border-box; max-width: none; padding: 0; }.choosing-options .wizard-top { display: none; }
.wizard-header { flex-wrap: wrap;
  align-items: center;
  display: flex; gap: 12px; margin-bottom: 18px; }.wizard-header .page-title { font-size: 36px; display: none; }.back-btn {
  transition: all var(--motion-fast);
  cursor: pointer;
  font-size: 14px;
  background: transparent;
  border-radius: var(--r-s);
  border: none;
  padding: 6px 12px;
  gap: 6px;
  align-items: center;
  display: flex; color: var(--ink-3); }
.steps-indicator { margin-bottom: 0; border: 0; background: none;
  display: flex;
  align-items: center;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  transition: background-color 0.25s ease; justify-content: flex-start; gap: 24px; padding: 0 0 16px; }.step-item { flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 1; color: var(--ink-3); }
.step-dot {
  transition: all 0.25s ease;
  color: var(--ink-3);
  font-family: var(--f-serif);
  font-weight: 600;
  font-size: 14px;
  border: 2px solid var(--line-2);
  border-radius: 50%;
  justify-content: center;
  align-items: center;
  display: flex;
  height: 32px;
  width: 32px; background: var(--paper); border-color: var(--line-2); }.step-active .step-dot, .step-completed .step-dot { border-color: var(--zhu); background: var(--zhu); color: white; }
.origin-seed { order: 2; padding: 18px 20px; margin-top: 22px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.origin-seed label { display: block; font-size: 12px; color: var(--ink-3); margin-bottom: 8px; }
.origin-seed textarea { width: 100%; resize: vertical; min-height: 68px; border: 0; outline: 0; background: transparent; color: var(--ink); font: 18px/1.8 var(--f-serif); }
.origin-seed p { margin: 10px 0 0; font-size: 11px; color: var(--ink-3); line-height: 1.6; }
.wizard-body { margin: 0 auto; width: 100%; align-items: start; display: grid;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden; max-width: none; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 16px; padding: 0 0 28px; overflow: visible; }
.form-section, .wizard-current-settings, .reference-import-panel, .knowledge-mount-section { border-color: var(--line); border-radius: 8px; background: var(--paper); box-shadow: var(--shadow-1); }
.form-section { padding: 20px; }.creation-entry-body { min-height:0; flex:1; padding: 0 0 28px; overflow: visible; }
.creation-entry-panel { box-sizing:border-box; padding:24px; margin:0 auto; gap:20px; display:grid; max-width: none; border-color: var(--line); border-radius: var(--r-m); background: var(--paper); box-shadow: var(--shadow-1); }
.wizard-footer { z-index: 3; bottom: 0; margin: 0; max-width: none; width: 100%; grid-column: 1 / -1;
  position: sticky;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 0;
  border-top: 1px solid var(--line-2);
  backdrop-filter: blur(12px);
  transition: background-color 0.25s ease; border-color: var(--line); background: var(--panel); }
@media (max-width: 1100px) {.wizard-body { grid-template-columns: minmax(0, 1fr); } }

</style>
