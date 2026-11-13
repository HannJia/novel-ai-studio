import { describe, expect, it } from 'vitest'
import type { CandidateChange } from '@/types/reconstruction'
import { buildEditedCandidateValue, candidateFields, candidateFieldValues, parseEditableCandidate } from './candidateEditing'
const make = (type: CandidateChange['type'], value: object): CandidateChange => ({ id: 'candidate', type,
  proposedValue: JSON.stringify(value), status: 'proposed', evidence: [], createdAt: '', updatedAt: '' })
describe('structured story candidate editing', () => {
  it.each([
    ['fact', { title: '旧事件', characters: ['林澈'], location: '东岸' }, { title: '新事件', characters: '林澈\n苏禾' }, { title: '新事件', characters: ['林澈', '苏禾'], location: '东岸' }],
    ['foreshadowing', { title: '钥匙', eventType: '伏笔' }, { status: 'resolved' }, { title: '钥匙', eventType: '伏笔', status: 'resolved' }],
    ['fact', { kind: 'character', name: '林澈', aliases: [], firstAppearChapter: 3 }, { identity: '学徒', aliases: '阿澈\n小林' }, { kind: 'character', name: '林澈', aliases: ['阿澈', '小林'], identity: '学徒', firstAppearChapter: 3 }],
    ['state', { characterId: 'lin', status: '活跃' }, { status: '失踪', characterId: 'other' }, { characterId: 'lin', status: '失踪' }],
    ['timeline', { elapsedDays: 2, chapterIndex: 3 }, { elapsedDays: '0.5', chapterIndex: '99' }, { elapsedDays: 0.5, chapterIndex: 3 }],
    ['plotline', { status: 'developing', note: '旧' }, { status: 'resolved', note: '回收' }, { status: 'resolved', note: '回收' }],
    ['knowledge', { characterId: 'lin', factId: 'fact', fact: '城主在世', state: 'suspects' }, { state: 'knows', fact: '恶意替换', characterId: 'other' }, { characterId: 'lin', factId: 'fact', fact: '城主在世', state: 'knows' }],
    ['relationship', { characterId: 'lin', targetCharacterId: 'su', relation: '怀疑' }, { relation: '信任', targetCharacterId: 'other' }, { characterId: 'lin', targetCharacterId: 'su', relation: '信任' }],
  ] as const)('edits %s without changing hidden identity or evidence', (type, value, draft, expected) => {
    const candidate = make(type, value), before = JSON.stringify(candidate)
    expect(JSON.parse(buildEditedCandidateValue(candidate, draft))).toEqual(expected)
    expect(JSON.stringify(candidate)).toBe(before)
  })
  it.each(['bad json', 'null', '[]', 'true'])('refuses unsupported proposal %s', proposedValue => {
    expect(() => parseEditableCandidate({ ...make('fact', {}), proposedValue })).toThrow()
  })
  it('shows list fields as separate lines and requires a real false belief', () => {
    const candidate = make('fact', { title: '线索', characters: ['甲', '乙'] })
    const value = parseEditableCandidate(candidate)
    expect(candidateFieldValues(candidateFields(candidate, value), value).characters).toBe('甲\n乙')
    expect(() => buildEditedCandidateValue(make('knowledge', { fact: '城主在世', state: 'false_belief' }), {})).toThrow('相信')
    expect(() => buildEditedCandidateValue(candidate, { title: ' ' })).toThrow('标题')
  })
  it.each(['0', '-1', 'Infinity', 'NaN', ''])('rejects invalid day count %s', elapsedDays => {
    expect(() => buildEditedCandidateValue(make('timeline', { elapsedDays: 1 }), { elapsedDays })).toThrow()
  })
})
