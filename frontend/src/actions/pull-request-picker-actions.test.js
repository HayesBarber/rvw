import assert from 'node:assert/strict'
import test from 'node:test'
import { createPullRequestSubmitHandler } from './pull-request-picker-actions.js'
import { createPullRequestsRequest } from '../review/pull-requests-request.js'

test('submission reports only the PR number', () => {
  const calls = []
  const submit = createPullRequestSubmitHandler({
    getRequest: () => ({ status: 'success', data: [{ number: 42 }, { number: 7 }] }),
    onSelect: (...args) => calls.push(args),
  })
  assert.equal(submit(7), true)
  assert.equal(submit(42), true)
  assert.deepEqual(calls, [[7], [42]])
})

test('submission requires loaded data, an available PR, and a callback', () => {
  for (const state of [
    { status: 'idle', data: [{ number: 42 }] },
    { status: 'loading', data: [{ number: 42 }] },
    { status: 'error', data: [{ number: 42 }], error: 'Failed' },
    { status: 'success', data: [] },
    { status: 'success', data: [{ number: 7 }] },
  ]) {
    const submit = createPullRequestSubmitHandler({
      getRequest: () => state,
      onSelect: () => assert.fail('Submitted an unavailable PR'),
    })
    assert.equal(submit(42), false)
  }
  const submit = createPullRequestSubmitHandler({
    getRequest: () => ({ status: 'success', data: [{ number: 42 }] }),
  })
  assert.equal(submit(42), false)
})

test('an old tile handler checks current data during retry and after replacement', async () => {
  let calls = 0
  let complete
  const request = createPullRequestsRequest({ list: () => {
    if (++calls === 1) return Promise.resolve({ pullRequests: [{ number: 42 }] })
    return new Promise((resolve) => { complete = resolve })
  } })
  const selected = []
  const submit = createPullRequestSubmitHandler({
    getRequest: request.getSnapshot, onSelect: (number) => selected.push(number),
  })
  await request.load()
  const oldTileClick = () => submit(42)
  assert.equal(oldTileClick(), true)
  const retry = request.load()
  assert.equal(oldTileClick(), false)
  complete({ pullRequests: [{ number: 7 }] })
  await retry
  assert.equal(oldTileClick(), false)
  assert.equal(submit(7), true)
  assert.deepEqual(selected, [42, 7])
})
