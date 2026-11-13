<template>
  <!-- ICONS 是代码内常量，不含外部输入 -->
  <svg class="icon" :class="size" viewBox="0 0 24 24" aria-hidden="true" focusable="false" v-html="ICONS[name]" />
</template>

<script setup lang="ts">
import { ICONS, type IconName } from '../icons'
defineProps<{ name: IconName; size?: 's' | 'l' }>()
</script>

<style scoped>
.icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.icon.s { width: 15px; height: 15px; }.icon.l { width: 22px; height: 22px; }
</style>
