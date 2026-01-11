/**
 * 字数统计工具
 * 按照项目规范，统计时不包含标点符号
 *
 * 统计规则：
 * ✓ 计入：中文汉字（每字算1）、英文单词（每词算1）、数字（连续数字算1）
 * ✗ 不计入：标点符号、空格、制表符、换行符、特殊符号
 */

/**
 * 判断字符是否为中文汉字
 */
function isChinese(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 0x4e00 && code <= 0x9fff
}

/**
 * 判断字符是否为英文字母
 */
function isEnglishLetter(char: string): boolean {
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/**
 * 判断字符是否为数字
 */
function isDigit(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 48 && code <= 57
}

/**
 * 判断字符是否为标点符号（中英文）
 */
function isPunctuation(char: string): boolean {
  // 中文标点
  const chinesePunctuations = `，。！？；：""''【】（）《》、·…—～`
  // 英文标点
  const englishPunctuations = ',.!?;:\'"[](){}/<>\\|@#$%^&*-_=+`~'
  return chinesePunctuations.includes(char) || englishPunctuations.includes(char)
}

/**
 * 判断字符是否为空白字符
 */
function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

/**
 * 判断字符是否为特殊符号
 */
function isSpecialSymbol(char: string): boolean {
  const specialSymbols = '★☆●○※→←↑↓◆◇■□▲△▼▽♠♣♥♦'
  return specialSymbols.includes(char)
}

/**
 * 统计字数（不含标点）
 * @param text 要统计的文本
 * @returns 字数
 */
export function countWords(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0
  }

  let count = 0
  let inEnglishWord = false
  let inNumber = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (isChinese(char)) {
      // 中文汉字：每字算1
      if (inEnglishWord) {
        inEnglishWord = false
      }
      if (inNumber) {
        inNumber = false
      }
      count++
    } else if (isEnglishLetter(char)) {
      // 英文字母：整个单词算1
      if (!inEnglishWord) {
        inEnglishWord = true
        count++
      }
      if (inNumber) {
        inNumber = false
      }
    } else if (isDigit(char)) {
      // 数字：连续数字算1
      if (!inNumber) {
        inNumber = true
        count++
      }
      if (inEnglishWord) {
        // 如果数字紧跟在英文后面（如test123），不额外计数
        inNumber = false
      }
    } else {
      // 其他字符（标点、空格、符号等）不计入
      inEnglishWord = false
      inNumber = false
    }
  }

  return count
}

/**
 * 详细字数统计结果
 */
export interface WordCountDetail {
  total: number           // 总字数（不含标点）
  chinese: number         // 中文字数
  english: number         // 英文单词数
  numbers: number         // 数字组数
  punctuation: number     // 标点数量（仅统计不计入）
  whitespace: number      // 空白字符数（仅统计不计入）
  other: number           // 其他字符数（仅统计不计入）
}

/**
 * 详细统计字数
 * @param text 要统计的文本
 * @returns 详细统计结果
 */
export function countWordsDetailed(text: string): WordCountDetail {
  const result: WordCountDetail = {
    total: 0,
    chinese: 0,
    english: 0,
    numbers: 0,
    punctuation: 0,
    whitespace: 0,
    other: 0
  }

  if (!text || typeof text !== 'string') {
    return result
  }

  let inEnglishWord = false
  let inNumber = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (isChinese(char)) {
      if (inEnglishWord) inEnglishWord = false
      if (inNumber) inNumber = false
      result.chinese++
    } else if (isEnglishLetter(char)) {
      if (!inEnglishWord) {
        inEnglishWord = true
        result.english++
      }
      if (inNumber) inNumber = false
    } else if (isDigit(char)) {
      if (!inNumber && !inEnglishWord) {
        inNumber = true
        result.numbers++
      }
    } else if (isPunctuation(char)) {
      inEnglishWord = false
      inNumber = false
      result.punctuation++
    } else if (isWhitespace(char)) {
      inEnglishWord = false
      inNumber = false
      result.whitespace++
    } else if (isSpecialSymbol(char)) {
      inEnglishWord = false
      inNumber = false
      result.other++
    } else {
      inEnglishWord = false
      inNumber = false
      result.other++
    }
  }

  result.total = result.chinese + result.english + result.numbers

  return result
}

/**
 * 格式化字数显示
 * @param count 字数
 * @returns 格式化后的字符串
 */
export function formatWordCount(count: number): string {
  if (count >= 10000) {
    return (count / 10000).toFixed(1) + '万'
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k'
  }
  return count.toString()
}

/**
 * 估算阅读时间（分钟）
 * 假设阅读速度：中文400字/分钟
 * @param wordCount 字数
 * @returns 阅读时间（分钟）
 */
export function estimateReadingTime(wordCount: number): number {
  const wordsPerMinute = 400
  return Math.ceil(wordCount / wordsPerMinute)
}

/**
 * 格式化阅读时间显示
 * @param minutes 分钟数
 * @returns 格式化后的字符串
 */
export function formatReadingTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分钟`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) {
    return `${hours}小时`
  }
  return `${hours}小时${remainingMinutes}分钟`
}
