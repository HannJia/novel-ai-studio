<template>
  <Teleport defer to="#v3-crumb"><span class="crumb-b">书架</span><span class="m-muted m-tiny">· {{ novels.activeNovels.length }} 部作品</span></Teleport>
  <div class="page" data-keep="shelf">
    <div class="page-in">
      <div class="head">
        <div><div class="eyebrow">{{ hello.date }}</div><h2 class="hello">{{ hello.hello }}</h2></div>
        <div class="head-acts">
          <button type="button" class="m-btn" @click="importInput?.click()"><V3Icon name="import" size="s" />导入项目</button>
          <button type="button" class="m-btn" :disabled="busy" @click="exportProject"><V3Icon name="shield" size="s" />备份项目</button>
          <router-link to="/create" class="m-btn zhu"><V3Icon name="plus" size="s" />新建作品</router-link>
          <input ref="importInput" type="file" accept=".json,application/json" hidden @change="onImportFile">
        </div>
      </div>

      <div class="grid">
        <div class="col-main">
          <section v-if="resume" class="hero">
            <div class="hero-img" :style="{ backgroundImage: `url(${heroArt})` }" />
            <div class="hero-c">
              <button type="button" class="hero-cover" :style="{ backgroundImage: `url(${coverUrl(resume.novel)})` }" :aria-label="`打开《${resume.novel.title}》`" @click="openResume" />
              <div class="hero-t">
                <div class="eyebrow">继续写作</div>
                <h2 class="hero-title">《{{ resume.novel.title }}》</h2>
                <div class="hero-sub">
                  <template v-if="resume.chapter">第{{ resume.chapter.chapterIndex + 1 }}章 {{ chapterTitleForDisplay(resume.chapter.title, resume.chapter.chapterIndex, '未命名') }} · {{ resume.chapter.wordCount.toLocaleString() }} 字 · </template>{{ relativeTime(resume.novel.updatedAt) }}
                </div>
                <div v-if="resume.quote" class="hero-quote">{{ resume.quote }}</div>
                <div class="hero-acts">
                  <button type="button" class="m-btn pri lg" @click="openResume"><V3Icon name="pen" size="s" />{{ resume.chapter ? `回到第${resume.chapter.chapterIndex + 1}章` : '打开章节' }}</button>
                  <router-link :to="areaPath('plan', resume.novel.id)" class="m-btn lg">剧情规划</router-link>
                </div>
                <div class="hero-tags">
                  <span v-if="resumeBlockers" class="m-tag zhu"><V3Icon name="alert" size="s" />{{ resumeBlockers }} 处阻塞定稿</span>
                  <span v-if="resume.novel.storyClock?.label" class="m-tag line"><V3Icon name="clock" size="s" />{{ resume.novel.storyClock.label }}</span>
                  <span class="m-tag line">{{ resume.novel.writingMode === 'ai' ? 'AI 协作' : '作者主笔' }}</span>
                </div>
              </div>
            </div>
          </section>
          <section v-else class="m-card empty-hero">
            <div class="m-empty">
              <img class="m-art" :src="emptyShelfArt" alt="">
              <b>书架还空着</b>
              <p>从一句灵感、已有大纲或空白模板开始你的第一部作品。也可以导入以前的项目备份。</p>
              <div class="empty-acts"><router-link to="/create" class="m-btn zhu lg"><V3Icon name="plus" size="s" />新建第一部作品</router-link>
                <button type="button" class="m-btn lg" @click="importInput?.click()">导入项目备份</button></div>
            </div>
          </section>

          <div class="sec-h">
            <h3>作品</h3>
            <div class="m-seg" role="tablist" aria-label="作品分类">
              <button v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }} {{ t.count || '' }}</button>
            </div>
          </div>
          <div v-if="visible.length || tab === 'all'" class="books">
            <article v-for="book in visible" :key="book.id" class="book">
              <button type="button" class="cover" :style="{ backgroundImage: `url(${coverUrl(book)})` }" :aria-label="`打开《${book.title}》`" @click="openBook(book)">
                <span class="tiqian">{{ shortTitle(book.title) }}</span>
                <span class="badges"><span v-for="b in badgesOf(book)" :key="b">{{ b }}</span></span>
              </button>
              <div class="book-i">
                <div class="book-t"><span>{{ book.title }}</span>
                  <button type="button" class="m-ibtn more" :aria-label="`《${book.title}》更多操作`" @click.stop="toggleMenu(book.id)"><V3Icon name="more" size="s" /></button>
                </div>
                <div class="book-m"><span>{{ book.genreLabel || '未分类' }}</span><span class="m-num">{{ wan(book.currentWordCount) }}</span></div>
                <div class="book-m"><span>{{ book.chapters.length }} 章 · {{ relativeTime(book.updatedAt) }}</span></div>
                <div v-if="menuFor === book.id" class="menu" role="menu" @click.stop>
                  <template v-if="book.status === 'trash'">
                    <button type="button" role="menuitem" @click="act('restore', book)"><V3Icon name="refresh" size="s" />恢复到书架</button>
                    <button type="button" role="menuitem" class="danger" @click="act('purge', book)"><V3Icon name="trash" size="s" />永久删除</button>
                  </template>
                  <template v-else>
                    <button type="button" role="menuitem" @click="act('rename', book)"><V3Icon name="edit" size="s" />修改书名</button>
                    <button type="button" role="menuitem" @click="act('cover', book)"><V3Icon name="image" size="s" />更换封面</button>
                    <button v-if="book.status === 'archived'" type="button" role="menuitem" @click="act('unarchive', book)"><V3Icon name="archive" size="s" />取消归档</button>
                    <button v-else type="button" role="menuitem" @click="act('archive', book)"><V3Icon name="archive" size="s" />归档</button>
                    <button type="button" role="menuitem" class="danger" @click="act('trash', book)"><V3Icon name="trash" size="s" />移入回收站</button>
                  </template>
                </div>
              </div>
            </article>
            <router-link v-if="tab === 'all' || tab === 'writing'" to="/create" class="book-new"><V3Icon name="plus" size="l" /><span>新建作品<br><small>灵感 · 导入 · 空白</small></span></router-link>
          </div>
          <div v-else class="m-empty"><img class="m-art small" :src="emptyArt" alt=""><p>{{ emptyText }}</p></div>

        </div>
        <aside class="col-aside">
          <div class="m-card box">
            <h4>待你决定 <span v-if="pending.length" class="m-tag zhu">{{ pending.length }}</span></h4>
            <router-link v-for="it in pending" :key="it.key" :to="it.to" class="todo"><V3Icon :name="it.icon" /><div><div>{{ it.title }}</div><div class="todo-d">{{ it.detail }}</div></div></router-link>
            <div v-if="!pending.length" class="m-empty compact"><img class="m-art" :src="clearArt" alt=""><p>没有需要你处理的事项。</p></div>
          </div>
          <div class="m-card box">
            <h4>资料库 <router-link to="/knowledge" class="m-btn sm knowledge-manage">管理</router-link></h4>
            <router-link v-for="kb in knowledge.knowledgeBases.slice(0, 5)" :key="kb.id" to="/knowledge" class="lib">
              <i :style="{ background: spineColor(kb.id) }" /><div><div>{{ kb.name }}</div><div class="todo-d">{{ kb.entries.length }} 条 · 挂载于 {{ mounts(kb.id) }} 部作品</div></div>
            </router-link>
            <p v-if="!knowledge.knowledgeBases.length" class="box-note">还没有资料库。导入史料、设定或参考书后，可挂载到作品中供 AI 检索。</p>
          </div>
          <div class="m-card box">
            <h4>本周</h4>
            <div class="stats">
              <div><b class="m-num">{{ week >= 10000 ? (week / 10000).toFixed(1) + '万' : week.toLocaleString() }}</b><span>写下</span></div>
              <div><b class="m-num">{{ weekFinalized }}</b><span>章定稿</span></div>
              <div><b class="m-num">{{ weekFacts }}</b><span>条新事实</span></div>
            </div>
          </div>
          <div class="m-card box calendar-box">
            <h4>写作日历 <span class="m-muted m-tiny">{{ calendarMonth }}月</span></h4>
            <WritingHeatmap month />
          </div>
        </aside>
      </div>
    </div>
  </div>
  <Teleport defer to="#v3-status"><span class="status-it"><V3Icon name="book" size="s" />全部作品 {{ wan(totalWords) }}</span><span class="status-it" :title="lastBackup ? new Date(lastBackup).toLocaleString() : ''"><V3Icon name="shield" size="s" />{{ lastBackup ? '上次备份 ' + relativeTime(lastBackup) : '尚未在本机导出过备份' }}</span></Teleport>

  <div v-if="renameFor" class="m-overlay" @click.self="renameFor = null" @keydown.esc="renameFor = null">
    <form class="m-modal small" @submit.prevent="confirmRename">
      <div class="m-modal-h"><h3>修改书名</h3></div>
      <div class="m-modal-b"><input ref="renameInput" v-model="renameText" class="m-input" maxlength="80" aria-label="新的书名"></div>
      <div class="m-modal-f"><button type="button" class="m-btn" @click="renameFor = null">取消</button><button type="submit" class="m-btn pri" :disabled="!renameText.trim() || busy">保存</button></div>
    </form>
  </div>
  <div v-if="coverFor" class="m-overlay" @click.self="coverFor = null" @keydown.esc="coverFor = null">
    <div class="m-modal" role="dialog" aria-modal="true" aria-label="更换封面">
      <div class="m-modal-h"><div><h3>更换封面 ·《{{ coverFor.title }}》</h3><p>封面只影响显示，不会改变作品设定或审核结果。</p></div><button type="button" class="m-ibtn" aria-label="关闭" @click="coverFor = null"><V3Icon name="x" /></button></div>
      <div class="m-modal-b covers">
        <button type="button" class="pick" :class="{ on: !coverFor.coverId }" @click="pickCover('')"><span class="pc" :style="{ backgroundImage: `url(${coverUrlById(autoCover)})` }" /><small>按类型自动</small></button>
        <button v-for="c in COVER_CHOICES" :key="c.id" type="button" class="pick" :class="{ on: coverFor.coverId === c.id }" @click="pickCover(c.id)"><span class="pc" :style="{ backgroundImage: `url(${coverUrlById(c.id)})` }" /><small>{{ c.label }}</small></button>
      </div>
    </div>
  </div>
  <div v-if="confirmState" class="m-overlay" @click.self="confirmState = null" @keydown.esc="confirmState = null">
    <div class="m-modal small" role="alertdialog" aria-modal="true" :aria-label="confirmState.title">
      <div class="m-modal-h"><h3>{{ confirmState.title }}</h3></div>
      <div class="m-modal-b"><p class="confirm-body">{{ confirmState.body }}</p></div>
      <div class="m-modal-f"><button ref="cancelBtn" type="button" class="m-btn" @click="confirmState = null">取消</button>
        <button type="button" class="m-btn" :class="confirmState.danger ? 'zhu' : 'pri'" :disabled="busy" @click="runConfirm">{{ confirmState.ok }}</button></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import V3Icon from '../components/V3Icon.vue'
