import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { sendLogEvent } from './api.js'
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
