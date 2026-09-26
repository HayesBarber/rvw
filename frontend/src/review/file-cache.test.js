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

function scheduledFixture(options = {}) {
  const tasks = new Set()
  const calls = []
  const cache = createReviewFileCache({
    capacity: 3,
    schedule(callback) { tasks.add(callback); return () => tasks.delete(callback) },
    fetchFile: async (path) => {
      calls.push(path)
      return { path, content: { kind: 'file', file: contents(path, path) } }
    },
    ...options,
  })
  const tick = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
    const task = tasks.values().next().value
    if (task) { tasks.delete(task); task() }
    for (let i = 0; i < 12; i++) await Promise.resolve()
  }
  const drain = async () => { while (tasks.size) await tick() }
  const warm = (path, paths = ['a', 'b', 'c', 'd', 'e']) => cache.warm(selection(path), paths, new Set())
  return { cache, calls, tasks, tick, drain, warm }
}

test('nearby paths follow navigation order, nearest first, without wrapping', async () => {
  const { nearbyFilePaths } = await import('./file-cache.js')
  const paths = ['e', 'a', 'd', 'b', 'c', 'f']
  assert.deepEqual(nearbyFilePaths(paths, 'd'), ['b', 'a', 'c', 'e'])
  assert.deepEqual(nearbyFilePaths(paths, 'e'), ['a', 'd'])
  assert.deepEqual(nearbyFilePaths(paths, 'f'), ['c', 'b'])
  assert.deepEqual(nearbyFilePaths(paths, 'missing'), [])
})

test('warming is deferred, capacity bounded, and preserves the selected file', async () => {
  const { cache, calls, warm, drain } = scheduledFixture()
  await cache.load(selection('c'))
  warm('c')
  assert.deepEqual(calls, ['c'])
  await drain()
  assert.deepEqual(calls, ['c', 'd', 'b'])
  await cache.load(selection('c'))
  await cache.load(selection('d'))
  assert.deepEqual(calls, ['c', 'd', 'b'])
})

test('one-entry cache does no speculative work', async () => {
  const { cache, calls, warm, drain } = scheduledFixture({ capacity: 1 })
  await cache.load(selection('c'))
  warm('c')
  await drain()
  await cache.load(selection('c'))
  assert.deepEqual(calls, ['c'])
})

test('active loads take priority; pending loads are shared and warming is serial', async () => {
  const pending = new Map()
  const { cache, warm, tick, tasks } = scheduledFixture({
    fetchFile: (path) => new Promise((resolve) => pending.set(path, resolve)),
  })
  const a = cache.load(selection('a'))
  warm('a')
  assert.equal(tasks.size, 0)
  pending.get('a')({ content: { kind: 'file' } })
  await a
  await tick()
  assert.deepEqual([...pending.keys()], ['a', 'b'])
  assert.equal(tasks.size, 0)
  const b = cache.load(selection('b'))
  warm('b')
  await tick()
  assert.equal(pending.size, 2)
  pending.get('b')({ path: 'b', content: { kind: 'file' } })
  assert.equal((await b).path, 'b')
  await tick()
  assert.deepEqual([...pending.keys()], ['a', 'b', 'c'])
})

test('selection replaces queued neighbors and discards obsolete responses', async () => {
  let finish
  const { cache, warm, tick, drain } = scheduledFixture({
    fetchFile: (path) => path === 'b'
      ? new Promise((resolve) => { finish = resolve })
      : Promise.resolve({ path, content: { kind: 'file' } }),
  })
  await cache.load(selection('a'))
  warm('a')
  await tick()
  await cache.load(selection('e'))
  warm('e')
  finish({ path: 'obsolete', content: { kind: 'file' } })
  await tick()
  await drain()
  const b = cache.load(selection('b'))
  finish({ path: 'fresh', content: { kind: 'file' } })
  assert.equal((await b).path, 'fresh')
})

test('reload cancels scheduled parsing and prevents old warm responses from inserting', async () => {
  let parses = 0
  const { cache, tick, tasks } = scheduledFixture({
    fetchDiff: async () => ({ content: { kind: 'diff', oldFile: null, newFile: contents('b', 'new') } }),
    parseDiff: () => { parses++; return {} },
  })
  await cache.load(selection('a'))
  cache.warm(selection('a'), ['a', 'b'], new Set(['b']))
  await tick()
  assert.equal(tasks.size, 1, 'parsing waits for a separate idle task')
  cache.invalidate()
  await tick()
  assert.equal(parses, 0)
  await cache.load(selection('b', true))
  assert.equal(parses, 1)
})

test('selecting a warm diff promotes idle parsing and reuses its metadata', async () => {
  let fetches = 0, parses = 0
  const { cache, tick } = scheduledFixture({
    fetchDiff: async () => { fetches++; return { content: { kind: 'diff' } } },
    parseDiff: () => { parses++; return { hunks: [] } },
  })
  await cache.load(selection('a'))
  cache.warm(selection('a'), ['a', 'b'], new Set(['b']))
  await tick()
  const b = await cache.load(selection('b', true))
  assert.equal((await cache.load(selection('b', true))).parsedDiff, b.parsedDiff)
  assert.equal(fetches, 1)
  assert.equal(parses, 1)
})

test('background errors are silent and active selections retry', async () => {
  let attempts = 0
  const { cache, warm, drain } = scheduledFixture({
    fetchFile: async (path) => {
      if (path === 'b' && ++attempts === 1) throw new Error('background failure')
      return { path, content: { kind: 'file' } }
    },
  })
  await cache.load(selection('a'))
  warm('a')
  await drain()
  assert.equal((await cache.load(selection('b'))).path, 'b')
  assert.equal(attempts, 2)
})

test('speculative eviction skips the selected entry after active requests finish out of order', async () => {
  let finish
  const calls = []
  const { cache, warm, drain } = scheduledFixture({
    fetchFile: (path) => {
      calls.push(path)
      if (path === 'old') return new Promise((resolve) => { finish = resolve })
      return Promise.resolve({ path, content: { kind: 'file' } })
    },
  })
  const old = cache.load(selection('old'))
  await cache.load(selection('c'))
  finish({ path: 'old', content: { kind: 'file' } })
  await old
  warm('c')
  await drain()
  await cache.load(selection('c'))
  assert.deepEqual(calls, ['old', 'c', 'd', 'b'])
})

test('reload discards an in-flight warm fetch and retains the single physical slot', async () => {
  let finish
  const calls = []
  const { cache, warm, tick, drain } = scheduledFixture({
    fetchFile: (path) => {
      calls.push(path)
      if (path === 'b') return new Promise((resolve) => { finish = resolve })
      return Promise.resolve({ path, content: { kind: 'file' } })
    },
  })
  await cache.load(selection('a'))
  warm('a')
  await tick()
  cache.invalidate()
  await cache.load(selection('e'))
  warm('e')
  await tick()
  assert.deepEqual(calls, ['a', 'b', 'e'])
  finish({ path: 'stale', content: { kind: 'file' } })
  await tick()
  await drain()
  const b = cache.load(selection('b'))
  finish({ path: 'fresh', content: { kind: 'file' } })
  assert.equal((await b).path, 'fresh')
})
