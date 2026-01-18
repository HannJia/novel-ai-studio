/**
 * 字数统计工具单元测试
 * 测试 countWords 函数的各种场景
 */

import { describe, it, expect } from 'vitest'
// import { countWords, countWordsDetailed } from '@/utils/wordCount'

// 模拟的字数统计函数（待导入实际函数）
function countWords(text: string): number {
  if (!text) return 0

  // 移除标点符号
  const noPunctuation = text.replace(/[，。！？；：""''【】（）、…—·《》「」『』\s\n\r\t,.!?;:'"()\[\]{}]/g, '')

  let count = 0
  let i = 0

  while (i < noPunctuation.length) {
    const char = noPunctuation[i]

    // 中文字符
    if (/[\u4e00-\u9fa5]/.test(char)) {
      count++
      i++
    }
    // 英文单词
    else if (/[a-zA-Z]/.test(char)) {
      while (i < noPunctuation.length && /[a-zA-Z]/.test(noPunctuation[i])) {
        i++
      }
      count++
    }
    // 数字
    else if (/[0-9]/.test(char)) {
      while (i < noPunctuation.length && /[0-9]/.test(noPunctuation[i])) {
        i++
      }
      count++
    }
    else {
      i++
    }
  }

  return count
}

describe('wordCount', () => {
  describe('countWords', () => {
    it('应该正确统计纯中文字数', () => {
      expect(countWords('你好世界')).toBe(4)
      expect(countWords('这是一个测试文本')).toBe(8)
    })

    it('应该正确统计带标点的中文', () => {
      expect(countWords('你好，世界！')).toBe(4)
      expect(countWords('这是一个测试，包含标点符号。')).toBe(12)
    })

    it('应该正确统计英文单词', () => {
      expect(countWords('Hello World')).toBe(2)
      expect(countWords('This is a test')).toBe(4)
    })

    it('应该正确统计中英混合文本', () => {
      expect(countWords('你好Hello世界World')).toBe(4)
      expect(countWords('这是一个test测试')).toBe(6)
    })

    it('应该正确统计数字', () => {
      expect(countWords('12345')).toBe(1)
      expect(countWords('第1章 第2节')).toBe(4)
    })

    it('应该忽略空白字符', () => {
      expect(countWords('你好  世界')).toBe(4)
      expect(countWords('Hello   World')).toBe(2)
      expect(countWords('测试\n换行\t制表')).toBe(4)
    })

    it('应该正确处理空字符串', () => {
      expect(countWords('')).toBe(0)
      expect(countWords('   ')).toBe(0)
    })

    it('应该正确处理特殊标点', () => {
      expect(countWords('「你好」')).toBe(2)
      expect(countWords('《书名》')).toBe(2)
      expect(countWords('——破折号——')).toBe(3)
    })
  })
})
