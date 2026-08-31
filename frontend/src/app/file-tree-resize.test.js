import assert from 'node:assert/strict'
import test from 'node:test'

import { fileTreeWidthFromPointer } from './file-tree-resize.js'

test('pointer position maps continuously to file-tree width', () => {
  assert.equal(fileTreeWidthFromPointer(412.5, 72), 340.5)
  assert.equal(fileTreeWidthFromPointer(912, 72), 840)
})

test('pointer width has no artificial bounds beyond the pane origin', () => {
  assert.equal(fileTreeWidthFromPointer(5000, 0), 5000)
  assert.equal(fileTreeWidthFromPointer(-20, 0), 0)
})

test('invalid pointer geometry is ignored', () => {
  assert.equal(fileTreeWidthFromPointer(Number.NaN, 0), null)
  assert.equal(fileTreeWidthFromPointer(100, Number.POSITIVE_INFINITY), null)
})
