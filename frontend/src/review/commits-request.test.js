import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommitsRequest } from './commits-request.js'

const commits = [
  { sha: 'b'.repeat(40), subject: 'Fix 雪', authorName: 'Test Author', commitDate: '2026-11-03T10:00:00-05:00' },
  { sha: 'a'.repeat(40), subject: 'Earlier commit', authorName: 'Other Author', commitDate: '2026-11-02T09:00:00-05:00' },
]

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

test('loading publishes metadata in API order and each load requests fresh data', async () => {
  let calls = 0
  const request = createCommitsRequest({ list: async () => {
    calls += 1
    return { commits: calls === 1 ? commits : [] }
  } })
  assert.deepEqual(request.getSnapshot(), { status: 'idle', data: [], error: null })
  const states = []
  const unsubscribe = request.subscribe(() => states.push(request.getSnapshot()))
  const first = request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'loading', data: [], error: null })
  await first
  assert.deepEqual(request.getSnapshot(), { status: 'success', data: commits, error: null })
  const second = request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'loading', data: [], error: null })
  await second
  assert.equal(calls, 2)
  assert.deepEqual(request.getSnapshot(), { status: 'success', data: [], error: null })
  assert.deepEqual(states.map(({ status }) => status), ['loading', 'success', 'loading', 'success'])
  unsubscribe()
  await request.load()
  assert.equal(states.length, 4)
})

test('retry clears an error and requests a fresh list', async () => {
  let calls = 0
  const request = createCommitsRequest({ list: async () => {
    if (++calls === 1) throw new Error('Authentication failed')
    return { commits }
  } })
  await request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'error', data: [], error: 'Authentication failed' })
  const retry = request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'loading', data: [], error: null })
  await retry
  assert.equal(calls, 2)
  assert.deepEqual(request.getSnapshot(), { status: 'success', data: commits, error: null })
})

test('synchronous failures discard previous results', async () => {
  let fail = false
  const request = createCommitsRequest({ list: () => {
    if (fail) throw new Error('Bridge unavailable')
    return Promise.resolve({ commits })
  } })
  await request.load()
  fail = true
  await request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'error', data: [], error: 'Bridge unavailable' })
})

for (const failure of [false, true]) {
  for (const newerFinished of [false, true]) {
    test(`stale ${failure ? 'errors' : 'results'} are ignored ${newerFinished ? 'after' : 'before'} newer results`, async () => {
      const pending = []
      const request = createCommitsRequest({ list: () => {
        const next = deferred()
        pending.push(next)
        return next.promise
      } })
      const first = request.load()
      const second = request.load()
      if (newerFinished) {
        pending[1].resolve({ commits })
        await second
      }
      const before = request.getSnapshot()
      if (failure) pending[0].reject(new Error('Old error'))
      else pending[0].resolve({ commits: [{ ...commits[0], sha: 'c'.repeat(40) }] })
      await first
      assert.equal(request.getSnapshot(), before)
      if (!newerFinished) {
        pending[1].resolve({ commits })
        await second
      }
      assert.deepEqual(request.getSnapshot(), { status: 'success', data: commits, error: null })
    })
  }

  test(`cancel ignores a pending ${failure ? 'error' : 'result'} and permits a fresh load`, async () => {
    const pending = deferred()
    let calls = 0
    const request = createCommitsRequest({ list: () => {
      calls += 1
      return calls === 1 ? pending.promise : Promise.resolve({ commits: [] })
    } })
    const first = request.load()
    request.cancel()
    const before = request.getSnapshot()
    if (failure) pending.reject(new Error('Canceled error'))
    else pending.resolve({ commits })
    await first
    assert.equal(request.getSnapshot(), before)
    await request.load()
    assert.equal(calls, 2)
    assert.deepEqual(request.getSnapshot(), { status: 'success', data: [], error: null })
  })
}

test('requests from a previous picker instance cannot affect a new instance', async () => {
  const pending = deferred()
  const previous = createCommitsRequest({ list: () => pending.promise })
  const first = previous.load()
  previous.cancel()
  const current = createCommitsRequest({ list: async () => ({ commits }) })
  await current.load()
  pending.resolve({ commits: [] })
  await first
  assert.deepEqual(current.getSnapshot(), { status: 'success', data: commits, error: null })
})
