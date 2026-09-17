<template>
  <header class="app-header" id="app-header">
    <div class="header-left">
      <div class="app-logo" @click="goHome">
        <span class="logo-icon">✒️</span>
        <span class="logo-text">AI 写作</span>
      </div>
      <nav class="header-nav">
        <router-link to="/" class="nav-item" active-class="nav-item--active">
          <span class="nav-icon">📚</span>
          我的书架
        </router-link>
      </nav>
    </div>
    <div class="header-right">
      <button class="header-icon-btn cloud-header-btn" :title="cloud.statusText" :aria-label="cloud.statusText" @click="openCloud">
        <n-icon :size="20"><cloud-outline /></n-icon>
        <span class="cloud-header-label">{{ cloud.session ? cloud.statusText : '云同步' }}</span>
        <span v-if="cloud.pendingConflicts.length || cloud.error" class="cloud-header-dot" />
      </button>
      <!-- 主题切换 -->
      <div class="theme-switcher" id="theme-switcher">
        <button
          v-for="opt in themeOptions"
          :key="opt.name"
          class="theme-btn"
          :class="{ 'theme-btn--active': themeStore.currentTheme === opt.name }"
          :title="opt.label"
          @click="themeStore.switchTheme(opt.name)"
        >
          {{ opt.icon }}
        </button>
      </div>
      <!-- 设置 -->
      <button class="header-icon-btn" title="设置" @click="goSettings" id="settings-btn">
        <n-icon :size="20"><settings-outline /></n-icon>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { NIcon } from 'naive-ui'
import { SettingsOutline, CloudOutline } from '@vicons/ionicons5'
import { useCloudSyncStore } from '@/stores/cloudSync'
import { useThemeStore, themeOptions } from '@/stores/theme'

const router = useRouter()
const themeStore = useThemeStore()
const cloud = useCloudSyncStore()
function openCloud() {
  router.push({ path: '/settings', query: { returnTo: router.currentRoute.value.path === '/settings' ? '/' : router.currentRoute.value.fullPath } })
}

function goHome() {
  router.push('/')
}

function goSettings() {
  const returnTo = router.currentRoute.value.fullPath
  router.push(returnTo && returnTo !== '/settings'
    ? { path: '/settings', query: { returnTo } }
    : '/settings')
}
</script>

<style scoped>
.header-icon-btn.cloud-header-btn { position:relative; display:flex; align-items:center; gap:6px; width:144px; min-width:32px; padding:0 8px; }
.cloud-header-label { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.cloud-header-dot { position:absolute; right:3px; top:3px; width:6px; height:6px; border-radius:50%; background:var(--color-error); }
@media (max-width:850px) { .cloud-header-label { display:none; } .header-icon-btn.cloud-header-btn { width:32px; } }
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 20px;
  background: var(--bg-color-header);
  border-bottom: 1px solid var(--border-color-light);
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
  gap: 24px;
  -webkit-app-region: no-drag;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: no-drag;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast);
}

.app-logo:hover {
  background: var(--bg-color-hover);
}

.logo-icon {
  font-size: 22px;
}

.logo-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-primary);
  letter-spacing: 0;
  white-space: nowrap;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 14px;
  color: var(--text-color-secondary);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  text-decoration: none;
}

.nav-item:hover {
  color: var(--text-color-primary);
  background: var(--bg-color-hover);
}

.nav-item--active {
  color: var(--color-primary) !important;
  background: var(--color-primary-light) !important;
  font-weight: 600;
}

.nav-icon {
  font-size: 16px;
}

/* 主题切换按钮组 */
.theme-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--bg-color-secondary);
  border-radius: 100px;
  transition: background-color var(--transition-normal);
}

.theme-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border: none;
  border-radius: 100px;
  background: transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}

.theme-btn:hover {
  background: var(--bg-color-hover);
  transform: scale(1.1);
}

.theme-btn--active {
  background: var(--bg-color-card) !important;
  box-shadow: var(--shadow-sm);
  transform: scale(1.05);
}

.header-icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.header-icon-btn:hover {
  color: var(--text-color-primary);
  background: var(--bg-color-hover);
}
@media (max-width:600px) {
  .app-header { padding:0 10px; }
  .header-nav { display:none; }
  .header-left,.header-right { gap:6px; }
  .app-logo { padding:4px; }
  .header-icon-btn { flex-shrink:0; }
}
</style>
