<template>
  <section class="cloud-panel cloud-page" id="cloud-sync-panel">
    <div class="cloud-heading">
      <div><h2>云同步</h2><p class="cloud-page-subtitle">在不同设备间继续创作。</p></div>
      <span class="cloud-state" :class="{ problem: sync.error || sync.pendingConflicts.length }" role="status">{{ sync.statusText }}</span>
    </div>
    <p v-if="feedback" class="cloud-feedback" role="alert">{{ feedback }}</p>
    <p v-if="sync.error" class="cloud-feedback" role="alert">{{ sync.error }}</p>
    <template v-if="!sync.session">
      <div class="cloud-auth-card paper-panel">
      <n-radio-group v-model:value="mode" name="cloud-auth-mode" size="small">
        <n-radio-button value="login">登录</n-radio-button>
        <n-radio-button value="register">邀请码注册</n-radio-button>
        <n-radio-button value="recover">恢复账号</n-radio-button>
      </n-radio-group>
      <form class="cloud-form" @submit.prevent="submitAuth">
        <label>账号<n-input v-model:value="username" aria-label="云同步账号" autocomplete="username" :maxlength="32" placeholder="3～32 位字母、数字、下划线或短横线" /></label>
        <label>{{ mode === 'recover' ? '新密码' : '密码' }}<n-input v-model:value="password" aria-label="云同步密码" type="password" show-password-on="click" :maxlength="256" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :placeholder="mode === 'login' ? '密码' : '至少 6 个字符'" /></label>
        <label v-if="mode !== 'login'">确认密码<n-input v-model:value="confirmPassword" aria-label="确认云同步密码" type="password" show-password-on="click" :maxlength="256" autocomplete="new-password" placeholder="再次输入密码" /></label>
        <p v-if="mode !== 'login' && confirmPassword && confirmPassword !== password" class="cloud-feedback" role="alert">两次输入的密码不一致。</p>
        <label v-if="mode === 'register'">邀请码<n-input v-model:value="invite" aria-label="注册邀请码" autocomplete="off" /></label>
        <label v-if="mode === 'recover'">恢复码<n-input v-model:value="recoveryInput" aria-label="账号恢复码" type="password" show-password-on="click" autocomplete="off" /></label>
        <n-button attr-type="submit" type="primary" :loading="working" :disabled="!username.trim() || !password || (mode !== 'login' && (password.length < 6 || password !== confirmPassword))">
          {{ mode === 'login' ? '登录' : mode === 'register' ? '注册账号' : '重置密码' }}
        </n-button>
      </form>
      </div>
    </template>
    <template v-else>
      <section class="cloud-account-card paper-panel"><h3>个人账户</h3>
      <div class="cloud-account"><span class="cloud-account-avatar" aria-hidden="true">{{ sync.session.user.username.slice(0, 1).toUpperCase() }}</span>
        <div><strong>{{ sync.session.user.username }}</strong><span class="cloud-role">{{ sync.session.user.role === 'admin' ? '管理员' : '个人账户' }}</span></div>
        <div class="cloud-controls">
          <n-button size="small" :disabled="sync.busy || working" @click="passwordDialog = true">修改密码</n-button>
          <n-button size="small" :disabled="sync.busy || working" @click="perform(() => sync.logout())">退出登录</n-button>
        </div>
      </div>
      <div class="cloud-quota-track" role="progressbar" aria-label="云端空间已用比例" :aria-valuenow="Math.round(Math.min(100, sync.session.user.usedBytes / Math.max(1, sync.session.user.quotaBytes) * 100))" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: Math.min(100, sync.session.user.usedBytes / Math.max(1, sync.session.user.quotaBytes) * 100) + '%' }"></span></div>
      <div class="cloud-details">
        <span>云端空间 {{ size(sync.session.user.usedBytes) }} / {{ size(sync.session.user.quotaBytes) }}</span>
        <span>上次同步：{{ sync.state.lastSync ? new Date(sync.state.lastSync).toLocaleString('zh-CN') : '尚未同步' }}</span>
      </div>
      </section>
      <section class="cloud-sync-settings paper-panel"><h3>同步设置</h3>
      <div class="cloud-controls">
        <label class="cloud-toggle">自动同步<n-switch :value="sync.state.enabled" :disabled="working || sync.busy" aria-label="自动云同步" @update:value="value => perform(() => sync.setEnabled(value))" /></label>
        <n-button :loading="sync.busy" :disabled="!sync.state.enabled || working" @click="sync.syncNow()">
          <template #icon><n-icon><sync-outline /></n-icon></template>立即同步
        </n-button>
      </div>
      <p class="cloud-note">首次开启先下载云端内容；本机独有作品可选择加入同步。同一内容在多台设备上均有改动时，将保留双方版本。</p>
      <p v-if="sync.pendingDownloads" class="cloud-note">有 {{ sync.pendingDownloads }} 项云端更新等待合并。</p>
      <CloudPreferencesPanel />
      </section>
      <div v-if="sync.pendingUploads?.length" class="cloud-invites cloud-pending paper-panel">
        <h4>待加入同步的内容</h4>
        <p class="cloud-note">未选中的内容继续留在本机，不会自动上传。小说引用的本机知识库也需一起选中。</p>
        <label v-for="item in sync.pendingUploads" :key="item.key" class="cloud-consent">
          <n-checkbox :checked="selectedUploads.includes(item.key)" :disabled="working || sync.busy" @update:checked="value => selectUpload(item.key, value)">{{ kindLabel(item.kind) }}：{{ item.title }}</n-checkbox>
        </label>
        <n-button size="small" :disabled="!sync.state.enabled || !selectedUploads.length || working || sync.busy" @click="perform(async () => { await sync.approveUploads(selectedUploads); selectedUploads = [] })">将所选内容加入云同步</n-button>
      </div>

      <details class="cloud-explanation paper-panel">
        <summary>同步说明</summary>
        <p class="cloud-note">作品同步包含小说、正文版本、剧情规划、资料记忆、书内对话、最近 5 个灵感会话及草稿、知识库。模型配置与 API 密钥可在上方单独开启同步。</p>
        <p class="cloud-note">PDF、图片等原始文件和 OCR 识别缓存仅保存在本机。</p>
        <p class="cloud-note">作品同步不采用端到端加密，云同步服务管理方可访问云端内容。API 密钥在云端加密存储，加密密钥由同步服务管理。</p>
        <p class="cloud-note">请妥善保管账号和恢复码，避免与他人共享账号。</p>
        <p class="cloud-note">可定期导出项目备份，另存一份本机副本。</p>
      </details>
      <div v-if="sync.session.user.role === 'admin'" class="cloud-invites paper-panel">
        <h4>邀请注册</h4>
        <div class="cloud-controls">
          <label class="cloud-toggle">可用次数<n-input-number v-model:value="inviteUses" :min="1" :max="20" aria-label="邀请码使用次数" style="width: 110px" /></label>
          <n-button :loading="working" @click="makeInvite">创建邀请码</n-button>
        </div>
        <div v-if="createdInvite" class="cloud-secret">
          <code>{{ createdInvite }}</code>
          <n-button quaternary circle title="复制邀请码" aria-label="复制邀请码" @click="copy(createdInvite, 'invite')"><template #icon><n-icon><copy-outline /></n-icon></template></n-button>
          <span>7 天内有效</span>
        </div>
        <p v-if="inviteFeedback" role="status" class="cloud-copy-feedback">{{ inviteFeedback }}</p>
      </div>
    </template>
    <div v-if="sync.pendingConflicts.length" class="cloud-conflicts">
      <h4>选择要保留的版本</h4>
      <article v-for="conflict in sync.pendingConflicts" :key="conflict.id" class="cloud-conflict">
        <strong>{{ conflict.title }}</strong>
        <span class="cloud-note">{{ new Date(conflict.createdAt).toLocaleString('zh-CN') }}</span>
        <div class="cloud-versions">
          <div><b>本机版本</b><p>{{ describe(conflict.local) }}</p><n-button size="small" @click="perform(() => sync.exportConflict(conflict.id, 'local'))">导出本机版本</n-button></div>
          <div><b>云端版本</b><p>{{ describe(conflict.remote) }}</p><n-button size="small" @click="perform(() => sync.exportConflict(conflict.id, 'remote'))">导出云端版本</n-button></div>
        </div>
        <div class="cloud-controls">
          <n-button :disabled="sync.busy || working || !sync.session" @click="resolve(conflict.id, 'local')">保留本机版本</n-button>
          <n-button :disabled="sync.busy || working || !sync.session" @click="resolve(conflict.id, 'remote')">采用云端版本</n-button>
        </div>
      </article>
    </div>
    <details v-if="archives.length" class="cloud-archives"><summary>历史版本备份（{{ archives.length }}）</summary>
      <div v-for="conflict in archives" :key="conflict.id" class="cloud-archive">
        <span>{{ conflict.title }} · {{ conflict.resolution === 'superseded' ? '冲突已刷新' : conflict.resolution === 'local' ? '已保留本机版本' : '已采用云端版本' }} · {{ new Date(conflict.createdAt).toLocaleString('zh-CN') }}</span>
        <n-button size="tiny" @click="perform(() => sync.exportConflict(conflict.id, 'local'))">导出本机版本</n-button>
        <n-button size="tiny" @click="perform(() => sync.exportConflict(conflict.id, 'remote'))">导出云端版本</n-button>
      </div>
    </details>
    <n-modal v-model:show="passwordDialog" preset="card" title="修改云同步密码" class="cloud-recovery-modal" :mask-closable="!working" :closable="!working" :close-on-esc="!working">
      <form class="cloud-password-form" @submit.prevent="submitPasswordChange">
        <label>当前密码<n-input v-model:value="currentPassword" aria-label="当前云同步密码" type="password" show-password-on="click" autocomplete="current-password" :maxlength="256" /></label>
        <label>新密码<n-input v-model:value="newPassword" aria-label="新的云同步密码" type="password" show-password-on="click" autocomplete="new-password" :maxlength="256" placeholder="至少 6 个字符" /></label>
        <label>确认新密码<n-input v-model:value="newPasswordConfirmation" aria-label="确认新的云同步密码" type="password" show-password-on="click" autocomplete="new-password" :maxlength="256" /></label>
        <p v-if="newPasswordConfirmation && newPassword !== newPasswordConfirmation" role="alert" class="cloud-feedback">两次输入的密码不一致。</p>
        <p v-if="passwordError" role="alert" class="cloud-feedback">{{ passwordError }}</p>
        <p class="cloud-note">修改后所有设备需重新登录，小说和知识库不受影响，原账号恢复码仍有效。</p>
        <n-button attr-type="submit" type="primary" :loading="working" :disabled="!currentPassword || newPassword.length < 6 || newPassword !== newPasswordConfirmation">确认修改密码</n-button>
      </form>
    </n-modal>
    <n-modal :show="!!recoveryCode" :mask-closable="false" :close-on-esc="false" preset="card" title="账号恢复码" class="cloud-recovery-modal">
      <p>恢复码只显示这一次。忘记密码时可凭它恢复账号，请单独妥善保存，不要发送给他人。</p>
      <div class="cloud-secret"><code>{{ recoveryCode }}</code><n-button quaternary circle title="复制恢复码" aria-label="复制恢复码" @click="copy(recoveryCode, 'recovery')"><template #icon><n-icon><copy-outline /></n-icon></template></n-button></div>
      <p v-if="recoveryFeedback" role="status" class="cloud-copy-feedback">{{ recoveryFeedback }}</p>
      <a v-if="recoveryDownloadUrl" class="cloud-download-fallback" :href="recoveryDownloadUrl" download="云同步账号恢复码.txt" @click="recoveryFeedback = '已开始下载，请查看浏览器下载列表或默认下载目录。'">如果没有自动下载，点此保存</a>
      <template #footer><div class="cloud-controls"><n-button @click="downloadRecovery">下载恢复码</n-button><n-button type="primary" @click="recoveryCode = ''">已妥善保存</n-button></div></template>
    </n-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NIcon, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSwitch, useDialog } from 'naive-ui'
