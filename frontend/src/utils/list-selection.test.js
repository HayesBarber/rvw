import assert from 'node:assert/strict'
import test from 'node:test'
import { moveListSelection } from './list-selection.js'

test('list movement applies counts and stops at either end', () => {
  assert.equal(moveListSelection(5, 0, 1), 1)
  assert.equal(moveListSelection(5, 0, -1), 0)
  assert.equal(moveListSelection(5, 4, 1), 4)
  assert.equal(moveListSelection(5, 1, 1, 8), 4)
  assert.equal(moveListSelection(5, 3, -1, 9), 0)
  assert.equal(moveListSelection(1, 0, -1), 0)
  assert.equal(moveListSelection(1, 0, 1), 0)
  assert.equal(moveListSelection(0, -1, 1, 2), -1)
})

test('list movement uses one step for invalid counts and bounds stale indexes', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, '3']) {
    assert.equal(moveListSelection(5, 2, 1, count), 3)
  }
  assert.equal(moveListSelection(5, 99, -1), 3)
  assert.equal(moveListSelection(5, -1, 1), 1)
})
