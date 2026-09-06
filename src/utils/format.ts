export function countNovelWords(text: string): number {
  return text.replace(/\s/g, '').length
}

export function formatWordCount(count: number, suffix = '字'): string {
  if (count >= 10000) {
    return (count / 10000).toFixed(1) + ' 万' + suffix
  }
  return count.toLocaleString() + (suffix ? ' ' + suffix : '')
}
