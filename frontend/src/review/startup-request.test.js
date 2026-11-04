import assert from 'node:assert/strict'
import test from 'node:test'
import { createStartupRequest } from './startup-request.js'
import { createReviewTransport } from './transport.js'

const settle = () => Promise.resolve()

test('startup shares pending work and can retry a failed session load', async () => {
  let calls = 0
  let complete
  const startup = createStartupRequest({ initialize: () => {
    calls++
    return new Promise((resolve, reject) => { complete = { resolve, reject } })
  } })
  const first = startup.load()
  assert.equal(startup.load(), first)
  await settle()
  complete.reject(new Error('Service unavailable'))
  await first
  assert.equal(startup.getSnapshot().status, 'error')
  assert.equal(startup.getSnapshot().error, 'Service unavailable')
  const retry = startup.load()
  await settle()
  complete.resolve({ id: 2 })
  await retry
  assert.equal(startup.getSnapshot().status, 'success')
  assert.equal(calls, 2)
})

test('retry after replacement reads the active session without another reset', async () => {
  const calls = []
  let failOverview = true
  const transport = createReviewTransport({ getNative: () => ({ postMessage: async (request) => {
    calls.push(request)
    if (request.type === 'get_review_session') return { id: 2 }
    assert.equal(request.sessionId, 2)
    if (failOverview) throw new Error('Unable to load review')
    return { id: 'same-snapshot', source: { kind: 'working-tree', base: 'base' } }
  } }) })
  const startup = createStartupRequest({ initialize: async () => {
    await transport.initialize()
    await transport.request('/api/diffs/active', { type: 'get_diff_overview' })
  } })
  await startup.load()
  assert.equal(startup.getSnapshot().status, 'error')
  failOverview = false
  await startup.load()
  assert.equal(startup.getSnapshot().status, 'success')
  assert.deepEqual(calls.map((request) => request.type), ['get_review_session', 'get_diff_overview', 'get_diff_overview'])
})
