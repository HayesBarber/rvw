import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestStatus } from './request-state.js'
import { BLOCKED_DURING_DRAFT_MESSAGE, reloadRequestMessage } from './reload-request.js'

test('reload status reports progress, completion, and retryable failures', () => {
  assert.equal(reloadRequestMessage({ status: RequestStatus.LOADING }), 'Reloading…')
  assert.equal(reloadRequestMessage({ status: RequestStatus.SUCCESS }), 'Review reloaded')
  assert.equal(reloadRequestMessage({
    status: RequestStatus.ERROR,
    error: 'Unable to rebuild snapshot',
  }), 'Unable to rebuild snapshot')
})

test('blocked-reload message names cancelling the draft', () => {
  assert.equal(BLOCKED_DURING_DRAFT_MESSAGE, 'Cancel the comment draft, then reload.')
  assert.ok(BLOCKED_DURING_DRAFT_MESSAGE.length <= 38)
})
