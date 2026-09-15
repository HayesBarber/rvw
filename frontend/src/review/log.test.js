import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { sendLogEvent, MAX_PENDING_LOGS, LOG_TIMEOUT_MS } from './api.js'
import { installGlobalLogging } from './log.js'

const settle = () => setImmediate()

test('relay preserves JSON on native and HTTP and swallows every failure', async () => {
  const event = { level: 'error', message: 'frontend error', traceId: 'op-1', context: { nested: [true, null, 3] } }
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
  assert.deepEqual(events, [])
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
    { type: 'log', level: 'error', message: 'frontend error' },
    { type: 'log', level: 'error', message: 'frontend unhandled rejection' },
  ])
  assert.equal(prevented, false)
})

test('native relay pauses on timeout and resumes only after every late reply settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const replies = []
  let count = 0
  window.webkit.messageHandlers.native.postMessage = () => {
    count += 1
    return new Promise((resolve, reject) => replies.push({ resolve, reject }))
  }
  const send = () => sendLogEvent({ level: 'error', message: 'test' })
  for (let index = 0; index < 100; index += 1) send()
  assert.equal(count, MAX_PENDING_LOGS)
  t.mock.timers.tick(LOG_TIMEOUT_MS)
  await settle()
  send()
  assert.equal(count, MAX_PENDING_LOGS)
  replies[0].reject(new Error('late failure'))
  await settle()
  send()
  assert.equal(count, MAX_PENDING_LOGS)
  for (const reply of replies.slice(1)) reply.resolve()
  await settle()
  window.webkit.messageHandlers.native.postMessage = () => { count += 1 }
  send()
  await settle()
  assert.equal(count, MAX_PENDING_LOGS + 1)
})

test('HTTP relay aborts stalled work and accepts new events after timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.window = {}
  const originalFetch = globalThis.fetch
  let aborted = false
  let count = 0
  try {
    globalThis.fetch = (_url, { signal }) => {
      count += 1
      if (count > 1) return Promise.resolve({ ok: true })
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    }
    sendLogEvent({ level: 'error', message: 'test' })
    t.mock.timers.tick(LOG_TIMEOUT_MS)
    await settle()
    assert.equal(aborted, true)
    sendLogEvent({ level: 'error', message: 'test' })
    await settle()
    assert.equal(count, 2)
  } finally { globalThis.fetch = originalFetch }
})
