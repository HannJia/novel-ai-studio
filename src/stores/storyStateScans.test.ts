import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from './novel'
import { useStoryStateScansStore } from './storyStateScans'
import type { ModelConfig } from './config'
import { callAI } from '@/services/ai'
import * as repository from '@/services/storyAggregate'

vi.mock('@/services/ai', () => ({ callAI: vi.fn() }))
const model = { id: 'state-test', modelName: 'synthetic' } as ModelConfig
const body = '林澈拿到了钥匙。守门人却没有说明它的来历。'
const response = () => ({ content: JSON.stringify({ proposals: [], newPromises: [{ title: '钥匙来历', description: '以后解释钥匙的来历', evidence: '林澈拿到了钥匙。' }] }) })

beforeEach(() => {
  setActivePinia(createPinia()); vi.clearAllMocks()
  vi.spyOn(repository, 'readStoryAggregate').mockResolvedValue({ novel: null,
    workspace: { candidates: [], reviewFindings: [], canonMutations: [], chapterReviews: [], aiRuns: [] } })
  vi.spyOn(repository, 'saveStoryAggregate').mockResolvedValue()
  vi.mocked(callAI).mockResolvedValue(response())
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const novels = useNovelStore()
  const novel = novels.addNovel({ genre: '', subGenre: '', tags: [], targetWordCountMin: 1, targetWordCountMax: 2,
    writingMode: 'manual', settings: novels.defaultSettings(), writingStyle: novels.defaultWritingStyle() })
  const chapter = novels.addChapter(novel.id, { title: '钥匙', content: body })!
  chapter.status = 'finalized'
  return { novels, novel, chapter, scans: useStoryStateScansStore() }
}

describe('shared story state scans', () => {
  it('retains failed output for another page and retries persistence without a configured model', async () => {
    const { novel, chapter, scans } = setup()
    vi.mocked(repository.saveStoryAggregate).mockRejectedValueOnce(new Error('状态扫描写盘失败'))
    await expect(scans.scan(novel.id, chapter.id, model)).rejects.toThrow('写盘失败')
    expect(novel.storyStateProposals || []).toHaveLength(0)
    expect(scans.getPending(novel.id)[0].error).toContain('写盘失败')
    const reopened = useStoryStateScansStore()
    expect(await reopened.scan(novel.id, chapter.id)).toBe(1)
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(scans.getPending(novel.id)).toHaveLength(0)
    expect(novel.eventLog).toHaveLength(0); expect(novel.chapters[0].content).toBe(body)
    expect(novel.storyStateProposals![0].status).toBe('pending')
  })

  it('does not rebind failed output to new prose or silently request a replacement', async () => {
    const { novel, chapter, scans } = setup()
    vi.mocked(repository.saveStoryAggregate).mockRejectedValueOnce(new Error('暂时无法保存'))
    await expect(scans.scan(novel.id, chapter.id, model)).rejects.toThrow()
    chapter.content += '作者补写了后续行动。'
    await expect(scans.scan(novel.id, chapter.id, model)).rejects.toThrow('依据已变化')
    expect(callAI).toHaveBeenCalledTimes(1); expect(novel.storyStateProposals || []).toHaveLength(0)
    scans.discard(novel.id, chapter.id)
    expect(scans.getPending(novel.id)).toHaveLength(0)
  })

  it('coalesces concurrent calls from separate consumers', async () => {
    const { novel, chapter, scans } = setup()
    expect(await Promise.all([scans.scan(novel.id, chapter.id, model), useStoryStateScansStore().scan(novel.id, chapter.id, model)])).toEqual([1, 1])
    expect(callAI).toHaveBeenCalledTimes(1); expect(repository.saveStoryAggregate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callAI).mock.calls[0][0].noAutomaticRetry).toBe(true)
  })

  it('rejects a late response after its foreground page cancels', async () => {
    const { novel, chapter, scans } = setup(), controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => { controller.abort(); return response() })
    await expect(scans.scan(novel.id, chapter.id, model, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(repository.saveStoryAggregate).not.toHaveBeenCalled()
    expect(scans.getPending(novel.id)).toHaveLength(0); expect(scans.isRunning(novel.id, chapter.id)).toBe(false)
  })

  it.each(['length', 'shape'] as const)('rejects incomplete output (%s) without saving a partial batch', async kind => {
    const { novel, chapter, scans } = setup()
    vi.mocked(callAI).mockResolvedValue(kind === 'length' ? { ...response(), finishReason: 'length' } : { content: '{"proposals":[]}' })
    await expect(scans.scan(novel.id, chapter.id, model)).rejects.toThrow()
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(repository.saveStoryAggregate).not.toHaveBeenCalled(); expect(scans.getPending(novel.id)).toHaveLength(0)
  })

  it('refuses background work whose completed prose has changed before the request', async () => {
    const { novel, chapter, scans } = setup()
    await expect(scans.scan(novel.id, chapter.id, model, { expectedContent: '旧版本正文' })).rejects.toThrow('正文已变化')
    expect(callAI).not.toHaveBeenCalled(); expect(repository.saveStoryAggregate).not.toHaveBeenCalled()
  })

  it('does not persist an explicit empty result', async () => {
    const { novel, chapter, scans } = setup()
    vi.mocked(callAI).mockResolvedValue({ content: '{"proposals":[],"newPromises":[]}' })
    expect(await scans.scan(novel.id, chapter.id, model)).toBe(0)
    expect(repository.saveStoryAggregate).not.toHaveBeenCalled(); expect(scans.getPending(novel.id)).toHaveLength(0)
  })
})
