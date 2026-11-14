import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { callAI } from './ai'
import {
  chatInspiration,
  compactInspirationContext,
  extractInspirationSettings,
  inspirationContextLength,
  inspirationReplyText,
  parseInspirationSettings,
  inspirationSettingsSnapshot,
} from './inspiration'
import { parseInspirationSession } from './inspirationSessions'
import type { ModelConfig } from '@/stores/config'
import type { CreateWizardForm } from '@/types/novel'
import type { InspirationMessage } from './inspiration'

vi.mock('./ai', async original => ({ ...await original<object>(), callAI: vi.fn() }))
const model: ModelConfig = { id: 'test', name: 'test', modelName: 'test', apiKey: 'test-key', baseUrl: 'https://example.test', maxTokens: 8000, temperature: 0.7, topP: 1 }
function base(): CreateWizardForm {
  const store = useNovelStore()
  return { genre: '', subGenre: '', tags: [], targetWordCountMin: 80, targetWordCountMax: 100,
    writingStyle: store.defaultWritingStyle(), settings: store.defaultSettings(), writingMode: 'manual' }
}
function answerWithQuestions(content: string) {
  return `${content}\n<inspiration-questions>\n还可以怎样展开这个方向？\n主角会遇到什么阻力？\n哪些设定仍需要确认？\n</inspiration-questions>`
}
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })
afterEach(() => vi.unstubAllGlobals())

