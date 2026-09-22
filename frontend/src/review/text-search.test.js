import assert from 'node:assert/strict'
import test from 'node:test'
import { matchSegments, runTextSearch } from './text-search.js'

test('highlights UTF-8 spans after non-ASCII text', () => {
  assert.deepEqual(matchSegments('é 🐈 match!', [{ start: 8, end: 13 }]), [
    { text: 'é 🐈 ', match: false }, { text: 'match', match: true }, { text: '!', match: false },
  ])
})

test('cancelling a pending response suppresses stale results and cancels its job', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = []
  const results = []
  let resolve
  const cancel = runTextSearch('old', false, (result) => results.push(result), (request) => {
    requests.push(request)
    return request.cancel ? Promise.resolve({}) : new Promise((done) => { resolve = done })
  })
  t.mock.timers.tick(180)
  cancel()
  resolve({ status: 'complete', matches: ['old'] })
  await Promise.resolve()
  assert.deepEqual(results, [])
  assert.equal(requests[1].cancel, true)
  assert.equal(requests[0].id, requests[1].id)
})

test('debounce cancels searches before starting and polls running jobs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = []
  const request = async (value) => { requests.push(value); return { status: 'searching' } }
  const cancel = runTextSearch('query', true, () => {}, request)
  t.mock.timers.tick(179)
  assert.equal(requests.length, 0)
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(requests[0].all, true)
  t.mock.timers.tick(75)
  assert.equal(requests[1].query, undefined)
  cancel()
})
