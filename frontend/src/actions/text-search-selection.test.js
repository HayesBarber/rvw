import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction as Action } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { createFileFinderActionAdapter } from './file-finder-actions.js'
import { createTextSearchRequest } from '../review/text-search-request.js'
import { initialWorkspaceState, workspaceReducer } from '../app/workspace.js'

test('search uses finder navigation and mouse selection without opening a file', async () => {
  const workspace = workspaceReducer({ ...initialWorkspaceState, selectedPath: 'keep.txt' }, {
    type: 'search_opened', mode: 'all-files',
  })
  assert.equal(workspace.searchMode, 'all-files')
  const request = createTextSearchRequest({ delay: 0, search: async () => ({
    matches: [{ path: 'one' }, { path: 'two' }, { path: 'three' }], truncated: false,
  }) })
  request.update('text')
  await new Promise((resolve) => setTimeout(resolve, 5))
  const adapter = createFileFinderActionAdapter({
    getResults: () => request.getSnapshot().matches,
    getActiveIndex: () => request.getSnapshot().activeIndex,
    setActiveIndex: request.select,
    onOpen: () => {},
  })
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => workspace.activeSurface,
    getOverlayActions: () => adapter,
    getSurfaceActions: () => assert.fail('Search must not change the workspace'),
  })
  dispatch(Action.CURSOR_UP)
  assert.equal(request.getSnapshot().activeIndex, 2)
  dispatch(Action.CURSOR_DOWN, 2)
  assert.equal(request.getSnapshot().activeIndex, 1)
  dispatch(Action.CURSOR_FIRST)
  assert.equal(request.getSnapshot().activeIndex, 0)
  dispatch(Action.CURSOR_LAST)
  assert.equal(request.getSnapshot().activeIndex, 2)
  request.select(1) // The same selection operation used by a result click.
  dispatch(Action.FILE_TREE_ITEM_ACTIVATE)
  assert.equal(request.getSnapshot().activeIndex, 1)
  assert.equal(workspace.selectedPath, 'keep.txt')
  assert.equal(workspaceReducer(workspace, { type: 'search_closed' }).searchMode, null)
})
