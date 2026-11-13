import { describe, expect, it } from 'vitest'
import {
  approveCreationStage,
  createEmptyCreationDraft,
  validateCreationStage,
  type PlotSkeleton,
} from './reconstruction'

describe('reconstruction creation contract', () => {
  const now = '2026-10-26T00:00:00.000Z'

  it('starts in author-led contract stage', () => {
    const draft = createEmptyCreationDraft({ id: 'draft-1', now })

    expect(draft.mode).toBe('author')
    expect(draft.stage).toBe('contract')
    expect(validateCreationStage(draft)).toEqual([
      '请填写作品名称',
      '请选择作品类型',
      '请填写主线冲突',
      '请填写结局方向，或明确标记为暂不确定',
    ])
  })

  it('approves the contract and advances to skeleton selection', () => {
    const draft = createEmptyCreationDraft({ id: 'draft-1', now })
    draft.contract.title = '雾城档案'
    draft.contract.genre = '悬疑'
    draft.contract.centralConflict = '主角调查一场被掩盖的旧案'
    draft.contract.endingDirection = '主角公开真相'

    const result = approveCreationStage(draft, now)

    expect(result.issues).toEqual([])
    expect(result.draft.stage).toBe('skeleton')
    expect(result.draft.approval.contract).toBe('approved')
  })

  it('requires an explicit skeleton selection before expanding the outline', () => {
    const draft = createEmptyCreationDraft({ id: 'draft-1', now })
    draft.stage = 'skeleton'
    const blocked = approveCreationStage(draft, now)

    expect(blocked.draft.stage).toBe('skeleton')
    expect(blocked.issues).toEqual(['请选择或确认一个故事骨架'])

    const skeleton: PlotSkeleton = {
      id: 'skeleton-1',
      title: '公开旧案',
      premise: '主角调查被掩盖的旧案',
      logline: '一个被排斥的调查员必须公开一场旧案的真相。',
      promise: '逐步揭开真相并承受代价',
      ending: '主角公开真相并承担后果',
      beats: [],
      approval: 'awaiting_approval',
      updatedAt: now,
    }
    draft.skeletons = [skeleton]
    draft.selectedSkeletonId = skeleton.id

    const approved = approveCreationStage(draft, now)
    expect(approved.issues).toEqual([])
    expect(approved.draft.stage).toBe('volume-outline')
  })
})
