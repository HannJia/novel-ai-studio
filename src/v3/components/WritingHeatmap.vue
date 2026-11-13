<template>
  <div class="hm">
    <div v-if="props.month" class="month-grid" role="grid" :aria-label="`本月写作日历，本月连续 ${streak} 天`">
      <span v-for="weekday in weekdays" :key="weekday" class="month-weekday" role="columnheader">{{ weekday }}</span>
      <div v-for="day in monthDays" :key="day.key" class="month-day" :class="day.cls" :title="day.inMonth ? day.tip : undefined" role="gridcell" :aria-hidden="!day.inMonth" :aria-label="day.inMonth ? day.tip : undefined">
        {{ day.date.getDate() }}
      </div>
    </div>
    <div v-else class="hm-grid" :style="{ gridTemplateColumns: `22px repeat(${columns.length}, 12px)` }" role="img" :aria-label="`最近 ${weeks} 周写作日历，本周 ${week} 字`">
      <span />
      <span v-for="(col, i) in columns" :key="'m' + i" class="hm-m">{{ col.month }}</span>
      <template v-for="row in 7" :key="'r' + row">
        <span class="hm-w">{{ row === 1 ? '一' : row === 3 ? '三' : row === 5 ? '五' : '' }}</span>
        <span v-for="(col, i) in columns" :key="i + '-' + row" class="hm-c" :class="col.days[row - 1].cls" :title="col.days[row - 1].tip" />
      </template>
    </div>
    <div class="hm-f">
      <span v-if="props.month">本月连续 <b class="m-num">{{ streak }}</b> 天</span>
      <span v-else>本周 <b class="m-num">{{ week.toLocaleString() }}</b> 字 · 连续 <b class="m-num">{{ streak }}</b> 天</span>
      <span class="hm-legend">少<i class="l0" /><i class="l1" /><i class="l2" /><i class="l3" /><i class="l4" />多</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { dayKey, monthStreakDays, streakDays, weekTotal, writingLog } from '../writingLog'

