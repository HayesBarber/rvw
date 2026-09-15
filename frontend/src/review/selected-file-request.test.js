import assert from 'node:assert/strict'
import test from 'node:test'

import { RequestStatus } from './request-state.js'
import {
  fileRequestKey,
  selectFileRequest,
} from './selected-file-request.js'

test('selected-file keys distinguish changed diffs from repository files', () => {
  assert.equal(fileRequestKey('diff-1', 'src/main.js', true), '0\u0000diff-1\u0000src/main.js')
  assert.equal(fileRequestKey('diff-1', 'src/main.js', false), '0\u0000file\u0000src/main.js')
  assert.notEqual(
    fileRequestKey('diff-1', 'src/main.js', true, 1),
    fileRequestKey('diff-1', 'src/main.js', true, 2),
  )
  assert.equal(fileRequestKey(null, 'src/main.js', true), null)
  assert.equal(fileRequestKey('diff-1', null, false), null)
})

test('switching files hides stale data behind the new loading state', () => {
  const current = {
    status: RequestStatus.SUCCESS,
    key: fileRequestKey('diff-1', 'old.js', true),
    path: 'old.js',
    data: { path: 'old.js' },
    error: null,
  }
  const nextKey = fileRequestKey('diff-1', 'new.js', true)

  assert.deepEqual(selectFileRequest(current, nextKey, 'new.js'), {
    status: RequestStatus.LOADING,
    path: 'new.js',
    data: null,
    error: null,
  })
})
test('clearing selection returns the idle file state', () => {
  assert.deepEqual(selectFileRequest({}, null, null), {
    status: RequestStatus.IDLE,
    path: null,
    data: null,
    error: null,
  })
})