import { CopyOutline, SyncOutline } from '@vicons/ionicons5'
import { useCloudSyncStore } from '@/stores/cloudSync'
import CloudPreferencesPanel from './CloudPreferencesPanel.vue'
import { copyText } from '@/utils/clipboard'

const sync = useCloudSyncStore()
const dialog = useDialog()
const mode = ref<'login' | 'register' | 'recover'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const passwordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirmation = ref('')
const passwordError = ref('')
watch(mode, () => { password.value = ''; confirmPassword.value = ''; feedback.value = '' }, { flush: 'sync' })
watch(passwordDialog, () => { currentPassword.value = ''; newPassword.value = ''; newPasswordConfirmation.value = ''; passwordError.value = '' })
const invite = ref('')
const recoveryInput = ref('')
const recoveryCode = ref('')
const recoveryFeedback = ref('')
const recoveryDownloadUrl = ref('')
const inviteFeedback = ref('')
watch(recoveryCode, value => {
  recoveryFeedback.value = ''
  if (!value && recoveryDownloadUrl.value) {
    URL.revokeObjectURL(recoveryDownloadUrl.value)
    recoveryDownloadUrl.value = ''
  }
})
const working = ref(false)
const selectedUploads = ref<string[]>([])
const kindLabel = (kind: string) => kind === 'novel' ? '小说' : kind === 'knowledge' ? '知识库' : '灵感会话'
function selectUpload(key: string, value: boolean) { selectedUploads.value = value ? [...new Set([...selectedUploads.value, key])] : selectedUploads.value.filter(item => item !== key) }
watch(() => sync.pendingUploads, items => { selectedUploads.value = selectedUploads.value.filter(key => items?.some(item => item.key === key)) })
const feedback = ref('')
const inviteUses = ref<number | null>(1)
const createdInvite = ref('')
const archives = computed(() => sync.conflicts.filter(item => item.resolution))
function size(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MiB` }
function describe(payload: string | null) {
  if (payload === null) return '已删除'
  try {
    const value = JSON.parse(payload)
    if (value.kind === 'novel') return `${value.novel.title || '未命名小说'} · ${value.novel.chapters.length} 章 · ${value.novel.currentWordCount.toLocaleString('zh-CN')} 字 · ${new Date(value.novel.updatedAt).toLocaleString('zh-CN')}`
    if (value.kind === 'inspiration') return `${value.inspiration.title} · ${value.inspiration.messages.length} 条消息${value.inspiration.draft ? ' · 含未发送草稿' : ''}`
    return `${value.knowledge.entries.length} 条资料 · ${value.knowledge.name}`
  } catch { return '已保存的版本' }
}
async function perform(action: () => Promise<unknown>) {
  if (working.value) return
  working.value = true
  feedback.value = ''
  try { await action() }
  catch (cause) { feedback.value = cause instanceof Error ? cause.message : '操作未完成，请重试。' }
  finally { working.value = false }
}
async function submitAuth() {
  await perform(async () => {
    if (mode.value !== 'login' && (password.value.length < 6 || password.value !== confirmPassword.value)) {
      throw new Error('密码至少 6 个字符，且两次输入必须一致。')
    }
    if (mode.value === 'recover') {
      recoveryCode.value = (await sync.recover(username.value.trim(), recoveryInput.value.trim(), password.value)).recoveryCode
      mode.value = 'login'
      recoveryInput.value = ''
      feedback.value = '密码已重置，请使用新密码登录。'
    } else recoveryCode.value = await sync.authenticate(mode.value, username.value.trim(), password.value, invite.value.trim())
    password.value = ''
    confirmPassword.value = ''
    invite.value = ''
  })
}
async function submitPasswordChange() {
  if (working.value) return
  passwordError.value = ''
  if (newPassword.value.length < 6 || newPassword.value !== newPasswordConfirmation.value) {
    passwordError.value = '新密码至少 6 个字符，且两次输入必须一致。'
    return
  }
  working.value = true
  try {
    const account = sync.session?.user.username || ''
    await sync.changePassword(currentPassword.value, newPassword.value)
    passwordDialog.value = false
    mode.value = 'login'
    username.value = account
    password.value = ''
    await Promise.resolve()
    feedback.value = '密码已修改，请使用新密码重新登录。其他设备也需要重新登录。'
  } catch (cause) { passwordError.value = cause instanceof Error ? cause.message : '修改密码失败，请重试。' }
  finally { working.value = false }
}
async function makeInvite() {
  await perform(async () => { createdInvite.value = (await sync.createInvite(inviteUses.value || 1)).code })
}
async function copy(value: string, kind: 'recovery' | 'invite') {
  const result = kind === 'recovery' ? recoveryFeedback : inviteFeedback
  result.value = ''
  try {
    const channel = await copyText(value)
    result.value = channel === 'system' ? '已复制到系统剪贴板。' : '已请求浏览器复制，请粘贴确认。若没有内容，请选中文字后按 Ctrl+C，或下载保存。'
  } catch { result.value = '复制失败，请选中文字后按 Ctrl+C，或下载保存。' }
}
function downloadRecovery() {
  const blob = new Blob([`墨笔生花云同步账号：${username.value.trim()}\n恢复码：${recoveryCode.value}\n请勿向他人提供恢复码。\n`], { type: 'text/plain;charset=utf-8' })
  if (recoveryDownloadUrl.value) URL.revokeObjectURL(recoveryDownloadUrl.value)
  const url = URL.createObjectURL(blob)
  recoveryDownloadUrl.value = url
  const link = document.createElement('a')
  link.href = url
  link.download = '云同步账号恢复码.txt'
  document.body.appendChild(link)
  link.click()
  link.remove()
  recoveryFeedback.value = '已发起下载，请查看浏览器下载列表或默认下载目录。'
  setTimeout(() => {
    if (recoveryDownloadUrl.value !== url) return
    URL.revokeObjectURL(url)
    recoveryDownloadUrl.value = ''
  }, 60000)
}
function resolve(id: string, side: 'local' | 'remote') {
  dialog.warning({ title: side === 'local' ? '保留本机版本？' : '采用云端版本？',
    content: '未采用的版本仍保存在冲突备份中。此操作会决定后续同步采用哪一份内容。',
    positiveText: '确认', negativeText: '取消',
    onPositiveClick: () => perform(() => sync.resolveConflict(id, side)),
  })
}
</script>

<style scoped>
.cloud-heading,.cloud-account,.cloud-controls,.cloud-toggle,.cloud-secret { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.cloud-heading,.cloud-account { justify-content:space-between; }
.cloud-heading h3 { display:flex; align-items:center; gap:8px; margin:0; }
.cloud-panel { min-width:0; }
.cloud-state,.cloud-role,.cloud-note,.cloud-details { font-size:12px; color:var(--ink-2); overflow-wrap:anywhere; }
.cloud-state.problem,.cloud-feedback { color:var(--zhu); }
.cloud-feedback { font-size:13px; overflow-wrap:anywhere; }
.cloud-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:16px; }
.cloud-form label { display:grid; gap:6px; font-size:13px; min-width:0; }
.cloud-password-form,.cloud-password-form label { display:grid; gap:10px; min-width:0; }
.cloud-form > .n-button { justify-self:start; align-self:end; }
.cloud-server { margin-top:14px; font-size:13px; }
summary { cursor:pointer; padding:8px 0; }
.cloud-role { margin-left:10px; }
.cloud-account { margin-top:16px; }
.cloud-details { display:flex; flex-wrap:wrap; gap:8px 20px; margin:10px 0 16px; }
.cloud-consent { display:block; margin-bottom:12px; }
.cloud-toggle { font-size:13px; }
.cloud-note { margin:12px 0; line-height:1.6; }
.cloud-explanation { margin-top:12px; font-size:12px; color:var(--ink-2); }
.cloud-invites,.cloud-conflicts,.cloud-archives { margin-top:20px; padding-top:14px; border-top:1px solid var(--line); }
h4 { font-size:14px; margin:0 0 12px; }
.cloud-secret { margin-top:12px; padding:10px 0; overflow-wrap:anywhere; }
.cloud-secret code { min-width:0; flex:1; word-break:break-all; user-select:all; }
.cloud-secret span { font-size:12px; color:var(--ink-2); }
.cloud-copy-feedback { font-size:12px; line-height:1.6; margin:8px 0 0; overflow-wrap:anywhere; }
.cloud-download-fallback { display:inline-block; margin-top:8px; color:var(--zhu); font-size:12px; text-decoration:underline; }
.cloud-conflict { padding:14px 0; border-bottom:1px solid var(--line); }
.cloud-conflict > strong { display:block; overflow-wrap:anywhere; }
.cloud-versions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin:12px 0; }
.cloud-versions b { font-size:13px; }
.cloud-versions p { font-size:12px; color:var(--ink-2); overflow-wrap:anywhere; }
.cloud-archive { display:flex; flex-wrap:wrap; gap:8px; padding:8px 0; }
.cloud-archive > span { flex:1 1 180px; font-size:12px; overflow-wrap:anywhere; }
:global(.cloud-recovery-modal) { width:min(520px,calc(100vw - 32px)); }
@media (max-width:600px) { .cloud-form,.cloud-versions { grid-template-columns:minmax(0,1fr); } }

.cloud-page { display: flex; flex-direction: column; gap: 20px; padding: 0; }
.cloud-heading { margin-bottom: 4px; }
.cloud-heading h2 { margin: 0; font-size: 30px; }
.cloud-page-subtitle { margin-top: 6px; font-size: 14px; color: var(--ink-2); }
.cloud-account-card, .cloud-sync-settings, .cloud-auth-card { padding: 24px; }
.cloud-account-card > h3, .cloud-sync-settings > h3 { font-size: 21px; margin: 0 0 20px; }
.cloud-account { gap: 16px; }
.cloud-account strong { font-size: 18px; }
.cloud-account > .cloud-controls { margin-left: auto; }
.cloud-account-avatar { width: 48px; height: 48px; display: grid; place-items: center; background: var(--dai); color: var(--on-accent); border-radius: 50%; font-size: 24px; }
.cloud-quota-track { height: 5px; background: var(--panel-2); margin-top: 22px; border-radius: 8px; overflow: hidden; }
.cloud-quota-track > span { display: block; min-width: 2px; height: 100%; background: var(--dai); }
.cloud-details { margin-bottom: 0; justify-content: space-between; }
.cloud-sync-settings > .cloud-controls { justify-content: space-between; }
.cloud-sync-settings .cloud-toggle { flex: 1; justify-content: space-between; padding-right: 20px; }
.cloud-invites.paper-panel { margin-top: 0; padding: 24px; }
.cloud-explanation.paper-panel { margin-top: 0; padding: 8px 20px; }
@media (max-width: 600px) { .cloud-account-card, .cloud-sync-settings, .cloud-auth-card { padding: 18px; } .cloud-account > .cloud-controls { margin-left: 0; } }
</style>
