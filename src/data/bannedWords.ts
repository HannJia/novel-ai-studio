// 违禁词分级词库
// 来源：起点/番茄/七猫等平台常见违禁词

export interface BannedWordEntry {
  word: string
  level: 'must' | 'platform' // must=必须规避 platform=平台特有
  category: string
  suggestion?: string // 替换建议
}

// 内置词库（示例，实际使用时可扩展）
export const builtInBannedWords: BannedWordEntry[] = [
  // 政治敏感
  { word: '独裁', level: 'must', category: '政治敏感', suggestion: '专权' },
  { word: '暴政', level: 'must', category: '政治敏感', suggestion: '苛政' },
  { word: '颠覆政权', level: 'must', category: '政治敏感' },
  { word: '分裂国家', level: 'must', category: '政治敏感' },

  // 暴力血腥
  { word: '肢解', level: 'must', category: '暴力血腥', suggestion: '击碎' },
  { word: '虐杀', level: 'must', category: '暴力血腥', suggestion: '击杀' },
  { word: '挖眼', level: 'must', category: '暴力血腥', suggestion: '重创' },
  { word: '剖腹', level: 'must', category: '暴力血腥', suggestion: '腹部重伤' },
  { word: '割喉', level: 'must', category: '暴力血腥', suggestion: '一击毙命' },
  { word: '凌迟', level: 'must', category: '暴力血腥', suggestion: '严刑' },

  // 色情低俗
  { word: '高潮', level: 'platform', category: '色情低俗', suggestion: '巅峰' },
  { word: '呻吟', level: 'platform', category: '色情低俗', suggestion: '低吟' },
  { word: '褪去衣物', level: 'must', category: '色情低俗', suggestion: '换装' },
  { word: '赤裸', level: 'platform', category: '色情低俗', suggestion: '衣衫不整' },

  // 违法犯罪
  { word: '制毒', level: 'must', category: '违法犯罪', suggestion: '炼丹（修仙语境）' },
  { word: '贩毒', level: 'must', category: '违法犯罪' },
  { word: '走私', level: 'platform', category: '违法犯罪', suggestion: '偷运' },
  { word: '黑社会', level: 'must', category: '违法犯罪', suggestion: '帮派' },

  // 封建迷信
  { word: '招魂', level: 'platform', category: '封建迷信', suggestion: '召唤亡灵' },
  { word: '降头', level: 'platform', category: '封建迷信', suggestion: '诅咒' },
  { word: '还魂', level: 'platform', category: '封建迷信', suggestion: '复活' },
  { word: '邪教', level: 'must', category: '封建迷信', suggestion: '魔教' },

  // 平台特有
  { word: '系统', level: 'platform', category: '平台特有', suggestion: '天机（修仙语境）' },
  { word: 'VIP', level: 'platform', category: '平台特有' },
]

// 本地扫描文本中的违禁词
export function scanBannedWords(
  text: string,
  wordList: BannedWordEntry[],
): { word: BannedWordEntry; count: number; positions: number[] }[] {
  const results: { word: BannedWordEntry; count: number; positions: number[] }[] = []

  for (const entry of wordList) {
    const positions: number[] = []
    let idx = text.indexOf(entry.word)
    while (idx !== -1) {
      positions.push(idx)
      idx = text.indexOf(entry.word, idx + 1)
    }
    if (positions.length > 0) {
      results.push({ word: entry, count: positions.length, positions })
    }
  }

  return results.sort((a, b) => {
    // 必须规避排前面
    if (a.word.level !== b.word.level) return a.word.level === 'must' ? -1 : 1
    return b.count - a.count
  })
}
