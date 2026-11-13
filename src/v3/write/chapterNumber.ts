// 章号的中文写法，用于稿纸章头（“第 四 十 二 章”）。只做展示，不参与任何存储或排序。
const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const UNITS = ['', '十', '百', '千']

/** 1 → 一，10 → 十，12 → 十二，42 → 四十二，100 → 一百，101 → 一百零一，1000 → 一千。 */
export function chineseNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10000) return String(value)
  if (value === 0) return DIGITS[0]
  const digits = String(value).split('').map(Number)
  let out = '', pendingZero = false
  digits.forEach((digit, index) => {
    const unit = UNITS[digits.length - 1 - index]
    if (digit === 0) { pendingZero = out !== ''; return }
    if (pendingZero) out += DIGITS[0]
    pendingZero = false
    out += DIGITS[digit] + unit
  })
  // 十位开头的 10–19 读作“十”“十二”，而不是“一十”“一十二”。
  return out.startsWith('一十') && value < 20 ? out.slice(1) : out
}

/** 章头显示的“第 四 十 二 章”：数字逐字拆开，与原型的稿纸章头一致。 */
export function chapterHeading(chapterIndex: number): string {
  return `第 ${chineseNumber(chapterIndex + 1).split('').join(' ')} 章`
}

/** Hides a chapter-number prefix when the surrounding UI already shows that chapter number. */
export function chapterTitleForDisplay(title: string, chapterIndex: number, fallback = '未命名章节'): string {
  const value = title.trim()
  if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0) return value || fallback

  const number = chapterIndex + 1
  const forms = [String(number), chineseNumber(number), chineseNumber(number).split('').join(' ')]
  const escaped = forms.map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const prefix = new RegExp(`^第\\s*(?:${escaped.join('|')})\\s*章\\s*(?:[：:、·.．-]\\s*)?`)
  return value.replace(prefix, '').trim() || fallback
}
