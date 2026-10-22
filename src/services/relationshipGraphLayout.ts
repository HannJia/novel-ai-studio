export interface GraphBox { x: number; y: number; width: number; height: number }
export interface GraphPoint { x: number; y: number }

export function boxesOverlap(a: GraphBox, b: GraphBox, padding = 6) {
  return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y
}

export function fitGraphText(text: string, maxWidth: number, measure: (text: string) => number) {
  if (measure(text) <= maxWidth) return text
  const chars = Array.from(text)
  while (chars.length && measure(chars.join('') + '…') > maxWidth) chars.pop()
  return chars.length ? chars.join('') + '…' : ''
}

// Reserve portraits and node captions before placing any relationship label.
// Omit crowded labels; the complete relationships remain in character details.
export function placeGraphLabel(from: GraphPoint, to: GraphPoint, width: number, occupied: GraphBox[], bounds: GraphPoint): GraphBox | undefined {
  const dx = to.x - from.x, dy = to.y - from.y
  const distance = Math.hypot(dx, dy) || 1
  for (const fraction of [0.5, 0.35, 0.65]) {
    for (const offset of [-12, 14, -34, 36]) {
      const box = { x: from.x + dx * fraction - dy / distance * offset - width / 2,
        y: from.y + dy * fraction + dx / distance * offset - 10, width, height: 20 }
      if (box.x < 8 || box.y < 8 || box.x + box.width > bounds.x - 8 || box.y + box.height > bounds.y - 8) continue
      if (!occupied.some(other => boxesOverlap(box, other))) return box
    }
  }
}
