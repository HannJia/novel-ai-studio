<template>
  <Teleport defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link>
    <span class="crumb-sep">/</span>
    <span class="crumb-b">设置</span>
  </Teleport>
  <div class="settings-page">
    <SettingsViewLegacy />
  </div>
</template>

<script setup lang="ts">
import SettingsViewLegacy from '@/views/SettingsView.vue'
defineOptions({ name: 'V3SettingsView' })
</script>

<style scoped>
.settings-page { position: absolute; inset: 0; overflow: auto; padding: 30px 42px 60px; background: var(--bg); }
.settings-page :deep(#settings-page) { min-height: 100%; padding: 0; background: transparent; }
.settings-page :deep(.settings-layout) { min-height: calc(100vh - 120px); }
.crumb-link { color: var(--ink-3); text-decoration: none; }.crumb-link:hover { color: var(--zhu); }
.crumb-sep { margin: 0 7px; color: var(--ink-4); }
@media (max-width: 680px) { .settings-page { padding: 16px 12px 40px; } }
</style>
