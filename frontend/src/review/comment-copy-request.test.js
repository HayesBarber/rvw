import assert from 'node:assert/strict'
import test from 'node:test'

import { copyRequestMessage } from './comment-copy-request.js'
import { RequestStatus } from './request-state.js'

test('comment-copy request states retain their existing status messages', () => {
  assert.equal(copyRequestMessage({ status: RequestStatus.IDLE }), '')
  assert.equal(copyRequestMessage({ status: RequestStatus.LOADING }), 'Copying…')
  assert.equal(copyRequestMessage({
    status: RequestStatus.ERROR,
    error: 'Clipboard unavailable',
  }), 'Clipboard unavailable')
  assert.equal(copyRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 1 },
  }), 'Copied 1 comment')
  assert.equal(copyRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { commentCount: 2 },
  }), 'Copied 2 comments')
})
