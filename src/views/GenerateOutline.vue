<template>
  <div class="generate-page fade-in" id="generate-outline-page">
    <!-- 生成动画头部 -->
    <div class="generate-header">
      <div class="generate-animation" :class="{ 'animation-done': isDone }">
        <div class="pulse-ring"></div>
        <div class="pulse-ring delay-1"></div>
        <div class="ai-icon">{{ isDone ? '✅' : '🤖' }}</div>
      </div>
      <h2>{{ isDone ? '大纲生成完成！' : 'AI 正在构思大纲...' }}</h2>
      <p v-if="!isDone && !hasError" class="generate-hint">
        正在根据你的设定生成总大纲，这可能需要 30 秒 ~ 2 分钟
      </p>
      <p v-if="hasError" class="generate-error">{{ errorMessage }}</p>
    </div>

    <!-- 流式输出内容 -->
    <div class="output-container paper-panel" v-if="streamContent || isDone">
      <div v-if="isDone" class="outline-edit-toolbar" role="toolbar" aria-label="大纲编辑操作">
        <span v-if="acceptingOutline" class="outline-edit-status" role="status">正在规划分卷，完成后可在工作区编辑大纲</span>
        <n-button v-if="!editingOutline" type="primary" :disabled="acceptingOutline" @click="startOutlineEdit">
          <template #icon><n-icon><create-outline /></n-icon></template>编辑大纲
        </n-button>
        <template v-else>
          <n-button @click="editingOutline = false">取消修改</n-button>
          <n-button type="primary" :disabled="!outlineDraft.trim()" @click="saveOutlineEdit">
            <template #icon><n-icon><save-outline /></n-icon></template>保存修改
          </n-button>
        </template>
      </div>
      <div class="outline-output-scroll" tabindex="0" aria-label="大纲正文">
        <n-input v-if="editingOutline" v-model:value="outlineDraft" type="textarea" :rows="24" aria-label="编辑生成的大纲" />
        <div v-else class="output-content" v-html="renderedContent"></div>
        <div v-if="!isDone && !hasError" class="typing-cursor">▌</div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="generate-actions" v-if="isDone">
      <div class="title-picker paper-panel">
        <div class="title-picker-header">
          <strong>选择书名</strong>
          <span>可直接修改后确认</span>
        </div>
        <div class="title-options" v-if="titleCandidates.length">
          <button
            v-for="title in titleCandidates"
            :key="title"
            class="title-option"
            :class="{ active: selectedTitle === title }"
            @click="selectedTitle = title"
          >
            《{{ title }}》
          </button>
        </div>
        <n-input v-model:value="selectedTitle" placeholder="输入最终书名" />
      </div>
      <n-button @click="regenerate" size="large" :disabled="acceptingOutline || editingOutline">🔄 重新生成</n-button>
      <n-button type="primary" size="large" :loading="acceptingOutline" :disabled="acceptingOutline || editingOutline || !visibleOutlineContent" @click="acceptOutline">✨ 确认并规划分卷</n-button>
    </div>

    <div class="generate-actions" v-if="hasError">
      <n-button @click="$router.push('/')" size="large">返回书架</n-button>
      <n-button @click="$router.push('/settings')" size="large">检查设置</n-button>
      <n-button type="primary" @click="startGenerate" size="large">重试</n-button>
    </div>

    <!-- 未配置提示 -->
    <div class="no-config-hint" v-if="!configStore.isConfigured && !streamContent && !hasError">
      <n-alert type="warning" title="未配置 AI 模型">
        请先在设置页面配置接口密钥才能使用 AI 功能。<br><br>
        <n-button size="small" @click="$router.push('/settings')">前往设置</n-button>
      </n-alert>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NAlert, NInput, NIcon, useMessage } from 'naive-ui'
import { CreateOutline, SaveOutline } from '@vicons/ionicons5'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { buildOutlinePrompt } from '@/services/prompts'
import { generateStoryArcDrafts } from '@/services/storyPlanning'
import { renderMd } from '@/utils/markdown'
import { parseVolumesFromText } from '@/services/volumeParsing'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const message = useMessage()

const novelId = route.params.novelId as string
const novel = computed(() => novelStore.getNovel(novelId))

const streamContent = ref('')
const isDone = ref(false)
const hasError = ref(false)
const errorMessage = ref('')
const selectedTitle = ref('')
const acceptingOutline = ref(false)
const editingOutline = ref(false)
const outlineDraft = ref('')
let abortController: AbortController | null = null

// Markdown 渲染
const visibleOutlineContent = computed(() => sanitizeOutlineContent(streamContent.value))
const renderedContent = computed(() => renderMd(visibleOutlineContent.value))
const titleCandidates = computed(() => extractTitleCandidates(visibleOutlineContent.value))

