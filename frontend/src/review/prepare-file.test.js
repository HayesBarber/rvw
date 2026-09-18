import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiffFromFile } from '@pierre/diffs'
import { createPreparedFileCache, parseDisplayDiff } from './prepare-file.js'

const text = (label, count = 600) => Array.from({ length: count }, (_, i) => `${label} ${i}\n`).join('')
const file = (contents, name = 'a.js') => ({ name, contents })
const normalize = (diff) => {
  const rest = { ...diff }
  delete rest.cacheKey
  // Optional language metadata is absent in the library's default parser.
  if (rest.lang === undefined) delete rest.lang
  return rest
}

test('fast replacement matches the standard parser including context and line endings', () => {
  for (const ending of ['\n', '', '\r\n']) {
    for (const renamed of [false, true]) {
      const before = file(`prefix\n${text('before')}last${ending}`, 'old.js')
      const after = file(`prefix\n${text('after')}end${ending}`, renamed ? 'new.js' : 'old.js')
      assert.deepEqual(normalize(parseDisplayDiff(before, after)), normalize(parseDiffFromFile(before, after)))
    }
  }
  const before = file(text('before') + 'same\n'.repeat(10))
  const after = file(text('after') + 'same\n'.repeat(10))
  assert.deepEqual(normalize(parseDisplayDiff(before, after)), normalize(parseDiffFromFile(before, after)))
})

test('shared middle lines, additions, deletions, and empty files keep normal diff semantics', () => {
  for (const [old, next] of [
    [file(text('a') + 'shared\n' + text('b')), file(text('c') + 'shared\n' + text('d'))],
    [null, file('added\n')], [file('removed'), null], [file(''), file('')],
    [file('a\n'), file('a\r\n')],
  ]) assert.deepEqual(normalize(parseDisplayDiff(old, next)), normalize(parseDiffFromFile(old, next)))
})

test('prepared cache reuses exact content, invalidates edits, and evicts old sources', () => {
  const prepare = createPreparedFileCache(1024, 2)
  const response = (path, contents) => ({ path, content: { kind: 'file', file: file(contents, path) } })
  const first = prepare(response('a', 'first'))
  assert.equal(prepare(response('a', 'first')).content, first.content)
  assert.notEqual(prepare(response('a', 'edited')).content.file.cacheKey, first.content.file.cacheKey)
  prepare(response('b', 'second'))
  prepare(response('c', 'third'))
  assert.notEqual(prepare(response('a', 'first')).content.file.cacheKey, first.content.file.cacheKey)
  const huge = response('huge', 'x'.repeat(1024))
  assert.notEqual(prepare(huge).content, prepare(huge).content)
})
