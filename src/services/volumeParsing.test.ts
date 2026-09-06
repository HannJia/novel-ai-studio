import { describe, expect, it } from 'vitest'
import { parseVolumeEstimates, parseVolumesFromText } from './volumeParsing'

describe('shared volume parsing', () => {
  it('reads the bold estimates from the reported screenshot, not the old 20 chapter fallback', () => {
    const volumes = parseVolumesFromText(`## 分卷建议
### 第一卷：下海（1992-1996）
**主题：** 从零到一、原始积累与道德灰色
**关键事件：**
- 辞职风波，夫妻矛盾初现
**预估章节数：** 约97章
**预估字数：** 约21.3万字
### 第二卷：远航
**预估章节数和字数**：约80章，约18万字
## 预估总字数分配
全书共200万字。`)
    expect(volumes).toHaveLength(2)
    expect(volumes[0]).toMatchObject({ estimatedChapters: 97, estimatedWordCount: 21.3, theme: '从零到一、原始积累与道德灰色' })
    expect(volumes[0].summary).not.toContain('预估章节数')
    expect(volumes[1]).toMatchObject({ estimatedChapters: 80, estimatedWordCount: 18 })
    expect(volumes[1].summary).not.toContain('全书共200')
  })

  it('handles title estimates, raw word counts and missing values', () => {
    expect(parseVolumeEstimates('第一卷（约67章）（约15万字）')).toEqual({ estimatedChapters: 67, estimatedWordCount: 15 })
    expect(parseVolumeEstimates('预估字数：213000字')).toMatchObject({ estimatedWordCount: 21.3 })
    expect(parseVolumesFromText('## 第一卷：出发\n尚未确定篇幅')[0]).toMatchObject({ estimatedChapters: 0, estimatedWordCount: 0 })
  })
})
