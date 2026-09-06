<template>
  <button
    v-if="!open && !persistent"
    class="advisor-toggle-btn"
    title="打开写作辅助"
    @click="emit('open')"
  >
    💡<span>写作辅助</span>
  </button>

  <transition name="slide-right">
    <aside v-if="open || persistent" class="advisor-sidebar">
      <header class="advisor-header">
        <div>
          <div class="advisor-title"><span class="advisor-icon">💡</span><strong>写作辅助</strong></div>
          <p>AI 提供思路和资料提醒，不修改正文。</p>
        </div>
        <button v-if="!persistent" class="close-btn" title="关闭写作辅助" @click="emit('close')">✕</button>
      </header>

      <div class="advisor-mode-row" aria-label="分析范围" role="group">
        <button
          v-for="item in modes"
          :key="item.value"
          class="mode-btn"
          :class="{ active: lastMode === item.value }"
          :aria-pressed="lastMode === item.value"
          :aria-busy="analyzingModes?.includes(item.value)"
          @click="emit('select-mode', item.value)"
        >
          {{ item.label }}<span v-if="analyzingModes?.includes(item.value)" class="mode-progress" aria-hidden="true"> ···</span>
        </button>
      </div>
      <div class="advisor-batch-row">
        <n-button size="small" type="primary" :disabled="analyzingModes?.length === 3" @click="emit('analyze-all')">
          {{ analyzingModes?.length ? `正在并行分析（${analyzingModes.length}/3）` : '同时分析全部范围' }}
        </n-button>
        <span>三个范围并行生成，结果分别保留</span>
      </div>

      <div class="advisor-body">
        <div v-if="analyzing" class="advisor-loading">
          <div class="advisor-spinner"></div>
          <span>正在整理前文、计划和相关设定...</span>
          <n-button size="tiny" quaternary @click="emit('stop')">停止</n-button>
        </div>

        <div v-if="error && !stale" class="advisor-alert" role="alert">{{ error }}</div>
        <div v-if="stale" class="advisor-alert advisor-alert--warning">正文或参考资料已经变化，当前建议仅供参考。需要更新时请点击分析，不会自动重新请求。</div>

        <div v-if="!result && !analyzing" class="advisor-empty">
          <div class="advisor-empty-icon">✦</div>
          <strong>从你的正文出发，找下一步</strong>
          <p>选择分析范围后点击分析。各标签独立保留结果，切换标签不会调用 AI。</p>
          <n-button type="primary" size="small" @click="emit('analyze', lastMode)">分析{{ modeLabel }}</n-button>
        </div>

        <template v-if="result">
          <div class="advisor-meta">
            <span class="meta-label">分析范围</span>
            <strong>{{ result.focusLabel }}</strong>
            <span class="meta-dot">·</span>
            <span>{{ result.suggestions.length }} 个方向</span>
          </div>
          <div class="advisor-context">
            <span class="context-label">本次参考</span>
            <span>{{ result.contextSummary }}</span>
          </div>
          <details v-if="result.focusExcerpt" class="focus-details">
            <summary>查看本次分析正文片段</summary>
            <p>{{ result.focusExcerpt }}</p>
          </details>

          <section class="advisor-section">
            <div class="section-heading"><strong>接下来可以怎么写</strong><span>任选一个方向</span></div>
            <article
              v-for="suggestion in result.suggestions"
              :key="suggestion.id"
              class="suggestion-card"
              :class="{ selected: selectedId === suggestion.id }"
            >
              <div class="suggestion-heading">
                <span class="kind-tag">{{ kindLabels[suggestion.kind] }}</span>
                <strong>{{ suggestion.title }}</strong>
              </div>
              <p class="suggestion-approach">{{ suggestion.approach }}</p>
              <dl class="suggestion-details">
                <template v-if="suggestion.storyEffect">
                  <dt>故事作用</dt><dd>{{ suggestion.storyEffect }}</dd>
                </template>
                <template v-if="suggestion.nextBeat">
                  <dt>下一拍</dt><dd>{{ suggestion.nextBeat }}</dd>
                </template>
                <template v-if="suggestion.risk">
                  <dt>注意</dt><dd>{{ suggestion.risk }}</dd>
                </template>
              </dl>
              <div v-if="suggestion.evidence.length" class="evidence-list">
                <div class="evidence-title">依据</div>
                <div v-for="evidence in suggestion.evidence" :key="`${suggestion.id}-${evidence.sourceLabel}-${evidence.excerpt}`" class="evidence-item">
                  <span>{{ evidence.sourceLabel }}</span>
                  <q>“{{ evidence.excerpt }}”</q>
                </div>
              </div>
              <div class="suggestion-actions">
                <n-button size="tiny" :type="selectedId === suggestion.id ? 'primary' : 'default'" @click="selectSuggestion(suggestion.id)">
                  {{ selectedId === suggestion.id ? '当前方向' : '选为当前方向' }}
                </n-button>
                <n-button size="tiny" quaternary @click="emit('copy', suggestion)">复制思路</n-button>
                <n-button size="tiny" quaternary @click="emit('promote-plan', suggestion)">转为章节计划</n-button>
                <n-button size="tiny" quaternary @click="emit('save-note', suggestion)">保存为场景笔记</n-button>
              </div>
            </article>
          </section>

          <section v-if="result.nextChapterPlan" class="advisor-section next-plan-section">
            <div class="section-heading"><strong>下一章计划草案</strong><span>确认后再使用</span></div>
            <h3>{{ result.nextChapterPlan.title }}</h3>
            <p v-if="result.nextChapterPlan.objective">{{ result.nextChapterPlan.objective }}</p>
            <ol v-if="result.nextChapterPlan.beats.length">
              <li v-for="beat in result.nextChapterPlan.beats" :key="beat">{{ beat }}</li>
            </ol>
          </section>
        </template>
      </div>

      <footer v-if="result" class="advisor-footer">
        <n-button size="small" :disabled="analyzing" @click="emit('analyze', lastMode)">重新分析</n-button>
        <n-button size="small" quaternary @click="emit('clear')">清空本标签建议</n-button>
      </footer>
    </aside>
  </transition>
