import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction as Action } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createFileFinderActionAdapter } from './file-finder-actions.js'
import { createTextSearchRequest } from '../review/text-search-request.js'
import { initialWorkspaceState, workspaceReducer } from '../app/workspace.js'

test('search uses finder navigation and activates the selected result', async () => {
  let workspace = workspaceReducer({ ...initialWorkspaceState, selectedPath: 'keep.txt' }, {
    type: 'search_opened', mode: 'all-files',
  })
  assert.equal(workspace.searchMode, 'all-files')
  const request = createTextSearchRequest({ delay: 0, search: async () => ({
    matches: [{ path: 'one', lineNumber: 12 }, { path: 'two', lineNumber: 90 }, { path: 'three', lineNumber: 5 }], truncated: false,
  }) })
  request.update('text')
  await new Promise((resolve) => setTimeout(resolve, 5))
  const adapter = createFileFinderActionAdapter({
    getResults: () => request.getSnapshot().matches,
    getActiveIndex: () => request.getSnapshot().activeIndex,
    setActiveIndex: request.select,
    onOpen: (match) => {
      workspace = workspaceReducer(workspace, { type: 'search_result_opened', ...match, changed: false })
    },
  })
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => workspace.activeSurface,
    getOverlayActions: () => adapter,
    getSurfaceActions: () => assert.fail('Search must not change the workspace'),
  })
  assert.equal(dispatch(Action.CURSOR_UP), true)
  assert.equal(request.getSnapshot().activeIndex, 0)
  assert.equal(dispatch(Action.CURSOR_DOWN, 4), true)
  assert.equal(request.getSnapshot().activeIndex, 2)
  assert.equal(dispatch(Action.CURSOR_DOWN), true)
  assert.equal(request.getSnapshot().activeIndex, 2)
  assert.equal(dispatch(Action.CURSOR_UP, 4), true)
  assert.equal(request.getSnapshot().activeIndex, 0)
  assert.equal(dispatch(Action.CURSOR_LAST), true)
  assert.equal(request.getSnapshot().activeIndex, 2)
  assert.equal(dispatch(Action.CURSOR_FIRST), true)
  assert.equal(request.getSnapshot().activeIndex, 0)
  request.select(1) // Hover selects a result without activating it.
  assert.equal(workspace.selectedPath, 'keep.txt')
  dispatch(Action.ITEM_ACTIVATE)
  assert.equal(request.getSnapshot().activeIndex, 1)
  assert.equal(workspace.selectedPath, 'two')
  assert.equal(workspace.treeMode, 'files')
  assert.deepEqual(workspace.lineNavigation, { path: 'two', lineNumber: 90 })
  assert.equal(workspace.activeSurface, 'diff_pane')
  assert.equal(workspaceReducer(workspace, { type: 'search_closed' }).searchMode, null)
})

for (const changed of [true, false]) {
  test(`search routes ${changed ? 'changed' : 'unchanged'} files and repeats same-file targets`, () => {
    const start = { ...initialWorkspaceState, searchMode: 'ignore-aware' }
    const action = { type: 'search_result_opened', path: 'file.txt', lineNumber: 75, changed }
    const opened = workspaceReducer(start, action)
    assert.equal(opened.treeMode, changed ? 'changes' : 'files')
    assert.equal(opened.searchMode, null)
    assert.equal(opened.selectedPath, 'file.txt')
    assert.deepEqual(opened.lineNavigation, { path: 'file.txt', lineNumber: 75 })
    const repeated = workspaceReducer(opened, action)
    assert.notEqual(repeated.lineNavigation, opened.lineNavigation)
    assert.equal(workspaceReducer(repeated, { type: 'file_selected', path: 'other' }).lineNavigation, null)
  })
}
