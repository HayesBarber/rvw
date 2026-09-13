import assert from 'node:assert/strict'
import test from 'node:test'

import { transientRequestMessage } from './transient-request.js'
import { RequestStatus } from './request-state.js'

test('transient request messages interpolate the action and comment count', () => {
  const verbs = { inProgress: 'Copying…', completed: 'Copied' }

  assert.equal(transientRequestMessage({ status: RequestStatus.IDLE }, verbs), '')
  assert.equal(transientRequestMessage({ status: RequestStatus.LOADING }, verbs), 'Copying…')
  assert.equal(transientRequestMessage({
    status: RequestStatus.ERROR,
    error: 'Clipboard unavailable',
  }, verbs), 'Clipboard unavailable')
  assert.equal(transientRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 1 },
  }, verbs), 'Copied 1 comment')
  assert.equal(transientRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 2 },
  }, verbs), 'Copied 2 comments')
})

test('cleared requests interpolate their own action verb', () => {
  const verbs = { inProgress: 'Clearing…', completed: 'Cleared' }

  assert.equal(transientRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 3 },
  }, verbs), 'Cleared 3 comments')
})
