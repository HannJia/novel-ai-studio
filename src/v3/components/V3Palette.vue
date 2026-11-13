<template>
  <div class="m-pal" @click.self="emit('close')">
    <div class="m-pal-box" role="dialog" aria-modal="true" aria-label="命令面板">
      <div class="m-pal-in"><V3Icon name="search" /><input ref="input" v-model="query" placeholder="输入章节、人物或操作……" autocomplete="off" @keydown="onKey"><span class="m-kbd">Esc</span></div>
      <div class="m-pal-list" role="listbox">
        <template v-for="(it, i) in items" :key="it.key">
          <div v-if="i === 0 || items[i - 1].group !== it.group" class="m-pal-g">{{ it.group }}</div>
          <button type="button" class="m-pal-it" :class="{ on: i === index }" role="option" :aria-selected="i === index" @mouseenter="index = i" @click="run(it)">
            <V3Icon :name="it.icon" size="s" />{{ it.label }}<span class="k">{{ it.hint }}</span>
          </button>
        </template>
        <div v-if="!items.length" class="m-pal-g">没有结果</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import V3Icon from './V3Icon.vue'
import type { IconName } from '../icons'
import type { Novel } from '@/types/novel'
import { useThemeStore, type ThemeName } from '@/stores/theme'
import { areaPath, THEME_LABEL, THEME_ORDER, toast } from '../shell'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'

interface Item { key: string; group: string; icon: IconName; label: string; hint: string; run: () => void }
const props = defineProps<{ book?: Novel }>()
const emit = defineEmits<{ close: []; guide: [] }>()
const router = useRouter(), theme = useThemeStore()
const query = ref(''), index = ref(0), input = ref<HTMLInputElement | null>(null)

const all = computed<Item[]>(() => {
  const b = props.book, go = (path: string) => () => router.push(path)
  const list: Item[] = [
    { key: 'shelf', group: '跳转', icon: 'shelf', label: '书架', hint: '', run: go('/') },
    { key: 'create', group: '跳转', icon: 'plus', label: '新建作品', hint: '', run: go('/create') },
    { key: 'kb', group: '跳转', icon: 'archive', label: '资料库', hint: '书架级', run: go('/knowledge') },
    { key: 'settings', group: '跳转', icon: 'sliders', label: '设置', hint: '', run: go('/settings') },
  ]
  if (b) {
    const t = `《${b.title}》`
    list.push(
      { key: 'b-write', group: '当前作品', icon: 'pen', label: '章节与写作', hint: t, run: go(areaPath('write', b.id)) },
      { key: 'b-plan', group: '当前作品', icon: 'layers', label: '结构与剧情规划', hint: t, run: go(areaPath('plan', b.id)) },
      { key: 'b-codex', group: '当前作品', icon: 'book', label: '人物与典籍', hint: t, run: go(areaPath('codex', b.id)) },
      { key: 'b-data', group: '当前作品', icon: 'grid', label: '数据面板', hint: t, run: go(`/data/${b.id}`) },
      { key: 'b-insp', group: '当前作品', icon: 'bulb', label: '灵感记录', hint: t, run: go(`/inspiration/${b.id}`) },
      { key: 'b-chapters', group: '当前作品', icon: 'file', label: '章节管理', hint: t, run: go(`/chapters/${b.id}`) },
    )
    for (const c of [...b.chapters].sort((x, y) => x.chapterIndex - y.chapterIndex)) {
      list.push({ key: 'c-' + c.id, group: '章节', icon: 'file', label: `第${c.chapterIndex + 1}章 ${chapterTitleForDisplay(c.title, c.chapterIndex, '未命名')}`, hint: `${c.wordCount} 字`, run: go(areaPath('write', b.id, c.id)) })
    }
    for (const p of b.characters) list.push({ key: 'p-' + p.id, group: '人物', icon: 'user', label: p.name, hint: p.identity || '人物', run: go(areaPath('codex', b.id)) })
  }
  for (const name of THEME_ORDER) {
    list.push({ key: 'th-' + name, group: '外观', icon: name === 'dark' ? 'moon' : name === 'eyecare' ? 'leaf' : 'sun', label: '主题：' + THEME_LABEL[name],
      hint: theme.currentTheme === name ? '当前' : '', run: () => switchTheme(name) })
  }
  list.push(
    { key: 'guide', group: '帮助', icon: 'info', label: '使用说明', hint: '', run: () => emit('guide') },
  )
  return list
})
const items = computed(() => {
  const q = query.value.trim().toLowerCase()
  const hit = q ? all.value.filter(it => (it.label + it.hint + it.group).toLowerCase().includes(q)) : all.value.filter(it => it.group !== '章节' && it.group !== '人物')
  return hit.slice(0, q ? 30 : 16)
})
watch(query, () => { index.value = 0 })

function switchTheme(name: ThemeName) {
  try { theme.switchTheme(name); toast('主题：' + THEME_LABEL[name]) } catch { toast('主题偏好无法保存', { error: true }) }
}
function run(it: Item) { emit('close'); it.run() }
function onKey(event: KeyboardEvent) {
  const n = items.value.length
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  else if (event.key === 'ArrowDown' && n) { event.preventDefault(); index.value = (index.value + 1) % n }
  else if (event.key === 'ArrowUp' && n) { event.preventDefault(); index.value = (index.value - 1 + n) % n }
  else if (event.key === 'Enter' && n && !event.isComposing) { event.preventDefault(); run(items.value[index.value]) }
}
onMounted(() => nextTick(() => input.value?.focus()))
</script>
