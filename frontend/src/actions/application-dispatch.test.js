import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createApplicationDispatcher,
  createSurfaceActionRegistry,
} from './application-dispatch.js'
import { ApplicationAction, defaultApplicationBindings } from './application-actions.js'
import { VimController } from '../vim/machine.js'
import { ActiveSurface } from '../app/workspace.js'
import { blockingOverlayActions, OverlayKind } from './overlay-actions.js'

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
        calls.push(['finder', count])
        return true
      },
      [ApplicationAction.OPEN_FILE_FINDER_ALL]: (count) => {
        calls.push(['finder-all', count])
        return true
      },
      [ApplicationAction.COPY_COMMENTS]: () => undefined,
    },
  })

  assert.equal(dispatch(ApplicationAction.CLOSE_APPLICATION), true)
  assert.equal(dispatch(ApplicationAction.OPEN_FILE_FINDER, 3), true)
  assert.equal(dispatch(ApplicationAction.OPEN_FILE_FINDER_ALL, 2), true)
  assert.deepEqual(calls, ['close', ['finder', 3], ['finder-all', 2]])
  assert.equal(dispatch(ApplicationAction.COPY_COMMENTS), false)
  assert.equal(dispatch('unknown.action'), false)
})

test('surface handlers take priority over global handlers regardless of scope', () => {
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => ActiveSurface.FILE_TREE,
    getSurfaceActions: () => ({
      [ApplicationAction.OPEN_FILE_FINDER]: (count) => {
        calls.push(['surface', count])
        return true
      },
      [ApplicationAction.ADD_FILE_COMMENT]: () => {
        calls.push('comment')
        return true
      },
    }),
    globalActions: {
      [ApplicationAction.OPEN_FILE_FINDER]: () => assert.fail('Global handler must not run'),
    },
  })

  assert.equal(dispatch(ApplicationAction.OPEN_FILE_FINDER, 3), true)
  assert.equal(dispatch(ApplicationAction.ADD_FILE_COMMENT), true)
  assert.deepEqual(calls, [['surface', 3], 'comment'])
})

test('missing surface handlers fall back to global handlers regardless of scope', () => {
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => ActiveSurface.FILE_TREE,
    getSurfaceActions: () => ({ [ApplicationAction.CURSOR_DOWN]: null }),
    globalActions: {
      [ApplicationAction.CURSOR_DOWN]: (count) => {
        calls.push(['down', count])
        return true
      },
      [ApplicationAction.ADD_FILE_COMMENT]: () => {
        calls.push('comment')
        return true
      },
    },
  })

  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 4), true)
  assert.equal(dispatch(ApplicationAction.ADD_FILE_COMMENT), true)
  assert.deepEqual(calls, [['down', 4], 'comment'])
})

test('unhandled surface actions do not fall back to global handlers', () => {
  for (const result of [false, undefined]) {
    const dispatch = createApplicationDispatcher({
      getActiveSurface: () => ActiveSurface.FILE_TREE,
      getSurfaceActions: () => ({ [ApplicationAction.CURSOR_DOWN]: () => result }),
      globalActions: {
        [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Global handler must not run'),
      },
    })
    assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
  }
})

test('grouped actions continue after an unhandled surface action', () => {
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => ActiveSurface.FILE_TREE,
    getSurfaceActions: () => ({
      [ApplicationAction.CURSOR_DOWN]: (count) => {
        calls.push(['surface', count])
        return false
      },
    }),
    globalActions: {
      [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Global handler must not run'),
      [ApplicationAction.OPEN_FILE_FINDER]: (count) => {
        calls.push(['global', count])
        return true
      },
      [ApplicationAction.CLOSE_APPLICATION]: () => assert.fail('Dispatch must stop when handled'),
    },
  })

  assert.equal(dispatch([
    ApplicationAction.CURSOR_DOWN,
    ApplicationAction.OPEN_FILE_FINDER,
    ApplicationAction.CLOSE_APPLICATION,
  ], 2), true)
  assert.deepEqual(calls, [['surface', 2], ['global', 2]])
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

test('overlay registrations remain separate and block workspace actions during replacement', () => {
  const registry = createSurfaceActionRegistry()
  const calls = []
  const first = { [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Old adapter must not run') }
  const replacement = {
    [ApplicationAction.CURSOR_DOWN]: (count) => {
      calls.push(count)
      return true
    },
  }
  const unregisterFirst = registry.register(OverlayKind.FILE_FINDER, first)
  const unregisterReplacement = registry.register(OverlayKind.FILE_FINDER, replacement)
  const unregisterReference = registry.register(OverlayKind.KEYMAP_REFERENCE, blockingOverlayActions)
  let activeOverlay = OverlayKind.FILE_FINDER
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => assert.fail('Overlay must block workspace dispatch'),
    getSurfaceActions: () => assert.fail('Overlay must block workspace dispatch'),
    getOverlayActions: () => registry.get(activeOverlay) ?? blockingOverlayActions,
    globalActions: {
      [ApplicationAction.CURSOR_DOWN]: () => assert.fail('Overlay must block global dispatch'),
    },
  })

  unregisterFirst()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN, 2), true)
  activeOverlay = OverlayKind.KEYMAP_REFERENCE
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
  unregisterReference()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
  activeOverlay = OverlayKind.FILE_FINDER
  unregisterReplacement()
  assert.equal(dispatch(ApplicationAction.CURSOR_DOWN), false)
  assert.deepEqual(calls, [2])
})

