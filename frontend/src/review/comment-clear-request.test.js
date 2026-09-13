import assert from 'node:assert/strict'
import test from 'node:test'

import { clearRequestMessage } from './comment-clear-request.js'
import { RequestStatus } from './request-state.js'

test('comment-clear request states retain their existing status messages', () => {
  assert.equal(clearRequestMessage({ status: RequestStatus.IDLE }), '')
  assert.equal(clearRequestMessage({ status: RequestStatus.LOADING }), 'Clearing…')
  assert.equal(clearRequestMessage({
    status: RequestStatus.ERROR,
    error: 'Unable to clear comments',
  }), 'Unable to clear comments')
  assert.equal(clearRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 1 },
  }), 'Cleared 1 comment')
  assert.equal(clearRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 2 },
  }), 'Cleared 2 comments')
})
