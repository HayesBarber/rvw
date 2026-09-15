import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestStatus } from './request-state.js'
import { filePathCopyRequestMessage } from './file-path-copy-request.js'

test('file path copy status identifies the copied format and failures', () => {
  assert.equal(filePathCopyRequestMessage({ status: RequestStatus.LOADING }), 'Copying path…')
  assert.equal(filePathCopyRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { format: 'relative' },
  }), 'Path copied')
  assert.equal(filePathCopyRequestMessage({
    status: RequestStatus.SUCCESS,
    data: { format: 'absolute' },
  }), 'Absolute path copied')
  assert.equal(filePathCopyRequestMessage({
    status: RequestStatus.ERROR,
    error: 'Clipboard failed',
  }), 'Clipboard failed')
})
