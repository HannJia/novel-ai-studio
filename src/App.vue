<template>
  <n-config-provider class="app-provider" :locale="zhCN" :date-locale="dateZhCN" :theme="isDark ? darkTheme : undefined" :theme-overrides="themeStore.themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell" :inert="projectTransferBusy || appUpdateInstalling || cloudApplyBusy">
          <AppHeader @open-settings="settingsOpen = true" />
          <SaveStatusBar />
          <AppUpdateNotice />
          <main class="main-content">
            <router-view v-slot="{ Component, route }">
              <transition name="page" mode="out-in">
                <keep-alive include="Workspace">
                  <component
                    :is="Component"
                    :key="route.matched[0]?.path === '/workspace/:novelId' ? 'workspace-' + route.params.novelId : route.fullPath"
                  />
                </keep-alive>
              </transition>
            </router-view>
          </main>
        </div>
        <div v-if="projectTransferBusy" class="project-transfer-overlay" role="status">正在安全导入项目，请勿关闭软件…</div>
        <div v-if="appUpdateInstalling" class="project-transfer-overlay" role="status">正在保存并准备安装更新，请勿关闭软件…</div>
        <div v-if="cloudApplyBusy" class="project-transfer-overlay" role="status">正在安全合并云端内容，请勿关闭软件…</div>
        <ExitConfirmDialog />
        <div v-if="settingsOpen" class="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
          <div class="settings-overlay-shell">
            <button class="settings-overlay-close" type="button" title="关闭设置" aria-label="关闭设置" @click="settingsOpen = false">
              <n-icon :size="30"><close-outline /></n-icon>
            </button>
            <div class="settings-overlay-panel">
              <SettingsView :overlay="true" @close="settingsOpen = false" />
            </div>
          </div>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, NIcon, darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { CloseOutline } from '@vicons/ionicons5'
import AppHeader from '@/components/AppHeader.vue'
import SaveStatusBar from '@/components/SaveStatusBar.vue'
import AppUpdateNotice from '@/components/AppUpdateNotice.vue'
import ExitConfirmDialog from '@/components/ExitConfirmDialog.vue'
import SettingsView from '@/views/SettingsView.vue'
import { appUpdateInstalling, cloudApplyBusy } from '@/services/appLifecycle'
import { projectTransferBusy } from '@/services/projectTransfer'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const isDark = themeStore.isDark
const settingsOpen = ref(false)

onMounted(() => {
  themeStore.initTheme()
})
</script>

<style>
.project-transfer-overlay { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: var(--bg-color); color: var(--text-color-primary); padding: 24px; }
.app-shell {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-provider {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.main-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--bg-color) 78%, transparent);
  backdrop-filter: blur(3px);
}

.settings-overlay-shell {
  position: relative;
  width: min(1180px, 100%);
  height: 100%;
}

.settings-overlay-panel {
  height: 100%;
  overflow: auto;
  border: 1px solid var(--border-color-light);
  border-radius: var(--radius-md);
  background: var(--bg-color);
  box-shadow: var(--shadow-lg);
}

.settings-overlay-close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: var(--bg-color-card);
  color: var(--text-color-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-fast);
}

.settings-overlay-close:hover {
  color: var(--color-primary);
  background: var(--bg-color-hover);
  transform: scale(1.05);
}

.settings-overlay-panel .page-container {
  min-height: 100%;
  box-sizing: border-box;
}

@media (max-width: 680px) {
  .settings-overlay { padding: 0; }
  .settings-overlay-shell { width: 100%; }
  .settings-overlay-panel { border: 0; border-radius: 0; }
  .settings-overlay-close { top: 8px; right: 8px; }
}
</style>
