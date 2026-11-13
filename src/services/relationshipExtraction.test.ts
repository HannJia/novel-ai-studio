import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { characterStateFixture } from '@/test/characterStateFixture'
import { requestRelationshipCandidates, validateRelationshipScan } from './relationshipExtraction'
import { callAI } from './ai'
import type { ModelConfig } from '@/stores/config'
vi.mock('./ai', () => ({ callAI: vi.fn() }))
const model: ModelConfig = { id: 'fixture', name: 'fixture', baseUrl: 'https://example.test', modelName: 'fixture', apiKey: 'synthetic', maxTokens: 3000, temperature: 0.2, topP: 1 }
const row = { characterId: 'person-0', targetCharacterId: 'person-1', relation: '信任', evidence: '林澈仍然信任苏禾。' }
beforeEach(() => { setActivePinia(createPinia()); vi.mocked(callAI).mockReset() })
describe('chapter relationship extraction', () => {
  it('covers the end of a long chapter, deduplicates overlap evidence, and leaves author definitions unchanged', async () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content = '雨'.repeat(3050) + row.evidence + '风'.repeat(3400) + '苏禾对林澈仍然心存戒备。'
    const tail = { ...row, characterId: 'person-1', targetCharacterId: 'person-0', relation: '戒备', evidence: '苏禾对林澈仍然心存戒备。' }
    const before = JSON.stringify(novel)
    vi.mocked(callAI).mockImplementation(async options => {
      const body = options.messages[1].content.split('【正文】\n')[1]
      return { content: JSON.stringify([row, tail].filter(item => body.includes(item.evidence))), finishReason: 'stop' }
    })
    const result = await requestRelationshipCandidates({ novel, chapter, model, ensureCurrent() {} })
    expect(callAI).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(2)
    expect(result.every(item => item.status === 'proposed' && item.evidence.length === 1)).toBe(true)
    expect(result[1].evidence[0].quote).toBe(tail.evidence)
    expect(JSON.stringify(novel)).toBe(before)
  })
  it.each([null, {}, [{ ...row, characterId: 'missing' }], [{ ...row, targetCharacterId: 'person-0' }], [{ ...row, evidence: '不存在的引文' }], [{ ...row, relation: '' }]])('rejects malformed or ungrounded rows', rows => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    expect(() => validateRelationshipScan(novel, chapter, rows, chapter.content)).toThrow()
  })
  it('rejects evidence outside the provided segment and ambiguous repeated quotes', () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    expect(() => validateRelationshipScan(novel, chapter, [row], '只有雨声')).toThrow('本段')
    chapter.content += row.evidence
    expect(() => validateRelationshipScan(novel, chapter, [row], chapter.content)).toThrow('唯一定位')
  })
  it.each([{ content: '[', finishReason: 'stop' }, { content: '[]', finishReason: 'length' }])('rejects incomplete responses', async response => {
    const { novel } = characterStateFixture()
    vi.mocked(callAI).mockResolvedValue(response)
    await expect(requestRelationshipCandidates({ novel, chapter: novel.chapters[0], model, ensureCurrent() {} })).rejects.toThrow()
  })
  it('checks cancellation and changed source after a late response before requesting another segment', async () => {
    const { novel } = characterStateFixture(), chapter = novel.chapters[0]
    chapter.content += '雨'.repeat(4000)
    const controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => { controller.abort(); return { content: '[]' } })
    await expect(requestRelationshipCandidates({ novel, chapter, model, signal: controller.signal, ensureCurrent() {} })).rejects.toThrow()
    expect(callAI).toHaveBeenCalledTimes(1)
  })
})
