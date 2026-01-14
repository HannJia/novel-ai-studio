<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore, useAiStore, useChapterStore, useBookStore } from '@/stores'
import CharacterPanel from './panels/CharacterPanel.vue'
import KnowledgePanel from './panels/KnowledgePanel.vue'
import AIThinkingProcess from './ai/AIThinkingProcess.vue'

const router = useRouter()
const uiStore = useUiStore()
const aiStore = useAiStore()
const chapterStore = useChapterStore()
const bookStore = useBookStore()

const emit = defineEmits<{
  continueWriting: []
  saveOutline: []
  generateOutline: []
}>()

const props = defineProps<{
  continueWordCount: number
  chapterOutline: string
  bookOutline: string
  outlineTab: 'book' | 'chapter'
}>()

// 本地状态
const activeTab = ref<'character' | 'knowledge' | 'ai' | 'config'>('character')
const commandInput = ref('')
const chatMessages = ref<Array<{role: 'user' | 'assistant', content: string}>>([
  { role: 'assistant', content: '有什么可以帮您的？' }
])

// AI 指令对话
function sendCommand(): void {
  if (!commandInput.value.trim()) return

  chatMessages.value.push({
    role: 'user',
    content: commandInput.value
  })

  // 模拟AI回复
  setTimeout(() => {
    chatMessages.value.push({
      role: 'assistant',
      content: '好的，我会根据您的要求调整生成内容的风格。'
    })
  }, 500)

  commandInput.value = ''
}
</script>

<template>
  <aside class="editor-right-panel" v-show="uiStore.rightPanelVisible">
    <!-- 标签切换 -->
    <div class="panel-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'character' }"
        @click="activeTab = 'character'"
      >
        <el-icon><User /></el-icon>
        <span>角色</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'knowledge' }"
        @click="activeTab = 'knowledge'"
      >
        <el-icon><FolderOpened /></el-icon>
        <span>知识</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'ai' }"
        @click="activeTab = 'ai'"
      >
        <el-icon><MagicStick /></el-icon>
        <span>生成</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'config' }"
        @click="activeTab = 'config'"
      >
        <el-icon><ChatLineRound /></el-icon>
        <span>对话</span>
      </button>
    </div>

    <!-- 面板内容 -->
    <div class="panel-content">
      <!-- 角色面板 -->
      <CharacterPanel v-if="activeTab === 'character'" />

      <!-- 知识库面板 -->
      <KnowledgePanel v-else-if="activeTab === 'knowledge'" />

      <!-- 生成配置面板 -->
      <div v-else-if="activeTab === 'ai'" class="generate-panel">
        <!-- 无AI配置提示 -->
        <div v-if="!aiStore.hasConfig" class="no-config-tip">
          <el-icon class="tip-icon"><WarningFilled /></el-icon>
          <p>尚未配置AI</p>
          <el-button type="primary" size="small" @click="router.push('/config')">
            前往配置
          </el-button>
        </div>

        <template v-else>
          <!-- 生成参数 -->
          <div class="config-section">
            <h4 class="section-title">
              <el-icon><Setting /></el-icon>
              生成配置
            </h4>
            <div class="config-form">
              <div class="form-item">
                <label>目标字数</label>
                <div class="range-input">
                  <el-slider
                    :model-value="continueWordCount"
                    @update:model-value="$emit('update:continueWordCount', $event)"
                    :min="100"
                    :max="3000"
                    :step="100"
                  />
                  <span class="range-value">{{ continueWordCount }} 字</span>
                </div>
              </div>

              <div class="form-item">
                <label>创意温度</label>
                <div class="range-input">
                  <el-slider
                    :model-value="0.7"
                    :min="0"
                    :max="1"
                    :step="0.1"
                  />
                  <span class="range-value">0.7</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 生成按钮 -->
          <div class="action-buttons">
            <el-button
              type="primary"
              class="generate-btn"
              @click="$emit('continueWriting')"
              :loading="aiStore.generating"
            >
              <el-icon><MagicStick /></el-icon>
              AI 续写
            </el-button>
          </div>

          <!-- 当前配置信息 -->
          <div class="config-info">
            <span class="info-label">当前模型:</span>
            <span class="info-value">{{ aiStore.defaultConfig?.model || '未配置' }}</span>
          </div>

          <!-- AI 思考过程（嵌入模式） -->
          <AIThinkingProcess :embedded="true" />
        </template>
      </div>

      <!-- AI 指令对话面板 -->
      <div v-else-if="activeTab === 'config'" class="chat-panel">
        <div class="chat-messages">
          <div
            v-for="(msg, index) in chatMessages"
            :key="index"
            class="chat-message"
            :class="msg.role"
          >
            <div class="message-avatar">
              <el-icon v-if="msg.role === 'assistant'"><MagicStick /></el-icon>
              <el-icon v-else><User /></el-icon>
            </div>
            <div class="message-content">{{ msg.content }}</div>
          </div>
        </div>

        <div class="chat-input">
          <el-input
            v-model="commandInput"
            placeholder="输入指令..."
            @keyup.enter="sendCommand"
          >
            <template #append>
              <el-button @click="sendCommand">
                <el-icon><Promotion /></el-icon>
              </el-button>
            </template>
          </el-input>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.editor-right-panel {
  width: $right-panel-width;
  background-color: var(--panel-bg, $bg-base);
  border-left: 1px solid var(--border-color, $border-light);
  display: flex;
  flex-direction: column;
  transition: all $transition-duration $transition-ease;
}

