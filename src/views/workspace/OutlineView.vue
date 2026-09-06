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
          🔄 重新生成
        </n-button>
      </div>
    </div>

    <!-- 无大纲 -->
    <div v-if="!novel?.outline" class="empty-outline paper-panel">
      <div class="empty-icon">📋</div>
      <h3>还没有大纲</h3>
      <p>前往大纲生成页面，让 AI 为你构思整本小说的大纲</p>
      <n-button type="primary" @click="$router.push(`/generate/${novelId}`)">
        ✨ 生成大纲
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
    <div v-else>
      <div class="outline-preview paper-panel">
        <div class="rendered-content" v-html="renderedContent"></div>
      </div>

      <!-- AI 局部修改面板 -->
      <div v-if="novel?.outline" class="ai-modify-panel paper-panel">
        <div class="modify-header">
          <span>✨ AI 局部修改</span>
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
          {{ modifying ? 'AI 修改中...' : '应用修改' }}
        </n-button>
        <div v-if="modifyPreview" class="modify-preview">
          <div class="modify-label">修改预览：</div>
          <div class="modify-content" v-html="renderMd(modifyPreview)"></div>
          <div class="modify-actions">
            <n-button size="tiny" @click="modifyPreview = ''">放弃</n-button>
            <n-button size="tiny" type="primary" @click="acceptModify">采纳修改</n-button>
          </div>
        </div>
      </div>
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
.outline-preview {
  line-height: 1.8;
  font-size: 14.5px;
}

.rendered-content :deep(h2) { font-size: 20px; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border-color-light); color: var(--color-primary); }
.rendered-content :deep(h3) { font-size: 17px; margin: 18px 0 8px; }
.rendered-content :deep(h4) { font-size: 15px; margin: 14px 0 6px; }
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
  margin-top: var(--space-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
</style>