test('overlay registration can restart after Strict Mode cleanup', () => {
  const registry = createSurfaceActionRegistry()
  const cleanup = registry.register(OverlayKind.CODEBASE_SEARCH, blockingOverlayActions)
  cleanup()
  assert.equal(registry.get(OverlayKind.CODEBASE_SEARCH), null)
  const restartedCleanup = registry.register(OverlayKind.CODEBASE_SEARCH, blockingOverlayActions)
  assert.equal(registry.get(OverlayKind.CODEBASE_SEARCH), blockingOverlayActions)
  restartedCleanup()
  assert.equal(registry.get(OverlayKind.CODEBASE_SEARCH), null)
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
    dispatch(command.args.actions, command.count)
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
    getSurfaceActions: (surface) => surface === ActiveSurface.FILE_TREE
      ? {
          [ApplicationAction.SHOW_CHANGES]: () => {
            calls.push('changes')
            return true
          },
        }
      : {
          [ApplicationAction.ADD_COMMENT]: () => {
            calls.push('comment')
            return true
          },
        },
  })
  const controller = new VimController({ bindings: defaultApplicationBindings })
  controller.subscribeCommands((command) => (
    dispatch(command.args.actions, command.count)
  ))

  assert.equal(controller.dispatch({ type: 'key', key: 'c' }).handled, true)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(controller.dispatch({ type: 'key', key: 'c' }).handled, true)
  assert.deepEqual(calls, ['changes', 'comment'])
})

test('the active surface handles its respective focus command', () => {
  let activeSurface = ActiveSurface.FILE_TREE
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => activeSurface,
    getSurfaceActions: (surface) => surface === ActiveSurface.FILE_TREE
      ? {
          [ApplicationAction.FOCUS_DIFF_PANE]: () => {
            calls.push('diff')
            return true
          },
        }
      : {
          [ApplicationAction.FOCUS_FILE_TREE]: () => {
            calls.push('tree')
            return true
          },
        },
  })

  const focusActions = [
    ApplicationAction.FOCUS_FILE_TREE,
    ApplicationAction.FOCUS_DIFF_PANE,
  ]
  assert.equal(dispatch(focusActions), true)
  activeSurface = ActiveSurface.DIFF_PANE
  assert.equal(dispatch(focusActions), true)
  assert.deepEqual(calls, ['diff', 'tree'])
})


test('history actions dispatch from both surfaces, keyboards, and command names', () => {
  let surface = ActiveSurface.FILE_TREE
  const calls = []
  const dispatch = createApplicationDispatcher({
    getActiveSurface: () => surface,
    getSurfaceActions: () => null,
    globalActions: {
      [ApplicationAction.FILE_HISTORY_BACK]: (count) => { calls.push(['back', count]); return true },
      [ApplicationAction.FILE_HISTORY_FORWARD]: (count) => { calls.push(['forward', count]); return true },
    },
  })
  const controller = new VimController({ bindings: defaultApplicationBindings })
  controller.subscribeCommands((command) => dispatch(command.args.actions, command.count))
  assert.equal(controller.dispatch({ type: 'key', key: '<C-o>' }).handled, true)
  surface = ActiveSurface.DIFF_PANE
  assert.equal(controller.dispatch({ type: 'key', key: '<C-i>' }).handled, true)
  assert.equal(dispatch('file.history.back', 2), true)
  assert.deepEqual(calls, [['back', 1], ['forward', 1], ['back', 2]])
})
