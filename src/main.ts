import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useNovelStore } from './stores/novel'
import { useConfigStore } from './stores/config'
import { useKnowledgeStore } from './stores/knowledge'
import { initializeAiTaskHistory } from './services/aiTaskQueue'
import { showRecoveryScreen } from './services/recoveryScreen'
import { flushEditorDrafts } from './services/appLifecycle'
import { prepareUpdateInstall } from './services/updateSafety'

// 全局样式
import './styles/variables.css'
import './styles/global.css'

async function bootstrap() {
  const app = createApp(App)

  app.config.errorHandler = (err, _vm, info) => {
    console.error('Vue error:', err, info)
  }

  const pinia = createPinia()
  app.use(pinia)
  app.use(router)

  try {
    const configStore = useConfigStore()
    await configStore.loadConfig()

    const novelStore = useNovelStore()
    await novelStore.initStore()

    const knowledgeStore = useKnowledgeStore()
    await knowledgeStore.initStore()
    void initializeAiTaskHistory().catch(error => console.warn('AI task recovery update failed', error))

    window.electronAPI?.onBeforeClose?.(async () => {
      await flushEditorDrafts()
      await Promise.all([
        novelStore.flushPendingSaves(),
        knowledgeStore.flushPendingSaves(),
        configStore.saveConfig(),
      ])
    })
    window.electronAPI?.onBeforeUpdate?.(prepareUpdateInstall)
  } catch (err) {
    console.error('数据初始化失败:', err)
    showRecoveryScreen(err)
    // No project was mounted or edited, so closing this recovery screen needs
    // no save and must not time out waiting for the normal application handler.
    window.electronAPI?.onBeforeClose?.(() => undefined)
    return
  }

  app.mount('#app')
}

bootstrap()
