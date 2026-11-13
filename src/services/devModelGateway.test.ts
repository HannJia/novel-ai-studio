import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const require = createRequire(import.meta.url)
const { createModelGateway } = require('../../scripts/dev-model-gateway.cjs') as {
  createModelGateway(options: { fetchImpl: typeof fetch; maxBodyBytes?: number; timeoutMs?: number }): Server
}
const servers: Server[] = []
const origin = 'http://127.0.0.1:5173'
const headers = { Origin: origin, Authorization: 'Bearer synthetic-test-key' }
async function start(fetchImpl = vi.fn<typeof fetch>(), options = {}) {
  const server = createModelGateway({ fetchImpl, ...options })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, fetchImpl }
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

describe('development model gateway', () => {
  it('accepts the exact local preflight without contacting the provider', async () => {
    const { url, fetchImpl } = await start()
    const response = await fetch(url + '/v1/models', { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
    } })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['https://outside.example', 'null', ''])('rejects an unapproved browser origin %s', async unapproved => {
    const { url, fetchImpl } = await start()
    const response = await fetch(url + '/v1/models', { headers: { ...headers, Origin: unapproved } })
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects another host and arbitrary endpoint paths', async () => {
    const { url, fetchImpl } = await start()
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(url + '/v1/models', { headers: { ...headers, Host: 'other.example' } }, response => {
        response.resume()
        resolve(response.statusCode)
      })
      request.on('error', reject)
      request.end()
    })
    expect(hostStatus).toBe(403)
    for (const path of ['/admin', '/v1/models?target=https://other.example', '/v1/%2fmodels']) {
      expect((await fetch(url + path, { headers })).status).toBe(404)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('forwards only selected headers to the fixed HTTPS destination', async () => {
    const { url, fetchImpl } = await start(vi.fn<typeof fetch>().mockResolvedValue(new Response('{"data":[{"id":"test-model"}]}')))
    const response = await fetch(url + '/v1/models', { headers: { ...headers, Cookie: 'private=not-forwarded' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ id: 'test-model' }] })
    const [target, init] = fetchImpl.mock.calls[0]
    expect(target).toBe('https://api.ipc.wiki/v1/models')
    expect(init).toMatchObject({ redirect: 'manual', headers: { authorization: 'Bearer synthetic-test-key' } })
    expect(init?.headers).not.toHaveProperty('origin')
    expect(init?.headers).not.toHaveProperty('cookie')
  })
  it('preserves provider authorization failures without following redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":"invalid key"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'https://other.example' } }))
    const { url } = await start(fetchImpl)
    const rejected = await fetch(url + '/v1/models', { headers })
    expect(rejected.status).toBe(401)
    expect(await rejected.json()).toEqual({ error: 'invalid key' })
    const redirected = await fetch(url + '/v1/models', { headers })
    expect(redirected.status).toBe(502)
    expect(redirected.headers.get('location')).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('preserves streamed output and the exact JSON request body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: first\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    const { url } = await start(fetchImpl)
    const body = JSON.stringify({ model: 'test-model', stream: true, messages: [] })
    const response = await fetch(url + '/v1/chat/completions', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe('data: first\n\ndata: [DONE]\n\n')
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toBe(body)
  })
  it('bounds request size and rejects unsupported methods and content types', async () => {
    const { url, fetchImpl } = await start(undefined, { maxBodyBytes: 8 })
    expect((await fetch(url + '/v1/models', { headers: { Origin: origin } })).status).toBe(401)
    expect((await fetch(url + '/v1/models', { method: 'POST', headers })).status).toBe(405)
    expect((await fetch(url + '/v1/chat/completions', { method: 'POST', headers, body: '{}' })).status).toBe(415)
    expect((await fetch(url + '/v1/chat/completions', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"long":"value"}' })).status).toBe(413)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('redacts transport errors and never retries a request', async () => {
    const { url, fetchImpl } = await start(vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-secret-in-exception')))
    const response = await fetch(url + '/v1/models', { headers })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('synthetic-secret')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('cancels the upstream request when the browser disconnects', async () => {
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    let upstreamSignal: AbortSignal | undefined
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      upstreamSignal = init?.signal as AbortSignal
      upstreamSignal.addEventListener('abort', () => reject(upstreamSignal?.reason), { once: true })
      started()
    }))
    const { url } = await start(fetchImpl)
    const controller = new AbortController()
    const pending = fetch(url + '/v1/models', { headers, signal: controller.signal }).catch(error => error)
    await entered
    controller.abort()
    expect((await pending).name).toBe('AbortError')
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('bounds upstream waiting without echoing credentials', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('synthetic-secret')), { once: true })
    }))
    const { url } = await start(fetchImpl, { timeoutMs: 30 })
    const response = await fetch(url + '/v1/models', { headers })
    expect(response.status).toBe(504)
    expect(await response.text()).not.toContain('synthetic-secret')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
