import { describe, expect, it } from 'vitest'
import { assertStructuredOutputComplete, safeAiErrorMessage, safeAiUsage, structuredOutputDiagnostic } from './aiDiagnostics'

describe('safe structured AI diagnostics', () => {
  it('distinguishes truncation from an empty successful response without exposing payloads', () => {
    const result = { content: 'private manuscript', finishReason: 'length', usage: { prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000 } }
    expect(() => assertStructuredOutputComplete(result, '结尾检查')).toThrow('结束原因：length')
    expect(structuredOutputDiagnostic(result)).toContain('输出用量：900 token')
    expect(structuredOutputDiagnostic(result)).not.toContain(result.content)
    expect(() => assertStructuredOutputComplete({ content: '', finishReason: 'stop' }, '骨架')).toThrow('未返回正文')
    expect(() => assertStructuredOutputComplete({ content: '{}', finishReason: 'stop' }, '骨架')).not.toThrow()
  })

  it('does not echo unexpected provider finish reasons or nonnumeric usage', () => {
    const result = { content: '{}', finishReason: 'secret-key-value', usage: { prompt_tokens: 0, completion_tokens: 'secret' as never, total_tokens: 0 } }
    expect(structuredOutputDiagnostic(result)).toBe('结束原因：未知；正文长度：2 字符')
  })

  it('redacts configured secrets, credential fields and endpoint queries in visible failures', () => {
    const message = safeAiErrorMessage(new Error('failed custom-secret Bearer bearer-value sk-test123 api_key="abc123" https://provider.example/?token=private'), ['custom-secret'])
    for (const secret of ['custom-secret', 'bearer-value', 'sk-test123', 'abc123', 'private', 'provider.example']) expect(message).not.toContain(secret)
    expect(message).toContain('failed')
  })

  it('shows reasoning usage as a separate count without adding it to completion tokens', () => {
    const usage = safeAiUsage({ prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000,
      completion_tokens_details: { reasoning_tokens: 608, reasoning_content: 'private details' }, reasoning_content: 'private reasoning' })
    expect(usage).toEqual({ prompt_tokens: 100, completion_tokens: 900, total_tokens: 1000, completion_tokens_details: { reasoning_tokens: 608 } })
    expect(structuredOutputDiagnostic({ content: '{}', finishReason: 'length', usage })).toBe(
      '结束原因：length；正文长度：2 字符；输出用量：900 token；推理用量：608 token')
  })

  it.each([0, 608, Number.MAX_SAFE_INTEGER])('preserves a safe reasoning count %s without inventing missing counters', count => {
    const usage = safeAiUsage({ completion_tokens_details: { reasoning_tokens: count } })
    expect(usage).toEqual({ completion_tokens_details: { reasoning_tokens: count } })
    expect(structuredOutputDiagnostic({ content: '', usage })).toBe(`结束原因：未提供；正文长度：0 字符；推理用量：${count} token`)
  })

  it.each(['secret', '608', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined, {}, []])('rejects unsafe counters %j in transport and diagnostics', count => {
    expect(safeAiUsage({ prompt_tokens: count, completion_tokens: count, total_tokens: count, completion_tokens_details: { reasoning_tokens: count } })).toBeUndefined()
    expect(structuredOutputDiagnostic({ content: '{}', usage: { completion_tokens: count as never, completion_tokens_details: { reasoning_tokens: count as never } } }))
      .toBe('结束原因：未提供；正文长度：2 字符')
  })

  it.each([null, undefined, [], 'private text', 1, true, {}])('ignores missing or invalid usage containers %j', value => {
    expect(safeAiUsage(value)).toBeUndefined()
  })
})
