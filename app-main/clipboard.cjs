// Renderers can only write. Clipboard readback never leaves the main process.
function createClipboardWriter(clipboard, assertSender) {
  return (event, value) => {
    assertSender(event)
    if (typeof value !== 'string' || value.length > 1_000_000) throw new Error('无效的复制内容')
    clipboard.writeText(value, 'clipboard')
    if (clipboard.readText('clipboard') !== value) throw new Error('系统剪贴板未保存复制内容，请重试')
  }
}
module.exports = { createClipboardWriter }
