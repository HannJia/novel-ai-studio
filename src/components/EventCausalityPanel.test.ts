// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import EventCausalityPanel from './EventCausalityPanel.vue'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import type { Novel } from '@/types/novel'
import type { CandidateChange } from '@/types/reconstruction'

const novel = (): Novel => ({
  id: 'novel-causality-preview', title: '测试作品', genre: '', subGenre: '', genreLabel: '', subGenreLabel: '', tags: [],
  targetWordCountMin: 1, targetWordCountMax: 2, currentWordCount: 8, writingStyle: {} as Novel['writingStyle'],
  writingMode: 'manual', settings: {} as Novel['settings'], outline: '', synopsis: '', volumes: [],
  chapters: [{ id: 'chapter-1', volumeIndex: -1, chapterIndex: 0, title: '第一章', content: '火灾导致盐价上涨', summary: '', wordCount: 8, status: 'writing', createdAt: '', updatedAt: '' }],
  characters: [], chatHistory: [], knowledgeBaseIds: [],
  eventLog: [
    { id: 'event-fire', chapterIndex: 0, title: '盐仓失火', description: '', characters: [], type: '主线', timestamp: '' },
    { id: 'event-price', chapterIndex: 0, title: '盐价上涨', description: '', characters: [], type: '主线', timestamp: '' },
  ],
  storyArcs: [], chapterPlans: [], storyStateProposals: [], dataPanels: [], dataPanelChanges: [], status: 'writing', createdAt: '', updatedAt: '',
})

const candidate = (book: Novel): CandidateChange => ({
  id: 'candidate-causality-preview', novelId: book.id, chapterId: 'chapter-1', type: 'event_causality',
  proposedValue: JSON.stringify({ fromEventId: 'event-fire', toEventId: 'event-price', relation: 'causes', explanation: '火灾导致盐价上涨' }),
  evidence: [], status: 'proposed', createdAt: '', updatedAt: '',
})

beforeEach(() => setActivePinia(createPinia()))

describe('EventCausalityPanel', () => {
  it('renders readable event titles and relation details without serialized candidate payloads', () => {
    const book = novel()
    const store = useReconstructionWorkspaceStore()
    store.replaceCandidates(book.id, [candidate(book)])

    const wrapper = mount(EventCausalityPanel, {
      props: { novel: book },
      global: { stubs: { EditorRecoveryPicker: true } },
    })

    const text = wrapper.text()
    expect(text).toContain('盐仓失火')
    expect(text).toContain('盐价上涨')
    expect(text).toContain('导致')
    expect(text).toContain('火灾导致盐价上涨')
    expect(text).toContain('待作者核对，尚非事实')
    expect(text).not.toContain('event-fire')
    expect(text).not.toContain('event-price')
    expect(text).not.toContain('fromEventId')
    expect(text).not.toContain('proposedValue')
  })
})
