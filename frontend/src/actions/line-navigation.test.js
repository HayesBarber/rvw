import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiffFromFile } from '@pierre/diffs'
import { currentFileLineTarget, createCurrentFileLineNavigation } from './line-navigation.js'
import { ActiveSurface, initialWorkspaceState, workspaceReducer } from '../app/workspace.js'

const fullFile = (contents) => ({ path: 'a.txt', content: { kind: 'file', file: { contents } } })

test('full-file navigation accepts source lines, including the last line without a newline', () => {
  for (const contents of ['first\nlast', 'first\nlast\n']) {
    const file = fullFile(contents)
    for (const lineNumber of [1, 2]) {
      assert.deepEqual(currentFileLineTarget(file, { side: 'deletions' }, lineNumber), {
        path: 'a.txt', lineNumber, side: 'new',
      })
    }
    assert.equal(currentFileLineTarget(file, null, 3), null)
  }
})

test('diff navigation uses the active side and accepts lines outside visible hunks', () => {
  const oldFile = { name: 'a.txt', contents: Array.from({ length: 300 }, (_, i) => `${i + 1}\n`).join('') }
  const newFile = { name: 'a.txt', contents: `inserted\n${oldFile.contents}` }
  const file = { path: 'a.txt', content: { kind: 'diff' }, parsedDiff: parseDiffFromFile(oldFile, newFile) }
  for (const [cursor, side, last] of [[null, 'new', 301], [{ side: 'additions' }, 'new', 301],
    [{ side: 'deletions' }, 'old', 300]]) {
    for (const lineNumber of [1, 212, last]) {
      assert.deepEqual(currentFileLineTarget(file, cursor, lineNumber), { path: 'a.txt', lineNumber, side })
    }
    assert.equal(currentFileLineTarget(file, cursor, last + 1), null)
  }
})

test('empty, unavailable, missing, and unparsed files have no line target', () => {
  for (const file of [null, fullFile(''), { path: 'a.txt', content: { kind: 'unavailable' } },
    { path: 'a.txt', content: { kind: 'diff' } }]) {
    assert.equal(currentFileLineTarget(file, null, 1), null)
  }
  for (const line of [0, -1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(currentFileLineTarget(fullFile('line\n'), null, line), null)
  }
})

test('navigation from either surface preserves the file and history, and repeats the same line', () => {
  for (const activeSurface of Object.values(ActiveSurface)) {
    let state = { ...initialWorkspaceState, selectedPath: 'a.txt', activeSurface,
      fileHistory: ['a.txt'], fileHistoryIndex: 0 }
    let focused = 0
    const navigate = createCurrentFileLineNavigation({
      getTarget: (line) => currentFileLineTarget(fullFile('one\ntwo\n'), null, line),
      dispatchWorkspace: (action) => { state = workspaceReducer(state, action) },
      focusDiffPane: () => { focused++ },
    })
    assert.equal(navigate(2), true)
    const first = state.lineNavigation
    assert.deepEqual(first, { path: 'a.txt', lineNumber: 2, side: 'new' })
    assert.equal(state.activeSurface, ActiveSurface.DIFF_PANE)
    assert.equal(navigate(2), true)
    assert.notEqual(state.lineNavigation, first)
    assert.deepEqual(state.fileHistory, ['a.txt'])
    assert.equal(state.fileHistoryIndex, 0)
    assert.equal(focused, 2)
    const unchanged = state
    assert.equal(navigate(3), false)
    assert.equal(state, unchanged)
    assert.equal(focused, 2)
  }
})

test('a missing renderer action cannot change state or focus', () => {
  const navigate = createCurrentFileLineNavigation({
    getTarget: () => undefined,
    dispatchWorkspace: () => assert.fail('must not navigate'),
    focusDiffPane: () => assert.fail('must not focus'),
  })
  assert.equal(navigate(1), false)
})

test('workspace rejects stale file targets and invalid source coordinates', () => {
  const state = { ...initialWorkspaceState, selectedPath: 'a.txt' }
  for (const location of [undefined, { path: 'b.txt', lineNumber: 1, side: 'new' },
    ...[0, -1, 1.5, '1'].map((lineNumber) => ({ path: 'a.txt', lineNumber, side: 'new' })),
    { path: 'a.txt', lineNumber: 1, side: 'deletions' }]) {
    assert.equal(workspaceReducer(state, { type: 'line_navigation_requested', location }), state)
  }
})
