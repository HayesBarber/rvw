import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'

import { RequestStatus } from './request-state.js'
import { createReloadReviewRequest, reloadRequestMessage } from './reload-request.js'

const settle = () => setImmediate()

test('reload reports progress and retryable errors', () => {
  assert.equal(reloadRequestMessage({ status: RequestStatus.LOADING }), 'Reloading…')
  assert.equal(reloadRequestMessage({ status: RequestStatus.IDLE }), '')
  assert.equal(reloadRequestMessage({ status: RequestStatus.ERROR, error: 'Unable to replace review' }), 'Unable to replace review')
})

test('successful replacement reloads the document once and blocks submissions until navigation', async () => {
  let complete
  let replacements = 0
  let navigations = 0
  const request = createReloadReviewRequest({
    replace: () => { replacements++; return new Promise((resolve) => { complete = resolve }) },
    reloadDocument: () => { navigations++ },
  })
  assert.equal(request.reload(), true)
  assert.equal(request.getSnapshot().status, RequestStatus.LOADING)
  request.reload()
  assert.equal(replacements, 1)
  assert.equal(navigations, 0)
  complete({ sessionId: 2 })
  await settle()
  assert.equal(navigations, 1)
  request.reload()
  assert.equal(replacements, 1)
  assert.equal(navigations, 1)
})

test('construction failure does not navigate and permits retry', async () => {
  let replacements = 0
  let navigations = 0
  const request = createReloadReviewRequest({
    replace: async () => {
      if (++replacements === 1) throw new Error('Repository unavailable')
      return { sessionId: 2 }
    },
    reloadDocument: () => { navigations++ },
  })
  request.reload()
  await settle()
  assert.equal(request.getSnapshot().error, 'Repository unavailable')
  assert.equal(request.isLocked(), false)
  assert.equal(navigations, 0)
  request.reload()
  await settle()
  assert.equal(replacements, 2)
  assert.equal(navigations, 1)
})

test('selected sources reach the shared replacement operation', async () => {
  const source = { kind: 'working-tree', base: 'a'.repeat(40) }
  const calls = []
  const request = createReloadReviewRequest({
    replace: async (selected) => { calls.push(selected); return { sessionId: 2 } },
    reloadDocument: () => {},
  })
  request.reload(source)
  await settle()
  assert.deepEqual(calls, [source])
})

test('a navigation failure retries document loading without replacing the session again', async () => {
  let replacements = 0
  let navigations = 0
  const request = createReloadReviewRequest({
    replace: async () => { replacements++; return { sessionId: 2 } },
    reloadDocument: () => { if (++navigations === 1) throw new Error('Unable to reload document') },
  })
  request.reload()
  await settle()
  assert.equal(request.getSnapshot().error, 'Unable to reload document')
  assert.equal(request.isLocked(), true)
  request.reload()
  await settle()
  assert.equal(replacements, 1)
  assert.equal(navigations, 2)
})
