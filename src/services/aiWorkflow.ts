export type AiWorkflowMode = 'fast' | 'balanced' | 'strict'

export interface AiWorkflowPolicy {
  createWritingPlan: boolean
  selfCheckDraft: boolean
  endingContinuationAttempts: number
  reviewRewriteCycles: number
  runExtendedBackgroundChecks: boolean
}

const POLICIES: Record<AiWorkflowMode, AiWorkflowPolicy> = {
  fast: {
    createWritingPlan: false,
    selfCheckDraft: false,
    endingContinuationAttempts: 1,
    reviewRewriteCycles: 1,
    runExtendedBackgroundChecks: false,
  },
  balanced: {
    createWritingPlan: true,
    selfCheckDraft: true,
    endingContinuationAttempts: 2,
    reviewRewriteCycles: 2,
    runExtendedBackgroundChecks: true,
  },
  strict: {
    createWritingPlan: true,
    selfCheckDraft: true,
    endingContinuationAttempts: 3,
    reviewRewriteCycles: 3,
    runExtendedBackgroundChecks: true,
  },
}

export function normalizeAiWorkflowMode(value: unknown): AiWorkflowMode {
  return value === 'fast' || value === 'strict' ? value : 'balanced'
}

export function getAiWorkflowPolicy(mode: unknown): AiWorkflowPolicy {
  return POLICIES[normalizeAiWorkflowMode(mode)]
}
