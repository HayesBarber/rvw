import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextSearchRequest } from './text-search-request.js'

const result = (path) => ({ matches: [{ path }], truncated: false })
const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

test('debounce uses the latest query and mode; empty queries do not search', async () => {
  const calls = []
  const request = createTextSearchRequest({ delay: 0, search: async (...args) => {
    calls.push(args)
    return result('current')
  } })
  assert.equal(request.getSnapshot().status, 'idle')
  request.update('old')
  request.update('new', 'all-files')
  assert.equal(request.getSnapshot().status, 'loading')
  await flush()
  assert.deepEqual(calls, [['new', 'all-files']])
  assert.equal(request.getSnapshot().status, 'success')
  request.update('')
  assert.deepEqual(request.getSnapshot().matches, [])
  await flush()
  assert.equal(calls.length, 1)
})

for (const staleFailure of [false, true]) {
  test(`old ${staleFailure ? 'errors' : 'results'} cannot replace a new query or mode`, async () => {
    const pending = []
    const request = createTextSearchRequest({ delay: 0, search: () => new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
    }) })
    request.update('one')
    await flush()
    request.update('two', 'all-files')
    assert.deepEqual(request.getSnapshot().matches, [])
    // The old completion is stale even before the next debounce finishes.
    if (staleFailure) pending[0].reject(new Error('old error'))
    else pending[0].resolve(result('old'))
    await flush()
    assert.equal(request.getSnapshot().status, 'loading')
    pending[1].resolve({ ...result('new'), truncated: true })
    await flush()
    assert.equal(request.getSnapshot().matches[0].path, 'new')
    assert.equal(request.getSnapshot().truncated, true)
    assert.equal(request.getSnapshot().error, null)
  })
}

test('clear and close invalidate in-flight requests', async () => {
  for (const close of [false, true]) {
    let complete
    const request = createTextSearchRequest({ delay: 0, search: () => new Promise((resolve) => { complete = resolve }) })
    request.update('text')
    await flush()
    if (close) request.cancel()
    else request.update('')
    const before = request.getSnapshot()
    complete(result('late'))
    await flush()
    assert.equal(request.getSnapshot(), before)
  }
})

test('errors can be retried; no results and selection bounds remain valid', async () => {
  let fail = true
  const request = createTextSearchRequest({ delay: 0, search: async () => {
    if (fail) throw new Error('Install ripgrep')
    return { matches: [], truncated: false }
  } })
  request.update('text')
  await flush()
  assert.equal(request.getSnapshot().error, 'Install ripgrep')
  fail = false
  request.update('text')
  await flush()
  assert.equal(request.getSnapshot().status, 'success')
  assert.deepEqual(request.getSnapshot().matches, [])
  request.select(10)
  assert.equal(request.getSnapshot().activeIndex, 0)
})

test('mode-only changes discard older results that finish last', async () => {
  const pending = []
  const request = createTextSearchRequest({ delay: 0, search: (query, mode) => new Promise((resolve) => {
    pending.push({ mode, resolve })
  }) })
  request.update('same')
  await flush()
  request.update('same', 'all-files')
  await flush()
  pending[1].resolve(result('ignored.txt'))
  await flush()
  pending[0].resolve(result('old.txt'))
  await flush()
  assert.equal(request.getSnapshot().matches[0].path, 'ignored.txt')
  assert.deepEqual(pending.map(({ mode }) => mode), ['ignore-aware', 'all-files'])
})
