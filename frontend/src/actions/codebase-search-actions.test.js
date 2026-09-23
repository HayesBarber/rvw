import assert from 'node:assert/strict'
import test from 'node:test'
import { ApplicationAction, applicationActionCatalog } from './application-actions.js'
import { createApplicationDispatcher } from './application-dispatch.js'
import { codebaseSearchActions, openCodebaseSearch, openCodebaseSearchAll } from './codebase-search-actions.js'
import { resolveConfiguration } from '../app/configuration.js'
import { VimController } from '../vim/machine.js'

const search = ApplicationAction.OPEN_CODEBASE_SEARCH
const searchAll = ApplicationAction.OPEN_CODEBASE_SEARCH_ALL

test('both codebase search modes are global and unbound by default', () => {
  assert.equal(search, 'codebase_search.open')
  assert.equal(searchAll, 'codebase_search.open.all')
  const result = resolveConfiguration({ configuration: {} })
  assert.equal(result.diagnostic, null)
  for (const action of [search, searchAll]) {
    assert.equal(applicationActionCatalog[action].scope, 'global')
    assert.deepEqual(result.keymap[action], [])
  }
})

test('configured keys dispatch each mode to its separate placeholder on either surface', (t) => {
  const result = resolveConfiguration({ configuration: {
    keybindings: { leader: ',', normal: {
      [search]: [['<leader>', 'g']],
      [searchAll]: [['<leader>', 'G']],
    } },
  } })
  assert.equal(result.diagnostic, null)
  assert.equal(codebaseSearchActions[search], openCodebaseSearch)
  assert.equal(codebaseSearchActions[searchAll], openCodebaseSearchAll)
  const ignoreAware = t.mock.fn(codebaseSearchActions[search])
  const allFiles = t.mock.fn(codebaseSearchActions[searchAll])
  for (const surface of ['file_tree', 'diff_pane']) {
    const dispatch = createApplicationDispatcher({
      getActiveSurface: () => surface,
      getSurfaceActions: () => assert.fail('Search must not reach a surface adapter'),
      globalActions: { [search]: ignoreAware, [searchAll]: allFiles },
    })
    const controller = new VimController({ bindings: result.bindings })
    for (const [key, action] of [['g', search], ['G', searchAll]]) {
      assert.equal(controller.dispatch({ type: 'key', key: ',' }).command, null)
      const { command } = controller.dispatch({ type: 'key', key })
      assert.deepEqual(command.args.actions, [action])
      const before = [ignoreAware.mock.callCount(), allFiles.mock.callCount()]
      assert.equal(dispatch(command.args.actions, command.count), true)
      assert.equal(ignoreAware.mock.callCount(), before[0] + (action === search ? 1 : 0))
      assert.equal(allFiles.mock.callCount(), before[1] + (action === searchAll ? 1 : 0))
    }
  }
})

test('each search binding can be disabled without disabling the other mode', () => {
  for (const [disabled, enabled] of [[search, searchAll], [searchAll, search]]) {
    const result = resolveConfiguration({ configuration: { keybindings: { normal: {
      [disabled]: [], [enabled]: [['<leader>', 'g']],
    } } } })
    assert.equal(result.diagnostic, null)
    const normal = result.bindings.filter(({ mode }) => mode === 'normal')
    assert(!normal.some(({ args }) => args.actions.includes(disabled)))
    assert(normal.some(({ args }) => args.actions.includes(enabled)))
  }
})

test('overlays block both codebase search handlers', () => {
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => 'file_tree',
    getSurfaceActions: () => null,
    getOverlayActions: () => ({}),
    globalActions: {
      [search]: () => assert.fail('Ignore-aware search reached the workspace'),
      [searchAll]: () => assert.fail('All-files search reached the workspace'),
    },
  })
  assert.equal(dispatch(search), false)
  assert.equal(dispatch(searchAll), false)
})