describe('inspiration settings', () => {
  it('fills missing questions once using the current reply and edited settings without repeating the conversation request', async () => {
    const questions = ['顾宁怎样应对官府阻挠？', '还能从哪些人情门路入手？', '这次受阻会让他失去什么？']
    vi.mocked(callAI).mockResolvedValueOnce({ content: '官府不肯受理顾宁的请求。' })
      .mockResolvedValueOnce({ content: JSON.stringify({ questions }) })
    const form = base()
    form.settings.protagonist.name = '顾宁'
    const reply = await chatInspiration(model, [{ role: 'user', content: '给我一种查案阻力。' }], new AbortController().signal, () => {}, false, [], undefined, form)
    expect(reply).toMatchObject({ content: '官府不肯受理顾宁的请求。', questions })
    expect(callAI).toHaveBeenCalledTimes(2)
    const supplement = vi.mocked(callAI).mock.calls[1][0]
    expect(supplement).toMatchObject({ stream: false, noAutomaticRetry: true, structuredOutput: 'concise-json' })
    expect(supplement.messages[1].content).toContain('顾宁')
    expect(supplement.messages[1].content).toContain('官府不肯受理')
    expect(JSON.stringify(supplement.messages)).not.toContain('test-key')
  })

  it('preserves the completed reply if generating follow-up questions fails', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: '正文回答已完成。' }).mockRejectedValueOnce(new Error('请求超时'))
    const reply = await chatInspiration(model, [{ role: 'user', content: '继续聊。' }], new AbortController().signal, () => {})
    expect(reply.content).toBe('正文回答已完成。')
    expect(reply.questions).toHaveLength(3)
    expect(callAI).toHaveBeenCalledTimes(2)
  })

  it('separates three contextual follow-up questions from the answer in the same request', async () => {
    const questions = ['姐姐留下的灯可以有哪些线索？', '怎样设计顾宁与姐姐之间的矛盾？', '明朝灯市可以怎样融入调查？']
    vi.mocked(callAI).mockResolvedValue({ content: `先从那盏未修完的灯查起。\n<inspiration-questions>\n${questions.join('\n')}\n</inspiration-questions>` })
    const reply = await chatInspiration(model, [{ role: 'user', content: '继续讨论修灯人顾宁。' }], new AbortController().signal, () => {})
    expect(reply).toMatchObject({ content: '先从那盏未修完的灯查起。', questions })
    expect(callAI).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callAI).mock.calls[0][0].messages[0].content).toContain('恰好三个问题')
    const restored = parseInspirationSession({ id: 'questions', title: '修灯人', updatedAt: '2026-11-14T00:00:00Z',
      messages: [{ role: 'assistant', ...reply }] })
    expect(restored.messages[0].questions).toEqual(questions)
    await chatInspiration(model, [...restored.messages, { role: 'user', content: questions[0] }], new AbortController().signal, () => {})
    const continued = JSON.stringify(vi.mocked(callAI).mock.calls[1][0].messages.slice(1))
    expect(continued).toContain('先从那盏未修完的灯查起。')
    expect(continued).not.toContain(questions[1])
    expect(vi.mocked(callAI).mock.calls[1][0].messages[1].content).toBe('先从那盏未修完的灯查起。')
  })

  it('hides question metadata during streaming and supplies three general prompts when the list is missing or invalid', async () => {
    expect(inspirationReplyText('回答\n<inspira')).toBe('回答')
    expect(inspirationReplyText('回答\n<inspiration-questions>\n问题')).toBe('回答')
    expect(inspirationReplyText('正常的回答')).toBe('正常的回答')
    for (const metadata of ['', '<inspiration-questions>\n问题一\n问题二\n问题一\n</inspiration-questions>', '<inspiration-questions>\n问题一', '<inspiration-questions>\n</inspiration-questions>']) {
      vi.mocked(callAI).mockResolvedValue({ content: `正常回答\n${metadata}` })
      const reply = await chatInspiration(model, [{ role: 'user', content: '继续讨论。' }], new AbortController().signal, () => {})
      expect(reply.content).toBe('正常回答')
      expect(reply.questions).toHaveLength(3)
      expect(reply.questions?.[1]).toContain('哪些细节还需要确认')
    }
    expect(() => parseInspirationSession({ id: 'bad', title: '无效问题', updatedAt: '2026-11-14T00:00:00Z',
      messages: [{ role: 'assistant', content: '回答', questions: ['一', '一', '三'] }] })).toThrow()
  })

  it('uses current edited settings alongside compressed history and the latest question', async () => {
    const form = base()
    form.settings.protagonist.name = '苏晴'
    form.settings.worldBuilding.worldType = '作者修改后的海边小镇'
    const messages: InspirationMessage[] = [{ role: 'user', content: '很早以前的原始长对话' }, { role: 'user', content: '继续讨论主角的选择。' }]
    const context = { content: '旧讨论曾把主角叫林晚，反派尚未决定。', messageCount: 1 }
    vi.mocked(callAI).mockResolvedValue({ content: '苏晴的新选择。' })
    await chatInspiration(model, messages, new AbortController().signal, () => {}, false, [], context, form)
    const prompt = vi.mocked(callAI).mock.calls[0][0].messages
    expect(prompt[0].content).toContain('以当前设定为准')
    expect(prompt.some(message => message.content.includes('作者修改后的海边小镇') && message.content.includes('苏晴'))).toBe(true)
    expect(prompt.some(message => message.content.includes('反派尚未决定'))).toBe(true)
    expect(prompt[prompt.length - 1].content).toMatch(/^继续讨论主角的选择。\n\n【界面附加格式】/)
    expect(messages[1].content).toBe('继续讨论主角的选择。')
    expect(JSON.stringify(prompt)).not.toContain('很早以前的原始长对话')
    expect(inspirationContextLength(messages, context, form)).toBe(context.content.length + messages[1].content.length + inspirationSettingsSnapshot(form).length)
  })

  it('round trips organized settings in an inspiration session and rejects malformed snapshots', () => {
    const form = base()
    form.settings.protagonist.name = '手工修改后的名字'
    const settingsDraft = inspirationSettingsSnapshot(form)
    const session = parseInspirationSession({ id: 'draft', title: '已有设定', updatedAt: '2026-11-14T00:00:00Z', messages: [], settingsDraft })
    expect(parseInspirationSession(JSON.parse(JSON.stringify(session))).settingsDraft).toBe(settingsDraft)
    expect(parseInspirationSettings(session.settingsDraft!, base()).settings.protagonist.name).toBe('手工修改后的名字')
    expect(() => parseInspirationSession({ ...session, settingsDraft: '{invalid' })).toThrow()
    expect(() => parseInspirationSession({ ...session, settingsDraft: '[]' })).toThrow()
  })

  it('extracts long conversations in bounded chronological batches rather than blocking its own recovery action', async () => {
    const messages: InspirationMessage[] = [{ role: 'user', content: '甲'.repeat(65000) }, { role: 'user', content: '最终决定：主角叫小林' }]
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({ genre: 'urban', subGenre: 'business',
      settings: { protagonist: { name: '小林' }, otherSettings: '不要重生' } }) })
    const progress = vi.fn()
    const form = await extractInspirationSettings(model, messages, base(), new AbortController().signal, progress)
    expect(form.settings.protagonist.name).toBe('小林')
    expect(callAI).toHaveBeenCalledTimes(6)
    expect(vi.mocked(callAI).mock.calls.some(([request]) =>
      request.messages.some(item => item.content.includes('最终决定')),
    )).toBe(true)
    expect(vi.mocked(callAI).mock.calls.slice(-1)[0][0]).toMatchObject({
      timeoutMs: 240_000,
      noAutomaticRetry: true,
    })
    expect(progress).toHaveBeenLastCalledWith(6, 6)
    expect(messages[0].content.length).toBe(65000)
  })
  it('preserves chronological notes through a second merge layer for very long conversations', async () => {
    const messages: InspirationMessage[] = [
      { role: 'user', content: '旧方案'.repeat(40_000) },
      { role: 'user', content: '最终决定：改为商战' },
    ]
    vi.mocked(callAI).mockImplementation(async request => {
      const prompt = request.messages.map(item => item.content).join('\n')
      if (prompt.includes('请输出待作者确认的新书设定 JSON')) {
        expect(prompt).toContain('最终决定')
        return { content: JSON.stringify({ genre: 'urban', subGenre: 'business', settings: { otherSettings: '最终决定：改为商战' } }) }
      }
      return { content: prompt.includes('最终决定') ? '最终决定：改为商战' : '旧方案' }
    })
    const progress = vi.fn()
    const form = await extractInspirationSettings(model, messages, base(), new AbortController().signal, progress)
    expect(form.settings.otherSettings).toContain('最终决定')
    expect(progress).toHaveBeenLastCalledWith(11, 11)
    const finalMessages = vi.mocked(callAI).mock.calls.slice(-1)[0][0].messages
    expect(finalMessages[finalMessages.length - 2]?.content).toContain('最终决定')
  })
  it('does not produce settings when a batch is empty or cancellation arrives during parallel work', async () => {
    const messages: InspirationMessage[] = [{ role: 'user', content: '长'.repeat(32_000) }]
    vi.mocked(callAI).mockResolvedValueOnce({ content: '' }).mockResolvedValue({ content: '要点' })
    await expect(extractInspirationSettings(model, messages, base(), new AbortController().signal))
      .rejects.toThrow('未返回整理要点')
    vi.clearAllMocks()
    const controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => {
      controller.abort()
      return { content: '要点' }
    })
    await expect(extractInspirationSettings(model, messages, base(), controller.signal)).rejects.toThrow()
  })
  it('uses organized context to continue chatting while retaining full history in storage', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '继续聊' })
    await chatInspiration(model, [{ role: 'user', content: '旧'.repeat(65000) }, { role: 'user', content: '新的选择' }],
      new AbortController().signal, () => {}, false, [], { content: '主角小林，不写重生', messageCount: 1 })
    const prompt = JSON.stringify(vi.mocked(callAI).mock.calls[0][0].messages)
    expect(prompt).toContain('主角小林')
    expect(prompt).toContain('新的选择')
    expect(prompt).not.toContain('旧旧旧')
  })
  it('compacts enough older messages to keep a long recent exchange in budget', async () => {
    const messages: InspirationMessage[] = [
      ...['甲', '乙', '丙', '丁', '戊', '己'].map((char, index) => ({
        role: index % 2 ? 'assistant' as const : 'user' as const,
        content: char.repeat(9000),
      })),
      { role: 'user', content: '最新问题' },
      { role: 'assistant', content: '上一条回复' },
    ]
    const before = JSON.stringify(messages)
    vi.mocked(callAI).mockResolvedValue({ content: '旧决定摘要' })
    const progress = vi.fn()
    const context = await compactInspirationContext(model, messages, undefined, new AbortController().signal, progress)
    expect(context).toEqual({ content: '旧决定摘要', messageCount: 4 })
    expect(inspirationContextLength(messages, context)).toBeLessThan(24_000)
    expect(progress).toHaveBeenLastCalledWith(4, 4)
    expect(JSON.stringify(messages)).toBe(before)
    vi.clearAllMocks()
    vi.mocked(callAI).mockResolvedValue({ content: '继续讨论' })
    await chatInspiration(model, messages, new AbortController().signal, () => {}, false, [], context)
    const prompt = JSON.stringify(vi.mocked(callAI).mock.calls[0][0].messages)
    expect(prompt).toContain('旧决定摘要')
    expect(prompt).toContain('最新问题')
    expect(prompt).not.toContain('甲'.repeat(100))
  })
  it('reads current software knowledge without web search, respects selection, and sees new entries next turn', async () => {
    const store = useKnowledgeStore()
    const kb = store.createKB('舞阳县志')
    const entry = store.addEntry(kb.id, { title: '地方事件', content: '舞阳县在该年举行集市。', category: '事件', summary: '', tags: [] })!
    vi.mocked(callAI).mockResolvedValue({ content: answerWithQuestions('已参考资料。') })
    const ask = (ids?: string[]) => chatInspiration(model, [{ role: 'user', content: '你可以看舞阳县的知识库吗？' }], new AbortController().signal, () => {}, false, ids)
    await ask()
    let prompt = vi.mocked(callAI).mock.calls.slice(-1)[0][0].messages[0].content
    expect(prompt).toContain('舞阳县在该年举行集市')
    expect(prompt).toContain('创建新书的灵感对话')
    store.updateEntry(kb.id, entry.id, { content: '舞阳县在该年恢复县学。' })
    await ask([kb.id])
    prompt = vi.mocked(callAI).mock.calls.slice(-1)[0][0].messages[0].content
    expect(prompt).toContain('恢复县学')
    expect(prompt).not.toContain('举行集市')
    await ask([])
    prompt = vi.mocked(callAI).mock.calls.slice(-1)[0][0].messages[0].content
    expect(prompt).toContain('没有读取任何知识库正文')
    expect(prompt).not.toContain('恢复县学')
  })
  it('normalizes labels, retains known fields and never mutates the confirmation form', () => {
    const form = base()
    const result = parseInspirationSettings(JSON.stringify({
      genreLabel: '都市', subGenreLabel: '商战职场', tags: ['经商', 'invalid'],
      targetWordCountMin: 120, targetWordCountMax: 100, writingMode: 'ai',
      writingStyle: { toneStyle: 'modern', narrativePov: 'invalid' },
      settings: { protagonist: { name: '陈安', age: 18, unexpected: 'drop' },
        supportingCharacters: [{ name: '林岚', role: '合伙人' }], otherSettings: '1992年，历史细节待核实' },
    }), form)
    expect(result).toMatchObject({ genre: 'urban', subGenre: 'business', tags: ['经商'], targetWordCountMax: 120, writingMode: 'manual' })
    expect(result.settings.protagonist).toMatchObject({ name: '陈安', age: '' })
    expect(result.settings.protagonist).not.toHaveProperty('unexpected')
    expect(result.settings.supportingCharacters[0]).toMatchObject({ name: '林岚', role: '合伙人' })
    expect(result.writingStyle).toMatchObject({ toneStyle: 'modern', narrativePov: form.writingStyle.narrativePov })
    expect(form.settings.protagonist.name).toBe('')
  })

  it('accepts markdown, nested provider envelopes, partial fields and Chinese labels', () => {
    const form = base()
    const result = parseInspirationSettings(`整理结果如下：
\`\`\`json
{"data":{"genre":"历史","subGenre":"清史民国","settings":{"otherSettings":"资料待核实"},"targetWordCountMin":"80万字"}}
\`\`\``, form)
    expect(result).toMatchObject({ genre: 'history', subGenre: 'qing-republic', targetWordCountMin: 80 })
    expect(result.settings.otherSettings).toBe('资料待核实')
    expect(result.settings.protagonist.name).toBe('')
  })

  it('keeps the base selection when the response only contains partial settings', () => {
    const form = base()
    form.genre = 'urban'
    form.subGenre = 'business'
    const result = parseInspirationSettings(JSON.stringify({ settings: { otherSettings: '主线待确认' } }), form)
    expect(result).toMatchObject({ genre: 'urban', subGenre: 'business' })
    expect(result.settings.otherSettings).toBe('主线待确认')
  })

  it('allows partial settings before selecting a genre, so the author can finish it in the wizard', () => {
    const result = parseInspirationSettings('{"settings":{"protagonist":{"name":"小林"}}}', base())
    expect(result.genre).toBe('')
    expect(result.subGenre).toBe('')
    expect(result.settings.protagonist.name).toBe('小林')
  })

  it('rejects malformed responses and genre mismatch with actionable errors', () => {
    expect(() => parseInspirationSettings('', base())).toThrow('未返回内容')
    expect(() => parseInspirationSettings('随便聊聊', base())).toThrow('不是完整 JSON')
    expect(() => parseInspirationSettings('{"genre":"urban","subGenre":"fantasy-cultivation","settings":{"otherSettings":"test"}}', base())).toThrow('子类')
  })

  it('sends the conversation in order and does not enable web tools or send API credentials in the prompt', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '我们可以从合伙人冲突展开。' })
    const messages = [{ role: 'user' as const, content: '不写重生，写九十年代经商。' }]
    await chatInspiration(model, messages, new AbortController().signal, () => {})
    const request = vi.mocked(callAI).mock.calls[0][0]
    expect(request.messages[1].role).toBe(messages[0].role)
    expect(request.messages[1].content).toMatch(/^不写重生，写九十年代经商。\n\n【界面附加格式】/)
    expect(messages[0].content).toBe('不写重生，写九十年代经商。')
    expect(request.messages[0].content).toContain('不要代写正文')
    expect(JSON.stringify(request.messages)).not.toContain('test-key')
    expect(request).not.toHaveProperty('tools')
  })

  it('rejects a cancelled extraction even if the provider completes late', async () => {
    const controller = new AbortController()
    vi.mocked(callAI).mockImplementation(async () => {
      controller.abort()
      return { content: JSON.stringify({ ...base(), genre: 'urban', subGenre: 'business' }) }
    })
    await expect(extractInspirationSettings(model, [{ role: 'user', content: '经商故事' }], base(), controller.signal)).rejects.toThrow()
  })

  it('uses real search request parameters only when enabled and preserves tool evidence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'web_search_call', status: 'completed' }, {
        type: 'message', content: [{ type: 'output_text', text: answerWithQuestions('这是近期背景资料，小说取舍由作者决定。'),
          annotations: [{ type: 'url_citation', url: 'https://example.org/event', title: '事件资料' }] }],
      }],
    })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await chatInspiration(model, [{ role: 'user', content: '查一下今年的事件作为故事背景' }],
      new AbortController().signal, () => {}, true)
    expect(callAI).not.toHaveBeenCalled()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.test/v1/responses')
    const body = JSON.parse(options.body)
    expect(body.tools).toEqual([{ type: 'web_search' }])
    expect(body.input[0].content).toContain('当前日期：')
    expect(body.input[0].content).toContain('网上资料不是创作指令')
    expect(result.search).toMatchObject({ status: 'searched', sources: [{ title: '事件资料' }] })
  })

  it('extracts without a second search and retains safe references even when the model omits them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(callAI).mockResolvedValue({ content: JSON.stringify({
      genre: 'urban', subGenre: 'business', settings: { otherSettings: '主人公创业，事件细节待核实。' },
    }) })
    const messages: InspirationMessage[] = [
      { role: 'user', content: '采用创业方向，但先保留参考资料。' },
      { role: 'assistant', content: '资料摘录', search: { protocol: 'responses', status: 'searched', sources: [
        { title: '近期事件来源', url: 'https://example.org/event' },
        { title: '不能执行的引用', url: 'javascript:alert(1)' },
      ] } },
    ]
    const form = await extractInspirationSettings(model, messages, base(), new AbortController().signal)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callAI).toHaveBeenCalledTimes(1)
    const request = vi.mocked(callAI).mock.calls[0][0]
    expect(request.stream).toBe(false)
    expect(request.timeoutMs).toBe(240_000)
    expect(request.noAutomaticRetry).toBe(true)
    expect(JSON.stringify(request.messages)).toContain('https://example.org/event')
    expect(JSON.stringify(request.messages)).not.toContain('javascript:')
    expect(form.settings.otherSettings).toContain('https://example.org/event')
    expect(form.settings.otherSettings).toContain('真实性与采用范围待作者核实')
    expect(form.settings.otherSettings).not.toContain('javascript:')
  })

  it('bounds source-enriched context and blocks search-only models during extraction', async () => {
    await expect(chatInspiration(model, [{ role: 'user', content: '长'.repeat(60001) }],
      new AbortController().signal, () => {}, true)).rejects.toThrow('对话较长')
    await expect(extractInspirationSettings({ ...model, modelName: 'test:online' },
      [{ role: 'user', content: '整理设定' }], base(), new AbortController().signal)).rejects.toThrow('联网专用模型')
    expect(callAI).not.toHaveBeenCalled()
  })
})
