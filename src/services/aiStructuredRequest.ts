/** Explicit opt-in for short JSON decisions; callers must also request JSON in their prompt. */
export type StructuredOutputMode = 'concise-json'

interface StructuredRequestFields {
  thinking?: { type: 'disabled' }
  response_format?: { type: 'json_object' }
}

/** Do not infer capabilities from a display name or an OpenAI-compatible API. */
export function structuredRequestFields(
  model: { baseUrl: string; modelName: string },
  mode?: StructuredOutputMode,
): StructuredRequestFields {
  if (mode !== 'concise-json' || !['deepseek-flash', 'deepseek-v4-pro'].includes(model.modelName)) return {}
  // Validate the raw spelling as well as the parsed URL: URL normalizes dot
  // segments, escaped hostnames, backslashes and empty credentials/query/hash.
  if (model.baseUrl !== model.baseUrl.trim()
    || !/^https:\/\/api\.deepseek\.com(?::443)?(?:\/|\/v1\/?)?$/i.test(model.baseUrl)) return {}
  try {
    const url = new URL(model.baseUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com' || url.port
      || url.username || url.password || url.search || url.hash
      || !['/', '/v1', '/v1/'].includes(url.pathname)) return {}
  } catch { return {} }
  return { thinking: { type: 'disabled' }, response_format: { type: 'json_object' } }
}
