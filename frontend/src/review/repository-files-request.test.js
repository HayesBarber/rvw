import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLatestRequestTracker,
  createRepositoryFilesHook,
  useNotIgnoredFiles,
  useRepositoryFiles,
} from './repository-files-request.js'

test('only the latest repository-file request may commit its response', () => {
  const tracker = createLatestRequestTracker()
  const first = tracker.begin()
  const second = tracker.begin()

  assert.equal(tracker.isCurrent(first), false)
  assert.equal(tracker.isCurrent(second), true)

  tracker.invalidate()
  assert.equal(tracker.isCurrent(second), false)
})

test('the factory produces a hook wrapping a path fetcher', () => {
  const hook = createRepositoryFilesHook(() => Promise.resolve(['a.txt']))
  assert.equal(typeof hook, 'function')

  assert.equal(typeof useRepositoryFiles, 'function')
  assert.equal(typeof useNotIgnoredFiles, 'function')
  assert.notEqual(useRepositoryFiles, useNotIgnoredFiles)
})
