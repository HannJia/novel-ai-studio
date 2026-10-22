<template>
  <button v-if="hasContent || summary" class="review-toggle-btn" :class="{ 'is-open': open }" :title="open ? '收起审查面板' : '展开审查面板'" @click="emit('toggle')">
    {{ open ? '▶' : '◀' }}<span v-if="!open" class="review-toggle-label">审查</span>
  </button>
  <transition name="slide-right">
    <div v-if="open && (hasContent || summary || loading)" class="review-sidebar">
      <div class="review-sidebar-header">
        <div class="review-header-title"><div v-if="loading" class="ai-spinner"></div><strong>{{ loading ? '审查进行中…' : '本章审查' }}</strong></div>
        <button class="close-btn" title="关闭审查面板" @click="emit('close')">✕</button>
      </div>
      <div class="review-sidebar-body">
        <p class="review-intro">结合人物、情节与叙事节奏，查看本章审查结果。</p>
        <p v-if="contentReview" class="review-verdict" :class="`review-verdict--${loading ? 'unknown' : reviewVerdict}`" role="status">{{ loading ? '正在审查，结论尚未完成' : reviewVerdict === 'passed' ? '报告结论：可通过' : reviewVerdict === 'changes-required' ? '报告结论：需要修改' : '报告结论：待确认结论' }}</p>
        <section v-if="coverageStatus" class="review-section">
          <div class="review-section-title">审核覆盖范围</div>
          <p class="review-section-content" role="status">{{ coverageStatus }}</p>
        </section>
        <section v-if="endingCheck" class="review-section ending-check-section">
          <div class="review-section-title">章节结尾检查 · {{ endingCheck.isComplete ? '已通过' : '需要收尾' }}</div>
          <div class="review-section-content">
            <p>{{ endingCheck.reason }}</p>
            <p v-if="endingCheck.openAction"><strong>未完成事项：</strong>{{ endingCheck.openAction }}</p>
            <p v-if="endingCheck.continuationInstruction"><strong>收尾建议：</strong>{{ endingCheck.continuationInstruction }}</p>
            <p v-if="endingCheck.isValidCliffhanger" class="revision-meta">结尾属于本章行动已有结果后引出的有效悬念。</p>
          </div>
        </section>

        <section v-if="pendingRevision" class="review-section revision-section">
          <div class="review-section-title">待确认正文修订</div>
          <div class="review-section-content">
            <p class="revision-meta">{{ pendingRevision.reason || 'AI 生成的正文修订建议' }}</p>
            <pre class="revision-diff">{{ pendingRevision.diff }}</pre>
            <div class="action-row"><n-button v-if="allowRewrite || pendingRevision.source === 'user'" size="small" type="primary" :disabled="revisionLoading" @click="emit('approve-revision')">确认写入</n-button><n-button size="small" :disabled="revisionLoading" @click="emit('reject-revision')">拒绝</n-button></div>
          </div>
        </section>

        <div v-if="loading && !contentReview" class="review-loading-hint"><div class="ai-spinner"></div><p>AI 正在分析章节内容...</p></div>

        <section v-if="summary" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'summary')">章节总结<span>{{ expanded.summary ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.summary" class="review-section-content">{{ summary }}</div>
        </section>

        <section v-if="contentReview" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'contentReview')">内容审查 {{ loading ? '(生成中...)' : '' }}<span>{{ expanded.contentReview ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.contentReview" class="review-section-content">
            <div v-if="!loading && allowRewrite && contentReviewVerdict(contentReview) === 'changes-required'" class="rewrite-actions">
              <textarea :value="editableReview" class="editable-review" rows="4" placeholder="报告未列出具体修改项，可在这里填写后修订" @input="emit('update-editable-review', ($event.target as HTMLTextAreaElement).value)"></textarea>
              <div class="action-row"><n-button size="small" type="primary" :disabled="aiWriting || completing || !editableReview.trim()" @click="emit('rewrite', editableReview, 'targeted')">局部修正</n-button><n-button size="small" :disabled="aiWriting || completing || !editableReview.trim()" @click="emit('rewrite', editableReview, 'full')">整章修订</n-button></div>
            </div>
            <p v-if="reviewStatus" class="review-status" role="status">{{ reviewStatus }}</p>
            <div class="review-cards">
              <article v-for="(section, index) in reviewCards" :key="index" class="review-card">
                <h4><span class="review-card-mark" aria-hidden="true">{{ index + 1 }}</span>{{ section.title }}</h4>
                <p>{{ section.content }}</p>
              </article>
            </div>
            <details class="review-full-report" :open="reviewCards.length === 0"><summary>完整审查报告</summary><div class="banned-content" v-html="renderedContentReview"></div></details>
          </div>
        </section>

        <section v-if="localScanResults.length" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'localScan')">违禁词扫描（{{ localScanResults.length }} 项）<span>{{ expanded.localScan ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.localScan" class="review-section-content">
            <div v-for="item in localScanResults" :key="item.word.word" class="scan-item">
              <span class="scan-word" :class="item.word.level">{{ item.word.word }}</span><span>{{ item.word.category }}</span><span>×{{ item.count }}</span>
              <n-button v-if="item.word.suggestion" size="tiny" type="primary" @click="emit('replace-word', item.word.word, item.word.suggestion)">替换</n-button>
            </div>
            <n-button v-if="localScanResults.some(item => item.word.suggestion)" size="small" type="warning" @click="emit('replace-all')">一键替换</n-button>
          </div>
        </section>

        <section v-if="continuityAlerts.length" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'continuity')">连续性提醒（{{ continuityAlerts.length }} 项）<span>{{ expanded.continuity ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.continuity" class="review-section-content">
            <div v-for="alert in continuityAlerts" :key="alert.id" class="continuity-item" :class="`continuity-${alert.level}`">
              <strong>{{ alert.title }}</strong>
              <p>{{ alert.detail }}</p>
              <small>依据：{{ alert.evidence }}</small>
            </div>
          </div>
        </section>

        <section v-if="bannedResult" class="review-section">
          <button class="review-section-title" @click="emit('toggle-section', 'aiReview')">AI 审查意见<span>{{ expanded.aiReview ? '▼' : '▶' }}</span></button>
          <div v-if="expanded.aiReview" class="review-section-content"><div class="banned-content" v-html="renderedBannedResult"></div></div>
        </section>
      </div>
      <div class="review-sidebar-footer">
        <n-button size="small" quaternary :disabled="loading || completing || aiWriting" @click="emit('clear')">清空报告</n-button>
        <n-button v-if="actionLabel" size="small" type="primary" :disabled="actionDisabled" :loading="actionLoading" @click="emit('proceed')">{{ actionLabel }}</n-button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import { contentReviewVerdict } from '@/services/contentReview'