import WritingHeatmap from '../components/WritingHeatmap.vue'
import type { Novel } from '@/types/novel'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { downloadProjectBackup, MAX_PROJECT_BACKUP_BYTES, parseProjectBackup } from '@/services/projectBackup'
import { exportProjectSnapshot, importProject } from '@/services/projectTransfer'
import { COVER_CHOICES, coverIdOf, coverUrl, coverUrlById } from '../covers'
import { greeting, openBlockers, pendingItems, relativeTime, resumeTarget } from '../selectors/shelf'
import { areaPath, toast, toastError } from '../shell'
import { weekTotal, writingLog } from '../writingLog'
import dawn from '@/assets/v3/hero/dawn.webp'
import noon from '@/assets/v3/hero/noon.webp'
import dusk from '@/assets/v3/hero/dusk.webp'
import night from '@/assets/v3/hero/night.webp'
import emptyShelfArt from '@/assets/v3/onboarding/step-2.webp'
import clearArt from '@/assets/v3/empty/review-clear.webp'
import emptyArt from '@/assets/v3/empty/library.webp'

defineOptions({ name: 'V3ShelfView' })
const router = useRouter()
const novels = useNovelStore(), knowledge = useKnowledgeStore(), workspace = useReconstructionWorkspaceStore()
const BACKUP_KEY = 'mojian-last-backup'