const props = withDefaults(defineProps<{ weeks?: number; month?: boolean }>(), { weeks: 26, month: false })
const week = computed(() => (void writingLog.value, weekTotal()))
const streak = computed(() => (void writingLog.value, props.month ? monthStreakDays() : streakDays()))
const LEVELS = [1, 500, 2000, 5000]
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const monthDays = computed(() => {
  void writingLog.value
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const gridStart = new Date(monthStart)
  gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7))
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)
  const gridEnd = new Date(monthEnd)
  gridEnd.setDate(gridEnd.getDate() + (6 - ((gridEnd.getDay() + 6) % 7)))
  const days: Array<{ key: string; date: Date; inMonth: boolean; cls: string; tip: string }> = []
  for (const date = new Date(gridStart); date <= gridEnd; date.setDate(date.getDate() + 1)) {
    const currentDate = new Date(date)
    const key = dayKey(currentDate)
    const outside = currentDate.getMonth() !== today.getMonth() || currentDate.getFullYear() !== today.getFullYear()
    const isToday = key === dayKey(today)
    if (outside) {
      // Fill the aligned grid with adjacent-month dates without exposing their writing heat.
      days.push({ key: `adjacent-${key}`, date: currentDate, inMonth: false, cls: 'adjacent', tip: '' })
      continue
    }
    const entry = writingLog.value[key]
    const total = entry?.total || 0
    const level = total >= LEVELS[3] ? 4 : total >= LEVELS[2] ? 3 : total >= LEVELS[1] ? 2 : total >= LEVELS[0] ? 1 : 0
    const label = `${currentDate.getMonth() + 1}月${currentDate.getDate()}日`
    const detail = currentDate > today
      ? '尚未到来'
      : total
        ? `${total.toLocaleString()} 字（作者 ${(total - (entry?.ai || 0)).toLocaleString()} · 采纳 AI ${(entry?.ai || 0).toLocaleString()}）`
        : '未写作'
    days.push({ key, date: currentDate, inMonth: true, cls: `l${level}${isToday ? ' today' : ''}`, tip: `${label} · ${detail}` })
  }
  return days
})
const columns = computed(() => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const currentMonth = today.getMonth(), currentYear = today.getFullYear()
  const start = props.month ? new Date(currentYear, currentMonth, 1) : new Date(today)
  if (props.month) start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  else start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (props.weeks - 1) * 7)
  const end = props.month ? new Date(currentYear, currentMonth + 1, 0) : undefined
  if (end) end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)))
  const count = props.weeks
  const cols: Array<{ month: string; days: Array<{ cls: string; tip: string }> }> = []
  for (let w = 0; w < count; w++) {
    const days: Array<{ cls: string; tip: string }> = []
    let month = ''
    for (let d = 0; d < 7; d++) {
      const date = new Date(start); date.setDate(start.getDate() + w * 7 + d)
      if (date.getDate() <= 7 && d === 0 && (!props.month || date.getMonth() === currentMonth)) month = `${date.getMonth() + 1}月`
      if (props.month && date.getMonth() !== currentMonth) { days.push({ cls: 'outside', tip: '' }); continue }
      if (date > today) {
        days.push({ cls: props.month ? 'l0' : 'fut', tip: props.month ? `${date.getMonth() + 1}月${date.getDate()}日 · 尚未到来` : '' })
        continue
      }
      const e = writingLog.value[dayKey(date)], n = e?.total || 0
      const lvl = n >= LEVELS[3] ? 4 : n >= LEVELS[2] ? 3 : n >= LEVELS[1] ? 2 : n >= LEVELS[0] ? 1 : 0
      const label = `${date.getMonth() + 1}月${date.getDate()}日`
      days.push({ cls: 'l' + lvl, tip: n ? `${label} · ${n.toLocaleString()} 字（作者 ${(n - (e?.ai || 0)).toLocaleString()} · 采纳 AI ${(e?.ai || 0).toLocaleString()}）` : `${label} · 未写作` })
    }
    cols.push({ month, days })
  }
  return cols
})
</script>

<style scoped>
.hm-grid { display: grid; grid-auto-rows: 12px; gap: 3px; overflow-x: auto; padding-bottom: 2px; }
.month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: 32px; gap: 2px; }
.month-weekday { display: grid; place-items: center; color: var(--ink-4); font-size: 11px; }
.month-day { display: grid; place-items: center; min-width: 0; border-radius: 4px; color: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.month-day.l0 { background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line); }
.month-day.l1 { background: color-mix(in srgb, var(--zhu) 22%, var(--paper)); }
.month-day.l2 { background: color-mix(in srgb, var(--zhu) 45%, var(--paper)); }
.month-day.l3 { background: color-mix(in srgb, var(--zhu) 70%, var(--paper)); color: var(--ink); }
.month-day.l4 { background: var(--zhu); color: var(--paper); }
.month-day.today { box-shadow: inset 0 0 0 1.5px var(--zhu); }
.month-day.adjacent { background: transparent; box-shadow: none; color: var(--ink-4); opacity: .45; pointer-events: none; }
.hm-m { font-size: 10px; color: var(--ink-4); line-height: 12px; white-space: nowrap; overflow: visible; }
.hm-w { font-size: 10px; color: var(--ink-4); line-height: 12px; }
.hm-c { width: 12px; height: 12px; justify-self: center; border-radius: 3px; }
.l0 { background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--line); }
.l1 { background: color-mix(in srgb, var(--zhu) 22%, var(--paper)); }
.l2 { background: color-mix(in srgb, var(--zhu) 45%, var(--paper)); }
.l3 { background: color-mix(in srgb, var(--zhu) 70%, var(--paper)); }
.l4 { background: var(--zhu); }
.fut { background: transparent; }
.outside { background: transparent; }
.hm-f { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; font-size: 12px; color: var(--ink-3); flex-wrap: wrap; }
.hm-f b { color: var(--ink); }
.hm-legend { display: flex; align-items: center; gap: 3px; }
.hm-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
</style>
