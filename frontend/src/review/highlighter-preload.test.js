import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers'
import { getHighlighterIfLoaded, getSharedHighlighter, getThemes, registerCustomLanguage } from '@pierre/diffs'
import { createHighlighterPreloader, REVIEW_THEME, selectPreloadLanguages } from './highlighter-preload.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function harness(load = async () => {}) {
  const queue = []
  const start = createHighlighterPreloader({ load, schedule(callback) {
    const job = { callback }
    queue.push(job)
    return () => { job.cancelled = true }
  } })
  async function drain() {
    while (queue.length) {
      const job = queue.shift()
      if (!job.cancelled) await job.callback()
    }
  }
  return { start, queue, drain }
}

test('select common languages with unique paths, stable ties and renderer extension rules', () => {
  assert.deepEqual(selectPreloadLanguages(['a.js', 'b.mjs', 'a.js', 'x.py', 'y.py', 'z.ts', 'README', 'x.unknown'], 2), ['javascript', 'python'])
  assert.deepEqual(selectPreloadLanguages(['x.component.ts', 'x.ts', 'x.js', 'x.py', 'x.css', 'x.json']), ['angular-ts', 'css', 'javascript', 'json', 'python'])
  assert.deepEqual(selectPreloadLanguages(['README', 'x.unknown']), [])
  assert.equal(selectPreloadLanguages(['x.js', 'x.py'], Infinity).length, 2)
})

test('idle scheduling defers loads, shares concurrent requests and retains successful resources', async () => {
  const calls = []
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  const h = harness(async (options) => { calls.push(options); await blocked })
  h.start(['a.js'])
  h.start(['b.js'])
  assert.equal(calls.length, 0)
  const first = h.queue.shift().callback()
  const second = h.queue.shift().callback()
  await tick()
  assert.equal(calls.length, 1)
  release()
  await Promise.all([first, second])
  await h.drain()
  assert.equal(calls.length, getThemes(REVIEW_THEME).length + 1)
  h.start(['c.js'])
  await h.drain()
  assert.equal(calls.length, getThemes(REVIEW_THEME).length + 1)
})

test('cancellation removes queued work and stops an in-flight sequence after its current load', async () => {
  const calls = []
  const h = harness(async (options) => calls.push(options))
  h.start(['a.js'])()
  await h.drain()
  assert.equal(calls.length, 0)
  const cancel = h.start(['a.js', 'b.py'])
  const active = h.queue.shift().callback()
  cancel()
  await active
  await h.drain()
  assert.equal(calls.length, 1)
})

test('failed theme or language does not stop other resources and can retry on a later request', async () => {
  let failures = true
  const calls = []
  const h = harness((options) => {
    calls.push(options)
    if (failures && (options.themes[0] === getThemes(REVIEW_THEME)[0] || options.langs[0] === 'javascript')) throw new Error('offline')
  })
  let completed = false
  h.start(['a.js', 'b.py', 'unknown.ext'], { onComplete: () => { completed = true } })
  await h.drain()
  assert.equal(completed, true)
  assert.ok(calls.some(({ langs }) => langs[0] === 'python'))
  failures = false
  const count = calls.length
  h.start(['a.js', 'b.py'])
  await h.drain()
  assert.equal(calls.length, count + 2)
})

test('renderer reuses preloaded resources and loads omitted languages on demand after a preload failure', async () => {
  registerCustomLanguage('rvw-preload-failure', async () => { throw new Error('offline') }, ['rvwfail'])
  const h = harness(undefined)
  // Use the real loader for this integration check.
  const real = createHighlighterPreloader({ schedule(callback) { h.queue.push({ callback }); return () => {} } })
  real(['a.js', 'b.rvwfail'], { limit: Infinity })
  await h.drain()
  const preloaded = getHighlighterIfLoaded()
  assert.ok(getThemes(REVIEW_THEME).every((theme) => preloaded.getLoadedThemes().includes(theme)))
  assert.equal(await getSharedHighlighter({ themes: getThemes(REVIEW_THEME), langs: ['javascript'] }), preloaded)
  assert.ok(preloaded.getLoadedLanguages().includes('javascript'))
  const onDemand = await getSharedHighlighter({ themes: getThemes(REVIEW_THEME), langs: ['python'] })
  assert.equal(onDemand, preloaded)
  assert.match(onDemand.codeToHtml('print(42)', { lang: 'python', theme: getThemes(REVIEW_THEME)[0] }), /style=/)
  assert.doesNotThrow(() => onDemand.codeToHtml('unknown', { lang: 'text', theme: getThemes(REVIEW_THEME)[0] }))
})
