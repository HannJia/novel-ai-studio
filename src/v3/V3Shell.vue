<template>
  <div class="v3 shell" :class="{ writing: area === 'write' && !route.meta.bookTool }">
    <nav class="rail" aria-label="主导航">
      <router-link to="/" class="rail-seal" title="墨笔生花 · 回到书架" aria-label="墨笔生花，回到书架"><img :src="mojianIcon" alt="墨笔生花" /></router-link>
      <router-link to="/" class="rail-btn" :class="{ on: area === 'shelf' }"><V3Icon name="shelf" size="l" /><span>书架</span></router-link>
      <router-link :to="{ path: '/settings', query: { section: 'cloud' } }" class="rail-btn"
        :class="{ on: route.path === '/settings' && route.query.section === 'cloud' }" title="云同步设置">
        <V3Icon name="cloud" size="l" /><span>云同步</span>
      </router-link>
      <router-link v-for="it in BOOK_AREAS" :key="it.area" :to="book ? areaPath(it.area, book.id) : '/'" class="rail-btn"
        :class="{ on: area === it.area }" :aria-disabled="!book" :title="book ? `${it.label} ·《${book.title}》` : '先在书架打开一部作品'">
        <V3Icon :name="it.icon" size="l" /><span>{{ it.label }}</span>
        <span v-if="it.area === 'auto' && autoRunning" class="rail-dot live" aria-label="自动写作运行中" />
      </router-link>
      <div class="rail-sp" />
      <button type="button" class="rail-btn" @click="guideOpen = true"><V3Icon name="info" size="l" /><span>说明</span></button>
      <button type="button" class="rail-btn" :title="`切换主题（当前：${THEME_LABEL[theme.currentTheme]}）`" @click="cycleTheme">
        <V3Icon :name="themeIcon" size="l" /><span>{{ THEME_LABEL[theme.currentTheme] }}</span>
      </button>
      <button type="button" class="rail-btn" @click="openSettings"><V3Icon name="sliders" size="l" /><span>设置</span></button>
      <button type="button" class="rail-ver" :title="updateTitle" @click="appUpdate.detailsOpen = true">v{{ appUpdate.state.currentVersion }}</button>
    </nav>

    <header class="top">
      <div id="v3-crumb" class="top-crumb" />
      <div id="v3-lifecycle" class="top-lifecycle" />
      <div class="top-sp" />
      <div id="v3-tools" class="top-tools" />
      <button type="button" class="cmdk" aria-label="命令面板" @click="paletteOpen = true">
        <V3Icon name="search" size="s" /><span>搜索章节、人物、操作</span><span class="m-kbd">Ctrl K</span>
      </button>
      <div id="v3-view-tools" class="top-view-tools" />
    </header>

    <main class="main">
      <div v-if="saveErrorText" class="save-banner" role="alert">
        <span>保存未完成：{{ saveErrorText }}。请勿退出；可重试，或在书架导出项目备份。</span>
        <button type="button" class="m-btn sm" :disabled="retrying" @click="retrySave">{{ retrying ? '正在重试…' : '重试保存' }}</button>
      </div>
      <AppUpdateNotice />
      <div class="route">
        <router-view v-slot="{ Component, route: r }">
          <component :is="Component" :key="r.path" />
        </router-view>
      </div>
    </main>

    <footer class="status">
      <div id="v3-status" class="status-l" />
      <div class="top-sp" />
      <button v-if="running.length" type="button" class="status-it" :title="running.map(a => a.name).join('、')" @click="openAiActivity(running[0])">
        <i class="busy" />AI 任务 {{ running.length }}
      </button>
      <span class="status-it" :title="saveErrorText || ''"><i :class="saveErrorText ? 'warn' : saving ? 'busy' : 'ok'" />{{ saveErrorText ? '保存失败' : saving ? '正在保存' : '已保存' }}</span>
      <button type="button" class="status-it" :title="cloud.statusText" @click="openCloudSettings">
        <V3Icon name="cloud" size="s" />{{ cloud.session ? cloud.statusText : '云同步未开启' }}
      </button>
    </footer>

    <div class="m-toasts" aria-live="polite">
      <div v-for="t in toasts" :key="t.id" class="m-toast" :class="{ err: t.error }"><V3Icon :name="t.error ? 'alert' : 'check'" size="s" />{{ t.text }}</div>
    </div>
    <V3Palette v-if="paletteOpen" :book="book" @close="paletteOpen = false" @guide="guideOpen = true" />
    <V3Guide v-if="guideOpen" @close="closeGuide" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import V3Icon from './components/V3Icon.vue'
