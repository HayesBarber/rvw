import assert from 'node:assert/strict'
import test from 'node:test'

import { createLatestRequestTracker } from './repository-files-request.js'

test('only the latest repository-file request may commit its response', () => {
  const tracker = createLatestRequestTracker()
  const first = tracker.begin()
  const second = tracker.begin()

  assert.equal(tracker.isCurrent(first), false)
  assert.equal(tracker.isCurrent(second), true)

  tracker.invalidate()
  assert.equal(tracker.isCurrent(second), false)
})
