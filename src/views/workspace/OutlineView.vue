<template>
  <div class="outline-view page-container fade-in" id="outline-view">
    <div class="outline-header">
      <h2 class="page-title">总大纲</h2>
      <div class="header-actions" v-if="novel?.outline">
        <n-button size="small" @click="startEdit" v-if="!editing">
          编辑
        </n-button>
        <n-button size="small" @click="editing = false" v-if="editing">
          预览
        </n-button>
        <n-button size="small" type="primary" @click="regenerate" :loading="regenerating">
          重新生成
        </n-button>
      </div>
    </div>

    <!-- 无大纲 -->
    <div v-if="!novel?.outline" class="empty-outline paper-panel">
      <div class="empty-icon"><svg class="ink-mountains" viewBox="0 0 220 80" aria-hidden="true"><path fill="currentColor" d="M0 80 L40 38 L62 56 L98 14 L130 50 L150 34 L188 66 L220 46 L220 80 Z" /></svg></div>
      <h3>还没有大纲</h3>
      <p>前往大纲生成页面，让 AI 为你构思整本小说的大纲</p>
      <n-button type="primary" @click="$router.push(`/generate/${novelId}`)">
        生成大纲
      </n-button>
    </div>

    <!-- 编辑模式 -->
    <div v-else-if="editing" class="outline-editor paper-panel">
      <n-input
        v-model:value="editContent"
        type="textarea"
        :rows="30"
        placeholder="在此编辑大纲内容（Markdown 格式）"
      />
      <div class="editor-actions">
        <n-button @click="editing = false">取消</n-button>
        <n-button type="primary" @click="saveEdit">保存</n-button>
      </div>
    </div>

    <!-- 预览模式 + AI 修改 -->
    <div v-else class="outline-reading-container">
      <div class="outline-preview paper-panel">
        <div class="rendered-content" v-html="renderedContent"></div>
      </div>

      <!-- AI 局部修改面板 -->
      <aside v-if="novel?.outline" class="ai-modify-panel paper-panel">
        <div class="modify-header">
          <h3>AI 助手</h3><span class="outline-assistant-tab">局部修改</span>
        </div>
        <n-input
          v-model:value="modifyInstruction"
          type="textarea"
          :rows="2"
          size="small"
          placeholder="描述你想修改的内容，例如：&#10;• 把主角身份改为修仙门派弃徒&#10;• 增加一条暗线：宝物争夺&#10;• 减少恋爱戏份，增加打斗描写"
        />
        <n-button
          size="small"
          type="primary"
          @click="aiModifyOutline"
          :loading="modifying"
          :disabled="!modifyInstruction.trim()"
          style="margin-top:6px;align-self:flex-end;"
        >
          {{ modifying ? 'AI 修改中...' : '生成修改建议' }}
        </n-button>
        <div v-if="modifyPreview" class="modify-preview">
          <div class="modify-label">修改预览：</div>
          <div class="modify-content" v-html="renderMd(modifyPreview)"></div>
          <div class="modify-actions">
            <n-button size="tiny" @click="modifyPreview = ''">放弃</n-button>
            <n-button size="tiny" type="primary" @click="acceptModify">采纳修改</n-button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, useMessage } from 'naive-ui'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { renderMd } from '@/utils/markdown'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const message = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))

const editing = ref(false)
const editContent = ref('')
const regenerating = ref(false)
const modifyInstruction = ref('')
const modifying = ref(false)
const modifyPreview = ref('')

const renderedContent = computed(() => {
  if (!novel.value?.outline) return ''
  return renderMd(novel.value.outline)
})

function startEdit() {
  editContent.value = novel.value?.outline || ''
  editing.value = true
}

function saveEdit() {
  novelStore.updateOutline(novelId.value, editContent.value)
  editing.value = false
  message.success('大纲已保存')
}

async function regenerate() {
  router.push({ path: `/generate/${novelId.value}`, query: { regenerate: '1' } })
}