function sanitizeOutlineContent(text: string): string {
  return text
    .replace(/<thinking[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis[\s\S]*?<\/analysis>/gi, '')
    .replace(/<reasoning[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<thinking[\s\S]*$/i, '')
    .replace(/<think[\s\S]*$/i, '')
    .replace(/<analysis[\s\S]*$/i, '')
    .replace(/<reasoning[\s\S]*$/i, '')
    .replace(/^\s*(?:thinking|analysis|reasoning)\s*[:：][\s\S]*?(?=\n#{1,3}\s|\n(?:一句话概括|推荐书名|小说简介|主线剧情走向|主要角色表|核心冲突|分卷建议|预估总字数|全书伏笔)|$)/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isOutlineComplete(text: string): boolean {
  const clean = sanitizeOutlineContent(text)
  const requiredPatterns = [
    /推荐书名/,
    /小说简介/,
    /主线剧情走向/,
    /主要角色表/,
    /核心冲突/,
    /分卷建议/,
    /预估总字数分配|总字数分配/,
    /全书伏笔|伏笔线|伏笔设计/,
  ]
  return requiredPatterns.every(pattern => pattern.test(clean))
}

function buildOutlineContinueMessages(currentText: string) {
  const clean = sanitizeOutlineContent(currentText)
  return [
    {
      role: 'system' as const,
      content: '你是一位资深网文策划师。请只续写小说总大纲缺失部分，不要重复已有内容，不要输出思考过程或 thinking 标签。',
    },
    {
      role: 'user' as const,
      content: `下面的大纲尚未完整生成。请从中断处自然续写，补齐缺失小节。

【必须补齐的小节】
- 主要角色表
- 核心冲突与爽点设计
- 分卷建议
- 预估总字数分配
- 全书伏笔线

【续写规则】
1. 不要重复已经写过的内容。
2. 不要输出 <thinking>、analysis、reasoning、思考过程。
3. 直接输出剩余 Markdown 大纲内容。
4. 如果上一句明显中断，请先补完上一句，再继续后续小节。

【当前已生成大纲末尾】
${clean.slice(-5000)}`,
    },
  ]
}

function extractTitleCandidates(text: string): string[] {
  const candidates: string[] = []
  const titleSection = text.match(/##\s*推荐书名([\s\S]+?)(?=##\s|$)/)
  const source = titleSection?.[1] || text
  const regex = /《([^《》\n]{2,24})》/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(source))) {
    const title = match[1].trim()
    if (title && !candidates.includes(title)) candidates.push(title)
  }
  return candidates.slice(0, 8)
}

async function startGenerate() {
  if (acceptingOutline.value) return
  if (!novel.value) {
    message.error('找不到小说数据')
    return
  }

  const model = configStore.getModelForTask('outline')
  if (!model) {
    hasError.value = true
    errorMessage.value = '未配置 AI 模型，请先在设置页面添加模型配置。'
    return
  }

  abortController?.abort()
  editingOutline.value = false
  streamContent.value = ''
  isDone.value = false
  hasError.value = false
  errorMessage.value = ''
  abortController = new AbortController()

  try {
    const messages = buildOutlinePrompt(novel.value)
    await callAI({
      model,
      skillTask: 'planning',
      messages,
      stream: true,
      signal: abortController.signal,
      onChunk: (chunk) => {
        streamContent.value += chunk
      },
    })
    streamContent.value = sanitizeOutlineContent(streamContent.value)

    let continueCount = 0
    while (!isOutlineComplete(streamContent.value) && continueCount < 3 && !abortController.signal.aborted) {
      continueCount += 1
      message.info(`大纲未完整，正在自动补全第 ${continueCount} 次...`)
      await callAI({
        model,
        skillTask: 'planning',
        messages: buildOutlineContinueMessages(streamContent.value),
        stream: true,
        signal: abortController.signal,
        onChunk: (chunk) => {
          streamContent.value += chunk
        },
      })
      streamContent.value = sanitizeOutlineContent(streamContent.value)
    }
    if (!isOutlineComplete(streamContent.value)) {
      message.warning('大纲仍可能缺少部分小节，建议点击“重新生成”或手动补充后再确认')
    }

    isDone.value = true
    // 保存大纲到小说数据
    novelStore.updateOutline(novelId, sanitizeOutlineContent(streamContent.value))

    selectedTitle.value = titleCandidates.value[0] || novel.value.title
  } catch (err: any) {
    if (err.name === 'AbortError') return
    hasError.value = true
    errorMessage.value = err.message || '生成失败，请检查 API 配置'
  }
}

function regenerate() {
  startGenerate()
}

function startOutlineEdit() {
  if (acceptingOutline.value) return
  outlineDraft.value = visibleOutlineContent.value
  editingOutline.value = true
}

function saveOutlineEdit() {
  const text = sanitizeOutlineContent(outlineDraft.value)
  if (!text) return
  streamContent.value = text
  novelStore.updateOutline(novelId, text)
  editingOutline.value = false
  message.success('大纲已保存，分卷将使用修改后的内容')
}

function parseAndSaveOutline(outlineText: string, novelId: string) {
  const volumes = parseVolumesFromText(outlineText)
  if (volumes.length > 0) {
    novelStore.setVolumes(novelId, volumes)
  }

  // ── 2. 解析全书规划 ──────────────────────────────────────────────
  const globalPlanSection = outlineText.match(/#{2,4}\s*(?:全书)?伏笔(?:线|线索|设计|追踪|规划)?([\s\S]+?)(?=#{2,4}\s|$)/)
  if (globalPlanSection) {
    const lines = globalPlanSection[1].split('\n').filter(line => line.trim().startsWith('-'))
    for (const line of lines) {
      const cleaned = line
        .trim()
        .replace(/^-\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/^伏笔\s*\d*[：:：]?\s*/, '')
        .trim()
      if (!cleaned) continue
      const [rawName = '', ...rest] = cleaned.split(/\s*[—–-]\s*/)
      const namePart = rawName.replace(/[《》「」“”]/g, '').trim()
      novelStore.addEvent(novelId, {
        chapterIndex: -1,
        title: namePart || '未命名全书规划',
        description: rest.join(' - ').trim() || cleaned,
        characters: [],
        type: '伏笔',
        scope: 'global',
        status: 'planted',
        hintCount: 0,
        importance: 4,
        source: 'ai',
      })
    }
  }

  // ── 3. 解析主要角色表 ────────────────────────────────────────────
  // 匹配 ## 主要角色表 下面的 Markdown 表格行
  const charSection = outlineText.match(/##\s*主要角色表([\s\S]+?)(?=##|$)/)
  if (charSection) {
    const tableLines = charSection[1].split('\n').filter(l => l.trim().startsWith('|'))
    for (const line of tableLines) {
      // 跳过表头和分隔行
      if (line.includes('---') || line.includes('姓名') || line.includes(':-:')) continue
      const cols = line.split('|').map(c => c.trim()).filter(Boolean)
      if (cols.length < 2) continue
      const cleanCell = (value: string) => value.replace(/\*\*/g, '').replace(/\*/g, '').trim()
      const name = cleanCell(cols[0])
      const role = cleanCell(cols[1] || '')
      const personality = cleanCell(cols[2] || '')
      const background = cleanCell(cols[3] || '')
      if (!name || name === '---') continue
      novelStore.addCharacter(novelId, {
        name,
        identity: role || '主要角色',
        personality,
        description: background,
        relationships: [],
        aliases: [],
        powerLevel: '',
        faction: '',
        status: '活跃' as const,
        firstAppearChapter: 0,
        events: [],
        avatarColor: '',
      })
    }
  }
}

async function acceptOutline() {
  if (acceptingOutline.value || editingOutline.value || !visibleOutlineContent.value) return
  acceptingOutline.value = true
  try {
    if (selectedTitle.value.trim()) {
      novelStore.updateTitle(novelId, selectedTitle.value.trim().replace(/[《》]/g, ''))
    }
    novelStore.updateOutline(novelId, visibleOutlineContent.value)
    parseAndSaveOutline(visibleOutlineContent.value, novelId)

    const confirmedNovel = novelStore.getNovel(novelId)
    const model = configStore.getModelForTask('outline')
    if (confirmedNovel?.outline && model && !(confirmedNovel.storyArcs || []).length) {
      message.info('大纲已确认，正在自动提取故事弧线...')
      try {
        const drafts = await generateStoryArcDrafts(confirmedNovel, model)
        const existingTitles = new Set((confirmedNovel.storyArcs || []).map(arc => arc.title.trim().toLowerCase()))
        let createdCount = 0
        for (const draft of drafts) {
          if (existingTitles.has(draft.title.toLowerCase())) continue
          const characterIds = confirmedNovel.characters
            .filter(character => draft.characterNames.some(name => name === character.name || character.aliases.includes(name)))
            .map(character => character.id)
          const arc = novelStore.addStoryArc(novelId, {
            title: draft.title,
            description: draft.description,
            type: draft.type,
            importance: draft.importance,
            status: 'active',
            characterIds,
          })
          if (!arc) continue
          for (const node of draft.nodes) {
            novelStore.addStoryArcNode(novelId, arc.id, {
              title: node.title,
              description: node.description,
              targetChapter: node.targetChapter - 1,
            })
          }
          existingTitles.add(draft.title.toLowerCase())
          createdCount += 1
        }
        if (createdCount) message.success(`已自动提取 ${createdCount} 条故事弧线`)
      } catch {
        message.warning('故事弧线自动提取失败，可在剧情规划页手动重试')
      }
    }

    novelStore.setStatus(novelId, 'writing')
    await router.push({
      path: `/workspace/${novelId}/planning`,
      query: { tab: 'volumes', onboarding: '1' },
    })
  } finally {
    acceptingOutline.value = false
  }
}

onMounted(() => {
  if (novel.value?.outline && route.query.regenerate !== '1') {
    streamContent.value = novel.value.outline
    selectedTitle.value = novel.value.title
    isDone.value = true
  } else if (configStore.isConfigured) {
    startGenerate()
  }
})

onUnmounted(() => {
  abortController?.abort()
})
</script>

<style scoped>
.generate-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-xl);
  height: calc(100vh - 52px);
  min-height: 0;
  overflow-y: auto;
  gap: var(--space-lg);
}

.generate-header {
  text-align: center;
  margin-bottom: 0;
  flex-shrink: 0;
}

.generate-header h2 {
  font-size: 22px;
  color: var(--text-color-primary);
  margin-bottom: 8px;
}

.generate-hint {
  font-size: 14px;
  color: var(--text-color-tertiary);
}

.generate-error {
  font-size: 14px;
  color: var(--color-error);
}

/* 脉冲动画 */
.generate-animation {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto var(--space-lg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--color-primary);
  opacity: 0;
  animation: pulse 2s ease-out infinite;
}

.delay-1 { animation-delay: 1s; }

@keyframes pulse {
  0% { transform: scale(0.5); opacity: 0.6; }
  100% { transform: scale(1.5); opacity: 0; }
}

.animation-done .pulse-ring {
  animation: none;
  opacity: 0;
}

.ai-icon {
  font-size: 40px;
  z-index: 1;
  animation: bob 2s ease-in-out infinite;
}

.animation-done .ai-icon {
  animation: none;
}

@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* 输出区域 */
.output-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  flex: 1 1 auto;
  min-height: 180px;
  max-height: none;
  overflow: hidden;
  padding: 0;
  margin-bottom: 0;
  position: relative;
}

.outline-output-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-lg);
}

