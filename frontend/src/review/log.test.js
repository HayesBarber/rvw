import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sendLogEvent, MAX_PENDING_LOGS, LOG_TIMEOUT_MS } from './api.js'
import { installGlobalLogging, measureOverviewRequest } from './log.js'

const settle = () => new Promise((resolve) => queueMicrotask(resolve))

test('relay preserves JSON on native and HTTP and swallows every failure', async () => {
  const event = { level: 'debug', message: 'api request', traceId: 'op-1', context: { nested: [true, null, 3] } }
  const submissions = []
  globalThis.window = { webkit: { messageHandlers: { native: { postMessage: (body) => {
    submissions.push(body)
    return Promise.resolve({ accepted: true })
  } } } } }
  assert.equal(sendLogEvent(event), undefined)
  await settle()
  assert.deepEqual(submissions, [{ ...event, type: 'log' }])
  globalThis.window = {}
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (url, options) => {
      assert.equal(url, '/api/log')
      assert.deepEqual(JSON.parse(options.body), { ...event, type: 'log' })
      return Promise.resolve({ ok: false, status: 500 })
    }
    sendLogEvent(event)
    await settle()
    globalThis.fetch = () => Promise.reject(new Error('secret rejection'))
    sendLogEvent(event)
    await settle()
    globalThis.fetch = () => { throw new Error('secret synchronous failure') }
    sendLogEvent(event)
    const circular = {}; circular.self = circular
    sendLogEvent({ ...event, context: circular })
    sendLogEvent({ ...event, context: { toJSON() { throw new Error('secret') } } })
    globalThis.window = { webkit: { messageHandlers: { native: { postMessage() { throw new Error('bridge') } } } } }
    sendLogEvent(event)
    window.webkit.messageHandlers.native.postMessage = () => Promise.reject(new Error('bridge reply'))
    sendLogEvent(event)
    await settle()
  } finally { globalThis.fetch = originalFetch }
})

test('global capture is once per page and never forwards sensitive event properties', async () => {
  const events = []
  const listeners = new Map()
  globalThis.window = {
    webkit: { messageHandlers: { native: { postMessage: (event) => { events.push(event) } } } },
    addEventListener: (name, callback) => listeners.set(name, callback),
  }
  installGlobalLogging()
  installGlobalLogging()
  let prevented = false
  const sensitive = {
    message: '/secret/repo password=abc', filename: 'https://user:password@example.com',
    error: new Error('credential secret'), reason: { body: 'private comment', token: 'secret' },
    preventDefault: () => { prevented = true },
  }
  listeners.get('error')(sensitive)
  listeners.get('unhandledrejection')(sensitive)
  await settle()
  assert.deepEqual(events, [
    { type: 'log', level: 'info', message: 'frontend started' },
    { type: 'log', level: 'error', message: 'frontend error' },
    { type: 'log', level: 'error', message: 'frontend unhandled rejection' },
  ])
  assert.equal(prevented, false)
})

test('overview timing covers success, rejection and synchronous failure without error contents', async () => {
  const events = []
  window.webkit.messageHandlers.native.postMessage = (event) => { events.push(event) }
  assert.equal(await measureOverviewRequest(() => Promise.resolve(7)), 7)
  const failure = new Error('private URL or payload')
  await assert.rejects(measureOverviewRequest(() => Promise.reject(failure)), (error) => error === failure)
  await assert.rejects(measureOverviewRequest(() => { throw failure }), (error) => error === failure)
  assert.deepEqual(events.map((event) => event.context.status), ['ok', 'error', 'error'])
  for (const event of events) {
    assert.equal(event.message, 'api request')
    assert.equal(event.level, 'debug')
    assert.equal(event.context.operation, 'get_diff_overview')
    assert.ok(event.context.durationMs >= 0)
    assert.deepEqual(Object.keys(event.context).sort(), ['durationMs', 'operation', 'status'])
  }
})

test('stalled relays are bounded, time out, and cannot accumulate more bridge work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let count = 0
  window.webkit.messageHandlers.native.postMessage = () => { count += 1; return new Promise(() => {}) }
  for (let index = 0; index < 100; index += 1) sendLogEvent({ level: 'error', message: 'test' })
  assert.equal(count, MAX_PENDING_LOGS)
  t.mock.timers.tick(LOG_TIMEOUT_MS)
  for (let index = 0; index < 100; index += 1) sendLogEvent({ level: 'error', message: 'test' })
  assert.equal(count, MAX_PENDING_LOGS)
})
