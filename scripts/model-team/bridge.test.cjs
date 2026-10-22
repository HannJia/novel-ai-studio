const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { completionUrl, externalRole, collectContext, performCall, parseArgs } = require('./bridge.cjs')

const base = path.resolve(__dirname, '../../.local-recovery/model-team/test-fixtures')
fs.mkdirSync(base, { recursive: true })
function fixture() {
  const root = fs.mkdtempSync(path.join(base, 'run-'))
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/code.ts'), 'export const value = 1\n')
  fs.writeFileSync(path.join(root, 'new.ts'), 'untracked source\n')
  return root
}
function config() {
  return {
    requestsEnabled: true,
    providers: {
      relay: { baseUrl: 'https://relay.example.test/v1', protocol: 'openai-chat-completions', apiKeyEnvironmentVariable: 'TEST_RELAY_KEY', models: { sonnet: { actualModelId: 'claude-sonnet-5-5-thinking' }, opus: { actualModelId: 'claude-opus-5-5-thinking' } } },
      deepseek: { baseUrl: 'https://api.deepseek.com', protocol: 'openai-chat-completions', apiKeyEnvironmentVariable: 'TEST_DS_KEY', models: { flash: { actualModelId: 'deepseek-flash' } } }
    },
    roles: { implementer: { provider: 'relay', model: 'sonnet' }, expert: { provider: 'relay', model: 'opus' }, scout: { provider: 'deepseek', model: 'flash' }, reviewer: { provider: 'current-codex-session', model: 'current-session' } }
  }
}
function response(overrides = {}) {
  return new Response(JSON.stringify({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: 'Candidate change; host must verify.' } }], usage: { prompt_tokens: 10, completion_tokens: 7 }, ...overrides }), { status: 200 })
}
function ledger(root) {
  return fs.readFileSync(path.join(root, '.local-recovery/model-team/usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
}
const gitReader = () => 'src/code.ts\0'
const keyResolver = () => 'opaque-local-test-credential'

test('completion URL supports normal, trailing-slash and full Chat Completions addresses', () => {
  assert.equal(completionUrl('https://relay.example.test/v1/'), 'https://relay.example.test/v1/chat/completions')
  assert.equal(completionUrl('https://relay.example.test/v1/chat/completions'), 'https://relay.example.test/v1/chat/completions')
  assert.equal(completionUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions')
})

test('rejects plaintext, embedded credentials, query keys and Responses-only URL', () => {
  for (const url of ['http://relay.example.test/v1', 'https://user:password@relay.example.test/v1', 'https://relay.example.test/v1?key=secret', 'https://relay.example.test/v1#fragment', 'https://relay.example.test/v1/responses']) assert.throws(() => completionUrl(url))
})

test('reviewer stays in Codex and cannot become an external paid request', () => {
  assert.throws(() => externalRole(config(), 'reviewer'), /current Codex session/)
})

test('only explicitly selected tracked source is included; private and untracked files are rejected', () => {
  const root = fixture()
  assert.deepEqual(collectContext(root, ['src/code.ts'], false, gitReader).files, ['src/code.ts'])
  assert.throws(() => collectContext(root, ['new.ts'], false, gitReader), /tracked/)
  fs.mkdirSync(path.join(root, '.local-recovery'))
  fs.writeFileSync(path.join(root, '.local-recovery/credentials.json'), 'private')
  assert.throws(() => collectContext(root, ['.local-recovery/credentials.json'], false, gitReader), /Private/)
  assert.throws(() => collectContext(root, [], true, gitReader), /explicit/)
})

test('context rejects secrets, binary data, excessive size and outside-project paths', () => {
  const root = fixture()
  const source = path.join(root, 'src/code.ts')
  fs.writeFileSync(source, 'sk-' + 'a'.repeat(40))
  assert.throws(() => collectContext(root, ['src/code.ts'], false, gitReader), /credential/)
  fs.writeFileSync(source, 'capability-task-complexity-user-benchmark-screenshots-and-project-validation')
  assert.deepEqual(collectContext(root, ['src/code.ts'], false, gitReader).files, ['src/code.ts'])
  fs.writeFileSync(source, Buffer.from([0, 1, 2]))
  assert.throws(() => collectContext(root, ['src/code.ts'], false, gitReader), /Binary/)
  fs.writeFileSync(source, 'x'.repeat(120001))
  assert.throws(() => collectContext(root, ['src/code.ts'], false, gitReader), /size/)
  const outside = path.join(base, 'outside.ts')
  fs.writeFileSync(outside, 'not this project')
  assert.throws(() => collectContext(root, [outside], false, gitReader), /inside/)
})

test('disabled config and sensitive prompts are rejected before credentials or HTTP are touched', async () => {
  const root = fixture()
  let calls = 0
  const transport = async () => { calls++; return response() }
  const disabled = config()
  disabled.requestsEnabled = false
  await assert.rejects(performCall({ root, config: disabled, task: 'Do a task', fetchImpl: transport, keyResolver }), /disabled/)
  await assert.rejects(performCall({ root, config: config(), task: 'sk-' + 'b'.repeat(40), fetchImpl: transport, keyResolver }), /credential/)
  assert.equal(calls, 0)
})

test('Sonnet proposal uses the exact relay model, does not execute it, and leaves source unchanged', async () => {
  const root = fixture()
  const source = fs.readFileSync(path.join(root, 'src/code.ts'), 'utf8')
  let request
  const result = await performCall({ root, config: config(), role: 'implementer', task: 'Change value to 2; preserve exports.', files: ['src/code.ts'], gitReader, keyResolver,
    fetchImpl: async (url, options) => { request = { url, options, body: JSON.parse(options.body) }; return response() } })
  assert.equal(request.url, 'https://relay.example.test/v1/chat/completions')
  assert.equal(request.body.model, 'claude-sonnet-5-5-thinking')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.body.stream, false)
  assert.match(request.body.messages[1].content, /src\/code.ts/)
  assert.equal(fs.readFileSync(path.join(root, 'src/code.ts'), 'utf8'), source)
  assert.equal(result.requiresHostReviewAndVerification, true)
  assert.match(fs.readFileSync(result.outputFile, 'utf8'), /host must verify/)
  const usage = ledger(root)[0]
  assert.equal(usage.promptTokens, 10)
  assert.equal(usage.costUSD, null)
  assert.ok(!JSON.stringify(usage).includes(keyResolver()))
  assert.ok(!JSON.stringify(usage).includes('Change value'))
})

test('Opus routes to the relay; DeepSeek routes only to the official host', async () => {
  const root = fixture()
  const requests = []
  for (const role of ['expert', 'scout']) await performCall({ root, config: config(), role, task: 'Analyze the task.', keyResolver, fetchImpl: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return response() } })
  assert.equal(requests[0].body.model, 'claude-opus-5-5-thinking')
  assert.equal(requests[0].url, 'https://relay.example.test/v1/chat/completions')
  assert.equal(requests[1].url, 'https://api.deepseek.com/chat/completions')
  assert.equal(requests[1].body.model, 'deepseek-flash')
  assert.deepEqual(requests[1].body.thinking, { type: 'disabled' })
})

test('HTTP errors and network failures never retry and never log credential-bearing error bodies', async () => {
  const root = fixture()
  let calls = 0
  await assert.rejects(performCall({ root, config: config(), task: 'Analyze.', keyResolver, fetchImpl: async () => { calls++; return new Response(keyResolver(), { status: 401 }) } }), /HTTP 401/)
  await assert.rejects(performCall({ root, config: config(), task: 'Analyze.', keyResolver, fetchImpl: async () => { calls++; throw new Error(keyResolver()) } }), /no automatic retry/)
  assert.equal(calls, 2)
  const usage = ledger(root)
  assert.ok(usage.every(item => item.success === false && item.costUSD === null))
  assert.ok(!JSON.stringify(usage).includes(keyResolver()))
})

test('missing usage remains unknown and credential echoes are rejected', async () => {
  const root = fixture()
  await performCall({ root, config: config(), task: 'Analyze.', keyResolver, fetchImpl: async () => response({ usage: {} }) })
  assert.equal(ledger(root)[0].completionTokens, null)
  await assert.rejects(performCall({ root, config: config(), task: 'Analyze.', keyResolver, fetchImpl: async () => response({ model: keyResolver(), choices: [{ finish_reason: 'stop', message: { content: keyResolver() } }] }) }), /credential/)
  assert.ok(!fs.readFileSync(path.join(root, '.local-recovery/model-team/usage.jsonl'), 'utf8').includes(keyResolver()))
})

test('truncated output is recorded as failed and never applied or silently retried', async () => {
  const root = fixture()
  await assert.rejects(performCall({ root, config: config(), task: 'Analyze.', keyResolver, fetchImpl: async () => response({ choices: [{ finish_reason: 'length', message: { content: 'incomplete diff' } }] }) }), /truncated/)
  const usage = ledger(root)[0]
  assert.equal(usage.finishReason, 'length')
  assert.equal(usage.completionTokens, 7)
  assert.equal(usage.success, false)
})

test('argument parser supports explicit file selection and detects malformed arguments', () => {
  assert.deepEqual(parseArgs(['run', '--role', 'implementer', '--task-file', 'task.md', '--files', 'src/a.ts', 'src/b.ts', '--diff']), { command: 'run', role: 'implementer', taskFile: 'task.md', files: ['src/a.ts', 'src/b.ts'], includeDiff: true })
  assert.throws(() => parseArgs(['run', '--role']), /Missing/)
  assert.throws(() => parseArgs(['run', '--unknown']), /Unknown/)
})
