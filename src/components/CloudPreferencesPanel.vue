<template>
  <section class="settings-section paper-panel prefs-panel">
    <div class="prefs-heading">
      <h4>云端配置</h4>
      <span class="prefs-state" :class="{ problem: prefs.error }" role="status">{{ prefs.status }}</span>
    </div>
    <p class="prefs-note">开启后，模型配置、API 密钥和常用设置会随当前云账号自动同步，无需另外设置密码。</p>
    <div class="prefs-controls">
      <label class="prefs-toggle">启用云端配置
        <n-switch :value="prefs.enabled" :disabled="prefs.busy || cloudSync.busy || working" aria-label="启用云端配置" @update:value="value => perform(() => prefs.setEnabled(value))" />
      </label>
      <n-button v-if="prefs.enabled" size="small" :disabled="prefs.busy || cloudSync.busy || working" @click="perform(() => prefs.syncNow())">立即同步配置</n-button>
    </div>
    <p v-if="prefs.supported === false" class="prefs-note">当前云服务暂不支持自动同步配置，本机配置不受影响。</p>
    <p v-if="prefs.error" class="prefs-feedback" role="alert">{{ prefs.error }}</p>
    <p v-if="feedback" class="prefs-feedback" role="alert">{{ feedback }}</p>
    <div v-if="prefs.enabled && prefs.needsLegacyUnlock" class="prefs-action">
      <h5>升级旧版加密备份</h5>
      <p class="prefs-note">当前账号存在使用恢复密码的旧版备份。解锁并升级一次后即可自动同步，无需再次输入恢复密码。升级前将保留原备份。</p>
      <form class="prefs-form" @submit.prevent="migrate">
        <n-input v-model:value="legacyPassword" type="password" show-password-on="click" autocomplete="off" :maxlength="256" aria-label="旧版备份恢复密码" placeholder="旧版备份的恢复密码" />
        <n-button attr-type="submit" :disabled="!legacyPassword || working || prefs.busy || cloudSync.busy">解锁并升级旧备份</n-button>
      </form>
    </div>
    <div v-else-if="prefs.enabled && prefs.conflict" class="prefs-action">
      <p class="prefs-note">本机与云端配置不同，请选择使用哪一份。替换前会自动保存备份。</p>
      <p class="prefs-note">本机 {{ config.models.length }} 个模型 · 云端 {{ remoteModelCount }} 个模型</p>
      <div class="prefs-controls">
        <n-button :disabled="working || prefs.busy || cloudSync.busy" @click="perform(() => prefs.restore(true))">使用云端配置</n-button>
        <n-button :disabled="working || prefs.busy || cloudSync.busy" @click="perform(() => prefs.upload())">使用本机配置</n-button>
      </div>
    </div>
    <n-button v-if="prefs.archiveCount" size="small" class="prefs-export" @click="prefs.exportArchives()">导出加密恢复副本（{{ prefs.archiveCount }}）</n-button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NButton, NInput, NSwitch } from 'naive-ui'
import { useCloudPreferencesStore } from '@/stores/cloudPreferences'
import { useCloudSyncStore } from '@/stores/cloudSync'
import { useConfigStore } from '@/stores/config'
import { parsePreferences } from '@/services/configSync'

const prefs = useCloudPreferencesStore()
const cloudSync = useCloudSyncStore()
const config = useConfigStore()
const working = ref(false)
const feedback = ref('')
const legacyPassword = ref('')
const remoteModelCount = computed(() => prefs.remote ? parsePreferences(prefs.remote.payload).settings.models.length : 0)
watch(() => cloudSync.session?.token, () => { legacyPassword.value = ''; feedback.value = '' })
async function perform(action: () => Promise<unknown>) {
  if (working.value) return
  working.value = true
  feedback.value = ''
  try { await action() }
  catch (cause) { feedback.value = cause instanceof Error ? cause.message : '操作未完成，请稍后重试。' }
  finally { working.value = false }
}
async function migrate() {
  await perform(async () => { await prefs.migrateLegacy(legacyPassword.value); legacyPassword.value = '' })
}
onMounted(() => { void perform(() => prefs.initialize()) })
onUnmounted(() => { legacyPassword.value = '' })
</script>

<style scoped>
.prefs-panel { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border-color-light); }
.prefs-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.prefs-heading h4 { margin: 0; font-size: 14px; }
.prefs-state, .prefs-note { font-size: 12px; color: var(--text-color-secondary); }
.prefs-feedback, .prefs-state.problem { color: var(--color-error); }
.prefs-feedback { font-size: 13px; overflow-wrap: anywhere; margin: 8px 0; }
.prefs-note { line-height: 1.6; margin: 8px 0; overflow-wrap: anywhere; }
.prefs-controls, .prefs-toggle { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.prefs-controls { margin-top: 12px; }
.prefs-toggle { font-size: 13px; }
.prefs-action { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color-light); }
.prefs-action h5 { margin: 0 0 8px; font-size: 13px; }
.prefs-form { display: grid; gap: 12px; margin-top: 12px; max-width: 400px; }
.prefs-export { margin-top: 12px; }
</style>