const hello = ref(greeting())
const calendarMonth = ref(new Date().getMonth() + 1)
const HERO = { dawn, noon, dusk, night }
const heroArt = computed(() => HERO[hello.value.period])
const resume = computed(() => resumeTarget(novels.activeNovels))
const resumeBlockers = computed(() => resume.value ? openBlockers(resume.value.novel, workspace.getReviewFindings(resume.value.novel.id)).length : 0)
const pending = computed(() => pendingItems(novels.activeNovels, {
  findings: id => workspace.getReviewFindings(id), runs: id => workspace.getAiRuns(id), candidates: id => workspace.getCandidates(id),
}))

type Tab = 'all' | 'writing' | 'completed' | 'archived' | 'trash'
const tab = ref<Tab>('all')
const byUpdated = (list: Novel[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
const tabs = computed(() => [
  { key: 'all' as const, label: '全部', count: novels.activeNovels.length },
  { key: 'writing' as const, label: '写作中', count: novels.activeNovels.filter(n => n.status !== 'completed').length },
  { key: 'completed' as const, label: '已完结', count: novels.activeNovels.filter(n => n.status === 'completed').length },
  { key: 'archived' as const, label: '归档', count: novels.archivedNovels.length },
  { key: 'trash' as const, label: '回收站', count: novels.trashedNovels.length },
])
const visible = computed<Novel[]>(() => {
  if (tab.value === 'archived') return byUpdated(novels.archivedNovels)
  if (tab.value === 'trash') return byUpdated(novels.trashedNovels)
  if (tab.value === 'writing') return novels.activeNovels.filter(n => n.status !== 'completed')
  if (tab.value === 'completed') return novels.activeNovels.filter(n => n.status === 'completed')
  return novels.activeNovels
})
const emptyText = computed(() => ({ all: '', writing: '没有正在写作的作品', completed: '还没有完结的作品', archived: '没有归档的作品', trash: '回收站是空的' })[tab.value])
const blockerCount = computed(() => new Map(novels.novels.map(n => [n.id, openBlockers(n, workspace.getReviewFindings(n.id)).length])))
function badgesOf(book: Novel): string[] {
  const status = { creating: '设定中', completed: '已完结', archived: '已归档', trash: '回收站' } as Record<string, string>
  const out = [status[book.status] || (book.writingMode === 'ai' ? 'AI 协作' : '主笔')]
  const blockers = blockerCount.value.get(book.id) || 0
  if (blockers && book.status !== 'trash') out.push(`${blockers} 处阻塞`)
  if (workspace.getAiRuns(book.id).some(r => r.status === 'running')) out.push('自动 · 运行中')
  return out.slice(0, 2)
}
const shortTitle = (title: string) => { const t = title.replace(/[《》]/g, '').trim() || '未命名'; return t.length > 8 ? t.slice(0, 7) + '…' : t }
const wan = (n: number) => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n.toLocaleString() + ' 字'
const SPINES = ['#3E5C6B', '#8A4B2E', '#4E6B52', '#6B4E7A', '#A87A1E', '#2F4F6A']
function spineColor(id: string) { let h = 0x811c9dc5; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0; return SPINES[h % SPINES.length] }
const mounts = (kbId: string) => novels.novels.filter(n => n.status !== 'trash' && n.knowledgeBaseIds.includes(kbId)).length
const totalWords = computed(() => novels.activeNovels.reduce((sum, n) => sum + (n.currentWordCount || 0), 0))
const week = computed(() => (void writingLog.value, weekTotal()))
/** 本周一 0 点起；定稿以审核记录的 approved 完成时间计，新事实以本周写入典籍的记录计。 */
const weekStart = computed(() => {
  void hello.value
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toISOString()
})
const weekFinalized = computed(() => novels.activeNovels.reduce((sum, n) => sum + new Set(workspace.getChapterReviews(n.id)
  .filter(r => r.status === 'approved' && (r.completedAt || '') >= weekStart.value)
  .filter(r => n.chapters.some(c => c.id === r.chapterId && (c.status === 'finalized' || c.status === 'locked')))
  .map(r => r.chapterId)).size, 0))
const weekFacts = computed(() => novels.activeNovels.reduce((sum, n) => sum
  + workspace.getCanonMutations(n.id).filter(m => m.appliedAt >= weekStart.value).length, 0))
const lastBackup = ref((() => { try { return localStorage.getItem(BACKUP_KEY) || '' } catch { return '' } })())

function latestChapterId(book: Novel) { return [...book.chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id }
function openResume() { if (resume.value) router.push(areaPath('write', resume.value.novel.id, resume.value.chapter?.id)) }
function openBook(book: Novel) {
  if (book.status === 'trash') return act('restore', book)
  router.push(areaPath('write', book.id, latestChapterId(book)))
}

const menuFor = ref<string | null>(null)
const toggleMenu = (id: string) => { menuFor.value = menuFor.value === id ? null : id }
const closeMenu = () => { menuFor.value = null }
const busy = ref(false)
const renameFor = ref<Novel | null>(null), renameText = ref(''), renameInput = ref<HTMLInputElement | null>(null)
const coverFor = ref<Novel | null>(null)
const autoCover = computed(() => coverIdOf({ genre: coverFor.value?.genre || '' }))
interface Confirm { title: string; body: string; ok: string; danger?: boolean; run: () => Promise<void> | void }
const confirmState = ref<Confirm | null>(null), cancelBtn = ref<HTMLButtonElement | null>(null)
function ask(c: Confirm) { confirmState.value = c; nextTick(() => cancelBtn.value?.focus()) }

function act(kind: string, book: Novel) {
  menuFor.value = null
  if (kind === 'rename') { renameFor.value = book; renameText.value = book.title; nextTick(() => renameInput.value?.select()) }
  else if (kind === 'cover') coverFor.value = book
  else if (kind === 'archive') { novels.archiveNovel(book.id); toast(`已归档《${book.title}》`) }
  else if (kind === 'unarchive') { novels.unarchiveNovel(book.id); toast(`《${book.title}》已回到书架`) }
  else if (kind === 'restore') ask({ title: '恢复作品', body: `把《${book.title}》从回收站恢复到书架？`, ok: '恢复', run: () => { novels.restoreNovel(book.id); toast('已恢复到书架') } })
  else if (kind === 'trash') ask({ title: '移入回收站', body: `《${book.title}》会从书架隐藏，仍可在回收站恢复。`, ok: '移入回收站', danger: true,
    run: async () => { await novels.deleteNovel(book.id); toast('已移入回收站') } })
  else if (kind === 'purge') ask({ title: '永久删除', body: `将删除《${book.title}》及其章节、数据面板和历史记录，无法恢复。建议先备份项目。`, ok: '永久删除', danger: true,
    run: async () => { await novels.purgeNovel(book.id); toast('已永久删除') } })
}
async function runConfirm() {
  const c = confirmState.value
  if (!c) return
  busy.value = true
  try { await c.run(); confirmState.value = null } catch (e) { toastError(e, '操作没有完成') } finally { busy.value = false }
}
async function confirmRename() {
  const book = renameFor.value, title = renameText.value.trim().replace(/[《》]/g, '')
  if (!book || !title) return
  busy.value = true
  try { await novels.updateTitleWithImpact(book.id, title); renameFor.value = null; toast('书名已修改') }
  catch (e) { toastError(e, '书名保存失败') } finally { busy.value = false }
}
function pickCover(id: string) {
  if (!coverFor.value) return
  novels.setCover(coverFor.value.id, id); coverFor.value = null; toast(id ? '封面已更换' : '已恢复按类型自动匹配')
}

const importInput = ref<HTMLInputElement | null>(null)
async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    if (file.size > MAX_PROJECT_BACKUP_BYTES) throw new Error(`备份文件超过 ${Math.round(MAX_PROJECT_BACKUP_BYTES / 1048576)} MB 安全上限`)
    const backup = parseProjectBackup(await file.text())
    ask({ title: '覆盖本地项目', body: `备份包含 ${backup.novels.length} 本小说和 ${backup.knowledgeBases.length} 个资料库。导入会覆盖当前全部本地数据，建议先备份。`,
      ok: '覆盖并导入', danger: true, run: async () => { await importProject(backup); toast('项目导入成功') } })
  } catch (e) { toastError(e, '无法读取备份文件') }
}
async function exportProject() {
  busy.value = true
  try {
    const backup = await exportProjectSnapshot()
    downloadProjectBackup(backup, `ai-novel-writer-backup-${new Date().toISOString().slice(0, 10)}.json`)
    lastBackup.value = new Date().toISOString()
    try { localStorage.setItem(BACKUP_KEY, lastBackup.value) } catch { /* 仅用于显示 */ }
    toast('项目备份已校验并导出')
  } catch (e) { toastError(e, '备份校验失败') } finally { busy.value = false }
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirmState.value) confirmState.value = null
  else if (coverFor.value) coverFor.value = null
  else if (renameFor.value) renameFor.value = null
  else menuFor.value = null
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  document.addEventListener('click', closeMenu)
  window.addEventListener('keydown', onKey)
  timer = setInterval(() => {
    hello.value = greeting()
    calendarMonth.value = new Date().getMonth() + 1
  }, 60000)
  // 读取各作品的审校与任务状态，用于“待你决定”；已读取过的作品不重复读取
  for (const n of novels.activeNovels.slice(0, 12)) {
    if (Object.prototype.hasOwnProperty.call(workspace.reviewFindingsByNovel, n.id)) continue
    try { await workspace.hydrateFromPersistence(n.id) } catch { /* 提示只是便利，读取失败不影响书架 */ }
  }
})
onBeforeUnmount(() => { document.removeEventListener('click', closeMenu); window.removeEventListener('keydown', onKey); clearInterval(timer) })
</script>

