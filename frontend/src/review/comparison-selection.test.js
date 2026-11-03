import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparisonEndpoints,
  comparisonPair,
  createComparisonSubmitHandler,
  toggleComparisonEndpoint,
} from './comparison-selection.js'

const commits = [
  { sha: 'b'.repeat(40), subject: 'Recent', authorName: 'Author', commitDate: '2026-11-03T10:00:00-05:00' },
  { sha: 'a'.repeat(40), subject: 'Earlier', authorName: 'Other', commitDate: '2026-11-02T10:00:00-05:00' },
]
const endpoints = comparisonEndpoints(commits)
const [workingTree, recent, earlier] = endpoints

test('endpoints put the working tree above commits without changing API order or full SHAs', () => {
  assert.deepEqual(workingTree, { kind: 'working-tree' })
  assert.deepEqual(endpoints.slice(1), commits.map((commit) => ({ ...commit, kind: 'commit' })))
  assert.deepEqual(comparisonEndpoints([]), [{ kind: 'working-tree' }])
  assert.equal('kind' in commits[0], false)
})

test('either checked endpoint can be unchecked and replaced', () => {
  let selected = toggleComparisonEndpoint(endpoints, [], recent)
  selected = toggleComparisonEndpoint(endpoints, selected, earlier)
  assert.deepEqual(selected, [recent, earlier])
  for (const removed of [recent, earlier]) {
    const remaining = toggleComparisonEndpoint(endpoints, selected, { ...removed })
    assert.deepEqual(remaining, selected.filter((endpoint) => endpoint !== removed))
    assert.deepEqual(toggleComparisonEndpoint(endpoints, remaining, workingTree), [...remaining, workingTree])
  }
  selected = toggleComparisonEndpoint(endpoints, selected, recent)
  selected = toggleComparisonEndpoint(endpoints, selected, earlier)
  assert.deepEqual(selected, [])
  selected = [workingTree, recent]
  selected = toggleComparisonEndpoint(endpoints, selected, { kind: 'working-tree' })
  assert.deepEqual(selected, [recent])
  assert.deepEqual(toggleComparisonEndpoint(endpoints, selected, earlier), [recent, earlier])
})

const history = Array.from({ length: 7 }, (_, index) => ({ sha: String(index + 1).repeat(40) }))
const timeline = comparisonEndpoints(history)

for (const [description, initial, clicked, expected] of [
  ['above Target', [2, 6], 1, [1, 6]],
  ['below Base', [2, 6], 7, [2, 7]],
  ['between endpoints nearer Target', [2, 6], 3, [3, 6]],
  ['between endpoints nearer Base', [2, 6], 5, [2, 5]],
  ['between endpoints at equal distance', [2, 6], 4, [2, 4]],
  ['Working tree above Target', [2, 6], 0, [0, 6]],
  ['commit nearer a selected Working tree', [0, 6], 1, [1, 6]],
  ['commit nearer Base with Working tree selected', [0, 6], 5, [0, 5]],
  ['commit at equal distance with Working tree selected', [0, 6], 3, [0, 3]],
]) {
  test(`a third selection ${description} replaces the nearest endpoint; ties replace Base`, () => {
    for (const order of [initial, [...initial].reverse()]) {
      const selected = order.map((index) => timeline[index])
      const before = [...selected]
      const next = toggleComparisonEndpoint(timeline, selected, { ...timeline[clicked] })
      assert.equal(next.length, 2)
      assert.deepEqual(comparisonPair(timeline, next), {
        target: timeline[expected[0]], base: timeline[expected[1]],
      })
      assert.deepEqual(selected, before)
      const calls = []
      const submit = createComparisonSubmitHandler({
        getRequest: () => ({ status: 'success', data: history }),
        getSelection: () => next,
        onSelect: (source) => calls.push(source),
      })
      assert.equal(submit(), true)
      assert.deepEqual(calls, [expected[0] === 0
        ? { kind: 'working-tree', base: timeline[expected[1]].sha }
        : { kind: 'commit-range', base: timeline[expected[1]].sha, head: timeline[expected[0]].sha }])
    }
  })
}

for (const pair of [[recent, earlier], [workingTree, recent], [workingTree, earlier]]) {
  test(`roles follow list order for ${pair.map((endpoint) => endpoint.kind === 'commit' ? endpoint.sha.slice(0, 7) : endpoint.kind).join(' and ')}`, () => {
    for (const selected of [pair, [...pair].reverse()]) {
      assert.deepEqual(comparisonPair(endpoints, selected), { target: pair[0], base: pair[1] })
    }
  })
}

test('invalid, unavailable, duplicate, and incomplete endpoints cannot form a pair', () => {
  for (const invalid of [
    { kind: 'commit', sha: 'bbbbbbb' },
    { kind: 'commit', sha: 'c'.repeat(40) },
    { kind: 'working-tree', sha: 'HEAD' },
    { kind: 'unknown', sha: recent.sha },
    null,
  ]) {
    const selected = [recent]
    assert.equal(toggleComparisonEndpoint(endpoints, selected, invalid), selected)
    assert.equal(comparisonPair(endpoints, [recent, invalid]), null)
  }
  for (const selected of [[], [recent], [workingTree], [recent, { ...recent }], [workingTree, { ...workingTree }], endpoints]) {
    assert.equal(comparisonPair(endpoints, selected), null)
  }
  assert.equal(comparisonPair(comparisonEndpoints([]), [workingTree]), null)
})

for (const [selected, expected] of [
  [[earlier, recent], { kind: 'commit-range', base: earlier.sha, head: recent.sha }],
  [[earlier, workingTree], { kind: 'working-tree', base: earlier.sha }],
]) {
  test(`submission reports one ${expected.kind} source with full commit SHAs`, () => {
    const calls = []
    const submit = createComparisonSubmitHandler({
      getRequest: () => ({ status: 'success', data: commits }),
      getSelection: () => selected,
      onSelect: (...args) => calls.push(args),
    })
    assert.equal(submit(), true)
    assert.deepEqual(calls, [[expected]])
  })
}

test('submission checks the latest request and selection after loading, failure, or replacement', () => {
  let request = { status: 'success', data: commits }
  let selected = [workingTree, earlier]
  const calls = []
  const submit = createComparisonSubmitHandler({
    getRequest: () => request, getSelection: () => selected,
    onSelect: (source) => calls.push(source),
  })
  for (const status of ['idle', 'loading', 'error']) {
    request = { status, data: commits, error: status === 'error' ? 'Failed' : null }
    assert.equal(submit(), false)
  }
  for (const data of [[], [commits[0]]]) {
    request = { status: 'success', data }
    assert.equal(submit(), false)
  }
  selected = [workingTree, recent]
  assert.equal(submit(), true)
  selected = [workingTree]
  assert.equal(submit(), false)
  assert.deepEqual(calls, [{ kind: 'working-tree', base: recent.sha }])
})

test('submission requires a callback and supports full SHA-256 commit IDs', () => {
  assert.equal(createComparisonSubmitHandler({
    getRequest: () => ({ status: 'success', data: commits }),
    getSelection: () => [recent, earlier],
  })(), false)
  const sha256 = [{ sha: 'b'.repeat(64) }, { sha: 'a'.repeat(64) }]
  const calls = []
  assert.equal(createComparisonSubmitHandler({
    getRequest: () => ({ status: 'success', data: sha256 }),
    getSelection: () => comparisonEndpoints(sha256).slice(1),
    onSelect: (source) => calls.push(source),
  })(), true)
  assert.deepEqual(calls, [{ kind: 'commit-range', base: sha256[1].sha, head: sha256[0].sha }])
})