// AI 局部修改大纲
async function aiModifyOutline() {
  if (!novel.value || !modifyInstruction.value.trim()) return
  const model = configStore.getModelForTask('outline')
  if (!model) { message.error('未配置 AI 模型'); return }

  modifying.value = true
  modifyPreview.value = ''

  try {
    const messages = [{
      role: 'system' as const,
      content: '你是一个小说大纲编辑助手。用户会给你一份大纲和修改要求，请根据要求对大纲进行局部修改，保持其他部分不变。直接输出修改后的完整大纲，使用 Markdown 格式。',
    }, {
      role: 'user' as const,
      content: `【当前大纲】\n${novel.value.outline}\n\n【修改要求】\n${modifyInstruction.value.trim()}\n\n请根据修改要求对大纲进行局部修改，保持整体结构不变，直接输出修改后的完整大纲。`,
    }]

    let result = ''
    await callAI({
      model,
      skillTask: 'planning',
      messages,
      stream: true,
      onChunk: (chunk) => { result += chunk; modifyPreview.value = result },
    })
  } catch (err: any) {
    message.error(err.message || '修改失败')
  } finally {
    modifying.value = false
  }
}

function acceptModify() {
  if (modifyPreview.value) {
    novelStore.updateOutline(novelId.value, modifyPreview.value)
    modifyPreview.value = ''
    modifyInstruction.value = ''
    message.success('大纲已更新')
  }
}
</script>

<style scoped>
.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-lg);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.empty-outline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 12px;
  text-align: center;
}

.empty-icon { font-size: 48px; }
.empty-outline h3 { font-size: 18px; color: var(--text-color-primary); }
.empty-outline p { font-size: 14px; color: var(--text-color-tertiary); margin-bottom: 8px; }

/* 预览 */
.outline-reading-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.outline-preview {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  line-height: 1.85;
  font-size: 16px;
  font-family: var(--font-family-serif);
  color: var(--text-color-primary);
}

.rendered-content :deep(h2) { font-family: var(--font-family-serif); font-size: 22px; font-weight: 700; margin: 28px 0 14px; padding-bottom: 10px; border-bottom: 2px solid var(--border-color); color: var(--color-primary); letter-spacing: 0.02em; }
.rendered-content :deep(h3) { font-family: var(--font-family-serif); font-size: 19px; font-weight: 700; margin: 20px 0 10px; color: var(--text-color-primary); }
.rendered-content :deep(h4) { font-family: var(--font-family-serif); font-size: 17px; font-weight: 600; margin: 16px 0 8px; color: var(--text-color-primary); }
.rendered-content :deep(strong) { color: var(--color-primary); }
.rendered-content :deep(li) { margin-left: 20px; margin-bottom: 4px; }

/* 编辑 */
.outline-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* AI 局部修改面板 */
.ai-modify-panel {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-color-secondary);
}

.modify-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-primary);
}

.modify-preview {
  margin-top: 8px;
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--border-color-light);
  padding-top: 8px;
}

.modify-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color-secondary);
  margin-bottom: 4px;
}

.modify-content {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-color-secondary);
  max-height: 200px;
  overflow-y: auto;
}

.modify-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 8px;
}

.outline-reading-container { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
.outline-preview { width: 100%; max-width: 820px; margin: 0; font-size: 17px; padding: 28px; }
.ai-modify-panel { position: sticky; top: 0; width: 100%; max-width: none; margin: 0; padding: 20px; }
.modify-header { display: flex; flex-direction: column; align-items: stretch; gap: 16px; }
.modify-header h3 { font-size: 22px; }
.outline-assistant-tab { padding-bottom: 12px; border-bottom: 2px solid var(--color-primary); color: var(--color-primary); text-align: center; }
.ai-modify-panel > :deep(.n-button) { align-self: stretch !important; margin-top: 12px !important; }
@media (max-width: 1100px) { .outline-reading-container { grid-template-columns: minmax(0, 1fr) 280px; } }
@media (max-width: 900px) { .outline-reading-container { grid-template-columns: 1fr; } .ai-modify-panel { position: static; } }
</style>
