<template>
  <header class="app-header" id="app-header">
    <div class="header-left">
      <button class="app-logo" type="button" title="返回书架" aria-label="返回书架" @click="goHome">
        <span class="seal logo-seal" aria-hidden="true">墨</span>
        <span class="logo-text">墨笺</span>
      </button>
      <nav class="header-nav" aria-label="主导航">
        <router-link to="/" class="nav-item" :class="{ 'nav-item--active': isShelf }">
          <n-icon :size="17"><library-outline /></n-icon>
          书架
        </router-link>
        <router-link to="/knowledge" class="nav-item" active-class="nav-item--active">
          <n-icon :size="17"><layers-outline /></n-icon>
          知识库
        </router-link>
      </nav>
    </div>
    <div class="header-right">
      <button v-if="legacyPref" class="header-pill" type="button" title="回到新版界面" @click="useNewUi">新界面</button>
      <button class="header-pill cloud-header-btn" :title="cloud.statusText" :aria-label="cloud.statusText" @click="openCloud">
        <span class="cloud-dot" :class="cloudDotClass" aria-hidden="true" />
        <span class="cloud-header-label">{{ cloud.session ? cloud.statusText : '云同步' }}</span>
      </button>
      <!-- 主题切换 -->
      <div class="theme-switcher" id="theme-switcher" role="group" aria-label="外观主题">
        <button
          v-for="opt in themeOptions"
          :key="opt.name"
          class="theme-btn"
          :class="{ 'theme-btn--active': themeStore.currentTheme === opt.name }"
          :title="`${opt.label}：${opt.description}`"
          :aria-label="opt.label"
          :aria-pressed="themeStore.currentTheme === opt.name"
          @click="themeStore.switchTheme(opt.name)"
        >
          <span class="theme-swatch" :style="{ background: opt.swatch[0], borderColor: opt.swatch[1] }" />
        </button>
      </div>
      <!-- 设置 -->
      <button class="header-icon-btn" title="设置" aria-label="设置" @click="goSettings" id="settings-btn">
        <n-icon :size="19"><settings-outline /></n-icon>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NIcon } from 'naive-ui'
import { SettingsOutline, LibraryOutline, LayersOutline } from '@vicons/ionicons5'
import { useCloudSyncStore } from '@/stores/cloudSync'
import { useThemeStore, themeOptions } from '@/stores/theme'
import { readShellPref, writeShellPref } from '@/v3/shell'

const router = useRouter()
const route = useRoute()
const emit = defineEmits<{
  'open-settings': []
}>()
const themeStore = useThemeStore()
const cloud = useCloudSyncStore()
// 用户主动切回旧界面后，提供回到新界面的入口；新界面是默认界面。
const legacyPref = readShellPref() === 'legacy'
function useNewUi() {
  writeShellPref('v3')
  router.push('/')
}

// 书架、创建向导和书内工作台都归在“书架”下
const isShelf = computed(() => !route.path.startsWith('/knowledge') && route.path !== '/settings')

const cloudDotClass = computed(() => {
  if (cloud.pendingConflicts.length || cloud.error) return 'cloud-dot--error'
  return cloud.session ? 'cloud-dot--on' : 'cloud-dot--off'
})

function openCloud() {
  if (router.currentRoute.value.path === '/settings') return
  emit('open-settings')
}

function goHome() {
  router.push('/')
}

function goSettings() {
  if (router.currentRoute.value.path === '/settings') return
  emit('open-settings')
}
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 20px;
  background: var(--bg-color-header);
  border-bottom: 1px solid var(--border-color);
  backdrop-filter: blur(12px);
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
  z-index: 100;
  transition: background-color var(--transition-normal), border-color var(--transition-normal);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 28px;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font: inherit;
  transition: background-color var(--transition-fast);
}

.app-logo:hover {
  background: var(--bg-color-hover);
}

.logo-seal {
  width: 32px;
  height: 32px;
  font-size: 20px;
}

.logo-text {
  font-family: var(--font-family-serif);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-color-primary);
  white-space: nowrap;
}



.header-nav {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  gap: 4px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--text-color-secondary);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.nav-item:hover {
  color: var(--text-color-primary);
}

.nav-item--active {
  color: var(--color-primary) !important;
  font-weight: 600;
}

.nav-item--active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--color-primary);
}

.header-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 180px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 100px;
  background: var(--bg-color-card);
  color: var(--text-color-secondary);
  font: inherit;
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast);
}

.header-pill:hover {
  border-color: var(--border-color-hover);
  color: var(--text-color-primary);
}

.cloud-header-label {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.cloud-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.cloud-dot--on { background: var(--color-success); }
.cloud-dot--off { background: var(--text-color-disabled); }
.cloud-dot--error { background: var(--color-error); }

/* 主题切换按钮组 */
.theme-switcher {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px;
  border-radius: 100px;
  background: var(--bg-color-secondary);
}

.theme-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 100px;
  background: transparent;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.theme-btn:hover {
  background: var(--bg-color-hover);
}

.theme-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid;
  box-sizing: border-box;
}

.theme-btn--active {
  box-shadow: 0 0 0 1.5px var(--color-primary);
}

.header-icon-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.header-icon-btn:hover {
  color: var(--color-primary);
  background: var(--bg-color-hover);
}

.header-icon-btn:focus-visible,
.app-logo:focus-visible,
.theme-btn:focus-visible,
.header-pill:focus-visible,
.nav-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}



@media (max-width: 850px) {
  .cloud-header-label { display: none; }
  .header-pill { padding: 0 10px; }
}

@media (max-width: 600px) {
  .app-header { padding: 0 10px; }
  .header-nav { gap: 0; }
  .nav-item { gap: 4px; padding: 0 7px; font-size: 12px; }
  .header-left, .header-right { gap: 6px; }
  .logo-text { display: none; }
}
</style>
