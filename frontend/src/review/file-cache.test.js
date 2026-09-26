import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiffFromFile } from '@pierre/diffs'

import { createReviewFileCache } from './file-cache.js'

const selection = (path, changed = false, generation = 0, diffId = 'active') => ({ path, changed, generation, diffId })
const contents = (name, value) => ({ name, contents: `${value}\n` })
function fixture(capacity = 2) {
  const calls = { file: 0, diff: 0, parse: 0 }
  const cache = createReviewFileCache({
    capacity,
    fetchFile: async (path) => {
      calls.file++
      return { path, content: { kind: 'file', file: contents(path, 'current') } }
    },
    fetchDiff: async (_, path) => {
      calls.diff++
      return { path, content: { kind: 'diff', oldFile: contents(path, 'old'), newFile: contents(path, 'new') } }
    },
    parseDiff: (...args) => { calls.parse++; return parseDiffFromFile(...args) },
  })
  return { cache, calls }
}

test('reopening diffs and unchanged files reuses content and parsed metadata', async () => {
  const { cache, calls } = fixture()
  const diff = await cache.load(selection('changed.js', true))
  const file = await cache.load(selection('unchanged.js'))
  const reopenedDiff = await cache.load(selection('changed.js', true))
  const reopenedFile = await cache.load(selection('unchanged.js'))
  assert.equal(reopenedDiff.parsedDiff, diff.parsedDiff)
  assert.equal(reopenedFile.content.file, file.content.file)
  assert.notEqual(reopenedDiff, diff, 'timing traces must not share selection objects')
  assert.deepEqual(calls, { diff: 1, file: 1, parse: 1 })
})

test('hits update recency and both content types share the capacity', async () => {
  const { cache, calls } = fixture()
  const stages = []
  const timing = { stage: (stage) => stages.push(stage) }
  const load = (path, changed = false) => cache.load(selection(path, changed), timing)
  const a = await load('a', true)
  await load('b')
  assert.equal((await load('a', true)).parsedDiff, a.parsedDiff)
  await load('c') // b is least recently used, even though a was inserted first.
  await load('a', true)
  await load('b')
  assert.deepEqual(calls, { diff: 1, file: 3, parse: 1 })
  assert.deepEqual(stages, ['cache_miss', 'cache_miss', 'cache_hit', 'cache_miss', 'cache_eviction', 'cache_hit', 'cache_miss', 'cache_eviction'])
})

test('snapshot, generation, and file kind prevent identity collisions', async () => {
  const { cache, calls } = fixture()
  await cache.load(selection('same', true))
  await cache.load(selection('same'))
  await cache.load(selection('same', false, 1))
  await cache.load(selection('same', false, 1, 'another-review'))
  assert.deepEqual(calls, { diff: 1, file: 3, parse: 1 })
})

test('explicit reload invalidation refetches even when the snapshot identity is reused', async () => {
  const { cache, calls } = fixture()
  await cache.load(selection('a', true))
  cache.invalidate()
  await cache.load(selection('a', true))
  assert.deepEqual(calls, { diff: 2, file: 0, parse: 2 })
})

for (const explicit of [false, true]) {
  test(`in-flight responses cannot refill or parse after ${explicit ? 'reload' : 'snapshot change'}`, async () => {
    const pending = []
    let parses = 0
    const cache = createReviewFileCache({
      fetchDiff: () => new Promise((resolve) => pending.push(resolve)),
      parseDiff: (...args) => { parses++; return parseDiffFromFile(...args) },
    })
    const old = cache.load(selection('a', true))
    if (explicit) cache.invalidate()
    const next = selection('a', true, explicit ? 0 : 1)
    const current = cache.load(next)
    const response = (value) => ({ content: { kind: 'diff', oldFile: contents('a', 'old'), newFile: contents('a', value) } })
    pending[1](response('fresh'))
    const fresh = await current
    pending[0](response('stale'))
    assert.equal(await old, null)
    assert.equal((await cache.load(next)).parsedDiff, fresh.parsedDiff)
    assert.equal(parses, 1)
    assert.equal(pending.length, 2)
  })
}

test('out-of-order file responses keep the requested identity', async () => {
  const pending = new Map()
  const cache = createReviewFileCache({ fetchFile: (path) => new Promise((resolve) => pending.set(path, resolve)) })
  const a = cache.load(selection('a'))
  const b = cache.load(selection('b'))
  pending.get('b')({ path: 'b', content: { kind: 'file', file: contents('b', 'B') } })
  assert.equal((await b).path, 'b')
  pending.get('a')({ path: 'a', content: { kind: 'file', file: contents('a', 'A') } })
  await a
  assert.equal((await cache.load(selection('b'))).content.file.contents, 'B\n')
})

test('failed and unavailable loads can be retried', async () => {
  let count = 0
  const cache = createReviewFileCache({ fetchFile: async () => {
    count++
    if (count === 1) throw new Error('temporary failure')
    if (count === 2) return { content: { kind: 'unavailable', reason: 'too-large' } }
    return { content: { kind: 'file', file: contents('a', 'ready') } }
  } })
  await assert.rejects(cache.load(selection('a')), /temporary failure/)
  assert.equal((await cache.load(selection('a'))).content.kind, 'unavailable')
  assert.equal((await cache.load(selection('a'))).content.kind, 'file')
  await cache.load(selection('a'))
  assert.equal(count, 3)
})

test('in-flight unchanged content is discarded when reload invalidates the cache', async () => {
  const pending = []
  const cache = createReviewFileCache({ fetchFile: () => new Promise((resolve) => pending.push(resolve)) })
  const old = cache.load(selection('a'))
  cache.invalidate()
  pending[0]({ content: { kind: 'file', file: contents('a', 'stale') } })
  assert.equal(await old, null)
  const current = cache.load(selection('a'))
  assert.equal(pending.length, 2)
  pending[1]({ content: { kind: 'file', file: contents('a', 'fresh') } })
  assert.equal((await current).content.file.contents, 'fresh\n')
})

test('a parser failure is not cached', async () => {
  let parses = 0
  const cache = createReviewFileCache({
    fetchDiff: async () => ({ content: { kind: 'diff', oldFile: null, newFile: contents('added', 'new') } }),
    parseDiff: (...args) => {
      if (++parses === 1) throw new Error('parser failure')
      return parseDiffFromFile(...args)
    },
  })
  await assert.rejects(cache.load(selection('added', true)), /parser failure/)
  assert.equal((await cache.load(selection('added', true))).parsedDiff.type, 'new')
  await cache.load(selection('added', true))
  assert.equal(parses, 2)
})
