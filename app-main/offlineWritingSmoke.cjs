// Packaged acceptance only. Every input and output stays inside the isolated smoke profile.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

exports.run = async (window, profile, mode) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(profile, 'offline-writing-fixture.json'), 'utf8'))
  const book = fixture.novels[0], chapter = book.chapters[6]
  assert(book && chapter && chapter.status !== 'locked')
  const marker = '离线安装验收：灯芯已修好，账册已核对。'
  let blockedRequests = 0
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => {
    blockedRequests++; callback({ cancel: true })
  })
  window.showInactive()
  if (mode !== 'verify') await window.webContents.executeJavaScript(`(async () => {
    const current = await window.electronAPI.projectRequest({method:'read'});
    const result = await window.electronAPI.projectRequest({method:'commit',baseRevision:current.value.revision,backup:${JSON.stringify(fixture)}});
    if(!result.ok) throw new Error(result.error.message);
    localStorage.setItem('mojian-v3-guide-seen','1');
  })()`)
  const destination = window.webContents.getURL().split('#')[0] + '#/write/' + book.id + '/' + chapter.id
  const reload = async () => {
    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve))
    window.webContents.reload()
    await loaded
  }
  await reload()
  await window.webContents.executeJavaScript(`(async () => {
    for(let i=0;i<300&&!document.querySelector('#app .v3');i++) await new Promise(r=>setTimeout(r,50));
    location.hash=${JSON.stringify('#/write/' + book.id + '/' + chapter.id)};
  })()`)
  const waitEditor = async () => window.webContents.executeJavaScript(`(async () => {
    for(let i=0;i<300;i++) { if(document.querySelector('.ProseMirror[contenteditable="true"]')) return; await new Promise(r=>setTimeout(r,50)); }
    throw new Error('Installed editor not ready: '+document.body.innerText.slice(0,600));
  })()`)
  await waitEditor()
  if (mode !== 'verify') {
  await window.webContents.executeJavaScript(`(() => {
    const editor=document.querySelector('.ProseMirror[contenteditable="true"]'); editor.focus();
    const range=document.createRange(); range.selectNodeContents(editor);range.collapse(false);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  })()`)
  await window.webContents.insertText(marker)
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="保存正文"]').click()`)
  }
  const persisted = await window.webContents.executeJavaScript(`(async () => {
    for(let i=0;i<200;i++) { const result=await window.electronAPI.projectRequest({method:'read'});
      const chapter=result.value?.backup?.novels.find(n=>n.id===${JSON.stringify(book.id)})?.chapters.find(c=>c.id===${JSON.stringify(chapter.id)});
      if(chapter?.content.includes(${JSON.stringify(marker)})) return true; await new Promise(r=>setTimeout(r,50)); }
    throw new Error('Installed editor failed to persist typed text');
  })()`)
  await reload()
  await waitEditor()
  const reopened = await window.webContents.executeJavaScript(`document.querySelector('.ProseMirror').textContent.includes(${JSON.stringify(marker)})`)
  assert(persisted && reopened)
  await window.webContents.executeJavaScript('document.fonts.ready')
  await new Promise(resolve => setTimeout(resolve, 200))
  fs.writeFileSync(path.join(profile, 'offline-writing.png'), (await window.webContents.capturePage()).toPNG())
  return { persisted, reopened, networkBlocked: true, blockedRequests, cloudWrites: 0, chapterId: chapter.id }
}
