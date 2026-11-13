import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

// Shared by the renderer and isolated project validator; no stores or UI dependencies.
export function buildChapterReviewSignature(content: string, contextVersion: string): string {
  return 'review-v8:' + buildAnalysisSourceVersionId(content) + ':' + contextVersion
}

export function buildChapterReviewSourceVersion(content: string, contextVersion: string): string {
  return buildAnalysisSourceVersionId(content) + '|context:' + buildChapterReviewSignature(content, contextVersion)
}

/** Persisted reports use the same identity protocol as current execution. */
export function isStoredChapterReviewSignature(signature: string, content: string, contextVersion: string): boolean {
  return signature === buildChapterReviewSignature(content, contextVersion)
}

export function isStoredChapterReviewSourceVersion(version: string, content: string, contextVersion: string): boolean {
  const prefix = buildAnalysisSourceVersionId(content) + '|context:'
  return version.startsWith(prefix) && isStoredChapterReviewSignature(version.slice(prefix.length), content, contextVersion)
}