import type { ChapterEndingCheck } from '@/services/chapterEnding'
import type { BannedWordEntry } from '@/data/bannedWords'
import type { ChapterRevision } from '@/types/novel'

type SectionKey = 'summary' | 'contentReview' | 'localScan' | 'aiReview' | 'continuity'

const props = defineProps<{
  open: boolean; hasContent: boolean; summary: string; loading: boolean; endingCheck: ChapterEndingCheck | null
  pendingRevision: ChapterRevision | null; revisionLoading: boolean; contentReview: string; renderedContentReview: string
  editableReview: string; aiWriting: boolean; completing: boolean; allowRewrite: boolean
  localScanResults: Array<{ word: BannedWordEntry; count: number; positions: number[] }>
  continuityAlerts: Array<{ id: string; level: 'warning' | 'info'; title: string; detail: string; evidence: string }>
  bannedResult: string; renderedBannedResult: string; expanded: Record<SectionKey, boolean>
  reviewStatus?: string; coverageStatus?: string; actionLabel?: string; actionDisabled?: boolean; actionLoading?: boolean
}>()

const reviewVerdict = computed(() => contentReviewVerdict(props.contentReview))
const reviewCards = computed(() => {
  const sections: Array<{ title: string; content: string }> = []
  let title = ''
  let lines: string[] = []
  const clean = (text: string) => text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  const flush = () => {
    if (!title || !lines.join('').trim()) return
    if (/六维度|维度简评/.test(title)) {
      for (const line of lines) {
        const match = line.match(/^\s*\d+[.、)）]\s*([^：:]+)[：:]\s*(.+)$/)
        if (match) sections.push({ title: clean(match[1]), content: clean(match[2]) })
      }
    } else if (!/结论|审查报告/.test(title)) sections.push({ title: clean(title), content: clean(lines.join('\n').trim()) })
  }
  for (const line of props.contentReview.split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/) || line.match(/^\s*\*\*(.+?)\*\*[：:]?\s*$/)
    if (heading) { flush(); title = heading[1]; lines = [] }
    else lines.push(line)
  }
  flush()
  return sections
})

const emit = defineEmits<{
  toggle: []; close: []; clear: []; 'approve-revision': []; 'reject-revision': []
  rewrite: [review: string, mode: 'targeted' | 'full']; 'replace-word': [word: string, suggestion: string]; 'replace-all': []
  'toggle-section': [key: SectionKey]; 'update-editable-review': [value: string]
  proceed: []
}>()
</script>

