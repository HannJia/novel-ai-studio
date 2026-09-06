<template>
  <n-config-provider class="app-provider" :theme="isDark ? darkTheme : undefined" :theme-overrides="themeStore.themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell" :inert="projectTransferBusy">
          <AppHeader />
          <SaveStatusBar />
          <main class="main-content">
            <router-view v-slot="{ Component, route }">
              <transition name="page" mode="out-in">
                <keep-alive include="Workspace">
                  <component :is="Component" :key="route.fullPath" />
                </keep-alive>
              </transition>
            </router-view>
          </main>
        </div>
        <div v-if="projectTransferBusy" class="project-transfer-overlay" role="status">正在安全导入项目，请勿关闭软件…</div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme } from 'naive-ui'
import AppHeader from '@/components/AppHeader.vue'
import SaveStatusBar from '@/components/SaveStatusBar.vue'
import { projectTransferBusy } from '@/services/projectTransfer'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const isDark = themeStore.isDark

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
</style>
