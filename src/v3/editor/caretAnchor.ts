interface ScrollViewport {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function caretAnchorScrollTop(
  viewport: ScrollViewport,
  viewportTop: number,
  caretTop: number,
  ratio = 2 / 3,
): number {
  const targetTop = viewportTop + viewport.clientHeight * ratio
  const next = viewport.scrollTop + caretTop - targetTop
  return Math.max(0, Math.min(next, viewport.scrollHeight - viewport.clientHeight))
}
