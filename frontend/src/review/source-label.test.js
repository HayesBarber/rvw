import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewSourceLabel } from './source-label.js'

test('footer uses labels from the diff overview', () => {
  assert.equal(reviewSourceLabel({ sourceLabel: 'working tree', compactSourceLabel: 'working tree' }), 'working tree')
  assert.equal(reviewSourceLabel({ sourceLabel: 'abc..def', compactSourceLabel: 'abc..def' }), 'abc..def')
  assert.equal(reviewSourceLabel({ sourceLabel: 'PR #100', compactSourceLabel: 'PR #100' }), 'PR #100')
  assert.equal(reviewSourceLabel(undefined), '')
})

test('footer uses compact text and retains the full label for hover text', () => {
  const overview = { sourceLabel: `${'a'.repeat(40)}..${'b'.repeat(40)}`, compactSourceLabel: 'aaaaaaa..bbbbbbb' }
  assert.equal(reviewSourceLabel(overview, true), 'aaaaaaa..bbbbbbb')
  assert.equal(reviewSourceLabel(overview), overview.sourceLabel)
})
