import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewSourceLabel } from './source-label.js'

test('footer labels each review source', () => {
  assert.equal(reviewSourceLabel({ kind: 'working-tree', base: 'HEAD' }), 'working tree')
  assert.equal(reviewSourceLabel({ kind: 'commit-range', base: 'abc', head: 'def' }), 'abc..def')
  assert.equal(reviewSourceLabel({ kind: 'pull-request', number: 100 }), 'PR #100')
  assert.equal(reviewSourceLabel(undefined), '')
})

test('footer abbreviates commit IDs but retains the full range for hover text', () => {
  const source = { kind: 'commit-range', base: 'a'.repeat(40), head: 'b'.repeat(40) }
  assert.equal(reviewSourceLabel(source, true), 'aaaaaaa..bbbbbbb')
  assert.equal(reviewSourceLabel(source), `${source.base}..${source.head}`)
})
