type Rect = { left: number; right: number; top: number; bottom: number }
export function placeSelectionToolbar(selection: Rect, bounds: Rect, size: { width: number; height: number }) {
  const maxWidth = Math.max(0, bounds.right - bounds.left)
  const width = Math.min(size.width || 368, maxWidth), height = size.height || 40
  const left = Math.max(bounds.left, Math.min((selection.left + selection.right - width) / 2, bounds.right - width))
  const above = selection.top - height - 10
  const preferredTop = above >= bounds.top ? above : selection.bottom + 10
  const top = Math.max(bounds.top, Math.min(preferredTop, bounds.bottom - height))
  return { maxWidth: maxWidth + 'px', left: left + 'px', top: top + 'px' }
}