.output-content {
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--text-color-primary);
}

.output-content :deep(h2) {
  font-size: 20px;
  margin: 20px 0 10px;
  color: var(--color-primary);
}

.output-content :deep(h3) {
  font-size: 17px;
  margin: 16px 0 8px;
  color: var(--text-color-primary);
}

.output-content :deep(h4) {
  font-size: 15px;
  margin: 12px 0 6px;
}

.output-content :deep(strong) {
  color: var(--color-primary);
}

.output-content :deep(li) {
  margin-left: 20px;
  margin-bottom: 4px;
}

.typing-cursor {
  display: inline;
  color: var(--color-primary);
  animation: blink 0.8s infinite;
  font-size: 18px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* 操作按钮 */
.generate-actions {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: stretch;
  gap: var(--space-md);
  width: 100%;
  max-width: 840px;
  padding: 12px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-lg);
  background: var(--bg-color-card);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(12px);
  flex-shrink: 0;
}
.outline-edit-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px var(--space-lg);
  border-bottom: 1px solid var(--border-color-light);
  background: var(--bg-color-card);
}
.outline-edit-status { flex: 1; min-width: 160px; font-size: 12px; color: var(--text-color-secondary); }

.title-picker {
  width: 100%;
  max-width: none;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.title-picker-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.title-picker-header span {
  font-size: 12px;
  color: var(--text-color-tertiary);
}

.title-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 92px;
  overflow-y: auto;
  padding-right: 2px;
}

