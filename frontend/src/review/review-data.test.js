import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCommentMutationTracker,
  isCurrentCommentFetch,
  removeDeletedComment,
  replaceEditedComment,
  settleCommentFetch,
} from './comments-request.js'

const original = [{
  id: 'comment-1',
  body: 'before',
  target: { kind: 'file', path: 'README.md' },
}, {
  id: 'comment-2',
  body: 'other',
  target: { kind: 'file', path: 'LICENSE' },
}]

test('successful edits replace only the intended comment', () => {
  const edited = {
    id: 'comment-1',
    body: 'after',
    target: original[0].target,
  }
  const result = replaceEditedComment(original, edited)

  assert.deepEqual(result, [edited, original[1]])
  assert.equal(result[1], original[1])
})

test('successful deletes remove only the intended comment', () => {
  assert.deepEqual(removeDeletedComment(original, 'comment-1'), [original[1]])
  assert.deepEqual(removeDeletedComment(original, 'stale-comment'), original)
})

test('a fetch started before a successful mutation cannot restore stale state', () => {
  assert.equal(isCurrentCommentFetch(3, 3), true)
  assert.equal(isCurrentCommentFetch(3, 4), false)
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('deferred stale fetch success and failure are ignored after mutation', async () => {
  const successfulFetch = deferred()
  const successTracker = createCommentMutationTracker()
  const successes = []
  const failures = []
  const settlingSuccess = settleCommentFetch(successfulFetch.promise, successTracker, {
    success: (comments) => successes.push(comments),
    failure: (error) => failures.push(error),
  })
  successTracker.recordMutation()
  successfulFetch.resolve(original)
  await settlingSuccess

  const failedFetch = deferred()
  const failureTracker = createCommentMutationTracker()
  const settlingFailure = settleCommentFetch(failedFetch.promise, failureTracker, {
    success: (comments) => successes.push(comments),
    failure: (error) => failures.push(error),
  })
  failureTracker.recordMutation()
  failedFetch.reject(new Error('older fetch failed'))
  await settlingFailure

  assert.deepEqual(successes, [])
  assert.deepEqual(failures, [])
})

test('current deferred fetches still report success and failure', async () => {
  const tracker = createCommentMutationTracker()
  const successes = []
  const failures = []
  await settleCommentFetch(Promise.resolve(original), tracker, {
    success: (comments) => successes.push(comments),
    failure: (error) => failures.push(error),
  })
  await settleCommentFetch(Promise.reject(new Error('current failure')), tracker, {
    success: (comments) => successes.push(comments),
    failure: (error) => failures.push(error.message),
  })
  assert.deepEqual(successes, [original])
  assert.deepEqual(failures, ['current failure'])
})
