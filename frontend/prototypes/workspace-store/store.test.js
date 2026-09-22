import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSession, activePathSelector, selectTreeMode } from './store.js'
import { initialWorkspaceState, workspaceReducer, ActiveSurface, TreeMode } from '../../src/app/workspace.js'
import { resolveConfiguration } from '../../src/app/configuration.js'
import { fileRequestKey, selectFileRequest } from '../../src/review/selected-file-request.js'
import { selectEmptyReviewTreeMode } from '../../src/review/review-session.js'

const overview = { initialPath: 'a.js', files: [{ path: 'a.js' }, { path: 'b.js' }] }

test('configuration and overlay/focus transitions preserve reducer behavior', () => {
  const { store, dispatch } = createWorkspaceSession()
  const config = resolveConfiguration({ configuration: { diff: { wrapLines: false, relativeLineNumbers: true } } })
  const actions = [
    { type: 'wrap_lines_set', wrapLines: config.wrapLines },
    { type: 'relative_line_numbers_set', relativeLineNumbers: config.relativeLineNumbers },
    { type: 'review_loaded', initialPath: 'a.js' },
    { type: 'surface_activated', surface: ActiveSurface.FILE_TREE },
    { type: 'finder_opened', mode: 'all' },
    { type: 'finder_file_opened', path: 'pending.js', changed: false },
    { type: 'keymap_reference_opened' },
    { type: 'keymap_reference_closed' },
    { type: 'wrap_lines_toggled' },
  ]
  let expected = initialWorkspaceState
  for (const action of actions) {
    expected = workspaceReducer(expected, action)
    dispatch(action)
    assert.deepEqual(store.getState(), expected)
  }
  assert.equal(store.getState().activeSurface, ActiveSurface.DIFF_PANE)
  assert.equal(store.getState().finderOpen, false)
  assert.equal(store.getState().wrapLines, true)
  assert.equal(store.getState().relativeLineNumbers, true)
  // Invalid configuration must not replace the user's current toggle.
  const invalid = resolveConfiguration({ configuration: { diff: { wrapLines: 'invalid' } } })
  dispatch({ type: 'wrap_lines_set', wrapLines: invalid.wrapLines })
  assert.equal(store.getState().wrapLines, true)
})

test('pending selection survives loading/error; successful list enables fallback and reconciliation', () => {
  const { store, dispatch } = createWorkspaceSession()
  dispatch({ type: 'finder_file_opened', path: 'pending.js', changed: false })
  for (const status of ['idle', 'loading', 'error']) {
    assert.equal(activePathSelector({ overview, status })(store.getState()), 'pending.js')
  }
  const active = activePathSelector({ overview, status: 'success', paths: ['a.js', 'b.js'] })
  assert.equal(active(store.getState()), 'a.js')
  assert.equal(store.getState().selectedPath, 'pending.js')
  // Existing useReviewSession owns this list-ready reconciliation effect.
  dispatch({ type: 'file_selected', path: active(store.getState()) })
  assert.equal(store.getState().selectedPath, 'a.js')
  dispatch({ type: 'file_selected', path: 'b.js' })
  assert.equal(active(store.getState()), 'b.js')
  const key = fileRequestKey('review', 'b.js', true, 1)
  const stale = { key: fileRequestKey('review', 'a.js', true, 0), status: 'success', data: { path: 'a.js' } }
  assert.equal(selectFileRequest(stale, key, 'b.js').data, null)
  assert.equal(selectFileRequest(stale, key, 'b.js').status, 'loading')
  dispatch({ type: 'tree_mode_changed', mode: TreeMode.CHANGES, visiblePaths: ['a.js'], initialPath: 'a.js' })
  assert.equal(store.getState().selectedPath, 'a.js')
  const empty = { initialPath: null, files: [] }
  dispatch({ type: 'tree_mode_changed', mode: selectEmptyReviewTreeMode(empty, TreeMode.CHANGES), visiblePaths: [], initialPath: null })
  assert.equal(selectTreeMode(store.getState()), TreeMode.FILES)
  assert.equal(activePathSelector({ overview: empty, status: 'success' })(store.getState()), null)
})

test('trace narrow pane subscriptions, no-op dispatch, cleanup and session isolation', (t) => {
  const first = createWorkspaceSession()
  const second = createWorkspaceSession()
  const counts = { root: 0, path: 0, mode: 0 }
  const off = [
    first.store.subscribe(() => counts.root++),
    first.store.subscribe(activePathSelector({ overview }), () => counts.path++),
    first.store.subscribe(selectTreeMode, () => counts.mode++),
  ]
  const actions = [
    { type: 'file_selected', path: 'b.js' },
    { type: 'file_tree_resized', steps: 1 },
    { type: 'finder_opened' },
    { type: 'surface_activated', surface: ActiveSurface.FILE_TREE },
    { type: 'wrap_lines_set', wrapLines: false },
    { type: 'finder_closed' },
    { type: 'finder_file_opened', path: 'pending.js', changed: false },
    { type: 'file_selected', path: 'pending.js' },
  ]
  actions.forEach(first.dispatch)
  assert.deepEqual(counts, { root: 7, path: 2, mode: 1 })
  t.diagnostic(`8 dispatches: ${JSON.stringify(counts)} notifications (not React render counts)`)
  assert.deepEqual(second.store.getState(), initialWorkspaceState)
  off.forEach((unsubscribe) => unsubscribe())
  first.dispatch({ type: 'file_selected', path: 'a.js' })
  assert.deepEqual(counts, { root: 7, path: 2, mode: 1 })
  // React StrictMode may subscribe again after cleanup on the same instance.
  const unsubscribe = first.store.subscribe(selectTreeMode, () => counts.mode++)
  first.dispatch({ type: 'tree_mode_changed', mode: TreeMode.CHANGES, visiblePaths: ['a.js'], initialPath: 'a.js' })
  assert.equal(counts.mode, 2)
  unsubscribe()
})
