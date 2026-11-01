import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkingTreeChangesRequest } from './working-tree-changes-request.js'

function fixture() {
  const pending = []
  const request = createWorkingTreeChangesRequest({ listChanges: () => new Promise((resolve, reject) => {
    pending.push({ resolve, reject })
  }) })
  return { request, pending }
}

test('each load requests fresh files and clears previous results', async () => {
  const { request, pending } = fixture()
  assert.deepEqual(request.getSnapshot(), { status: 'idle', files: [], error: null })
  const first = request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'loading', files: [], error: null })
  const files = [{ path: 'file.txt', status: 'modified', additions: null, deletions: 0 }]
  pending[0].resolve({ files })
  await first
  assert.deepEqual(request.getSnapshot(), { status: 'success', files, error: null })
  const second = request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'loading', files: [], error: null })
  assert.equal(pending.length, 2)
  pending[1].resolve({ files: [] })
  await second
  assert.deepEqual(request.getSnapshot(), { status: 'success', files: [], error: null })
})

test('a failed request can be retried', async () => {
  const { request, pending } = fixture()
  const first = request.load()
  pending[0].reject(new Error('Repository unavailable'))
  await first
  assert.deepEqual(request.getSnapshot(), { status: 'error', files: [], error: 'Repository unavailable' })
  const retry = request.load()
  assert.deepEqual(request.getSnapshot(), { status: 'loading', files: [], error: null })
  pending[1].resolve({ files: [] })
  await retry
  assert.equal(request.getSnapshot().status, 'success')
})

test('synchronous transport failures become request errors', async () => {
  const request = createWorkingTreeChangesRequest({ listChanges: () => { throw new Error('Bridge unavailable') } })
  await request.load()
  assert.equal(request.getSnapshot().status, 'error')
  assert.equal(request.getSnapshot().error, 'Bridge unavailable')
})

for (const failure of [false, true]) {
  test(`stale ${failure ? 'errors' : 'results'} cannot replace newer results`, async () => {
    const { request, pending } = fixture()
    const first = request.load()
    const second = request.load()
    pending[1].resolve({ files: [{ path: 'current.txt' }] })
    await second
    const current = request.getSnapshot()
    if (failure) pending[0].reject(new Error('Old error'))
    else pending[0].resolve({ files: [{ path: 'old.txt' }] })
    await first
    assert.equal(request.getSnapshot(), current)
  })

  test(`cleanup discards pending ${failure ? 'errors' : 'results'} and permits a new load`, async () => {
    const { request, pending } = fixture()
    let notifications = 0
    const unsubscribe = request.subscribe(() => { notifications += 1 })
    const first = request.load()
    request.cancel()
    unsubscribe()
    const before = request.getSnapshot()
    if (failure) pending[0].reject(new Error('Late error'))
    else pending[0].resolve({ files: [{ path: 'late.txt' }] })
    await first
    assert.equal(request.getSnapshot(), before)
    assert.equal(notifications, 1)
    const second = request.load()
    pending[1].resolve({ files: [] })
    await second
    assert.equal(request.getSnapshot().status, 'success')
    assert.equal(notifications, 1)
  })
}
