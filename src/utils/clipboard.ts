/** Browser previews can isolate their clipboard from the desktop host. */
const BROWSER_COPY_TIMEOUT_MS = 1500

function copyWithSelection(value: string): boolean {
  if (!document.body || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, value.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

export async function copyText(value: string): Promise<'system' | 'browser'> {
  if (window.electronAPI?.clipboardWriteText) {
    await window.electronAPI.clipboardWriteText(value)
    return 'system'
  }
  // Keep this synchronous fallback inside the original click gesture. Some
  // embedded browsers leave navigator.clipboard.writeText pending. If we wait
  // for that request to time out first, the browser may revoke the user
  // activation needed by execCommand('copy').
  if (copyWithSelection(value)) return 'browser'
  const writeText = navigator.clipboard?.writeText
  if (writeText) {
    try {
      await Promise.race([
        writeText.call(navigator.clipboard, value),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('浏览器剪贴板请求超时')), BROWSER_COPY_TIMEOUT_MS)),
      ])
      return 'browser'
    } catch {
      // Embedded browsers can leave navigator.clipboard.writeText pending. Use the
      // selection-based browser fallback so the button still completes visibly.
    }
  }
  throw new Error('剪贴板不可用')
}