.panel-tabs {
  display: flex;
  padding: 8px;
  gap: 4px;
  border-bottom: 1px solid var(--border-color, $border-lighter);

  .tab-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 4px;
    border: none;
    border-radius: $border-radius-large;
    background: transparent;
    color: var(--text-secondary, $text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all $transition-duration-fast $transition-ease;

    .el-icon {
      font-size: 18px;
    }

    &:hover {
      background-color: var(--hover-bg, $light-bg-hover);
      color: var(--text-primary, $text-primary);
    }

    &.active {
      background-color: var(--active-bg, $light-bg-active);
      color: $primary-color;
    }
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

// 生成配置面板
.generate-panel {
  .no-config-tip {
    text-align: center;
    padding: 32px 16px;

    .tip-icon {
      font-size: 40px;
      color: $warning-color;
      margin-bottom: 12px;
    }

    p {
      color: var(--text-secondary, $text-secondary);
      margin-bottom: 16px;
    }
  }

  .config-section {
    margin-bottom: 20px;

    .section-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary, $text-primary);
      margin-bottom: 16px;

      .el-icon {
        font-size: 16px;
        color: var(--text-secondary, $text-secondary);
      }
    }
  }

  .config-form {
    display: flex;
    flex-direction: column;
    gap: 16px;

    .form-item {
      label {
        display: block;
        font-size: 13px;
        color: var(--text-secondary, $text-secondary);
        margin-bottom: 8px;
      }

      .range-input {
        display: flex;
        align-items: center;
        gap: 12px;

        .el-slider {
          flex: 1;
        }

        .range-value {
          font-size: 12px;
          color: var(--text-regular, $text-regular);
          min-width: 50px;
          text-align: right;
        }
      }
    }
  }

  .action-buttons {
    margin-top: 20px;

    .generate-btn {
      width: 100%;
      height: 40px;
      font-size: 14px;
    }
  }

  .config-info {
    margin-top: 16px;
    padding: 12px;
    background-color: var(--info-bg, $light-bg-panel);
    border-radius: $border-radius-large;
    font-size: 12px;

    .info-label {
      color: var(--text-secondary, $text-secondary);
    }

    .info-value {
      color: var(--text-primary, $text-primary);
      margin-left: 8px;
    }
  }
}

// AI 对话面板
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 12px;
  }

  .chat-message {
    display: flex;
    gap: 8px;

    &.user {
      flex-direction: row-reverse;

      .message-content {
        background-color: $primary-color;
        color: #fff;
      }
    }

    &.assistant {
      .message-content {
        background-color: var(--msg-bg, $light-bg-panel);
        color: var(--text-primary, $text-primary);
      }
    }

    .message-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background-color: var(--avatar-bg, $light-bg-panel);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .el-icon {
        font-size: 14px;
        color: var(--text-secondary, $text-secondary);
      }
    }

    .message-content {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: $border-radius-card;
      font-size: 13px;
      line-height: 1.5;
    }
  }

  .chat-input {
    padding-top: 12px;
    border-top: 1px solid var(--border-color, $border-lighter);

    :deep(.el-input-group__append) {
      padding: 0;

      .el-button {
        margin: 0;
        border: none;
        background: transparent;
      }
    }
  }
}

// 深色主题适配
:global(html.dark) .editor-right-panel {
  --panel-bg: #{$dark-bg-base};
  --border-color: #{$dark-border-light};
  --text-primary: #{$dark-text-primary};
  --text-secondary: #{$dark-text-secondary};
  --text-regular: #{$dark-text-regular};
  --hover-bg: #{$dark-bg-hover};
  --active-bg: #{$dark-bg-active};
  --info-bg: #{$dark-bg-panel};
  --msg-bg: #{$dark-bg-panel};
  --avatar-bg: #{$dark-bg-panel};
}
</style>
