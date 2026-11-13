'use strict'

// Development-only gateway for the provider selected in the current browser.
// No configurable destination, saved credentials, request logging or retries.
const http = require('node:http')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const ORIGIN = 'http://127.0.0.1:5173'
const UPSTREAM = 'https://api.ipc.wiki'
const ROUTES = new Map([
  ['/v1/models', 'GET'],
  ['/v1/chat/completions', 'POST'],
  ['/v1/responses', 'POST'],
  ['/v1/messages', 'POST'],
  ['/v1/embeddings', 'POST'],
])
const HEADER_NAMES = ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'anthropic-dangerous-direct-browser-access']
const MAX_BODY_BYTES = 8 * 1024 * 1024

function createModelGateway({ fetchImpl = fetch, maxBodyBytes = MAX_BODY_BYTES, timeoutMs = 300_000 } = {}) {
  const server = http.createServer(async (request, response) => {
    const reject = (status, message) => {
      if (response.destroyed || response.headersSent) return
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ error: { message } }))
    }
    const port = server.address()?.port
    if (request.headers.host !== `127.0.0.1:${port}` || request.headers.origin !== ORIGIN) {
      reject(403, 'Only the local MoJian development page may use this gateway.')
      return
    }
    response.setHeader('Access-Control-Allow-Origin', ORIGIN)
    response.setHeader('Vary', 'Origin')
    const pathname = request.url
    const method = ROUTES.get(pathname)
    if (!method) { reject(404, 'Unsupported model endpoint.'); return }
    if (request.method === 'OPTIONS') {
      const requestedHeaders = String(request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
      if (request.headers['access-control-request-method'] !== method || requestedHeaders.some(name => !HEADER_NAMES.includes(name))) {
        reject(403, 'Unsupported preflight request.'); return
      }
      response.writeHead(204, {
        'Access-Control-Allow-Methods': method,
        'Access-Control-Allow-Headers': HEADER_NAMES.join(', '),
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
      })
      response.end()
      return
    }
    if (request.method !== method) { reject(405, 'Unsupported model method.'); return }
    const authorization = request.headers.authorization
    const apiKey = request.headers['x-api-key']
    if (!(typeof authorization === 'string' && /^Bearer \S+$/.test(authorization)) && !(typeof apiKey === 'string' && apiKey.trim())) {
      reject(401, 'A model API credential is required.'); return
    }
    if (method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''))) {
      reject(415, 'Model requests must use JSON.'); return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const abort = () => controller.abort()
    request.on('aborted', abort)
    response.on('close', () => { if (!response.writableEnded) abort() })
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > maxBodyBytes) { reject(413, 'Model request exceeds the local size limit.'); return }
        chunks.push(chunk)
      }
      const headers = {}
      for (const name of HEADER_NAMES) {
        const value = request.headers[name]
        if (typeof value === 'string') headers[name] = value
      }
      const upstream = await fetchImpl(UPSTREAM + pathname, {
        method, headers, redirect: 'manual', signal: controller.signal,
        ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      })
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel()
        reject(502, 'Provider redirects are not followed; verify the direct provider endpoint.')
        return
      }
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      })
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response)
      else response.end()
    } catch {
      // Never echo a transport exception, request body or credential into logs.
      if (response.headersSent) response.destroy()
      else reject(controller.signal.aborted ? 504 : 502, 'Local model forwarding failed; check provider connectivity.')
    } finally {
      clearTimeout(timer)
      request.off('aborted', abort)
    }
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  return server
}

if (require.main === module) {
  const server = createModelGateway()
  server.on('error', error => {
    console.error(`Local model gateway could not start: ${error.code || 'START_FAILED'}`)
    process.exitCode = 1
  })
  server.listen(5174, '127.0.0.1', () => {
    console.log(`MoJian development model gateway: http://127.0.0.1:5174/v1 -> ${UPSTREAM}/v1`)
    console.log(`Allowed browser origin: ${ORIGIN}; credentials are not stored or logged.`)
  })
}

module.exports = { createModelGateway }
