import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRequire } from 'node:module'
import { useKnowledgeStore } from '@/stores/knowledge'
import { createTestProjectBackup } from '@/test/projectBackupFixture'
import { validateProjectBackup } from './projectBackupValidation'
import { createEntrySummarySource, createBaseSummarySource, getCurrentEntrySummary } from './knowledgeSources'
import { testKnowledgeCoverage } from '@/test/knowledgeCoverageFixture'

const require = createRequire(import.meta.url)
const kernelValidate = require('../../app-main/kernel-validation/projectBackupValidation.js').validateProjectBackup
const now = '2026-10-28T00:00:00.000Z'
beforeEach(() => setActivePinia(createPinia()))
function fixture() {
  const store = useKnowledgeStore(), base = store.createKB('资料来源')
  const entry = store.addEntry(base.id, { title: '钥匙', category: '事件', content: '钥匙在旅馆。', summary: '旅馆存放钥匙。', tags: [] })!
  entry.summarySource = createEntrySummarySource(base.id, entry, entry.summary, 'ai', now, testKnowledgeCoverage(base.id, [entry]))
  entry.summaryHistory = [{ id: 'history', summary: entry.summary, summarySource: entry.summarySource, savedAt: now }]
  base.summary = '钥匙的去向。'
  base.summarySource = createBaseSummarySource(base, base.summary, 'author', now)
  const backup = createTestProjectBackup([], [base])
  return { backup, base: backup.knowledgeBases[0], entry: backup.knowledgeBases[0].entries[0] }
}

describe.each([['renderer', validateProjectBackup], ['kernel', kernelValidate]] as const)('knowledge source backups (%s)', (_, validate) => {
  it('keeps stale source/history without promoting a restored summary', () => {
    const { backup, base, entry } = fixture()
    entry.content = '钥匙已经交给城门守卫。'
    expect(() => validate(backup)).not.toThrow()
    expect(getCurrentEntrySummary(base.id, entry)).toBe('')
    expect(entry.summaryHistory?.[0].summary).toBe('旅馆存放钥匙。')
  })
  it.each(['foreign-base', 'foreign-entry', 'wrong-kind', 'impossible-date', 'bad-origin', 'history-owner', 'duplicate-history', 'bad-level', 'coverage-gap', 'coverage-owner', 'coverage-count', 'coverage-usage'] as const)(
    'rejects malformed source/history: %s', kind => {
      const { backup, base, entry } = fixture()
      if (kind === 'foreign-base') entry.summarySource!.knowledgeBaseId = 'other'
      if (kind === 'foreign-entry') entry.summarySource!.entryId = 'other'
      if (kind === 'wrong-kind') base.summarySource!.kind = 'entry'
      if (kind === 'impossible-date') entry.summarySource!.createdAt = '2026-02-30T00:00:00Z'
      if (kind === 'bad-origin') (entry.summarySource as any).origin = 'system'
      if (kind === 'history-owner') entry.summaryHistory![0].summarySource!.entryId = 'other'
      if (kind === 'duplicate-history') entry.summaryHistory!.push(entry.summaryHistory![0])
      if (kind === 'bad-level') (base as any).summaryLevel = 'unlimited'
      if (kind === 'coverage-gap') entry.summarySource!.coverage!.sources[0].ranges[0].start = 1
      if (kind === 'coverage-owner') entry.summarySource!.coverage!.sources[0].entryId = 'other'
      if (kind === 'coverage-count') entry.summarySource!.coverage!.leafCount = 100
      if (kind === 'coverage-usage') entry.summarySource!.coverage!.inputTokens = -1
      expect(() => validate(backup)).toThrow()
    })
})