<style scoped>
.review-toggle-btn { position: fixed; right: 0; top: 50%; z-index: 29; min-width: 28px; height: 52px; border: 1px solid var(--border-color); border-right: 0; background: var(--bg-color-card); color: var(--text-color-secondary); cursor: pointer; }
.review-toggle-btn.is-open { right: min(430px, 92vw); }
.review-toggle-label { writing-mode: vertical-rl; margin-left: 2px; font-size: 11px; }
.review-sidebar { position: fixed; top: 52px; bottom: 0; right: 0; z-index: 28; width: min(430px, 92vw); display: flex; flex-direction: column; background: var(--bg-color-card); border-left: 1px solid var(--border-color); box-shadow: var(--shadow-lg); }
.review-sidebar-header, .review-header-title, .action-row { display: flex; align-items: center; gap: 8px; }
.review-sidebar-header { justify-content: space-between; min-height: 54px; flex-shrink: 0; padding: 0 16px; border-bottom: 1px solid var(--border-color-light); }
.close-btn { border: 0; background: none; color: var(--text-color-tertiary); cursor: pointer; }
.review-sidebar-body { flex: 1; min-height: 0; overflow: auto; padding: 14px; }
.review-sidebar-footer { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 14px 18px; border-top: 1px solid var(--border-color-light); }
.review-status { color: var(--color-primary); font-weight: 600; }
.review-section { margin-bottom: 10px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); overflow: hidden; }
.review-section-title { width: 100%; display: flex; justify-content: space-between; gap: 8px; padding: 10px; border: 0; background: var(--bg-color-secondary); color: var(--text-color-primary); font-weight: 600; text-align: left; }
.review-section-content { padding: 10px; color: var(--text-color-secondary); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
.review-section-content p { margin: 5px 0; }
.revision-diff { max-height: 280px; overflow: auto; white-space: pre-wrap; font: inherit; }
.editable-review { width: 100%; box-sizing: border-box; resize: vertical; padding: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-color); color: var(--text-color-primary); }
.rewrite-actions { margin-bottom: 12px; }
.action-row { margin-top: 8px; }
.scan-item { display: grid; grid-template-columns: 1fr auto auto auto; gap: 7px; align-items: center; padding: 6px 0; }
.scan-word.must { color: var(--color-error); }
.scan-word.platform { color: var(--color-warning); }
.continuity-item { padding: 7px 0; border-bottom: 1px solid var(--border-color-light); }
.continuity-item:last-child { border-bottom: 0; }
.continuity-item strong { color: var(--text-color-primary); font-size: 12px; }
.continuity-item p { margin: 3px 0; font-size: 12px; }
.continuity-item small { color: var(--text-color-tertiary); font-size: 11px; }
.continuity-warning strong { color: var(--color-warning); }
.continuity-info strong { color: var(--color-info); }
.review-loading-hint { padding: 18px; text-align: center; color: var(--text-color-tertiary); }
.ai-spinner { width: 16px; height: 16px; border: 2px solid var(--border-color); border-top-color: var(--color-primary); border-radius: 50%; animation: spin .8s linear infinite; }
.banned-content :deep(p) { margin: 5px 0; }
.review-intro { color: var(--text-color-tertiary); line-height: 1.7; font-size: 13px; margin: 0 0 16px; }
.review-verdict { padding: 10px 12px; border-radius: var(--radius-md); background: var(--bg-color-secondary); color: var(--text-color-secondary); font-size: 13px; margin: 0 0 16px; }
.review-verdict--passed { background: var(--color-accent-light); color: var(--color-accent); }
.review-verdict--changes-required { background: var(--color-primary-light); color: var(--color-primary); }
.review-cards { display: grid; gap: 12px; }
.review-card { padding: 18px; border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); background: var(--bg-color-paper); }
.review-card h4 { display: flex; align-items: center; gap: 8px; font: 600 17px var(--font-family-serif); color: var(--text-color-primary); margin: 0 0 10px; }
.review-card-mark { font: 12px var(--font-family); color: var(--color-accent); }
.review-card p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; margin: 0; }
.review-full-report { margin-top: 14px; padding: 12px; border: 1px solid var(--border-color-light); border-radius: var(--radius-md); }
.review-full-report summary { cursor: pointer; color: var(--text-color-tertiary); }
.review-full-report .banned-content { padding-top: 12px; }
.review-section:has(.review-cards) { border: 0; }
.review-section:has(.review-cards) > .review-section-title { background: transparent; padding: 0 0 12px; }
.review-section:has(.review-cards) > .review-section-content { padding: 0; }
.slide-right-enter-active, .slide-right-leave-active { transition: transform .2s ease, opacity .2s ease; }
.slide-right-enter-from, .slide-right-leave-to { transform: translateX(100%); opacity: 0; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
