import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestStatus } from './request-state.js'
import { reloadRequestMessage } from './reload-request.js'

test('reload status reports progress, completion, and retryable failures', () => {
  assert.equal(reloadRequestMessage({ status: RequestStatus.LOADING }), 'Reloading…')
  assert.equal(reloadRequestMessage({ status: RequestStatus.SUCCESS }), 'Review reloaded')
  assert.equal(reloadRequestMessage({
    status: RequestStatus.ERROR,
    error: 'Unable to rebuild snapshot',
  }), 'Unable to rebuild snapshot')
})
