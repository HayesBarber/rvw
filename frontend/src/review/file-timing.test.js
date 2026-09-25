import assert from 'node:assert/strict'
import test from 'node:test'
import { configureFileTiming, startFileTiming, recordFileRender } from './file-timing.js'
import { getFile, getFileDiff } from './api.js'

test('timing is opt-in and superseded traces ignore late responses and render callbacks', () => {
  configureFileTiming(false)
  assert.equal(startFileTiming('private-content', true), undefined)
  configureFileTiming(true)
  const events = []
  let clock = 10
  const trace = startFileTiming('private-content', true, { now: () => clock, emit: (event) => events.push(event) })
  clock = 25
  trace.finish('superseded')
  trace.attach({ content: { kind: 'file' } })
  trace.render({}, 'mount')
  trace.finish('error')
  assert.deepEqual(events.map((event) => event.context.stage), ['request_schedule', 'superseded'])
  assert.equal(events[1].context.durationMs, 15)
  assert.equal(new Set(events.map((event) => event.traceId)).size, 1)
  assert(!JSON.stringify(events).includes('private-content'))
  configureFileTiming(false)
})

test('visible content is recorded once after two frames and completed loads differ from superseded loads', () => {
  configureFileTiming(true)
  const events = [], frames = []
  const previous = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => frames.push(fn)
  try {
    const trace = startFileTiming('file.js', false, { now: () => 20, emit: (event) => events.push(event) })
    const file = { content: { kind: 'file', file: { contents: 'PRIVATE' } } }
    trace.attach(file)
    const node = { isConnected: true, shadowRoot: { querySelector: () => ({}) } }
    recordFileRender(file, node, 'mount')
    recordFileRender(file, node, 'update')
    assert(!events.some((event) => event.context.stage === 'visible'))
    frames.shift()()
    frames.shift()()
    trace.finish('superseded')
    assert.equal(events.filter((event) => event.context.stage === 'visible').length, 1)
    assert.equal(events.filter((event) => event.context.stage === 'highlight_tokens').length, 1)
    assert.equal(events.at(-1).context.stage, 'completed')
    assert(!JSON.stringify(events).includes('PRIVATE'))
  } finally {
    globalThis.requestAnimationFrame = previous
    configureFileTiming(false)
  }
})

test('file trace IDs cross HTTP and native transports without changing response data', async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch
  const stages = [], requests = []
  const timing = { traceId: 'test-188', now: () => 0, stage: (stage) => stages.push(stage) }
  const data = { content: { kind: 'file' } }
  try {
    globalThis.window = {}
    globalThis.fetch = async (url) => { requests.push(url); return { ok: true, json: async () => data } }
    assert.equal(await getFile('private.js', timing), data)
    assert.equal(await getFileDiff('active', 'private.js', timing), data)
    assert(requests.every((url) => url.endsWith('&traceId=test-188')))
    assert.deepEqual(stages, ['http_headers', 'response_read_parse', 'http_headers', 'response_read_parse'])
    globalThis.window = { webkit: { messageHandlers: { native: { postMessage: async (request) => { requests.push(request); return data } } } } }
    assert.equal(await getFile('private.js', timing), data)
    assert.equal(requests.at(-1).traceId, 'test-188')
    assert.equal(stages.at(-1), 'native_roundtrip')
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch }
})
