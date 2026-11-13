import type { AiRun, AiRunMode, AiRunStatus } from '@/types/reconstruction'

export interface CreateAiRunInput {
  id: string
  mode: AiRunMode
  taskType: AiRun['taskType']
  targetId?: string
  chapterStart?: number
  chapterEnd?: number
  tokenBudget?: number
  checkpointEvery?: number
  requestLimit?: number
  now: string
}

export function validateAiRunScope(input: Pick<CreateAiRunInput, 'mode' | 'chapterStart' | 'chapterEnd' | 'tokenBudget' | 'requestLimit' | 'checkpointEvery'>): string[] {
  const issues: string[] = []
  if (input.mode === 'autonomous') {
    if (!Number.isInteger(input.chapterStart) || !Number.isInteger(input.chapterEnd)) issues.push('自动模式必须指定章节范围')
    else if ((input.chapterStart as number) < 0 || (input.chapterEnd as number) < (input.chapterStart as number)) issues.push('章节范围无效')
    if (!Number.isFinite(input.tokenBudget) || (input.tokenBudget as number) <= 0) issues.push('自动模式必须指定正数 Token 预算')
  }
  if (input.chapterStart !== undefined && input.chapterStart < 0) issues.push('起始章节不能小于 0')
  if (input.chapterEnd !== undefined && input.chapterEnd < (input.chapterStart ?? 0)) issues.push('结束章节不能早于起始章节')
  if (input.tokenBudget !== undefined && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget <= 0)) issues.push('Token 预算必须为正整数')
  if (input.requestLimit !== undefined && (!Number.isSafeInteger(input.requestLimit) || input.requestLimit < 1 || input.requestLimit > 2000)) issues.push('请求次数上限必须为 1–2000 的整数')
  const checkpointEvery = input.checkpointEvery
  if (checkpointEvery !== undefined && (!Number.isSafeInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > 1000)) issues.push('检查点间隔必须为 1–1000 的整数')
  return Array.from(new Set(issues))
}

export function createAiRun(input: CreateAiRunInput): AiRun {
  const issues = validateAiRunScope(input)
  if (issues.length) throw new Error(issues.join('；'))
  return {
    id: input.id,
    mode: input.mode,
    taskType: input.taskType,
    targetId: input.targetId,
    chapterStart: input.chapterStart,
    chapterEnd: input.chapterEnd,
    tokenBudget: input.tokenBudget,
    ...(input.checkpointEvery !== undefined ? { checkpointEvery: input.checkpointEvery } : {}),
    usedTokens: 0,
    ...(input.mode === 'autonomous' ? { requestLimit: input.requestLimit ?? 200, requests: [] } : {}),
    status: 'queued',
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function assertAiRunCanProcessChapter(run: AiRun, chapterIndex: number): void {
  if (run.status !== 'queued' && run.status !== 'running') throw new Error('当前 AI 运行不在执行状态')
  if (run.chapterStart !== undefined && chapterIndex < run.chapterStart) throw new Error('当前章节早于自动任务范围')
  if (run.chapterEnd !== undefined && chapterIndex > run.chapterEnd) throw new Error('当前章节超出自动任务范围')
}

export function startAiRun(run: AiRun, now: string): AiRun {
  if (!['queued', 'paused', 'needs_author', 'failed'].includes(run.status)) throw new Error('只有排队、暂停、失败或等待作者处理的 AI 运行可以启动')
  return { ...run, status: 'running', error: undefined, updatedAt: now }
}

export function checkpointAiRun(run: AiRun, checkpoint: string, now: string): AiRun {
  const value = checkpoint.trim()
  if (!value) throw new Error('检查点不能为空')
  return { ...run, checkpoint: value, updatedAt: now }
}

export function pauseAiRun(run: AiRun, now: string, checkpoint = 'author-paused'): AiRun {
  if (run.status !== 'queued' && run.status !== 'running') throw new Error('只有排队或执行中的 AI 运行可以暂停')
  return checkpointAiRun({ ...run, status: 'paused' }, checkpoint, now)
}

export function cancelAiRun(run: AiRun, now: string, reason?: string): AiRun {
  if (['completed', 'failed', 'cancelled'].includes(run.status)) throw new Error('当前 AI 运行已经结束')
  return { ...run, status: 'cancelled', error: reason || run.error, updatedAt: now }
}

export function finishAiRun(run: AiRun, status: Extract<AiRunStatus, 'completed' | 'failed' | 'cancelled' | 'needs_author'>, now: string, error?: string): AiRun {
  return { ...run, status, error, updatedAt: now }
}