import V3Palette from './components/V3Palette.vue'
import V3Guide from './components/V3Guide.vue'
import AppUpdateNotice from '@/components/AppUpdateNotice.vue'
import type { IconName } from './icons'
import type { Novel } from '@/types/novel'
import { areaPath, nextTheme, paletteOpen, recalledBook, THEME_LABEL, toast, toasts, type BookArea } from './shell'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useInspirationSessionsStore } from '@/stores/inspirationSessions'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useCloudSyncStore } from '@/stores/cloudSync'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { openAiActivity, useAiActivities } from '@/services/aiActivity'
import mojianIcon from '@/assets/v3/mojian-icon.svg'

const BOOK_AREAS: Array<{ area: BookArea; icon: IconName; label: string }> = [
  { area: 'write', icon: 'pen', label: '写作' }, { area: 'plan', icon: 'layers', label: '结构' }, { area: 'codex', icon: 'book', label: '典籍' },
  { area: 'review', icon: 'stamp', label: '审校' }, { area: 'auto', icon: 'bolt', label: '自动' },
]
const GUIDE_KEY = 'mojian-v3-guide-seen'

const route = useRoute(), router = useRouter()
const novels = useNovelStore(), knowledge = useKnowledgeStore(), inspiration = useInspirationSessionsStore()
const config = useConfigStore(), theme = useThemeStore(), cloud = useCloudSyncStore(), appUpdate = useAppUpdateStore()
const workspace = useReconstructionWorkspaceStore()
const { runningActivities: running } = useAiActivities()

const area = computed(() => route.meta.area)
const book = computed(() => {
  const id = typeof route.params.novelId === 'string' ? route.params.novelId : ''
  const pick = (value: string) => value ? novels.getNovel(value) : undefined
  const open = (n?: Novel) => n && n.status !== 'trash' ? n : undefined
  return open(pick(id)) || open(pick(recalledBook())) || [...novels.activeNovels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
})
const autoRunning = computed(() => !!book.value && workspace.getAiRuns(book.value.id).some(run => run.status === 'running'))
const themeIcon = computed<IconName>(() => ({ fanqie: 'sun', eyecare: 'leaf', dark: 'moon' } as const)[theme.currentTheme])
const updateTitle = computed(() => appUpdate.state.release && appUpdate.state.phase !== 'unsupported' ? `发现新版本 ${appUpdate.state.release.version}` : '软件更新')
const saveErrorText = computed(() => [novels.saveError, knowledge.saveError, inspiration.saveError].filter(Boolean).join('；'))
const saving = computed(() => novels.saving || novels.hasPendingSaves)
function openSettings() { void router.push('/settings') }
function openCloudSettings() { void router.push({ path: '/settings', query: { section: 'cloud' } }) }
const retrying = ref(false)
async function retrySave() {
  retrying.value = true
  try { await Promise.all([novels.flushPendingSaves(), knowledge.flushPendingSaves(), inspiration.flushPendingSaves()]) }
  catch { /* 错误保留在 Store 中，横幅继续显示 */ }
  finally { retrying.value = false }
}

function cycleTheme() {
  const next = nextTheme(theme.currentTheme)
  try { theme.switchTheme(next); toast('主题：' + THEME_LABEL[next]) } catch { toast('主题偏好无法保存', { error: true }) }
}

const guideOpen = ref(false)
function closeGuide() {
  guideOpen.value = false
  try { localStorage.setItem(GUIDE_KEY, '1') } catch { /* 下次仍会提示 */ }
}

function onKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  let seen = false
  try { seen = localStorage.getItem(GUIDE_KEY) === '1' } catch { /* 视为未看过 */ }
  if (!seen && !config.models.length && !novels.novels.length) guideOpen.value = true
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
