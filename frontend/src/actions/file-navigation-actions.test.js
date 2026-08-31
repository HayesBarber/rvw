import assert from 'node:assert/strict'
import test from 'node:test'

import {
  orderedFilePaths,
  relativeFilePath,
} from './file-navigation-actions.js'

test('file paths follow rendered tree order and omit directory nodes', () => {
  const files = [
    { path: 'README.md' },
    { path: 'src/z-last.js' },
    { path: '.gitignore' },
    { path: 'src/a-first.js' },
    { path: '.config/rvw.json' },
  ]

  assert.deepEqual(orderedFilePaths(files), [
    '.config/rvw.json',
    'src/a-first.js',
    'src/z-last.js',
    '.gitignore',
    'README.md',
  ])
})

test('relative file navigation applies counts and clamps without wrapping', () => {
  const paths = ['a.js', 'b.js', 'c.js', 'd.js']

  assert.equal(relativeFilePath(paths, 'a.js', 1), 'b.js')
  assert.equal(relativeFilePath(paths, 'a.js', 1, 3), 'd.js')
  assert.equal(relativeFilePath(paths, 'd.js', -1, 2), 'b.js')
  assert.equal(relativeFilePath(paths, 'b.js', 1, 20), 'd.js')
  assert.equal(relativeFilePath(paths, 'c.js', -1, 20), 'a.js')
})

test('relative file navigation safely rejects unavailable movement', () => {
  const paths = ['a.js', 'b.js']

  assert.equal(relativeFilePath(paths, 'b.js', 1), null)
  assert.equal(relativeFilePath(paths, 'a.js', -1), null)
  assert.equal(relativeFilePath(paths, 'missing.js', 1), null)
  assert.equal(relativeFilePath(paths, null, 1), null)
  assert.equal(relativeFilePath([], 'a.js', 1), null)
  assert.equal(relativeFilePath(null, 'a.js', 1), null)
  assert.equal(relativeFilePath(paths, 'a.js', 0), null)
})
