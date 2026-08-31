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

test('file-tree Vim resize scales by counts with only a defensive upper bound', () => {
  assert.equal(FILE_TREE_WIDTH.VIM_MAX, 17_000)

  const widened = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_resized',
    steps: 2,
  })
  assert.equal(widened.fileTreeWidth, 400)

  const large = workspaceReducer(widened, {
    type: 'file_tree_resized',
    steps: 100,
  })
  assert.equal(large.fileTreeWidth, 4400)

  const defensiveMaximum = workspaceReducer(large, {
    type: 'file_tree_resized',
    steps: 1000,
  })
  assert.equal(defensiveMaximum.fileTreeWidth, FILE_TREE_WIDTH.VIM_MAX)
  assert.equal(workspaceReducer(defensiveMaximum, {
    type: 'file_tree_resized',
    steps: 1,
  }), defensiveMaximum)

  const decreased = workspaceReducer(defensiveMaximum, {
    type: 'file_tree_resized',
    steps: -400,
  })
  assert.equal(decreased.fileTreeWidth, 1000)
  const physicalMinimum = workspaceReducer(decreased, {
    type: 'file_tree_resized',
    steps: -100,
  })
  assert.equal(physicalMinimum.fileTreeWidth, 0)
  assert.equal(workspaceReducer(physicalMinimum, {
    type: 'file_tree_resized',
    steps: -1,
  }), physicalMinimum)
})

test('pointer resize stores continuous widths without an artificial maximum', () => {
  const resized = workspaceReducer(initialWorkspaceState, {
    type: 'file_tree_width_set',
    width: 517.25,
  })
  assert.equal(resized.fileTreeWidth, 517.25)

  const unbounded = workspaceReducer(resized, {
    type: 'file_tree_width_set',
    width: 5000,
  })
  assert.equal(unbounded.fileTreeWidth, 5000)

  const zero = workspaceReducer(unbounded, {
    type: 'file_tree_width_set',
    width: -25,
  })
  assert.equal(zero.fileTreeWidth, 0)
})

test('invalid pointer widths are a safe no-op', () => {
  for (const width of [undefined, Number.NaN, Number.POSITIVE_INFINITY, '320']) {
    assert.equal(workspaceReducer(initialWorkspaceState, {
      type: 'file_tree_width_set',
      width,
    }), initialWorkspaceState)
  }
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

test('workspace transitions keep a single authoritative active surface', () => {
  const diffActive = workspaceReducer(initialWorkspaceState, {
    type: 'surface_activated',
    surface: ActiveSurface.DIFF_PANE,
  })
  assert.equal(diffActive.activeSurface, ActiveSurface.DIFF_PANE)
  assert.equal(workspaceReducer(diffActive, {
    type: 'surface_activated',
    surface: ActiveSurface.DIFF_PANE,
  }), diffActive)

  const treeActive = workspaceReducer(diffActive, {
    type: 'surface_activated',
    surface: ActiveSurface.FILE_TREE,
  })
  assert.equal(treeActive.activeSurface, ActiveSurface.FILE_TREE)

  const finderSelection = workspaceReducer(treeActive, {
    type: 'finder_file_opened',
    path: 'src/main.zig',
    changed: true,
  })
  assert.equal(finderSelection.activeSurface, ActiveSurface.DIFF_PANE)
  assert.equal(finderSelection.selectedPath, 'src/main.zig')
})

test('file selection preserves the active tree mode and surface', () => {
  const filesModeDiffActive = {
    ...initialWorkspaceState,
    treeMode: TreeMode.FILES,
    activeSurface: ActiveSurface.DIFF_PANE,
    selectedPath: 'README.md',
  }

  const selected = workspaceReducer(filesModeDiffActive, {
    type: 'file_selected',
    path: 'src/main.zig',
  })

  assert.equal(selected.selectedPath, 'src/main.zig')
  assert.equal(selected.treeMode, TreeMode.FILES)
  assert.equal(selected.activeSurface, ActiveSurface.DIFF_PANE)
})

test('keyboard reference visibility is idempotent and preserves workspace context', () => {
  const opened = workspaceReducer(initialWorkspaceState, {
    type: 'keymap_reference_opened',
  })
  assert.equal(opened.keymapReferenceOpen, true)
  assert.equal(opened.activeSurface, initialWorkspaceState.activeSurface)
  assert.equal(workspaceReducer(opened, {
    type: 'keymap_reference_opened',
  }), opened)

  const closed = workspaceReducer(opened, { type: 'keymap_reference_closed' })
  assert.equal(closed.keymapReferenceOpen, false)
  assert.equal(closed.activeSurface, initialWorkspaceState.activeSurface)
  assert.equal(workspaceReducer(closed, {
    type: 'keymap_reference_closed',
  }), closed)
})