</template>

<script setup lang="ts">
import { computed, shallowReactive } from 'vue'
import { NButton } from 'naive-ui'
import type { WritingAdviceKind, WritingAdviceMode, WritingAdviceResult, WritingAdviceSuggestion } from '@/services/writingAdvisor'

const props = defineProps<{
  open: boolean
  /** Keep the advisor visible while the author is in manual writing mode. */
  persistent?: boolean
  analyzing: boolean
  error: string
  stale: boolean
  result: WritingAdviceResult | null
  lastMode: WritingAdviceMode
  analyzingModes?: WritingAdviceMode[]
}>()

const emit = defineEmits<{
  open: []
  close: []
  stop: []
  clear: []
  analyze: [mode: WritingAdviceMode]
  'analyze-all': []
  'select-mode': [mode: WritingAdviceMode]
  copy: [suggestion: WritingAdviceSuggestion]
  'promote-plan': [suggestion: WritingAdviceSuggestion]
  'save-note': [suggestion: WritingAdviceSuggestion]
}>()

const selections = shallowReactive<Partial<Record<WritingAdviceMode, { result: WritingAdviceResult; id: string }>>>({})
const selectedId = computed(() => {
  const selected = selections[props.lastMode]
  return selected?.result === props.result ? selected?.id || '' : ''
})
const modes: Array<{ value: WritingAdviceMode; label: string }> = [
  { value: 'paragraph', label: '当前段落' },
  { value: 'scene', label: '当前场景' },
  { value: 'chapter', label: '本章走向' },
]
const modeLabel = computed(() => modes.find(mode => mode.value === props.lastMode)?.label || '当前场景')
const kindLabels: Record<WritingAdviceKind, string> = {
  conflict: '冲突升级',
  investigation: '调查线索',
  relationship: '人物关系',
  revelation: '信息揭示',
  scene: '场景推进',
  pacing: '节奏调整',
}

function selectSuggestion(id: string) {
  if (props.result) selections[props.lastMode] = { result: props.result, id: selectedId.value === id ? '' : id }
}
</script>