<style scoped>
.page { position: absolute; inset: 0; overflow: auto; }
.page-in { max-width: 1240px; margin: 0 auto; padding: 26px 40px 60px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.eyebrow { font-size: 12px; letter-spacing: .2em; color: var(--zhu); font-weight: 600; }
.hello { font: 600 26px/1.35 var(--f-serif); margin: 4px 0 0; letter-spacing: .06em; }
.head-acts { display: flex; gap: 8px; }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; align-items: start; }

.hero { position: relative; border-radius: var(--r-l); overflow: hidden; min-height: 272px; background: var(--paper); border: 1px solid var(--line); display: flex; }
.hero-img { position: absolute; inset: 0; background-size: cover; background-position: right 40%; }
.hero-img::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, var(--paper) 40%, color-mix(in srgb, var(--paper) 78%, transparent) 58%, transparent 82%); }
[data-theme="dark"] .hero-img { filter: brightness(.5) saturate(.8); }
.hero-c { position: relative; padding: 28px 32px; display: flex; gap: 24px; align-items: flex-start; max-width: 660px; }
.hero-cover { width: 112px; flex: none; aspect-ratio: 2 / 3; border-radius: 3px 6px 6px 3px; background-size: cover; background-position: center; box-shadow: var(--shadow-2), inset 3px 0 0 #ffffff30; transition: transform .3s var(--ease); }
.hero-cover:hover { transform: translateY(-3px); }
.hero-t { min-width: 0; }
.hero-title { font: 600 28px/1.3 var(--f-serif); margin: 6px 0 4px; letter-spacing: .06em; overflow-wrap: anywhere; }
.hero-sub { color: var(--ink-3); font-size: 13px; }
.hero-quote { font: 15px/1.9 var(--f-serif); color: var(--ink-2); margin: 14px 0 18px; padding-left: 12px; border-left: 2px solid var(--zhu-mid); max-width: 440px; }
.hero-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.hero-quote + .hero-acts { margin-top: 0; }
.hero-tags { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.hero-tags .m-tag { background: var(--paper); box-shadow: inset 0 0 0 1px var(--line); }
.hero-tags .m-tag.zhu { background: color-mix(in srgb, var(--zhu) 10%, var(--paper)); }
.empty-hero { padding: 8px 0; }
.empty-hero .m-empty img { width: min(300px, 60%); }
.empty-acts { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; justify-content: center; }

.sec-h { display: flex; align-items: center; justify-content: space-between; margin: 32px 0 16px; gap: 12px; flex-wrap: wrap; }
.sec-h h3 { margin: 0; font: 600 18px var(--f-serif); letter-spacing: .06em; }
.books { display: grid; grid-template-columns: repeat(auto-fill, minmax(164px, 1fr)); gap: 26px 22px; }
.book { position: relative; min-width: 0; }
.cover { display: block; width: 100%; aspect-ratio: 2 / 3; border-radius: 3px 7px 7px 3px; background-size: cover; background-position: center; position: relative;
  box-shadow: var(--shadow-2), inset 4px 0 0 #ffffff26, inset 5px 0 0 #00000020; transition: transform .3s var(--ease), box-shadow .3s; }
.cover:hover { transform: translateY(-4px) rotate(-.4deg); box-shadow: var(--shadow-3), inset 4px 0 0 #ffffff26; }
.tiqian { position: absolute; top: 14px; right: 14px; background: #F8F2E2; color: #1E1C19; padding: 10px 5px; writing-mode: vertical-rl; font: 600 15px/1 var(--f-serif);
  letter-spacing: 4px; border: 1px solid #00000020; box-shadow: inset 0 0 0 2px #F8F2E2, inset 0 0 0 3px #8A1F1222; max-height: 72%; overflow: hidden; }
.badges { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 4px; flex-wrap: wrap; right: 10px; }
.badges span { font-size: 10.5px; padding: 2px 6px; border-radius: 4px; background: #000000a0; color: #fff; backdrop-filter: blur(4px); }
.book-i { padding: 10px 2px 0; position: relative; }
.book-t { display: flex; align-items: center; gap: 4px; font: 600 15px var(--f-serif); letter-spacing: .04em; }
.book-t > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.more { width: 26px; height: 26px; flex: none; }
.book-m { font-size: 12px; color: var(--ink-3); display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; }
.menu { position: absolute; right: 0; top: 36px; z-index: 20; min-width: 160px; background: var(--paper); border: 1px solid var(--line); border-radius: 9px; box-shadow: var(--shadow-3); padding: 5px; animation: m-pop .16s var(--ease); }
.menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border-radius: 6px; font-size: 13px; text-align: left; color: var(--ink-2); }
.menu button:hover { background: var(--panel-2); color: var(--ink); }
.menu .danger { color: var(--zhu); }
.menu .danger:hover { background: var(--zhu-soft); color: var(--zhu); }
.book-new { aspect-ratio: 2 / 3; border-radius: 7px; border: 1.5px dashed var(--line-2); display: grid; place-items: center; align-content: center; gap: 8px; color: var(--ink-3);
  text-align: center; font-size: 13px; text-decoration: none; transition: border-color .2s, color .2s, background .2s; }
.book-new:hover { border-color: var(--zhu); color: var(--zhu); background: var(--zhu-soft); }
.book-new small { color: var(--ink-4); }
.m-art.small { width: min(220px, 50%); }
.calendar-box { padding: 16px; }
.calendar-box :deep(.hm) { width: 100%; overflow-x: auto; }
.calendar-box :deep(.hm-grid) { width: 100%; gap: 2px; }

.box { padding: 16px; margin-bottom: 16px; }
.box h4 { margin: 0 0 12px; font: 600 14px var(--f-serif); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.box h4 .knowledge-manage { background: var(--panel-2); border-color: var(--line); }
.todo { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px dashed var(--line); font-size: 13px; text-decoration: none; align-items: flex-start; line-height: 1.5; }
.todo:last-of-type { border-bottom: 0; }
.todo:hover { color: var(--zhu); }
.todo .icon { margin-top: 1px; }
.todo-d { font-size: 11.5px; color: var(--ink-3); margin-top: 1px; }
.m-empty.compact { padding: 8px 0 4px; }
.m-empty.compact img { width: 150px; }
.lib { display: flex; gap: 10px; align-items: center; padding: 7px 0; font-size: 13px; text-decoration: none; }
.lib:hover { color: var(--zhu); }
.lib i { width: 30px; height: 38px; border-radius: 2px 4px 4px 2px; flex: none; box-shadow: inset 3px 0 0 #ffffff30; }
.box-note { margin: 0; font-size: 12.5px; color: var(--ink-3); line-height: 1.7; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; }
.stats b { display: block; font-size: 19px; color: var(--ink); }
.stats span { font-size: 11.5px; color: var(--ink-3); }

.m-modal.small { width: min(420px, calc(100vw - 48px)); }
.confirm-body { margin: 0; font-size: 13.5px; line-height: 1.75; color: var(--ink-2); }
.covers { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 12px; padding-bottom: 20px; }
.pick { display: grid; gap: 6px; padding: 6px; border-radius: 8px; border: 1.5px solid transparent; text-align: center; }
.pick:hover { background: var(--panel-2); }
.pick.on { border-color: var(--zhu); background: var(--zhu-soft); }
.pc { display: block; aspect-ratio: 2 / 3; border-radius: 3px 5px 5px 3px; background-size: cover; background-position: center; box-shadow: var(--shadow-1); }
.pick small { font-size: 11.5px; color: var(--ink-3); }

@media (max-width: 1180px) { .grid { grid-template-columns: 1fr; } .page-in { padding: 22px 28px 48px; } }
@media (max-width: 720px) { .hero-c { flex-direction: column; } .hero-img::after { background: color-mix(in srgb, var(--paper) 86%, transparent); } }
</style>
