import { buildAnalysisSourceVersionId } from './reconstructionCandidates'

// Shared by the renderer and isolated project validator; no stores or UI dependencies.
export function buildChapterReviewSignature(content: string, contextVersion: string): string {
  return 'review-v8:' + buildAnalysisSourceVersionId(content) + ':' + contextVersion
}

export function buildChapterReviewSourceVersion(content: string, contextVersion: string): string {
  return buildAnalysisSourceVersionId(content) + '|context:' + buildChapterReviewSignature(content, contextVersion)
}

/** Storage preserves recognized historical identities; execution still requires the current builder above. */
export function isStoredChapterReviewSignature(signature: string, content: string, contextVersion: string): boolean {
  const suffix = buildAnalysisSourceVersionId(content) + ':' + contextVersion
  return [4, 5, 6, 7, 8].some(version => signature === 'review-v' + version + ':' + suffix)
}

export function isStoredChapterReviewSourceVersion(version: string, content: string, contextVersion: string): boolean {
  const prefix = buildAnalysisSourceVersionId(content) + '|context:'
  return version.startsWith(prefix) && isStoredChapterReviewSignature(version.slice(prefix.length), content, contextVersion)
}