<style scoped>
.advisor-toggle-btn { position: fixed; right: 0; top: calc(50% - 90px); z-index: 111; display: flex; align-items: center; gap: 5px; min-height: 54px; padding: 8px 8px 8px 6px; border: 1px solid var(--border-color); border-right: 0; background: var(--bg-color-card); color: var(--text-color-secondary); cursor: pointer; box-shadow: var(--shadow-sm); writing-mode: vertical-rl; }
.advisor-toggle-btn span { margin-top: 3px; font-size: 11px; }
.advisor-sidebar { position: fixed; top: 104px; right: 0; z-index: 110; width: min(440px, 94vw); height: calc(100vh - 104px); display: flex; flex-direction: column; background: var(--bg-color-card); border-left: 1px solid var(--border-color); box-shadow: var(--shadow-lg); }
.advisor-header { flex-shrink: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-height: 68px; padding: 15px 16px 12px; border-bottom: 1px solid var(--border-color-light); }
.advisor-title { display: flex; align-items: center; gap: 7px; font-size: 16px; }
.advisor-icon { font-size: 18px; }
.advisor-header p { margin: 5px 0 0; color: var(--text-color-tertiary); font-size: 12px; }
.close-btn { width: 28px; height: 28px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-color-tertiary); cursor: pointer; }
.close-btn:hover { background: var(--bg-color-hover); }
.advisor-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; }
.advisor-mode-row { flex-shrink: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--border-color-light); background: var(--bg-color-card); }
.advisor-batch-row { flex-shrink: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 14px; border-bottom: 1px solid var(--border-color-light); background: var(--bg-color-secondary); }
.advisor-batch-row span { color: var(--text-color-tertiary); font-size: 11px; }
.mode-btn { min-height: 34px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-color); color: var(--text-color-secondary); cursor: pointer; font-size: 12px; }
.mode-btn:hover:not(:disabled), .mode-btn.active { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
.mode-btn:disabled { opacity: .6; cursor: wait; }
.advisor-loading { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); background: var(--bg-color-secondary); color: var(--text-color-secondary); font-size: 12px; }
.advisor-loading span { flex: 1; }
.advisor-spinner { width: 14px; height: 14px; flex: 0 0 auto; border: 2px solid var(--border-color); border-top-color: var(--color-primary); border-radius: 50%; animation: spin .8s linear infinite; }
.advisor-alert { margin: 10px 0; padding: 9px 10px; border-left: 3px solid var(--color-error); background: var(--color-error-light, rgba(208, 48, 80, .08)); color: var(--color-error); font-size: 12px; line-height: 1.5; }
.advisor-alert--warning { border-left-color: var(--color-warning); background: rgba(240, 160, 32, .08); color: var(--color-warning); }
.advisor-empty { padding: 42px 18px; text-align: center; color: var(--text-color-secondary); }
.advisor-empty-icon { margin-bottom: 10px; color: var(--color-primary); font-size: 28px; }
.advisor-empty strong { display: block; color: var(--text-color-primary); font-size: 14px; }
.advisor-empty p { margin: 8px 0 16px; font-size: 12px; line-height: 1.7; }
.advisor-meta, .advisor-context { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.advisor-meta { color: var(--text-color-secondary); }
.meta-label, .context-label { color: var(--text-color-tertiary); }
.meta-dot { color: var(--border-color-hover); }
.advisor-context { margin-top: 7px; padding: 8px 9px; background: var(--bg-color-secondary); border-radius: var(--radius-sm); color: var(--text-color-secondary); line-height: 1.5; }
.focus-details { margin: 10px 0; color: var(--text-color-tertiary); font-size: 11px; }
.focus-details summary { cursor: pointer; }
.focus-details p { margin: 6px 0 0; padding: 7px; border-left: 2px solid var(--border-color); color: var(--text-color-secondary); line-height: 1.6; }
.advisor-section { margin-top: 14px; }
.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.section-heading strong { color: var(--text-color-primary); font-size: 13px; }
.section-heading span { color: var(--text-color-tertiary); font-size: 11px; }
.suggestion-card { margin-bottom: 9px; padding: 11px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); background: var(--bg-color); }
.suggestion-card.selected { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary-light); }
.suggestion-heading { display: flex; align-items: center; gap: 7px; }
.suggestion-heading strong { color: var(--text-color-primary); font-size: 13px; }
.kind-tag { padding: 2px 5px; border-radius: 3px; background: var(--color-primary-light); color: var(--color-primary); font-size: 10px; white-space: nowrap; }
.suggestion-approach { margin: 8px 0; color: var(--text-color-secondary); font-size: 12px; line-height: 1.65; }
.suggestion-details { display: grid; grid-template-columns: 42px 1fr; gap: 5px 8px; margin: 0; font-size: 11px; line-height: 1.55; }
.suggestion-details dt { color: var(--text-color-tertiary); }
.suggestion-details dd { margin: 0; color: var(--text-color-secondary); }
.evidence-list { margin-top: 9px; padding-top: 8px; border-top: 1px dashed var(--border-color); }
.evidence-title { margin-bottom: 4px; color: var(--text-color-tertiary); font-size: 10px; }
.evidence-item { display: flex; gap: 5px; margin-top: 4px; color: var(--text-color-secondary); font-size: 10px; line-height: 1.5; }
.evidence-item span { flex: 0 0 auto; color: var(--color-info); }
.evidence-item q { overflow-wrap: anywhere; color: var(--text-color-tertiary); }
.suggestion-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 10px; }
.next-plan-section { padding: 11px; border: 1px solid var(--border-color-light); border-radius: var(--radius-sm); background: var(--bg-color-secondary); }
.next-plan-section h3 { margin: 4px 0 6px; color: var(--text-color-primary); font-size: 13px; }
.next-plan-section p, .next-plan-section li { color: var(--text-color-secondary); font-size: 12px; line-height: 1.6; }
.next-plan-section p { margin: 0 0 5px; }
.next-plan-section ol { margin: 5px 0 0; padding-left: 20px; }
.advisor-footer { flex-shrink: 0; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--border-color-light); }
.slide-right-enter-active, .slide-right-leave-active { transition: transform .2s ease, opacity .2s ease; }
.slide-right-enter-from, .slide-right-leave-to { transform: translateX(100%); opacity: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  /* Leave the app header and chapter title bar reachable for mode switching. */
  .advisor-sidebar { top: 180px; width: 100vw; height: calc(100vh - 180px); }
  .advisor-toggle-btn { top: calc(50% - 120px); }
}
</style>
