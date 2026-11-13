/** Select a verified UTF-16 range and scroll wrapped textarea lines into view. */
export function revealTextRange(textarea: HTMLTextAreaElement, start: number, end: number): void {
  textarea.focus({ preventScroll: true })
  textarea.setSelectionRange(start, end)
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'tab-size', 'text-indent']) {
    mirror.style.setProperty(property, style.getPropertyValue(property))
  }
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '0',
    width: textarea.clientWidth + 'px', boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
  mirror.append(document.createTextNode(textarea.value.slice(0, start)))
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(start, end) || '\u200b'
  mirror.append(marker)
  document.body.append(mirror)
  try {
    const top = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top
    textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 3)
  } finally { mirror.remove() }
  textarea.dispatchEvent(new Event('scroll'))
}
