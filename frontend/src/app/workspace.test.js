import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ActiveSurface,
  FILE_TREE_WIDTH,
  TreeMode,
  initialWorkspaceState,
  workspaceReducer,
} from './workspace.js'

test('file-tree width starts at the existing layout width', () => {
  assert.equal(initialWorkspaceState.fileTreeWidth, 320)
  assert.equal(initialWorkspaceState.fileTreeWidth, FILE_TREE_WIDTH.INITIAL)
})

test('file-tree resize scales by counts and clamps to usable bounds', () => {
  const widened = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_resized',
    steps: 2,
  })
  assert.equal(widened.fileTreeWidth, 400)

  const maximum = workspaceReducer(widened, {
    type: 'file_tree_resized',
    steps: 100,
  })
  assert.equal(maximum.fileTreeWidth, FILE_TREE_WIDTH.MAX)
  assert.equal(workspaceReducer(maximum, {
    type: 'file_tree_resized',
    steps: 1,
  }), maximum)

  const minimum = workspaceReducer(maximum, {
    type: 'file_tree_resized',
    steps: -100,
  })
  assert.equal(minimum.fileTreeWidth, FILE_TREE_WIDTH.MIN)
  assert.equal(workspaceReducer(minimum, {
    type: 'file_tree_resized',
    steps: -1,
  }), minimum)
})

test('file-tree width survives normal workspace transitions', () => {
  const resized = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_resized',
    steps: 2,
  })
  const transitions = [
    {
      type: 'tree_mode_changed',
      mode: TreeMode.FILES,
      visiblePaths: ['src/main.zig'],
      initialPath: 'src/main.zig',
    },
    { type: 'file_selected', path: 'src/main.zig' },
    { type: 'finder_opened' },
    {
      type: 'finder_file_opened',
      path: 'README.md',
      changed: false,
    },
    { type: 'surface_activated', surface: ActiveSurface.FILE_TREE },
    { type: 'review_loaded', initialPath: 'build.zig' },
  ]

  const finalState = transitions.reduce(workspaceReducer, resized)
  assert.equal(finalState.fileTreeWidth, 400)
})

test('invalid resize steps are a safe no-op', () => {
  for (const steps of [undefined, Number.NaN, 1.5, '2']) {
    assert.equal(workspaceReducer(initialWorkspaceState, {
      type: 'file_tree_resized',
      steps,
    }), initialWorkspaceState)
  }
})
