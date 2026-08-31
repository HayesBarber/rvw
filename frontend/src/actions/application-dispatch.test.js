import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createApplicationDispatcher,
  createSurfaceActionRegistry,
} from './application-dispatch.js'
import { ApplicationAction, defaultApplicationBindings } from './application-actions.js'
import { VimController } from '../vim/machine.js'
import { ActiveSurface } from '../app/workspace.js'

test('global actions receive counts and must explicitly report handled', () => {
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => ActiveSurface.FILE_TREE,
    getSurfaceActions: () => null,
    globalActions: {
      [ApplicationAction.CLOSE_APPLICATION]: () => {
        calls.push('close')
        return true
      },
      [ApplicationAction.OPEN_FILE_FINDER]: (count) => {
        calls.push(count)
        return true
      },
      [ApplicationAction.COPY_COMMENTS]: () => undefined,
    },
  })

  assert.equal(dispatch(ApplicationAction.CLOSE_APPLICATION), true)
  assert.equal(dispatch(ApplicationAction.OPEN_FILE_FINDER, 3), true)
  assert.deepEqual(calls, ['close', 3])
  assert.equal(dispatch(ApplicationAction.COPY_COMMENTS), false)
  assert.equal(dispatch('unknown.action'), false)
})

test('file-tree resize actions remain global on either review surface', () => {
  let activeSurface = ActiveSurface.FILE_TREE
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: () => null,
    globalActions: {
      [ApplicationAction.TREE_SIZE_INCREASE]: (count) => {
        calls.push(['increase', count])
        return true
      },
      [ApplicationAction.TREE_SIZE_DECREASE]: (count) => {
        calls.push(['decrease', count])
        return true
      },
    },
  })

  assert.equal(dispatch(ApplicationAction.TREE_SIZE_INCREASE, 3), true)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(dispatch(ApplicationAction.TREE_SIZE_DECREASE, 2), true)
  assert.deepEqual(calls, [['increase', 3], ['decrease', 2]])
})

test('file navigation actions remain global and preserve Vim counts', () => {
  let activeSurface = ActiveSurface.FILE_TREE
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: () => null,
    globalActions: {
      [ApplicationAction.OPEN_NEXT_FILE]: (count) => {
        calls.push(['next', count])
        return true
      },
      [ApplicationAction.OPEN_PREVIOUS_FILE]: (count) => {
        calls.push(['previous', count])
        return true
      },
    },
  })

  assert.equal(dispatch(ApplicationAction.OPEN_NEXT_FILE, 3), true)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(dispatch(ApplicationAction.OPEN_PREVIOUS_FILE, 2), true)
  assert.deepEqual(calls, [['next', 3], ['previous', 2]])
})

test('active-surface actions route only to the authoritative surface adapter', () => {
  let activeSurface = ActiveSurface.FILE_TREE
  const calls = []
  const registry = createSurfaceActionRegistry()
  registry.register(ActiveSurface.FILE_TREE, {
    [ApplicationAction.CURSOR_DOWN]: (count) => {
      calls.push(['tree', count])
      return true
    },
  })
  registry.register(ActiveSurface.DIFF_PANE, {
    [ApplicationAction.CURSOR_DOWN]: (count) => {
      calls.push(['diff', count])
      return true
    },
  })
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: registry.get,
  })

  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 4), true)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 2), true)
  assert.deepEqual(calls, [['tree', 4], ['diff', 2]])
})

test('an active overlay receives actions without leaking them to the workspace', () => {
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => ActiveSurface.FILE_TREE,
    getSurfaceActions: () => ({
      [ApplicationAction.CURSOR_DOWN]: () => {
        calls.push('surface')
        return true
      },
    }),
    getOverlayActions: () => ({
      [ApplicationAction.CURSOR_DOWN]: (count) => {
        calls.push(['overlay', count])
        return true
      },
    }),
    globalActions: {
      [ApplicationAction.OPEN_FILE_FINDER]: () => {
        calls.push('global')
        return true
      },
    },
  })

  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 3), true)
  assert.equal(dispatch(ApplicationAction.OPEN_FILE_FINDER), false)
  assert.deepEqual(calls, [['overlay', 3]])
})

test('file-tree actions are unhandled unless the file tree is active', () => {
  let activeSurface = ActiveSurface.DIFF_PANE
  let activations = 0
  const registry = createSurfaceActionRegistry()
  registry.register(ActiveSurface.FILE_TREE, {
    [ApplicationAction.FILE_TREE_ITEM_ACTIVATE]: () => {
      activations += 1
      return true
    },
  })
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: registry.get,
  })

  assert.equal(dispatch(ApplicationAction.FILE_TREE_ITEM_ACTIVATE), false)
  activeSurface = ActiveSurface.FILE_TREE
  assert.equal(dispatch(ApplicationAction.FILE_TREE_ITEM_ACTIVATE), true)
  assert.equal(activations, 1)
})

test('diff-pane actions are unhandled unless the diff pane is active', () => {
  let activeSurface = ActiveSurface.FILE_TREE
  let additions = 0
  const registry = createSurfaceActionRegistry()
  registry.register(ActiveSurface.DIFF_PANE, {
    [ApplicationAction.ADD_FILE_COMMENT]: () => {
      additions += 1
      return true
    },
  })
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: registry.get,
  })

  assert.equal(dispatch(ApplicationAction.ADD_FILE_COMMENT), false)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(dispatch(ApplicationAction.ADD_FILE_COMMENT), true)
  assert.equal(additions, 1)
})

test('surface registrations clean up without removing a newer adapter', () => {
  const registry = createSurfaceActionRegistry()
  const first = {}
  const second = {}
  const unregisterFirst = registry.register(ActiveSurface.FILE_TREE, first)
  const unregisterSecond = registry.register(ActiveSurface.FILE_TREE, second)

  unregisterFirst()
  assert.equal(registry.get(ActiveSurface.FILE_TREE), second)
  unregisterSecond()
  assert.equal(registry.get(ActiveSurface.FILE_TREE), null)
})

test('Vim commands consume keys only when application dispatch handles them', () => {
  let handleCursor = false
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => ActiveSurface.FILE_TREE,
    getSurfaceActions: () => ({
      [ApplicationAction.CURSOR_DOWN]: () => handleCursor,
    }),
  })
  const controller = new VimController({ bindings: defaultApplicationBindings })
  controller.subscribeCommands((command) => (
    dispatch(command.command, command.count)
  ))

  assert.equal(controller.dispatch({ type: 'key', key: 'j' }).handled, false)
  handleCursor = true
  assert.equal(controller.dispatch({ type: 'key', key: '2' }).handled, true)
  assert.equal(controller.dispatch({ type: 'key', key: 'j' }).handled, true)
})

test('contextual duplicate keys resolve against the active surface', () => {
  let activeSurface = ActiveSurface.FILE_TREE
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: (surface) => surface === ActiveSurface.DIFF_PANE
      ? {
          [ApplicationAction.ADD_COMMENT]: () => {
            calls.push('comment')
            return true
          },
        }
      : null,
    globalActions: {
      [ApplicationAction.SHOW_CHANGES]: () => {
        if (activeSurface !== ActiveSurface.FILE_TREE) return false
        calls.push('changes')
        return true
      },
    },
  })
  const controller = new VimController({ bindings: defaultApplicationBindings })
  controller.subscribeCommands((command) => (
    dispatch(command.command, command.count)
  ))

  assert.equal(controller.dispatch({ type: 'key', key: 'c' }).handled, true)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(controller.dispatch({ type: 'key', key: 'c' }).handled, true)
  assert.deepEqual(calls, ['changes', 'comment'])
})
