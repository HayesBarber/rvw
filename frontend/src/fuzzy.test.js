import assert from 'node:assert/strict'
import test from 'node:test'
import { fuzzyFind, fuzzyScore } from './fuzzy.js'

test('filename matches rank ahead of directory-only matches', () => {
  const results = fuzzyFind([
    'main/docs/overview.md',
    'src/main.zig',
    'src/domain.js',
  ], 'main')

  assert.equal(results[0], 'src/main.zig')
  assert.ok(results.indexOf('src/domain.js') < results.indexOf('main/docs/overview.md'))
})

test('fuzzy matching accepts ordered non-contiguous characters', () => {
  assert.notEqual(fuzzyScore('ftrpn', 'frontend/src/FileTreePane.jsx'), null)
  assert.equal(fuzzyScore('xyz', 'frontend/src/FileTreePane.jsx'), null)
})

test('ties use a deterministic path ordering', () => {
  assert.deepEqual(fuzzyFind(['zeta.txt', 'alpha.txt'], ''), ['alpha.txt', 'zeta.txt'])
})