.title-option {
  padding: 6px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-sm);
  background: var(--bg-color);
  color: var(--text-color-secondary);
  cursor: pointer;
}

.title-option:hover,
.title-option.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.no-config-hint {
  width: 100%;
  max-width: 500px;
  margin-top: var(--space-xl);
}

@media (max-height: 720px) {
  .generate-page {
    padding: var(--space-md);
    gap: var(--space-md);
  }

  .generate-animation {
    width: 56px;
    height: 56px;
    margin-bottom: 10px;
  }

  .ai-icon {
    font-size: 30px;
  }

  .generate-header h2 {
    font-size: 18px;
    margin-bottom: 4px;
  }

  .generate-hint,
  .generate-error {
    font-size: 13px;
  }

  .output-container {
    min-height: 140px;
  }

  .generate-actions {
    gap: 8px;
    padding: 8px;
  }

  .title-picker {
    padding: 10px;
    gap: 8px;
  }

  .title-options {
    max-height: 72px;
  }

  .title-option {
    padding: 4px 10px;
  }
}

@media (max-width: 640px) {
  .generate-page {
    padding: var(--space-md);
  }

  .generate-actions {
    align-items: stretch;
  }

  .generate-actions :deep(.n-button) {
    flex: 1 1 160px;
  }

  .title-picker-header {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
